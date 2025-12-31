// cart-badge.js
(() => {
  function safeParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function countItems(key) {
    const cart = safeParse(localStorage.getItem(key) || "[]", []);
    return cart.reduce((sum, item) => sum + Math.max(0, Number(item.qty || 0)), 0);
  }

  function updateBadge(el, count) {
    if (!el) return;

    el.textContent = String(count);

    // hide badge when empty
    if (count > 0) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  window.updateCartBadges = function () {
    const sellCount = countItems("sellCart");
    const buyCount  = countItems("buyCart");

    document
      .querySelectorAll('.cart-badge[data-cart="sell"]')
      .forEach(el => updateBadge(el, sellCount));

    document
      .querySelectorAll('.cart-badge[data-cart="buy"]')
      .forEach(el => updateBadge(el, buyCount));
  };

  // initial load
  document.addEventListener("DOMContentLoaded", window.updateCartBadges);

  // custom event (fired by buy/sell cart scripts)
  window.addEventListener("cart:changed", window.updateCartBadges);

  // cross-tab updates
  window.addEventListener("storage", (e) => {
    if (e.key === "buyCart" || e.key === "sellCart") {
      window.updateCartBadges();
    }
  });
})();
