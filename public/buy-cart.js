document.addEventListener("DOMContentLoaded", async () => {
  const BUY_CART_KEY = "buyCart";

  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("checkoutMsg");

  const clearBtn = document.getElementById("buyClearCartBtn");
  const checkoutBtn = document.getElementById("checkoutBtn");

  // email field in buy-cart.html
  const emailInput = document.getElementById("buyEmail");
  const emailLabel = emailInput ? emailInput.closest("label") : null;

  // ---------- helpers ----------
  function showMsg(text, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }

  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function loadCart() {
    return safeParse(localStorage.getItem(BUY_CART_KEY) || "[]", []);
  }

  function saveCart(cart) {
    localStorage.setItem(BUY_CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("cart:changed"));
  }

  // ---------- “Logged in as …” UX ----------
  async function applyLoggedInEmailUX() {
    if (!emailInput) return;

    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      const userEmail =
        data?.ok && data?.user?.email ? String(data.user.email).trim() : "";

      if (!userEmail) {
        // not logged in → keep normal input editable
        emailInput.readOnly = false;
        emailInput.disabled = false;
        if (emailLabel) emailLabel.style.display = "";
        return;
      }

      // logged in → prefill + lock
      emailInput.value = userEmail;
      emailInput.readOnly = true;

      // hide the original label/input UI (but keep the input in DOM)
      if (emailLabel) emailLabel.style.display = "none";

      // show “Logged in as …” box
      const wrap = emailLabel?.parentElement || emailInput.parentElement;
      if (!wrap) return;

      // don’t add twice
      if (document.getElementById("loggedInAsBox")) return;

      const box = document.createElement("div");
      box.id = "loggedInAsBox";
      box.style.cssText = `
        margin-top: 10px;
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(255,255,255,.92);
        border: 1px solid rgba(0,0,0,.12);
        font-weight: 800;
      `;
      box.innerHTML = `
        <div style="font-size:12px; opacity:.75; font-weight:800; margin-bottom:4px;">Logged in as</div>
        <div style="font-size:15px;">${userEmail}</div>
        <div style="font-size:12px; opacity:.75; margin-top:6px; font-weight:700;">
          (We’ll send your receipt here)
        </div>
      `;

      // insert after the label if possible; otherwise after input
      if (emailLabel && emailLabel.nextSibling) {
        wrap.insertBefore(box, emailLabel.nextSibling);
      } else {
        wrap.appendChild(box);
      }
    } catch {
      // ignore
    }
  }

 // ---------- render ----------
  function render(groups, catalog) {
    listEl.innerHTML = "";
    showMsg("");

    if (!groups.length) {
      listEl.innerHTML = `<li class="buy-cart-empty">Your cart is empty.</li>`;
      totalEl.textContent = "0.00";

      const countEl = document.getElementById("buyCartCount");
      if (countEl) countEl.textContent = "0";
      return;
    }

    let totalCents = 0;

    for (const g of groups) {
      const product = catalog[g.sku];
      if (!product) continue;

      const name = String(product.name || g.sku);
      const baseCents = Number(product.price_cents || 0);
      const imgSrc = normalizeImagePath(product.image);

      const perTab = TAB_ORDER.map((tab) => {
        const cond = TAB_TO_COND[tab];
        const qty = Number(g.lines.get(cond) || 0);
        const stock = getStockForCondition(product, cond);
        const unitCents = calcUnitCents(baseCents, cond);
        return { tab, cond, qty, stock, unitCents };
      });

      const groupQty = perTab.reduce((s, x) => s + x.qty, 0);
      const groupTotalCents = perTab.reduce((s, x) => s + x.qty * x.unitCents, 0);
      totalCents += groupTotalCents;

      const activeTab = String(g.activeTab || "NM").toUpperCase();
      const active = perTab.find((x) => x.tab === activeTab) || perTab[0];

      const canPlus = active.qty < active.stock;

      const li = document.createElement("li");
      li.className = "buy-cart-item";
      li.dataset.sku = g.sku;
      li.dataset.activeTab = active.tab;

      li.innerHTML = `
        <div class="cart-card">
          ${imgSrc ? `<img src="${imgSrc}" class="cart-thumb card-zoom-img" alt="${name}">` : ""}

          <div class="cart-main">
            <h3 class="cart-title">${name}</h3>

            <div class="cond-tabs cart-cond-tabs" role="tablist" aria-label="Condition">
              ${TAB_ORDER.map((tab) => {
                const x = perTab.find((p) => p.tab === tab);
                const enabled = x.qty > 0;
                const isActive = tab === active.tab;

                return `<button
                  class="cond-tab${isActive ? " active" : ""}${enabled ? "" : " disabled"}"
                  type="button"
                  data-tab="${tab}"
                  aria-disabled="${enabled ? "false" : "true"}"
                >${tab}</button>`;
              }).join("")}
            </div>

            <div class="cart-meta">
              <div>Condition: <strong class="cart-cond-text">${active.cond}</strong></div>
              <div>In stock: <strong class="cart-stock-text">${Number.isFinite(active.stock) ? active.stock : 0}</strong></div>
              <div>Unit: <strong class="cart-unit-text">${money(active.unitCents)}</strong></div>

              <div class="cart-subline">
                In cart (all conditions): <strong>${groupQty}</strong> •
                Subtotal: <strong>${money(groupTotalCents)}</strong>
              </div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-controls">
              <button class="cart-minus" type="button" ${active.qty <= 0 ? "disabled" : ""}>−</button>
              <span class="cart-qty">${active.qty}</span>
              <button class="cart-plus" type="button" ${canPlus ? "" : "disabled"}>+</button>
            </div>

            <div class="line-price">${money(active.qty * active.unitCents)}</div>

            <button class="cart-remove" type="button">Remove condition</button>
          </div>
        </div>
      `;

      // zoom click
      const thumb = li.querySelector(".card-zoom-img");
      if (thumb) thumb.addEventListener("click", () => openModal(thumb.getAttribute("src")));

      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);

    const countEl = document.getElementById("buyCartCount");
    if (countEl) {
      const cartCount = groups.reduce((sum, g) => {
        let n = 0;
        for (const qty of g.lines.values()) n += Number(qty || 0);
        return sum + n;
      }, 0);
      countEl.textContent = String(cartCount);
    }
  }

  // ---------- clear cart ----------
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      showMsg("Cart cleared.");
      render();
    });
  }

  // ---------- checkout ----------
  async function startCheckout() {
    showMsg("");

    const cart = loadCart();
    if (!Array.isArray(cart) || cart.length === 0) {
      showMsg("Your cart is empty.", false);
      return;
    }

    const email = String(emailInput?.value || "").trim();
    if (!email || !email.includes("@")) {
      showMsg("Please enter a valid email for receipt.", false);
      return;
    }

    checkoutBtn.disabled = true;
    const prevText = checkoutBtn.textContent;
    checkoutBtn.textContent = "Starting checkout…";

    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, cart })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error || `Checkout failed (HTTP ${res.status})`);
      }

      window.location.assign(data.url);
    } catch (e) {
      console.error("checkout error:", e);
      showMsg(e.message || "Could not start checkout.", false);
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = prevText;
    }
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      startCheckout();
    });
  }

  // ---------- init ----------
  await applyLoggedInEmailUX();
  render();
});





