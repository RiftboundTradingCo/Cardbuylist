document.addEventListener("DOMContentLoaded", function () {
  const buySearch = document.getElementById("buySearch");
  const storeGrid = document.getElementById("storeGrid");

  function loadBuyCart() {
    const raw = localStorage.getItem("buyCart");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  function saveBuyCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  // Search filter
  if (buySearch && storeGrid) {
    buySearch.addEventListener("input", function () {
      const q = buySearch.value.toLowerCase().trim();
      storeGrid.querySelectorAll(".store-card").forEach(card => {
        const name = (card.dataset.name || "").toLowerCase();
        card.style.display = name.includes(q) ? "" : "none";
      });
    });

    // Add to cart (event delegation)
    storeGrid.addEventListener("click", function (e) {
      if (!e.target.classList.contains("buy-add-btn")) return;

      const card = e.target.closest(".store-card");
      const name = card.dataset.name;
      const price = Number(card.dataset.price);
      const image = card.dataset.image || "";

      if (!name || !Number.isFinite(price)) return;

      const cart = loadBuyCart();
      const idx = cart.findIndex(i => i.name === name);

      if (idx >= 0) cart[idx].qty += 1;
      else cart.push({ name, price, image, qty: 1 });

      saveBuyCart(cart);

      e.target.textContent = "Added!";
      setTimeout(() => (e.target.textContent = "Add to Cart"), 700);
    });
  }
});
