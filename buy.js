document.addEventListener("DOMContentLoaded", function () {
  const buySearch = document.getElementById("buySearch") || document.querySelector(".buy-search");
  const storeGrid = document.getElementById("storeGrid") || document.querySelector(".store-grid");

  // If the grid isn't on this page, just do nothing (no popups)
  if (!storeGrid) return;

  function loadBuyCart() {
    const raw = localStorage.getItem("buyCart");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  function saveBuyCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  // Search filter
  if (buySearch) {
    buySearch.addEventListener("input", function () {
      const q = buySearch.value.toLowerCase().trim();
      storeGrid.querySelectorAll(".store-card").forEach(card => {
        const name = (card.dataset.name || "").toLowerCase();
        card.style.display = name.includes(q) ? "" : "none";
      });
    });
  }

  // Add to cart
  storeGrid.addEventListener("click", function (e) {
    const btn = e.target.closest(".buy-add-btn");
    if (!btn) return;

    const card = btn.closest(".store-card");
    if (!card) return;

    const name = (card.dataset.name || "").trim();
    const price = Number(card.dataset.price); // must be like 999.99 (no $)
    const image = card.dataset.image || "";

    if (!name || !Number.isFinite(price)) return;

    const cartArr = loadBuyCart();
    const idx = cartArr.findIndex(i => i.name === name);

    if (idx >= 0) cartArr[idx].qty += 1;
    else cartArr.push({ name, price, image, qty: 1 });

    saveBuyCart(cartArr);

    btn.textContent = "Added ✓";
    setTimeout(() => (btn.textContent = "Add to Cart"), 700);
  });
});
