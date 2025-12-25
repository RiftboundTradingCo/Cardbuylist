document.addEventListener("DOMContentLoaded", function () {
  console.log("SELL script.js loaded ✅");

  /* ===============================
     ELEMENTS
  =============================== */
  const imageModal = document.getElementById("imageModal");
  const modalImage = document.getElementById("modalImage");
  const modalClose = document.getElementById("modalClose");

  const searchInput = document.getElementById("search");
  const results = document.getElementById("results");
  const orderList = document.getElementById("orderList");
  const totalEl = document.getElementById("total");

  const form = document.getElementById("sellForm");
  const message = document.getElementById("message");
  const cardsTextarea = document.getElementById("cards");

  if (!results) {
    console.warn("SELL script.js: #results not found");
    return;
  }

  /* ===============================
     STATE
  =============================== */
  // Each line: { name, condition, qty, unitPrice }
  let order = [];

  // Loaded from /api/selllist as array:
  // { sku, name, image, prices:{NM,LP,MP}, max:{NM,LP,MP} }
  let sellCards = [];

  function loadCart() {
    const raw = localStorage.getItem("sellCart");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  function saveCart(cart) {
    localStorage.setItem("sellCart", JSON.stringify(cart));
  }

  /* ===============================
     HELPERS
  =============================== */
  function money(n) {
    return Number(n || 0).toFixed(2);
  }

  function clampQty(n) {
    if (!Number.isInteger(n)) return 1;
    if (n < 1) return 1;
    if (n > 999) return 999;
    return n;
  }

  function findLineIndex(name, condition) {
    return order.findIndex(l => l.name === name && l.condition === condition);
  }

  function qtyInOrder(name, cond) {
    const idx = findLineIndex(name, cond);
    return idx >= 0 ? Number(order[idx].qty || 0) : 0;
  }

  function getPriceFor(card, cond) {
    const n = Number(card?.prices?.[cond]);
    return Number.isFinite(n) ? n : 0;
  }

  function getMaxFor(card, cond) {
    const n = Number(card?.max?.[cond]);
    // if max is missing, default to 0 (meaning you don't buy that condition)
    return Number.isFinite(n) ? n : 0;
  }

  /* ===============================
     LOAD SELLLIST
  =============================== */
  async function loadSelllist() {
    try {
      const res = await fetch("/api/selllist", { cache: "no-store" });
      if (!res.ok) throw new Error("selllist fetch failed");
      const data = await res.json();
      if (!data?.ok || !data.selllist) throw new Error("selllist bad payload");

      return Object.entries(data.selllist).map(([sku, v]) => ({
        sku,
        name: String(v.name || sku),
        image: String(v.image || ""),
        prices: v.prices || {},
        max: v.max || {}
      }));
    } catch (e) {
      console.error("Could not load /api/selllist:", e);
      results.innerHTML = `<p style="color:#c00;">Could not load sell list.</p>`;
      return [];
    }
  }

  /* ===============================
     RENDER SEARCH RESULTS
  =============================== */
  function renderResults(cards) {
    results.innerHTML = "";

    cards.forEach(card => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.dataset.cardName = card.name;

      // Big left number like screenshot: NM max capacity
      const nmMax = getMaxFor(card, "NM");

      // Used to disable plus/minus per condition
      const nmIn = qtyInOrder(card.name, "NM");
      const lpIn = qtyInOrder(card.name, "LP");
      const mpIn = qtyInOrder(card.name, "MP");

      const nmPrice = getPriceFor(card, "NM");
      const lpPrice = getPriceFor(card, "LP");
      const mpPrice = getPriceFor(card, "MP");

      const nmDisabled = nmMax <= 0 || nmPrice <= 0;
      const lpDisabled = getMaxFor(card, "LP") <= 0 || lpPrice <= 0;
      const mpDisabled = getMaxFor(card, "MP") <= 0 || mpPrice <= 0;

      const imgSrc = card.image ? (card.image.startsWith("/") ? card.image : "/" + card.image) : "";

      row.innerHTML = `
        ${imgSrc ? `
          <img
            class="card-img clickable-img"
            src="${encodeURI(imgSrc)}"
            alt="${card.name}"
            data-full="${encodeURI(imgSrc)}"
          >
        ` : ""}

        <div class="card-title">
          ${card.name}
        </div>

        <!-- Capacity / Condition control block -->
        <div class="sell-controls">
          <div class="sell-cap-row">
            <div class="sell-cap-left">${nmMax}</div>

            <div class="sell-cap-right">
              <div class="sell-cond-grid" data-sku="${card.sku}">
                <!-- NM row -->
                <div class="sell-cond-tag">NM</div>
                <div class="sell-price">$${money(nmPrice)}</div>
                <button class="sell-btn sell-minus" type="button" data-cond="NM" ${nmIn <= 0 ? "disabled" : ""}>−</button>
                <button class="sell-btn sell-plus" type="button" data-cond="NM" ${nmDisabled || nmIn >= nmMax ? "disabled" : ""}>+</button>

                <!-- LP row -->
                <div class="sell-cond-tag">LP</div>
                <div class="sell-price">$${money(lpPrice)}</div>
                <button class="sell-btn sell-minus" type="button" data-cond="LP" ${lpIn <= 0 ? "disabled" : ""}>−</button>
                <button class="sell-btn sell-plus" type="button" data-cond="LP" ${lpDisabled || lpIn >= getMaxFor(card,"LP") ? "disabled" : ""}>+</button>

                <!-- MP row -->
                <div class="sell-cond-tag">MP</div>
                <div class="sell-price">$${money(mpPrice)}</div>
                <button class="sell-btn sell-minus" type="button" data-cond="MP" ${mpIn <= 0 ? "disabled" : ""}>−</button>
                <button class="sell-btn sell-plus" type="button" data-cond="MP" ${mpDisabled || mpIn >= getMaxFor(card,"MP") ? "disabled" : ""}>+</button>
              </div>

              <div class="sell-cap-note">max capacity</div>
            </div>
          </div>
        </div>
      `;

      results.appendChild(row);
    });

    if (!cards.length) {
      results.innerHTML = `<p>No cards found.</p>`;
    }
  }

  /* ===============================
     RENDER ORDER (right-side / below list)
  =============================== */
  function renderOrder() {
    orderList.innerHTML = "";
    let total = 0;

    order.forEach(line => {
      const lineTotal = Number(line.unitPrice || 0) * Number(line.qty || 0);
      total += lineTotal;

      const li = document.createElement("li");
      li.dataset.name = line.name;
      li.dataset.condition = line.condition;

      li.innerHTML = `
        <div class="order-row">
          <div>
            ${line.name} (${line.condition}) —
            $${money(line.unitPrice)} each = $${money(lineTotal)}
          </div>

          <div class="qty-controls">
            <button class="qty-btn minus" type="button">−</button>
            <span class="qty-value">${line.qty}</span>
            <button class="qty-btn plus" type="button">+</button>
          </div>

          <button class="remove-btn" type="button">Remove</button>
        </div>
      `;

      orderList.appendChild(li);
    });

    totalEl.textContent = money(total);

    cardsTextarea.value = order
      .map(l => `${l.qty}x ${l.name} (${l.condition})`)
      .join(", ");
  }

  /* ===============================
     SELL BUTTONS (+ / − under each card)
  =============================== */
  results.addEventListener("click", function (e) {
    const plus = e.target.closest(".sell-plus");
    const minus = e.target.closest(".sell-minus");
    if (!plus && !minus) return;

    const row = e.target.closest(".result-row");
    if (!row) return;

    const cardName = row.dataset.cardName;
    const card = sellCards.find(c => c.name === cardName);
    if (!card) return;

    const cond = (plus || minus).dataset.cond;

    // PLUS
    if (plus) {
      const price = getPriceFor(card, cond);
      const max = getMaxFor(card, cond);
      if (price <= 0 || max <= 0) return;

      const current = qtyInOrder(card.name, cond);
      if (current >= max) return;

      const idx = findLineIndex(card.name, cond);
      if (idx >= 0) {
        order[idx].qty = clampQty(order[idx].qty + 1);
      } else {
        order.push({ name: card.name, condition: cond, qty: 1, unitPrice: price });
      }

      saveCart(order);
      renderOrder();
      renderResults(filterBySearch(sellCards));
      return;
    }

    // MINUS
    if (minus) {
      const idx = findLineIndex(card.name, cond);
      if (idx === -1) return;

      order[idx].qty = order[idx].qty - 1;
      if (order[idx].qty <= 0) order.splice(idx, 1);

      saveCart(order);
      renderOrder();
      renderResults(filterBySearch(sellCards));
      return;
    }
  });

  /* ===============================
     ORDER CONTROLS: + / − / Remove (in cart list)
  =============================== */
  orderList.addEventListener("click", function (e) {
    const li = e.target.closest("li");
    if (!li) return;

    const name = li.dataset.name;
    const condition = li.dataset.condition;
    const idx = findLineIndex(name, condition);
    if (idx === -1) return;

    if (e.target.classList.contains("plus")) {
      order[idx].qty = clampQty(order[idx].qty + 1);
      saveCart(order);
      renderOrder();
      renderResults(filterBySearch(sellCards));
      return;
    }

    if (e.target.classList.contains("minus")) {
      order[idx].qty = order[idx].qty - 1;
      if (order[idx].qty <= 0) order.splice(idx, 1);
      saveCart(order);
      renderOrder();
      renderResults(filterBySearch(sellCards));
      return;
    }

    if (e.target.classList.contains("remove-btn")) {
      order.splice(idx, 1);
      saveCart(order);
      renderOrder();
      renderResults(filterBySearch(sellCards));
    }
  });

  /* ===============================
     SEARCH INPUT
  =============================== */
  function filterBySearch(cards) {
    const q = String(searchInput?.value || "").toLowerCase().trim();
    if (!q) return cards;
    return cards.filter(c => String(c.name || "").toLowerCase().includes(q));
  }

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      renderResults(filterBySearch(sellCards));
    });
  }

  /* ===============================
     FORM SUBMIT (send structured order)
  =============================== */
  if (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!order.length) {
        message.textContent = "Please add at least one card to your sell order.";
        message.style.color = "red";
        return;
      }

      const name = document.getElementById("name")?.value || "";
      const email = document.getElementById("email")?.value || "";

      let computedTotal = 0;
      order.forEach(l => {
        computedTotal += (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
      });

      try {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            total: computedTotal.toFixed(2),
            order
          })
        });

        const data = await res.json();

        if (!data.ok) {
          message.textContent = "Error: " + (data.error || "Could not send email.");
          message.style.color = "red";
          return;
        }

        sessionStorage.setItem("sellOrderRecap", JSON.stringify({
          name,
          email,
          order,
          computedTotal: computedTotal.toFixed(2)
        }));

        window.location.href = "/recap.html";

      } catch (e) {
        message.textContent = "Network error. Could not submit.";
        message.style.color = "red";
      }
    });
  }

  /* ===============================
     IMAGE MODAL (zoom)
  =============================== */
  results.addEventListener("click", function (e) {
    const img = e.target.closest(".clickable-img");
    if (!img) return;

    modalImage.src = img.dataset.full;
    imageModal.classList.remove("hidden");
  });

  if (modalClose) {
    modalClose.addEventListener("click", function () {
      imageModal.classList.add("hidden");
      modalImage.src = "";
    });
  }

  if (imageModal) {
    imageModal.addEventListener("click", function (e) {
      if (e.target === imageModal) {
        imageModal.classList.add("hidden");
        modalImage.src = "";
      }
    });
  }

  /* ===============================
     INITIAL LOAD
  =============================== */
  (async () => {
    order = loadCart();
    renderOrder();

    sellCards = await loadSelllist();
    renderResults(sellCards);
  })();
});








