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


  // Buy cart uses full condition strings (same as buy.js)
  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played",
  };

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

    // pick default active tab = first condition with qty
    for (const g of groups.values()) {
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
      itemEl.dataset.activeTab = normalizeTab(tabBtn.dataset.tab || "NM");
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
