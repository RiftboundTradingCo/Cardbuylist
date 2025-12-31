document.addEventListener("DOMContentLoaded", async () => {
  console.log("✅ buy-cart.js loaded");

  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("checkoutMsg");
  const clearBtn = document.getElementById("buyClearCartBtn");

  // Stripe checkout elements (make sure your HTML uses these IDs)
  const checkoutBtn = document.getElementById("checkoutBtn");
  const emailInput = document.getElementById("buyEmail");

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

  // 🔔 notify header badges + mini cart
  window.dispatchEvent(new Event("cart:changed"));
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

      // choose active tab only if it doesn't already exist
      // (prevents it snapping back to NM after +/-)
      if (!g.activeTab || g.activeTab === "NM") {
        g.activeTab = tabForCondition(cond);
      }
    }
    return [...groups.values()];
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

      // if active tab is now empty, move to first available in cart
      const activeCond = TAB_TO_COND[g.activeTab] || "Near Mint";
      const activeQty = Number(g.lines.get(activeCond) || 0);

      if (!activeQty) {
        const firstCartCond = [...g.lines.keys()][0];
        g.activeTab = firstCartCond ? tabForCondition(firstCartCond) : "NM";
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

      // ✅ keep count accurate for empty cart too
      const countEl = document.getElementById("buyCartCount");
      if (countEl) countEl.textContent = "0";

      return;
    }

    let totalCents = 0;

    for (const g of groups) {
      const product = catalog[g.sku];
      if (!product) continue;

      const name = String(product.name || g.sku);
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
      const groupTotalCents = perTab.reduce((s, x) => s + x.qty * x.unitCents, 0);
      totalCents += groupTotalCents;

      const activeTab = String(g.activeTab || "NM").toUpperCase();
      const active = perTab.find((x) => x.tab === activeTab) || perTab[0];

      const canPlus = active.stock > 0 ? active.qty < active.stock : true;

      const li = document.createElement("li");
      li.className = "buy-cart-item";
      li.dataset.sku = g.sku;
      li.dataset.activeTab = active.tab;

      li.innerHTML = `
        <div class="cart-card">
          ${imgSrc ? `<img src="${imgSrc}" class="cart-thumb" alt="${name}">` : ""}

          <div class="cart-main">
            <h3 class="cart-title">${name}</h3>

            <div class="cond-tabs cart-cond-tabs" role="tablist" aria-label="Condition">
              ${TAB_ORDER.map((tab) => {
                const x = perTab.find((p) => p.tab === tab);
                const enabled = x.qty > 0; // buy cart: only enable tabs that exist in cart
                const isActive = tab === active.tab;

                return `<button
                  class="cond-tab${isActive ? " active" : ""}${enabled ? "" : " disabled"}"
                  type="button"
                  data-tab="${tab}"
                  aria-disabled="${enabled ? "false" : "true"}"
                >${tab}</button>`;
              }).join("")}
            </div>

            <div class="cart-meta">
              <div>Condition: <strong class="cart-cond-text">${active.cond}</strong></div>
              <div>In stock: <strong class="cart-stock-text">${Number.isFinite(active.stock) ? active.stock : 0}</strong></div>
              <div>Unit: <strong class="cart-unit-text">${money(active.unitCents)}</strong></div>

              <div class="cart-subline">
                In cart (all conditions): <strong>${groupQty}</strong> •
                Subtotal: <strong>${money(groupTotalCents)}</strong>
              </div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-controls">
              <button class="cart-minus" type="button">−</button>
              <span class="cart-qty">${active.qty}</span>
              <button class="cart-plus" type="button" ${canPlus ? "" : "disabled"}>+</button>
            </div>

            <div class="line-price">${money(active.qty * active.unitCents)}</div>

            <button class="cart-remove" type="button">Remove condition</button>
          </div>
        </div>
      `;

      listEl.appendChild(li);
    }

    // ✅ totals
    if (totalEl) totalEl.textContent = (totalCents / 100).toFixed(2);

    // ✅ cart count moved to end so it matches what’s rendered
    const countEl = document.getElementById("buyCartCount");
    if (countEl) {
      const cartCount = groups.reduce((sum, g) => {
        let n = 0;
        for (const qty of g.lines.values()) n += Number(qty || 0);
        return sum + n;
      }, 0);
      countEl.textContent = String(cartCount);
    }
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

  const clamped = clampGroupsToStock(groups, catalog);
  groups = clamped.groups;
  if (clamped.changed) {
    saveCart(flattenGroups(groups));
  }

  render(groups, catalog);

  // ✅ Shipping calculator listener (ONLY ONCE, not inside render)
  const shipBtn = document.getElementById("shippingCalcBtn");
  if (shipBtn) {
    shipBtn.addEventListener("click", () => {
      alert("Shipping calculator coming soon!");
    });
  }

  // ---------- Clear Cart ----------
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      groups = [];
      render(groups, catalog);
    });
  }

  // ---------- Stripe Checkout ----------
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      console.log("[Checkout] Clicked");

      try {
        checkoutBtn.disabled = true;

        const email = String(emailInput?.value || "").trim();
        const cart = loadCart();

        console.log("[Checkout] cart", cart);

        if (!Array.isArray(cart) || cart.length === 0) {
          alert("Your cart is empty.");
          return;
        }

        const res = await fetch("/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, cart }),
        });

        console.log("[Checkout] HTTP", res.status);

        const data = await res.json().catch(() => ({}));
        console.log("[Checkout] response", data);

        if (!res.ok || !data.ok || !data.url) {
          alert(data.error || `Checkout failed (HTTP ${res.status})`);
          return;
        }

        window.location.assign(data.url);
      } catch (err) {
        console.error("[Checkout] error", err);
        alert(err?.message || "Could not start checkout.");
      } finally {
        checkoutBtn.disabled = false;
      }
    });
  } else {
    console.warn("[Checkout] checkoutBtn not found on page");
  }

  // ---------- Interactions (tabs, +/-, remove) ----------
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".buy-cart-item");
    if (!itemEl) return;

    const sku = String(itemEl.dataset.sku || "").trim();
    if (!sku) return;

    const g = groups.find((x) => x.sku === sku);
    if (!g) return;

    // Tab switch
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      const tab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      const cond = TAB_TO_COND[tab];
      if (!cond) return;

      const inCartQty = Number(g.lines.get(cond) || 0);
      if (inCartQty <= 0) return; // buy cart: only tabs in cart

      g.activeTab = tab;
      render(groups, catalog);
      return;
    }

    const tab = String(g.activeTab || "NM").toUpperCase();
    const cond = TAB_TO_COND[tab] || "Near Mint";
    const product = catalog[sku];
    const stock = product ? getStockForCondition(product, cond) : 0;

    // Qty +
    if (e.target.closest(".cart-plus")) {
      let qty = Number(g.lines.get(cond) || 0);
      qty += 1;

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

      if (g.lines.size === 0) {
        groups = groups.filter((x) => x.sku !== sku);
      } else {
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
        groups = groups.filter((x) => x.sku !== sku);
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


