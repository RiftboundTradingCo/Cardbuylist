document.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("buyCartMessage");
  const clearBtn = document.getElementById("buyClearCartBtn");

  if (!listEl) return;

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
    return Number(product?.stock ?? 0);
  }

  function tabForCondition(cond) {
    const c = normalizeCondition(cond);
    for (const tab of TAB_ORDER) {
      if (TAB_TO_COND[tab] === c) return tab;
    }
    return "NM";
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

      // only set activeTab if it hasn't been set by user yet
      if (!g._activeSetByUser) g.activeTab = tabForCondition(cond);
    }

    return [...groups.values()];
  }

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

      const activeCond = TAB_TO_COND[g.activeTab] || "Near Mint";
      const activeQty = Number(g.lines.get(activeCond) || 0);
      if (!activeQty) {
        const firstCartCond = [...g.lines.keys()][0];
        g.activeTab = firstCartCond ? tabForCondition(firstCartCond) : "NM";
      }
    }

    return { groups, changed };
  }

  // Prevent "jumping" when re-rendering
  function renderWithScroll(fn) {
    const y = window.scrollY;
    fn();
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  function render(groups, catalog) {
    listEl.innerHTML = "";
    if (msgEl) msgEl.textContent = "";

    if (!groups.length) {
      listEl.innerHTML = `<li class="cart-item"><div class="cart-card">Your cart is empty.</div></li>`;
      if (totalEl) totalEl.textContent = "0.00";
      return;
    }

    let totalCents = 0;

    for (const g of groups) {
      const product = catalog[g.sku];
      if (!product) continue;

      const title = String(product.name || g.sku);
      const baseCents = Number(product.price_cents || 0);
      const imgSrc = normalizeImagePath(product.image);

      const perTab = TAB_ORDER.map((tab) => {
        const cond = TAB_TO_COND[tab];
        const qty = Number(g.lines.get(cond) || 0);
        const stock = getStockForCondition(product, cond);
        const unitCents = calcUnitCents(baseCents, cond);
        return { tab, cond, qty, stock, unitCents };
      });

      const groupQty = perTab.reduce((s, x) => s + x.qty, 0);
      const groupSubtotalCents = perTab.reduce((s, x) => s + (x.qty * x.unitCents), 0);
      totalCents += groupSubtotalCents;

      const activeTab = String(g.activeTab || "NM").toUpperCase();
      const active = perTab.find((x) => x.tab === activeTab) || perTab[0];

      const activeQty = active.qty;
      const activeStock = active.stock;
      const canPlus = activeStock > 0 ? activeQty < activeStock : true;

      const tabsHtml = TAB_ORDER.map((tab) => {
        const x = perTab.find((p) => p.tab === tab);
        const isActive = x.tab === active.tab;

        // Match sell cart behavior: disable tabs with 0 qty in cart
        const enabled = (x.qty > 0);

        return `<button
          class="cond-tab${isActive ? " active" : ""}${enabled ? "" : " disabled"}"
          type="button"
          data-tab="${tab}"
          aria-disabled="${enabled ? "false" : "true"}"
        >${tab}</button>`;
      }).join("");

      const li = document.createElement("li");
      li.className = "cart-item buy-cart-item";
      li.dataset.sku = g.sku;

      li.innerHTML = `
        <div class="cart-card">
          ${imgSrc ? `<img class="cart-thumb" src="${imgSrc}" alt="${title}">` : ""}

          <div class="cart-main">
            <h3 class="cart-title">${title}</h3>

            <div class="cond-tabs" role="tablist" aria-label="Condition">
              ${tabsHtml}
            </div>

            <div class="cart-meta">
              <div>Condition: <strong class="cart-cond-text">${active.cond}</strong></div>
              <div>In stock: <strong class="cart-stock-text">${Number.isFinite(activeStock) ? activeStock : 0}</strong></div>
              <div>Unit: <strong class="cart-unit-text">${money(active.unitCents)}</strong></div>

              <div class="cart-subline">
                In cart (all conditions): <strong>${groupQty}</strong> •
                Subtotal: <strong>${money(groupSubtotalCents)}</strong>
              </div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-controls">
              <button class="qty-minus" type="button">−</button>
              <span class="qty-value">${activeQty}</span>
              <button class="qty-plus" type="button" ${canPlus ? "" : "disabled"}>+</button>
            </div>

            <div class="line-price">${money(activeQty * active.unitCents)}</div>

            <button class="remove-cond-btn" type="button">Remove condition</button>
          </div>
        </div>
      `;

      // Disable minus when qty is 0
      const minus = li.querySelector(".qty-minus");
      if (minus) minus.disabled = activeQty <= 0;

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

  let groups = groupCart(loadCart());
  const clamped = clampGroupsToStock(groups, catalog);
  groups = clamped.groups;
  if (clamped.changed) saveCart(flattenGroups(groups));

  render(groups, catalog);

  // ---------- Clear Cart ----------
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      groups = [];
      renderWithScroll(() => render(groups, catalog));
    });
  }

  // ---------- Interactions ----------
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".buy-cart-item");
    if (!itemEl) return;

    const sku = String(itemEl.dataset.sku || "").trim();
    if (!sku) return;

    const g = groups.find((x) => x.sku === sku);
    if (!g) return;

    // Tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      const tab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab];
      if (!cond) return;

      // only allow switching to a condition that exists in cart (matches sell cart)
      const inCartQty = Number(g.lines.get(cond) || 0);
      if (inCartQty <= 0) return;

      g.activeTab = tab;
      g._activeSetByUser = true;

      renderWithScroll(() => render(groups, catalog));
      return;
    }

    const tab = String(g.activeTab || "NM").toUpperCase();
    const cond = TAB_TO_COND[tab] || "Near Mint";
    const product = catalog[sku];
    const stock = product ? getStockForCondition(product, cond) : 0;

    // +
    if (e.target.closest(".qty-plus")) {
      let qty = Number(g.lines.get(cond) || 0);
      qty += 1;

      if (stock > 0) qty = Math.min(stock, qty);

      g.lines.set(cond, qty);
      saveCart(flattenGroups(groups));
      renderWithScroll(() => render(groups, catalog));
      return;
    }

    // -
    if (e.target.closest(".qty-minus")) {
      let qty = Number(g.lines.get(cond) || 0);
      qty = Math.max(0, qty - 1);

      if (qty <= 0) g.lines.delete(cond);
      else g.lines.set(cond, qty);

      if (g.lines.size === 0) {
        groups = groups.filter((x) => x.sku !== sku);
      } else if (!g.lines.get(cond)) {
        const firstCartCond = [...g.lines.keys()][0];
        g.activeTab = firstCartCond ? tabForCondition(firstCartCond) : "NM";
      }

      saveCart(flattenGroups(groups));
      renderWithScroll(() => render(groups, catalog));
      return;
    }

    // Remove condition
    if (e.target.closest(".remove-cond-btn")) {
      g.lines.delete(cond);

      if (g.lines.size === 0) {
        groups = groups.filter((x) => x.sku !== sku);
      } else {
        const firstCartCond = [...g.lines.keys()][0];
        g.activeTab = firstCartCond ? tabForCondition(firstCartCond) : "NM";
      }

      saveCart(flattenGroups(groups));
      renderWithScroll(() => render(groups, catalog));
      return;
    }
  });
});



