document.addEventListener("DOMContentLoaded", function () {
  const buySearch = document.getElementById("buySearch");
  const storeGrid = document.getElementById("storeGrid");

  if (!storeGrid) return;

  function loadBuyCart() {
    const raw = localStorage.getItem("buyCart");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  function saveBuyCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  // SEARCH (uses data-name that buy-render.js adds)
  if (buySearch) {
    buySearch.addEventListener("input", function () {
      const q = buySearch.value.toLowerCase().trim();
      storeGrid.querySelectorAll(".store-card").forEach(card => {
        const name = (card.dataset.name || "");
        card.style.display = name.includes(q) ? "" : "none";
      });
    });
  }

  // ADD TO CART (uses sku ONLY)
  storeGrid.addEventListener("click", function (e) {
    const btn = e.target.closest(".buy-add-btn");
    if (!btn) return;

    const card = btn.closest(".store-card");
    if (!card) return;

    const sku = (card.dataset.sku || "").trim();
    if (!sku) return;

    const cart = loadBuyCart();
    const idx = cart.findIndex(i => i.sku === sku);

    if (idx >= 0) cart[idx].qty = Math.min(999, (Number(cart[idx].qty) || 0) + 1);
    else cart.push({ sku, qty: 1 });

    saveBuyCart(cart);

    btn.textContent = "Added ✓";
    setTimeout(() => (btn.textContent = "Add to Cart"), 700);
  });
});

