document.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("buyCartMessage");
  const clearBtn = document.getElementById("buyClearCartBtn");

  function loadCart() {
  const keysToTry = [
    "buyCart",        // new
    "buy_cart",       // common alt
    "buyCartItems",   // common alt
    "cart",           // common alt
    "buycart"         // common typo
  ];

  for (const k of keysToTry) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;

      const parsed = JSON.parse(raw);

      // Accept array format: [{sku, condition, qty}, ...]
      if (Array.isArray(parsed)) {
        if (k !== "buyCart") localStorage.setItem("buyCart", JSON.stringify(parsed)); // migrate
        return parsed;
      }

      // Accept object format: { "SKU|Condition": qty, ... } (just in case)
      if (parsed && typeof parsed === "object") {
        const arr = Object.entries(parsed).map(([key, qty]) => {
          const [sku, condition] = key.split("|");
          return { sku, condition: condition || "Near Mint", qty: Number(qty) || 1 };
        });
        localStorage.setItem("buyCart", JSON.stringify(arr));
        return arr;
      }
    } catch {
      // keep trying other keys
    }
  }

  return [];
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

    if (product && product.stock && typeof product.stock === "object") {
      return Number(product.stock[cond] ?? 0);
    }
    return Number(product?.stock ?? 0);
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    // ensure starts with /
    const withSlash = s.startsWith("/") ? s : `/${s}`;
    // encode spaces etc
    return encodeURI(withSlash);
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
      listEl.innerHTML = `<li class="buy-cart-empty">Your cart is empty.</li>`;
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

      // clamp qty to stock if stock is known (>0)
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
            ${imgSrc ? `<img class="zoomable" src="${imgSrc}" alt="${name}">` : `<div class="buy-cart-img-placeholder"></div>`}
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
              <button class="cart-plus" type="button" data-i="${idx}" ${stock > 0 && clampedQty >= stock ? "disabled" : ""}>+</button>
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

  let cart = loadCart();
  console.log("buy-cart loaded items:", cart.length, cart);
  let catalog = {};

  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("buy-cart.js catalog error:", e);
    if (msgEl) msgEl.textContent = "Could not load inventory right now.";
  }

  render(cart, catalog);

  // + / - / remove
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
    if (plus) qty = stock > 0 ? Math.min(stock, qty + 1) : qty + 1;

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

  // Image zoom modal (re-use your modal if present)
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

  }
});

