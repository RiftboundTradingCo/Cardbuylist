
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

  function normalizeImgPath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    return s.startsWith("/") ? s : "/" + s;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toInt(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  let ALL = [];
  let q = "";

  async function load() {
    showMsg("");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td style="padding:12px;" colspan="10">Loading…</td></tr>`;

    let res, data;
    try {
      res = await fetch("/api/admin/inventory", { cache: "no-store" });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      tbody.innerHTML = "";
      showMsg("Network error loading inventory", false);
      return;
    }

    if (!res.ok || !data?.ok) {
      tbody.innerHTML = "";
      showMsg(data?.error || `Load failed (HTTP ${res.status})`, false);
      return;
    }

    // Your API might return { rows: [...] } or { items: [...] }
    ALL = Array.isArray(data.rows)
      ? data.rows
      : Array.isArray(data.items)
      ? data.items
      : [];

    render();
  }

  function render() {
    if (!tbody) return;

    const needle = q.trim().toLowerCase();
    const items = needle
      ? ALL.filter((it) => {
          const s = `${it.sku} ${it.name} ${it.set_code || ""} ${it.card_number || ""} ${
            it.rarity || ""
          }`.toLowerCase();
          return s.includes(needle);
        })
      : ALL;

    tbody.innerHTML = "";

    if (!items.length) {
      tbody.innerHTML = `<tr><td style="padding:12px;" colspan="10">No inventory found.</td></tr>`;
      return;
    }

    for (const it of items) {
      const tr = document.createElement("tr");
      tr.dataset.sku = String(it.sku || "").trim();

      tr.innerHTML = `
        <td style="padding:10px;">
          ${
            it.image
              ? `<img src="${encodeURI(normalizeImgPath(it.image))}" style="width:44px;height:62px;object-fit:cover;border-radius:8px;border:1px solid rgba(0,0,0,.15);" />`
              : ""
          }
        </td>

        <td style="padding:10px; font-weight:800;">${escapeHtml(it.sku)}</td>

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
              .map(
                (r) =>
                  `<option value="${r}" ${
                    String(it.rarity || "") === r ? "selected" : ""
                  }>${r || "—"}</option>`
              )
              .join("")}
          </select>
        </td>

        <td style="padding:10px; text-align:center;">
          <input class="f-foil" type="checkbox" ${it.foil ? "checked" : ""} />
        </td>

        <td style="padding:10px;">
          <input class="f-price" type="number" min="0" step="1"
            value="${toInt(it.price_cents, 0)}" style="width:120px;" />
        </td>

        <td style="padding:10px;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <input class="f-stock-nm" type="number" min="0" step="1"
              value="${toInt(it.stock_nm, 0)}" style="width:70px;" placeholder="NM" title="Stock NM" />
            <input class="f-stock-lp" type="number" min="0" step="1"
              value="${toInt(it.stock_lp, 0)}" style="width:70px;" placeholder="LP" title="Stock LP" />
            <input class="f-stock-mp" type="number" min="0" step="1"
              value="${toInt(it.stock_mp, 0)}" style="width:70px;" placeholder="MP" title="Stock MP" />
            <input class="f-stock-hp" type="number" min="0" step="1"
              value="${toInt(it.stock_hp, 0)}" style="width:70px;" placeholder="HP" title="Stock HP" />
          </div>
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
      price_cents: toInt(tr.querySelector(".f-price")?.value ?? 0, 0),

      stock_nm: toInt(tr.querySelector(".f-stock-nm")?.value ?? 0, 0),
      stock_lp: toInt(tr.querySelector(".f-stock-lp")?.value ?? 0, 0),
      stock_mp: toInt(tr.querySelector(".f-stock-mp")?.value ?? 0, 0),
      stock_hp: toInt(tr.querySelector(".f-stock-hp")?.value ?? 0, 0),
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

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Save failed (HTTP ${res.status})`);

      showMsg(`Saved ${sku}`);
      const idx = ALL.findIndex((x) => String(x.sku || "") === String(sku));
      if (idx >= 0 && j.item) ALL[idx] = j.item;
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
});
