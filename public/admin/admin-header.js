(async function () {
  const headerEl = document.getElementById("adminHeader");
  const nextUrl = encodeURIComponent(location.pathname + location.search);

  // 1) Must be admin, or redirect to admin login
  const adminRes = await fetch("/api/admin/me", { cache: "no-store" });
  if (!adminRes.ok) {
    location.href = `/admin/login?next=${nextUrl}`;
    return;
  }

  // 2) Inject shared header
  if (headerEl) {
    const h = await fetch("/admin/_admin-header.html", { cache: "no-store" });
    if (h.ok) headerEl.innerHTML = await h.text();
  }

  // 3) Highlight current link
  const here = (location.pathname.replace(/\/+$/, "") || "/admin");
  document.querySelectorAll(".navlink[data-path]").forEach((a) => {
    const p = (a.getAttribute("data-path") || "").replace(/\/+$/, "");
    if (p === here) a.classList.add("active");
  });

  // 4) Logout button
  const logoutBtn = document.getElementById("adminLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } finally {
        location.href = "/admin/login";
      }
    });
  }

  // 5) Show who is logged in
  try {
    const meRes = await fetch("/api/me", { cache: "no-store" });
    const me = await meRes.json().catch(() => ({}));
    const whoEl = document.getElementById("adminWho");
    if (whoEl && me?.ok && me?.user?.email) {
      whoEl.style.display = "inline";
      whoEl.textContent = `Signed in as ${me.user.email}`;
    }
  } catch {}
})();
