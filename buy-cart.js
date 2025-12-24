document.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("buyCartMessage");
  const clearBtn = document.getElementById("buyClearCartBtn");

  // If you have these elements (from your checkout UI), we support them too:
  const checkoutBtn = document.getElementById("buyCheckoutBtn");
  const receiptEmailInput = document.getElementById("buyReceiptEmail");

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

  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  function normalizeCondition(c) {
    const allowed = Object.keys(CONDITION_MULT);
    const s = String(c || "Near Mint").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function calcUnitCents(baseCents, condition) {
    const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }

  function getStockForCondition(product, condition) {
    const cond = normalizeCondition(condition);

    // New format: stock is an object by condition
    if (product && product.stock && typeof product.stock === "object") {
      return Number(product.stock[cond] ?? 0);
    }
    // Old format fallback
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

    let totalCents = 0;

    cart.forEach((ci, idx) => {
      const sku = String(ci.sku || "").trim();
      const condition = normalizeCondition(ci.condition);
      const qty = Math.max(1, Number(ci.qty || 1));

      const product = catalog?.[sku];
      const name = product ? String(product.name || sku) : sku;

      const baseCents = product ? Number(product.price_cents || 0) : 0;
      const unitCents = calcUnitCents(baseCents, condition);

      const stock = product ? getStockForCondition(product, condition) : 0;

      // Enforce stock if known (>0)
      const clampedQty = stock > 0 ? Math.min(qty, stock) : qty;
      if (clampedQty !== qty) cart[idx].qty = clampedQty;

      const lineCents = unitCents * clampedQty;
      totalCents += lineCents;

      const imgSrc = product ? normalizeImagePath(product.image) : "";

      const li = document.createElement("li");
      li.className = "buy-cart-item";

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
            <div class="buy-cart-meta">Condition: <span>${condition}</span></div>
            <div class="buy-cart-meta">In stock: <span>${Number.isFinite(stock) ? stock : 0}</span></div>
            <div class="buy-cart-meta">Unit: <span>${money(unitCents)}</span></div>
          </div>

          <div class="buy-cart-actions">
            <div class="cart-controls">
              <button class="cart-minus" type="button" data-i="${idx}">−</button>
              <span class="cart-qty">${clampedQty}</span>
              <button class="cart-plus" type="button" data-i="${idx}" ${
                stock > 0 && clampedQty >= stock ? "disabled" : ""
              }>+</button>
            </div>

            <div class="cart-line-total">${money(lineCents)}</div>

            <button class="cart-remove" type="button" data-i="${idx}">Remove</button>
          </div>
        </div>
      `;

      listEl.appendChild(li);
    });

    // Save any clamping changes
    saveCart(cart);

    if (totalEl) totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  // ---------- Load data ----------
  let cart = loadCart();
  console.log("buy-cart loaded items:", cart.length, cart);

  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("buy-cart catalog error:", e);
    if (msgEl) msgEl.textContent = "Could not load inventory right now.";
  }

  render(cart, catalog);

  // ---------- Actions ----------
  document.addEventListener("click", (e) => {
    const minus = e.target.closest(".cart-minus");
    const plus = e.target.closest(".cart-plus");
    const remove = e.target.closest(".cart-remove");
    if (!minus && !plus && !remove) return;

    cart = loadCart();

    const i = Number((minus || plus || remove).dataset.i);
    if (!Number.isFinite(i) || i < 0 || i >= cart.length) return;

    const sku = String(cart[i].sku || "").trim();
    const condition = normalizeCondition(cart[i].condition);

    const product = catalog?.[sku];
    const stock = product ? getStockForCondition(product, condition) : 0;

    if (remove) {
      cart.splice(i, 1);
      saveCart(cart);
      render(cart, catalog);
      return;
    }

    let qty = Math.max(1, Number(cart[i].qty || 1));
    if (minus) qty = Math.max(1, qty - 1);
    if (plus) qty = stock > 0 ? Math.min(stock, qty + 1) : qty + 1;

    cart[i].qty = qty;
    saveCart(cart);
    render(cart, catalog);
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      render([], catalog);
    });
  }

  // ---------- Optional: checkout wiring (only if your page uses these ids) ----------
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
});


