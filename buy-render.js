document.addEventListener("DOMContentLoaded", async function () {
  const grid = document.getElementById("storeGrid");
  if (!grid) return;

  // Same multipliers as server.js
  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  function normalizeCondition(c) {
    const s = String(c || "Near Mint").trim();
    return CONDITION_MULT[s] ? s : "Near Mint";
  }

  function centsForCondition(baseCents, condition) {
    const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }

  grid.innerHTML = "<p>Loading catalog...</p>";

  try {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    const data = await res.json();

    if (!data.ok) {
      grid.innerHTML = "<p>Could not load catalog.</p>";
      return;
    }

    const catalog = data.catalog || {};
    const entries = Object.entries(catalog);

    if (entries.length === 0) {
      grid.innerHTML = "<p>No products found.</p>";
      return;
    }

    // Optional: sort alphabetically
    entries.sort((a, b) => {
      const an = String(a[1]?.name || a[0]).toLowerCase();
      const bn = String(b[1]?.name || b[0]).toLowerCase();
      return an.localeCompare(bn);
    });

    grid.innerHTML = "";

    for (const [sku, p] of entries) {
      const stock = Number(p.stock ?? 0);
      if (stock <= 0) continue; // hide sold-out items

      const name = String(p.name || sku);
      const baseCents = Number(p.price_cents || 0);
      const imagePath = String(p.image || "");

      const imageSrc = imagePath
        ? encodeURI(imagePath.startsWith("/") ? imagePath : "/" + imagePath)
        : "";

      const defaultCondition = "Near Mint";
      const defaultCents = centsForCondition(baseCents, defaultCondition);

      const card = document.createElement("div");
      card.className = "store-card";

      // used by buy.js and search
      card.dataset.sku = sku;
      card.dataset.name = name.toLowerCase();
      card.dataset.stock = String(stock);

      // used for live price changes
      card.dataset.basecents = String(baseCents);
      card.dataset.pricecents = String(defaultCents);

      card.innerHTML = `
        ${imageSrc ? `<img class="zoomable" src="${imageSrc}" alt="${name}">` : ""}
        <h3>${name}</h3>

        <p class="price">$${(defaultCents / 100).toFixed(2)}</p>
        <p class="in-stock">In stock: ${stock}</p>

        <select class="condition-select">
          <option value="Near Mint">Near Mint</option>
          <option value="Lightly Played">Lightly Played</option>
          <option value="Moderately Played">Moderately Played</option>
          <option value="Heavily Played">Heavily Played</option>
        </select>

        <button class="buy-add-btn" type="button">Add to Cart</button>
      `;

      grid.appendChild(card);
    }

    if (grid.children.length === 0) {
      grid.innerHTML = "<p>All items are out of stock.</p>";
    }
  } catch (err) {
    console.error("buy-render.js error:", err);
    grid.innerHTML = "<p>Error loading catalog.</p>";
  }

  // -------------------------
  // Condition dropdown → update price display
  // -------------------------
  document.addEventListener("change", function (e) {
    const sel = e.target.closest(".condition-select");
    if (!sel) return;

    const card = sel.closest(".store-card");
    if (!card) return;

    const baseCents = Number(card.dataset.basecents || 0);
    const condition = sel.value;
    const newCents = centsForCondition(baseCents, condition);

    card.dataset.pricecents = String(newCents);

    const priceEl = card.querySelector(".price");
    if (priceEl) {
      priceEl.textContent = `$${(newCents / 100).toFixed(2)}`;
    }
  });

  // -------------------------
  // Image modal (click to zoom)
  // -------------------------
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalClose = document.getElementById("imageModalClose");

  // If modal markup isn't on this page, skip
  if (!modal || !modalImg || !modalClose) return;

  document.addEventListener("click", function (e) {
    const img = e.target.closest(".store-card img.zoomable");
    if (!img) return;

    modalImg.src = img.src;
    modal.classList.remove("hidden");
  });

  function closeModal() {
    modal.classList.add("hidden");
    modalImg.src = "";
  }

  modalClose.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
});




















