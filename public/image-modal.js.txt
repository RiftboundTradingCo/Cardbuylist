document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const closeBtn = document.getElementById("imageModalClose");

  if (!modal || !modalImg) return;

  function open(src, alt) {
    modalImg.src = src;
    modalImg.alt = alt || "Card image enlarged";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function close() {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    modalImg.src = "";
    document.body.style.overflow = "";
  }

  if (closeBtn) closeBtn.addEventListener("click", close);

  // click outside image closes
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  // ESC closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // ✅ DELEGATED click: works for dynamically rendered cards
  document.addEventListener("click", (e) => {
    // add data-zoom="1" on any img you want clickable
    const img = e.target.closest('img[data-zoom="1"]');
    if (!img) return;

    const src = img.getAttribute("src");
    if (!src) return;

    open(src, img.getAttribute("alt") || "");
  });
});
