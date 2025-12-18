document.addEventListener("DOMContentLoaded", function () {

  /* ===============================
     CONFIG
  =============================== */

  const CONDITIONS = {
    NM: 1.0,
    LP: 0.9,
    MP: 0.8
  };

  const buylist = [
  { name: "Jinx - Loose Cannon (Signature)", price: 540.00, image: "images/Jinx - Loose Cannon (Signature).jpg" },
  { name: "Deadbloom Predator - Origins", price: 82.50, image: "images/Deadbloom Predator - Origins.jpg" },
  { name: "Kai'Sa - Survivor (Alternate Art) - Origins", price: 72.00, image: "images/Kai'Sa - Survivor (Alternate Art) - Origins.jpg" },
  { name: "Time Warp - Origins", price: 52.50, image: "images/Time Warp - Origins.jpg" }
];


  /* ===============================
     ELEMENTS
  =============================== */

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

  /* ===============================
     HELPERS
  =============================== */

  function money(n) {
    return Number(n).toFixed(2);
  }

  function findLineIndex(name, condition) {
    return order.findIndex(
      l => l.name === name && l.condition === condition
    );
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
  <img class="card-img" src="${card.image}" alt="${card.name}">

  <div class="card-title">
    ${card.name} — $${money(card.price)} (NM base)
  </div>

  <select class="cond">
    <option value="NM">NM</option>
    <option value="LP">LP</option>
    <option value="MP">MP</option>
  </select>

  <input class="qty" type="number" min="1" max="999" value="1">

  <button class="add-btn" type="button">Add</button>
`;

row.dataset.cardName = card.name;

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
    const qty = parseInt(row.querySelector(".qty").value, 10);

    if (!CONDITIONS[condition]) {
      alert("Invalid condition.");
      return;
    }

    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      alert("Quantity must be between 1 and 999.");
      return;
    }

    const card = buylist.find(c => c.name === cardName);
    if (!card) return;

    const unitPrice = card.price * CONDITIONS[condition];

    const idx = findLineIndex(card.name, condition);
    if (idx >= 0) {
      order[idx].qty += qty;
    } else {
      order.push({
        name: card.name,
        condition: condition,
        qty: qty,
        unitPrice: unitPrice
      });
    }

    renderOrder();
  });

  /* ===============================
     RENDER ORDER (with + / − buttons)
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

    const idx = order.findIndex(
      l => l.name === name && l.condition === condition
    );
    if (idx === -1) return;

    // PLUS
    if (e.target.classList.contains("plus")) {
      order[idx].qty += 1;
      renderOrder();
      return;
    }

    // MINUS
    if (e.target.classList.contains("minus")) {
      order[idx].qty -= 1;
      if (order[idx].qty <= 0) {
        order.splice(idx, 1);
      }
      renderOrder();
      return;
    }

    // REMOVE
    if (e.target.classList.contains("remove-btn")) {
      order.splice(idx, 1);
      renderOrder();
    }
  });

  /* ===============================
     SEARCH INPUT
  =============================== */

  searchInput.addEventListener("input", function () {
    const q = searchInput.value.toLowerCase().trim();
    const filtered = buylist.filter(c =>
      c.name.toLowerCase().includes(q)
    );
    renderResults(filtered);
  });

  /* ===============================
     FORM SUBMIT
  =============================== */

  form.addEventListener("submit", async function (event) {
  event.preventDefault();

  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const cards = cardsTextarea.value;
  const total = totalEl.textContent;

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, cards, total })
    });

    const data = await res.json();

    if (!data.ok) {
      message.textContent = "Error: " + (data.error || "Could not send email.");
      message.style.color = "red";
      return;
    }

    message.textContent = "Submitted! We emailed you the sell order.";
    message.style.color = "green";

    form.reset();
    order = [];
    renderOrder();
    renderResults(buylist);
    searchInput.value = "";
  } catch (e) {
    message.textContent = "Network error. Could not submit.";
    message.style.color = "red";
  }
});

  /* ===============================
     INITIAL LOAD
  =============================== */

  renderResults(buylist);

});
