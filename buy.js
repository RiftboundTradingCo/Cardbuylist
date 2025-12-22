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

  // Total qty in cart for a SKU across ALL conditions
  function totalQtyForSku(cart, sku) {
    return cart
      .filter((i) => i.sku === sku)
      .reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  }

  // For one card on the buy page, disable Add button if total in cart >= stock
  function updateAddBtnState(card) {
    const sku = (card.dataset.sku || "").trim();
    const stock = Number(card.dataset.stock || 0);
    const btn = card.querySelector(".buy-add-btn");
    if (!btn || !sku) return;

    const cart = loadBuyCart();
    const inCart = totalQtyForSku(cart, sku);

    if (stock > 0 && inCart >= stock) {
      btn.disabled = true;
      btn.textContent = "Max in Cart";
      btn.classList.add("disabled");
    } else {
      btn.disabled = false;
      btn.textContent = "Add to Cart";
      btn.classList.remove("disabled");
    }
  }

  // SEARCH (uses data-name set by buy-render.js)
  if (buySearch) {
    buySearch.addEventListener("input", function () {
      const q = buySearch.value.toLowerCase().trim();
      storeGrid.querySelectorAll(".store-card").forEach((card) => {
        const name = card.dataset.name || "";
        card.style.display = name.includes(q) ? "" : "none";
      });
    });
  }

  // ADD TO CART
  storeGrid.addEventListener("click", function (e) {
    const btn = e.target.closest(".buy-add-btn");
    if (!btn || btn.disabled) return;

    const card = btn.closest(".store-card");
    if (!card) return;

    const sku = (card.dataset.sku || "").trim();
    const stock = Number(card.dataset.stock || 0);
    const condition =
      card.querySelector(".condition-select")?.value || "Near Mint";

    if (!sku) return;

    const cart = loadBuyCart();
    const inCart = totalQtyForSku(cart, sku);

    // Enforce stock across ALL conditions for this SKU
    if (stock > 0 && inCart >= stock) {
      updateAddBtnState(card);
      return;
    }

    // If same SKU + same condition exists, increment that line
    const idx = cart.findIndex(
      (i) => i.sku === sku && (i.condition || "Near Mint") === condition
    );

    if (idx >= 0) {
      cart[idx].qty = Math.min(999, (Number(cart[idx].qty) || 0) + 1);
    } else {
      cart.push({ sku, qty: 1, condition });
    }

    saveBuyCart(cart);

    btn.textContent = "Added ✓";
    setTimeout(() => updateAddBtnState(card), 500);

    // Update all cards with same SKU (so they disable properly if multiple on screen)
    storeGrid.querySelectorAll(`.store-card[data-sku="${CSS.escape(sku)}"]`)
      .forEach(updateAddBtnState);
  });

  // If user changes condition dropdown, we still keep Add button state correct
  storeGrid.addEventListener("change", function (e) {
    const sel = e.target.closest(".condition-select");
    if (!sel) return;
    const card = sel.closest(".store-card");
    if (card) updateAddBtnState(card);
  });

  // Initial state (after buy-render.js populates)
  // buy-render.js runs before buy.js in your buy.html, so this is safe.
  storeGrid.querySelectorAll(".store-card").forEach(updateAddBtnState);
});
