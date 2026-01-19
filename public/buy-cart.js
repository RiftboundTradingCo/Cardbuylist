document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "buyCart";

  const listEl = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");
  const msgEl = document.getElementById("checkoutMsg");
  const clearBtn = document.getElementById("buyClearCartBtn");

  const emailInput = document.getElementById("buyEmail");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const shippingBtn = document.getElementById("shippingCalcBtn"); // optional

  if (!listEl) {
    console.warn("buy-cart: missing #buyCartList. Check buy-cart.html IDs.");
    return;
  }

// ---------- Logged in UX (same pattern as sell cart) ----------
let loggedInEmail = "";

async function applyLoggedInAsUX() {
  if (!emailInput) return;

  try {
    const meRes = await fetch("/api/me", { cache: "no-store" });
    const me = await meRes.json().catch(() => ({}));
    loggedInEmail = me?.ok && me?.user?.email ? String(me.user.email).trim() : "";
  } catch {
    loggedInEmail = "";
  }

  // Not logged in → normal input
  if (!loggedInEmail) {
    emailInput.readOnly = false;
    emailInput.disabled = false;
    emailInput.style.display = "";
    // show label if you hid it before
    const label = emailInput.closest("label");
    if (label) label.style.display = "";
    return;
  }

  // Logged in → fill + hide input (like sell cart)
  emailInput.value = loggedInEmail;
  emailInput.readOnly = true;

  const label = emailInput.closest("label");
  if (label) label.style.display = "none";
  emailInput.style.display = "none";

  // Insert a "Logged in as" box inside the topbar left panel
  const topLeft = document.querySelector(".cart-top-left");
  if (topLeft && !document.getElementById("loggedInAsBoxBuy")) {
    const box = document.createElement("div");
    box.id = "loggedInAsBoxBuy";
    box.style.cssText = `
      margin-top: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(255,255,255,.92);
      border: 1px solid rgba(0,0,0,.12);
      max-width: 560px;
    `;
    box.innerHTML = `
      <div style="font-size:12px; opacity:.75; font-weight:800; margin-bottom:4px;">Logged in as</div>
      <div style="font-size:15px; font-weight:800;">${loggedInEmail}</div>
      <div style="font-size:12px; opacity:.75; margin-top:6px; font-weight:700;">
        (We’ll email your receipt here)
      </div>
    `;

    // Put it after the subtotal line
    topLeft.appendChild(box);
  }
}


  // Buy cart uses full condition strings (same as buy.js)
  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played",
  };

  // Remember active tab per sku so render() doesn't reset it
  const activeTabBySku = new Map();

  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65,
  };

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
    return safeParse(localStorage.getItem(CART_KEY) || "[]", []);
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("cart:changed"));
    if (typeof window.updateCartBadges === "function") window.updateCartBadges();
  }

  function moneyCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function normalizeTab(t) {
    const u = String(t || "NM").toUpperCase();
    return TAB_TO_COND[u] ? u : "NM";
  }

  function normalizeCond(cond) {
    const s = String(cond || "").trim();
    return CONDITION_MULT[s] ? s : "Near Mint";
  }

  function unitCentsFor(baseCents, condition) {
    const cond = normalizeCond(condition);
    const mult = CONDITION_MULT[cond] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    return encodeURI(s.startsWith("/") ? s : `/${s}`);
  }

  // ---------- catalog ----------
  async function fetchCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (!data?.ok || !data.catalog) throw new Error("Bad catalog JSON");
    return data.catalog; // keyed by sku
  }

  let catalog = {};
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    console.error("buy-cart catalog error:", e);
    showMsg("Could not load catalog right now.", false);
    catalog = {};
  }

  // ---------- modal (optional, if your buy-cart.html has it) ----------
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalClose = document.getElementById("imageModalClose");

  function openModal(src) {
    if (!modal || !modalImg) return;
    modalImg.src = src;
    modal.classList.remove("hidden");
  }
  function closeModal() {
    if (!modal || !modalImg) return;
    modal.classList.add("hidden");
    modalImg.src = "";
  }
  if (modalClose) modalClose.addEventListener("click", closeModal);
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ---------- grouping ----------
  function groupCart(cart) {
    const groups = new Map();

    for (const it of cart) {
      const sku = String(it?.sku || "").trim();
      if (!sku) continue;

      const cond = normalizeCond(it?.condition);
      const tab = Object.keys(TAB_TO_COND).find(k => TAB_TO_COND[k] === cond) || "NM";
      const qty = Math.max(0, Number(it?.qty || 0));
      if (qty <= 0) continue;

      if (!groups.has(sku)) {
        const p = catalog?.[sku] || {};
        groups.set(sku, {
          sku,
          name: String(p?.name || sku),
          image: String(p?.image || ""),
          condQty: { NM: 0, LP: 0, MP: 0, HP: 0 },
          activeTab: "NM",
        });
      }

      const g = groups.get(sku);
      g.condQty[tab] = (g.condQty[tab] || 0) + qty;
    }

      // pick active tab:
       // - if user previously selected a tab for this sku, keep it (if it exists in TAB_ORDER)
       // - otherwise pick the first condition that has qty > 0
     for (const g of groups.values()) {
        const remembered = normalizeTab(activeTabBySku.get(g.sku) || "");
     if ((g.condQty[remembered] || 0) > 0) {
        g.activeTab = remembered;
        continue;
     }

     for (const tab of TAB_ORDER) {
       if ((g.condQty[tab] || 0) > 0) {
       g.activeTab = tab;
       break;
     }
   }
 }


    const arr = [...groups.values()];
    arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return arr;
  }

  function getQty(sku, tab) {
    const t = normalizeTab(tab);
    const cond = TAB_TO_COND[t];
    const cart = loadCart();
    return cart.reduce((sum, it) => {
      if (String(it?.sku || "").trim() !== sku) return sum;
      if (normalizeCond(it?.condition) !== cond) return sum;
      return sum + Math.max(0, Number(it?.qty || 0));
    }, 0);
  }

  function setQty(sku, tab, nextQty) {
    const t = normalizeTab(tab);
    const cond = TAB_TO_COND[t];
    const q = Math.max(0, Number(nextQty || 0));

    let cart = loadCart();

    // remove existing sku+cond line
    cart = cart.filter(it => {
      const s = String(it?.sku || "").trim();
      const c = normalizeCond(it?.condition);
      return !(s === sku && c === cond);
    });

    if (q > 0) {
      cart.push({ sku, condition: cond, qty: q });
    }

    saveCart(cart);
  }

  // ---------- render ----------
  function renderWithScroll(fn) {
    const prev = window.scrollY;
    fn();
    requestAnimationFrame(() => window.scrollTo(0, prev));
  }

  function render() {
    const cart = loadCart();
    const groups = groupCart(cart);

    listEl.innerHTML = "";
    showMsg("");

    if (!groups.length) {
      listEl.innerHTML = `<li class="cart-item"><div class="cart-card">Your buy cart is empty.</div></li>`;
      if (totalEl) totalEl.textContent = "0.00";
      return;
    }


    let totalCents = 0;

    for (const g of groups) {
      const p = catalog?.[g.sku] || null;
      const title = String(p?.name || g.name || g.sku);
      const imgSrc = p?.image ? normalizeImagePath(p.image) : "";

      const baseCents = Number(p?.price_cents || 0);

      const activeTab = normalizeTab(g.activeTab || "NM");
      const activeCond = TAB_TO_COND[activeTab];
      const activeQty = Number(g.condQty[activeTab] || 0);

      // subtotal across all conditions
      let inCartAll = 0;
      let subtotalCents = 0;

      for (const tab of TAB_ORDER) {
        const q = Number(g.condQty[tab] || 0);
        if (q <= 0) continue;
        inCartAll += q;
        const cond = TAB_TO_COND[tab];
        const unit = unitCentsFor(baseCents, cond);
        subtotalCents += unit * q;
      }

      totalCents += subtotalCents;

      // tabs with badges
      const tabsHtml = TAB_ORDER.map(tab => {
        const isActive = tab === activeTab;
        const badgeQty = Number(g.condQty[tab] || 0);
        const badge = badgeQty > 0 ? `<span class="tab-badge">${badgeQty}</span>` : "";
        return `
          <button class="cond-tab${isActive ? " active" : ""}" type="button" data-tab="${tab}">
            ${tab}${badge}
          </button>
        `;
      }).join("");

      const unitCents = unitCentsFor(baseCents, activeCond);

      const li = document.createElement("li");
      li.className = "cart-item";
      li.dataset.sku = g.sku;
      li.dataset.activeTab = activeTab;

      li.innerHTML = `
        <div class="cart-card">
          ${imgSrc ? `<img class="cart-thumb" src="${imgSrc}" alt="${title}" data-zoom="1">` : ""}

          <div class="cart-main">
            <h3 class="cart-title">${title}</h3>

            <div class="cond-tabs" role="tablist" aria-label="Condition">
              ${tabsHtml}
            </div>

            <div class="cart-meta">
              <div>Condition: <strong>${activeTab}</strong></div>
              <div>Unit: <strong>${moneyCents(unitCents)}</strong></div>

              <div class="cart-subline">
                In cart (all conditions): <strong>${inCartAll}</strong> •
                Subtotal: <strong>${moneyCents(subtotalCents)}</strong>
              </div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-controls">
              <button class="qty-minus" type="button">−</button>
              <span class="qty-value">${activeQty}</span>
              <button class="qty-plus" type="button">+</button>
            </div>

            <div class="line-price">${moneyCents(unitCents * activeQty)}</div>

            <button class="remove-cond-btn" type="button">Remove condition</button>
          </div>
        </div>
      `;

      // button disabling
      const minus = li.querySelector(".qty-minus");
      const plus = li.querySelector(".qty-plus");
      if (minus) minus.disabled = activeQty <= 0;

      // Optional: if you want to cap by stock, you can do it here.
      // For now, we won't hard-disable plus unless you want stock enforcement in cart too.
      if (plus) plus.disabled = false;

      const thumb = li.querySelector(".cart-thumb");
      if (thumb) thumb.addEventListener("click", () => openModal(thumb.getAttribute("src")));

      listEl.appendChild(li);
    }

    if (totalEl) totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  render();


  // email: try logged-in user first, else input
  let email = "";
  try {
    const meRes = await fetch("/api/me", { cache: "no-store" });
    const me = await meRes.json().catch(() => ({}));
    email = me?.ok && me?.user?.email ? String(me.user.email).trim() : "";
  } catch {}

  if (!email) email = String(emailInput?.value || "").trim();

  if (!email || !email.includes("@")) {
    showMsg("Please enter a valid email for receipt.", false);
    return;
  }

  checkoutBtn.disabled = true;
  const prev = checkoutBtn.textContent;
  checkoutBtn.textContent = "Starting checkout…";


    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !data?.url) {
      throw new Error(data?.error || `Checkout failed (HTTP ${res.status})`);
    }


await applyLoggedInAsUX();
render();

// ===== Checkout button -> go to shipping page (do NOT call Stripe from cart page) =====
if (checkoutBtn) {
  checkoutBtn.addEventListener("click", () => {
    const cart = loadCart();
    if (!Array.isArray(cart) || cart.length === 0) {
      showMsg("Your cart is empty.", false);
      return;
    }

    // prefer cached loggedInEmail (set by applyLoggedInAsUX)
    let email = String(loggedInEmail || "").trim();

    // fallback to visible input (only shown when not logged in)
    if (!email) email = String(emailInput?.value || "").trim();

    if (!email || !email.includes("@")) {
      showMsg("Please enter a valid email for receipt.", false);
      return;
    }

    // store for shipping page (so shipping.html can preload it)
    sessionStorage.setItem("buyCheckoutEmail", email);

    // go to shipping selection page
    window.location.href = "/shipping.html";
  });
}


  // ---------- clicks ----------
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".cart-item");
    if (!itemEl) return;

    const sku = String(itemEl.dataset.sku || "").trim();
    if (!sku) return;

    const activeTab = normalizeTab(itemEl.dataset.activeTab || "NM");

    // tab switch
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      const nextTab = normalizeTab(tabBtn.dataset.tab || "NM");
      activeTabBySku.set(sku, nextTab);
      itemEl.dataset.activeTab = nextTab;
      renderWithScroll(render);
      return;
    }

    // qty +
    if (e.target.closest(".qty-plus")) {
      const cur = getQty(sku, activeTab);
      const next = cur + 1;
      setQty(sku, activeTab, next);
      renderWithScroll(render);
      return;
    }

    // qty -
    if (e.target.closest(".qty-minus")) {
      const cur = getQty(sku, activeTab);
      const next = Math.max(0, cur - 1);
      setQty(sku, activeTab, next);
      renderWithScroll(render);
      return;
    }

    // remove condition
    if (e.target.closest(".remove-cond-btn")) {
      setQty(sku, activeTab, 0);
      renderWithScroll(render);
      return;
    }
  });

  // ---------- clear ----------
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      showMsg("Cart cleared.");
      renderWithScroll(render);
    });
  }

  // keep in sync if other pages modify cart
  window.addEventListener("cart:changed", () => renderWithScroll(render));
});
