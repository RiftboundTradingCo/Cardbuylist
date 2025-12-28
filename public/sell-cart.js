(() => {
  console.log("SELL-CART.JS LOADED ✅");

  const CART_KEY = "sellCart";

  // Tabs (match Buy Cart style)
  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played"
  };

  // If your sell pricing uses different multipliers than buy, change these:
  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  // Cache active tab per SKU so it doesn't reset on re-render
  const activeTabBySku = new Map();

  function normalizeCondition(cond) {
    const allowed = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"];
    const s = String(cond || "").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function moneyFromCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) n = min;
    n = Math.floor(n);
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
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
    // If you have a badge script that listens for storage, this helps too:
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
      const cond = TAB_TO_COND[tab];
      out[tab] = cartQtyFor(cart, sku, cond);
    }
    return out;
  }

  function centsForCondition(baseCents, condition) {
    const cond = normalizeCondition(condition);
    const m = CONDITION_MULT[cond] ?? 1.0;
    return Math.round(Number(baseCents || 0) * m);
  }

  async function fetchSelllist() {
    const res = await fetch("/api/selllist", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load selllist");
    const data = await res.json();
    if (!data || data.ok !== true || !data.selllist) throw new Error("Bad selllist response");
    return data.selllist;
  }

  // We expect selllist.json entries like:
  // selllist[SKU] = { name, price_cents, image, max: { "Near Mint": 13, ... } }
  function maxForCondition(product, condition) {
    const cond = normalizeCondition(condition);
    const m = product?.max && typeof product.max === "object" ? Number(product.max[cond] ?? 0) : 0;
    return Number.isFinite(m) ? m : 0;
  }

  function firstTabWithQty(qtyByTab) {
    for (const tab of TAB_ORDER) {
      if ((qtyByTab[tab] || 0) > 0) return tab;
    }
    return "NM";
  }

  // ===== DOM =====
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

      // Build a detailed sell order from selllist pricing (server can also compute; this is for email breakdown)
      try {
        if (msgEl) { msgEl.textContent = "Submitting…"; msgEl.style.color = "#333"; }

        // Load selllist to compute totals/lines
        const selllist = await fetchSelllist();

        const order = [];
        let totalCents = 0;

        for (const item of cart) {
          const sku = String(item.sku || "").trim();
          const cond = normalizeCondition(item.condition);
          const qty = Math.max(1, Number(item.qty || 0));
          const p = selllist[sku];
          if (!p) continue;

          const baseCents = Number(p.price_cents || 0);
          const unitCents = centsForCondition(baseCents, cond);
          totalCents += unitCents * qty;

          order.push({
            sku,
            name: p.name || sku,
            condition: cond,
            qty,
            unitPrice: (unitCents / 100) // matches your existing server formatting
          });
        }

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "", // optional if you want
            email,
            total: (totalCents / 100).toFixed(2),
            order
          })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Submit failed");
        }

        // ✅ clear sell cart after successful submit
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

  // ===== Render =====
  let selllistCache = null;

  async function render() {
    const cart = loadCart();

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

    // Load selllist once
    try {
      if (!selllistCache) selllistCache = await fetchSelllist();
    } catch (e) {
      console.error(e);
      listEl.innerHTML = `<li style="color:crimson;">Failed to load sell list.</li>`;
      totalEl.textContent = "0.00";
      return;
    }

    // Build rows
    listEl.innerHTML = "";
    let totalCents = 0;

    const skus = Array.from(bySku.keys());

    if (skus.length === 0) {
      totalEl.textContent = "0.00";
      listEl.innerHTML = `<li style="list-style:none; opacity:.75;">Your sell cart is empty.</li>`;
      return;
    }

    for (const sku of skus) {
      const p = selllistCache[sku];
      if (!p) continue;

      const name = String(p.name || sku);
      const img = String(p.image || "");
      const imgSrc = img ? encodeURI(img.startsWith("/") ? img : `/${img}`) : "";

      const baseCents = Number(p.price_cents || 0);

      const qtyByTab = qtyByTabForSku(cart, sku);

      // Preserve active tab per SKU
      const savedTab = activeTabBySku.get(sku);
      const defaultTab = savedTab || firstTabWithQty(qtyByTab);
      const activeTab = TAB_ORDER.includes(defaultTab) ? defaultTab : "NM";
      activeTabBySku.set(sku, activeTab);

      const activeCond = TAB_TO_COND[activeTab];
      const activeQty = qtyByTab[activeTab] || 0;

      const unitCents = centsForCondition(baseCents, activeCond);
      const subtotalCentsForCond = unitCents * activeQty;

      const inCartAll = TAB_ORDER.reduce((s, t) => s + (qtyByTab[t] || 0), 0);

      // Total subtotal for this SKU across conditions
      const skuSubtotalCents =
        (centsForCondition(baseCents, TAB_TO_COND.NM) * (qtyByTab.NM || 0)) +
        (centsForCondition(baseCents, TAB_TO_COND.LP) * (qtyByTab.LP || 0)) +
        (centsForCondition(baseCents, TAB_TO_COND.MP) * (qtyByTab.MP || 0)) +
        (centsForCondition(baseCents, TAB_TO_COND.HP) * (qtyByTab.HP || 0));

      totalCents += skuSubtotalCents;

      // Max capacity for active condition
      const maxCap = maxForCondition(p, activeCond);
      const canPlus = activeQty < maxCap;

      const li = document.createElement("li");
      li.className = "cart-item";
      li.dataset.sku = sku;
      li.dataset.name = name;
      li.dataset.basecents = String(baseCents);
      li.dataset.activeTab = activeTab;

      li.innerHTML = `
        <div class="cart-row">
          ${imgSrc ? `<img class="cart-thumb zoomable" src="${imgSrc}" alt="${name}">` : ""}

          <div class="cart-mid">
            <div class="cart-title">${name}</div>

            <div class="cond-tabs" role="tablist" aria-label="Condition">
              ${TAB_ORDER.map(tab => {
                const tabQty = qtyByTab[tab] || 0;
                const disabled = tabQty <= 0; // ✅ grey out if none in cart
                const isActive = tab === activeTab;
                return `
                  <button
                    class="cond-tab${isActive ? " active" : ""}${disabled ? " disabled" : ""}"
                    type="button"
                    data-tab="${tab}"
                    aria-disabled="${disabled ? "true" : "false"}"
                    title="${disabled ? "None in cart" : ""}"
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

            <div class="line-total">${moneyFromCents(subtotalCentsForCond)}</div>

            <button class="remove-condition-btn" type="button">
              Remove condition
            </button>
          </div>
        </div>
      `;

      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  // ===== Click handling (delegation) =====
  document.addEventListener("click", (e) => {
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
      row.dataset.activeTab = tab;
      activeTabBySku.set(sku, tab);
      render();
      return;
    }

    // Qty +
    if (e.target.closest(".qty-plus")) {
      const tab = String(row.dataset.activeTab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab] || "Near Mint";

      const cart = loadCart();
      const p = selllistCache?.[sku];
      const maxCap = p ? maxForCondition(p, cond) : 0;

      const current = cartQtyFor(cart, sku, cond);
      if (current >= maxCap) return; // ✅ enforce max

      // increment this SKU+condition
      const idx = cart.findIndex(i => String(i.sku) === sku && normalizeCondition(i.condition) === cond);
      if (idx >= 0) cart[idx].qty = Math.max(1, Number(cart[idx].qty || 0) + 1);
      else cart.push({ sku, condition: cond, qty: 1 });

      saveCart(cart);
      render();
      return;
    }

    // Qty -
    if (e.target.closest(".qty-minus")) {
      const tab = String(row.dataset.activeTab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab] || "Near Mint";

      const cart = loadCart();
      const idx = cart.findIndex(i => String(i.sku) === sku && normalizeCondition(i.condition) === cond);
      if (idx === -1) return;

      cart[idx].qty = Number(cart[idx].qty || 0) - 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);

      saveCart(cart);

      // keep current tab even if it becomes 0; render() will grey it out and jump to first non-zero
      // but we DO NOT want to snap to NM on +/- clicks, so preserve user's tab unless empty:
      const stillHas = cartQtyFor(cart, sku, cond) > 0;
      if (!stillHas) {
        // keep tab stored, but render will select first non-zero tab automatically if current becomes empty
      }

      render();
      return;
    }

    // Remove condition
    if (e.target.closest(".remove-condition-btn")) {
      const tab = String(row.dataset.activeTab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab] || "Near Mint";

      let cart = loadCart();
      cart = cart.filter(i => !(String(i.sku) === sku && normalizeCondition(i.condition) === cond));
      saveCart(cart);
      render();
      return;
    }
  });

  // Initial load
  render();
})();

