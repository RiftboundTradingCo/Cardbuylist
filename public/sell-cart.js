(() => {
  console.log("SELL-CART.JS LOADED ✅");

  const CART_KEY = "sellCart";

  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
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

  // ===== DOM =====
  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const clearBtn = document.getElementById("sellClearCartBtn");
  const submitBtn = document.getElementById("sellSubmitBtn");
  const emailEl = document.getElementById("sellEmail");
  const msgEl = document.getElementById("sellCartMessage");

  if (!listEl || !totalEl) {
    console.warn("sell-cart.js: required elements missing (#sellCartList / #sellCartTotal)");
    return;
  }

  function moneyCents(c) {
    return `$${(Number(c || 0) / 100).toFixed(2)}`;
  }

  function normalizeCond(cond) {
    const allowed = Object.values(TAB_TO_COND);
    const s = String(cond || "").trim();
    return allowed.includes(s) ? s : "Near Mint";
  }

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }
// ✅ refresh header badges immediately (sell + buy)
  if (typeof window.updateCartBadges === "function") {
    window.updateCartBadges();
  }

  function getItemKey(item) {
    const sku = String(item.sku || "").trim();
    if (sku) return sku;
    return `name:${String(item.name || "").trim().toLowerCase()}`;
  }

  function condFromCart(item) {
    const c = String(item.condition || "").trim();
    // if cart uses NM/LP/MP/HP
    if (TAB_TO_COND[c]) return TAB_TO_COND[c];
    return normalizeCond(c);
  }

  // ===== Selllist lookup =====
  let SELL = {};
  let SELL_BY_NAME = new Map();

  async function loadSelllist() {
    try {
      const res = await fetch("/api/selllist", { cache: "no-store" });
      const data = await res.json();
      const selllist = data?.selllist || {};
      SELL = selllist;

      SELL_BY_NAME.clear();
      for (const [sku, v] of Object.entries(SELL)) {
        const nm = String(v?.name || "").trim().toLowerCase();
        if (nm) SELL_BY_NAME.set(nm, sku);
      }

      console.log("selllist loaded:", Object.keys(SELL).length);
    } catch (e) {
      console.error("Failed to load /api/selllist", e);
      SELL = {};
      SELL_BY_NAME.clear();
    }
  }

  function resolveSellItem(groupKey, groupName) {
    if (SELL[groupKey]) return { sku: groupKey, item: SELL[groupKey] };

    const nameKey = String(groupName || "").trim().toLowerCase();
    const sku = SELL_BY_NAME.get(nameKey);
    if (sku && SELL[sku]) return { sku, item: SELL[sku] };

    return { sku: groupKey, item: null };
  }

  // ✅ MATCHES YOUR JSON:
  // item.prices: { NM: 0.1, LP: 0.08, MP: 0.05, HP?: ... }  // dollars
  // item.max:    { NM: 10,  LP: 5,    MP: 0,    HP?: ... }
  function tabForCondition(cond) {
    const c = normalizeCond(cond);
    return COND_TO_TAB[c] || "NM";
  }

  function centsForCondition(item, cond) {
    const tab = tabForCondition(cond);
    const dollars = Number(item?.prices?.[tab] ?? 0);
    return Math.round(dollars * 100);
  }

  function getMaxFor(item, cond) {
    const tab = tabForCondition(cond);
    return Number(item?.max?.[tab] ?? 0);
  }

   // ===== grouping =====
  function groupCart(cart) {
    const groups = new Map();

    for (const it of cart) {
      const key = getItemKey(it);
      const cond = condFromCart(it);
      const qty = Math.max(0, Number(it.qty || 0));

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: String(it.name || it.sku || "").trim(),
          condQty: {
            "Near Mint": 0,
            "Lightly Played": 0,
            "Moderately Played": 0,
            "Heavily Played": 0,
          },
          activeTab: "NM",
        });
      }

      const g = groups.get(key);
      if (!g.name) g.name = String(it.name || it.sku || "").trim();
      g.condQty[cond] = (g.condQty[cond] || 0) + qty;
    }

    // choose active tab = first condition with qty > 0
    for (const g of groups.values()) {
      for (const tab of TAB_ORDER) {
        const c = TAB_TO_COND[tab];
        if ((g.condQty[c] || 0) > 0) {
          g.activeTab = tab;
          break;
        }
      }
    }

    // ✅ stable order (prevents “jumping”)
    const arr = [...groups.values()].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );

    return arr;
  }


  function showMsg(text, isError = false) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = isError ? "red" : "green";
  }

  // ===== cart mutation =====
  function setQty(groupKey, cond, qty) {
    const cart = loadCart();
    const c = normalizeCond(cond);
    const q = Math.max(0, Number(qty || 0));

    const newCart = [];
    for (const it of cart) {
      const key = getItemKey(it);
      const itCond = condFromCart(it);

      if (key !== groupKey || itCond !== c) {
        newCart.push(it);
      }
    }

    if (q > 0) {
      const sample = cart.find(it => getItemKey(it) === groupKey) || {};
      newCart.push({
        sku: sample.sku || (groupKey.startsWith("name:") ? "" : groupKey),
        name: sample.name || "",
        condition: c, // store full condition
        qty: q
      });
    }

    saveCart(newCart);
  }
// ✅ refresh header badges immediately (sell + buy)
  if (typeof window.updateCartBadges === "function") {
    window.updateCartBadges();
  }
  function getQty(groupKey, cond) {
    const cart = loadCart();
    const c = normalizeCond(cond);
    return cart
      .filter(it => getItemKey(it) === groupKey && condFromCart(it) === c)
      .reduce((s, it) => s + (Number(it.qty || 0) || 0), 0);
  }

let GROUP_ORDER = [];              // stable order of group keys
const ACTIVE_TAB_BY_KEY = new Map(); // remember selected tab per group

 // ===== render =====
function render() {
  const cart = loadCart();
  const groupsRaw = groupCart(cart);

  // ---- preserve scroll so nothing "jumps" ----
  const prevScroll = window.scrollY;

  // ---- stabilize which tab is active per group ----
  for (const g of groupsRaw) {
    const remembered = ACTIVE_TAB_BY_KEY.get(g.key);
    if (remembered) g.activeTab = remembered;
  }

  // ---- build stable group order (first time = current order; later = keep existing order) ----
  const keysNow = groupsRaw.map(g => g.key);

  if (GROUP_ORDER.length === 0) {
    GROUP_ORDER = [...keysNow];
  } else {
    // keep existing keys that still exist, in same order
    GROUP_ORDER = GROUP_ORDER.filter(k => keysNow.includes(k));
    // append any new keys that appeared
    for (const k of keysNow) {
      if (!GROUP_ORDER.includes(k)) GROUP_ORDER.push(k);
    }
  }

  // map for quick lookup and render in GROUP_ORDER sequence
  const byKey = new Map(groupsRaw.map(g => [g.key, g]));
  const groups = GROUP_ORDER.map(k => byKey.get(k)).filter(Boolean);

  listEl.innerHTML = "";
  let totalCents = 0;

  for (const g of groups) {
    const { sku, item } = resolveSellItem(g.key, g.name);

    const title = item?.name || g.name || sku || "Unknown";
    const img = item?.image
      ? (String(item.image).startsWith("/") ? item.image : "/" + item.image)
      : "";

    const activeTab = g.activeTab || "NM";
    const activeCond = TAB_TO_COND[activeTab];
    const activeQty = Number(g.condQty[activeCond] || 0);

    const unitCents = item ? centsForCondition(item, activeCond) : 0;
    const maxCap = item ? getMaxFor(item, activeCond) : 0;

    let inCartAll = 0;
    let subtotalCents = 0;
    for (const tab of TAB_ORDER) {
      const cond = TAB_TO_COND[tab];
      const q = Number(g.condQty[cond] || 0);
      if (q > 0) {
        inCartAll += q;
        const u = item ? centsForCondition(item, cond) : 0;
        subtotalCents += u * q;
      }
    }
    totalCents += subtotalCents;

    // Tabs disabled when qty in cart for that condition = 0
    const tabsHtml = TAB_ORDER.map((tab) => {
      const cond = TAB_TO_COND[tab];
      const q = Number(g.condQty[cond] || 0);
      const disabled = q <= 0;
      const isActive = tab === activeTab;
      return `
        <button
          class="cond-tab${isActive ? " active" : ""}${disabled ? " disabled" : ""}"
          type="button"
          data-tab="${tab}"
          aria-disabled="${disabled ? "true" : "false"}"
        >${tab}</button>
      `;
    }).join("");

    const li = document.createElement("li");
    li.className = "cart-item";
    li.dataset.groupKey = g.key;
    li.dataset.sku = sku || "";
    li.dataset.activeTab = activeTab;

li.innerHTML = `
  <div class="cart-card">
    ${img ? `<img class="cart-thumb" src="${encodeURI(img)}" alt="${title}">` : ""}

    <div class="cart-main">
      <h3 class="cart-title">${title}</h3>

      <div class="cond-tabs" role="tablist" aria-label="Condition">
        ${tabsHtml}
      </div>

      <div class="cart-meta">
        <div>Condition: <strong>${activeCond}</strong></div>
        <div>Unit: <strong>${moneyCents(unitCents)}</strong></div>

        <div class="cart-subline">
          In cart (all conditions): <strong>${inCartAll}</strong> •
          Subtotal: <strong>${moneyCents(subtotalCents)}</strong>
        </div>

        <div>Max capacity: <strong>${maxCap}</strong></div>
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


    // clamp buttons based on max
    const plus = li.querySelector(".qty-plus");
    const minus = li.querySelector(".qty-minus");

    if (minus) minus.disabled = activeQty <= 0;
    if (plus) plus.disabled = item ? (activeQty >= maxCap) : true;

    listEl.appendChild(li);
  }

  totalEl.textContent = (totalCents / 100).toFixed(2);

  // restore scroll AFTER DOM updates
  window.scrollTo(0, prevScroll);
}


  // ===== click handlers (delegation) =====
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".cart-item");
    if (!itemEl) return;

    const groupKey = itemEl.dataset.groupKey;
    const activeTab = String(itemEl.dataset.activeTab || "NM").toUpperCase();
    const activeCond = TAB_TO_COND[activeTab];

    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      itemEl.dataset.activeTab = String(tabBtn.dataset.tab || "NM").toUpperCase();
      render();
      return;
    }

    if (e.target.closest(".qty-plus")) {
      const { item } = resolveSellItem(groupKey, "");
      const maxCap = item ? getMaxFor(item, activeCond) : 0;

      const cur = getQty(groupKey, activeCond);
      const next = Math.min(cur + 1, maxCap);
      setQty(groupKey, activeCond, next);
      render();
      return;
    }

    if (e.target.closest(".qty-minus")) {
      const cur = getQty(groupKey, activeCond);
      const next = Math.max(0, cur - 1);
      setQty(groupKey, activeCond, next);
      render();
      return;
    }

    if (e.target.closest(".remove-cond-btn")) {
      setQty(groupKey, activeCond, 0);
      render();
      return;
    }
  });

  // ===== clear =====
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      localStorage.removeItem(CART_KEY);
      showMsg("Cart cleared.");
      render();
    });
  }

  // ===== submit =====
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      showMsg("");

      const email = String(emailEl?.value || "").trim();
      if (!email || !email.includes("@")) {
        showMsg("Enter a valid email for confirmation.", true);
        return;
      }

      const cart = loadCart();
      if (!cart.length) {
        showMsg("Your sell cart is empty.", true);
        return;
      }

      const groups = groupCart(cart);

      let totalCents = 0;
      const orderLines = [];

      for (const g of groups) {
        const resolved = resolveSellItem(g.key, g.name);
        const item = resolved.item;
        const title = item?.name || g.name || resolved.sku || "Unknown";

        for (const tab of TAB_ORDER) {
          const cond = TAB_TO_COND[tab];
          const qty = Number(g.condQty[cond] || 0);
          if (qty <= 0) continue;

          const unitCents = item ? centsForCondition(item, cond) : 0;
          totalCents += unitCents * qty;

          orderLines.push({
            sku: resolved.sku || "",
            name: title,
            condition: cond,
            qty,
            unitPrice: (unitCents / 100),
          });
        }
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Sell Cart Customer",
            email,
            total: (totalCents / 100).toFixed(2),
            order: orderLines,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          showMsg(`Submit failed: ${data.error || "Unknown error"}`, true);
          return;
        }

        localStorage.removeItem(CART_KEY);
        render();
        showMsg("Sell order submitted! Check your email confirmation.");
      } catch (err) {
        console.error(err);
        showMsg("Network error submitting sell order.", true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Sell Order";
      }
    });
  }

  // ===== init =====
  document.addEventListener("DOMContentLoaded", async () => {
    await loadSelllist();
    render();
    console.log("sell-cart.js ready ✅");
  });
})();
