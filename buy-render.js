document.addEventListener("DOMContentLoaded", async function () {
  const grid = document.getElementById("storeGrid");
  if (!grid) return;

  // show something so you know it's running
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
      grid.innerHTML = "<p>No products found. (catalog.json is empty)</p>";
      return;
    }

    grid.innerHTML = "";

    for (const [sku, p] of entries) {
      const stock = Number(p.stock ?? 0);
      if (stock <= 0) continue; // hide out of stock

      const name = String(p.name || sku);
      const priceCents = Number(p.price_cents || 0);
      const image = String(p.image || "");
      const imagePath = p.image || "";
      const imageSrc = imagePath ? encodeURI(imagePath.startsWith("/") ? imagePath : "/" + imagePath) : "";
      const card = document.createElement("div");
      card.className = "store-card";
      card.dataset.sku = sku;

      card.innerHTML = `
        <img src="${encodeURI(p.image)}" alt="${p.name}">
        <h3>${name}</h3>
        <p class="price">$${(priceCents / 100).toFixed(2)}</p>
        <button class="buy-add-btn" type="button">Add to Cart</button>
      `;

      grid.appendChild(card);
    }

    if (grid.children.length === 0) {
      grid.innerHTML = "<p>All items are out of stock.</p>";
    }
  } catch (e) {
    console.error("buy-render.js error:", e);
    grid.innerHTML = "<p>Error loading catalog. Check console.</p>";
  }
  document.getElementById("buySearch")?.dispatchEvent(new Event("input"));
});























