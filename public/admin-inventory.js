document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("adminTbody");
  const msgEl = document.getElementById("adminMsg");
  const searchEl = document.getElementById("adminSearch");
  const reloadBtn = document.getElementById("adminReload");

  function showMsg(t, ok = true) {
    if (!msgEl) return;
    msgEl.textContent = t || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }

  function moneyImg(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    return s.startsWith("/") ? s : "/" + s;
  }

  let ALL = [];
  let q = "";

  async function load() {
    showMsg("");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td style="padding:12px;" colspan="10">Loading…</td></tr>`;

    const res = await fetch("/api/admin/inventory", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      tbody.innerHTML = "";
      showMsg(data?.error || `Load failed (HTTP ${res.status})`, false);
      return;
    }

    ALL = Array.isArray(data.items) ? data.items : [];
    render();
  }

  function render() {
    const needle = q.trim().toLowerCase();
    const items = !needle
      ? ALL
      : ALL.filter((it) => {
          const s =
            `${it.sku} ${it.name} ${it.set_code || ""} ${it.card_number || ""} ${it.rarity || ""}`.toLowerCase();
          return s.includes(needle);
        });

    tbody.innerHTML = "";

    for (const it of items) {
      const tr = document.createElement("tr");
      tr.dataset.sku = it.sku;

      tr.innerHTML = `
        <td style="padding:10px;">
          ${it.image ? `<img src="${encodeURI(moneyImg(it.image))}" style="width:44px;height:62px;object-fit:cover;border-radius:8px;border:1px solid rgba(0,0,0,.15);" />` : ""}
        </td>
        <td style="padding:10px; font-weight:800;">${it.sku}</td>

        <td style="padding:10px;">
          <input class="f-name" value="${escapeHtml(it.name || "")}" style="width:260px;" />
        </td>

        <td style="padding:10px;">
          <input class="f-set" value="${escapeHtml(it.set_code || "")}" style="width:90px;" />
        </td>

        <td style="padding:10px;">
          <input class="f-num" value="${escapeHtml(it.card_number || "")}" style="width:80px;" />
        </td>

        <td style="padding:10px;">
          <select class="f-rarity" style="width:120px;">
            ${["", "Common", "Uncommon", "Rare", "Epic", "Showcase"]
              .map((r) => `<option value="${r}" ${String(it.rarity || "") === r ? "selected" : ""}>${r || "—"}</option>`)
              .join("")}
          </select>
        </td>

        <td style="padding:10px;">
          <input class="f-foil" type="checkbox" ${it.foil ? "checked" : ""} />
        </td>

        <td style="padding:10px;">
          <input class="f-price" type="number" min="0" step="1" value="${Number(it.price_cents || 0)}" style="width:120px;" />
        </td>

        <td style="padding:10px;">
          <input class="f-stock" type="number" min="0" step="1" value="${Number(it.stock || 0)}" style="width:90px;" />
        </td>

        <td style="padding:10px;">
          <button class="saveBtn cart-primary" type="button" style="padding:8px 12px;">Save</button>
        </td>
      `;

      tbody.appendChild(tr);
    }
  }

  // Save click (event delegation)
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".saveBtn");
    if (!btn) return;

    const tr = btn.closest("tr");
    const sku = tr?.dataset?.sku;
    if (!sku) return;

    const payload = {
      name: tr.querySelector(".f-name")?.value ?? "",
      set_code: tr.querySelector(".f-set")?.value ?? "",
      card_number: tr.querySelector(".f-num")?.value ?? "",
      rarity: tr.querySelector(".f-rarity")?.value ?? "",
      foil: !!tr.querySelector(".f-foil")?.checked,
      price_cents: Number(tr.querySelector(".f-price")?.value ?? 0),
      stock: Number(tr.querySelector(".f-stock")?.value ?? 0),
    };

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Saving…";

    try {
      const res = await fetch(`/api/admin/inventory/${encodeURIComponent(sku)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Save failed (HTTP ${res.status})`);

      showMsg(`Saved ${sku}`);
      // update local cache row
      const idx = ALL.findIndex((x) => x.sku === sku);
      if (idx >= 0) ALL[idx] = data.item;
    } catch (err) {
      console.error(err);
      showMsg(String(err.message || "Save failed"), false);
    } finally {
      btn.disabled = false;
      btn.textContent = prev || "Save";
    }
  });

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      q = searchEl.value || "";
      render();
    });
  }

  if (reloadBtn) reloadBtn.addEventListener("click", load);

  await load();

  // tiny helper
  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
});
