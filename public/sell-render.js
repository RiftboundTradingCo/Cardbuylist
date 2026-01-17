document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.getElementById("sellGrid");
  const search = document.getElementById("sellSearch");
  if (!grid) return;

  grid.innerHTML = "";

  function normalizeImagePath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    const withSlash = s.startsWith("/") ? s : `/${s}`;
    return encodeURI(withSlash);
  }

  try {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) {
      grid.innerHTML = "<p>Could not load catalog.</p>";
      return;
    }

    const data = await res.json();
    if (!data?.ok || !data.catalog) {
      grid.innerHTML = "<p>Catalog unavailable.</p>";
      return;
    }

    const entries = Object.entries(data.catalog);
    if (!entries.length) {
      grid.innerHTML = "<p>No products found.</p>";
      return;
    }

    for (const [sku, p] of entries) {
      const name = String(p.name || sku);
      const imgSrc = normalizeImagePath(p.image);

      const card = document.createElement("div");
      card.className = "store-card";
      card.dataset.name = name.toLowerCase();
      card.dataset.sku = sku;

      card.innerHTML = `
        ${imgSrc ? `<img class="zoomable" src="${imgSrc}" alt="${name}">` : ""}
        <h3 class="store-title">${name}</h3>

        <button class="sell-add-btn" type="button" data-sku="${sku}">
          Add to Sell Order
        </button>
      `;

      grid.appendChild(card);
    }

    // Search filter
    if (search) {
      search.addEventListener("input", () => {
        const q = search.value.toLowerCase().trim();
        grid.querySelectorAll(".store-card").forEach((c) => {
          const n = String(c.dataset.name || "");
          c.style.display = !q || n.includes(q) ? "" : "none";
        });
      });
    }
  } catch (err) {
    console.error("sell-render error:", err);
    grid.innerHTML = "<p>Catalog load error.</p>";
  }
});

// ---------- image zoom modal ----------
const modal = document.getElementById("imageModal");
const modalImg = document.getElementById("imageModalImg");
const modalClose = document.getElementById("imageModalClose");

function openModal(src) {
  if (!modal || !modalImg) return;
  modalImg.src = src;
  modal.classList.remove("hidden");
}

function closeModal() {
  if (!modal || !modalImg) return;
  modal.classList.add("hidden");
  modalImg.src = "";
}

if (modalClose) modalClose.addEventListener("click", closeModal);
if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// Event delegation so it works for dynamically-rendered cards
document.addEventListener("click", (e) => {
  const img = e.target.closest("img");
  if (!img) return;

  // Only zoom card images (adjust selectors to match your sell page)
  const isCardImage =
    img.classList.contains("card-img") ||
    img.classList.contains("card-image") ||
    img.classList.contains("sell-card-img") ||
    img.hasAttribute("data-zoom");

  if (!isCardImage) return;

  const src = img.getAttribute("src");
  if (src) openModal(src);
});

