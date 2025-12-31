(function () {
  function getCount(key) {
    try {
      const cart = JSON.parse(localStorage.getItem(key) || "[]");
      return cart.reduce((sum, it) => sum + Math.max(0, Number(it.qty || 0)), 0);
    } catch {
      return 0;
    }
  }

  function updateBadgeFor(cartName, count) {
    const el = document.querySelector(`.cart-badge[data-cart="${cartName}"]`);
    if (!el) return;

    el.textContent = String(count);

    if (count > 0) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  function updateCartBadges() {
    const buyCount = getCount("buyCart");
    const sellCount = getCount("sellCart");

    updateBadgeFor("buy", buyCount);
    updateBadgeFor("sell", sellCount);
  }

  // expose for other scripts if needed
  window.updateCartBadges = updateCartBadges;

  // run on load
  document.addEventListener("DOMContentLoaded", updateCartBadges);

  // run when a cart changes (same tab)
  window.addEventListener("cart:changed", updateCartBadges);

  // run when cart changes in another tab
  window.addEventListener("storage", (e) => {
    if (e.key === "buyCart" || e.key === "sellCart") updateCartBadges();
  });
})();
