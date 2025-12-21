document.addEventListener("DOMContentLoaded", function () {
  const buySearch = document.getElementById("buySearch");
  const storeGrid = document.getElementById("storeGrid");

  if (!buySearch || !storeGrid) return;

  function filterCards() {
    const q = buySearch.value.toLowerCase().trim();

    const cards = storeGrid.querySelectorAll(".store-card");
    cards.forEach(card => {
      const title = (card.querySelector("h3")?.textContent || "").toLowerCase();
      const sku = (card.dataset.sku || "").toLowerCase();

      const match = title.includes(q) || sku.includes(q);
      card.style.display = match ? "" : "none";
    });
  }

  // Run as user types
  buySearch.addEventListener("input", filterCards);

  // Also run once after a short delay to catch auto-rendered cards
  // (cards load after fetch in buy-render.js)
  setTimeout(filterCards, 300);
});

