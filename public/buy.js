document.addEventListener("DOMContentLoaded", () => {
  const GRID_ID = "buyGrid";
  const CART_KEY = "buyCart";

  // Page elements (buy.html)
  const gridEl = document.getElementById(GRID_ID);
  const searchEl = document.getElementById("buySearch");
  const clearSearchEl = document.getElementById("buySearchClear");

  let ALL_ITEMS = [];      // full list (unfiltered)
  let FILTERED_ITEMS = []; // items after search
  let searchQuery = "";

  // Mini cart elements (buy.html)
  const miniCountEl = document.getElementById("miniCartCount");
  const miniSubtotalEl = document.getElementById("miniCartSubtotal");
  const miniItemsEl = document.getElementById("miniCartItems");
  const miniCheckoutBtn = document.getElementById("miniCartCheckoutBtn");

  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played",
  };

  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65,
  };

  let catalog = {}; // sku -> product

// IMAGE MODAL ZOOM HANDLING
const modal = document.getElementById("imageModal");
const modalImg = document.getElementById("imageModalImg");
const modalClose = document.getElementById("imageModalClose");

function openModal(src){
  if (!modal || !modalImg) return;
  modalImg.src = src;
  modal.classList.remove("hidden");
}

function closeModal(){
  if (!modal) return;
  modal.classList.add("hidden");
  modalImg.src = "";
}

// close buttons
if (modalClose) modalClose.addEventListener("click", closeModal);
if (modal) modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// card image click → zoom
document.addEventListener("click", (e) => {
  const imgEl = e.target.closest(".card-zoom-img");
  if (!imgEl) return;
  openModal(imgEl.src);
});

  // -------------------------
  // Helpers
  // -------------------------
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
  localStorage.setItem("buyCart", JSON.stringify(cart));

  // 🔔 notify header badges + mini cart
  window.dispatchEvent(new Event("cart:changed"));
}


  function moneyFromCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function normalizeCondition(cond) {
    const allowed = Object.keys(CONDITION_MULT);
    const s = String(cond || "Near Mint").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function unitCentsFor(product, condition) {
    const base = Number(product?.price_cents || 0);
    const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
    return Math.round(base * mult);
  }

  function getStockFor(product, condition) {
    const c = normalizeCondition(condition);
    if (product?.stock && typeof product.stock === "object") {
      return Number(product.stock[c] ?? 0);
    }
    return Number(product?.stock ?? 0);
  }

  function tabToCondition(tab) {
    return TAB_TO_COND[String(tab || "NM").toUpperCase()] || "Near Mint";
  }

  function clampQty(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 1) return 1;
    if (x > 999) return 999;
    return Math.floor(x);
  }

  function getCartQtyForSkuCond(cart, sku, cond) {
    return cart.reduce((sum, it) => {
      if (
        String(it.sku || "") === sku &&
        normalizeCondition(it.condition) === normalizeCondition(cond)
      ) {
        return sum + Math.max(0, Number(it.qty || 0));
      }
      return sum;
    }, 0);
  }

  // -------------------------
  // API
  // -------------------------
  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.catalog) throw new Error("Bad catalog JSON");
    return data.catalog;
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
    renderGrid(); // ✅ renders filtered list
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
  // Render Buy Grid (✅ uses FILTERED_ITEMS)
  // -------------------------
  function renderGrid() {
    if (!gridEl) return;

    const items = FILTERED_ITEMS;

    gridEl.innerHTML = "";

    for (const p of items) {
      const sku = p.sku;
      const name = p.name || sku;
      const img = p.image ? (String(p.image).startsWith("/") ? p.image : "/" + p.image) : "";
      const defaultTab = "NM";
      const defaultCond = tabToCondition(defaultTab);
      const price = unitCentsFor(p, defaultCond);

      const card = document.createElement("div");
      card.className = "buy-card";
      card.dataset.sku = sku;
      card.dataset.activeTab = defaultTab;

      card.innerHTML = `
        <div class="buy-card-inner">
         ${img ? `<img class="buy-card-img" src="${encodeURI(img)}" alt="${name}" data-zoom="1" />` : ""}


          <h3 class="buy-card-title">${name}</h3>

          <div class="cond-tabs buy-cond-tabs" role="tablist" aria-label="Condition">
            ${TAB_ORDER
              .map(
                (t) =>
                  `<button class="cond-tab${
                    t === defaultTab ? " active" : ""
                  }" type="button" data-tab="${t}">${t}</button>`
              )
              .join("")}
          </div>

          <div class="buy-card-meta">
            <div>Price: <strong class="buy-unit">${moneyFromCents(price)}</strong></div>
            <div>In stock: <strong class="buy-stock">${getStockFor(p, defaultCond)}</strong></div>
          </div>

          <div class="buy-qty-row">
            <button class="qty-minus" type="button">−</button>
            <input class="qty-input" type="number" min="1" max="999" value="1" />
            <button class="qty-plus" type="button">+</button>
          </div>

          <button class="buy-add-btn" type="button">Add to Buy Cart</button>
        </div>
      `;

      gridEl.appendChild(card);
    }
  }

  function refreshCardUI(cardEl) {
    const sku = String(cardEl.dataset.sku || "");
    const p = catalog[sku];
    if (!p) return;

    const tab = String(cardEl.dataset.activeTab || "NM").toUpperCase();
    const cond = tabToCondition(tab);

    const unit = unitCentsFor(p, cond);
    const stock = getStockFor(p, cond);

    const unitEl = cardEl.querySelector(".buy-unit");
    const stockEl = cardEl.querySelector(".buy-stock");
    if (unitEl) unitEl.textContent = moneyFromCents(unit);
    if (stockEl) stockEl.textContent = String(stock);
  }

  // -------------------------
  // Mini cart (right sidebar)
  // -------------------------
  function buildMiniCartLines(cart) {
    const map = new Map();
    for (const it of cart) {
      const sku = String(it.sku || "").trim();
      if (!sku) continue;
      const cond = normalizeCondition(it.condition);
      const qty = Math.max(0, Number(it.qty || 0));
      if (qty <= 0) continue;

      const key = `${sku}||${cond}`;
      map.set(key, (map.get(key) || 0) + qty);
    }

    const lines = [];
    for (const [key, qty] of map.entries()) {
      const [sku, cond] = key.split("||");
      const product = catalog[sku];
      const name = product?.name || sku;
      const unitCents = product ? unitCentsFor(product, cond) : 0;
      lines.push({
        sku,
        name,
        cond,
        qty,
        unitCents,
        lineCents: unitCents * qty,
      });
    }

    lines.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return lines;
  }

  function renderMiniCart() {
    const cart = loadCart();
    const lines = buildMiniCartLines(cart);

    const count = lines.reduce((s, l) => s + l.qty, 0);
    const subtotalCents = lines.reduce((s, l) => s + l.lineCents, 0);

    if (miniCountEl) miniCountEl.textContent = String(count);
    if (miniSubtotalEl) miniSubtotalEl.textContent = (subtotalCents / 100).toFixed(2);

    if (miniItemsEl) {
      miniItemsEl.innerHTML = "";

      if (!lines.length) {
        miniItemsEl.innerHTML = `<li class="mini-empty">Cart is empty.</li>`;
      } else {
        for (const l of lines.slice(0, 8)) {
          const li = document.createElement("li");
          li.className = "mini-line";
          li.innerHTML = `
            <div class="mini-line-name">${l.name}</div>
            <div class="mini-line-sub">
              ${l.qty} × ${l.cond} — ${moneyFromCents(l.lineCents)}
            </div>
          `;
          miniItemsEl.appendChild(li);
        }

        if (lines.length > 8) {
          const li = document.createElement("li");
          li.className = "mini-more";
          li.textContent = `+ ${lines.length - 8} more…`;
          miniItemsEl.appendChild(li);
        }
      }
    }
  }

  // -------------------------
  // Event delegation: tabs, qty, add
  // -------------------------
  document.addEventListener("click", (e) => {
    const cardEl = e.target.closest(".buy-card");
    if (!cardEl) return;

    const sku = String(cardEl.dataset.sku || "");
    const product = catalog[sku];
    if (!product) return;

    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      const tab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      cardEl.dataset.activeTab = TAB_TO_COND[tab] ? tab : "NM";

      cardEl.querySelectorAll(".cond-tab").forEach((b) => b.classList.remove("active"));
      tabBtn.classList.add("active");

      refreshCardUI(cardEl);
      return;
    }

    const qtyInput = cardEl.querySelector(".qty-input");

    if (e.target.closest(".qty-minus")) {
      const cur = clampQty(qtyInput?.value || 1);
      const next = Math.max(1, cur - 1);
      if (qtyInput) qtyInput.value = String(next);
      return;
    }

    if (e.target.closest(".qty-plus")) {
      const cur = clampQty(qtyInput?.value || 1);
      const next = Math.min(999, cur + 1);
      if (qtyInput) qtyInput.value = String(next);
      return;
    }

    if (e.target.closest(".buy-add-btn")) {
      const tab = String(cardEl.dataset.activeTab || "NM").toUpperCase();
      const cond = tabToCondition(tab);
      const desiredQty = clampQty(qtyInput?.value || 1);

      const stock = getStockFor(product, cond);
      const cart = loadCart();
      const already = getCartQtyForSkuCond(cart, sku, cond);

      let canAdd = desiredQty;
      if (stock > 0) {
        canAdd = Math.max(0, Math.min(desiredQty, stock - already));
      }

      if (canAdd <= 0) {
        alert("No more stock available for that condition.");
        return;
      }

      const idx = cart.findIndex(
        (it) =>
          String(it.sku || "") === sku &&
          normalizeCondition(it.condition) === normalizeCondition(cond)
      );

      if (idx >= 0) {
        cart[idx].qty = Math.max(1, Number(cart[idx].qty || 0) + canAdd);
      } else {
        cart.push({ sku, condition: cond, qty: canAdd });
      }

      saveCart(cart);
      renderMiniCart();
      return;
    }
  });

  if (miniCheckoutBtn) {
    miniCheckoutBtn.addEventListener("click", () => {
      window.location.href = "/buy-cart.html";
    });
  }

  window.addEventListener("cart:changed", () => {
    renderMiniCart();
  });

  // -------------------------
  // Init
  // -------------------------
  (async function init() {
    try {
      catalog = await fetchCatalog();
    } catch (err) {
      console.error("buy.js catalog error:", err);
      if (gridEl) gridEl.innerHTML = `<p style="padding:16px;">Could not load catalog.</p>`;
      catalog = {};
      return;
    }

    // ✅ Build items once
    ALL_ITEMS = Object.entries(catalog).map(([sku, product]) => ({
      sku,
      ...product,
    }));

    // optional: sort by name
    ALL_ITEMS.sort((a, b) =>
      String(a.name || a.sku).localeCompare(String(b.name || b.sku))
    );

    // ✅ default filtered = all
    FILTERED_ITEMS = ALL_ITEMS.slice();

    renderGrid();
    renderMiniCart();
    if (typeof window.updateCartBadges === "function") window.updateCartBadges();
  })();
});

