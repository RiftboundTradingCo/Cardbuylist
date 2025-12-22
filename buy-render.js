document.addEventListener("DOMContentLoaded", async function () {
  const grid = document.getElementById("storeGrid");
  if (!grid) return;

  // -----------------------------
  // Condition pricing multipliers
  // -----------------------------
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

  // -----------------------------
  // Stock helpers (NO NaN)
  // -----------------------------
  function getStockObj(p) {
    // New format: stock is an object
    if (p && p.stock && typeof p.stock === "object") {
      return p.stock;
    }
    // Back-compat: old numeric stock → Near Mint only
    return { "Near Mint": Number(p?.stock ?? 0) };
  }

  function stockFor(card, condition) {
    const c = normalizeCondition(condition);
    if (c === "Near Mint") return Number(card.dataset.stockNm || 0);
    if (c === "Lightly Played") return Number(card.dataset.stockLp || 0);
    if (c === "Moderately Played") return Number(card.dataset.stockMp || 0);
    return Number(card.dataset.stockHp || 0);
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

    if (!entries.length) {
      grid.innerHTML = "<p>No products found.</p>";
      return;
    }

    grid.innerHTML = "";

    for (const [sku, p] of entries) {
      const stockObj = getStockObj(p);

      // Read per-condition stock (exact keys)
      const nm = Number(stockObj["Near Mint"] ?? 0);
      const lp = Number(stockObj["Lightly Played"] ?? 0);
      const mp = Number(stockObj["Moderately Played"] ?? 0);
      const hp = Number(stockObj["Heavily Played"] ?? 0);

      // Hide card only if ALL conditions are out of stock
      if ((nm + lp + mp + hp) <= 0) continue;

      const name = String(p.name || sku);
      const baseCents = Number(p.price_cents || 0);

      const imagePath = String(p.image || "");
      const imageSrc = imagePath
        ? encodeURI(imagePath.startsWith("/") ? imagePath : "/" + imagePath)
        : "";

      const defaultCondition = "Near Mint";
      const defaultPriceCents = centsForCondition(baseCents, defaultCondition);

      const card = document.createElement("div");
      card.className = "store-card";

      // Used by other scripts
      card.dataset.sku = sku;
      card.dataset.name = name.toLowerCase();
      card.dataset.basecents = String(baseCents);
      card.dataset.pricecents = String(defaultPriceCents);

      // Store per-condition stock on dataset (IMPORTANT)
      card.dataset.stockNm = String(nm);
      card.dataset.stockLp = String(lp);
      card.dataset.stockMp = String(mp);
      card.dataset.stockHp = String(hp);

      card.innerHTML = `
        ${imageSrc ? `<img class="zoomable" src="${imageSrc}" alt="${name}">` : ""}
        <h3>${name}</h3>

        <p class="price">$${(defaultPriceCents / 100).toFixed(2)}</p>
        <p class="in-stock">In stock: ${nm}</p>

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

    if (!grid.children.length) {
      grid.innerHTML = "<p>All items are out of stock.</p>";
    }
  } catch (err) {
    console.error("buy-render.js error:", err);
    grid.innerHTML = "<p>Error loading catalog.</p>";
  }

  // -----------------------------
  // Condition change → update price + stock display
  // -----------------------------
  document.addEventListener("change", function (e) {
    const sel = e.target.closest(".condition-select");
    if (!sel) return;

    const card = sel.closest(".store-card");
    if (!card) return;

    const condition = sel.value;
    const baseCents = Number(card.dataset.basecents || 0);

    const newCents = centsForCondition(baseCents, condition);
    card.dataset.pricecents = String(newCents);

    const priceEl = card.querySelector(".price");
    if (priceEl) {
      priceEl.textContent = `$${(newCents / 100).toFixed(2)}`;
    }

    const stockEl = card.querySelector(".in-stock");
    if (stockEl) {
      stockEl.textContent = `In stock: ${stockFor(card, condition)}`;
    }
  });

  // -----------------------------
  // Image zoom modal (click image)
  // -----------------------------
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalClose = document.getElementById("imageModalClose");

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
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
});




















