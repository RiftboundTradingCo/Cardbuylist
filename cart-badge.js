document.addEventListener("DOMContentLoaded", function () {
  const badge = document.getElementById("buyCartBadge");
  if (!badge) return;

  function updateBadge() {
    const raw = localStorage.getItem("buyCart");
    if (!raw) {
      badge.classList.add("hidden");
      return;
    }

    let cart;
    try {
      cart = JSON.parse(raw);
    } catch {
      badge.classList.add("hidden");
      return;
    }

    const count = cart.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);

    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  updateBadge();

  // Update badge if another page modifies cart
  window.addEventListener("storage", updateBadge);

  // Optional: poll every second to catch same-tab updates
  setInterval(updateBadge, 1000);
});
