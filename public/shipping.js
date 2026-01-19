document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "buyCart";
  const STORAGE_KEY = "buyShipping"; // sessionStorage (optional)

  const subtotalEl = document.getElementById("shipSubtotal");
  const shipCostEl = document.getElementById("shipCost");
  const totalEl = document.getElementById("shipTotal");
  const msgEl = document.getElementById("shipMsg");
  const methodsEl = document.getElementById("shipMethods");
  const btn = document.getElementById("continueToCheckoutBtn");

  const emailEl = document.getElementById("shipEmail");

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

  // --- Free shipping threshold ---
  const FREE_THRESHOLD_CENTS = 9900;

  function buildShippingMethods(subtotalCents) {
    // If eligible: free + upgrades
    if (subtotalCents >= FREE_THRESHOLD_CENTS) {
      return [
        { id: "free", label: "Free Shipping (3–5 business days)", cents: 0 },
        { id: "priority", label: "Priority (2–3 business days)", cents: 899 },
        { id: "express", label: "Express (1–2 business days)", cents: 1499 },
      ];
    }

    // Not eligible: paid options
    return [
      { id: "standard", label: "Standard (3–5 business days)", cents: 499 },
      { id: "priority", label: "Priority (2–3 business days)", cents: 899 },
      { id: "express", label: "Express (1–2 business days)", cents: 1499 },
    ];
  }

  function renderMethods(methods, selectedId) {
    if (!methodsEl) return;
    methodsEl.innerHTML = methods.map(m => `
      <label style="display:flex; align-items:center; gap:10px; margin: 10px 0; font-weight:700;">
        <input type="radio" name="shipMethod" value="${m.id}" ${m.id === selectedId ? "checked" : ""}/>
        <span>${m.label}</span>
        <span style="margin-left:auto;">${money(m.cents)}</span>
      </label>
    `).join("");
  }

  function getSelectedMethodId() {
    const r = document.querySelector('input[name="shipMethod"]:checked');
    return r ? String(r.value) : "";
  }

  function findMethod(methods, id) {
    return methods.find(m => m.id === id) || methods[0];
  }

  // Pre-fill logged in email if available
  try {
    const meRes = await fetch("/api/me", { cache: "no-store" });
    const me = await meRes.json().catch(() => ({}));
    const u = me?.ok ? me.user : null;
    if (u?.email && emailEl) emailEl.value = u.email;
  } catch {}

  // compute subtotal
  const cart = loadCart();
  if (!cart.length) {
    showMsg("Your cart is empty.", false);
    if (btn) btn.disabled = true;
    return;
  }

  let catalog = {};
  try { catalog = await fetchCatalog(); }
  catch (e) {
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

  // restore prior selection (optional)
  const saved = safeParse(sessionStorage.getItem(STORAGE_KEY) || "null", null);
  const defaultSelected =
    saved?.methodId && methods.some(m => m.id === saved.methodId)
      ? saved.methodId
      : methods[0]?.id;

  renderMethods(methods, defaultSelected);

  function recalc() {
    const methodId = getSelectedMethodId() || methods[0]?.id;
    const method = findMethod(methods, methodId);

    const shipCents = Number(method?.cents || 0);

    if (subtotalEl) subtotalEl.textContent = (subtotalCents / 100).toFixed(2);
    if (shipCostEl) shipCostEl.textContent = (shipCents / 100).toFixed(2);
    if (totalEl) totalEl.textContent = ((subtotalCents + shipCents) / 100).toFixed(2);

    // little message
    if (subtotalCents >= FREE_THRESHOLD_CENTS) {
      showMsg("✅ Free shipping unlocked over $99!", true);
    } else {
      showMsg("", true);
    }
  }

  document.addEventListener("change", (e) => {
    if (e.target && e.target.name === "shipMethod") recalc();
  });
  recalc();

  async function continueToCheckout() {
    showMsg("");

    const email = String(emailEl?.value || "").trim();
    if (!email || !email.includes("@")) return showMsg("Enter a valid email.", false);

    const methodId = getSelectedMethodId() || methods[0]?.id;

    // store selection (optional)
    const picked = findMethod(methods, methodId);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      email,
      methodId,
      shippingCents: Number(picked?.cents || 0),
      subtotalCents,
    }));

    if (!btn) return;

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Starting checkout…";

    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          cart,
          shippingMethodId: methodId,
        }),
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

  if (subtotalCents >= FREE_THRESHOLD_CENTS) {
    return [{ id:"free", label:"Free Shipping (3–5 business days)", cents:0 }, ...base.slice(1)];
    // (free + priority + express)
  }
  return base;
}

  if (btn) btn.addEventListener("click", continueToCheckout);
});
