(() => {
  console.log("SELL-CART.JS LOADED ✅");

  /* ===============================
     HELPERS
  =============================== */

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem("sellCart")) || [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem("sellCart", JSON.stringify(cart));
  }

  function money(n) {
    return Number(n || 0).toFixed(2);
  }

  function normalizeCondition(c) {
    const allowed = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"];
    return allowed.includes(c) ? c : "Near Mint";
  }

  /* ===============================
     ELEMENTS
  =============================== */

  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const clearBtn = document.getElementById("sellClearCartBtn");

  const submitBtn = document.getElementById("sellSubmitBtn");
  const emailInput = document.getElementById("sellEmail");
  const msgEl = document.getElementById("sellCheckoutMessage");

  if (!listEl) {
    console.warn("sell-cart.js: #sellCartList not found");
    return;
  }

  /* ===============================
     GROUP CART BY SKU
  =============================== */

  function groupBySku(cart) {
    const map = {};
    cart.forEach(item => {
      const sku = item.sku;
      if (!map[sku]) {
        map[sku] = {
          sku,
          name: item.name || sku,
          image: item.image || "",
          basePrice: item.unitPrice || 0,
          conditions: {}
        };
      }
      const cond = normalizeCondition(item.condition);
      map[sku].conditions[cond] = (map[sku].conditions[cond] || 0) + item.qty;
    });
    return Object.values(map);
  }

  /* ===============================
     RENDER CART
  =============================== */

  function render() {
    const cart = loadCart();
    listEl.innerHTML = "";

    if (!cart.length) {
      listEl.innerHTML = "<p>Your sell cart is empty.</p>";
      totalEl.textContent = "0.00";
      return;
    }

    let grandTotal = 0;
    const grouped = groupBySku(cart);

    grouped.forEach(group => {
      let skuTotal = 0;
      let skuQty = 0;

      Object.entries(group.conditions).forEach(([cond, qty]) => {
        skuQty += qty;
        skuTotal += qty * group.basePrice;
      });

      grandTotal += skuTotal;

      const row = document.createElement("li");
      row.className = "cart-row";
      row.dataset.sku = group.sku;

      row.innerHTML = `
        <div class="cart-left">
          <img src="${group.image}" class="cart-thumb" alt="${group.name}">
        </div>

        <div class="cart-main">
          <h3>${group.name}</h3>

          <div class="cond-tabs">
            ${["Near Mint","Lightly Played","Moderately Played","Heavily Played"].map(cond => {
              const qty = group.conditions[cond] || 0;
              const disabled = qty === 0;
              return `
                <button
                  class="cond-tab ${disabled ? "disabled" : ""}"
                  data-cond="${cond}"
                  ${disabled ? "aria-disabled='true'" : ""}
                >
                  ${cond.split(" ")[0]}
                </button>
              `;
            }).join("")}
          </div>

          <div class="cart-summary">
            <strong>$${money(skuTotal)}</strong>
            <div class="cart-sub">
              In cart (all conditions): ${skuQty} • Subtotal: $${money(skuTotal)}
            </div>
          </div>
        </div>
      `;

      listEl.appendChild(row);
    });

    totalEl.textContent = money(grandTotal);
  }

  /* ===============================
     CLEAR CART
  =============================== */

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      localStorage.removeItem("sellCart");
      if (window.updateSellCartBadge) window.updateSellCartBadge();
      render();
    });
  }

  /* ===============================
     SUBMIT SELL ORDER
  =============================== */

  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const cart = loadCart();
      if (!cart.length) {
        msgEl.textContent = "Your sell cart is empty.";
        return;
      }

      const email = String(emailInput?.value || "").trim();
      if (!email || !email.includes("@")) {
        msgEl.textContent = "Please enter a valid email.";
        return;
      }

      const total = cart.reduce((sum, i) => {
        return sum + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0);
      }, 0);

      try {
        submitBtn.disabled = true;
        msgEl.textContent = "Submitting…";

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            total: total.toFixed(2),
            order: cart
          })
        });

        const data = await res.json();
        if (!data.ok) {
          msgEl.textContent = "Error submitting order.";
          submitBtn.disabled = false;
          return;
        }

        // ✅ clear cart on success
        localStorage.removeItem("sellCart");
        if (window.updateSellCartBadge) window.updateSellCartBadge();

        sessionStorage.setItem("sellOrderRecap", JSON.stringify({
          email,
          order: cart,
          computedTotal: total.toFixed(2)
        }));

        window.location.href = "/recap.html";

      } catch (err) {
        console.error(err);
        msgEl.textContent = "Network error.";
        submitBtn.disabled = false;
      }
    });
  }

  /* ===============================
     INIT
  =============================== */

  render();
})();
