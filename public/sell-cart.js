document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "sellCart";

  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const msgEl = document.getElementById("sellCartMessage");
  const clearBtn = document.getElementById("sellClearCartBtn");
  const submitBtn = document.getElementById("sellSubmitBtn");
  const emailInput = document.getElementById("sellEmail");

  /* ------------------------------
     Helpers
  ------------------------------ */
  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
    catch { return []; }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("cart:changed"));
  }

  function showMsg(text, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }

  function money(n) {
    return `$${(Number(n || 0) / 100).toFixed(2)}`;
  }

  /* ------------------------------
     Logged-in UX
  ------------------------------ */
  let loggedInEmail = null;

  try {
    const res = await fetch("/api/me");
    const data = await res.json();

    if (data.ok && data.user) {
      loggedInEmail = data.user.email;

      // hide only the input (NOT the whole row)
      emailInput.style.display = "none";

      const checkout = document.querySelector(".cart-checkout");
      if (checkout && !document.getElementById("loggedInAsBox")) {
        const box = document.createElement("div");
        box.id = "loggedInAsBox";
        box.className = "logged-in-box";
        box.innerHTML = `
          <div class="muted">Logged in as</div>
          <strong>${loggedInEmail}</strong>
          <div class="muted">(We’ll confirm this sell order here)</div>
        `;

        const label = checkout.querySelector("label[for='sellEmail']");
        if (label) checkout.insertBefore(box, label);
        else checkout.prepend(box);
      }
    }
  } catch {
    // guest mode — do nothing
  }

  /* ------------------------------
     Render Cart
  ------------------------------ */
  function render() {
    const cart = loadCart();
    listEl.innerHTML = "";

    if (!cart.length) {
      listEl.innerHTML = `<li class="cart-item">Your sell cart is empty.</li>`;
      totalEl.textContent = "0.00";
      return;
    }

    let totalCents = 0;

    for (const item of cart) {
      const lineTotal = Number(item.lineTotalCents || 0);
      totalCents += lineTotal;

      const li = document.createElement("li");
      li.className = "cart-item";
      li.innerHTML = `
        <div class="cart-line">
          <strong>${item.name}</strong>
          <span>${item.qty} × ${money(item.unitPriceCents)}</span>
          <span>${money(lineTotal)}</span>
        </div>
      `;
      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  render();

  /* ------------------------------
     Clear Cart
  ------------------------------ */
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      render();
    });
  }

  /* ------------------------------
     Submit Sell Order
  ------------------------------ */
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      showMsg("");

      const cart = loadCart();
      if (!cart.length) {
        showMsg("Your sell cart is empty.", false);
        return;
      }

      const email = loggedInEmail || emailInput.value.trim();
      if (!email || !email.includes("@")) {
        showMsg("Please enter a valid email.", false);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";

      try {
        const totalCents = cart.reduce(
          (sum, l) => sum + Number(l.lineTotalCents || 0),
          0
        );

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Sell Customer",
            email,
            totalCents,
            order: cart
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Submit failed");
        }

        saveCart([]);
        window.location.href = "/recap.html";
      } catch (err) {
        console.error(err);
        showMsg(err.message || "Could not submit sell order.", false);
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Sell Order";
      }
    });
  }
});

