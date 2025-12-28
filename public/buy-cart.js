document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "buyCart";

  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("buyCartMessage");
  const clearBtn = document.getElementById("buyClearCartBtn");

  if (!listEl || !totalEl) return;

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

  // ---------- helpers ----------
  function showMsg(text, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }

  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function loadCart() {
    return safeParse(localStorage.getItem(CART_KEY) || "[]", []);
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));

    // ✅ update header badges in THIS tab immediately
    window.dispatchEvent(new Event("cart:changed"));
    if (typeof window.updateCartBadges === "function") window.updateCartBadges();
  }

  function moneyCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function normalizeCondition(c) {
    const allowed = Object.keys(CONDITION_MULT);
    const s = String(c || "Near Mint").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function tabForCondition(cond) {
    const c = normalizeCondition(cond);
    for (const tab of TAB_ORDER) {
      if (TAB_TO_COND[tab] === c) return tab;
    }
    return "NM";
  }

  function calcUnitCents(baseCents, condition) {
    const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
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

  // ----- grouping -----
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

      // default active tab to something present in cart
      if (!g._activeSetByUser) g.activeTab = tabForCondition(cond);
    }

    // stable ordering
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

  // clamp current cart to stock
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

      // if active tab now empty, move to first available in cart
      const activeCond = TAB_TO_COND[g.activeTab] || "Near Mint";
      const activeQty = Number(g.lines.get(activeCond) || 0);
      if (!activeQty) {
        const firstCartCond = [...g.lines.keys()][0];
        g.activeTab = firstCartCond ? tabForCondition(firstCartCond) : "NM";
      }
    }

    return { groups, changed };
  }

  // prevent jump
  function renderWithScroll(fn) {
    const prev = window.scrollY;
    fn();
    requestAnimationFrame(() => window.scrollTo(0, prev));
  }

  // ----- render -----
  function render(groups, catalog) {
    listEl.innerHTML = "";
    showMsg("");

    if (!groups.length) {
      listEl.innerHTML = `<li class="cart-item"><div class="cart-card">Your cart is empty.</div></li>`;
      totalEl.textContent = "0.00";
      return;
    }

    let totalCents = 0;

    for (const g of groups) {
      const product = catalog[g.sku];
      if (!product) continue;

      const title = String(product.name || g.sku);
      const baseCents = Number(product.price_cents || 0);
      const imgSrc = normalizeImagePath(product.image);

      // precompute per tab info
      const perTab = TAB_ORDER.map((tab) => {
        const cond = TAB_TO_COND[tab];
        const qty = Number(g.lines.get(cond) || 0);
        const stock = getStockForCondition(product, cond);
        const unitCents = calcUnitCents(baseCents, cond);
        return { tab, cond, qty, stock, unitCents };
      });

      const activeTab = String(g.activeTab || "NM").toUpperCase();
      const active = perTab.find(x => x.tab === activeTab) || perTab[0];

      // totals for sku
      const inCartAll = perTab.reduce((s, x) => s + x.qty, 0);
      const subtotalCents = perTab.reduce((s, x) => s + (x.qty * x.unitCents), 0);
      totalCents += subtotalCents;

      // Tabs: disable when qty in cart for that condition = 0 (matches sell cart behavior)
      const tabsHtml = TAB_ORDER.map((tab) => {
        const x = perTab.find(p => p.tab === tab);
        const disabled = (x.qty <= 0);
        const isActive = (tab === active.tab);
        return `
          <button
            class="cond-tab${isActive ? " active" : ""}${disabled ? " disabled" : ""}"
            type="button"
            data-tab="${tab}"
            aria-disabled="${disabled ? "true" : "false"}"
          >${tab}</button>
        `;
      }).join("");

      const canPlus = active.stock > 0 ? active.qty < active.stock : true;

      const li = document.createElement("li");
      li.className = "cart-item buy-cart-item";
      li.dataset.sku = g.sku;
      li.dataset.activeTab = active.tab;

      li.innerHTML = `
        <div class="cart-card">
          ${imgSrc ? `<img class="cart-thumb" src="${imgSrc}" alt="${title}">` : ""}

          <div class="cart-main">
            <h3 class="cart-title">${title}</h3>

            <div class="cond-tabs" role="tablist" aria-label="Condition">
              ${tabsHtml}
            </div>

            <div class="cart-meta">
              <div>Condition: <strong>${active.cond}</strong></div>
              <div>In stock: <strong>${Number.isFinite(active.stock) ? active.stock : 0}</strong></div>
              <div>Unit: <strong>${moneyCents(active.unitCents)}</strong></div>

              <div class="cart-subline">
                In cart (all conditions): <strong>${inCartAll}</strong> •
                Subtotal: <strong>${moneyCents(subtotalCents)}</strong>
              </div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-controls">
              <button class="qty-minus" type="button">−</button>
              <span class="qty-value">${active.qty}</span>
              <button class="qty-plus" type="button" ${canPlus ? "" : "disabled"}>+</button>
            </div>

            <div class="line-price">${moneyCents(active.qty * active.unitCents)}</div>

            <button class="remove-cond-btn" type="button">Remove condition</button>
          </div>
        </div>
      `;

      // disable minus if qty is 0
      const minus = li.querySelector(".qty-minus");
      if (minus) minus.disabled = active.qty <= 0;

      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  // ---------- init ----------
  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("buy-cart catalog error:", e);
    showMsg("Could not load inventory right now.", false);
    catalog = {};
  }

  let groups = groupCart(loadCart());

  // clamp on load
  const clamped = clampGroupsToStock(groups, catalog);
  groups = clamped.groups;
  if (clamped.changed) saveCart(flattenGroups(groups));

  render(groups, catalog);

  // ---------- clear ----------
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      showMsg("Cart cleared.");
      renderWithScroll(() => render(groups = [], catalog));
    });
  }

  // ---------- interactions ----------
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".buy-cart-item");
    if (!itemEl) return;

    const sku = String(itemEl.dataset.sku || "").trim();
    if (!sku) return;

    const g = groups.find(x => x.sku === sku);
    if (!g) return;

    // tab click
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      const tab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab];
      if (!cond) return;

      // match sell cart behavior: only allow switching to tabs that exist in cart
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

    // plus
    if (e.target.closest(".qty-plus")) {
      let qty = Number(g.lines.get(cond) || 0);
      qty += 1;

      if (stock > 0) qty = Math.min(stock, qty);

      g.lines.set(cond, qty);
      saveCart(flattenGroups(groups));
      renderWithScroll(() => render(groups, catalog));
      return;
    }

    // minus
    if (e.target.closest(".qty-minus")) {
      let qty = Number(g.lines.get(cond) || 0);
      qty = Math.max(0, qty - 1);

      if (qty <= 0) g.lines.delete(cond);
      else g.lines.set(cond, qty);

      if (g.lines.size === 0) {
        groups = groups.filter(x => x.sku !== sku);
      } else if (!g.lines.get(cond)) {
        const firstCartCond = [...g.lines.keys()][0];
        g.activeTab = firstCartCond ? tabForCondition(firstCartCond) : "NM";
      }

      saveCart(flattenGroups(groups));
      renderWithScroll(() => render(groups, catalog));
      return;
    }

    // remove condition
    if (e.target.closest(".remove-cond-btn")) {
      g.lines.delete(cond);

      if (g.lines.size === 0) {
        groups = groups.filter(x => x.sku !== sku);
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


