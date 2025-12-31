(function () {
  function readCart(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch { return []; }
  }

  function countQty(cart) {
    return cart.reduce((sum, it) => sum + Math.max(0, Number(it.qty || 0)), 0);
  }

  function setBadge(cartName, count) {
    const badge = document.querySelector(`.cart-badge[data-cart="${cartName}"]`);
    if (!badge) return;

    badge.dataset.count = String(count);

    // update visible count text (works for gem badge)
    const countEl = badge.querySelector(".cart-badge__count");
    if (countEl) countEl.textContent = String(count);

    // show/hide
    if (count > 0) badge.classList.remove("hidden");
    else badge.classList.add("hidden");
  }

  function updateCartBadges() {
    const buyCount = countQty(readCart("buyCart"));
    const sellCount = countQty(readCart("sellCart"));

    setBadge("buy", buyCount);
    setBadge("sell", sellCount);
  }

  window.updateCartBadges = updateCartBadges;

  document.addEventListener("DOMContentLoaded", updateCartBadges);
  window.addEventListener("cart:changed", updateCartBadges);

  // updates when other tabs change localStorage
  window.addEventListener("storage", (e) => {
    if (e.key === "buyCart" || e.key === "sellCart") updateCartBadges();
  });
})();

