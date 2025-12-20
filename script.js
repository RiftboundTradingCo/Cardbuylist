document.addEventListener("DOMContentLoaded", function () {

  /* ===============================
     CONFIG
  =============================== */

  const CONDITIONS = {
    NM: 1.0,
    LP: 0.9,
    MP: 0.8
  };

  // Update these image paths to match your /images folder
  const buylist = [
  { name: "Jinx - Loose Cannon (Signature)", price: 540.00, image: "images/Jinx - Loose Cannon (Signature).jpg" },
  { name: "Deadbloom Predator - Origins", price: 82.50, image: "images/Deadbloom Predator - Origins.jpg" },
  { name: "Kai'Sa - Survivor (Alternate Art) - Origins", price: 72.00, image: "images/Kai'Sa - Survivor (Alternate Art) - Origins.jpg" },
  { name: "Time Warp - Origins", price: 52.50, image: "images/Time Warp - Origins.jpg" }
  ];

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

  // Each line: { name, condition, qty, unitPrice }
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
order = loadCart();
renderOrder();
  function money(n) {
    return Number(n).toFixed(2);
  }

  function findLineIndex(name, condition) {
    return order.findIndex(l => l.name === name && l.condition === condition);
  }

  function clampQty(n) {
    if (!Number.isInteger(n)) return 1;
    if (n < 1) return 1;
    if (n > 999) return 999;
    return n;
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

      row.innerHTML = `
        <img
  class="card-img clickable-img"
  src="${card.image}"
  alt="${card.name}"
  data-full="${card.image}"
>

        <div class="card-title">
          ${card.name} — $${money(card.price)} (NM base)
        </div>

        <select class="cond">
          <option value="NM">NM</option>
          <option value="LP">LP</option>
          <option value="MP">MP</option>
        </select>

        <input
          class="qty"
          type="number"
          min="1"
          max="999"
          value="1"
        >

        <button class="add-btn" type="button">
          Add
        </button>
      `;

      results.appendChild(row);
    });
  }

  /* ===============================
     ADD TO ORDER (from results)
  =============================== */

  results.addEventListener("click", function (e) {
    if (!e.target.classList.contains("add-btn")) return;

    const row = e.target.closest(".result-row");
    const cardName = row.dataset.cardName;

    const condition = row.querySelector(".cond").value;
    const qty = clampQty(parseInt(row.querySelector(".qty").value, 10));

    if (!CONDITIONS[condition]) {
      alert("Invalid condition.");
      return;
    }

    const card = buylist.find(c => c.name === cardName);
    if (!card) return;

    const unitPrice = card.price * CONDITIONS[condition];

    const idx = findLineIndex(card.name, condition);
    if (idx >= 0) {
      order[idx].qty = clampQty(order[idx].qty + qty);
    } else {
      order.push({
        name: card.name,
        condition: condition,
        qty: qty,
        unitPrice: unitPrice
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

    // Keep the textarea as a human-readable summary (still useful)
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

    const name = li.dataset.name;
    const condition = li.dataset.condition;

    const idx = findLineIndex(name, condition);
    if (idx === -1) return;

    if (e.target.classList.contains("plus")) {
      order[idx].qty = clampQty(order[idx].qty + 1);
      saveCart(order);
      renderOrder();
      return;
    }

    if (e.target.classList.contains("minus")) {
      order[idx].qty = order[idx].qty - 1;
      if (order[idx].qty <= 0) {
        order.splice(idx, 1);
      }
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
    const filtered = buylist.filter(c => c.name.toLowerCase().includes(q));
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

  // Compute total on client to match email breakdown
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

    // Store recap data for the next page
    sessionStorage.setItem("sellOrderRecap", JSON.stringify({
      name,
      email,
      order,
      computedTotal: computedTotal.toFixed(2)
    }));

    // Go to recap page
    window.location.href = "/recap.html";

  } catch (e) {
    message.textContent = "Network error. Could not submit.";
    message.style.color = "red";
  }
});

// Image click → open modal
results.addEventListener("click", function (e) {
  if (!e.target.classList.contains("clickable-img")) return;

  modalImage.src = e.target.dataset.full;
  imageModal.classList.remove("hidden");
});

// Close modal
modalClose.addEventListener("click", function () {
  imageModal.classList.add("hidden");
  modalImage.src = "";
});

// Click outside image closes modal
imageModal.addEventListener("click", function (e) {
  if (e.target === imageModal) {
    imageModal.classList.add("hidden");
    modalImage.src = "";
  }
});

  
  /* ===============================
     INITIAL LOAD
  =============================== */

  renderResults(buylist);

});






