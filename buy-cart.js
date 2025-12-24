(() => {
  const TAB_ORDER = ["NM", "LP", "MP", "HP"];
  const TAB_TO_COND = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played"
  };

  const CONDITION_MULT = {
    "Near Mint": 1.0,
    "Lightly Played": 0.9,
    "Moderately Played": 0.8,
    "Heavily Played": 0.65
  };

  function money(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem("buyCart")) || [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem("buyCart", JSON.stringify(cart));
  }

  async function loadCatalog() {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    const json = await res.json();
    return json.catalog || {};
  }

  const list = document.getElementById("buyCartList");
  const totalEl = document.getElementById("buyCartTotal");

  let CATALOG = {};
  let GROUPS = {};

  function groupCart(cart) {
    GROUPS = {};

    for (const item of cart) {
      const sku = item.sku;
      const cond = item.condition;

      if (!GROUPS[sku]) {
        GROUPS[sku] = {
          sku,
          conditions: {},
          activeCondition: cond
        };
      }

      GROUPS[sku].conditions[cond] = {
        qty: item.qty
      };
    }
  }

  function render(full = true) {
    list.innerHTML = "";
    let grandTotal = 0;

    Object.values(GROUPS).forEach(group => {
      const product = CATALOG[group.sku];
      if (!product) return;

      const stock = product.stock || {};
      const baseCents = product.price_cents;

      if (full && !group.activeCondition) {
        group.activeCondition =
          Object.keys(group.conditions)[0] || "Near Mint";
      }

      const activeCond = group.activeCondition;
      const activeQty = group.conditions[activeCond]?.qty || 1;
      const unitCents = Math.round(baseCents * CONDITION_MULT[activeCond]);

      const groupQty = Object.values(group.conditions)
        .reduce((s, c) => s + c.qty, 0);

      const groupTotal = Object.entries(group.conditions)
        .reduce((sum, [cond, c]) => {
          return sum + Math.round(baseCents * CONDITION_MULT[cond]) * c.qty;
        }, 0);

      grandTotal += groupTotal;

      const li = document.createElement("li");
      li.className = "buy-cart-row";
      li.dataset.sku = group.sku;

      li.innerHTML = `
        <img src="${product.image}" class="cart-thumb">

        <div class="buy-cart-info">
          <strong>${product.name}</strong>

          <div class="cond-tabs">
            ${TAB_ORDER.map(t => {
              const cond = TAB_TO_COND[t];
              const has = group.conditions[cond];
              const disabled = !has;
              const active = cond === activeCond;
              return `
                <button
                  class="cond-tab ${active ? "active" : ""}"
                  data-cond="${cond}"
                  ${disabled ? "disabled" : ""}
                >${t}</button>
              `;
            }).join("")}
          </div>

          <div>Condition: ${activeCond}</div>
          <div>In stock: ${stock[activeCond] ?? 0}</div>
          <div>Unit: ${money(unitCents)}</div>
        </div>

        <div class="buy-cart-actions">
          <div class="qty-stepper">
            <button class="qty-minus">−</button>
            <span class="qty-num">${activeQty}</span>
            <button class="qty-plus">+</button>
          </div>

          <div class="cart-line-total">${money(unitCents * activeQty)}</div>

          <div class="cart-group-summary">
            In cart (all conditions): ${groupQty} • Subtotal: ${money(groupTotal)}
          </div>

          <button class="cart-remove">Remove condition</button>
        </div>
      `;

      list.appendChild(li);
    });

    totalEl.textContent = money(grandTotal);
  }

  document.addEventListener("click", e => {
    const row = e.target.closest(".buy-cart-row");
    if (!row) return;

    const sku = row.dataset.sku;
    const group = GROUPS[sku];
    const cond = group.activeCondition;

    if (e.target.classList.contains("cond-tab")) {
      group.activeCondition = e.target.dataset.cond;
      render(false);
      return;
    }

    if (e.target.classList.contains("qty-plus")) {
      group.conditions[cond].qty++;
      saveCart(flatten());
      render(false);
    }

    if (e.target.classList.contains("qty-minus")) {
      group.conditions[cond].qty = Math.max(1, group.conditions[cond].qty - 1);
      saveCart(flatten());
      render(false);
    }

    if (e.target.classList.contains("cart-remove")) {
      delete group.conditions[cond];
      if (!Object.keys(group.conditions).length) {
        delete GROUPS[sku];
      }
      saveCart(flatten());
      render(true);
    }
  });

  function flatten() {
    const out = [];
    Object.values(GROUPS).forEach(g => {
      Object.entries(g.conditions).forEach(([cond, v]) => {
        out.push({ sku: g.sku, condition: cond, qty: v.qty });
      });
    });
    return out;
  }

  async function init() {
    CATALOG = await loadCatalog();
    const cart = loadCart();
    groupCart(cart);
    render(true);
  }

  init();
})();

