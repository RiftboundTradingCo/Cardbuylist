document.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("buyCartMessage");
  const clearBtn = document.getElementById("buyClearCartBtn");

  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played"
  };

  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function normalizeCondition(c) {
    const allowed = Object.keys(CONDITION_MULT);
    const s = String(c || "Near Mint").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function calcUnitCents(baseCents, condition) {
    const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem("buyCart")) || [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    const withSlash = s.startsWith("/") ? s : `/${s}`;
    return encodeURI(withSlash);
  }

  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.catalog) throw new Error("Bad catalog JSON");
    return data.catalog;
  }

  function getStockForCondition(product, condition) {
    const cond = normalizeCondition(condition);
    if (product && product.stock && typeof product.stock === "object") {
      return Number(product.stock[cond] ?? 0);
    }
    return Number(product?.stock ?? 0); // fallback old format
  }

  // Group cart lines by SKU
  function groupCart(cart) {
    const groups = new Map(); // sku -> { sku, lines: Map(cond->qty), activeTab }
    for (const line of cart) {
      const sku = String(line.sku || "").trim();
      if (!sku) continue;
      const cond = normalizeCondition(line.condition);
      const qty = Math.max(1, Number(line.qty || 1));

      if (!groups.has(sku)) groups.set(sku, { sku, lines: new Map(), activeTab: "NM" });
      const g = groups.get(sku);
      g.lines.set(cond, (g.lines.get(cond) || 0) + qty);

      // default active tab to a condition that exists in cart
      g.activeTab = tabForCondition(cond);
    }
    return [...groups.values()];
  }

  function tabForCondition(cond) {
    const c = normalizeCondition(cond);
    for (const tab of TAB_ORDER) {
      if (TAB_TO_COND[tab] === c) return tab;
    }
    return "NM";
  }

  // Flatten groups back to cart array [{sku, condition, qty}]
  function flattenGroups(groups) {
    const out = [];
    for (const g of groups) {
      for (const [cond, qty] of g.lines.entries()) {
        const q = Number(qty) || 0;
        if (q > 0) out.push({ sku: g.sku, condition: cond, qty: q });
      }
    }
    return out;
  }

  // Clamp group quantities to stock (per condition) using catalog
  function clampGroupsToStock(groups, catalog) {
    let changed = false;

    for (const g of groups) {
      const product = catalog[g.sku];
      if (!product) continue;

      for (const [cond, qty] of g.lines.entries()) {
        const stock = getStockForCondition(product, cond);
        if (stock > 0 && qty > stock) {
          g.lines.set(cond, stock);
          changed = true;
        }
        if ((Number(g.lines.get(cond)) || 0) <= 0) {
          g.lines.delete(cond);
          changed = true;
        }
      }

      // if active tab is now empty, move to first available in cart, else first with stock
      const activeCond = TAB_TO_COND[g.activeTab] || "Near Mint";
      const activeQty = Number(g.lines.get(activeCond) || 0);

      if (!activeQty) {
        const firstCartCond = [...g.lines.keys()][0];
        if (firstCartCond) g.activeTab = tabForCondition(firstCartCond);
        else g.activeTab = "NM";
      }
    }

    return { groups, changed };
  }

  // ---------- Render ----------
  function render(groups, catalog) {
    if (!listEl) return;

    listEl.innerHTML = "";
    if (msgEl) msgEl.textContent = "";

    if (!groups.length) {
      listEl.innerHTML = `<li class="buy-cart-empty">Your cart is empty.</li>`;
      if (totalEl) totalEl.textContent = "0.00";
      return;
    }

    let totalCents = 0;

    for (const g of groups) {
      const product = catalog[g.sku];
      if (!product) continue;

      const name = String(product.name || g.sku);
      const baseCents = Number(product.price_cents || 0);
      const imgSrc = normalizeImagePath(product.image);

      // tab data
      const perTab = TAB_ORDER.map((tab) => {
        const cond = TAB_TO_COND[tab];
        const qty = Number(g.lines.get(cond) || 0);
        const stock = getStockForCondition(product, cond);
        const unitCents = calcUnitCents(baseCents, cond);
        return { tab, cond, qty, stock, unitCents };
      });

      // totals across all conditions for this SKU
      const groupQty = perTab.reduce((s, x) => s + x.qty, 0);
      const groupTotalCents = perTab.reduce((s, x) => s + (x.qty * x.unitCents), 0);
      totalCents += groupTotalCents;

      // active tab/cond
      const activeTab = String(g.activeTab || "NM").toUpperCase();
      const active = perTab.find(x => x.tab === activeTab) || perTab[0];

      const canPlus = active.stock > 0 ? active.qty < active.stock : true;

      const li = document.createElement("li");
      li.className = "buy-cart-item";
      li.dataset.sku = g.sku;
      li.dataset.activeTab = active.tab;

      // store tab qty/stock/unit in dataset so click handler can be simple
      for (const x of perTab) {
        li.dataset[`qty${x.tab}`] = String(x.qty);
        li.dataset[`stock${x.tab}`] = String(x.stock);
        li.dataset[`unit${x.tab}`] = String(x.unitCents);
      }

      li.innerHTML = `
        <div class="buy-cart-row">
          <img src="${imgSrc}" class="cart-thumb" alt="${name}">

          <div class="buy-cart-info">
            <strong>${name}</strong>

            <div class="cond-tabs cart-cond-tabs" role="tablist" aria-label="Condition">
              ${TAB_ORDER.map((tab) => {
                const x = perTab.find(p => p.tab === tab);
                // show tab enabled if it's in cart OR has stock
                const enabled = (x.qty > 0) || (x.stock > 0);
                const isActive = tab === active.tab;

                return `<button
                  class="cond-tab${isActive ? " active" : ""}${enabled ? "" : " disabled"}"
                  type="button"
                  data-tab="${tab}"
                  aria-disabled="${enabled ? "false" : "true"}"
                >${tab}</button>`;
              }).join("")}
            </div>

            <div class="buy-cart-meta">Condition: <span class="cart-cond-text">${active.cond}</span></div>
            <div class="buy-cart-meta">In stock: <span class="cart-stock-text">${Number.isFinite(active.stock) ? active.stock : 0}</span></div>
            <div class="buy-cart-meta">Unit: <span class="cart-unit-text">${money(active.unitCents)}</span></div>
          </div>

          <div class="buy-cart-actions">
            <div class="cart-controls">
              <button class="cart-minus" type="button">−</button>
              <span class="cart-qty">${active.qty}</span>
              <button class="cart-plus" type="button" ${canPlus ? "" : "disabled"}>+</button>
            </div>

            <div class="cart-line-total">${money(active.qty * active.unitCents)}</div>

            <div class="cart-group-summary">
              In cart (all conditions): <span>${groupQty}</span> • Subtotal: <span>${money(groupTotalCents)}</span>
            </div>

            <button class="cart-remove" type="button">Remove condition</button>
          </div>
        </div>
      `;

      listEl.appendChild(li);
    }

    if (totalEl) totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  // ---------- Init ----------
  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("buy-cart catalog error:", e);
    if (msgEl) msgEl.textContent = "Could not load inventory right now.";
    catalog = {};
  }

  let cart = loadCart();
  let groups = groupCart(cart);

  // Clamp existing cart to stock on page load
  const clamped = clampGroupsToStock(groups, catalog);
  groups = clamped.groups;
  if (clamped.changed) {
    saveCart(flattenGroups(groups));
  }

  render(groups, catalog);

  // ---------- Clear Cart (FIXED) ----------
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      groups = [];
      render(groups, catalog);
    });
  }

  // ---------- Interactions (tabs, +/-, remove) ----------
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".buy-cart-item");
    if (!itemEl) return;

    const sku = String(itemEl.dataset.sku || "").trim();
    if (!sku) return;

    // find group
    const g = groups.find(x => x.sku === sku);
    if (!g) return;

    // Tab switch
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      const tab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab];
      if (!cond) return;

      // allow tab if in cart OR has stock
      const product = catalog[sku];
      const stock = product ? getStockForCondition(product, cond) : 0;
      const inCartQty = Number(g.lines.get(cond) || 0);

      if (inCartQty <= 0 && stock <= 0) return;

      g.activeTab = tab;
      render(groups, catalog); // keep selection (we store it on g)
      return;
    }

    const tab = String(g.activeTab || "NM").toUpperCase();
    const cond = TAB_TO_COND[tab] || "Near Mint";
    const product = catalog[sku];
    const stock = product ? getStockForCondition(product, cond) : 0;

    // Qty +
    if (e.target.closest(".cart-plus")) {
      let qty = Number(g.lines.get(cond) || 0);
      qty = qty + 1;

      // ✅ clamp to stock if stock is known (>0)
      if (stock > 0) qty = Math.min(stock, qty);

      g.lines.set(cond, qty);
      saveCart(flattenGroups(groups));
      render(groups, catalog);
      return;
    }

    // Qty -
    if (e.target.closest(".cart-minus")) {
      let qty = Number(g.lines.get(cond) || 0);
      qty = Math.max(0, qty - 1);

      if (qty <= 0) g.lines.delete(cond);
      else g.lines.set(cond, qty);

      // if no conditions left, remove SKU group entirely
      if (g.lines.size === 0) {
        groups = groups.filter(x => x.sku !== sku);
      } else {
        // if active tab got deleted, move to first available in cart or in-stock
        if (!g.lines.get(cond)) {
          const firstCartCond = [...g.lines.keys()][0];
          g.activeTab = firstCartCond ? tabForCondition(firstCartCond) : "NM";
        }
      }

      saveCart(flattenGroups(groups));
      render(groups, catalog);
      return;
    }

    // Remove active condition
    if (e.target.closest(".cart-remove")) {
      g.lines.delete(cond);

      if (g.lines.size === 0) {
        groups = groups.filter(x => x.sku !== sku);
      } else {
        const firstCartCond = [...g.lines.keys()][0];
        g.activeTab = firstCartCond ? tabForCondition(firstCartCond) : "NM";
      }

      saveCart(flattenGroups(groups));
      render(groups, catalog);
      return;
    }
  });
});


