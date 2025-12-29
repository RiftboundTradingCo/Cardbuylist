(() => {
  console.log("BUY.JS LOADED ✅");

  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played"
  };

  // -----------------------------
  // Per-condition qty storage on each card
  // -----------------------------
  function qtyKeyForTab(tab) {
    const t = String(tab || "NM").toUpperCase();
    if (t === "NM") return "qtyNm";
    if (t === "LP") return "qtyLp";
    if (t === "MP") return "qtyMp";
    return "qtyHp";
  }

  function getStoredQty(card) {
    const tab = String(card.dataset.activeTab || "NM").toUpperCase();
    const key = qtyKeyForTab(tab);
    const n = Number(card.dataset[key] || 1);
    return Math.max(1, Number.isFinite(n) ? n : 1);
  }

  function setStoredQty(card, qty) {
    const tab = String(card.dataset.activeTab || "NM").toUpperCase();
    const key = qtyKeyForTab(tab);
    const clean = Math.max(1, Number(qty) || 1);

    card.dataset[key] = String(clean);

    const qtyInput = card.querySelector(".qty-input");
    const qtyNum = card.querySelector(".qty-num");
    if (qtyInput) qtyInput.value = String(clean);
    if (qtyNum) qtyNum.textContent = String(clean);
  }
document.addEventListener("DOMContentLoaded", () => {
  const miniCount = document.getElementById("miniCartCount");
  const miniSubtotal = document.getElementById("miniCartSubtotal");
  const miniItems = document.getElementById("miniCartItems");
  const miniCheckoutBtn = document.getElementById("miniCartCheckoutBtn");

  if (!miniCount || !miniSubtotal || !miniItems) return;

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

  function normalizeCondition(c) {
    const s = String(c || "Near Mint").trim();
    return CONDITION_MULT[s] ? s : "Near Mint";
  }

  function calcUnitCents(baseCents, condition) {
    const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }

  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function loadCart() {
    try { return JSON.parse(localStorage.getItem("buyCart")) || []; }
    catch { return []; }
  }

  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    const data = await res.json();
    return data?.catalog || {};
  }

  // group same SKU+condition
  function groupLines(cart) {
    const m = new Map(); // key => { sku, condition, qty }
    for (const it of cart) {
      const sku = String(it.sku || "").trim();
      if (!sku) continue;

      const condRaw = String(it.condition || "").trim();
      const cond = TAB_TO_COND[condRaw] ? TAB_TO_COND[condRaw] : normalizeCondition(condRaw);
      const qty = Math.max(1, Number(it.qty || 1));

      const key = `${sku}__${cond}`;
      if (!m.has(key)) m.set(key, { sku, condition: cond, qty: 0 });
      m.get(key).qty += qty;
    }
    return [...m.values()];
  }

  async function renderMiniCart() {
    const cart = loadCart();
    const catalog = await fetchCatalog();

    const lines = groupLines(cart);

    let totalQty = 0;
    let totalCents = 0;

    miniItems.innerHTML = "";

    for (const line of lines) {
      const product = catalog[line.sku];
      if (!product) continue;

      const name = product.name || line.sku;
      const baseCents = Number(product.price_cents || 0);
      const unitCents = calcUnitCents(baseCents, line.condition);
      const lineCents = unitCents * line.qty;

      totalQty += line.qty;
      totalCents += lineCents;

      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <div class="mini-cart-item-title">${name}</div>
          <div class="mini-cart-item-sub">${line.qty} × ${line.condition}</div>
        </div>
        <div class="mini-cart-item-price">${money(lineCents)}</div>
      `;
      miniItems.appendChild(li);
    }

    miniCount.textContent = String(totalQty);
    miniSubtotal.textContent = (totalCents / 100).toFixed(2);

    if (miniCheckoutBtn) {
      miniCheckoutBtn.disabled = totalQty === 0;
    }
  }

  // click goes to cart page checkout area
  if (miniCheckoutBtn) {
    miniCheckoutBtn.addEventListener("click", () => {
      window.location.href = "/buy-cart.html";
    });
  }

  // render now + when cart changes
  renderMiniCart();
  window.addEventListener("cart:changed", renderMiniCart);
});

  // -----------------------------
  // Cart + stock helpers
  // -----------------------------
  function normalizeCondition(c) {
    const allowed = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"];
    const s = String(c || "Near Mint").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function loadCart() {
    try { return JSON.parse(localStorage.getItem("buyCart")) || []; } catch { return []; }
  }
function saveCart(cart) {
  localStorage.setItem("buyCart", JSON.stringify(cart));

  // tell badge script in THIS tab
  window.dispatchEvent(new Event("cart:changed"));

  // optional direct call if available
  if (typeof window.updateCartBadges === "function") window.updateCartBadges();
}

  function cartQtyFor(cart, sku, condition) {
    const cond = normalizeCondition(condition);
    return cart
      .filter(i => i.sku === sku && normalizeCondition(i.condition) === cond)
      .reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  }

  function stockForCard(card, tab) {
    const t = String(tab || "NM").toUpperCase();
    if (t === "NM") return Number(card.dataset.stockNm || 0);
    if (t === "LP") return Number(card.dataset.stockLp || 0);
    if (t === "MP") return Number(card.dataset.stockMp || 0);
    return Number(card.dataset.stockHp || 0);
  }

  function multiplierFor(cond) {
    if (cond === "Near Mint") return 1.0;
    if (cond === "Lightly Played") return 0.9;
    if (cond === "Moderately Played") return 0.8;
    return 0.65;
  }

  function clampQtyToAvailable(card) {
    const sku = String(card.dataset.sku || "").trim();
    if (!sku) return;

    const tab = String(card.dataset.activeTab || "NM").toUpperCase();
    const cond = normalizeCondition(card.dataset.activeCond || TAB_TO_COND[tab] || "Near Mint");
    const stock = stockForCard(card, tab);

    const cart = loadCart();
    const already = cartQtyFor(cart, sku, cond);
    const available = Math.max(0, stock - already);

    const plusBtn = card.querySelector(".qty-plus");
    const minusBtn = card.querySelector(".qty-minus");
    const addBtn = card.querySelector(".add-to-cart-btn");

    let qty = getStoredQty(card);

    if (available <= 0) {
      setStoredQty(card, 1);
      if (plusBtn) plusBtn.disabled = true;
      if (minusBtn) minusBtn.disabled = true;
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = "Max in Cart"; }
      return;
    }

    qty = Math.min(qty, available);
    setStoredQty(card, qty);

    if (plusBtn) plusBtn.disabled = qty >= available;
    if (minusBtn) minusBtn.disabled = qty <= 1;
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = "Add to Cart"; }
  }

  function setActiveTab(card, tab) {
    const t = String(tab || "NM").toUpperCase();
    const cond = TAB_TO_COND[t];
    if (!cond) return;

    if (stockForCard(card, t) <= 0) return;

    card.dataset.activeTab = t;
    card.dataset.activeCond = cond;

    // Update tab UI
    card.querySelectorAll(".cond-tab").forEach((b) => {
      b.classList.toggle("active", (b.dataset.tab || "").toUpperCase() === t);
    });

    // Load per-condition qty for this tab (default 1 if not set)
    if (!card.dataset[qtyKeyForTab(t)]) card.dataset[qtyKeyForTab(t)] = "1";
    setStoredQty(card, getStoredQty(card));

    // Update stock label
    const stockNum = card.querySelector(".stock-num");
    if (stockNum) stockNum.textContent = String(stockForCard(card, t));

    // Update price label
    const base = Number(card.dataset.basecents || 0);
    const unitCents = Math.round(base * multiplierFor(cond));
    card.dataset.unitCents = String(unitCents);

    const unitPriceEl = card.querySelector(".unit-price");
    if (unitPriceEl) unitPriceEl.textContent = `$${(unitCents / 100).toFixed(2)}`;

    clampQtyToAvailable(card);
  }

  // -----------------------------
  // DOM ready: search + init cards
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const buySearch = document.getElementById("buySearch");
    const grid = document.getElementById("storeGrid");
    if (!grid) return;

    // Search
    if (buySearch) {
      buySearch.addEventListener("input", () => {
        const q = buySearch.value.toLowerCase().trim();
        grid.querySelectorAll(".store-card").forEach((card) => {
          const name = String(card.dataset.name || "").toLowerCase();
          card.style.display = !q || name.includes(q) ? "" : "none";
        });
      });
    }

    // Initialize new cards (buy-render renders async)
    const initCard = (card) => {
      if (!card || card.dataset._inited === "1") return;
      card.dataset._inited = "1";

      const enabledTab =
        card.querySelector('.cond-tab[aria-disabled="false"]') ||
        card.querySelector(".cond-tab:not(.disabled)") ||
        card.querySelector(".cond-tab");

      if (enabledTab) setActiveTab(card, enabledTab.dataset.tab || "NM");
      clampQtyToAvailable(card);
    };

    grid.querySelectorAll(".store-card").forEach(initCard);

    const obs = new MutationObserver(() => {
      grid.querySelectorAll(".store-card").forEach(initCard);
    });
    obs.observe(grid, { childList: true, subtree: true });

    console.log("buy.js: listeners ready ✅");
  });

  // -----------------------------
  // Click handling (delegation)
  // -----------------------------
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".store-card");
    if (!card) return;

    // Tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;
      setActiveTab(card, tabBtn.dataset.tab);
      return;
    }

    // +
    if (e.target.closest(".qty-plus")) {
      setStoredQty(card, getStoredQty(card) + 1);
      clampQtyToAvailable(card);
      return;
    }

    // -
    if (e.target.closest(".qty-minus")) {
      setStoredQty(card, Math.max(1, getStoredQty(card) - 1));
      clampQtyToAvailable(card);
      return;
    }

    // Add to Cart
    const addBtn = e.target.closest(".add-to-cart-btn");
    if (addBtn) {
      if (addBtn.disabled) return;

      const sku = String(card.dataset.sku || "").trim();
      const tab = String(card.dataset.activeTab || "NM").toUpperCase();
      const cond = normalizeCondition(card.dataset.activeCond || TAB_TO_COND[tab] || "Near Mint");
      const stock = stockForCard(card, tab);

      const qtyWanted = getStoredQty(card);

      let cart = loadCart();
      const already = cartQtyFor(cart, sku, cond);
      const available = Math.max(0, stock - already);
      const toAdd = Math.min(qtyWanted, available);

      if (toAdd <= 0) {
        clampQtyToAvailable(card);
        return;
      }

      const idx = cart.findIndex(i => i.sku === sku && normalizeCondition(i.condition) === cond);
      if (idx >= 0) cart[idx].qty = (Number(cart[idx].qty) || 0) + toAdd;
      else cart.push({ sku, condition: cond, qty: toAdd });

      saveCart(cart);

addBtn.textContent = "Added ✓";

// ✅ reset qty for THIS condition back to 1
setStoredQty(card, 1);

setTimeout(() => {
  addBtn.textContent = "Add to Cart";
  clampQtyToAvailable(card);
}, 600);

      return;
    }
  });

  // -----------------------------
  // Typing qty should update ONLY current condition
  // -----------------------------
  document.addEventListener("input", (e) => {
    const qtyInput = e.target.closest(".qty-input");
    if (!qtyInput) return;

    const card = qtyInput.closest(".store-card");
    if (!card) return;

    let v = qtyInput.value.replace(/[^\d]/g, "");
    if (!v) v = "1";

    setStoredQty(card, Number(v));
    clampQtyToAvailable(card);
  });
})();

