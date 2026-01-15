document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "sellCart";

  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const msgEl = document.getElementById("sellCartMessage");
  const clearBtn = document.getElementById("sellClearCartBtn");

  const emailInput = document.getElementById("sellEmail");
  const submitBtn = document.getElementById("sellSubmitBtn");

  if (!listEl || !totalEl) {
    console.error("sell-cart.js: Missing #sellCartList or #sellCartTotal");
    return;
  }

  // The row that contains the email input + submit button
  const checkoutRow = emailInput ? emailInput.closest(".cart-checkout-row") : null;
  // The label above the row (Email for confirmation)
  const checkoutLabel = document.querySelector('label[for="sellEmail"]');
  // The checkout container
  const checkoutBox = document.querySelector(".cart-checkout");

  // Sell cart uses NM/LP/MP
  const TAB_ORDER = ["NM", "LP", "MP"];

  // Accept both short + long names (defensive)
  const LONG_TO_TAB = {
    "NEAR MINT": "NM",
    "LIGHTLY PLAYED": "LP",
    "MODERATELY PLAYED": "MP",
  };

  function showMsg(text, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }

  function safeParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function loadCart() {
    const v = safeParse(localStorage.getItem(CART_KEY) || "[]", []);
    return Array.isArray(v) ? v : [];
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(Array.isArray(cart) ? cart : []));
    window.dispatchEvent(new Event("cart:changed"));
  }

  function moneyCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function normalizeTab(raw) {
    const s = String(raw || "NM").trim();
    const up = s.toUpperCase();

    if (TAB_ORDER.includes(up)) return up;
    if (LONG_TO_TAB[up]) return LONG_TO_TAB[up];

    // Sometimes cart items might store "Near Mint" etc with original casing
    const up2 = up.replace(/\s+/g, " ").trim();
    if (LONG_TO_TAB[up2]) return LONG_TO_TAB[up2];

    return "NM";
  }

  // Identify an item by SKU if present, else by name
  function getItemKey(item) {
    const sku = String(item?.sku || "").trim();
    if (sku) return sku;
    const name = String(item?.name || "").trim().toLowerCase();
    return `name:${name || "unknown"}`;
  }

  function condFromCart(item) {
    // Accept item.condition (NM/LP/MP) OR full names (Near Mint/...)
    return normalizeTab(item?.condition || "NM");
  }

  // ---------- Logged in UX ----------
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

    if (!loggedInEmail) {
      emailInput.readOnly = false;
      emailInput.disabled = false;
      emailInput.style.display = "";
      if (checkoutLabel) checkoutLabel.style.display = "";
      return;
    }

    emailInput.value = loggedInEmail;
    emailInput.readOnly = true;

    if (checkoutLabel) checkoutLabel.style.display = "none";
    emailInput.style.display = "none";

    if (checkoutBox && !document.getElementById("loggedInAsBox")) {
      const box = document.createElement("div");
      box.id = "loggedInAsBox";
      box.style.cssText = `
        margin: 10px 0 12px;
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
          (We’ll confirm this sell order here)
        </div>
      `;
      checkoutBox.insertBefore(box, checkoutBox.firstChild);
    }

    if (checkoutRow) {
      checkoutRow.style.display = "flex";
      checkoutRow.style.gap = "10px";
      checkoutRow.style.alignItems = "center";
    }
  }

  // ---------- Selllist ----------
  async function fetchSellList() {
    const res = await fetch("/api/selllist", { cache: "no-store" });
    if (!res.ok) throw new Error(`selllist HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (!data?.ok || data.selllist == null) throw new Error("Bad selllist JSON");

    const raw = data.selllist;

    // If server returns object keyed by sku, keep it
    if (!Array.isArray(raw)) return raw;

    // If server returns rows, keep rows by sku in an object
    const out = {};
    for (const r of raw) {
      const sku = String(r?.sku || "").trim();
      if (!sku) continue;

      out[sku] = {
        // allow both
        name: r.name,
        image: r.image,
        // DB-style columns
        price_nm: r.price_nm,
        price_lp: r.price_lp,
        price_mp: r.price_mp,
        max_nm: r.max_nm,
        max_lp: r.max_lp,
        max_mp: r.max_mp,
        // optional remaining fields if you add them server-side
        remaining_nm: r.remaining_nm,
        remaining_lp: r.remaining_lp,
        remaining_mp: r.remaining_mp,
        // also accept old nested shapes if they exist
        prices: r.prices,
        max: r.max,
        remaining: r.remaining,
      };
    }
    return out;
  }

  let selllist = {};
  try {
    selllist = await fetchSellList();
  } catch (e) {
    console.error("sell-cart selllist error:", e);
    showMsg("Could not load sell prices right now.", false);
    selllist = {};
  }

  function resolveSellItem(groupKey, fallbackName) {
    const sku = groupKey.startsWith("name:") ? "" : groupKey;
    const item = sku ? selllist?.[sku] : null;
    return { sku, item, fallbackName };
  }

  function getPriceFor(item, tab) {
    const t = normalizeTab(tab);

    // Old JSON: item.prices.NM
    if (item?.prices && item.prices[t] != null) {
      const p = Number(item.prices[t]);
      return Number.isFinite(p) ? p : 0;
    }

    // DB: price_nm/price_lp/price_mp
    const col = t === "NM" ? "price_nm" : t === "LP" ? "price_lp" : "price_mp";
    const p = Number(item?.[col] ?? 0);
    return Number.isFinite(p) ? p : 0;
  }

  function getMaxFor(item, tab) {
    const t = normalizeTab(tab);

    // Old JSON: item.max.NM
    if (item?.max && item.max[t] != null) {
      const m = Number(item.max[t]);
      return Number.isFinite(m) ? m : 0;
    }

    // DB: max_nm/max_lp/max_mp
    const col = t === "NM" ? "max_nm" : t === "LP" ? "max_lp" : "max_mp";
    const m = Number(item?.[col] ?? 0);
    return Number.isFinite(m) ? m : 0;
  }

  // Remaining is OPTIONAL. If not provided by server, we treat remaining as "infinite"
  // and cap only by max.
  function getRemainingFor(item, tab) {
    const t = normalizeTab(tab);

    // If server returns nested remaining: item.remaining.NM
    if (item?.remaining && item.remaining[t] != null) {
      const n = Number(item.remaining[t]);
      return Number.isFinite(n) ? n : 0;
    }

    // If server returns remaining_nm columns
    const col = t === "NM" ? "remaining_nm" : t === "LP" ? "remaining_lp" : "remaining_mp";
    if (item?.[col] == null) return Number.POSITIVE_INFINITY;

    const n = Number(item[col]);
    return Number.isFinite(n) ? n : 0;
  }

  function getEffectiveCapFor(item, tab) {
    const maxCap = getMaxFor(item, tab);
    if (maxCap <= 0) return 0;

    const remaining = getRemainingFor(item, tab);
    if (remaining === Number.POSITIVE_INFINITY) return maxCap;

    return Math.max(0, Math.min(maxCap, remaining));
  }

  // ----- cart grouping -----
  function groupCart(cart) {
    const groups = new Map();

    for (const it of cart) {
      const key = getItemKey(it);
      const cond = condFromCart(it); // NM/LP/MP
      const qty = Math.max(0, Number(it?.qty || 0));
      if (!qty) continue;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: String(it?.name || it?.sku || "").trim(),
          condQty: { NM: 0, LP: 0, MP: 0 },
          activeTab: "NM",
        });
      }

      const g = groups.get(key);
      if (!g.name) g.name = String(it?.name || it?.sku || "").trim();
      g.condQty[cond] = (g.condQty[cond] || 0) + qty;
    }

    // Choose an active tab (first non-zero), else default NM
    for (const g of groups.values()) {
      g.activeTab = "NM";
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

  function getQty(groupKey, tab) {
    const cart = loadCart();
    const t = normalizeTab(tab);
    let sum = 0;

    for (const it of cart) {
      if (getItemKey(it) !== groupKey) continue;
      if (condFromCart(it) !== t) continue;
      sum += Math.max(0, Number(it?.qty || 0));
    }
    return sum;
  }

  function setQty(groupKey, tab, nextQty) {
    const t = normalizeTab(tab);
    const q = Math.max(0, Number(nextQty || 0));

    let cart = loadCart();
    cart = cart.filter((it) => !(getItemKey(it) === groupKey && condFromCart(it) === t));

    if (q > 0) {
      if (groupKey.startsWith("name:")) {
        const name = groupKey.slice(5);
        cart.push({ name, condition: t, qty: q });
      } else {
        const { item } = resolveSellItem(groupKey, "");
        const name = String(item?.name || "").trim();
        cart.push({ sku: groupKey, name, condition: t, qty: q });
      }
    }

    saveCart(cart);
  }

  function renderWithScroll(fn) {
    const prev = window.scrollY;
    fn();
    requestAnimationFrame(() => window.scrollTo(0, prev));
  }

  // ----- image modal -----
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
  if (modal) modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ----- render -----
  function render() {
    const cart = loadCart();
    const groups = groupCart(cart);

    listEl.innerHTML = "";
    showMsg("");

    if (!groups.length) {
      listEl.innerHTML = `<li class="cart-item"><div class="cart-card">Your sell cart is empty.</div></li>`;
      totalEl.textContent = "0.00";
      return;
    }

    let totalCents = 0;

    for (const g of groups) {
      const { sku, item } = resolveSellItem(g.key, g.name);

      const title = String(item?.name || g.name || sku || "Unknown").trim() || "Unknown";

      const img = item?.image
        ? (String(item.image).startsWith("/") ? String(item.image) : "/" + String(item.image))
        : "";

      const activeTab = normalizeTab(g.activeTab || "NM");
      const activeQty = Number(g.condQty[activeTab] || 0);

      // Prices and caps
      const unitDollars = item ? getPriceFor(item, activeTab) : 0;
      const unitCents = Math.round(unitDollars * 100);

      const policyMax = item ? getMaxFor(item, activeTab) : 0;
      const remaining = item ? getRemainingFor(item, activeTab) : Number.POSITIVE_INFINITY;
      const cap = item ? getEffectiveCapFor(item, activeTab) : 0;

      // Totals across all conditions
      let inCartAll = 0;
      let subtotalCents = 0;

      for (const tab of TAB_ORDER) {
        const q = Number(g.condQty[tab] || 0);
        if (q <= 0) continue;
        inCartAll += q;
        const u = item ? Math.round(getPriceFor(item, tab) * 100) : 0;
        subtotalCents += u * q;
      }

      totalCents += subtotalCents;

      // ✅ Tabs are ALWAYS clickable unless that condition is not allowed (max <= 0) or missing item
      const tabsHtml = TAB_ORDER.map((tab) => {
        const isActive = tab === activeTab;
        const canUse = !!item && getMaxFor(item, tab) > 0 && getPriceFor(item, tab) > 0;

        return `
          <button
            class="cond-tab${isActive ? " active" : ""}${canUse ? "" : " disabled"}"
            type="button"
            data-tab="${tab}"
            aria-disabled="${canUse ? "false" : "true"}"
          >${tab}</button>
        `;
      }).join("");

      const li = document.createElement("li");
      li.className = "cart-item";
      li.dataset.groupKey = g.key;
      li.dataset.activeTab = activeTab;

      const remainingText =
        remaining === Number.POSITIVE_INFINITY ? "—" : String(Math.max(0, remaining));

      li.innerHTML = `
        <div class="cart-card">
          ${img ? `<img class="cart-thumb" src="${encodeURI(img)}" alt="${title}" data-zoom="1">` : ""}

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

              <div>
                Max capacity: <strong>${policyMax}</strong>
                ${remainingText !== "—" ? ` • Remaining: <strong>${remainingText}</strong>` : ""}
              </div>

              ${
                !item
                  ? `<div style="color:#b00020; font-weight:800; margin-top:6px;">
                       This card isn’t in the sell list right now.
                     </div>`
                  : ""
              }
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

      const plus = li.querySelector(".qty-plus");
      const minus = li.querySelector(".qty-minus");
      const thumb = li.querySelector(".cart-thumb");

      if (thumb) thumb.addEventListener("click", () => openModal(thumb.getAttribute("src")));

      if (minus) minus.disabled = activeQty <= 0;

      // ✅ plus disabled if missing item OR cap is 0 OR reached cap
      if (plus) plus.disabled = !item || cap <= 0 || activeQty >= cap;

      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  // ---------- init ----------
  await applyLoggedInAsUX();
  render();

  // ===== click handlers (event delegation) =====
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".cart-item");
    if (!itemEl) return;

    const groupKey = itemEl.dataset.groupKey;
    const activeTab = normalizeTab(itemEl.dataset.activeTab || "NM");

    // Switch condition tab
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      const disabled = tabBtn.getAttribute("aria-disabled") === "true" || tabBtn.classList.contains("disabled");
      if (disabled) return;

      itemEl.dataset.activeTab = normalizeTab(tabBtn.dataset.tab || "NM");
      renderWithScroll(render);
      return;
    }

    // Plus
    if (e.target.closest(".qty-plus")) {
      const { item } = resolveSellItem(groupKey, "");
      if (!item) return;

      const cap = getEffectiveCapFor(item, activeTab);
      const cur = getQty(groupKey, activeTab);
      const next = cap > 0 ? Math.min(cur + 1, cap) : cur;

      if (next !== cur) {
        setQty(groupKey, activeTab, next);
        renderWithScroll(render);
      }
      return;
    }

    // Minus
    if (e.target.closest(".qty-minus")) {
      const cur = getQty(groupKey, activeTab);
      const next = Math.max(0, cur - 1);

      setQty(groupKey, activeTab, next);
      renderWithScroll(render);
      return;
    }

    // Remove condition
    if (e.target.closest(".remove-cond-btn")) {
      setQty(groupKey, activeTab, 0);
      renderWithScroll(render);
      return;
    }
  });

  // ===== clear =====
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveCart([]);
      showMsg("Cart cleared.");
      renderWithScroll(render);
    });
  }

  // ===== submit sell order =====
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const email = String(loggedInEmail || emailInput?.value || "").trim();
      if (!email || !email.includes("@")) {
        showMsg("Please enter a valid email for confirmation.", false);
        return;
      }

      const cart = loadCart();
      if (!cart.length) {
        showMsg("Your sell cart is empty.", false);
        return;
      }

      submitBtn.disabled = true;
      const prevText = submitBtn.textContent;
      submitBtn.textContent = "Submitting...";

      try {
        // Refresh selllist so caps/prices are current
        try {
          selllist = await fetchSellList();
        } catch {}

        const groups = groupCart(cart);
        const order = [];

        for (const g of groups) {
          const { sku, item } = resolveSellItem(g.key, g.name);
          if (!item) continue;

          for (const tab of TAB_ORDER) {
            const qty = Number(g.condQty[tab] || 0);
            if (qty <= 0) continue;

            const unitPriceDollars = getPriceFor(item, tab);
            const unitPriceCents = Math.round(unitPriceDollars * 100);
            const lineTotalCents = unitPriceCents * qty;

            order.push({
              sku: sku || g.key,
              name: item.name,
              condition: tab, // NM/LP/MP
              qty,
              unitPriceCents,
              lineTotalCents,
            });
          }
        }

        if (!order.length) throw new Error("Could not build order (missing selllist pricing).");

        const totalCents = order.reduce((sum, l) => sum + Number(l.lineTotalCents || 0), 0);

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Sell Customer",
            email,
            totalCents,
            order,
          }),
        });

        const text = await res.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {}

        if (!res.ok || !data?.ok) {
          throw new Error((data && data.error) || text || `HTTP ${res.status}`);
        }

        sessionStorage.setItem(
          "sellOrderRecap",
          JSON.stringify({
            name: "Sell Customer",
            email,
            order,
            totalCents,
          })
        );

        saveCart([]);
        window.location.href = "/recap.html";
      } catch (err) {
        console.error("Sell submit error:", err);
        showMsg(String(err?.message || "Error submitting sell order. Try again."), false);
        submitBtn.disabled = false;
        submitBtn.textContent = prevText || "Submit Sell Order";
      }
    });
  }
});
