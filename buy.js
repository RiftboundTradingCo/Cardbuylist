document.addEventListener("DOMContentLoaded", function () {
  const buySearch = document.getElementById("buySearch");
  const storeGrid = document.getElementById("storeGrid");

  if (!storeGrid) return;

  function loadBuyCart() {
    try {
      return JSON.parse(localStorage.getItem("buyCart")) || [];
    } catch {
      return [];
    }
  }

  function saveBuyCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  function getQtyInCart(sku) {
    const cart = loadBuyCart();
    const item = cart.find(i => i.sku === sku);
    return item ? Number(item.qty) || 0 : 0;
  }

  function updateButtonState(card) {
    const sku = card.dataset.sku;
    const stock = Number(card.dataset.stock || 0);
    const btn = card.querySelector(".buy-add-btn");
    if (!btn) return;

    const inCart = getQtyInCart(sku);

    if (inCart >= stock) {
      btn.disabled = true;
      btn.textContent = "Max in Cart";
      btn.classList.add("disabled");
    } else {
      btn.disabled = false;
      btn.textContent = "Add to Cart";
      btn.classList.remove("disabled");
    }
  }

  // SEARCH
  if (buySearch) {
    buySearch.addEventListener("input", function () {
      const q = buySearch.value.toLowerCase().trim();
      storeGrid.querySelectorAll(".store-card").forEach(card => {
        card.style.display = card.dataset.name.includes(q) ? "" : "none";
      });
    });
  }

  // ADD TO CART
  storeGrid.addEventListener("click", function (e) {
    const btn = e.target.closest(".buy-add-btn");
    if (!btn || btn.disabled) return;

    const card = btn.closest(".store-card");
    if (!card) return;

    const sku = card.dataset.sku;
    const stock = Number(card.dataset.stock || 0);

    const cart = loadBuyCart();
    const idx = cart.findIndex(i => i.sku === sku);

    if (idx >= 0) {
      if (cart[idx].qty >= stock) {
        updateButtonState(card);
        return;
      }
      const condition =
  card.querySelector(".condition-select")?.value || "Near Mint";

if (cart[idx].condition === condition) {
  cart[idx].qty += 1;
} else {
  cart.push({ sku, qty: 1, condition });
}

    } else {
      if (stock < 1) return;
      const condition =
  card.querySelector(".condition-select")?.value || "Near Mint";

cart.push({
  sku,
  qty: 1,
  condition
});

    }

    saveBuyCart(cart);
    updateButtonState(card);

    btn.textContent = "Added ✓";
    setTimeout(() => updateButtonState(card), 600);
  });

  // INITIAL BUTTON STATE (important on page load)
  storeGrid.querySelectorAll(".store-card").forEach(updateButtonState);
});

