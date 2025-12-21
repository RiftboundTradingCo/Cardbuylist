document.addEventListener("DOMContentLoaded", function () {
  const list = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const clearBtn = document.getElementById("buyClearCartBtn");
  const msg = document.getElementById("buyCartMessage");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutMsg = document.getElementById("checkoutMsg");


  function money(n) { return Number(n).toFixed(2); }

  function load() {
    const raw = localStorage.getItem("buyCart");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  function save(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  function total(cart) {
    return cart.reduce((sum, i) => sum + (Number(i.qty)||0) * (Number(i.price)||0), 0);
  }

  function render() {
    const cart = load();
    list.innerHTML = "";

    if (!cart.length) {
      list.innerHTML = "<li style='list-style:none;background:white;padding:12px;border-radius:8px;'>Your buy cart is empty.</li>";
      totalEl.textContent = "0.00";
      return;
    }

    cart.forEach(item => {
      const qty = Number(item.qty) || 0;
      const price = Number(item.price) || 0;
      const lineTotal = qty * price;

      const li = document.createElement("li");
      li.style.listStyle = "none";
      li.style.marginBottom = "10px";
      li.dataset.name = item.name;

      li.innerHTML = `
        <div class="order-row">
          <div style="display:flex;gap:10px;align-items:center;">
            ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width:52px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">` : ""}
            <div>
              <div><strong>${item.name}</strong></div>
              <div>$${money(price)} each = $${money(lineTotal)}</div>
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
    });

    totalEl.textContent = money(total(cart));
  }

  // + / - / remove
  list.addEventListener("click", function (e) {
    const li = e.target.closest("li");
    if (!li) return;

    let cart = load();
    const idx = cart.findIndex(i => i.name === li.dataset.name);
    if (idx === -1) return;

    if (e.target.classList.contains("plus")) {
      cart[idx].qty = Math.min(999, (Number(cart[idx].qty)||0) + 1);
      save(cart);
      render();
      return;
    }

    if (e.target.classList.contains("minus")) {
      cart[idx].qty = (Number(cart[idx].qty)||0) - 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
      save(cart);
      render();
      return;
    }

    if (e.target.classList.contains("remove-btn")) {
      cart.splice(idx, 1);
      save(cart);
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

  render();
});

checkoutBtn.addEventListener("click", async function () {
  checkoutMsg.textContent = "";
  checkoutBtn.disabled = true;

  try {
    const cart = load(); // your existing load() reads localStorage "buyCart"
    if (!cart.length) {
      checkoutMsg.textContent = "Your cart is empty.";
      checkoutBtn.disabled = false;
      return;
    }

    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart })
    });

    const data = await res.json();
    if (!data.ok || !data.url) {
      checkoutMsg.textContent = "Checkout error: " + (data.error || "Unknown error");
      checkoutBtn.disabled = false;
      return;
    }

    window.location.href = data.url; // Redirect to Stripe Checkout
  } catch (e) {
    checkoutMsg.textContent = "Network error. Please try again.";
    checkoutBtn.disabled = false;
 
    const emailEl = document.getElementById("buyEmail");

checkoutBtn.addEventListener("click", async function () {
  checkoutMsg.textContent = "";
  checkoutBtn.disabled = true;

  try {
    const cart = load(); // [{ sku, qty }]
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
  } catch {
    checkoutMsg.textContent = "Network error. Please try again.";
    checkoutBtn.disabled = false;
  }
});

