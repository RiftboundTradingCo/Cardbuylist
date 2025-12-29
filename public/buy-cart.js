/* public/buy-cart.js
   Buy Cart (group by SKU, tabs per condition, stock clamp, badge updates, Stripe checkout)
*/
document.addEventListener("DOMContentLoaded", async () => {
  // ===== DOM =====
  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("buyCartMessage");
  const clearBtn = document.getElementById("buyClearCartBtn");

  const checkoutBtn = document.getElementById("stripeCheckoutBtn"); // your button id
  const emailInput = document.getElementById("buyEmail");           // your email input id

  // ===== CONFIG =====
  const CART_KEY = "buyCart";

  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played"
  };
  const COND_TO_TAB = {
    "Near Mint": "NM",
    "Lightly Played": "LP",
    "Moderately Played": "MP",
    "Heavily Played": "HP"
  };

  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  // ===== HELPERS =====
  function moneyCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function showMsg(text, kind = "") {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.className = kind ? `cart-message ${kind}` : "cart-message";
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

  function dispatchCartUpdated() {
    // If you have cart-badge.js listening, this is the cleanest trigger.
    window.dispatchEvent(new CustomEvent("cart:updated", { detail: { key: CART_KEY } }));

    // Fallback: update any badge elements immediately if present
    const count = loadCart().reduce((s, it) => s + (Number(it.qty) || 0), 0);
    document.querySelectorAll('[data-cart="buy"], #buyCartBadge').forEach((el) => {
      if (!el) return;
      el.textContent = String(count);
      el.classList.toggle("hidden", count <= 0);
    });
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    dispatchCartUpdated();
  }

  function normalizeCondition(c) {
    const s = String(c || "").trim();
    if (TAB_TO_COND[s]) return TAB_TO_COND[s]; // handle NM/LP/MP/HP stored
    const allowed = Object.keys(CONDITION_MULT);
    return allowed.includes(s) ? s : "Near Mint";
  }

  function calcUnitCents(baseCents, condition) {
    const cond = normalizeCondition(condition);
    const mult = CONDITION_MULT[cond] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    const withSlash = s.startsWith("/") ? s : `/${s}`;
    return encodeURI(withSlash);
  }

  function getStockForCondition(product, condition) {
    const cond = normalizeCondition(condition);
    if (product?.stock && typeof product.stock === "object") {
      return Number(product.stock[cond] ?? 0);
    }
    return Number(product?.stock ?? 0); // fallback old format
  }

  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.catalog) throw new Error("Bad catalog JSON");
    return data.catalog;
  }

  // ===== GROUPING =====
  function groupCart(cart) {
    // sku -> { sku, name?, lines: Map(cond -> qty), activeTab }
    const groups = new Map();

    for (const it of cart) {
      const sku = String(it?.sku || "").trim();
      if (!sku) continue;

      const cond = normalizeCondition(it.condition);
      const qty = Math.max(0, Number(it.qty || 0));

      if (!groups.has(sku)) {
        groups.set(sku, {
          sku,
          lines: new Map(),
          activeTab: "NM"
        });
      }

      const g = groups.get(sku);
      g.lines.set(cond, (g.lines.get(cond) || 0) + qty);
    }

    // choose active tab = first condition with qty > 0 (stable), NOT "last item added"
    for (const g of groups.values()) {
      g.activeTab = "NM";
      for (const tab of TAB_ORDER) {
        const cond = TAB_TO_COND[tab];
        if ((Number(g.lines.get(cond) || 0)) > 0) {
          g.activeTab = tab;
          break;
        }
      }
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
        if (stock >= 0 && qty > stock) {
          g.lines.set(cond, stock);
          changed = true;
        }
        if ((Number(g.lines.get(cond)) || 0) <= 0) {
          g.lines.delete(cond);
          changed = true;
        }
      }

      // keep active tab if still has qty, otherwise jump to first condition in cart
      const activeCond = TAB_TO_COND[g.activeTab] || "Near Mint";
      const activeQty = Number(g.lines.get(activeCond) || 0);
      if (!activeQty) {
        const first = [...g.lines.keys()][0];
        g.activeTab = first ? (COND_TO_TAB[normalizeCondition(first)] || "NM") : "NM";
      }
    }

    return { groups, changed };
  }

  // ===== RENDER =====
  function render() {
    if (!listEl) return;

    const prevScroll = window.scrollY;

    const cart = loadCart();
    groups = groupCart(cart);

    // clamp to stock each render (keeps things consistent)
    const clamped = clampGroupsToStock(groups, catalog);
    groups = clamped.groups;
    if (clamped.changed) saveCart(flattenGroups(groups));

    listEl.innerHTML = "";
    showMsg("");

    if (!groups.length) {
      listEl.innerHTML = `<li class="cart-empty">Your cart is empty.</li>`;
      if (totalEl) totalEl.textContent = "0.00";
      window.scrollTo(0, prevScroll);
      return;
    }

    let totalCents = 0;

    for (const g of groups) {
      const product = catalog[g.sku];
      if (!product) continue;

      const title = String(product.name || g.sku);
      const baseCents = Number(product.price_cents || 0);
      const img = normalizeImagePath(product.image);

      const activeTab = String(g.activeTab || "NM").toUpperCase();
      const activeCond = TAB_TO_COND[activeTab] || "Near Mint";
      const activeQty = Number(g.lines.get(activeCond) || 0);

      // totals across all conditions for this SKU
      let inCartAll = 0;
      let subtotalCents = 0;

      for (const tab of TAB_ORDER) {
        const cond = TAB_TO_COND[tab];
        const q = Number(g.lines.get(cond) || 0);
        if (q > 0) {
          inCartAll += q;
          subtotalCents += calcUnitCents(baseCents, cond) * q;
        }
      }

      totalCents += subtotalCents;

      const unitCents = calcUnitCents(baseCents, activeCond);
      const stock = getStockForCondition(product, activeCond);
      const canPlus = stock > 0 ? activeQty < stock : true;

      // tabs: enabled if qty in cart for that condition > 0 OR stock > 0
      const tabsHtml = TAB_ORDER.map((tab) => {
        const cond = TAB_TO_COND[tab];
        const q = Number(g.lines.get(cond) || 0);
        const st = getStockForCondition(product, cond);
        const enabled = q > 0 || st > 0;
        const isActive = tab === activeTab;

        return `
          <button
            class="cond-tab${isActive ? " active" : ""}${enabled ? "" : " disabled"}"
            type="button"
            data-tab="${tab}"
            aria-disabled="${enabled ? "false" : "true"}"
          >${tab}</button>
        `;
      }).join("");

      const li = document.createElement("li");
      li.className = "cart-item";              // matches your “nice” cart CSS
      li.dataset.sku = g.sku;
      li.dataset.activeTab = activeTab;

      li.innerHTML = `
        <div class="cart-card">
          ${img ? `<img class="cart-thumb" src="${img}" alt="${title}">` : ""}

          <div class="cart-main">
            <h3 class="cart-title">${title}</h3>

            <div class="cond-tabs" role="tablist" aria-label="Condition">
              ${tabsHtml}
            </div>

            <div class="cart-meta">
              <div>Condition: <strong>${activeCond}</strong></div>
              <div>In stock: <strong>${Number.isFinite(stock) ? stock : 0}</strong></div>
              <div>Unit: <strong>${moneyCents(unitCents)}</strong></div>

              <div class="cart-subline">
                In cart (all conditions): <strong>${inCartAll}</strong> •
                Subtotal: <strong>${moneyCents(subtotalCents)}</strong>
              </div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-controls">
              <button class="qty-minus" type="button" ${activeQty <= 0 ? "disabled" : ""}>−</button>
              <span class="qty-value">${activeQty}</span>
              <button class="qty-plus" type="button" ${canPlus ? "" : "disabled"}>+</button>
            </div>

            <div class="line-price">${moneyCents(unitCents * activeQty)}</div>

            <button class="remove-cond-btn" type="button">Remove condition</button>
          </div>
        </div>
      `;

      listEl.appendChild(li);
    }

    if (totalEl) totalEl.textContent = (totalCents / 100).toFixed(2);

    // restore scroll so items don't "jump to bottom"
    window.scrollTo(0, prevScroll);
  }

  // ===== INIT =====
  let catalog = {};
  let groups = [];

  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("buy-cart catalog error:", e);
    showMsg("Could not load inventory right now.", "error");
    catalog = {};
  }

  // initial render
  render();

  // ===== CLEAR CART =====
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      showMsg("Cart cleared.");
      render();
    });
  }

  // ===== STRIPE CHECKOUT =====
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async () => {
      try {
        showMsg("");
        checkoutBtn.disabled = true;

        const email = String(emailInput?.value || "").trim();
        const cart = loadCart();

        if (!cart.length) {
          alert("Your cart is empty.");
          checkoutBtn.disabled = false;
          return;
        }

        const res = await fetch("/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, cart })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.url) {
          throw new Error(data.error || `Checkout failed (HTTP ${res.status})`);
        }

        window.location.href = data.url;
      } catch (err) {
        console.error("Stripe checkout error:", err);
        alert(err.message || "Could not start checkout.");
      } finally {
        checkoutBtn.disabled = false;
      }
    });
  }

  // ===== CLICK HANDLERS (delegation) =====
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".cart-item");
    if (!itemEl) return;

    const sku = String(itemEl.dataset.sku || "").trim();
    if (!sku) return;

    // rebuild groups from storage (source of truth)
    const cart = loadCart();
    groups = groupCart(cart);
    const g = groups.find(x => x.sku === sku);
    if (!g) return;

    // restore active tab from DOM (so tab stays put even after +/-)
    g.activeTab = String(itemEl.dataset.activeTab || g.activeTab || "NM").toUpperCase();

    // Tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      const tab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      g.activeTab = tab;

      // write back DOM state so it doesn't flip
      itemEl.dataset.activeTab = tab;

      // save cart unchanged; just re-render
      // (active tab is UI-only; we don't need to store it in localStorage)
      render();
      return;
    }

    const activeTab = String(itemEl.dataset.activeTab || g.activeTab || "NM").toUpperCase();
    const activeCond = TAB_TO_COND[activeTab] || "Near Mint";
    const product = catalog[sku];
    const stock = product ? getStockForCondition(product, activeCond) : 0;

    // Qty +
    if (e.target.closest(".qty-plus")) {
      const cur = Number(g.lines.get(activeCond) || 0);
      let next = cur + 1;
      if (stock > 0) next = Math.min(stock, next);

      g.lines.set(activeCond, next);
      saveCart(flattenGroups(groups));

      // keep the same active tab after render
      itemEl.dataset.activeTab = activeTab;
      render();
      return;
    }

    // Qty -
    if (e.target.closest(".qty-minus")) {
      const cur = Number(g.lines.get(activeCond) || 0);
      const next = Math.max(0, cur - 1);

      if (next <= 0) g.lines.delete(activeCond);
      else g.lines.set(activeCond, next);

      // if group empty, remove it
      if (g.lines.size === 0) {
        groups = groups.filter(x => x.sku !== sku);
      }

      saveCart(flattenGroups(groups));
      itemEl.dataset.activeTab = activeTab;
      render();
      return;
    }

    // Remove active condition
    if (e.target.closest(".remove-cond-btn")) {
      g.lines.delete(activeCond);
      if (g.lines.size === 0) {
        groups = groups.filter(x => x.sku !== sku);
      }
      saveCart(flattenGroups(groups));
      itemEl.dataset.activeTab = activeTab;
      render();
      return;
    }
  });
});



