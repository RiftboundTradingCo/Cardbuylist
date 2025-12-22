document.addEventListener("DOMContentLoaded", async function () {
  const list = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const clearBtn = document.getElementById("buyClearCartBtn");
  const msg = document.getElementById("buyCartMessage");

  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutMsg = document.getElementById("checkoutMsg");
  const emailEl = document.getElementById("buyEmail");
  const CONDITION_MULT = {
  "Near Mint": 1.0,
  "Lightly Played": 0.9,
  "Moderately Played": 0.8,
  "Heavily Played": 0.65
};

  function centsForCondition(baseCents, condition) {
  const m = CONDITION_MULT[condition] ?? 1.0;
  return Math.round(Number(baseCents || 0) * m);
}

  function moneyFromCents(cents) {
    return (Number(cents || 0) / 100).toFixed(2);
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

  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) throw new Error("Catalog load failed");
    return data.catalog || {};
  }

  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error(e);
    if (msg) {
      msg.textContent = "Could not load catalog from server.";
      msg.style.color = "red";
    }
  }

  // Enforce stock limits by capping cart quantities to stock
  function enforceStockCaps(cart) {
    let changed = false;

    for (const item of cart) {
      const p = catalog[item.sku];
      if (!p) continue;

      const stock = Number(p.stock ?? 0);
      if (stock <= 0) {
        // If you prefer, you can remove out-of-stock items instead of capping:
        // item.qty = 0;
        continue;
      }

      const qty = Math.max(1, Math.min(999, Number(item.qty) || 1));
      const capped = Math.min(qty, stock);

      if (capped !== qty) {
        item.qty = capped;
        changed = true;
      } else {
        item.qty = qty;
      }
    }

    // Optional: remove any items with qty <= 0 (if you used removal logic above)
    const filtered = cart.filter(i => (Number(i.qty) || 0) > 0);

    if (filtered.length !== cart.length) changed = true;

    return { cart: filtered, changed };
  }

function computeTotalCents(cart) {
  let total = 0;
  for (const item of cart) {
    const p = catalog[item.sku];
    if (!p) continue;
    const unit = centsForCondition(p.price_cents, item.condition || "Near Mint");
    total += unit * (Number(item.qty) || 0);
  }
  return total;
}


  function render() {
    let cart = loadCart();

    // Ensure cart is valid objects
    cart = cart
      .map(i => ({ sku: String(i?.sku || "").trim(), qty: Number(i?.qty) || 1 }))
      .filter(i => i.sku);

    // Cap to stock
    const capped = enforceStockCaps(cart);
    cart = capped.cart;
    if (capped.changed) {
      saveCart(cart);
      if (msg) {
        msg.textContent = "Some quantities were adjusted to match available stock.";
        msg.style.color = "#b45309";
      }
    }

    list.innerHTML = "";

    if (!cart.length) {
      list.innerHTML =
        "<li style='list-style:none;background:white;padding:12px;border-radius:8px;'>Your buy cart is empty.</li>";
      totalEl.textContent = "0.00";
      if (checkoutMsg) checkoutMsg.textContent = "";
      return;
    }

    for (const item of cart) {
      const sku = item.sku;
      const qty = Math.max(1, Math.min(999, Number(item.qty) || 1));
      const p = catalog[sku];

      const name = p ? p.name : `(Unknown item: ${sku})`;
      const basePriceCents = p ? Number(p.price_cents) || 0 : 0;
      const condition = item.condition || "Near Mint";
      const unitCents = p ? centsForCondition(basePriceCents, condition) : 0;
      const lineTotalCents = unitCents * qty;

      const stock = p ? Number(p.stock ?? 0) : 0;
      const image = p ? String(p.image || "") : "";

      const imageSrc = image
        ? encodeURI(image.startsWith("/") ? image : "/" + image)
        : "";

      const lineTotalCents = priceCents * qty;
      const plusDisabled = p && stock > 0 && qty >= stock;

      const li = document.createElement("li");
      li.style.listStyle = "none";
      li.style.marginBottom = "10px";
      li.dataset.sku = sku;

      li.innerHTML = `
        <div class="order-row">
          <div style="display:flex;gap:10px;align-items:center;">
            ${imageSrc ? `<img src="${imageSrc}" alt="${name}" style="width:52px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">` : ""}
            <div>
              <div><strong>${name}</strong></div>
              <div class="condition-line">Condition: <strong>${condition}</strong></div>
              <div>$${moneyFromCents(unitCents)} each = $${moneyFromCents(lineTotalCents)}</div>


              <div>$${moneyFromCents(priceCents)} each = $${moneyFromCents(lineTotalCents)}</div>
              ${p ? `<div class="stock-line">In stock: <strong>${stock}</strong></div>` : `<div style="font-size:12px;color:#b91c1c;">This SKU isn't in catalog.json</div>`}
              ${p && stock > 0 && qty >= stock ? `<div class="stock-warning">Max quantity reached for available stock.</div>` : ""}
            </div>
          </div>

          <div class="qty-controls">
            <button class="qty-btn minus" type="button">−</button>
            <span class="qty-value">${qty}</span>
            <button class="qty-btn plus" type="button" ${plusDisabled ? "disabled" : ""}>+</button>
          </div>

          <button class="remove-btn" type="button">Remove</button>
        </div>
      `;

      list.appendChild(li);
    }

    totalEl.textContent = moneyFromCents(computeTotalCents(cart));
  }

  // Handle +/-/remove with stock restriction
  list.addEventListener("click", function (e) {
    const li = e.target.closest("li");
    if (!li) return;

    const sku = li.dataset.sku;
    let cart = loadCart();
    const idx = cart.findIndex(
  i => i.sku === sku && i.condition === item.condition
);

    if (idx === -1) return;

    const p = catalog[sku];
    const stock = p ? Number(p.stock ?? 0) : null;

    // PLUS
    if (e.target.classList.contains("plus")) {
      const current = Number(cart[idx].qty) || 0;

      if (stock !== null && stock > 0 && current >= stock) {
        if (msg) {
          msg.textContent = "You can’t add more than what’s in stock.";
          msg.style.color = "#b45309";
        }
        render();
        return;
      }

      cart[idx].qty = Math.min(999, current + 1);
      if (stock !== null && stock > 0) cart[idx].qty = Math.min(cart[idx].qty, stock);

      saveCart(cart);
      render();
      return;
    }

    // MINUS
    if (e.target.classList.contains("minus")) {
      cart[idx].qty = (Number(cart[idx].qty) || 0) - 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
      saveCart(cart);
      render();
      return;
    }

    // REMOVE
    if (e.target.classList.contains("remove-btn")) {
      cart.splice(idx, 1);
      saveCart(cart);
      render();
    }
  });

  // Clear cart
  clearBtn?.addEventListener("click", function () {
    if (!confirm("Clear your buy cart?")) return;
    localStorage.removeItem("buyCart");
    if (msg) {
      msg.textContent = "Cart cleared.";
      msg.style.color = "green";
    }
    render();
  });

  // Checkout (server re-checks stock too)
  checkoutBtn?.addEventListener("click", async function () {
    if (checkoutMsg) checkoutMsg.textContent = "";
    checkoutBtn.disabled = true;

    try {
      const cart = loadCart();
      if (!cart.length) {
        if (checkoutMsg) checkoutMsg.textContent = "Your cart is empty.";
        checkoutBtn.disabled = false;
        return;
      }

      const customerEmail = (emailEl?.value || "").trim();

      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart, customerEmail })
      });

      const data = await res.json();
      if (!data.ok || !data.url) {
        if (checkoutMsg) checkoutMsg.textContent = "Checkout error: " + (data.error || "Unknown error");
        checkoutBtn.disabled = false;
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      if (checkoutMsg) checkoutMsg.textContent = "Network error. Please try again.";
      checkoutBtn.disabled = false;
    }
  });

  render();
});
