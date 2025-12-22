document.addEventListener("DOMContentLoaded", async function () {
  const grid = document.getElementById("storeGrid");
  if (!grid) return;

  // Display tabs -> internal condition names (must match catalog.json keys)
  const TAB_TO_COND = {
    NM: "Near Mint",
    EX: "Lightly Played",
    VG: "Moderately Played",
    G: "Heavily Played"
  };

  // Same multipliers as server.js
  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  const TAB_ORDER = ["NM", "LP", "MP", "HP"];

  function centsForCondition(baseCents, condition) {
    const mult = CONDITION_MULT[condition] ?? 1.0;
    return Math.round(Number(baseCents || 0) * mult);
  }

  function getStockObj(p) {
    if (p?.stock && typeof p.stock === "object") return p.stock;
    return { "Near Mint": Number(p?.stock ?? 0) }; // back-compat
  }

  function firstAvailableTab(stockByCond) {
    for (const tab of TAB_ORDER) {
      const cond = TAB_TO_COND[tab];
      if ((Number(stockByCond[cond]) || 0) > 0) return tab;
    }
    return "NM";
  }

  grid.innerHTML = "<p>Loading catalog...</p>";

  try {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) throw new Error("Catalog load failed");

    const entries = Object.entries(data.catalog || {});
    grid.innerHTML = "";

    for (const [sku, p] of entries) {
      const stockObj = getStockObj(p);

      // Compute per-condition stock
      const stockByCond = {
        "Near Mint": Number(stockObj["Near Mint"] ?? 0),
        "Lightly Played": Number(stockObj["Lightly Played"] ?? 0),
        "Moderately Played": Number(stockObj["Moderately Played"] ?? 0),
        "Heavily Played": Number(stockObj["Heavily Played"] ?? 0)
      };

      const totalStock =
        stockByCond["Near Mint"] +
        stockByCond["Lightly Played"] +
        stockByCond["Moderately Played"] +
        stockByCond["Heavily Played"];

      if (totalStock <= 0) continue;

      const name = String(p.name || sku);
      const baseCents = Number(p.price_cents || 0);

      const imagePath = String(p.image || "");
      const imageSrc = imagePath
        ? encodeURI(imagePath.startsWith("/") ? imagePath : "/" + imagePath)
        : "";

      const activeTab = firstAvailableTab(stockByCond);
      const activeCond = TAB_TO_COND[activeTab];
      const unitCents = centsForCondition(baseCents, activeCond);

      const card = document.createElement("div");
      card.className = "store-card";
      card.dataset.sku = sku;
      card.dataset.name = name.toLowerCase();
      card.dataset.basecents = String(baseCents);

      // Store condition stocks (so buy.js can read)
      card.dataset.stockNm = String(stockByCond["Near Mint"]);
      card.dataset.stockLp = String(stockByCond["Lightly Played"]);
      card.dataset.stockMp = String(stockByCond["Moderately Played"]);
      card.dataset.stockHp = String(stockByCond["Heavily Played"]);


      // Current state
      card.dataset.activeTab = activeTab;      // NM/EX/VG/G
      card.dataset.activeCond = activeCond;    // Near Mint / etc
      card.dataset.unitCents = String(unitCents);

      card.innerHTML = `
        ${imageSrc ? `<img class="zoomable" src="${imageSrc}" alt="${name}">` : ""}
        <h3 class="store-title">${name}</h3>

        <div class="cond-tabs" role="tablist" aria-label="Condition">
          ${TAB_ORDER.map(tab => {
            const cond = TAB_TO_COND[tab];
            const stock = Number(stockByCond[cond] || 0);
            const disabled = stock <= 0 ? "true" : "false";
            const isActive = tab === activeTab ? " active" : "";
            const disClass = stock <= 0 ? " disabled" : "";
            return `<button class="cond-tab${isActive}${disClass}" type="button"
                      data-tab="${tab}" data-cond="${cond}" aria-disabled="${disabled}">
                      ${tab}
                    </button>`;
          }).join("")}
        </div>

        <div class="buyline">
          <span class="qty-label"><span class="qty-num">1</span> @ <span class="unit-price">$${(unitCents/100).toFixed(2)}</span></span>
          <span class="stock-label">Stock: <span class="stock-num">${Number(stockByCond[activeCond] || 0)}</span></span>
        </div>

        <div class="qty-stepper">
          <button class="qty-minus" type="button">−</button>
          <input class="qty-input" type="number" min="1" value="1" inputmode="numeric">
          <button class="qty-plus" type="button">+</button>
        </div>

        <button class="add-to-cart-btn" type="button">Add to Cart</button>
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

  // Image zoom modal (keep your existing modal markup in buy.html)
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalClose = document.getElementById("imageModalClose");

  if (modal && modalImg && modalClose) {
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
  }
});




















