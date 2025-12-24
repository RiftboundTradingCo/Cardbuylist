document.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("buyCartMessage");
  const clearBtn = document.getElementById("buyClearCartBtn");

  function loadCart() {
    try { return JSON.parse(localStorage.getItem("buyCart")) || []; } catch { return []; }
  }
  function saveCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  // Must match your catalog.json keys
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

  function getStockForCondition(item, condition) {
    // item is catalog[sku]
    const cond = normalizeCondition(condition);

    // New format: item.stock is an object
    if (item && item.stock && typeof item.stock === "object") {
      return Number(item.stock[cond] ?? 0);
    }

    // Old format fallback: item.stock is a number
    return Number(item?.stock ?? 0);
  }

  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.catalog) throw new Error("Bad catalog JSON");
    return data.catalog;
  }

  function render(cart, catalog) {
    if (!listEl) return;

    listEl.innerHTML = "";
    if (msgEl) msgEl.textContent = "";

    if (!cart.length) {
      listEl.innerHTML = "<li>Your cart is empty.</li>";
      if (totalEl) totalEl.textContent = "0.00";
      return;
    }

    let totalCents = 0;

    cart.forEach((ci, idx) => {
      const sku = String(ci.sku || "").trim();
      const condition = normalizeCondition(ci.condition);
      const qty = Math.max(1, Number(ci.qty || 1));

      const product = catalog[sku];
      const name = product ? String(product.name || sku) : sku;

      const baseCents = product ? Number(product.price_cents || 0) : 0;
      const unitCents = calcUnitCents(baseCents, condition);

      const stock = product ? getStockForCondition(product, condition) : 0;

      // Clamp cart qty to stock (optional but recommended)
      const clampedQty = Math.min(qty, stock > 0 ? stock : qty);
      if (clampedQty !== qty) {
        cart[idx].qty = clampedQty;
      }

      const lineCents = unitCents * clampedQty;
      totalCents += lineCents;

const li = document.createElement("li");
li.className = "buy-cart-item";

li.innerHTML = `
  <strong>${name}</strong><br>
  <span class="muted">SKU: ${sku}</span><br>
  <span class="muted">Condition: ${condition}</span><br>
  <span class="muted">In stock: ${Number.isFinite(stock) ? stock : 0}</span><br>
  <span class="muted">Unit: ${money(unitCents)}</span><br>

  <div class="cart-controls" style="margin:6px 0;">
    <button class="cart-minus" type="button" data-i="${idx}">−</button>
    <span class="cart-qty" style="display:inline-block;min-width:18px;text-align:center;">${clampedQty}</span>
    <button class="cart-plus" type="button" data-i="${idx}" ${stock > 0 && clampedQty >= stock ? "disabled" : ""}>+</button>
  </div>

  <div class="cart-line-total">${money(lineCents)}</div>

  <button class="cart-remove" type="button" data-i="${idx}">Remove</button>
`;


      listEl.appendChild(li);
    });

    // Save any clamping changes
    saveCart(cart);

    if (totalEl) totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  let cart = loadCart();
  let catalog = {};

  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("buy-cart.js catalog error:", e);
    if (msgEl) msgEl.textContent = "Could not load inventory right now.";
  }

  render(cart, catalog);

  // Buttons: + / − / remove
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

    const product = catalog[sku];
    const stock = product ? getStockForCondition(product, condition) : 0;

    if (remove) {
      cart.splice(i, 1);
      saveCart(cart);
      render(cart, catalog);
      return;
    }

    let qty = Math.max(1, Number(cart[i].qty || 1));

    if (minus) qty = Math.max(1, qty - 1);

    if (plus) {
      // If we know stock, enforce it
      if (stock > 0) qty = Math.min(stock, qty + 1);
      else qty = qty + 1;
    }

    cart[i].qty = qty;
    saveCart(cart);
    render(cart, catalog);
  });

  // Clear cart
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      localStorage.setItem("buyCart", JSON.stringify([]));
      cart = [];
      render(cart, catalog);
    });
  }
});

