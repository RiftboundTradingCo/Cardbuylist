document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "buyCart";

  const subtotalEl = document.getElementById("shipSubtotal");
  const shipCostEl = document.getElementById("shipCost");
  const totalEl = document.getElementById("shipTotal");
  const msgEl = document.getElementById("shipMsg");
  const methodsEl = document.getElementById("shipMethods");
  const btn = document.getElementById("continueToCheckoutBtn");

  const emailEl = document.getElementById("shipEmail");
  const topLeft = document.querySelector(".cart-top-left");

  const savedEmail = sessionStorage.getItem("buyCheckoutEmail") || "";
  if (emailEl && savedEmail && !emailEl.value) emailEl.value = savedEmail;

  function showMsg(t, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = t || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }
  function safeParse(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }
  function loadCart() { return safeParse(localStorage.getItem(CART_KEY) || "[]", []); }
  function money(cents) { return `$${(Number(cents || 0) / 100).toFixed(2)}`; }

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

  // local shipping methods (used for display + passing chosen method to server)
  const FREE_THRESHOLD_CENTS = 9900;
  const SHIPPING_METHODS = [
    { id: "free",     label: "Free Shipping (3–5 business days)", cents: 0 },
    { id: "standard", label: "Standard (3–5 business days)",      cents: 499 },
    { id: "priority", label: "Priority (2–3 business days)",      cents: 999 },
    { id: "express",  label: "Express (1–2 business days)",       cents: 1999 },
  ];

  function renderMethods(subtotalCents, selectedId) {
    const canFree = subtotalCents >= FREE_THRESHOLD_CENTS;
    const list = SHIPPING_METHODS.filter(m => m.id !== "free" || canFree);

    // pick default
    const defaultId = selectedId && list.some(m => m.id === selectedId)
      ? selectedId
      : (canFree ? "free" : "standard");

    methodsEl.innerHTML = list.map(m => `
      <label style="display:flex;align-items:center;gap:10px;margin:10px 0;font-weight:800;">
        <input type="radio" name="shipMethod" value="${m.id}" ${m.id===defaultId?"checked":""}/>
        <span>${m.label}</span>
        <span style="margin-left:auto;">${money(m.cents)}</span>
      </label>
    `).join("");
  }

  function getSelectedMethodId(subtotalCents) {
    const r = document.querySelector('input[name="shipMethod"]:checked');
    if (r) return String(r.value);
    return subtotalCents >= FREE_THRESHOLD_CENTS ? "free" : "standard";
  }

  function findMethod(id) {
    return SHIPPING_METHODS.find(m => m.id === id) || SHIPPING_METHODS[1];
  }

  // --- Logged in UX (hide email input & show box) ---
  let loggedInEmail = "";
  async function applyLoggedInAsUX() {
    if (!emailEl) return;

    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const me = await meRes.json().catch(() => ({}));
      loggedInEmail = me?.ok && me?.user?.email ? String(me.user.email).trim() : "";
    } catch {
      loggedInEmail = "";
    }

    if (!loggedInEmail) {
      // not logged in
      emailEl.style.display = "";
      emailEl.readOnly = false;
      return;
    }

    // logged in
    emailEl.value = loggedInEmail;
    emailEl.readOnly = true;
    emailEl.style.display = "none";

    // Insert "Logged in as" box if not already present
    if (topLeft && !document.getElementById("loggedInAsBox")) {
      const box = document.createElement("div");
      box.id = "loggedInAsBox";
      box.style.cssText = `
        margin: 10px 0 0;
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(255,255,255,.92);
        border: 1px solid rgba(0,0,0,.12);
        max-width: 560px;
      `;
      box.innerHTML = `
        <div style="font-size:12px; opacity:.75; font-weight:900; margin-bottom:4px;">Logged in as</div>
        <div style="font-size:15px; font-weight:900;">${loggedInEmail}</div>
        <div style="font-size:12px; opacity:.75; margin-top:6px; font-weight:800;">
          (We’ll email your receipt here)
        </div>
      `;
      // Put it right below the totals
      topLeft.appendChild(box);
    }
  }

  // --- compute subtotal ---
  const cart = loadCart();
  if (!cart.length) {
    showMsg("Your cart is empty.", false);
    if (btn) btn.disabled = true;
    return;
  }

  let catalog = {};
  try { catalog = await fetchCatalog(); }
  catch (e) { console.error(e); showMsg("Could not load catalog.", false); return; }

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

  // init UI
  await applyLoggedInAsUX();
  renderMethods(subtotalCents, ""); // default selection based on subtotal

  function recalc() {
    const methodId = getSelectedMethodId(subtotalCents);
    const method = findMethod(methodId);
    const shipCents = (methodId === "free" && subtotalCents < FREE_THRESHOLD_CENTS) ? findMethod("standard").cents : method.cents;

    if (subtotalEl) subtotalEl.textContent = (subtotalCents / 100).toFixed(2);
    if (shipCostEl) shipCostEl.textContent = (shipCents / 100).toFixed(2);
    if (totalEl) totalEl.textContent = ((subtotalCents + shipCents) / 100).toFixed(2);
  }

  document.addEventListener("change", (e) => {
    if (e.target && e.target.name === "shipMethod") recalc();
  });
  recalc();

  async function continueToCheckout() {
    showMsg("");

    const email = String(loggedInEmail || emailEl?.value || "").trim();
    if (!email || !email.includes("@")) {
      showMsg("Enter a valid email for receipt.", false);
      return;
    }

    const shippingMethodId = getSelectedMethodId(subtotalCents);

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
