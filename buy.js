document.addEventListener("DOMContentLoaded", function () {
  const buySearch = document.getElementById("buySearch");
  const storeGrid = document.getElementById("storeGrid");

  if (!storeGrid) return;

function loadBuyCart() {
  try { return JSON.parse(localStorage.getItem("buyCart")) || []; } catch { return []; }
}
function saveBuyCart(cart) {
  localStorage.setItem("buyCart", JSON.stringify(cart));
}

function totalQtyForSku(cart, sku) {
  return cart
    .filter(i => i.sku === sku)
    .reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
}

storeGrid.addEventListener("click", function (e) {
  const btn = e.target.closest(".buy-add-btn");
  if (!btn || btn.disabled) return;

  const card = btn.closest(".store-card");
  if (!card) return;

  const sku = (card.dataset.sku || "").trim();
  const stock = Number(card.dataset.stock || 0);
  const condition = card.querySelector(".condition-select")?.value || "Near Mint";

  let cart = loadBuyCart();

  // ✅ Stock check across all conditions for this SKU
  const inCartTotal = totalQtyForSku(cart, sku);
  if (inCartTotal >= stock) {
    btn.disabled = true;
    btn.textContent = "Max in Cart";
    return;
  }

  // Find line item for same SKU + same condition
  const idx = cart.findIndex(i => i.sku === sku && i.condition === condition);

  if (idx >= 0) {
    cart[idx].qty = Math.min(999, (Number(cart[idx].qty) || 0) + 1);
  } else {
    cart.push({ sku, qty: 1, condition });
  }

  saveBuyCart(cart);

  btn.textContent = "Added ✓";
  setTimeout(() => (btn.textContent = "Add to Cart"), 700);
});


  // INITIAL BUTTON STATE (important on page load)
  storeGrid.querySelectorAll(".store-card").forEach(updateButtonState);
});

