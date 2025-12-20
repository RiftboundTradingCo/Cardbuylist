document.addEventListener("DOMContentLoaded", function () {
  const cartList = document.getElementById("cartList");
  const cartTotalEl = document.getElementById("cartTotal");
  const form = document.getElementById("cartForm");
  const message = document.getElementById("cartMessage");
  const clearBtn = document.getElementById("clearCartBtn");


  clearBtn.addEventListener("click", function () {
  if (!confirm("Are you sure you want to clear your sell cart?")) return;

  localStorage.removeItem("sellCart");
  renderCart();

  message.textContent = "Cart cleared.";
  message.style.color = "green";
});

  function money(n) {
    return Number(n).toFixed(2);
  }

  function loadCart() {
    const raw = localStorage.getItem("sellCart");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  function saveCart(cart) {
    localStorage.setItem("sellCart", JSON.stringify(cart));
  }

  function computeTotal(cart) {
    return cart.reduce((sum, l) => sum + (Number(l.qty)||0) * (Number(l.unitPrice)||0), 0);
  }

  function renderCart() {
    const cart = loadCart();
    cartList.innerHTML = "";

    if (!cart.length) {
      cartList.innerHTML = "<li style='list-style:none;background:white;padding:12px;border-radius:8px;'>Your cart is empty.</li>";
      cartTotalEl.textContent = "0.00";
      return;
    }

    cart.forEach(line => {
      const lineTotal = (Number(line.qty)||0) * (Number(line.unitPrice)||0);

      const li = document.createElement("li");
      li.style.listStyle = "none";
      li.style.marginBottom = "10px";
      li.dataset.name = line.name;
      li.dataset.condition = line.condition;

      li.innerHTML = `
        <div class="order-row">
          <div>
            ${line.name} (${line.condition}) —
            $${money(line.unitPrice)} each = $${money(lineTotal)}
          </div>

          <div class="qty-controls">
            <button class="qty-btn minus" type="button">−</button>
            <span class="qty-value">${line.qty}</span>
            <button class="qty-btn plus" type="button">+</button>
          </div>

          <button class="remove-btn" type="button">Remove</button>
        </div>
      `;

      cartList.appendChild(li);
    });

    cartTotalEl.textContent = money(computeTotal(cart));
  }

  cartList.addEventListener("click", function (e) {
    const li = e.target.closest("li");
    if (!li) return;

    let cart = loadCart();
    const name = li.dataset.name;
    const condition = li.dataset.condition;

    const idx = cart.findIndex(l => l.name === name && l.condition === condition);
    if (idx === -1) return;

    if (e.target.classList.contains("plus")) {
      cart[idx].qty = Math.min(999, (Number(cart[idx].qty)||0) + 1);
      saveCart(cart);
      renderCart();
      return;
    }

    if (e.target.classList.contains("minus")) {
      cart[idx].qty = (Number(cart[idx].qty)||0) - 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
      saveCart(cart);
      renderCart();
      return;
    }

    if (e.target.classList.contains("remove-btn")) {
      cart.splice(idx, 1);
      saveCart(cart);
      renderCart();
    }
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const cart = loadCart();
    if (!cart.length) {
      message.textContent = "Your cart is empty.";
      message.style.color = "red";
      return;
    }

    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;
    const computedTotal = computeTotal(cart).toFixed(2);

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          total: computedTotal,
          order: cart
        })
      });

      const data = await res.json();
      if (!data.ok) {
        message.textContent = "Error: " + (data.error || "Could not submit.");
        message.style.color = "red";
        return;
      }

      // Save recap for recap.html
      sessionStorage.setItem("sellOrderRecap", JSON.stringify({
        name,
        email,
        order: cart,
        computedTotal
      }));

      // Clear cart after successful submit
      localStorage.removeItem("sellCart");

      window.location.href = "/recap.html";
    } catch (err) {
      message.textContent = "Network error. Could not submit.";
      message.style.color = "red";
    }
  });

  renderCart();
});
