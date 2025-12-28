(() => {
  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const clearBtn = document.getElementById("sellClearCartBtn");
  const emailEl = document.getElementById("sellEmail");
  const submitBtn = document.getElementById("sellSubmitBtn");
  const msgEl = document.getElementById("sellCheckoutMessage");

  if (!listEl || !totalEl) {
    console.warn("sell-cart.js: missing required elements");
    return;
  }

  const CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"];
  const LABEL = { "Near Mint": "Near", "Lightly Played": "Lightly", "Moderately Played": "Moderately", "Heavily Played": "Heavily" };

  function loadCart() {
    try { return JSON.parse(localStorage.getItem("sellCart")) || []; } catch { return []; }
  }
  function saveCart(cart) {
    localStorage.setItem("sellCart", JSON.stringify(cart));
  }

  // expected item shape: { sku?, name, condition, qty, unitPrice, image? }
  // unitPrice is dollars (not cents) in your sell flow
  function money(n) {
    return (Number(n || 0)).toFixed(2);
  }

  function groupByName(cart) {
    const map = new Map();
    for (const item of cart) {
      const name = String(item.name || item.sku || "").trim();
      if (!name) continue;

      const condition = String(item.condition || "Near Mint");
      const qty = Number(item.qty || 0);
      const unitPrice = Number(item.unitPrice || 0);

      if (!map.has(name)) {
        map.set(name, {
          name,
          image: item.image || "",
          // condition -> { qty, unitPrice }
          cond: {}
        });
      }
      const g = map.get(name);
      g.image = g.image || item.image || "";
      g.cond[condition] = {
        qty: (g.cond[condition]?.qty || 0) + qty,
        unitPrice: unitPrice || g.cond[condition]?.unitPrice || 0
      };
    }
    return Array.from(map.values());
  }

  function cartTotalsForGroup(g) {
    let qtyAll = 0;
    let subtotal = 0;
    for (const c of CONDITIONS) {
      const q = Number(g.cond[c]?.qty || 0);
      const u = Number(g.cond[c]?.unitPrice || 0);
      qtyAll += q;
      subtotal += q * u;
    }
    return { qtyAll, subtotal };
  }

  function render() {
    const cart = loadCart();
    listEl.innerHTML = "";

    const groups = groupByName(cart);
    let grand = 0;

    for (const g of groups) {
      const { qtyAll, subtotal } = cartTotalsForGroup(g);
      grand += subtotal;

      // pick an active condition: first one that exists in cart, else Near Mint
      const activeCond = CONDITIONS.find(c => (g.cond[c]?.qty || 0) > 0) || "Near Mint";

      const li = document.createElement("li");
      li.className = "cart-row";
      li.dataset.name = g.name;
      li.dataset.activeCond = activeCond;

      li.innerHTML = `
        <div class="cart-left">
          ${g.image ? `<img class="cart-thumb" src="${g.image}" alt="${g.name}">` : ""}
        </div>

        <div class="cart-main">
          <h3>${g.name}</h3>

          <div class="cond-tabs" role="tablist">
            ${CONDITIONS.map(c => {
              const q = Number(g.cond[c]?.qty || 0);
              const disabled = q <= 0;
              const isActive = c === activeCond;
              return `
                <button
                  class="cond-tab ${isActive ? "active" : ""} ${disabled ? "disabled" : ""}"
                  type="button"
                  data-cond="${c}"
                  aria-disabled="${disabled ? "true" : "false"}"
                >${LABEL[c]}</button>
              `;
            }).join("")}
          </div>

          <div class="cart-sub">
            In cart (all conditions): ${qtyAll} • Subtotal: $${money(subtotal)}
          </div>
        </div>

        <div class="cart-right">
          <div class="cart-summary">
            <strong>$${money(subtotal)}</strong>
          </div>
        </div>
      `;

      listEl.appendChild(li);
    }

    totalEl.textContent = money(grand);
    if (msgEl) msgEl.textContent = groups.length ? "" : "Your sell cart is empty.";
  }

  // Tabs (just visual / doesn’t reset anything)
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".cond-tab");
    if (!tab) return;

    const row = tab.closest(".cart-row");
    if (!row) return;

    if (tab.getAttribute("aria-disabled") === "true") return;
    if (tab.classList.contains("disabled")) return;

    // Set active only; re-render to update active styling cleanly
    row.dataset.activeCond = tab.dataset.cond || "Near Mint";
    row.querySelectorAll(".cond-tab").forEach(b => {
      const isActive = (b.dataset.cond || "") === row.dataset.activeCond;
      b.classList.toggle("active", isActive);
    });
  });

  // Clear cart
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      localStorage.removeItem("sellCart");
      render();
    });
  }

  // Submit (calls your /api/submit route)
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const cart = loadCart();
      if (!cart.length) {
        if (msgEl) msgEl.textContent = "Your sell cart is empty.";
        return;
      }

      const email = String(emailEl?.value || "").trim();
      if (!email) {
        if (msgEl) msgEl.textContent = "Please enter your email for confirmation.";
        return;
      }

      // compute total
      let total = 0;
      for (const i of cart) total += (Number(i.qty || 0) * Number(i.unitPrice || 0));

      try {
        if (msgEl) msgEl.textContent = "Submitting…";

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "",         // if you have a name field, wire it here
            email,
            total: money(total),
            order: cart
          })
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          if (msgEl) msgEl.textContent = "Error: " + (data.error || "Could not submit.");
          return;
        }

        // ✅ clear sell cart after submit
        localStorage.removeItem("sellCart");
        if (msgEl) msgEl.textContent = "Submitted! Check your email.";
        render();

      } catch (err) {
        console.error(err);
        if (msgEl) msgEl.textContent = "Network error. Could not submit.";
      }
    });
  }

  // initial render
  render();
})();
