document.addEventListener("DOMContentLoaded", () => {
  const GRID_ID = "sellGrid";
  const CART_KEY = "sellCart";

  // Page elements (sell.html)
  const gridEl = document.getElementById(GRID_ID);

  // Optional search UI (if you add these ids in your sell.html)
  const searchEl = document.getElementById("sellSearch");
  const clearSearchEl = document.getElementById("sellSearchClear");

  // Image modal (optional, but recommended)
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalClose = document.getElementById("imageModalClose");

  const TAB_ORDER = ["NM", "LP", "MP"];

  let selllist = {};        // sku -> item
  let ALL_ITEMS = [];       // [{sku, ...item}]
  let FILTERED_ITEMS = [];  // filtered list
  let searchQuery = "";

  // -------------------------
  // Helpers
  // -------------------------
  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function loadCart() {
    return safeParse(localStorage.getItem(CART_KEY) || "[]", []);
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    // ✅ notify badges + other pages
    window.dispatchEvent(new Event("cart:changed"));
    if (typeof window.updateCartBadges === "function") window.updateCartBadges();
  }

  function normalizeTab(t) {
    const u = String(t || "NM").toUpperCase();
    return TAB_ORDER.includes(u) ? u : "NM";
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    return encodeURI(s.startsWith("/") ? s : `/${s}`);
  }

  // stable key: sku if present, else fallback name
  function getItemKey(item) {
    const sku = String(item.sku || "").trim();
    if (sku) return sku;
    return `name:${String(item.name || "").trim().toLowerCase()}`;
  }

  // Sell cart stores condition as "NM"/"LP"/"MP"
  function condFromCart(item) {
    return normalizeTab(item.condition);
  }

  function clampQty(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 1) return 1;
    if (x > 999) return 999;
    return Math.floor(x);
  }

  function getPriceFor(item, tab) {
    const t = normalizeTab(tab);
    const p = Number(item?.prices?.[t] ?? 0);
    return Number.isFinite(p) ? p : 0;
  }

  function getMaxFor(item, tab) {
    const t = normalizeTab(tab);
    const m = Number(item?.max?.[t] ?? 0);
    return Number.isFinite(m) ? m : 0;
  }

  function getCartQtyForKeyCond(cart, key, tab) {
    const t = normalizeTab(tab);
    let sum = 0;
    for (const it of cart) {
      if (getItemKey(it) !== key) continue;
      if (condFromCart(it) === t) sum += Math.max(0, Number(it.qty || 0));
    }
    return sum;
  }

  function setQtyForKeyCond(key, tab, nextQty) {
    const t = normalizeTab(tab);
    const q = Math.max(0, Number(nextQty || 0));

    let cart = loadCart();

    // remove existing line(s) for this key/tab
    cart = cart.filter((it) => !(getItemKey(it) === key && condFromCart(it) === t));

    if (q > 0) {
      if (key.startsWith("name:")) {
        cart.push({ name: key.slice(5), condition: t, qty: q });
      } else {
        const item = selllist[key];
        const name = item?.name || key;
        cart.push({ sku: key, name, condition: t, qty: q });
      }
    }

    saveCart(cart);
  }

  // -------------------------
  // Image Modal
  // -------------------------
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

  // -------------------------
  // API
  // -------------------------
  async function fetchSellList() {
    const res = await fetch("/api/selllist", { cache: "no-store" });
    if (!res.ok) throw new Error(`selllist HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.selllist) throw new Error("Bad selllist JSON");
    return data.selllist;
  }

  // -------------------------
  // Search
  // -------------------------
  function applySearch() {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      FILTERED_ITEMS = ALL_ITEMS.slice();
    } else {
      FILTERED_ITEMS = ALL_ITEMS.filter((it) => {
        const name = String(it.name || "").toLowerCase();
        const sku = String(it.sku || "").toLowerCase();
        return name.includes(q) || sku.includes(q);
      });
    }
    renderGrid();
  }

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      searchQuery = searchEl.value || "";
      applySearch();
    });
  }

  if (clearSearchEl) {
    clearSearchEl.addEventListener("click", () => {
      searchQuery = "";
      if (searchEl) searchEl.value = "";
      applySearch();
      searchEl?.focus();
    });
  }

  // -------------------------
  // Render Grid (SELL)
  // -------------------------
  function renderGrid() {
    if (!gridEl) return;

    const items = (FILTERED_ITEMS.length ? FILTERED_ITEMS : ALL_ITEMS);

    gridEl.innerHTML = "";

    if (!items.length) {
      gridEl.innerHTML = `<p style="padding:16px;">No cards found.</p>`;
      return;
    }

    for (const p of items) {
      const sku = p.sku;
      const name = p.name || sku;
      const imgSrc = normalizeImagePath(p.image);

      const card = document.createElement("div");
      card.className = "product-card";          // ✅ shared card styling
      card.dataset.sku = sku;
      card.dataset.activeTab = "NM";

      const unit = getPriceFor(p, "NM");
      const maxCap = getMaxFor(p, "NM");

      // initial cart qty for this sku/cond
      const cart = loadCart();
      const inCart = getCartQtyForKeyCond(cart, sku, "NM");
      const remaining = Math.max(0, maxCap - inCart);

      card.innerHTML = `
        ${imgSrc ? `<img class="sell-card-img" src="${imgSrc}" alt="${name}" />` : ""}

        <h3 class="product-title">${name}</h3>

        <div class="cond-tabs" role="tablist" aria-label="Condition">
          ${TAB_ORDER.map((t) => `
            <button class="cond-tab${t === "NM" ? " active" : ""}" type="button" data-tab="${t}">
              ${t}
            </button>
          `).join("")}
        </div>

        <div class="product-meta">
          <div>Buy Price: <strong class="sell-price">$${unit.toFixed(2)}</strong></div>
          <div>
            Max capacity: <strong class="sell-max">${maxCap}</strong> •
            In cart: <strong class="sell-incart">${inCart}</strong> •
            Remaining: <strong class="sell-remain">${remaining}</strong>
          </div>
        </div>

        <div class="qty-row">
          <button class="qty-btn qty-minus" type="button">−</button>
          <input class="qty-input" type="number" min="1" max="999" value="1" />
          <button class="qty-btn qty-plus" type="button">+</button>
        </div>

        <button class="primary-btn sell-add-btn" type="button">Add to Sell Order</button>
      `;

      // click image to zoom
      const imgEl = card.querySelector("img");
      if (imgEl) {
        imgEl.style.cursor = "zoom-in";
        imgEl.addEventListener("click", () => openModal(imgEl.getAttribute("src")));
      }

      gridEl.appendChild(card);
    }
  }

  function refreshSellCardUI(cardEl) {
    const sku = String(cardEl.dataset.sku || "");
    const item = selllist[sku];
    if (!item) return;

    const tab = normalizeTab(cardEl.dataset.activeTab || "NM");

    const price = getPriceFor(item, tab);
    const maxCap = getMaxFor(item, tab);

    const cart = loadCart();
    const inCart = getCartQtyForKeyCond(cart, sku, tab);
    const remaining = Math.max(0, maxCap - inCart);

    const priceEl = cardEl.querySelector(".sell-price");
    const maxEl = cardEl.querySelector(".sell-max");
    const inCartEl = cardEl.querySelector(".sell-incart");
    const remEl = cardEl.querySelector(".sell-remain");

    if (priceEl) priceEl.textContent = `$${price.toFixed(2)}`;
    if (maxEl) maxEl.textContent = String(maxCap);
    if (inCartEl) inCartEl.textContent = String(inCart);
    if (remEl) remEl.textContent = String(remaining);
  }

  // -------------------------
  // Click handling (tabs, qty, add)
  // -------------------------
  document.addEventListener("click", (e) => {
    const cardEl = e.target.closest(".product-card");
    if (!cardEl) return;

    const sku = String(cardEl.dataset.sku || "");
    const item = selllist[sku];
    if (!item) return;

    // tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      const tab = normalizeTab(tabBtn.dataset.tab || "NM");
      cardEl.dataset.activeTab = tab;

      // active class
      cardEl.querySelectorAll(".cond-tab").forEach((b) => b.classList.remove("active"));
      tabBtn.classList.add("active");

      refreshSellCardUI(cardEl);
      return;
    }

    const qtyInput = cardEl.querySelector(".qty-input");

    // qty -
    if (e.target.closest(".qty-minus")) {
      const cur = clampQty(qtyInput?.value || 1);
      const next = Math.max(1, cur - 1);
      if (qtyInput) qtyInput.value = String(next);
      return;
    }

    // qty +
    if (e.target.closest(".qty-plus")) {
      const cur = clampQty(qtyInput?.value || 1);
      const next = Math.min(999, cur + 1);
      if (qtyInput) qtyInput.value = String(next);
      return;
    }

    // add to sell cart
    if (e.target.closest(".sell-add-btn")) {
      const tab = normalizeTab(cardEl.dataset.activeTab || "NM");
      const desired = clampQty(qtyInput?.value || 1);

      const maxCap = getMaxFor(item, tab);
      const cart = loadCart();
      const inCart = getCartQtyForKeyCond(cart, sku, tab);
      const remaining = Math.max(0, maxCap - inCart);

      const toAdd = Math.min(desired, remaining);
      if (toAdd <= 0) {
        alert("You’ve reached the max capacity for that condition.");
        return;
      }

      // merge into existing line
      const idx = cart.findIndex((it) => String(it.sku || "") === sku && condFromCart(it) === tab);
      if (idx >= 0) {
        cart[idx].qty = Math.max(1, Number(cart[idx].qty || 0) + toAdd);
      } else {
        cart.push({ sku, name: item.name || sku, condition: tab, qty: toAdd });
      }

      saveCart(cart);
      refreshSellCardUI(cardEl);
      return;
    }
  });

  // Keep cards in sync if cart changes from another tab/page
  window.addEventListener("cart:changed", () => {
    document.querySelectorAll(".product-card").forEach(refreshSellCardUI);
  });

  // -------------------------
  // Init
  // -------------------------
  (async function init() {
    try {
      selllist = await fetchSellList();
    } catch (err) {
      console.error("sell.js selllist error:", err);
      if (gridEl) gridEl.innerHTML = `<p style="padding:16px;">Could not load sell list.</p>`;
      return;
    }

    ALL_ITEMS = Object.entries(selllist).map(([sku, item]) => ({ sku, ...item }));
    ALL_ITEMS.sort((a, b) => String(a.name || a.sku).localeCompare(String(b.name || b.sku)));

    FILTERED_ITEMS = ALL_ITEMS.slice();
    renderGrid();

    // initial badge refresh
    if (typeof window.updateCartBadges === "function") window.updateCartBadges();
  })();
});










