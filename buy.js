document.addEventListener("DOMContentLoaded", function () {
  const buySearch = document.getElementById("buySearch");
  const grid = document.getElementById("storeGrid");
  if (!grid) return;

  const TAB_TO_COND = {
    NM: "Near Mint",
    EX: "Lightly Played",
    VG: "Moderately Played",
    G: "Heavily Played"
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
    if (t === "EX") return Number(card.dataset.stockEx || 0);
    if (t === "VG") return Number(card.dataset.stockVg || 0);
    return Number(card.dataset.stockG || 0);
  }

  function setActiveTab(card, tab) {
    const t = String(tab).toUpperCase();
    const cond = TAB_TO_COND[t];
    if (!cond) return;

    // If disabled (stock 0), ignore
    if (stockForCard(card, t) <= 0) return;

    card.dataset.activeTab = t;
    card.dataset.activeCond = cond;

    // Update button classes
    card.querySelectorAll(".cond-tab").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === t);
    });

    // Update displayed stock
    const stockNum = card.querySelector(".stock-num");
    if (stockNum) stockNum.textContent = String(stockForCard(card, t));

    // Update displayed unit price from buy-render’s stored unitCents (recompute safely)
    // We can recompute from basecents + multiplier logic by reading buy-render values,
    // but simplest: keep buy-render’s unitCents updated here too:
    const base = Number(card.dataset.basecents || 0);
    const mult = (cond === "Near Mint") ? 1.0 :
                 (cond === "Lightly Played") ? 0.9 :
                 (cond === "Moderately Played") ? 0.8 : 0.65;
    const unitCents = Math.round(base * mult);
    card.dataset.unitCents = String(unitCents);

    const unitPriceEl = card.querySelector(".unit-price");
    if (unitPriceEl) unitPriceEl.textContent = `$${(unitCents / 100).toFixed(2)}`;

    // Clamp qty to available remaining
    clampQtyToAvailable(card);
  }

  function clampQtyToAvailable(card) {
    const sku = card.dataset.sku;
    const tab = card.dataset.activeTab || "NM";
    const condition = card.dataset.activeCond || "Near Mint";
    const stock = stockForCard(card, tab);

    const cart = loadCart();
    const already = cartQtyFor(cart, sku, condition);
    const available = Math.max(0, stock - already);

    const qtyInput = card.querySelector(".qty-input");
    const qtyNum = card.querySelector(".qty-num");
    const plusBtn = card.querySelector(".qty-plus");
    const minusBtn = card.querySelector(".qty-minus");
    const addBtn = card.querySelector(".add-to-cart-btn");

    let qty = Math.max(1, Number(qtyInput?.value || 1));

    if (available <= 0) {
      // Can’t add any more of this condition
      if (qtyInput) qtyInput.value = 1;
      if (qtyNum) qtyNum.textContent = "1";
      if (plusBtn) plusBtn.disabled = true;
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

  // SEARCH
  if (buySearch) {
    buySearch.addEventListener("input", function () {
      const q = buySearch.value.toLowerCase().trim();
      grid.querySelectorAll(".store-card").forEach((card) => {
        const name = card.dataset.name || "";
        card.style.display = name.includes(q) ? "" : "none";
      });
    });
  }

  // CLICK HANDLING
  grid.addEventListener("click", function (e) {
    const card = e.target.closest(".store-card");
    if (!card) return;

    // Condition tab click
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      setActiveTab(card, tabBtn.dataset.tab);
      return;
    }

    // Qty plus/minus
    if (e.target.closest(".qty-plus")) {
      const input = card.querySelector(".qty-input");
      input.value = String((Number(input.value || 1) || 1) + 1);
      clampQtyToAvailable(card);
      return;
    }

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

      const sku = card.dataset.sku;
      const condition = normalizeCondition(card.dataset.activeCond || "Near Mint");
      const tab = card.dataset.activeTab || "NM";
      const stock = stockForCard(card, tab);

      const qty = Math.max(1, Number(card.querySelector(".qty-input")?.value || 1));

      let cart = loadCart();
      const already = cartQtyFor(cart, sku, condition);
      const available = Math.max(0, stock - already);
      const toAdd = Math.min(qty, available);

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

  // Input typing clamp
  grid.addEventListener("input", function (e) {
    const qtyInput = e.target.closest(".qty-input");
    if (!qtyInput) return;
    const card = qtyInput.closest(".store-card");
    if (!card) return;
    qtyInput.value = qtyInput.value.replace(/[^\d]/g, "");
    if (!qtyInput.value) qtyInput.value = "1";
    clampQtyToAvailable(card);
  });

  // Initial clamp on all cards
  grid.querySelectorAll(".store-card").forEach((card) => {
    // ensure active tab is set to current DOM active button
    const activeBtn = card.querySelector(".cond-tab.active");
    if (activeBtn) setActiveTab(card, activeBtn.dataset.tab);
    else setActiveTab(card, card.dataset.activeTab || "NM");

    clampQtyToAvailable(card);
  });
});
