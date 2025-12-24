document.addEventListener("DOMContentLoaded", function () {
  /* ===============================
     CONFIG
  =============================== */

  // Sell list is priced as NM base. Apply condition multipliers.
  const CONDITIONS = {
    NM: 1.0,
    LP: 0.9,
    MP: 0.8
    // (If you want HP later, add: HP: 0.65 and add an <option>)
  };

  const COND_LABEL = { NM: "NM", LP: "LP", MP: "MP" };

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

  /* ===============================
     STATE
  =============================== */

  // Selllist items: [{ sku, name, price, image }]
  let sellItems = [];

  // Cart lines: { sku, name, condition, qty, unitPrice }
  let order = [];

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
    return Number(n).toFixed(2);
  }

  function clampQty(n) {
    if (!Number.isInteger(n)) return 1;
    if (n < 1) return 1;
    if (n > 999) return 999;
    return n;
  }

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    const withSlash = s.startsWith("/") ? s : `/${s}`;
    return encodeURI(withSlash);
  }

  function findLineIndex(sku, condition) {
    return order.findIndex(l => l.sku === sku && l.condition === condition);
  }

  function unitPriceFor(item, condition) {
    const mult = CONDITIONS[condition] ?? 1.0;
    return Number(item.price || 0) * mult;
  }

  /* ===============================
     LOAD SELL LIST (/api/selllist)
  =============================== */

  async function loadSellList() {
    results.innerHTML = "<p>Loading sell list…</p>";

    try {
      const res = await fetch("/api/selllist", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data?.ok || !data.selllist) throw new Error("Bad selllist response");

      const items = [];
      for (const [sku, p] of Object.entries(data.selllist)) {
        const name = String(p.name || sku);
        const price = Number(p.price_cents || 0) / 100; // NM base price (what you pay)
        const image = normalizeImagePath(p.image);

        items.push({ sku, name, price, image });
      }

      items.sort((a, b) => a.name.localeCompare(b.name));
      sellItems = items;

      renderResults(sellItems);
    } catch (err) {
      console.error("Sell list load error:", err);
      results.innerHTML = "<p>Could not load sell list.</p>";
    }
  }

  /* ===============================
     RENDER SEARCH RESULTS
  =============================== */

  function renderResults(cards) {
    results.innerHTML = "";

    if (!cards.length) {
      results.innerHTML = "<p>No matches.</p>";
      return;
    }

    cards.forEach(item => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.dataset.sku = item.sku;

      row.innerHTML = `
        <img
          class="card-img clickable-img"
          src="${item.image}"
          alt="${item.name}"
          data-full="${item.image}"
        >

        <div class="card-title">
          ${item.name} — $${money(item.price)} (NM base)
        </div>

        <select class="cond">
          <option value="NM">NM</option>
          <option value="LP">LP</option>
          <option value="MP">MP</option>
        </select>

        <input class="qty" type="number" min="1" max="999" value="1">

        <button class="add-btn" type="button">Add</button>
      `;

      results.appendChild(row);
    });
  }

  /* ===============================
     RESULTS CLICK: Add + Image Zoom
  =============================== */

  results.addEventListener("click", function (e) {
    // Image click → open modal
    if (e.target.classList.contains("clickable-img")) {
      modalImage.src = e.target.dataset.full;
      imageModal.classList.remove("hidden");
      return;
    }

    // Add button
    if (!e.target.classList.contains("add-btn")) return;

    const row = e.target.closest(".result-row");
    if (!row) return;

    const sku = String(row.dataset.sku || "").trim();
    const condition = row.querySelector(".cond")?.value || "NM";
    const qty = clampQty(parseInt(row.querySelector(".qty")?.value || "1", 10));

    if (!CONDITIONS[condition]) {
      alert("Invalid condition.");
      return;
    }

    const item = sellItems.find(x => x.sku === sku);
    if (!item) return;

    const unitPrice = unitPriceFor(item, condition);

    const idx = findLineIndex(sku, condition);
    if (idx >= 0) {
      order[idx].qty = clampQty(order[idx].qty + qty);
    } else {
      order.push({
        sku,
        name: item.name,
        condition,
        qty,
        unitPrice
      });
    }

    saveCart(order);
    renderOrder();
  });

  /* ===============================
     RENDER ORDER (with + / − and remove)
  =============================== */

  function renderOrder() {
    orderList.innerHTML = "";
    let total = 0;

    order.forEach(line => {
      const lineTotal = line.unitPrice * line.qty;
      total += lineTotal;

      const li = document.createElement("li");
      li.dataset.sku = line.sku;
      li.dataset.condition = line.condition;

      li.innerHTML = `
        <div class="order-row">
          <div>
            ${line.name} (${COND_LABEL[line.condition] || line.condition}) —
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

    // keep textarea summary for email/debug
    cardsTextarea.value = order
      .map(l => `${l.qty}x ${l.name} (${l.condition})`)
      .join(", ");
  }

  /* ===============================
     ORDER CONTROLS: + / − / Remove
  =============================== */

  orderList.addEventListener("click", function (e) {
    const li = e.target.closest("li");
    if (!li) return;

    const sku = li.dataset.sku;
    const condition = li.dataset.condition;

    const idx = findLineIndex(sku, condition);
    if (idx === -1) return;

    if (e.target.classList.contains("plus")) {
      order[idx].qty = clampQty(order[idx].qty + 1);
      saveCart(order);
      renderOrder();
      return;
    }

    if (e.target.classList.contains("minus")) {
      order[idx].qty = order[idx].qty - 1;
      if (order[idx].qty <= 0) order.splice(idx, 1);
      saveCart(order);
      renderOrder();
      return;
    }

    if (e.target.classList.contains("remove-btn")) {
      order.splice(idx, 1);
      saveCart(order);
      renderOrder();
    }
  });

  /* ===============================
     SEARCH INPUT
  =============================== */

  searchInput.addEventListener("input", function () {
    const q = searchInput.value.toLowerCase().trim();
    const filtered = sellItems.filter(c => c.name.toLowerCase().includes(q));
    renderResults(filtered);
  });

  /* ===============================
     FORM SUBMIT (send structured order)
  =============================== */

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (!order.length) {
      message.textContent = "Please add at least one card to your sell order.";
      message.style.color = "red";
      return;
    }

    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;

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

  /* ===============================
     MODAL CLOSE
  =============================== */

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

  order = loadCart();
  renderOrder();
  loadSellList(); // ✅ separate sell pricing list
});









