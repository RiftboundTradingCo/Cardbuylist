document.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("buyCartMessage");
  const clearBtn = document.getElementById("buyClearCartBtn");

  // optional checkout UI ids (only used if they exist)
  const checkoutBtn = document.getElementById("buyCheckoutBtn");
  const receiptEmailInput = document.getElementById("buyReceiptEmail");

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

  // ---------- Helpers ----------
  function loadCart() {
    try {
      const raw = localStorage.getItem("buyCart");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  function saveCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }
  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }
  function normalizeCondition(c) {
    const allowed = Object.keys(CONDITION_MULT);
    const s = String(c || "Near Mint").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }
  function tabForCondition(cond) {
    const c = normalizeCondition(cond);
    return Object.keys(TAB_TO_COND).find(t => TAB_TO_COND[t] === c) || "NM";
  }
  function calcUnitCents(baseCents, condition) {
    const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }
  function getStockForCondition(product, condition) {
    const cond = normalizeCondition(condition);
    if (product && product.stock && typeof product.stock === "object") {
      return Number(product.stock[cond] ?? 0);
    }
    return Number(product?.stock ?? 0);
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

  // Group cart lines by SKU
  function groupCart(cart) {
    const groups = new Map(); // sku -> { sku, lines: Map(cond->qty) }
    for (const line of cart) {
      const sku = String(line.sku || "").trim();
      if (!sku) continue;
      const cond = normalizeCondition(line.condition);
      const qty = Math.max(1, Number(line.qty || 1));
      if (!groups.has(sku)) groups.set(sku, { sku, lines: new Map() });
      const g = groups.get(sku);
      g.lines.set(cond, (g.lines.get(cond) || 0) + qty);
    }
    return [...groups.values()];
  }

  // Write a single condition qty back into underlying cart array
  function setCartQty(cart, sku, condition, qty) {
    const cond = normalizeCondition(condition);
    const newQty = Math.max(0, Number(qty) || 0);

    // remove all lines for that sku+cond
    const kept = cart.filter(
      (x) => !(String(x.sku || "").trim() === sku && normalizeCondition(x.condition) === cond)
    );

    if (newQty > 0) {
      kept.push({ sku, condition: cond, qty: newQty });
    }
    return kept;
  }

  // ---------- Render ----------
  function render(cart, catalog) {
    if (!listEl) return;

    listEl.innerHTML = "";
    if (msgEl) msgEl.textContent = "";

    if (!Array.isArray(cart) || cart.length === 0) {
      listEl.innerHTML = `<li class="buy-cart-empty">Your cart is empty.</li>`;
      if (totalEl) totalEl.textContent = "0.00";
      return;
    }

    const groups = groupCart(cart);
    let totalCents = 0;

    for (const g of groups) {
      const sku = g.sku;
      const product = catalog?.[sku];
      const name = product ? String(product.name || sku) : sku;
      const baseCents = product ? Number(product.price_cents || 0) : 0;
      const imgSrc = product ? normalizeImagePath(product.image) : "";

      // Build per-tab info
      const perTab = TAB_ORDER.map((tab) => {
        const cond = TAB_TO_COND[tab];
        const qty = g.lines.get(cond) || 0;
        const stock = product ? getStockForCondition(product, cond) : 0;
        const unitCents = calcUnitCents(baseCents, cond);
        return { tab, cond, qty, stock, unitCents };
      });

      // Pick active tab: first one with qty>0, else first with stock>0, else NM
      let activeTab =
        perTab.find(x => x.qty > 0)?.tab ||
        perTab.find(x => x.stock > 0)?.tab ||
        "NM";

      // Clamp any qty to stock if known (>0)
      let changed = false;
      for (const x of perTab) {
        if (x.stock > 0 && x.qty > x.stock) {
          // clamp
          cart = setCartQty(cart, sku, x.cond, x.stock);
          x.qty = x.stock;
          changed = true;
        }
      }
      if (changed) saveCart(cart);

      // Compute group totals
      let groupQty = 0;
      let groupTotalCents = 0;
      for (const x of perTab) {
        groupQty += x.qty;
        groupTotalCents += x.qty * x.unitCents;
      }
      totalCents += groupTotalCents;

      const li = document.createElement("li");
      li.className = "buy-cart-item";
      li.dataset.sku = sku;
      li.dataset.activeTab = activeTab;

      // For fast lookup on click
      for (const x of perTab) {
        li.dataset[`qty${x.tab}`] = String(x.qty);
        li.dataset[`stock${x.tab}`] = String(x.stock);
        li.dataset[`unit${x.tab}`] = String(x.unitCents);
      }

      const active = perTab.find(x => x.tab === activeTab) || perTab[0];
      const canPlus = active.stock <= 0 ? true : active.qty < active.stock; // if stock unknown (0), allow

      li.innerHTML = `
        <div class="buy-cart-row">
          <div class="buy-cart-img">
            ${
              imgSrc
                ? `<img class="zoomable" src="${imgSrc}" alt="${name}">`
                : `<div class="buy-cart-img-placeholder"></div>`
            }
          </div>

          <div class="buy-cart-info">
            <div class="buy-cart-title">${name}</div>
            <div class="buy-cart-meta">SKU: <span>${sku}</span></div>

            <div class="cond-tabs cart-cond-tabs" role="tablist" aria-label="Condition">
              ${TAB_ORDER.map((tab) => {
                const cond = TAB_TO_COND[tab];
                const x = perTab.find(p => p.tab === tab);
                const disabled = (x.stock <= 0 && x.qty <= 0); // allow tab if it’s in cart even if stock is 0 (you’ll clamp elsewhere)
                const isActive = tab === activeTab;
                return `<button
                  class="cond-tab${isActive ? " active" : ""}${disabled ? " disabled" : ""}"
                  type="button"
                  data-tab="${tab}"
                  aria-disabled="${disabled ? "true" : "false"}"
                >${tab}</button>`;
              }).join("")}
            </div>

            <div class="cart-active-meta">
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

  // ---------- Load ----------
  let cart = loadCart();
  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("buy-cart catalog error:", e);
    if (msgEl) msgEl.textContent = "Could not load inventory right now.";
  }

  render(cart, catalog);

  // ---------- Interactions (delegation) ----------
  function getActiveTabFromRow(row) {
    return String(row.dataset.activeTab || "NM").toUpperCase();
  }
  function setActiveTabOnRow(row, tab) {
    const t = String(tab || "NM").toUpperCase();
    row.dataset.activeTab = t;

    row.querySelectorAll(".cond-tab").forEach(b => {
      b.classList.toggle("active", String(b.dataset.tab || "").toUpperCase() === t);
    });

    const cond = TAB_TO_COND[t];
    const stock = Number(row.dataset[`stock${t}`] || 0);
    const unit = Number(row.dataset[`unit${t}`] || 0);
    const qty = Number(row.dataset[`qty${t}`] || 0);

    const condEl = row.querySelector(".cart-cond-text");
    const stockEl = row.querySelector(".cart-stock-text");
    const unitEl = row.querySelector(".cart-unit-text");
    const qtyEl = row.querySelector(".cart-qty");
    const lineEl = row.querySelector(".cart-line-total");
    const plusBtn = row.querySelector(".cart-plus");

    if (condEl) condEl.textContent = cond;
    if (stockEl) stockEl.textContent = String(Number.isFinite(stock) ? stock : 0);
    if (unitEl) unitEl.textContent = money(unit);
    if (qtyEl) qtyEl.textContent = String(qty);
    if (lineEl) lineEl.textContent = money(qty * unit);

    const canPlus = stock <= 0 ? true : qty < stock;
    if (plusBtn) plusBtn.disabled = !canPlus;
  }

  document.addEventListener("click", (e) => {
    const row = e.target.closest(".buy-cart-item");
    if (!row) return;

    // Tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;
      setActiveTabOnRow(row, tabBtn.dataset.tab);
      return;
    }

    const minus = e.target.closest(".cart-minus");
    const plus = e.target.closest(".cart-plus");
    const removeCond = e.target.closest(".cart-remove");

    if (!minus && !plus && !removeCond) return;

    const sku = String(row.dataset.sku || "").trim();
    const tab = getActiveTabFromRow(row);
    const cond = TAB_TO_COND[tab];

    let qty = Number(row.dataset[`qty${tab}`] || 0);
    const stock = Number(row.dataset[`stock${tab}`] || 0);

    cart = loadCart();

    if (removeCond) {
      cart = setCartQty(cart, sku, cond, 0);
      saveCart(cart);
      render(cart, catalog);
      return;
    }

    if (minus) qty = Math.max(0, qty - 1);

    if (plus) {
      if (stock > 0) qty = Math.min(stock, qty + 1);
      else qty = qty + 1; // unknown stock
    }

    cart = setCartQty(cart, sku, cond, qty);
    saveCart(cart);
    render(cart, catalog);
  });

  // Clear cart
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      render([], catalog);
    });
  }

  // Checkout (still sends the underlying cart array, unchanged format)
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async () => {
      try {
        const email = receiptEmailInput ? receiptEmailInput.value.trim() : "";
        const cartNow = loadCart();
        if (!cartNow.length) {
          if (msgEl) msgEl.textContent = "Your cart is empty.";
          return;
        }

        const res = await fetch("/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cart: cartNow, receiptEmail: email })
        });

        const data = await res.json();
        if (!res.ok || !data?.url) {
          if (msgEl) msgEl.textContent = "Checkout error: Could not create checkout session";
          return;
        }
        window.location.href = data.url;
      } catch (err) {
        console.error(err);
        if (msgEl) msgEl.textContent = "Checkout error: Could not create checkout session";
      }
    });
  }

  // Zoom modal (if present on this page)
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalClose = document.getElementById("imageModalClose");

  if (modal && modalImg && modalClose) {
    document.addEventListener("click", (e) => {
      const img = e.target.closest(".buy-cart-item img.zoomable");
      if (!img) return;
      modalImg.src = img.src;
      modal.classList.remove("hidden");
    });

    function closeModal() {
      modal.classList.add("hidden");
      modalImg.src = "";
    }

    modalClose.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  }
});
