document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "buyCart";

  const subtotalEl = document.getElementById("shipSubtotal");
  const shipCostEl = document.getElementById("shipCost");
  const totalEl = document.getElementById("shipTotal");
  const msgEl = document.getElementById("shipMsg");
  const methodsEl = document.getElementById("shipMethods");
  const btn = document.getElementById("continueToCheckoutBtn");

  const emailEl = document.getElementById("shipEmail");
  const emailLabelEl = document.getElementById("shipEmailLabel");
  const loggedInBox = document.getElementById("loggedInAsBox");

  function showMsg(t, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = t || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }
  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  function loadCart() {
    return safeParse(localStorage.getItem(CART_KEY) || "[]", []);
  }
  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  // same rules as buy.js
  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65,
  };
  function normalizeCond(c) {
    const s = String(c || "Near Mint").trim();
    return CONDITION_MULT[s] ? s : "Near Mint";
  }
  function unitCentsFor(baseCents, condition) {
    const cond = normalizeCond(condition);
    return Math.round(Number(baseCents || 0) * (CONDITION_MULT[cond] ?? 1));
  }

  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (!data?.ok || !data.catalog) throw new Error("Bad catalog JSON");
    return data.catalog;
  }

  // ---- logged in email UX ----
  let loggedInEmail = "";
  async function applyLoggedInUX() {
    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const me = await meRes.json().catch(() => ({}));
      loggedInEmail = me?.ok && me?.user?.email ? String(me.user.email).trim() : "";
    } catch {
      loggedInEmail = "";
    }

    if (!loggedInEmail) {
      // not logged in
      if (emailEl) emailEl.style.display = "";
      if (emailLabelEl) emailLabelEl.style.display = "";
      if (loggedInBox) loggedInBox.style.display = "none";
      return;
    }

    // logged in -> hide input, show box
    if (emailEl) {
      emailEl.value = loggedInEmail;
      emailEl.style.display = "none";
    }
    if (emailLabelEl) emailLabelEl.style.display = "none";

    if (loggedInBox) {
      loggedInBox.style.display = "";
      loggedInBox.style.cssText = `
        margin-top: 10px;
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(255,255,255,.92);
        border: 1px solid rgba(0,0,0,.12);
        max-width: 560px;
      `;
      loggedInBox.innerHTML = `
        <div style="font-size:12px; opacity:.75; font-weight:800; margin-bottom:4px;">Logged in as</div>
        <div style="font-size:15px; font-weight:800;">${loggedInEmail}</div>
        <div style="font-size:12px; opacity:.75; margin-top:6px; font-weight:700;">
          (We’ll email your receipt here)
        </div>
      `;
    }
  }

  // ---- shipping method rendering ----
  const FREE_THRESHOLD_CENTS = 9900;

  function buildShippingMethods(subtotalCents) {
    const methods = [
      { id: "standard", label: "Standard (3–5 business days)", cents: 499 },
      { id: "priority", label: "Priority (2–3 business days)", cents: 899 },
      { id: "express", label: "Express (1–2 business days)", cents: 1499 },
    ];

    if (subtotalCents >= FREE_THRESHOLD_CENTS) {
      methods.unshift({ id: "free", label: "Free Shipping (3–5 business days)", cents: 0 });
    }

    return methods;
  }

  function getSelectedMethodId() {
    const r = document.querySelector('input[name="shipMethod"]:checked');
    return r ? String(r.value) : "standard";
  }

  function renderMethods(methods, selectedId) {
    if (!methodsEl) return;
    methodsEl.innerHTML = methods.map(m => `
      <label style="display:flex; align-items:center; gap:10px; margin: 10px 0; font-weight:800;">
        <input type="radio" name="shipMethod" value="${m.id}" ${m.id === selectedId ? "checked" : ""}/>
        <span>${m.label}</span>
        <span style="margin-left:auto;">${money(m.cents)}</span>
      </label>
    `).join("");
  }

  // ---- init subtotal ----
  showMsg("");
  await applyLoggedInUX();

  const cart = loadCart();
  if (!cart.length) {
    showMsg("Your cart is empty.", false);
    if (btn) btn.disabled = true;
    if (subtotalEl) subtotalEl.textContent = "0.00";
    if (shipCostEl) shipCostEl.textContent = "0.00";
    if (totalEl) totalEl.textContent = "0.00";
    return;
  }

  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error(e);
    showMsg("Could not load catalog.", false);
    if (btn) btn.disabled = true;
    return;
  }

  let subtotalCents = 0;
  for (const it of cart) {
    const sku = String(it?.sku || "").trim();
    const qty = Math.max(0, Number(it?.qty || 0));
    const cond = normalizeCond(it?.condition);
    if (!sku || qty <= 0) continue;

    const p = catalog[sku];
    const base = Number(p?.price_cents || 0);
    subtotalCents += unitCentsFor(base, cond) * qty;
  }

  const methods = buildShippingMethods(subtotalCents);
  const defaultSelected = methods[0]?.id || "standard";
  renderMethods(methods, defaultSelected);

  function recalc() {
    const id = getSelectedMethodId();
    const m = methods.find(x => x.id === id) || methods[0];
    const shipCents = Number(m?.cents || 0);

    if (subtotalEl) subtotalEl.textContent = (subtotalCents / 100).toFixed(2);
    if (shipCostEl) shipCostEl.textContent = (shipCents / 100).toFixed(2);
    if (totalEl) totalEl.textContent = ((subtotalCents + shipCents) / 100).toFixed(2);
  }

  document.addEventListener("change", (e) => {
    if (e.target && e.target.name === "shipMethod") recalc();
  });
  recalc();

  // ---- button click (THIS is what was missing/broken) ----
  async function continueToCheckout() {
    showMsg("");

    const email = String(loggedInEmail || emailEl?.value || "").trim();
    if (!email || !email.includes("@")) {
      showMsg("Enter a valid email for the receipt.", false);
      return;
    }

    const shippingMethodId = getSelectedMethodId();

    if (!btn) return;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Starting checkout…";

    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, cart, shippingMethodId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data?.url) {
        throw new Error(data?.error || `Checkout failed (HTTP ${res.status})`);
      }

      window.location.assign(data.url);
    } catch (err) {
      console.error(err);
      showMsg(err?.message || "Could not start checkout.", false);
      btn.disabled = false;
      btn.textContent = prev || "Continue to Checkout";
    }
  }

  if (btn) btn.addEventListener("click", continueToCheckout);
});
