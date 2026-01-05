document.addEventListener("DOMContentLoaded", async () => {
  const BUY_CART_KEY = "buyCart";

  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("checkoutMsg");

  const clearBtn = document.getElementById("buyClearCartBtn");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const shipBtn = document.getElementById("shippingCalcBtn");

  const emailInput = document.getElementById("buyEmail");
  const emailLabel = emailInput ? emailInput.closest("label") : null;

  if (!listEl || !totalEl) {
    console.error("Missing #buyCartList or #buyCartTotal");
    return;
  }

  // ----------------------------
  // Condition normalization (supports NM/LP/MP/HP and full names)
  // ----------------------------
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played",
  };

  const COND_TO_TAB = {
    "Near Mint": "NM",
    "Lightly Played": "LP",
    "Moderately Played": "MP",
    "Heavily Played": "HP",
  };

  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65,
  };

  function normalizeCondition(raw) {
    const s = String(raw || "").trim();
    const up = s.toUpperCase();

    // If tab code
    if (TAB_TO_COND[up]) return TAB_TO_COND[up];

    // If exact full name
    if (CONDITION_MULT[s]) return s;

    // fallback
    return "Near Mint";
  }

  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function showMsg(t, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = t || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }

  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function loadCart() {
    const cart = safeParse(localStorage.getItem(BUY_CART_KEY) || "[]", []);
    return Array.isArray(cart) ? cart : [];
  }

  function saveCart(cart) {
    localStorage.setItem(BUY_CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("cart:changed"));
  }

  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.catalog) throw new Error("Catalog load failed");
    return data.catalog;
  }

  function getStockForCondition(product, conditionFull) {
    if (!product) return 0;
    if (product.stock && typeof product.stock === "object") {
      return Number(product.stock[conditionFull] ?? 0);
    }
    return Number(product.stock ?? 0);
  }

  function calcUnitCents(baseCents, conditionFull) {
    const mult = CONDITION_MULT[conditionFull] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }

  // ----------------------------
  // Logged in UX (hide email input only)
  // ----------------------------
  let loggedInEmail = "";

  async function applyLoggedInUX() {
    if (!emailInput) return;

    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const me = await meRes.json().catch(() => ({}));
      loggedInEmail = me?.ok && me?.user?.email ? String(me.user.email).trim() : "";
    } catch {
      loggedInEmail = "";
    }

    if (!loggedInEmail) {
      if (emailLabel) emailLabel.style.display = "";
      emailInput.readOnly = false;
      return;
    }

    emailInput.value = loggedInEmail;
    emailInput.readOnly = true;

    // Hide the email row itself (but NOT the topbar)
    if (emailLabel) emailLabel.style.display = "none";

    // Add “Logged in as” box into left column
    const leftCol = document.querySelector(".cart-top-left");
    if (leftCol && !document.getElementById("loggedInAsBox")) {
      const box = document.createElement("div");
      box.id = "loggedInAsBox";
      box.style.cssText = `
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255,255,255,.92);
        border: 1px solid rgba(0,0,0,.12);
        max-width: 320px;
      `;
      box.innerHTML = `
        <div style="font-size:12px; opacity:.75; font-weight:800; margin-bottom:4px;">Logged in as</div>
        <div style="font-size:15px; font-weight:800;">${loggedInEmail}</div>
        <div style="font-size:12px; opacity:.75; margin-top:6px; font-weight:700;">(We’ll email your receipt here)</div>
      `;
      leftCol.appendChild(box);
    }
  }

  // ----------------------------
  // Render
  // ----------------------------
  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("catalog error:", e);
    showMsg("Could not load inventory right now.", false);
    catalog = {};
  }

  function groupCart(cart) {
    // sku|condFull -> { sku, conditionFull, qty }
    const map = new Map();

    for (const it of cart) {
      const sku = String(it?.sku || "").trim();
      if (!sku) continue;

      const condFull = normalizeCondition(it?.condition);
      const qty = Math.max(0, Number(it?.qty || 0));

      if (qty <= 0) continue;

      const key = `${sku}__${condFull}`;
      const prev = map.get(key) || { sku, conditionFull: condFull, qty: 0 };
      prev.qty += qty;
      map.set(key, prev);
    }

    return [...map.values()];
  }

  function clampToStock(lines) {
    let changed = false;
    const out = [];

    for (const l of lines) {
      const product = catalog[l.sku];
      const stock = getStockForCondition(product, l.conditionFull);

      if (stock <= 0) {
        changed = true;
        continue; // remove from cart if out of stock
      }

      if (l.qty > stock) {
        l.qty = stock;
        changed = true;
      }

      out.push(l);
    }

    return { out, changed };
  }

  function flatten(lines) {
    // store condition as FULL NAME to keep consistent going forward
    return lines.map(l => ({ sku: l.sku, condition: l.conditionFull, qty: l.qty }));
  }

  function render() {
    const raw = loadCart();
    const grouped = groupCart(raw);
    const clamped = clampToStock(grouped);

    if (clamped.changed) saveCart(flatten(clamped.out));

    listEl.innerHTML = "";
    showMsg("");

    if (!clamped.out.length) {
      listEl.innerHTML = `<li class="buy-cart-empty">Your cart is empty.</li>`;
      totalEl.textContent = "0.00";
      return;
    }

    let totalCents = 0;

    for (const l of clamped.out) {
      const product = catalog[l.sku];
      const name = String(product?.name || l.sku);
      const base = Number(product?.price_cents || 0);

      const stock = getStockForCondition(product, l.conditionFull);
      const unitCents = calcUnitCents(base, l.conditionFull);

      const lineTotal = unitCents * l.qty;
      totalCents += lineTotal;

      const tab = COND_TO_TAB[l.conditionFull] || "NM";
      const canPlus = stock > 0 ? l.qty < stock : false;

      const li = document.createElement("li");
      li.className = "buy-cart-item";
      li.dataset.sku = l.sku;
      li.dataset.cond = l.conditionFull;

      li.innerHTML = `
        <div class="cart-card">
          <div class="cart-main">
            <h3 class="cart-title">${name}</h3>
            <div class="cart-meta">
              <div>Condition: <strong>${tab}</strong></div>
              <div>In stock: <strong>${stock}</strong></div>
              <div>Unit: <strong>${money(unitCents)}</strong></div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-controls">
              <button class="cart-minus" type="button" ${l.qty <= 1 ? "" : ""}>−</button>
              <span class="cart-qty">${l.qty}</span>
              <button class="cart-plus" type="button" ${canPlus ? "" : "disabled"}>+</button>
            </div>

            <div class="line-price">${money(lineTotal)}</div>

            <button class="cart-remove" type="button">Remove</button>
          </div>
        </div>
      `;

      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  // ----------------------------
  // Events
  // ----------------------------
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".buy-cart-item");
    if (!itemEl) return;

    const sku = String(itemEl.dataset.sku || "").trim();
    const condFull = String(itemEl.dataset.cond || "").trim();
    if (!sku || !condFull) return;

    const product = catalog[sku];
    const stock = getStockForCondition(product, condFull);

    // Load grouped representation
    const grouped = groupCart(loadCart());
    const idx = grouped.findIndex(x => x.sku === sku && x.conditionFull === condFull);
    if (idx < 0) return;

    // +
    if (e.target.closest(".cart-plus")) {
      if (stock <= 0) return;
      grouped[idx].qty = Math.min(stock, grouped[idx].qty + 1);
      saveCart(flatten(grouped));
      render();
      return;
    }

    // -
    if (e.target.closest(".cart-minus")) {
      grouped[idx].qty = Math.max(0, grouped[idx].qty - 1);
      if (grouped[idx].qty <= 0) grouped.splice(idx, 1);
      saveCart(flatten(grouped));
      render();
      return;
    }

    // remove
    if (e.target.closest(".cart-remove")) {
      grouped.splice(idx, 1);
      saveCart(flatten(grouped));
      render();
      return;
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      render();
    });
  }

  if (shipBtn) {
    shipBtn.addEventListener("click", () => {
      alert("Shipping calculator coming soon!");
    });
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async () => {
      const email = String(loggedInEmail || emailInput?.value || "").trim();
      if (!email || !email.includes("@")) {
        showMsg("Please enter a valid email for your receipt.", false);
        return;
      }

      const cart = loadCart();
      if (!cart.length) {
        showMsg("Your cart is empty.", false);
        return;
      }

      checkoutBtn.disabled = true;

      try {
        const res = await fetch("/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, cart }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.url) {
          throw new Error(data.error || `Checkout failed (HTTP ${res.status})`);
        }

        window.location.assign(data.url);
      } catch (err) {
        console.error("Checkout error:", err);
        showMsg(err?.message || "Could not start checkout.", false);
      } finally {
        checkoutBtn.disabled = false;
      }
    });
  }

  // ----------------------------
  // init
  // ----------------------------
  await applyLoggedInUX();
  render();
});







