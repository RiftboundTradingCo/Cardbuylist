document.addEventListener("DOMContentLoaded", async function () {
  const list = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const clearBtn = document.getElementById("buyClearCartBtn");
  const msg = document.getElementById("buyCartMessage");

  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutMsg = document.getElementById("checkoutMsg");
  const emailEl = document.getElementById("buyEmail");

  // Same multipliers as server.js
  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  function normalizeCondition(c) {
    const s = String(c || "Near Mint").trim();
    return CONDITION_MULT[s] ? s : "Near Mint";
  }

  function centsForCondition(baseCents, condition) {
    const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
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

  // Total qty for SKU across all conditions (stock is shared per SKU)
  function totalQtyForSku(cart, sku) {
    return cart
      .filter((i) => i.sku === sku)
      .reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  }

  // If cart has more than stock for a SKU, cap lines down until total matches stock
  function enforceStockCaps(cart) {
    let changed = false;

    // group by sku
    const bySku = {};
    for (const item of cart) {
      bySku[item.sku] = bySku[item.sku] || [];
      bySku[item.sku].push(item);
    }

    for (const [sku, items] of Object.entries(bySku)) {
      const p = catalog[sku];
      if (!p) continue;

      const stock = Number(p.stock ?? 0);
      if (stock <= 0) continue;

      let total = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
      if (total <= stock) continue;

      // Reduce from the end until within stock
      for (let i = items.length - 1; i >= 0 && total > stock; i--) {
        const q = Number(items[i].qty) || 0;
        const extra = total - stock;
        const reduceBy = Math.min(q, extra);
        items[i].qty = q - reduceBy;
        total -= reduceBy;
        changed = true;
      }
    }

    // Remove any line with qty <= 0
    const filtered = cart.filter((i) => (Number(i.qty) || 0) > 0);
    if (filtered.length !== cart.length) changed = true;

    return { cart: filtered, changed };
  }

  function computeTotalCents(cart) {
    let total = 0;
    for (const item of cart) {
      const p = catalog[item.sku];
      if (!p) continue;

      const cond = normalizeCondition(item.condition);
      const unit = centsForCondition(p.price_cents, cond);
      total += unit * (Number(item.qty) || 0);
    }
    return total;
  }

  function render() {
    let cart = loadCart()
      .map((i) => ({
        sku: String(i?.sku || "").trim(),
        qty: Math.max(1, Math.min(999, Number(i?.qty) || 1)),
        condition: normalizeCondition(i?.condition)
      }))
      .filter((i) => i.sku);

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
      const qty = Number(item.qty) || 1;
      const condition = normalizeCondition(item.condition);

      const p = catalog[sku];
      const name = p ? p.name : `(Unknown item: ${sku})`;
      const baseCents = p ? Number(p.price_cents) || 0 : 0;
      const unitCents = p ? centsForCondition(baseCents, condition) : 0;
      const stock = p ? Number(p.stock ?? 0) : 0;
      const image = p ? String(p.image || "") : "";

      const imageSrc = image
        ? encodeURI(image.startsWith("/") ? image : "/" + image)
        : "";

      // plus button disabled if total for sku already at stock
      const currentTotalSku = totalQtyForSku(cart, sku);
      const plusDisabled = p && stock > 0 && currentTotalSku >= stock;

      const lineTotalCents = unitCents * qty;

      const li = document.createElement("li");
      li.style.listStyle = "none";
      li.style.marginBottom = "10px";
      li.dataset.sku = sku;
      li.dataset.condition = condition;

      li.innerHTML = `
        <div class="order-row">
          <div style="display:flex;gap:10px;align-items:center;">
            ${imageSrc ? `<img src="${imageSrc}" alt="${name}" style="width:52px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">` : ""}
            <div>
              <div><strong>${name}</strong></div>
              <div class="condition-line">Condition: <strong>${condition}</strong></div>
              <div>$${moneyFromCents(unitCents)} each = $${moneyFromCents(lineTotalCents)}</div>
              ${p ? `<div class="stock-line">In stock: <strong>${stock}</strong></div>` : `<div style="font-size:12px;color:#b91c1c;">This SKU isn't in catalog.json</div>`}
              ${p && stock > 0 && currentTotalSku >= stock ? `<div class="stock-warning">Max quantity reached for available stock.</div>` : ""}
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

  // +/-/remove with stock restriction and condition-aware line selection
  list.addEventListener("click", function (e) {
    const li = e.target.closest("li");
    if (!li) return;

    const sku = li.dataset.sku;
    const condition = li.dataset.condition;

    let cart = loadCart().map((i) => ({
      sku: String(i?.sku || "").trim(),
      qty: Number(i?.qty) || 1,
      condition: normalizeCondition(i?.condition)
    })).filter(i => i.sku);

    const idx = cart.findIndex(
      (i) => i.sku === sku && normalizeCondition(i.condition) === condition
    );
    if (idx === -1) return;

    const p = catalog[sku];
    const stock = p ? Number(p.stock ?? 0) : null;

    // PLUS: enforce total for SKU across all conditions
    if (e.target.classList.contains("plus")) {
      const totalForSku = totalQtyForSku(cart, sku);

      if (stock !== null && stock > 0 && totalForSku >= stock) {
        if (msg) {
          msg.textContent = "You can’t add more than what’s in stock.";
          msg.style.color = "#b45309";
        }
        render();
        return;
      }

      cart[idx].qty = Math.min(999, (Number(cart[idx].qty) || 0) + 1);
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

  // Checkout (server re-checks stock + condition pricing)
  checkoutBtn?.addEventListener("click", async function () {
    if (checkoutMsg) checkoutMsg.textContent = "";
    checkoutBtn.disabled = true;

    try {
      const cart = loadCart()
        .map((i) => ({
          sku: String(i?.sku || "").trim(),
          qty: Math.max(1, Math.min(999, Number(i?.qty) || 1)),
          condition: normalizeCondition(i?.condition)
        }))
        .filter((i) => i.sku);

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
