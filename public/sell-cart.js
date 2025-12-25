(() => {
  console.log("sell-cart.js loaded ✅");

  const TAB_ORDER = ["NM", "LP", "MP"];
  const COND_LABEL = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played" };

  const listEl = document.getElementById("sellCartList");
  const totalEl = document.getElementById("sellCartTotal");
  const clearBtn = document.getElementById("sellClearCartBtn");
  const msgEl = document.getElementById("sellCartMessage");

  if (!listEl) return;

  function money(n) { return Number(n || 0).toFixed(2); }

  function loadCart() {
    try { return JSON.parse(localStorage.getItem("sellCart")) || []; }
    catch { return []; }
  }

  function saveCart(cart) {
    localStorage.setItem("sellCart", JSON.stringify(cart));
    if (window.updateSellCartBadge) window.updateSellCartBadge();
  }

  // cart item: { sku, name, condition:"NM|LP|MP", qty, unitPrice }
  function qtyFor(cart, sku, cond) {
    return cart
      .filter(i => i.sku === sku && i.condition === cond)
      .reduce((s, i) => s + (Number(i.qty) || 0), 0);
  }

  function groupBySku(cart) {
    const map = new Map();
    for (const line of cart) {
      const sku = String(line.sku || "").trim();
      if (!sku) continue;
      if (!map.has(sku)) map.set(sku, []);
      map.get(sku).push(line);
    }
    return map;
  }

  // Selllist lookup (for max caps + image + prices)
  let selllist = {};
  async function loadSelllist() {
    const res = await fetch("/api/selllist", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load /api/selllist");
    const data = await res.json();
    if (!data?.ok || !data.selllist) throw new Error("Bad selllist response");
    selllist = data.selllist;
  }

  function maxFor(sku, cond) {
    const p = selllist?.[sku];
    return Number(p?.max?.[cond] ?? 0);
  }

  function unitPriceFor(sku, cond) {
    const p = selllist?.[sku];
    // selllist prices are stored as dollars (based on your earlier setup)
    return Number(p?.prices?.[cond] ?? 0);
  }

  function imageFor(sku) {
    const p = selllist?.[sku];
    const img = String(p?.image || "");
    if (!img) return "";
    return encodeURI(img.startsWith("/") ? img : "/" + img);
  }

  function nameFor(sku, fallback) {
    const p = selllist?.[sku];
    return String(p?.name || fallback || sku);
  }

  function clampLineQty(cart, sku, cond, newQty) {
    const max = maxFor(sku, cond);
    const currentOther = 0; // sell caps are per-condition only
    const allowed = Math.max(0, max - currentOther);
    return Math.max(0, Math.min(Number(newQty) || 0, allowed));
  }

  function calcTotals(cart) {
    let total = 0;
    for (const i of cart) {
      total += (Number(i.qty) || 0) * (Number(i.unitPrice) || 0);
    }
    return total;
  }

  // ---------- RENDER ----------
  function render() {
    const cart = loadCart();
    listEl.innerHTML = "";

    if (!cart.length) {
      listEl.innerHTML = `<div class="cart-empty">Your sell cart is empty.</div>`;
      totalEl.textContent = "0.00";
      return;
    }

    const grouped = groupBySku(cart);

    grouped.forEach((lines, sku) => {
      // Normalize: ensure exactly one line per condition if present
      const byCond = { NM: null, LP: null, MP: null };
      for (const l of lines) {
        if (byCond[l.condition]) {
          // merge duplicates safely
          byCond[l.condition].qty = (Number(byCond[l.condition].qty) || 0) + (Number(l.qty) || 0);
        } else {
          byCond[l.condition] = { ...l };
        }
      }

      // default active tab = first condition that exists in cart
      const activeTab =
        (byCond.NM?.qty ? "NM" : null) ||
        (byCond.LP?.qty ? "LP" : null) ||
        (byCond.MP?.qty ? "MP" : "NM");

      const card = document.createElement("div");
      card.className = "cart-card";
      card.dataset.sku = sku;
      card.dataset.activeTab = activeTab;

      const img = imageFor(sku);
      const title = nameFor(sku, lines[0]?.name);

      const totalInCartAll = TAB_ORDER.reduce((s, c) => s + (Number(byCond[c]?.qty) || 0), 0);
      const subtotalAll = TAB_ORDER.reduce((s, c) => s + (Number(byCond[c]?.qty) || 0) * (Number(byCond[c]?.unitPrice) || 0), 0);

      const activeLine = byCond[activeTab] || { qty: 0, unitPrice: unitPriceFor(sku, activeTab) };
      const unitPrice = Number(activeLine.unitPrice || unitPriceFor(sku, activeTab) || 0);
      const activeQty = Number(activeLine.qty || 0);

      // build tabs (grey out if qty=0 in cart)
      const tabsHtml = TAB_ORDER.map(t => {
        const q = Number(byCond[t]?.qty || 0);
        const disabled = q <= 0;
        const isActive = t === activeTab;
        return `
          <button
            class="cond-tab${isActive ? " active" : ""}${disabled ? " disabled" : ""}"
            type="button"
            data-tab="${t}"
            aria-disabled="${disabled ? "true" : "false"}"
          >${t}</button>
        `;
      }).join("");

      card.innerHTML = `
        <div class="cart-card-inner">
          <div class="cart-left">
            ${img ? `<img class="cart-thumb" src="${img}" alt="${title}">` : ""}
          </div>

          <div class="cart-mid">
            <div class="cart-title">${title}</div>

            <div class="cond-tabs cart-tabs" role="tablist" aria-label="Condition">
              ${tabsHtml}
            </div>

            <div class="cart-meta">
              <div class="cart-cond">Condition: <strong class="cond-label">${COND_LABEL[activeTab]}</strong></div>
              <div class="cart-unit">Unit: <strong class="unit-price">$${money(unitPrice)}</strong></div>
              <div class="cart-cap">
                Max capacity: <strong class="max-num">${maxFor(sku, activeTab)}</strong>
              </div>
            </div>
          </div>

          <div class="cart-right">
            <div class="qty-stepper cart-stepper">
              <button class="qty-minus" type="button">−</button>
              <span class="qty-num">${activeQty}</span>
              <button class="qty-plus" type="button">+</button>
            </div>

            <div class="cart-line-total">
              <strong>$<span class="line-total">${money(activeQty * unitPrice)}</span></strong>
            </div>

            <div class="cart-summary-under">
              In cart (all conditions): <strong class="allqty">${totalInCartAll}</strong>
              • Subtotal: <strong class="allsub">$${money(subtotalAll)}</strong>
            </div>

            <button class="remove-cond-btn" type="button">Remove condition</button>
          </div>
        </div>
      `;

      listEl.appendChild(card);
    });

    totalEl.textContent = money(calcTotals(cart));
  }

  function updateCardUI(card, sku, cond) {
    // update active condition UI without re-rendering whole page
    const cart = loadCart();

    const unitPrice = unitPriceFor(sku, cond);
    const q = qtyFor(cart, sku, cond);

    card.dataset.activeTab = cond;

    // tabs
    card.querySelectorAll(".cond-tab").forEach(b => {
      const t = (b.dataset.tab || "").toUpperCase();
      b.classList.toggle("active", t === cond);

      // grey out if qty=0 in cart
      const tq = qtyFor(cart, sku, t);
      const disabled = tq <= 0;
      b.classList.toggle("disabled", disabled);
      b.setAttribute("aria-disabled", disabled ? "true" : "false");
    });

    // labels
    const condLabel = card.querySelector(".cond-label");
    if (condLabel) condLabel.textContent = COND_LABEL[cond] || cond;

    const unitEl = card.querySelector(".unit-price");
    if (unitEl) unitEl.textContent = `$${money(unitPrice)}`;

    const qtyEl = card.querySelector(".qty-num");
    if (qtyEl) qtyEl.textContent = String(q);

    const lineTotal = card.querySelector(".line-total");
    if (lineTotal) lineTotal.textContent = money(q * unitPrice);

    const maxEl = card.querySelector(".max-num");
    if (maxEl) maxEl.textContent = String(maxFor(sku, cond));

    // all conditions summary
    const allQty = TAB_ORDER.reduce((s, c) => s + qtyFor(cart, sku, c), 0);
    const allSub = TAB_ORDER.reduce((s, c) => s + qtyFor(cart, sku, c) * unitPriceFor(sku, c), 0);

    const allQtyEl = card.querySelector(".allqty");
    const allSubEl = card.querySelector(".allsub");
    if (allQtyEl) allQtyEl.textContent = String(allQty);
    if (allSubEl) allSubEl.textContent = `$${money(allSub)}`;

    totalEl.textContent = money(calcTotals(cart));
  }

  // ---------- EVENTS ----------
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".cart-card");
    if (!card) return;

    const sku = String(card.dataset.sku || "").trim();
    if (!sku) return;

    // tabs
    const tabBtn = e.target.closest(".cond-tab");
    if (tabBtn) {
      if (tabBtn.getAttribute("aria-disabled") === "true") return;
      if (tabBtn.classList.contains("disabled")) return;

      const t = String(tabBtn.dataset.tab || "NM").toUpperCase();
      updateCardUI(card, sku, t);
      return;
    }

    const active = String(card.dataset.activeTab || "NM").toUpperCase();

    // qty +
    if (e.target.closest(".qty-plus")) {
      const cart = loadCart();
      const current = qtyFor(cart, sku, active);
      const next = clampLineQty(cart, sku, active, current + 1);

      // upsert
      const idx = cart.findIndex(i => i.sku === sku && i.condition === active);
      const unitPrice = unitPriceFor(sku, active);
      const nm = nameFor(sku, "");

      if (idx >= 0) cart[idx].qty = next;
      else cart.push({ sku, name: nm, condition: active, qty: next, unitPrice });

      // also keep unitPrice fresh
      if (idx >= 0) cart[idx].unitPrice = unitPrice;

      saveCart(cart);
      updateCardUI(card, sku, active);
      return;
    }

    // qty -
    if (e.target.closest(".qty-minus")) {
      const cart = loadCart();
      const current = qtyFor(cart, sku, active);
      const next = Math.max(0, current - 1);

      const idx = cart.findIndex(i => i.sku === sku && i.condition === active);
      if (idx >= 0) {
        if (next <= 0) cart.splice(idx, 1);
        else cart[idx].qty = next;
      }

      saveCart(cart);

      // if active condition became 0, switch to another that still exists (but do NOT force NM)
      const remainingTabs = TAB_ORDER.filter(t => qtyFor(cart, sku, t) > 0);
      const newActive = remainingTabs.includes(active) ? active : (remainingTabs[0] || "NM");

      updateCardUI(card, sku, newActive);
      return;
    }

    // remove condition (active)
    if (e.target.closest(".remove-cond-btn")) {
      const cart = loadCart();
      const idx = cart.findIndex(i => i.sku === sku && i.condition === active);
      if (idx >= 0) cart.splice(idx, 1);
      saveCart(cart);

      // if SKU has no conditions left, re-render whole list
      const stillHasAny = TAB_ORDER.some(t => qtyFor(cart, sku, t) > 0);
      if (!stillHasAny) {
        render();
      } else {
        const remainingTabs = TAB_ORDER.filter(t => qtyFor(cart, sku, t) > 0);
        updateCardUI(card, sku, remainingTabs[0] || "NM");
      }
      return;
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      localStorage.removeItem("sellCart");
      if (window.updateSellCartBadge) window.updateSellCartBadge();
      if (msgEl) msgEl.textContent = "Sell cart cleared.";
      render();
    });
  }

  // ---------- INIT ----------
  (async () => {
    try {
      await loadSelllist();
      render();
    } catch (e) {
      console.error(e);
      listEl.innerHTML = `<div class="cart-empty" style="color:#b00;">Could not load sell cart.</div>`;
    }
  })();
})();
