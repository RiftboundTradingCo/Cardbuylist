document.addEventListener("DOMContentLoaded", updateCartBadges);
window.addEventListener("storage", updateCartBadges);

function updateCartBadges() {
  updateBadge("buyCart", "buyCartBadge");
  updateBadge("sellCart", "sellCartBadge");
}

function updateBadge(storageKey, badgeId) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;

  let cart = [];
  try {
    cart = JSON.parse(localStorage.getItem(storageKey)) || [];
  } catch {
    cart = [];
  }

  const count = cart.reduce((sum, item) => {
    return sum + Number(item.qty || 0);
  }, 0);

  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
  } else {
    badge.textContent = "0";
    badge.classList.add("hidden");
  }
}

