document.addEventListener("DOMContentLoaded", function () {
  const buySearch = document.getElementById("buySearch");
  const grid = document.getElementById("storeGrid");

  // If the page doesn't have the store grid, don't run.
  if (!grid) {
    console.warn("buy.js: #storeGrid not found");
    return;
  }

  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played"
  };

  function loadCart() {
    try { return JSON.parse(localStorage.getItem("buyCart")) || []; } catch { return []; }
  }

  function saveCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  function normalizeCondition(c) {
    const allowed = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"];
    const s = String(c || "Near Mint").trim();
    return allowed.includes(s) ? s : "Near Mint";
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
    return 0.65; // Heavily Played
  }

  function setActiveTab(card, tab) {
    const t = String(tab || "NM").toUpperCase();
    const cond = TAB_TO_COND[t];
    if (!cond) return;

    // Don’t allow selecting conditions with 0 stock
    if (stockForCard(card, t) <= 0) return;

    card.dataset.activeTab = t;
    card.dataset.activeCond = cond;

    // Update tab UI
    card.querySelectorAll(".cond-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === t);
    });

    // Update displayed stock
    const stockNum = card.querySelector(".stock-num");
    if (stockNum) stockNum.textContent = String(stockForCard(card, t));

    // Update displayed price
    const base = Number(card.dataset.basecents || 0);
    const unitCents = Math.round(base * multiplierFor(cond));
    card.dataset.unitCents = String(unitCents);

    const unitPriceEl = card.querySelector(".unit-price");
    if (unitPriceEl) unitPriceEl.textContent = `$${(unitCents / 100).toFixed(2)}`;

    // Clamp qty after switching condition
    clampQtyToAvailable(card);
  }

  function clampQtyToAvailable(card) {
    const sku = String(card.dataset.sku || "").trim();
    if (!sku) return;

    const tab = String(card.dataset.activeTab || "NM").toUpperCase();
    const condition = normalizeCondition(card.dataset.activeCond || TAB_TO_COND[tab] || "Near Mint");

    const stock = stockForCard(card, tab);

    const cart = loadCart();
    const already = cartQtyFor(cart, sku, condition);
    const available = Math.max(0, stock - already);

    const qtyInput = card.querySelector(".qty-input");
    const qtyNum = card.querySelector(".qty-num");
    const plusBtn = card.querySelector(".qty-plus");
    const minusBtn = card.querySelector(".qty-minus");
    const addBtn = card.querySelector(".add-to-cart-btn");

    let qty = Math.max(1, Number(qtyInput?.value || 1) || 1);

    if (available <= 0) {
      if (qtyInput) qtyInput.value = "1";
      if (qtyNum) qtyNum.textContent = "1";
      if (plusBtn) plusBtn.disabled = true;
      if (minusBtn) minusBtn.disabled = true;
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = "Max in Cart"; }
      return;
    }

    qty = Math.min(qty, available);

    if (qtyInput) qtyInput.value = String(qty);
    if (qtyNum) qtyNum.textContent = String(qty);

    if (plusBtn) plusBtn.disabled = qty >= available;
    if (minusBtn) minusBtn.disabled = qty <= 1;
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = "Add to Cart"; }
  }

  // SEARCH (works even as cards render later)
  if (buySearch) {
    buySearch.addEventListener("input", function () {
      const q = buySearch.value.toLowerCase().trim();
      grid.querySelectorAll(".store-card").forEach((card) => {
        const name = card.dataset.name || "";
        card.style.display = name.includes(q) ? "" : "none";
      });
    });
  }

  // ✅ Event delegation: works for cards rendered later
  document.addEventListener("click", function (e) {
    const card = e.target.closest(".store-card");
    if (!card) return;

    // Tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      const tab = String(tabBtn.dataset.tab || "").toUpperCase();
const isDisabled =
  tabBtn.classList.contains("disabled") ||
  tabBtn.getAttribute("aria-disabled") === "true";

if (!tab) return;
if (isDisabled) return;

setActiveTab(card, tab);


    // Qty +
    if (e.target.closest(".qty-plus")) {
      const input = card.querySelector(".qty-input");
      input.value = String((Number(input.value || 1) || 1) + 1);
      clampQtyToAvailable(card);
      return;
    }

    // Qty -
    if (e.target.closest(".qty-minus")) {
      const input = card.querySelector(".qty-input");
      input.value = String(Math.max(1, (Number(input.value || 1) || 1) - 1));
      clampQtyToAvailable(card);
      return;
    }

    // Add to cart
    const addBtn = e.target.closest(".add-to-cart-btn");
    if (addBtn) {
      if (addBtn.disabled) return;

      const sku = String(card.dataset.sku || "").trim();
      const tab = String(card.dataset.activeTab || "NM").toUpperCase();
      const condition = normalizeCondition(card.dataset.activeCond || TAB_TO_COND[tab] || "Near Mint");

      const stock = stockForCard(card, tab);

      const qtyWanted = Math.max(1, Number(card.querySelector(".qty-input")?.value || 1) || 1);

      let cart = loadCart();
      const already = cartQtyFor(cart, sku, condition);
      const available = Math.max(0, stock - already);
      const toAdd = Math.min(qtyWanted, available);

      if (toAdd <= 0) {
        clampQtyToAvailable(card);
        return;
      }

      const idx = cart.findIndex(i => i.sku === sku && normalizeCondition(i.condition) === condition);
      if (idx >= 0) cart[idx].qty = (Number(cart[idx].qty) || 0) + toAdd;
      else cart.push({ sku, condition, qty: toAdd });

      saveCart(cart);

      addBtn.textContent = "Added ✓";
      setTimeout(() => {
        addBtn.textContent = "Add to Cart";
        clampQtyToAvailable(card);
      }, 600);
      return;
    }
  });

  // Clamp qty when user types
  document.addEventListener("input", function (e) {
    const qtyInput = e.target.closest(".qty-input");
    if (!qtyInput) return;
    const card = qtyInput.closest(".store-card");
    if (!card) return;

    qtyInput.value = qtyInput.value.replace(/[^\d]/g, "");
    if (!qtyInput.value) qtyInput.value = "1";

    clampQtyToAvailable(card);
  });

  // ✅ Initialize cards when they appear (buy-render renders later)
  const initCard = (card) => {
    if (!card || card.dataset._inited === "1") return;
    card.dataset._inited = "1";

    // Pick an active tab: first enabled tab or NM
    const enabledBtn =
      card.querySelector('.cond-tab:not(.disabled)[aria-disabled="false"]') ||
      card.querySelector('.cond-tab:not(.disabled):not([aria-disabled="true"])') ||
      card.querySelector(".cond-tab");

    if (enabledBtn) setActiveTab(card, enabledBtn.dataset.tab || "NM");
    else {
      card.dataset.activeTab = "NM";
      card.dataset.activeCond = "Near Mint";
    }

    // Keep qty label synced
    const qtyInput = card.querySelector(".qty-input");
    const qtyNum = card.querySelector(".qty-num");
    if (qtyInput && qtyNum) qtyNum.textContent = String(qtyInput.value || 1);

    clampQtyToAvailable(card);
  };

  // Run once for any cards already on page
  grid.querySelectorAll(".store-card").forEach(initCard);

  // Watch for new cards appended by buy-render.js
  const obs = new MutationObserver(() => {
    grid.querySelectorAll(".store-card").forEach(initCard);
  });
  obs.observe(grid, { childList: true, subtree: true });

  console.log("buy.js loaded ✅");
});

