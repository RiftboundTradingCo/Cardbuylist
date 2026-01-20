document.addEventListener("DOMContentLoaded", async () => {
  console.log("✅ buy.js loaded (Buy Cards page)");

  const BUY_CART_KEY = "buyCart";

  const searchEl = document.getElementById("buySearch");
  const clearSearchBtn = document.getElementById("buySearchClear");
  const gridEl = document.getElementById("buyGrid");
  const rarityFilterEl = document.getElementById("rarityFilter");
  const setFilterEl = document.getElementById("setFilter");

  // mini cart (optional)
  const miniCountEl = document.getElementById("miniCartCount");
  const miniSubtotalEl = document.getElementById("miniCartSubtotal");
  const miniItemsEl = document.getElementById("miniCartItems");

  // Secure Checkout button (mini cart)
  const secureBtn = document.getElementById("secureCheckoutBtn");

  // image modal
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalClose = document.getElementById("imageModalClose");

  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played",
  };

  // For DB variants we use short codes in the DB: NM/LP/MP/HP
  function tabToDbCond(tab) {
    const t = String(tab || "NM").toUpperCase();
    return ["NM", "LP", "MP", "HP"].includes(t) ? t : "NM";
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    const withSlash = s.startsWith("/") ? s : `/${s}`;
    return encodeURI(withSlash);
  }

  // ---------- storage ----------
  function loadBuyCart() {
    try {
      return JSON.parse(localStorage.getItem(BUY_CART_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveBuyCart(cart) {
    localStorage.setItem(BUY_CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("cart:changed"));
  }

  function normalizeConditionLong(c) {
    const allowed = Object.values(TAB_TO_COND);
    const s = String(c || "Near Mint").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function qtyInCart(sku, conditionLong) {
    const cart = loadBuyCart();
    const s = String(sku || "").trim();
    const c = normalizeConditionLong(conditionLong);
    return cart.reduce((sum, it) => {
      if (String(it.sku || "").trim() === s && normalizeConditionLong(it.condition) === c) {
        return sum + Math.max(0, Number(it.qty || 0));
      }
      return sum;
    }, 0);
  }

  // ---------- helpers ----------
  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function safeParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  // ---------- variant helpers (FIXED) ----------
  function getVariants(product) {
    return Array.isArray(product?.variants) ? product.variants : [];
  }

  /**
   * Find variant for a given condition.
   * - tries exact foilPref match first
   * - if only one variant exists for the condition, returns it (foil-only cards!)
   * - otherwise prefers non-foil
   */
  function findVariant(product, tab, foilPref = false) {
    const dbCond = tabToDbCond(tab);
    const vars = getVariants(product).filter(v => String(v?.condition) === dbCond);
    if (!vars.length) return null;

    const exact = vars.find(v => Boolean(v?.foil) === Boolean(foilPref));
    if (exact) return exact;

    if (vars.length === 1) return vars[0];

    return vars.find(v => !v.foil) || vars[0];
  }

  // unit price for selected condition:
  // - prefer variant.price_cents
  // - else fall back to legacy product.price_cents
  function unitCentsFor(product, tab) {
    const v = findVariant(product, tab, false);
    const p = Number(v?.price_cents);
    if (Number.isFinite(p) && p >= 0) return p;
    return Number(product?.price_cents || 0) || 0;
  }

  // stock for selected condition:
  // - prefer variant.stock
  // - else fall back to legacy product.stock["Near Mint"...]
  function stockFor(product, tab) {
    const v = findVariant(product, tab, false);
    const s = Number(v?.stock);
    if (Number.isFinite(s)) return s;

    const long = TAB_TO_COND[String(tab || "NM").toUpperCase()] || "Near Mint";
    if (product?.stock && typeof product.stock === "object") {
      return Number(product.stock[long] ?? 0) || 0;
    }
    return Number(product?.stock ?? 0) || 0;
  }

  function remainingStock(product, sku, tab) {
    const stock = stockFor(product, tab);
    const longCond = TAB_TO_COND[String(tab || "NM").toUpperCase()] || "Near Mint";
    const inCart = qtyInCart(sku, longCond);
    return Math.max(0, stock - inCart);
  }

  // HARD LIMIT add
  function addToCartHardLimited(sku, product, tab, addQty) {
    const s = String(sku || "").trim();
    const t = String(tab || "NM").toUpperCase();
    const condLong = TAB_TO_COND[t] || "Near Mint";
    const qtyToAdd = Math.max(1, Number(addQty || 1));

    const rem = remainingStock(product, s, t);
    if (rem <= 0) return { ok: false, error: "Out of stock" };

    const actualAdd = Math.min(qtyToAdd, rem);

    const cart = loadBuyCart();
    const idx = cart.findIndex(it =>
      String(it.sku || "").trim() === s &&
      normalizeConditionLong(it.condition) === condLong
    );

    if (idx >= 0) cart[idx].qty = Math.max(0, Number(cart[idx].qty || 0)) + actualAdd;
    else cart.push({ sku: s, condition: condLong, qty: actualAdd });

    saveBuyCart(cart);
    return { ok: true, added: actualAdd };
  }

  // ---------- modal ----------
  function openModal(src) {
    if (!modal || !modalImg) return;
    modalImg.src = src;
    modal.classList.remove("hidden");
  }
  function closeModal() {
    if (!modal || !modalImg) return;
    modal.classList.add("hidden");
    modalImg.src = "";
  }
  if (modalClose) modalClose.addEventListener("click", closeModal);
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ---------- fetch catalog ----------
  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.catalog) throw new Error("Bad catalog JSON");
    return data.catalog;
  }

  // ---------- mini cart ----------
  function renderMiniCart(catalog) {
    if (!miniCountEl && !miniSubtotalEl && !miniItemsEl) return;

    const cart = loadBuyCart();
    let count = 0;
    let subtotalCents = 0;

    const lines = [];
    for (const it of cart) {
      const sku = String(it.sku || "").trim();
      const condLong = normalizeConditionLong(it.condition);
      const qty = Math.max(0, Number(it.qty || 0));
      if (!sku || qty <= 0) continue;

      count += qty;

      const product = catalog?.[sku];
      const tab =
        condLong === "Near Mint" ? "NM" :
        condLong === "Lightly Played" ? "LP" :
        condLong === "Moderately Played" ? "MP" :
        "HP";

      const unit = unitCentsFor(product, tab);
      subtotalCents += unit * qty;

      const name = String(product?.name || sku);
      lines.push(`${qty} × ${name} — ${condLong} — ${money(unit * qty)}`);
    }

    if (miniCountEl) miniCountEl.textContent = String(count);
    if (miniSubtotalEl) miniSubtotalEl.textContent = (subtotalCents / 100).toFixed(2);
    if (miniItemsEl) miniItemsEl.innerHTML = lines.map(l => `<div>${l}</div>`).join("");
  }

  // ---------- secure checkout ----------
  async function secureCheckout() {
    if (!secureBtn) return;

    const cart = safeParse(localStorage.getItem(BUY_CART_KEY) || "[]", []);
    if (!Array.isArray(cart) || cart.length === 0) {
      alert("Your cart is empty.");
      return;
    }

    let email = "";
    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const me = await meRes.json().catch(() => ({}));
      email = me?.ok && me?.user?.email ? String(me.user.email).trim() : "";
    } catch {}

    if (!email) {
      window.location.href = "/buy-cart.html";
      return;
    }

    secureBtn.disabled = true;
    const prev = secureBtn.textContent;
    secureBtn.textContent = "Starting checkout…";

    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, cart })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error || `Checkout failed (HTTP ${res.status})`);
      }

      window.location.assign(data.url);
    } catch (err) {
      console.error("Secure checkout error:", err);
      alert(err?.message || "Could not start checkout.");
    } finally {
      secureBtn.disabled = false;
      secureBtn.textContent = prev || "🔒 Secure Checkout";
    }
  }

  if (secureBtn) secureBtn.addEventListener("click", secureCheckout);

  // ---------- filters ----------
  function populateFilters(catalog) {
    const products = Object.values(catalog || {});
    const rarities = new Set();
    const sets = new Set();

    for (const p of products) {
      if (p?.rarity) rarities.add(String(p.rarity).trim());
      if (p?.set_code) sets.add(String(p.set_code).trim());
    }

    if (rarityFilterEl) {
      const cur = rarityFilterEl.value || "";
      const list = [...rarities].filter(Boolean).sort((a, b) => a.localeCompare(b));
      rarityFilterEl.innerHTML =
        `<option value="">All rarities</option>` +
        list.map(r => `<option value="${r}">${r}</option>`).join("");
      rarityFilterEl.value = list.includes(cur) ? cur : "";
    }

    if (setFilterEl) {
      const cur = setFilterEl.value || "";
      const list = [...sets].filter(Boolean).sort((a, b) => a.localeCompare(b));
      setFilterEl.innerHTML =
        `<option value="">All sets</option>` +
        list.map(s => `<option value="${s}">${s}</option>`).join("");
      setFilterEl.value = list.includes(cur) ? cur : "";
    }
  }

  // ---------- render cards ----------
  function renderGrid(catalog, query, rarityVal = "", setVal = "") {
    if (!gridEl) return;
    const q = String(query || "").trim().toLowerCase();

    const skus = Object.keys(catalog || {});
    const filtered = skus.filter(sku => {
      const product = catalog[sku];
      if (!product) return false;

      const name = String(product?.name || sku).toLowerCase();
      const searchOk = !q || name.includes(q) || String(sku).toLowerCase().includes(q);

      const r = String(product?.rarity || "").trim();
      const rarityOk = !rarityVal || r === rarityVal;

      const s = String(product?.set_code || "").trim();
      const setOk = !setVal || s === setVal;

      return searchOk && rarityOk && setOk;
    });

    gridEl.innerHTML = "";

    filtered.forEach((sku) => {
      const product = catalog[sku];
      if (!product) return;

      const name = String(product.name || sku);
      const imgSrc = normalizeImagePath(product.image);

      // choose active tab by stock
      let activeTab = "NM";
      for (const t of TAB_ORDER) {
        if (stockFor(product, t) > 0) { activeTab = t; break; }
      }

      // foil logic (FIXED: derived from variants)
      const variants = getVariants(product);
      const hasFoil = variants.some(v => Boolean(v?.foil));
      const hasNonFoil = variants.some(v => !Boolean(v?.foil));
      const onlyFoil = hasFoil && !hasNonFoil;

      const activeVariant = findVariant(product, activeTab, false);
      const activeIsFoil = Boolean(activeVariant?.foil);

      // show foil badge if foil-only or active variant is foil
      const showFoil = onlyFoil || activeIsFoil;

      const unitCents = unitCentsFor(product, activeTab);
      const stockActive = stockFor(product, activeTab);
      const remActive = remainingStock(product, sku, activeTab);

      const card = document.createElement("div");

      const setCode = String(product?.set_code || "");
      const rarity = String(product?.rarity || "");
      const number = String(product?.number || product?.card_number || "");

      card.className = "store-card";
      card.dataset.sku = sku;
      card.dataset.activeTab = activeTab;
      card.dataset.rarity = rarity;
      card.dataset.set = setCode;
      card.dataset.foil = showFoil ? "1" : "0";

      const rarityClass = rarity.toLowerCase().replace(/[^a-z0-9_-]/g, "");

      const metaBits = [
        setCode ? `<span class="meta-pill">${setCode}</span>` : "",
        number ? `<span class="meta-pill">#${number}</span>` : "",
        rarity ? `<span class="meta-pill rarity-${rarityClass}">${rarity}</span>` : "",
        showFoil ? `<span class="meta-pill">Foil</span>` : "",
      ].filter(Boolean).join(" ");

      card.innerHTML = `
        <div class="product-card">
          ${imgSrc ? `
            <div class="card-img-wrap ${showFoil ? "foil" : ""}">
              <img class="card-zoom-img" src="${imgSrc}" alt="${name}" />
              ${showFoil ? `<div class="foil-badge" title="Foil">✨ FOIL</div>` : ""}
            </div>
          ` : ""}

          <h3 class="product-title">${name}</h3>

          <div class="cond-tabs" role="tablist" aria-label="Condition">
            ${TAB_ORDER.map(tab => {
              const stock = stockFor(product, tab);
              const disabled = stock <= 0;
              return `<button
                class="cond-tab${tab === activeTab ? " active" : ""}${disabled ? " disabled" : ""}"
                type="button"
                data-tab="${tab}"
                aria-disabled="${disabled ? "true" : "false"}"
              >${tab}</button>`;
            }).join("")}
          </div>

          <div class="product-meta">
            <div>Price: <strong class="priceText">${money(unitCents)}</strong></div>
            <div>In stock: <strong class="stockText">${stockActive}</strong></div>
            <div class="product-meta-pills">${metaBits}</div>
          </div>

          <div class="qty-controls">
            <button class="qty-minus" type="button">−</button>
            <input class="qty-input" type="text" value="1" inputmode="numeric" />
            <button class="qty-plus" type="button">+</button>
          </div>

          <button class="addBtn" type="button">Add to Buy Cart</button>
        </div>
      `;

      // initial clamp
      const addBtn = card.querySelector(".addBtn");
      const plusBtn = card.querySelector(".qty-plus");
      const qtyInput = card.querySelector(".qty-input");

      if (addBtn) addBtn.disabled = remActive <= 0;
      if (plusBtn) plusBtn.disabled = remActive <= 1;
      if (qtyInput) qtyInput.value = "1";

      gridEl.appendChild(card);
    });
  }

  function rerender() {
    renderGrid(
      catalog,
      searchEl?.value || "",
      rarityFilterEl?.value || "",
      setFilterEl?.value || ""
    );
    renderMiniCart(catalog);
  }

  // ---------- init ----------
  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("Buy catalog error:", e);
    if (gridEl) gridEl.innerHTML = `<div class="cart-card">Could not load catalog.</div>`;
    return;
  }

  populateFilters(catalog);
  rerender();

  // ---------- search ----------
  if (searchEl) {
    searchEl.addEventListener("input", rerender);
  }
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      if (searchEl) searchEl.value = "";
      rerender();
    });
  }

  // ---------- filter events ----------
  if (rarityFilterEl) rarityFilterEl.addEventListener("change", rerender);
  if (setFilterEl) setFilterEl.addEventListener("change", rerender);

  // ---------- clicks (delegation) ----------
  document.addEventListener("click", (e) => {
    const zoomImg = e.target.closest(".card-zoom-img");
    if (zoomImg) {
      openModal(zoomImg.src);
      return;
    }

    const card = e.target.closest(".store-card");
    if (!card) return;

    const sku = String(card.dataset.sku || "").trim();
    if (!sku) return;

    const product = catalog[sku];
    if (!product) return;

    // tab switch
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      const tab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      card.dataset.activeTab = tab;

      card.querySelectorAll(".cond-tab").forEach(b => {
        b.classList.toggle("active", String(b.dataset.tab || "") === tab);
      });

      const stock = stockFor(product, tab);
      const rem = remainingStock(product, sku, tab);

      const stockText = card.querySelector(".stockText");
      if (stockText) stockText.textContent = String(stock);

      const priceText = card.querySelector(".priceText");
      if (priceText) priceText.textContent = money(unitCentsFor(product, tab));

      // update foil badge on tab switch (if variant differs)
      const variants = getVariants(product);
      const hasFoil = variants.some(v => Boolean(v?.foil));
      const hasNonFoil = variants.some(v => !Boolean(v?.foil));
      const onlyFoil = hasFoil && !hasNonFoil;

      const activeVariant = findVariant(product, tab, false);
      const activeIsFoil = Boolean(activeVariant?.foil);
      const showFoil = onlyFoil || activeIsFoil;

      const wrap = card.querySelector(".card-img-wrap");
      const badge = card.querySelector(".foil-badge");
      if (wrap) wrap.classList.toggle("foil", !!showFoil);
      if (badge) badge.style.display = showFoil ? "" : "none";

      const addBtn = card.querySelector(".addBtn");
      const plusBtn = card.querySelector(".qty-plus");
      const qtyInput = card.querySelector(".qty-input");

      if (qtyInput) qtyInput.value = "1";
      if (addBtn) addBtn.disabled = rem <= 0;
      if (plusBtn) plusBtn.disabled = rem <= 1;

      return;
    }

    const tab = String(card.dataset.activeTab || "NM").toUpperCase();
    const qtyInput = card.querySelector(".qty-input");
    const plusBtn = card.querySelector(".qty-plus");
    const addBtn = card.querySelector(".addBtn");

    const rem = remainingStock(product, sku, tab);

    // plus
    if (e.target.closest(".qty-plus")) {
      const cur = Math.max(1, Number(qtyInput?.value || 1));
      const next = Math.min(cur + 1, Math.max(1, rem));
      if (qtyInput) qtyInput.value = String(next);

      if (plusBtn) plusBtn.disabled = rem <= 0 || next >= rem;
      if (addBtn) addBtn.disabled = rem <= 0;
      return;
    }

    // minus
    if (e.target.closest(".qty-minus")) {
      const cur = Math.max(1, Number(qtyInput?.value || 1));
      const next = Math.max(1, cur - 1);
      if (qtyInput) qtyInput.value = String(next);

      if (plusBtn) plusBtn.disabled = rem <= 1 || next >= rem;
      if (addBtn) addBtn.disabled = rem <= 0;
      return;
    }

    // add
    if (e.target.closest(".addBtn")) {
      const desiredQty = Math.max(1, Number(qtyInput?.value || 1));
      const r = addToCartHardLimited(sku, product, tab, desiredQty);

      const rem2 = remainingStock(product, sku, tab);
      if (addBtn) addBtn.disabled = rem2 <= 0;
      if (plusBtn) plusBtn.disabled = rem2 <= 1;
      if (qtyInput) qtyInput.value = "1";

      renderMiniCart(catalog);

      if (!r.ok) console.warn("Add blocked:", r.error);
      return;
    }
  });

  window.addEventListener("cart:changed", () => renderMiniCart(catalog));
});
