(() => {
  console.log("SELL script.js loaded ✅");

  const TAB_ORDER = ["NM", "LP", "MP"];

  function money(n) {
    return Number(n || 0).toFixed(2);
  }

  function loadSellCart() {
    try { return JSON.parse(localStorage.getItem("sellCart")) || []; }
    catch { return []; }
  }

  function saveSellCart(cart) {
    localStorage.setItem("sellCart", JSON.stringify(cart));
  }

  // Cart items look like: { sku, name, condition, qty, unitPrice }
  function cartQtyFor(cart, sku, cond) {
    return cart
      .filter(i => i.sku === sku && i.condition === cond)
      .reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  }

  function qtyKeyForTab(tab) {
    const t = String(tab || "NM").toUpperCase();
    if (t === "NM") return "qtyNm";
    if (t === "LP") return "qtyLp";
    return "qtyMp";
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

  function getMaxFor(card, tab) {
    const t = String(tab || "NM").toUpperCase();
    if (t === "NM") return Number(card.dataset.maxNm || 0);
    if (t === "LP") return Number(card.dataset.maxLp || 0);
    return Number(card.dataset.maxMp || 0);
  }

  function getPriceFor(card, tab) {
    const t = String(tab || "NM").toUpperCase();
    if (t === "NM") return Number(card.dataset.priceNm || 0);
    if (t === "LP") return Number(card.dataset.priceLp || 0);
    return Number(card.dataset.priceMp || 0);
  }

  function setActiveTab(card, tab) {
    const t = String(tab || "NM").toUpperCase();
    if (!TAB_ORDER.includes(t)) return;

    // Don’t allow selecting a condition with max 0
    if (getMaxFor(card, t) <= 0) return;

    card.dataset.activeTab = t;

    // Update tab UI
    card.querySelectorAll(".cond-tab").forEach(btn => {
      btn.classList.toggle("active", (btn.dataset.tab || "").toUpperCase() === t);
    });

    // Update price + max labels
    const unitPrice = getPriceFor(card, t);
    const max = getMaxFor(card, t);

    const unitEl = card.querySelector(".unit-price");
    if (unitEl) unitEl.textContent = `$${money(unitPrice)}`;

    const maxEl = card.querySelector(".max-num");
    if (maxEl) maxEl.textContent = String(max);

    // Load qty for THIS condition
    setStoredQty(card, getStoredQty(card));

    clampQtyToMaxAndCart(card);
  }

  function clampQtyToMaxAndCart(card) {
    const sku = String(card.dataset.sku || "").trim();
    if (!sku) return;

    const tab = String(card.dataset.activeTab || "NM").toUpperCase();
    const max = getMaxFor(card, tab);

    const cart = loadSellCart();
    const already = cartQtyFor(cart, sku, tab);
    const remaining = Math.max(0, max - already);

    let qty = getStoredQty(card);

    const plusBtn = card.querySelector(".qty-plus");
    const minusBtn = card.querySelector(".qty-minus");
    const addBtn = card.querySelector(".add-to-sell-btn");

    // If already at/over cap, disable adding
    if (remaining <= 0) {
      setStoredQty(card, 1);
      if (plusBtn) plusBtn.disabled = true;
      if (minusBtn) minusBtn.disabled = true;
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = "Max Reached";
      }
      return;
    }

    qty = Math.min(qty, remaining);
    setStoredQty(card, qty);

    if (plusBtn) plusBtn.disabled = qty >= remaining;
    if (minusBtn) minusBtn.disabled = qty <= 1;

    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = "Add to Sell Order";
    }

    // Show “max capacity” and “remaining”
    const remainingEl = card.querySelector(".remaining-num");
    if (remainingEl) remainingEl.textContent = String(remaining);

    const inCartEl = card.querySelector(".incart-num");
    if (inCartEl) inCartEl.textContent = String(already);
  }

  // ---------- RENDER ----------
  document.addEventListener("DOMContentLoaded", async () => {
    const grid = document.getElementById("sellGrid") || document.getElementById("results");
    const searchInput = document.getElementById("search");
    if (!grid) {
      console.warn("Sell: grid container not found (#sellGrid or #results).");
      return;
    }

    async function loadSellCatalog() {
      const res = await fetch("/api/selllist", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load selllist");
      const data = await res.json();
      if (!data?.ok || !data.selllist) throw new Error("Bad selllist response");
      return data.selllist;
    }

    function buildCard(sku, p) {
      const name = String(p.name || sku);
      const image = String(p.image || "");
      const prices = p.prices || {};
      const max = p.max || {};

      const nmPrice = Number(prices.NM || 0);
      const lpPrice = Number(prices.LP || 0);
      const mpPrice = Number(prices.MP || 0);

      const nmMax = Number(max.NM || 0);
      const lpMax = Number(max.LP || 0);
      const mpMax = Number(max.MP || 0);

      // Skip if all max are 0
      if ((nmMax + lpMax + mpMax) <= 0) return null;

      const card = document.createElement("div");
      card.className = "store-card sell-card";
      card.dataset.sku = sku;
      card.dataset.name = name.toLowerCase();

      card.dataset.priceNm = String(nmPrice);
      card.dataset.priceLp = String(lpPrice);
      card.dataset.priceMp = String(mpPrice);

      card.dataset.maxNm = String(nmMax);
      card.dataset.maxLp = String(lpMax);
      card.dataset.maxMp = String(mpMax);

      // default tab = first with max>0
      let activeTab = "NM";
      if (nmMax > 0) activeTab = "NM";
      else if (lpMax > 0) activeTab = "LP";
      else activeTab = "MP";

      card.dataset.activeTab = activeTab;

      const imgSrc = image ? encodeURI(image.startsWith("/") ? image : "/" + image) : "";

      card.innerHTML = `
        ${imgSrc ? `<img class="zoomable" src="${imgSrc}" alt="${name}">` : ""}
        <h3 class="store-title">${name}</h3>

        <div class="cond-tabs" role="tablist" aria-label="Condition">
          ${TAB_ORDER.map(tab => {
            const tabMax = tab === "NM" ? nmMax : tab === "LP" ? lpMax : mpMax;
            const disabled = tabMax <= 0;
            const isActive = tab === activeTab;
            return `
              <button
                class="cond-tab${isActive ? " active" : ""}${disabled ? " disabled" : ""}"
                type="button"
                data-tab="${tab}"
                aria-disabled="${disabled ? "true" : "false"}"
              >${tab}</button>
            `;
          }).join("")}
        </div>

        <div class="sell-meta">
          <div class="sell-price">
            Buy Price: <strong class="unit-price">$${money(getPriceFor(card, activeTab))}</strong>
          </div>

          <div class="sell-cap">
            Max capacity: <strong class="max-num">${getMaxFor(card, activeTab)}</strong>
            • In cart: <strong class="incart-num">0</strong>
            • Remaining: <strong class="remaining-num">0</strong>
          </div>
        </div>

        <div class="qty-stepper">
          <button class="qty-minus" type="button">−</button>
          <input class="qty-input" type="number" min="1" value="1" inputmode="numeric">
          <button class="qty-plus" type="button">+</button>
        </div>

        <button class="add-to-sell-btn" type="button">Add to Sell Order</button>
      `;

      // initialize qty storage for all tabs
      card.dataset.qtyNm = "1";
      card.dataset.qtyLp = "1";
      card.dataset.qtyMp = "1";

      // set initial
      setActiveTab(card, activeTab);
      return card;
    }

    function renderGrid(entries) {
      grid.innerHTML = "";
      entries.forEach(el => grid.appendChild(el));
      // clamp everything against cart
      grid.querySelectorAll(".store-card").forEach(clampQtyToMaxAndCart);
    }

    let catalog = {};
    try {
      catalog = await loadSellCatalog();
    } catch (e) {
      console.error(e);
      grid.innerHTML = `<p style="color:#b00;">Could not load sell list.</p>`;
      return;
    }

    const allCards = Object.entries(catalog)
      .map(([sku, p]) => buildCard(sku, p))
      .filter(Boolean);

    renderGrid(allCards);

    // Search
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const q = searchInput.value.toLowerCase().trim();
        grid.querySelectorAll(".store-card").forEach(card => {
          const name = String(card.dataset.name || "");
          card.style.display = (!q || name.includes(q)) ? "" : "none";
        });
      });
    }
  });

  // ---------- CLICK HANDLERS (delegation) ----------
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

    // Qty +
    if (e.target.closest(".qty-plus")) {
      setStoredQty(card, getStoredQty(card) + 1);
      clampQtyToMaxAndCart(card);
      return;
    }

    // Qty -
    if (e.target.closest(".qty-minus")) {
      setStoredQty(card, Math.max(1, getStoredQty(card) - 1));
      clampQtyToMaxAndCart(card);
      return;
    }

    // Add to sell order
    const addBtn = e.target.closest(".add-to-sell-btn");
    if (addBtn) {
      if (addBtn.disabled) return;

      const sku = String(card.dataset.sku || "").trim();
      const tab = String(card.dataset.activeTab || "NM").toUpperCase();
      const name = card.querySelector(".store-title")?.textContent?.trim() || sku;

      const unitPrice = getPriceFor(card, tab);
      const max = getMaxFor(card, tab);

      const qtyWanted = getStoredQty(card);

      let cart = loadSellCart();
      const already = cartQtyFor(cart, sku, tab);
      const remaining = Math.max(0, max - already);
      const toAdd = Math.min(qtyWanted, remaining);

      if (toAdd <= 0) {
        clampQtyToMaxAndCart(card);
        return;
      }

      const idx = cart.findIndex(i => i.sku === sku && i.condition === tab);
      if (idx >= 0) cart[idx].qty = (Number(cart[idx].qty) || 0) + toAdd;
      else cart.push({ sku, name, condition: tab, qty: toAdd, unitPrice });

      saveSellCart(cart);

      // Reset qty for this condition to 1 after add
      setStoredQty(card, 1);
      clampQtyToMaxAndCart(card);

      addBtn.textContent = "Added ✓";
      setTimeout(() => (addBtn.textContent = "Add to Sell Order"), 600);
      return;
    }
  });

  // typing in qty box
  document.addEventListener("input", (e) => {
    const qtyInput = e.target.closest(".qty-input");
    if (!qtyInput) return;

    const card = qtyInput.closest(".store-card");
    if (!card) return;

    let v = qtyInput.value.replace(/[^\d]/g, "");
    if (!v) v = "1";
    qtyInput.value = v;

    // save to active condition qty
    setStoredQty(card, Number(v));
    clampQtyToMaxAndCart(card);
  });
})();









