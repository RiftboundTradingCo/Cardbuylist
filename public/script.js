document.addEventListener("DOMContentLoaded", async () => {
  console.log("✅ sell.js loaded (Sell Cards page)");

  const GRID_ID = "sellGrid";
  const CART_KEY = "sellCart";

  const gridEl = document.getElementById(GRID_ID);
  const searchEl = document.getElementById("sellSearch");
  const clearSearchEl = document.getElementById("sellSearchClear");
  const rarityFilterEl = document.getElementById("sellRarityFilter");
  const setFilterEl = document.getElementById("sellSetFilter");

  if (!gridEl) return;

  // Sell uses NM/LP/MP
  const TAB_ORDER = ["NM", "LP", "MP"];

  // ---------- modal (click image to zoom) ----------
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalClose = document.getElementById("imageModalClose");

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

  // ---------- helpers ----------
  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function loadCart() {
    return safeParse(localStorage.getItem(CART_KEY) || "[]", []);
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("cart:changed"));
    if (typeof window.updateCartBadges === "function") window.updateCartBadges();
  }

  function normalizeTab(t) {
    const u = String(t || "NM").toUpperCase();
    return TAB_ORDER.includes(u) ? u : "NM";
  }

  function money(n) {
    return `$${Number(n || 0).toFixed(2)}`;
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    return encodeURI(s.startsWith("/") ? s : `/${s}`);
  }

  function clampQty(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 1) return 1;
    if (x > 999) return 999;
    return Math.floor(x);
  }

  function getCartQty(cart, sku, tab) {
    const t = normalizeTab(tab);
    const s = String(sku || "").trim();
    return cart.reduce((sum, it) => {
      if (String(it.sku || "").trim() !== s) return sum;
      if (normalizeTab(it.condition) !== t) return sum;
      return sum + Math.max(0, Number(it.qty || 0));
    }, 0);
  }

  function setCartQty(cart, sku, name, tab, qty) {
    const t = normalizeTab(tab);
    const s = String(sku || "").trim();
    const q = Math.max(0, Number(qty || 0));

    // remove existing line for sku+tab
    let next = cart.filter((it) => {
      return !(String(it.sku || "").trim() === s && normalizeTab(it.condition) === t);
    });

    // add consolidated line if q>0
    if (q > 0) next.push({ sku: s, name, condition: t, qty: q });

    return next;
  }

  function getPriceFor(p, tab) {
    const t = normalizeTab(tab);
    const v = Number(p?.prices?.[t] ?? 0);
    return Number.isFinite(v) ? v : 0;
  }

  function getMaxFor(p, tab) {
    const t = normalizeTab(tab);
    const v = Number(p?.max?.[t] ?? 0);
    return Number.isFinite(v) ? v : 0;
  }

  // ---------- data ----------
  async function fetchSellList() {
    const res = await fetch("/api/selllist", { cache: "no-store" });
    if (!res.ok) throw new Error(`selllist HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (!data?.ok || !data.selllist) throw new Error("Bad selllist JSON");
    return data.selllist;
  }

  // Filters + search helpers
  function matchesFilters(p, q, rarityVal, setVal) {
    const name = String(p?.name || "").toLowerCase();
    const sku = String(p?.sku || "").toLowerCase();
    const searchOk = !q || name.includes(q) || sku.includes(q);

    const r = String(p?.rarity || "").trim();
    const rarityOk = !rarityVal || r === rarityVal;

    const s = String(p?.set_code || p?.set || "").trim();
    const setOk = !setVal || s === setVal;

    return searchOk && rarityOk && setOk;
  }

  function populateSellFilters(selllist) {
    const items = Object.values(selllist || {});
    const rarities = new Set();
    const sets = new Set();

    for (const p of items) {
      if (p?.rarity) rarities.add(String(p.rarity).trim());
      if (p?.set_code || p?.set) sets.add(String(p.set_code || p.set).trim());
    }

    if (rarityFilterEl) {
      const cur = rarityFilterEl.value || "";
      const list = [...rarities].filter(Boolean).sort((a,b)=>a.localeCompare(b));
      rarityFilterEl.innerHTML =
        `<option value="">All rarities</option>` +
        list.map(r => `<option value="${r}">${r}</option>`).join("");
      rarityFilterEl.value = list.includes(cur) ? cur : "";
    }

    if (setFilterEl) {
      const cur = setFilterEl.value || "";
      const list = [...sets].filter(Boolean).sort((a,b)=>a.localeCompare(b));
      setFilterEl.innerHTML =
        `<option value="">All sets</option>` +
        list.map(s => `<option value="${s}">${s}</option>`).join("");
      setFilterEl.value = list.includes(cur) ? cur : "";
    }
  }

  // ---------- state ----------
  let selllist = {};
  let ALL_ITEMS = [];

  function getActiveQuery() {
    return String(searchEl?.value || "").trim().toLowerCase();
  }
  function getActiveRarity() {
    return String(rarityFilterEl?.value || "").trim();
  }
  function getActiveSet() {
    return String(setFilterEl?.value || "").trim();
  }

  // ---------- UI refresh per card ----------
  function refreshCard(cardEl) {
    const sku = String(cardEl.dataset.sku || "").trim();
    const p = selllist[sku];
    if (!p) return;

    const tab = normalizeTab(cardEl.dataset.activeTab || "NM");

    // active tab highlight + disabled tabs
    cardEl.querySelectorAll(".cond-tab").forEach((b) => {
      const bTab = normalizeTab(b.dataset.tab || "NM");
      const price = getPriceFor(p, bTab);
      const maxCap = getMaxFor(p, bTab);
      const disabled = price <= 0 || maxCap <= 0;

      b.classList.toggle("active", bTab === tab);
      b.classList.toggle("disabled", disabled);
      b.setAttribute("aria-disabled", disabled ? "true" : "false");
    });

    // numbers
    const cart = loadCart();
    const inCart = getCartQty(cart, sku, tab);
    const price = getPriceFor(p, tab);
    const maxCap = getMaxFor(p, tab);
    const remaining = Math.max(0, maxCap - inCart);

    const priceText = cardEl.querySelector(".priceText");
    const maxText = cardEl.querySelector(".maxText");
    const inCartText = cardEl.querySelector(".inCartText");
    const remText = cardEl.querySelector(".remText");

    if (priceText) priceText.textContent = money(price);
    if (maxText) maxText.textContent = String(maxCap);
    if (inCartText) inCartText.textContent = String(inCart);
    if (remText) remText.textContent = String(remaining);

    // button enabled?
    const addBtn = cardEl.querySelector(".addBtn");
    if (addBtn) addBtn.disabled = !(price > 0 && maxCap > 0 && remaining > 0);

    // qty buttons clamp behavior
    const qtyInput = cardEl.querySelector(".qty-input");
    const plusBtn = cardEl.querySelector(".qty-plus");
    const minusBtn = cardEl.querySelector(".qty-minus");

    const desired = clampQty(qtyInput?.value || 1);
    const allowedAdd = Math.max(0, remaining);

    if (qtyInput) qtyInput.value = String(Math.max(1, Math.min(desired, Math.max(1, allowedAdd || 1))));
    if (minusBtn) minusBtn.disabled = clampQty(qtyInput?.value || 1) <= 1;
    if (plusBtn) plusBtn.disabled = allowedAdd <= 1;
  }

  // ---------- render ----------
  function renderGrid() {
    const q = getActiveQuery();
    const rarityVal = getActiveRarity();
    const setVal = getActiveSet();

    gridEl.innerHTML = "";

    for (const item of ALL_ITEMS) {
      if (!matchesFilters(item, q, rarityVal, setVal)) continue;

      const p = item;
      const sku = String(p.sku || "").trim();
      const name = String(p.name || sku);
      const imgSrc = normalizeImagePath(p.image);

      const setCode = String(p?.set_code || p?.set || "");
      const rarity  = String(p?.rarity || "");
      const number  = String(p?.card_number || p?.number || "");
      const showFoil = Boolean(p?.foil);

      const rarityClass = rarity.toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const metaBits = [
        setCode ? `<span class="meta-pill">${setCode}</span>` : "",
        number ? `<span class="meta-pill">#${number}</span>` : "",
        rarity ? `<span class="meta-pill rarity-${rarityClass}">${rarity}</span>` : "",
        showFoil ? `<span class="meta-pill">Foil</span>` : "",
      ].filter(Boolean).join(" ");

      const card = document.createElement("div");
      card.className = "store-card";
      card.dataset.sku = sku;
      card.dataset.activeTab = "NM";

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
            ${TAB_ORDER.map(tab => `
              <button class="cond-tab${tab === "NM" ? " active" : ""}" type="button" data-tab="${tab}">
                ${tab}
              </button>
            `).join("")}
          </div>

          <div class="product-meta">
            <div>Buy Price: <strong class="priceText">$0.00</strong></div>
            <div>Max capacity: <strong class="maxText">0</strong></div>
            <div>In cart: <strong class="inCartText">0</strong> • Remaining: <strong class="remText">0</strong></div>
          </div>

          <div class="product-meta-pills">${metaBits}</div>

          <div class="qty-controls">
            <button class="qty-minus" type="button">−</button>
            <input class="qty-input" type="text" value="1" inputmode="numeric" />
            <button class="qty-plus" type="button">+</button>
          </div>

          <button class="addBtn" type="button">Add to Sell Order</button>
        </div>
      `;

      // initial paint
      refreshCard(card);

      gridEl.appendChild(card);
    }
  }

  // ---------- interactions (delegation) ----------
  document.addEventListener("click", (e) => {
    // image zoom
    const zoomImg = e.target.closest(".card-zoom-img");
    if (zoomImg) {
      const a = zoomImg.closest("a");
      if (a) { e.preventDefault(); e.stopPropagation(); }
      openModal(zoomImg.src);
      return;
    }

    const cardEl = e.target.closest(".store-card");
    if (!cardEl) return;

    const sku = String(cardEl.dataset.sku || "").trim();
    const p = selllist[sku];
    if (!p) return;

    // tab switch
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      cardEl.dataset.activeTab = normalizeTab(tabBtn.dataset.tab || "NM");
      refreshCard(cardEl);
      return;
    }

    const tab = normalizeTab(cardEl.dataset.activeTab || "NM");
    const qtyInput = cardEl.querySelector(".qty-input");

    // qty -
    if (e.target.closest(".qty-minus")) {
      const cur = clampQty(qtyInput?.value || 1);
      const next = Math.max(1, cur - 1);
      if (qtyInput) qtyInput.value = String(next);
      refreshCard(cardEl);
      return;
    }

    // qty +
    if (e.target.closest(".qty-plus")) {
      const cart = loadCart();
      const inCart = getCartQty(cart, sku, tab);
      const maxCap = getMaxFor(p, tab);
      const remaining = Math.max(0, maxCap - inCart);

      const cur = clampQty(qtyInput?.value || 1);
      const next = Math.min(cur + 1, Math.max(1, remaining));
      if (qtyInput) qtyInput.value = String(next);
      refreshCard(cardEl);
      return;
    }

    // add
    if (e.target.closest(".addBtn")) {
      const price = getPriceFor(p, tab);
      const maxCap = getMaxFor(p, tab);
      if (price <= 0 || maxCap <= 0) return;

      const cart = loadCart();
      const already = getCartQty(cart, sku, tab);
      const remaining = Math.max(0, maxCap - already);

      const desired = clampQty(qtyInput?.value || 1);
      const canAdd = Math.max(0, Math.min(desired, remaining));

      if (canAdd <= 0) {
        alert("You’ve reached the max capacity for that condition.");
        refreshCard(cardEl);
        return;
      }

      const name = String(p.name || sku);
      const nextQty = already + canAdd;
      const nextCart = setCartQty(cart, sku, name, tab, nextQty);

      saveCart(nextCart);

      if (qtyInput) qtyInput.value = "1";
      refreshCard(cardEl);
      return;
    }
  });

  // keep page in sync if cart changes elsewhere
  window.addEventListener("cart:changed", () => {
    document.querySelectorAll(".store-card").forEach(refreshCard);
  });

  // ---------- init ----------
  try {
    selllist = await fetchSellList();
  } catch (err) {
    console.error("sell.js selllist error:", err);
    gridEl.innerHTML = `<div class="cart-card" style="margin:16px;">Could not load sell list.</div>`;
    return;
  }

  ALL_ITEMS = Object.entries(selllist).map(([sku, item]) => ({ sku, ...item }));
  ALL_ITEMS.sort((a, b) => String(a.name || a.sku).localeCompare(String(b.name || b.sku)));

  // ✅ populate filters AFTER data loads
  populateSellFilters(selllist);

  // render now, and whenever filters/search change
  renderGrid();

  if (searchEl) searchEl.addEventListener("input", renderGrid);
  if (clearSearchEl) {
    clearSearchEl.addEventListener("click", () => {
      if (searchEl) searchEl.value = "";
      renderGrid();
      searchEl?.focus();
    });
  }
  if (rarityFilterEl) rarityFilterEl.addEventListener("change", renderGrid);
  if (setFilterEl) setFilterEl.addEventListener("change", renderGrid);

  if (typeof window.updateCartBadges === "function") window.updateCartBadges();
});
