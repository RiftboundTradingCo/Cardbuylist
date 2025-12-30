(function () {
  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function countCart(key) {
    const arr = safeParse(localStorage.getItem(key) || "[]", []);
    return arr.reduce((sum, it) => sum + Math.max(0, Number(it?.qty || 0)), 0);
  }

  function setBadge(el, n) {
    if (!el) return;
    el.textContent = String(n);

    // hide when 0
    if (n > 0) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }

  window.updateCartBadges = function updateCartBadges() {
    const sellCount = countCart("sellCart");
    const buyCount  = countCart("buyCart");

    document.querySelectorAll('.cart-badge[data-cart="sell"]').forEach(el => setBadge(el, sellCount));
    document.querySelectorAll('.cart-badge[data-cart="buy"]').forEach(el => setBadge(el, buyCount));
  };

  // update when page loads
  document.addEventListener("DOMContentLoaded", window.updateCartBadges);

  // update when your code dispatches cart:changed
  window.addEventListener("cart:changed", window.updateCartBadges);

  // update when cart changes in another tab
  window.addEventListener("storage", (e) => {
    if (e.key === "sellCart" || e.key === "buyCart") window.updateCartBadges();
  });
})();
