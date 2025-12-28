(() => {
  function safeParse(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch { return []; }
  }

  function sumQty(arr) {
    return arr.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  }

  function setBadge(el, n) {
    if (!el) return;
    const count = Number(n) || 0;
    el.textContent = String(count);
    el.classList.toggle("hidden", count <= 0);
  }

  function updateCartBadges() {
    const buyCount = sumQty(safeParse("buyCart"));
    const sellCount = sumQty(safeParse("sellCart"));

    // Buy badge(s)
    setBadge(document.getElementById("buyCartBadge"), buyCount);
    document.querySelectorAll('.cart-badge[data-cart="buy"]').forEach(el => setBadge(el, buyCount));

    // Sell badge(s)
    setBadge(document.getElementById("sellCartBadge"), sellCount);
    document.querySelectorAll('.cart-badge[data-cart="sell"]').forEach(el => setBadge(el, sellCount));
  }

  // ✅ expose globally so any page can call it
  window.updateCartBadges = updateCartBadges;

  // Initial + when navigating/back-forward cache
  document.addEventListener("DOMContentLoaded", updateCartBadges);
  window.addEventListener("pageshow", updateCartBadges);

  // ✅ fires in OTHER tabs
  window.addEventListener("storage", (e) => {
    if (e.key === "buyCart" || e.key === "sellCart") updateCartBadges();
  });

  // ✅ fires in THIS tab (we’ll dispatch it from saveCart)
  window.addEventListener("cart:changed", updateCartBadges);
})();

