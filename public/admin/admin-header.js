async function injectAdminHeader() {
  const host = document.getElementById("adminHeader");
  if (!host) return;
  const res = await fetch("/admin/_admin-header.html", { cache: "no-store" });
  host.innerHTML = await res.text();
}
document.addEventListener("DOMContentLoaded", injectAdminHeader);
