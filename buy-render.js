document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.getElementById("storeGrid");
  if (!grid) return;

  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played"
  };

  const TAB_ORDER = ["NM", "LP", "MP", "HP"];

  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  function centsForCondition(baseCents, cond) {
    const m = CONDITION_MULT[cond] ?? 1.0;
    return Math.round(Number(baseCents || 0) * m);
  }

  function getStockObj(p) {
    if (p?.stock && typeof p.stock === "object") return p.stock;
    return { "Near Mint": Number(p?.stock ?? 0) };
  }

  function condStock(stockObj, cond) {
    // EXACT KEY MATCH with your JSON: "Near Mint", "Lightly Played", etc.
    return Number(stockObj?.[cond] ?? 0);
  }

  function firstAvailableTab(stockObj) {
    for (const tab of TAB_ORDER) {
      const cond = TAB_TO_COND[tab];
      if (condStock(stockObj, cond) > 0) return tab;
    }
    return "NM";
  }

  grid.innerHTML = "";

  try {
    const res = await fetch("/api/catalog", { cache: "no-store" });

    if (!res.ok) {
      return;
    }

    const data = await res.json();

    if (!data || data.ok !== true || !data.catalog) {
      return;
    }

    const entries = Object.entries(data.catalog);

    if (!entries.length) {
      grid.innerHTML = "<p>No products found.</p>";
      return;
    }

    let rendered = 0;

    for (const [sku, p] of entries) {
      const stockObj = getStockObj(p);

      const nm = condStock(stockObj, "Near Mint");
      const lp = condStock(stockObj, "Lightly Played");
      const mp = condStock(stockObj, "Moderately Played");
      const hp = condStock(stockObj, "Heavily Played");
      const totalStock = nm + lp + mp + hp;

      // Only skip if ALL conditions are truly 0
      if (totalStock <= 0) continue;

      const name = String(p.name || sku);
      const baseCents = Number(p.price_cents || 0);

      const imagePath = String(p.image || "");
      const imageSrc = imagePath
        ? encodeURI(imagePath.startsWith("/") ? imagePath : "/" + imagePath)
        : "";

      const activeTab = firstAvailableTab(stockObj);
      const activeCond = TAB_TO_COND[activeTab];
      const unitCents = centsForCondition(baseCents, activeCond);
      const activeStock = condStock(stockObj, activeCond);

      const card = document.createElement("div");
      card.className = "store-card";
      card.dataset.sku = sku;
      card.dataset.name = name.toLowerCase();
      card.dataset.basecents = String(baseCents);

      // stock datasets for buy.js
      card.dataset.stockNm = String(nm);
      card.dataset.stockLp = String(lp);
      card.dataset.stockMp = String(mp);
      card.dataset.stockHp = String(hp);

      // state
      card.dataset.activeTab = activeTab;
      card.dataset.activeCond = activeCond;
      card.dataset.unitCents = String(unitCents);

      card.innerHTML = `
        ${imageSrc ? `<img class="zoomable" src="${imageSrc}" alt="${name}">` : ""}
        <h3 class="store-title">${name}</h3>

        <div class="cond-tabs" role="tablist" aria-label="Condition">
          ${TAB_ORDER.map((tab) => {
            const cond = TAB_TO_COND[tab];
            const s =
              tab === "NM" ? nm :
              tab === "LP" ? lp :
              tab === "MP" ? mp : hp;

            const disabled = s <= 0;
            const isActive = tab === activeTab;

            return `<button
                      class="cond-tab${isActive ? " active" : ""}${disabled ? " disabled" : ""}"
                      type="button"
                      data-tab="${tab}"
                      aria-disabled="${disabled ? "true" : "false"}"
                    >${tab}</button>`;
          }).join("")}
        </div>

        <div class="buyline">
          <span class="qty-label"><span class="qty-num">1</span> @ <span class="unit-price">$${(unitCents/100).toFixed(2)}</span></span>
          <span class="stock-label">Stock: <span class="stock-num">${activeStock}</span></span>
        </div>

        <div class="qty-stepper">
          <button class="qty-minus" type="button">−</button>
          <input class="qty-input" type="number" min="1" value="1" inputmode="numeric">
          <button class="qty-plus" type="button">+</button>
        </div>

        <button class="add-to-cart-btn" type="button">Add to Cart</button>
      `;

      grid.appendChild(card);
      rendered++;
    }


    if (rendered === 0) {
      grid.innerHTML = "<p>No in-stock items to display.</p>";
    }
  } catch (err) {
    console.error("buy-render.js error:", err);
  }
});




















