document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "sellCart";

  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const msgEl = document.getElementById("sellCartMessage");
  const clearBtn = document.getElementById("sellClearCartBtn");

  const emailInput = document.getElementById("sellEmail");
  const submitBtn = document.getElementById("sellSubmitBtn");

  if (!listEl || !totalEl) return;

  // Sell cart uses NM/LP/MP
  const TAB_ORDER = ["NM", "LP", "MP"];
  const TAB_TO_COND = { NM: "NM", LP: "LP", MP: "MP" };

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

    // ✅ badge update in same tab
    window.dispatchEvent(new Event("cart:changed"));
    if (typeof window.updateCartBadges === "function") window.updateCartBadges();
  }

  function money(n) {
    return `$${(Number(n || 0)).toFixed(2)}`;
  }

  function normalizeTab(t) {
    const u = String(t || "NM").toUpperCase();
    return TAB_TO_COND[u] ? u : "NM";
  }

  // Identify an item by SKU if present, else by name
  function getItemKey(item) {
    const sku = String(item.sku || "").trim();
    if (sku) return sku;
    return `name:${String(item.name || "").trim().toLowerCase()}`;
  }

  function normalizeCond(c) {
    const t = normalizeTab(c);
    return TAB_TO_COND[t]; // "NM" | "LP" | "MP"
  }

  function condFromCart(item) {
    const c = String(item.condition || "").trim();
    if (TAB_TO_COND[c]) return TAB_TO_COND[c]; // already NM/LP/MP
    return normalizeCond(c);
  }

  async function fetchSellList() {
    const res = await fetch("/api/selllist", { cache: "no-store" });
    if (!res.ok) throw new Error(`selllist HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok || !data.selllist) throw new Error("Bad selllist JSON");
    return data.selllist;
  }

  // groupKey -> item
  function resolveSellItem(groupKey, fallbackName) {
    const sku = groupKey.startsWith("name:") ? "" : groupKey;
    const item = sku ? selllist[sku] : null;
    if (item) return { sku, item };
    return { sku: sku || "", item: null, fallbackName };
  }

  function getPriceFor(item, tab) {
    const t = normalizeTab(tab);
    const p = Number(item?.prices?.[t] ?? 0);
    return Number.isFinite(p) ? p : 0; // dollars
  }

  function getMaxFor(item, tab) {
    const t = normalizeTab(tab);
    const m = Number(item?.max?.[t] ?? 0);
    return Number.isFinite(m) ? m : 0;
  }

  // ----- cart grouping (stable) -----
  // cart lines stored as: [{sku?, name?, condition:"NM", qty: 2}, ...]
  function groupCart(cart) {
    const groups = new Map();

    for (const it of cart) {
      const key = getItemKey(it);
      const cond = condFromCart(it); // NM/LP/MP
      const qty = Math.max(0, Number(it.qty || 0));

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: String(it.name || it.sku || "").trim(),
          condQty: { NM: 0, LP: 0, MP: 0 },
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
        if ((g.condQty[tab] || 0) > 0) {
          g.activeTab = tab;
          break;
        }
      }
    }

    // ✅ IMPORTANT: keep stable sort
    const arr = [...groups.values()];
    arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return arr;
  }

  function getQty(groupKey, tab) {
    const cart = loadCart();
    let sum = 0;

    for (const it of cart) {
      if (getItemKey(it) !== groupKey) continue;
      const c = condFromCart(it);
      if (c === tab) sum += Math.max(0, Number(it.qty || 0));
    }
    return sum;
  }

  function setQty(groupKey, tab, nextQty) {
    const t = normalizeTab(tab);
    const q = Math.max(0, Number(nextQty || 0));

    let cart = loadCart();

    // remove existing lines for this key/tab
    cart = cart.filter((it) => !(getItemKey(it) === groupKey && condFromCart(it) === t));

    if (q > 0) {
      // re-add single consolidated line
      if (groupKey.startsWith("name:")) {
        // we only have a name fallback
        const name = groupKey.slice(5);
        cart.push({ name, condition: t, qty: q });
      } else {
        const { item } = resolveSellItem(groupKey, "");
        const name = item?.name || "";
        cart.push({ sku: groupKey, name, condition: t, qty: q });
      }
    }

    saveCart(cart);
  }

  // keep scroll fixed when rerender
  function renderWithScroll(fn) {
    const prev = window.scrollY;
    fn();
    requestAnimationFrame(() => window.scrollTo(0, prev));
  }

  // ----- image modal (optional) -----
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

  // ---------- DATA ----------
  let selllist = {};
  try {
    selllist = await fetchSellList();
  } catch (e) {
    console.error("sell-cart selllist error:", e);
    showMsg("Could not load sell prices right now.", false);
    selllist = {};
  }

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

      const title = item?.name || g.name || sku || "Unknown";
      const img = item?.image
        ? (String(item.image).startsWith("/") ? String(item.image) : "/" + String(item.image))
        : "";

      const activeTab = normalizeTab(g.activeTab || "NM");
      const activeQty = Number(g.condQty[activeTab] || 0);

      const unitDollars = item ? getPriceFor(item, activeTab) : 0;
      const unitCents = Math.round(unitDollars * 100);
      const maxCap = item ? getMaxFor(item, activeTab) : 0;

      let inCartAll = 0;
      let subtotalCents = 0;

      for (const tab of TAB_ORDER) {
        const q = Number(g.condQty[tab] || 0);
        if (q > 0) {
          inCartAll += q;
          const u = item ? Math.round(getPriceFor(item, tab) * 100) : 0;
          subtotalCents += u * q;
        }
      }

      totalCents += subtotalCents;

      const tabsHtml = TAB_ORDER.map((tab) => {
        const q = Number(g.condQty[tab] || 0);
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
      li.dataset.activeTab = activeTab;

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
              <div>Unit: <strong>${money(unitCents / 100)}</strong></div>

              <div class="cart-subline">
                In cart (all conditions): <strong>${inCartAll}</strong> •
                Subtotal: <strong>${money(subtotalCents / 100)}</strong>
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

            <div class="line-price">${money((unitCents * activeQty) / 100)}</div>

            <button class="remove-cond-btn" type="button">Remove condition</button>
          </div>
        </div>
      `;

      // clamp buttons based on max
      const plus = li.querySelector(".qty-plus");
      const minus = li.querySelector(".qty-minus");

      if (minus) minus.disabled = activeQty <= 0;
      if (plus) plus.disabled = !item ? true : (maxCap > 0 ? activeQty >= maxCap : true);

      // image zoom
      const thumb = li.querySelector(".cart-thumb");
      if (thumb) thumb.addEventListener("click", () => openModal(thumb.getAttribute("src")));

      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  render();

  // ===== click handlers (delegation) =====
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".cart-item");
    if (!itemEl) return;

    const groupKey = itemEl.dataset.groupKey;
    const activeTab = normalizeTab(itemEl.dataset.activeTab || "NM");

    // tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      itemEl.dataset.activeTab = normalizeTab(tabBtn.dataset.tab || "NM");
      renderWithScroll(render);
      return;
    }

    // plus
    if (e.target.closest(".qty-plus")) {
      const { item } = resolveSellItem(groupKey, "");
      const maxCap = item ? getMaxFor(item, activeTab) : 0;

      const cur = getQty(groupKey, activeTab);
      const next = maxCap > 0 ? Math.min(cur + 1, maxCap) : cur; // if max is 0, don't increase

      setQty(groupKey, activeTab, next);
      renderWithScroll(render);
      return;
    }

    // minus
    if (e.target.closest(".qty-minus")) {
      const cur = getQty(groupKey, activeTab);
      const next = Math.max(0, cur - 1);

      setQty(groupKey, activeTab, next);
      renderWithScroll(render);
      return;
    }

    // remove condition
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

  // ===== submit sell order (redirect to recap.html) =====
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const email = String(emailInput?.value || "").trim();
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
      submitBtn.textContent = "Submitting...";

      try {
        // Build order from grouped cart (with selllist pricing)
        const groups = groupCart(cart);
        const order = [];

        for (const g of groups) {
          const { item } = resolveSellItem(g.key, g.name);
          if (!item) continue;

          for (const tab of TAB_ORDER) {
            const q = Number(g.condQty[tab] || 0);
            if (q <= 0) continue;

            const unit = getPriceFor(item, tab); // dollars
            order.push({
              name: item.name,
              condition: tab, // NM/LP/MP
              qty: q,
              unitPrice: unit
            });
          }
        }

        if (!order.length) {
          showMsg("Could not build your order (missing selllist pricing).", false);
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit Sell Order";
          return;
        }

        const total = order.reduce(
          (sum, l) => sum + (Number(l.qty || 0) * Number(l.unitPrice || 0)),
          0
        );

        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Sell Customer",
            email,
            total: total.toFixed(2),
            order
          })
        });

        let data = {};
        try { data = await res.json(); } catch {}

        if (!res.ok || !data.ok) {
          throw new Error(data.error || res.statusText || "Submit failed");
        }

        // ✅ Save recap payload for recap.html
        sessionStorage.setItem("sellOrderRecap", JSON.stringify({
          name: "Sell Customer",
          email,
          order,
          computedTotal: total.toFixed(2)
        }));

        // ✅ Clear cart (updates badge)
        saveCart([]);

        // ✅ Redirect
        window.location.href = "/recap.html";
      } catch (err) {
        console.error("Sell submit error:", err);
        showMsg("Error submitting sell order. Try again.", false);
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Sell Order";
      }
    });
  }
});

