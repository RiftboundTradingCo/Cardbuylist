(function () {
  function loadSellCart() {
    try {
      return JSON.parse(localStorage.getItem("sellCart")) || [];
    } catch {
      return [];
    }
  }

  function updateSellCartBadge() {
    const badge = document.getElementById("sellCartBadge");
    if (!badge) return;

    const cart = loadSellCart();

    const count = cart.reduce(
      (sum, item) => sum + (Number(item.qty) || 0),
      0
    );

    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "0";
      badge.classList.add("hidden");
    }
  }

  // Initial load
  updateSellCartBadge();

  // Update when storage changes (other tabs / pages)
  window.addEventListener("storage", updateSellCartBadge);

  // Allow manual refresh trigger
  window.updateSellCartBadge = updateSellCartBadge;
})();
