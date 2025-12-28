(() => {
  console.log("SELL-CART.JS LOADED ✅ (v2)");

  const CART_KEY = "sellCart";

  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played"
  };

  // If you DON'T store per-condition cents, we fall back to base * multiplier:
  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  const activeTabBySku = new Map();

  function normalizeCondition(cond) {
    const allowed = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"];
    const s = String(cond || "").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function moneyFromCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("storage"));
  }

  function clearCart() {
    localStorage.removeItem(CART_KEY);
    window.dispatchEvent(new Event("storage"));
  }

  function cartQtyFor(cart, sku, condition) {
    const cond = normalizeCondition(condition);
    return cart
      .filter(i => String(i.sku) === String(sku) && normalizeCondition(i.condition) === cond)
      .reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  }

  function qtyByTabForSku(cart, sku) {
    const out = { NM: 0, LP: 0, MP: 0, HP: 0 };
    for (const tab of TAB_ORDER) {
      out[tab] = cartQtyFor(cart, sku, TAB_TO_COND[tab]);
    }
    return out;
  }

  function firstTabWithQty(qtyByTab) {
    for (const tab of TAB_ORDER) {
      if ((qtyByTab[tab] || 0) > 0) return tab;
    }
    return "NM";
  }

  // -----------------------------
  // SELL LIST parsing (robust)
  // -----------------------------
  function getUnitCentsFromSelllist(product, condition) {
    const cond = normalizeCondition(condition);

    // 1) prices_cents object by condition name
    if (product?.prices_cents && typeof product.prices_cents === "object") {
      const v = Number(product.prices_cents[cond] ?? 0);
      if (Number.isFinite(v) && v > 0) return Math.round(v);
    }

    // 2) price_cents by condition keys: nm_cents, lp_cents, mp_cents, hp_cents
    const keyByCond = {
      "Near Mint": "nm_cents",
      "Lightly Played": "lp_cents",
      "Moderately Played": "mp_cents",
      "Heavily Played": "hp_cents"
    };
    const k = keyByCond[cond];
    if (k && product && product[k] != null) {
      const v = Number(product[k]);
      if (Number.isFinite(v) && v > 0) return Math.round(v);
    }

    // 3) prices in dollars by tab: nm/lp/mp/hp
    const keyByCondDollars = {
      "Near Mint": "nm",
      "Lightly Played": "lp",
      "Moderately Played": "mp",
      "Heavily Played": "hp"
    };
    const kd = keyByCondDollars[cond];
    if (kd && product && product[kd] != null) {
      const dollars = Number(product[kd]);
      if (Number.isFinite(dollars) && dollars > 0) return Math.round(dollars * 100);
    }

    // 4) base price_cents with multiplier fallback
    const baseCents = Number(product?.price_cents || 0);
    if (Number.isFinite(baseCents) && baseCents > 0) {
      const mult = CONDITION_MULT[cond] ?? 1.0;
      return Math.round(baseCents * mult);
    }

    return 0;
  }

  function getMaxForCondition(product, condition) {
    const cond = normalizeCondition(condition);

    // 1) max object by condition name
    if (product?.max && typeof product.max === "object") {
      const v = Number(product.max[cond] ?? 0);
      return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    }

    // 2) max_nm / max_lp / ...
    const keyByCond = {
      "Near Mint": "max_nm",
      "Lightly Played": "max_lp",
      "Moderately Played": "max_mp",
      "Heavily Played": "max_hp"
    };
    const k = keyByCond[cond];
    if (k && product && product[k] != null) {
      const v = Number(product[k]);
      return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    }

    // 3) camelCase: maxNM / maxLP ...
    const keyByCondCamel = {
      "Near Mint": "maxNM",
      "Lightly Played": "maxLP",
      "Moderately Played": "maxMP",
      "Heavily Played": "maxHP"
    };
    const kc = keyByCondCamel[cond];
    if (kc && product && product[kc] != null) {
      const v = Number(product[kc]);
      return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    }

    return 0;
  }

  async function fetchSelllist() {
    const res = await fetch("/api/selllist", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load selllist");
    const data = await res.json();
    if (!data || data.ok !== true || !data.selllist) throw new Error("Bad selllist response");
    return data.selllist;
  }

  // -----------------------------
  // DOM
  // -----------------------------
  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const clearBtn = document.getElementById("sellClearCartBtn");
  const msgEl = document.getElementById("sellCartMessage");

  const submitBtn = document.getElementById("sellSubmitBtn");
  const emailInput = document.getElementById("sellEmail");

  if (!listEl || !totalEl) {
    console.warn("sell-cart.js: missing #sellCartList or #sellCartTotal");
    return;
  }

  let selllistCache = null;

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearCart();
      render();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const cart = loadCart();
      if (!cart.length) {
        if (msgEl) { msgEl.textContent = "Your sell cart is empty."; msgEl.style.color = "crimson"; }
        return;
      }

      const email = String(emailInput?.value || "").trim();
      if (!email) {
        if (msgEl) { msgEl.textContent = "Please enter your email for confirmation."; msgEl.style.color = "crimson"; }
        return;
      }

      try {
        if (msgEl) { msgEl.textContent = "Submitting…"; msgEl.style.color = "#333"; }

        if (!selllistCache) selllistCache = await fetchSelllist();

        const order = [];
        let totalCents = 0;

        for (const item of cart) {
          const sku = String(item.sku || "").trim();
          const cond = normalizeCondition(item.condition);
          const qty = Math.max(1, Number(item.qty || 0));

          const p = selllistCache[sku];
          if (!p) continue;

          const unitCents = getUnitCentsFromSelllist(p, cond);
          totalCents += unitCents * qty;

          order.push({
            sku,
            name: p.name || sku,
            condition: cond,
            qty,
            unitPrice: (unitCents / 100)
          });
        }

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "",
            email,
            total: (totalCents / 100).toFixed(2),
            order
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Submit failed");

        // ✅ clear on success
        clearCart();
        render();

        if (msgEl) {
          msgEl.textContent = "Sell order submitted! Check your email for confirmation.";
          msgEl.style.color = "green";
        }
      } catch (err) {
        console.error("Sell submit error:", err);
        if (msgEl) {
          msgEl.textContent = `Error: ${err.message || "Could not submit."}`;
          msgEl.style.color = "crimson";
        }
      }
    });
  }

  // -----------------------------
  // CLICK HANDLER (attach to listEl)
  // -----------------------------
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".cart-item");
    if (!row) return;

    const sku = String(row.dataset.sku || "").trim();
    if (!sku) return;

    // Tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      const tab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      activeTabBySku.set(sku, tab);
      render(); // re-render keeps this tab
      return;
    }

    // Qty +
    if (e.target.closest(".qty-plus")) {
      console.log("sell cart + clicked", sku);

      const tab = String(activeTabBySku.get(sku) || row.dataset.activeTab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab] || "Near Mint";

      const cart = loadCart();
      const p = selllistCache?.[sku];
      const maxCap = p ? getMaxForCondition(p, cond) : 0;

      const current = cartQtyFor(cart, sku, cond);
      if (maxCap > 0 && current >= maxCap) return; // enforce max when provided
      if (maxCap === 0) return; // if truly 0, don't allow adding

      const idx = cart.findIndex(i => String(i.sku) === sku && normalizeCondition(i.condition) === cond);
      if (idx >= 0) cart[idx].qty = Math.max(1, Number(cart[idx].qty || 0) + 1);
      else cart.push({ sku, condition: cond, qty: 1 });

      saveCart(cart);
      render();
      return;
    }

    // Qty -
    if (e.target.closest(".qty-minus")) {
      console.log("sell cart - clicked", sku);

      const tab = String(activeTabBySku.get(sku) || row.dataset.activeTab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab] || "Near Mint";

      const cart = loadCart();
      const idx = cart.findIndex(i => String(i.sku) === sku && normalizeCondition(i.condition) === cond);
      if (idx === -1) return;

      cart[idx].qty = Number(cart[idx].qty || 0) - 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);

      saveCart(cart);
      render();
      return;
    }

    // Remove condition
    if (e.target.closest(".remove-condition-btn")) {
      const tab = String(activeTabBySku.get(sku) || row.dataset.activeTab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab] || "Near Mint";

      let cart = loadCart();
      cart = cart.filter(i => !(String(i.sku) === sku && normalizeCondition(i.condition) === cond));
      saveCart(cart);
      render();
      return;
    }
  });

  // -----------------------------
  // RENDER
  // -----------------------------
  async function render() {
    const cart = loadCart();

    // Load selllist once
    try {
      if (!selllistCache) selllistCache = await fetchSelllist();
    } catch (e) {
      console.error(e);
      listEl.innerHTML = `<li style="list-style:none;color:crimson;">Failed to load sell list.</li>`;
      totalEl.textContent = "0.00";
      return;
    }

    // Group by SKU
    const bySku = new Map();
    for (const item of cart) {
      const sku = String(item.sku || "").trim();
      if (!sku) continue;
      if (!bySku.has(sku)) bySku.set(sku, []);
      bySku.get(sku).push({
        sku,
        condition: normalizeCondition(item.condition),
        qty: Math.max(1, Number(item.qty || 0))
      });
    }

    listEl.innerHTML = "";

    const skus = Array.from(bySku.keys());
    if (skus.length === 0) {
      totalEl.textContent = "0.00";
      listEl.innerHTML = `<li style="list-style:none;opacity:.75;">Your sell cart is empty.</li>`;
      return;
    }

    let totalCents = 0;

    for (const sku of skus) {
      const p = selllistCache[sku];
      if (!p) continue;

      const name = String(p.name || sku);

      const img = String(p.image || "");
      const imgSrc = img ? encodeURI(img.startsWith("/") ? img : `/${img}`) : "";

      const qtyByTab = qtyByTabForSku(cart, sku);

      // Active tab per SKU
      const saved = activeTabBySku.get(sku);
      const defaultTab = saved || firstTabWithQty(qtyByTab);
      const activeTab = TAB_ORDER.includes(defaultTab) ? defaultTab : "NM";
      activeTabBySku.set(sku, activeTab);

      const activeCond = TAB_TO_COND[activeTab];
      const activeQty = qtyByTab[activeTab] || 0;

      // Per-condition unit cents (robust)
      const unitCents = getUnitCentsFromSelllist(p, activeCond);

      // subtotal for active condition
      const activeSubtotalCents = unitCents * activeQty;

      // subtotal across ALL conditions for this SKU
      const skuSubtotalCents =
        (getUnitCentsFromSelllist(p, TAB_TO_COND.NM) * (qtyByTab.NM || 0)) +
        (getUnitCentsFromSelllist(p, TAB_TO_COND.LP) * (qtyByTab.LP || 0)) +
        (getUnitCentsFromSelllist(p, TAB_TO_COND.MP) * (qtyByTab.MP || 0)) +
        (getUnitCentsFromSelllist(p, TAB_TO_COND.HP) * (qtyByTab.HP || 0));

      totalCents += skuSubtotalCents;

      const inCartAll = TAB_ORDER.reduce((s, t) => s + (qtyByTab[t] || 0), 0);

      const maxCap = getMaxForCondition(p, activeCond);
      const canPlus = maxCap > 0 && activeQty < maxCap;

      const li = document.createElement("li");
      li.className = "cart-item";
      li.dataset.sku = sku;
      li.dataset.activeTab = activeTab;

      li.innerHTML = `
        <div class="cart-row">
          ${imgSrc ? `<img class="cart-thumb zoomable" src="${imgSrc}" alt="${name}">` : ""}

          <div class="cart-mid">
            <div class="cart-title">${name}</div>

            <div class="cond-tabs" role="tablist" aria-label="Condition">
              ${TAB_ORDER.map(tab => {
                const tabQty = qtyByTab[tab] || 0;
                const disabled = tabQty <= 0;
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

            <div class="cart-meta">
              <div>Condition: ${activeCond}</div>
              <div>Unit: <strong>${moneyFromCents(unitCents)}</strong></div>
              <div class="cart-subline">
                In cart (all conditions): ${inCartAll} • Subtotal: ${moneyFromCents(skuSubtotalCents)}
              </div>
              <div class="cart-maxline">
                Max capacity: <strong>${maxCap}</strong>
              </div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-controls">
              <button class="qty-minus" type="button" ${activeQty <= 1 ? "disabled" : ""}>−</button>
              <span class="qty-value">${activeQty || 0}</span>
              <button class="qty-plus" type="button" ${!canPlus ? "disabled" : ""}>+</button>
            </div>

            <div class="line-total">${moneyFromCents(activeSubtotalCents)}</div>

            <button class="remove-condition-btn" type="button">Remove condition</button>
          </div>
        </div>
      `;

      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  render();

})();

