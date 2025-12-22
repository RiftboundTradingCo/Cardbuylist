document.addEventListener("DOMContentLoaded", async function () {
  const grid = document.getElementById("storeGrid");
  if (!grid) return;

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

    grid.innerHTML = "";

    for (const [sku, p] of entries) {
      const stock = Number(p.stock ?? 0);
      if (stock <= 0) continue; // hide sold-out items

      const name = String(p.name || sku);
      const priceCents = Number(p.price_cents || 0);
      const imagePath = String(p.image || "");

      const imageSrc = imagePath
        ? encodeURI(imagePath.startsWith("/") ? imagePath : "/" + imagePath)
        : "";

      const card = document.createElement("div");
      card.className = "store-card";
      card.dataset.sku = sku;
      card.dataset.name = name.toLowerCase(); // used by search

      card.innerHTML = `
        ${imageSrc ? `<img class="zoomable" src="${imageSrc}" alt="${name}">` : ""}
        <h3>${name}</h3>
        <p class="price">$${(priceCents / 100).toFixed(2)}</p>
        <p class="in-stock">In stock: ${stock}</p>
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
  // Image modal (click to zoom)
  // -------------------------
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

  modalClose.addEventListener("click", () => {
    modal.classList.add("hidden");
    modalImg.src = "";
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
      modalImg.src = "";
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      modal.classList.add("hidden");
      modalImg.src = "";
    }
  });
});






















