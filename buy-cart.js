document.addEventListener("DOMContentLoaded", function () {
  // Visible proof the JS loaded
  const badge = document.createElement("div");
  badge.textContent = "Buy page JS loaded ✓";
  badge.style.position = "fixed";
  badge.style.bottom = "14px";
  badge.style.right = "14px";
  badge.style.padding = "10px 12px";
  badge.style.borderRadius = "10px";
  badge.style.background = "rgba(17,24,39,0.92)";
  badge.style.color = "white";
  badge.style.fontSize = "12px";
  badge.style.zIndex = "9999";
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 1800);

  // Grab elements in a robust way (doesn't require IDs)
  const buySearch = document.getElementById("buySearch") || document.querySelector(".buy-search");
  const storeGrid = document.getElementById("storeGrid") || document.querySelector(".store-grid");

  if (!storeGrid) {
    alert("Could not find the store grid (.store-grid). Check buy.html markup.");
    return;
  }

  function loadBuyCart() {
    const raw = localStorage.getItem("buyCart");
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  function saveBuyCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  function toast(text) {
    const t = document.createElement("div");
    t.textContent = text;
    t.style.position = "fixed";
    t.style.top = "70px";
    t.style.right = "14px";
    t.style.padding = "10px 12px";
    t.style.borderRadius = "10px";
    t.style.background = "rgba(34,197,94,0.95)";
    t.style.color = "#111";
    t.style.fontWeight = "700";
    t.style.zIndex = "9999";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1200);
  }

  // Search filter
  if (buySearch) {
    buySearch.addEventListener("input", function () {
      const q = buySearch.value.toLowerCase().trim();
      storeGrid.querySelectorAll(".store-card").forEach(card => {
        const name = (card.dataset.name || "").toLowerCase();
        card.style.display = name.includes(q) ? "" : "none";
      });
    });
  }

  // Add to cart (event delegation)
  storeGrid.addEventListener("click", function (e) {
    const btn = e.target.closest(".buy-add-btn");
    if (!btn) return;

    const card = btn.closest(".store-card");
    if (!card) return;

    const name = (card.dataset.name || "").trim();
    const price = Number(card.dataset.price);
    const image = card.dataset.image || "";

    if (!name) {
      alert("Missing data-name on .store-card");
      return;
    }
    if (!Number.isFinite(price)) {
      alert("Missing/invalid data-price on .store-card for: " + name);
      return;
    }

    const cartArr = loadBuyCart();
    const idx = cartArr.findIndex(i => i.name === name);

    if (idx >= 0) cartArr[idx].qty += 1;
    else cartArr.push({ name, price, image, qty: 1 });

    saveBuyCart(cartArr);

    btn.textContent = "Added ✓";
    setTimeout(() => (btn.textContent = "Add to Cart"), 700);

    toast(`Added: ${name}`);
  });
});
