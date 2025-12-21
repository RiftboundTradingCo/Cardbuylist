document.addEventListener("DOMContentLoaded", async function () {
  const list = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const clearBtn = document.getElementById("buyClearCartBtn");
  const msg = document.getElementById("buyCartMessage");

  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutMsg = document.getElementById("checkoutMsg");
  const emailEl = document.getElementById("buyEmail");

  function moneyFromCents(cents) {
    return (Number(cents || 0) / 100).toFixed(2);
  }

  function loadCart() {
    const raw = localStorage.getItem("buyCart");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
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
    msg.textContent = "Could not load catalog from server.";
    msg.style.color = "red";
  }

  function computeTotalCents(cart) {
    let total = 0;
    for (const item of cart) {
      const sku = item.sku;
      const qty = Number(item.qty) || 0;
      const p = catalog[sku];
      if (!p) continue;
      total += (Number(p.price_cents) || 0) * qty;
    }
    return total;
  }

  function render() {
    const cart = loadCart();
    list.innerHTML = "";

    if (!cart.length) {
      list.innerHTML =
        "<li style='list-style:none;background:white;padding:12px;border-radius:8px;'>Your buy cart is empty.</li>";
      totalEl.textContent = "0.00";
      return;
    }

    for (const item of cart) {
      const sku = String(item.sku || "").trim();
      const qty = Math.max(1, Math.min(999, Number(item.qty) || 1));

      const p = catalog[sku];

      // If SKU not in catalog, show it but mark missing
      const name = p ? p.name : `(Unknown item: ${sku})`;
      const priceCents = p ? Number(p.price_cents) || 0 : 0;
      const image = p ? (p.image || "") : "";

      const lineTotalCents = priceCents * qty;

      const li = document.createElement("li");
      li.style.listStyle = "none";
      li.style.marginBottom = "10px";
      li.dataset.sku = sku;

      li.innerHTML = `
        <div class="order-row">
          <div style="display:flex;gap:10px;align-items:center;">
            ${image ? `<img src="${image}" alt="${name}" style="width:52px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">` : ""}
            <div>
              <div><strong>${name}</strong></div>
              <div>$${moneyFromCents(priceCents)} each = $${moneyFromCents(lineTotalCents)}</div>
              ${p && Number(p.stock) >= 0 ? `<div style="font-size:12px;opacity:.75;">In stock: ${p.stock}</div>` : ""}
              ${!p ? `<div style="font-size:12px;color:#b91c1c;">This SKU isn't in catalog.json</div>` : ""}
            </div>
          </div>

          <div class="qty-controls">
            <button class="qty-btn minus" type="button">−</button>
            <span class="qty-value">${qty}</span>
            <button class="qty-btn plus" type="button">+</button>
          </div>

          <button class="remove-btn" type="button">Remove</button>
        </div>
      `;

      list.appendChild(li);
    }

    const totalCents = computeTotalCents(cart);
    totalEl.textContent = moneyFromCents(totalCents);
  }

  // + / - / remove
  list.addEventListener("click", function (e) {
    const li = e.target.closest("li");
    if (!li) return;

    const sku = li.dataset.sku;
    let cart = loadCart();
    const idx = cart.findIndex(i => i.sku === sku);
    if (idx === -1) return;

    if (e.target.classList.contains("plus")) {
      cart[idx].qty = Math.min(999, (Number(cart[idx].qty) || 0) + 1);
      saveCart(cart);
      render();
      return;
    }

    if (e.target.classList.contains("minus")) {
      cart[idx].qty = (Number(cart[idx].qty) || 0) - 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
      saveCart(cart);
      render();
      return;
    }

    if (e.target.classList.contains("remove-btn")) {
      cart.splice(idx, 1);
      saveCart(cart);
      render();
    }
  });

  // Clear cart
  clearBtn.addEventListener("click", function () {
    if (!confirm("Clear your buy cart?")) return;
    localStorage.removeItem("buyCart");
    render();
    msg.textContent = "Cart cleared.";
    msg.style.color = "green";
  });

  // Checkout (Stripe) — sends {sku,qty} only
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async function () {
      checkoutMsg.textContent = "";
      checkoutBtn.disabled = true;

      try {
        const cart = loadCart();
        if (!cart.length) {
          checkoutMsg.textContent = "Your cart is empty.";
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
          checkoutMsg.textContent = "Checkout error: " + (data.error || "Unknown error");
          checkoutBtn.disabled = false;
          return;
        }

        window.location.href = data.url;
      } catch (err) {
        checkoutMsg.textContent = "Network error. Please try again.";
        checkoutBtn.disabled = false;
      }
    });
  }

  render();
});
