document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "buyCart";
  const STORAGE_KEY = "buyShipping"; // sessionStorage

  const subtotalEl = document.getElementById("shipSubtotal");
  const shipCostEl = document.getElementById("shipCost");
  const totalEl = document.getElementById("shipTotal");
  const msgEl = document.getElementById("shipMsg");
  const methodsEl = document.getElementById("shipMethods");
  const btn = document.getElementById("continueToCheckoutBtn");

  const nameEl = document.getElementById("shipName");
  const emailEl = document.getElementById("shipEmail");
  const line1El = document.getElementById("shipLine1");
  const line2El = document.getElementById("shipLine2");
  const cityEl = document.getElementById("shipCity");
  const stateEl = document.getElementById("shipState");
  const postalEl = document.getElementById("shipPostal");
  const countryEl = document.getElementById("shipCountry");

  function showMsg(t, ok=true){ if(msgEl){ msgEl.textContent=t||""; msgEl.style.color=ok?"#1b7f3a":"#b00020"; } }
  function safeParse(raw, fallback){ try{return JSON.parse(raw);}catch{return fallback;} }
  function loadCart(){ return safeParse(localStorage.getItem(CART_KEY)||"[]",[]); }
  function money(cents){ return `$${(Number(cents||0)/100).toFixed(2)}`; }

  // same rules as buy.js
  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65,
  };
  function normalizeCond(c){
    const s = String(c||"Near Mint").trim();
    return CONDITION_MULT[s] ? s : "Near Mint";
  }
  function unitCentsFor(baseCents, condition){
    const cond = normalizeCond(condition);
    return Math.round(Number(baseCents||0) * (CONDITION_MULT[cond] ?? 1));
  }

  async function fetchCatalog(){
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    const data = await res.json().catch(()=>({}));
    if(!data?.ok || !data.catalog) throw new Error("Bad catalog JSON");
    return data.catalog;
  }

  // basic shipping methods (flat rates)
  // later you can replace this with a server endpoint that calculates by weight/zone.
  const SHIPPING_METHODS = [
    { id: "standard", label: "Standard (3–5 business days)", cents: 499 },
    { id: "priority", label: "Priority (2–3 business days)", cents: 899 },
    { id: "express",  label: "Express (1–2 business days)",  cents: 1499 },
  ];

  function renderMethods(selectedId){
    methodsEl.innerHTML = SHIPPING_METHODS.map(m => `
      <label style="display:flex; align-items:center; gap:10px; margin: 10px 0; font-weight:700;">
        <input type="radio" name="shipMethod" value="${m.id}" ${m.id===selectedId?"checked":""}/>
        <span>${m.label}</span>
        <span style="margin-left:auto;">${money(m.cents)}</span>
      </label>
    `).join("");
  }

  function getSelectedMethodId(){
    const r = document.querySelector('input[name="shipMethod"]:checked');
    return r ? String(r.value) : "standard";
  }

  function findMethod(id){
    return SHIPPING_METHODS.find(m => m.id === id) || SHIPPING_METHODS[0];
  }

  // Pre-fill logged in email/address if available
  try {
    const meRes = await fetch("/api/me", { cache: "no-store" });
    const me = await meRes.json().catch(()=>({}));
    const u = me?.ok ? me.user : null;
    if (u?.email && emailEl) emailEl.value = u.email;
    if (u?.name && nameEl && !nameEl.value) nameEl.value = u.name;
    if (u?.address) {
      line1El.value = u.address.line1 || "";
      line2El.value = u.address.line2 || "";
      cityEl.value = u.address.city || "";
      stateEl.value = u.address.state || "";
      postalEl.value = u.address.postal || "";
      countryEl.value = u.address.country || "US";
    }
  } catch {}

  // restore prior selection
  const saved = safeParse(sessionStorage.getItem(STORAGE_KEY) || "null", null);
  const savedMethod = saved?.methodId || "standard";
  renderMethods(savedMethod);

  // compute subtotal
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

  function recalc(){
    const method = findMethod(getSelectedMethodId());
    const shipCents = method.cents;
    if (subtotalEl) subtotalEl.textContent = (subtotalCents/100).toFixed(2);
    if (shipCostEl) shipCostEl.textContent = (shipCents/100).toFixed(2);
    if (totalEl) totalEl.textContent = ((subtotalCents+shipCents)/100).toFixed(2);
  }

  document.addEventListener("change", (e) => {
    if (e.target && e.target.name === "shipMethod") recalc();
  });
  recalc();

  async function continueToCheckout(){
    showMsg("");

    const email = String(emailEl?.value || "").trim();
    const fullName = String(nameEl?.value || "").trim();
    const line1 = String(line1El?.value || "").trim();
    const city = String(cityEl?.value || "").trim();
    const state = String(stateEl?.value || "").trim();
    const postal = String(postalEl?.value || "").trim();
    const country = String(countryEl?.value || "US").trim();

    if (!email || !email.includes("@")) return showMsg("Enter a valid email.", false);
    if (!fullName) return showMsg("Enter your name.", false);
    if (!line1 || !city || !state || !postal) return showMsg("Complete the shipping address.", false);

    const methodId = getSelectedMethodId();
    const method = findMethod(methodId);

    // store for success page / future enhancements
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      email,
      fullName,
      address: {
        line1,
        line2: String(line2El?.value || "").trim(),
        city, state, postal, country,
      },
      methodId,
      shippingCents: method.cents,
      subtotalCents,
    }));

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Starting checkout…";

    try {
      // call your existing endpoint
      // (Next improvement: pass shipping choice to server and create Stripe Shipping Options.)
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, cart }),
      });

      const data = await res.json().catch(()=>({}));
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
