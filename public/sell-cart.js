
document.addEventListener("DOMContentLoaded", async () => {
  const CART_KEY = "sellCart";

  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const msgEl = document.getElementById("sellCartMessage");
  const clearBtn = document.getElementById("sellClearCartBtn");

  const emailInput = document.getElementById("sellEmail");
  const submitBtn = document.getElementById("sellSubmitBtn");

  if (!listEl || !totalEl) return;

  // The row that contains the email input + submit button
  const checkoutRow = emailInput ? emailInput.closest(".cart-checkout-row") : null;
  // The label above the row (Email for confirmation)
  const checkoutLabel = document.querySelector('label[for="sellEmail"]');
  // The checkout container
  const checkoutBox = document.querySelector(".cart-checkout");

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
    window.dispatchEvent(new Event("cart:changed"));
  }

  function moneyCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
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

  function condFromCart(item) {
    const c = String(item.condition || "").trim().toUpperCase();
    if (TAB_TO_COND[c]) return c;
    return "NM";
  }

  // ---------- Logged in UX ----------
  let loggedInEmail = "";

  async function applyLoggedInAsUX() {
    if (!emailInput) return;

    // Determine logged-in user (if any)
    try {
      const meRes = await fetch("/api/me", { cache: "no-store" });
      const me = await meRes.json().catch(() => ({}));
      loggedInEmail = me?.ok && me?.user?.email ? String(me.user.email).trim() : "";
    } catch {
      loggedInEmail = "";
    }

    // Not logged in → keep normal input
    if (!loggedInEmail) {
      emailInput.readOnly = false;
      emailInput.disabled = false;
      emailInput.style.display = "";
      if (checkoutLabel) checkoutLabel.style.display = "";
      return;
    }

    // Logged in → fill email and lock it
    emailInput.value = loggedInEmail;
    emailInput.readOnly = true;

    // Hide ONLY the label + input (keep the row so submit button remains)
    if (checkoutLabel) checkoutLabel.style.display = "none";
    emailInput.style.display = "none";

    // Insert a "Logged in as" box at the top of the checkout panel
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

    // Optional: make the submit button look aligned when input is hidden
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
    const data = await res.json();
    if (!data?.ok || !data.selllist) throw new Error("Bad selllist JSON");
    return data.selllist;
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

  function getQty(groupKey, tab) {
    const cart = loadCart();
    let sum = 0;
    const t = normalizeTab(tab);

    for (const it of cart) {
      if (getItemKey(it) !== groupKey) continue;
      const c = condFromCart(it);
      if (c === t) sum += Math.max(0, Number(it.qty || 0));
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
        const name = item?.name || "";
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
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

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

      const plus = li.querySelector(".qty-plus");
      const minus = li.querySelector(".qty-minus");

      if (minus) minus.disabled = activeQty <= 0;
      if (plus) plus.disabled = !item ? true : (maxCap > 0 ? activeQty >= maxCap : true);

      const thumb = li.querySelector(".cart-thumb");
      if (thumb) thumb.addEventListener("click", () => openModal(thumb.getAttribute("src")));

      listEl.appendChild(li);
    }

    totalEl.textContent = (totalCents / 100).toFixed(2);
  }

  // ---------- init ----------
  await applyLoggedInAsUX();
  render();

  // ===== click handlers =====
  document.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".cart-item");
    if (!itemEl) return;

    const groupKey = itemEl.dataset.groupKey;
    const activeTab = normalizeTab(itemEl.dataset.activeTab || "NM");

    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;
      itemEl.dataset.activeTab = normalizeTab(tabBtn.dataset.tab || "NM");
      renderWithScroll(render);
      return;
    }

    if (e.target.closest(".qty-plus")) {
      const { item } = resolveSellItem(groupKey, "");
      const maxCap = item ? getMaxFor(item, activeTab) : 0;

      const cur = getQty(groupKey, activeTab);
      const next = maxCap > 0 ? Math.min(cur + 1, maxCap) : cur;

      setQty(groupKey, activeTab, next);
      renderWithScroll(render);
      return;
    }

    if (e.target.closest(".qty-minus")) {
      const cur = getQty(groupKey, activeTab);
      const next = Math.max(0, cur - 1);

      setQty(groupKey, activeTab, next);
      renderWithScroll(render);
      return;
    }

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
              condition: tab,
              qty,
              unitPriceCents,
              lineTotalCents
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
            order
          })
        });

        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch {}

        if (!res.ok || !data?.ok) {
          throw new Error((data && data.error) || text || `HTTP ${res.status}`);
        }

        sessionStorage.setItem("sellOrderRecap", JSON.stringify({
          name: "Sell Customer",
          email,
          order,
          totalCents
        }));

        saveCart([]);
        window.location.href = "/recap.html";
      } catch (err) {
        console.error("Sell submit error:", err);
        showMsg(String(err.message || "Error submitting sell order. Try again."), false);
        submitBtn.disabled = false;
        submitBtn.textContent = prevText || "Submit Sell Order";
      }
    });
  }
});
