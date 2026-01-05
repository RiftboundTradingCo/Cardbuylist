document.addEventListener("DOMContentLoaded", async () => {
  const GRID_ID = "sellGrid";
  const CART_KEY = "sellCart";

  const gridEl = document.getElementById(GRID_ID);
  const searchEl = document.getElementById("sellSearch");
  const clearSearchEl = document.getElementById("sellSearchClear");

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
  if (modal) modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

  // IMPORTANT: prevent links from navigating to the image
    document.addEventListener("click", (e) => {
    // Change ".card-img" to whatever class your sell page uses for card images
    const img = e.target.closest(".card-img, .card-zoom-img, img[data-zoom]");
    if (!img) return;

    // If the image is inside <a href="...">, prevent navigation
    const a = img.closest("a");
    if (a) {
      e.preventDefault();
      e.stopPropagation();
  }

  openModal(img.src);
});

  // ---------- helpers ----------
  function safeParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function loadCart() {
    return safeParse(localStorage.getItem(CART_KEY) || "[]", []);
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    // ✅ badges + cross-page sync
    window.dispatchEvent(new Event("cart:changed"));
    if (typeof window.updateCartBadges === "function") window.updateCartBadges();
  }

  function normalizeTab(t) {
    const u = String(t || "NM").toUpperCase();
    return TAB_ORDER.includes(u) ? u : "NM";
  }

  // identify item by sku if present, else by name
  function getItemKey(item) {
    const sku = String(item.sku || "").trim();
    if (sku) return sku;
    return `name:${String(item.name || "").trim().toLowerCase()}`;
  }

  function money(n) {
    return `$${Number(n || 0).toFixed(2)}`;
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    return encodeURI(s.startsWith("/") ? s : `/${s}`);
  }

  function getCartQty(cart, sku, tab) {
    const t = normalizeTab(tab);
    return cart.reduce((sum, it) => {
      if (String(it.sku || "") !== sku) return sum;
      if (normalizeTab(it.condition) !== t) return sum;
      return sum + Math.max(0, Number(it.qty || 0));
    }, 0);
  }

  function setCartQty(cart, sku, name, tab, qty) {
    const t = normalizeTab(tab);
    const q = Math.max(0, Number(qty || 0));

    // remove existing line for sku+tab
    let next = cart.filter(
      (it) => !(String(it.sku || "") === sku && normalizeTab(it.condition) === t)
    );

    // add consolidated line if q>0
    if (q > 0) next.push({ sku, name, condition: t, qty: q });

    return next;
  }

  // ---------- data ----------
  async function fetchSellList() {
    const res = await fetch("/api/selllist", { cache: "no-store" });
    if (!res.ok) throw new Error(`selllist HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.selllist) throw new Error("Bad selllist JSON");
    return data.selllist;
  }

  let selllist = {};
  let ALL_ITEMS = [];
  let FILTERED_ITEMS = [];
  let searchQuery = "";

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

  // ---------- render ----------
  function renderGrid() {
    const items = FILTERED_ITEMS.length ? FILTERED_ITEMS : ALL_ITEMS;

    gridEl.innerHTML = "";

    for (const p of items) {
      const sku = p.sku;
      const name = p.name || sku;
      const imgSrc = normalizeImagePath(p.image);

      const defaultTab = "NM";
      const price = Number(p?.prices?.[defaultTab] ?? 0);
      const maxCap = Number(p?.max?.[defaultTab] ?? 0);

      const card = document.createElement("div");
      card.className = "buy-card sell-card"; // reuse your buy-card styling
      card.dataset.sku = sku;
      card.dataset.activeTab = defaultTab;

      card.innerHTML = `
        <div class="buy-card-inner">
          ${
            imgSrc
              ? `<img class="buy-card-img sell-card-img" src="${imgSrc}" alt="${name}" />`
              : ""
          }

          <h3 class="buy-card-title">${name}</h3>

          <div class="cond-tabs buy-cond-tabs" role="tablist" aria-label="Condition">
            ${TAB_ORDER.map(
              (t) =>
                `<button class="cond-tab${t === defaultTab ? " active" : ""}" type="button" data-tab="${t}">${t}</button>`
            ).join("")}
          </div>

          <div class="buy-card-meta">
            <div>Buy Price: <strong class="sell-unit">${money(price)}</strong></div>
            <div>Max capacity: <strong class="sell-max">${Number.isFinite(maxCap) ? maxCap : 0}</strong></div>
            <div>In cart: <strong class="sell-incart">0</strong> • Remaining: <strong class="sell-remain">0</strong></div>
          </div>

          <div class="buy-qty-row">
            <button class="qty-minus" type="button">−</button>
            <input class="qty-input" type="number" min="1" max="999" value="1" />
            <button class="qty-plus" type="button">+</button>
          </div>

          <button class="buy-add-btn sell-add-btn" type="button">Add to Sell Order</button>
        </div>
      `;

      // init cart stats
      refreshCardCartStats(card);

      // click image to zoom
      const imgEl = card.querySelector(".sell-card-img");
      if (imgEl) imgEl.addEventListener("click", () => openModal(imgEl.getAttribute("src")));

      gridEl.appendChild(card);
    }
  }

  function refreshCardUI(cardEl) {
    const sku = String(cardEl.dataset.sku || "");
    const p = selllist[sku];
    if (!p) return;

    const tab = normalizeTab(cardEl.dataset.activeTab || "NM");

    // update active tab styling
    cardEl.querySelectorAll(".cond-tab").forEach((b) => b.classList.remove("active"));
    const activeBtn = cardEl.querySelector(`.cond-tab[data-tab="${tab}"]`);
    if (activeBtn) activeBtn.classList.add("active");

    const price = Number(p?.prices?.[tab] ?? 0);
    const maxCap = Number(p?.max?.[tab] ?? 0);

    const unitEl = cardEl.querySelector(".sell-unit");
    const maxEl = cardEl.querySelector(".sell-max");
    if (unitEl) unitEl.textContent = money(price);
    if (maxEl) maxEl.textContent = String(Number.isFinite(maxCap) ? maxCap : 0);

    refreshCardCartStats(cardEl);
  }

  function refreshCardCartStats(cardEl) {
    const sku = String(cardEl.dataset.sku || "");
    const p = selllist[sku];
    if (!p) return;

    const tab = normalizeTab(cardEl.dataset.activeTab || "NM");
    const cart = loadCart();

    const inCart = getCartQty(cart, sku, tab);
    const maxCap = Number(p?.max?.[tab] ?? 0);
    const remaining = Math.max(0, maxCap - inCart);

    const inCartEl = cardEl.querySelector(".sell-incart");
    const remainEl = cardEl.querySelector(".sell-remain");
    if (inCartEl) inCartEl.textContent = String(inCart);
    if (remainEl) remainEl.textContent = String(remaining);

    // optional: disable Add if none left
    const addBtn = cardEl.querySelector(".sell-add-btn");
    if (addBtn) addBtn.disabled = maxCap > 0 ? remaining <= 0 : true;
  }

  function clampQty(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 1) return 1;
    if (x > 999) return 999;
    return Math.floor(x);
  }

  // ---------- interactions ----------
  document.addEventListener("click", (e) => {
    const cardEl = e.target.closest(".sell-card");
    if (!cardEl) return;

    const sku = String(cardEl.dataset.sku || "");
    const p = selllist[sku];
    if (!p) return;

    // tab switch
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      cardEl.dataset.activeTab = normalizeTab(tabBtn.dataset.tab || "NM");
      refreshCardUI(cardEl);
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

      const maxCap = Number(p?.max?.[tab] ?? 0);
      const cart = loadCart();
      const already = getCartQty(cart, sku, tab);

      // clamp so we never exceed max capacity
      let canAdd = desired;
      if (maxCap > 0) canAdd = Math.max(0, Math.min(desired, maxCap - already));

      if (canAdd <= 0) {
        alert("You’ve reached the max capacity for that condition.");
        return;
      }

      const name = p.name || sku;
      const nextQty = already + canAdd;
      const nextCart = setCartQty(cart, sku, name, tab, nextQty);

      saveCart(nextCart);
      refreshCardCartStats(cardEl);
      return;
    }
  });

  // keep page in sync if cart changes elsewhere
  window.addEventListener("cart:changed", () => {
    document.querySelectorAll(".sell-card").forEach(refreshCardCartStats);
  });

  // ---------- init ----------
  try {
    selllist = await fetchSellList();
  } catch (err) {
    console.error("sell.js selllist error:", err);
    gridEl.innerHTML = `<p style="padding:16px;">Could not load sell list.</p>`;
    selllist = {};
    return;
  }

  ALL_ITEMS = Object.entries(selllist).map(([sku, item]) => ({ sku, ...item }));
  ALL_ITEMS.sort((a, b) => String(a.name || a.sku).localeCompare(String(b.name || b.sku)));
  FILTERED_ITEMS = ALL_ITEMS.slice();

  applySearch();

  if (typeof window.updateCartBadges === "function") window.updateCartBadges();
});










