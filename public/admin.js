document.addEventListener("DOMContentLoaded", () => {
  const tokenInput = document.getElementById("adminToken");
  const msgEl = document.getElementById("adminMsg");

  const saveTokenBtn = document.getElementById("saveTokenBtn");
  const clearTokenBtn = document.getElementById("clearTokenBtn");
  const refreshBtn = document.getElementById("refreshBtn");

  const statusFilter = document.getElementById("statusFilter");
  const tbody = document.getElementById("ordersTbody");

  const detailPanel = document.getElementById("detailPanel");
  const detailMeta = document.getElementById("detailMeta");
  const detailLines = document.getElementById("detailLines");
  const detailApproveBtn = document.getElementById("detailApproveBtn");
  const detailMarkFulfilledBtn = document.getElementById("detailMarkFulfilledBtn");
  const collapseDetailBtn = document.getElementById("collapseDetailBtn");

  let ORDERS = [];
  let selectedId = "";

  function showMsg(text, ok=true){
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = ok ? "#1b7f3a" : "#b00020";
  }

  function getToken(){
    return sessionStorage.getItem("ADMIN_TOKEN") || "";
  }

  function setToken(t){
    sessionStorage.setItem("ADMIN_TOKEN", t);
  }

  function clearToken(){
    sessionStorage.removeItem("ADMIN_TOKEN");
  }

  function moneyFromCents(cents){
    return `$${(Number(cents||0)/100).toFixed(2)}`;
  }

  function pillClass(status){
    const s = String(status||"").toLowerCase();
    if (s.includes("paid")) return "pill paid";
    if (s.includes("pending")) return "pill pending";
    if (s.includes("approved")) return "pill approved";
    if (s.includes("fulfilled")) return "pill fulfilled";
    return "pill";
  }

  async function api(path, opts={}){
    const token = getToken();
    const headers = Object.assign({}, opts.headers || {}, {
      "Content-Type": "application/json",
      "x-admin-token": token
    });

    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const msg = data.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function loadOrders(){
    showMsg("");
    const data = await api("/api/admin/orders", { method: "GET" });
    ORDERS = Array.isArray(data.orders) ? data.orders : [];
    renderTable();
    if (selectedId) renderDetails(selectedId);
  }

  function filteredOrders(){
    const f = String(statusFilter?.value || "").trim().toLowerCase();
    if (!f) return ORDERS;
    return ORDERS.filter(o => String(o.status||"").toLowerCase() === f);
  }

  function renderTable(){
    const list = filteredOrders();

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!list.length){
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No orders match the filter.</td></tr>`;
      return;
    }

    for (const o of list){
      const tr = document.createElement("tr");

      const id = o.id || "(no id)";
      const type = o.type || "";
      const status = o.status || "";
      const custName = o.customer?.name || "";
      const custEmail = o.customer?.email || "";
      const created = o.createdAt ? new Date(o.createdAt).toLocaleString() : "";
      const total = Number.isFinite(Number(o.totalCents)) ? moneyFromCents(o.totalCents) : "";

      tr.innerHTML = `
        <td><button class="row-btn" data-view="${id}">${id}</button></td>
        <td>${type}</td>
        <td><span class="${pillClass(status)}">${status}</span></td>
        <td>
          <div><strong>${custName || "(no name)"}</strong></div>
          <div class="muted">${custEmail || "(no email)"}</div>
        </td>
        <td>${total}</td>
        <td class="muted">${created}</td>
        <td>
          <button class="row-btn primary" data-approve="${id}">Approve / Fulfill</button>
          <button class="row-btn" data-fulfill="${id}">Mark Fulfilled</button>
        </td>
      `;

      tbody.appendChild(tr);
    }
  }

  function renderDetails(id){
    const o = ORDERS.find(x => x.id === id);
    selectedId = id;

    if (!detailPanel || !detailMeta || !detailLines) return;
    detailPanel.classList.add("open");

    if (!o){
      detailMeta.textContent = "Order not found.";
      detailLines.innerHTML = "";
      return;
    }

    const created = o.createdAt ? new Date(o.createdAt).toLocaleString() : "";
    detailMeta.innerHTML = `
      <div><strong>${o.id}</strong></div>
      <div class="muted">Type: ${o.type} • Status: ${o.status} • Created: ${created}</div>
      <div class="muted">Customer: ${o.customer?.name || ""} ${o.customer?.email ? `• ${o.customer.email}` : ""}</div>
      <div class="muted">Total: ${moneyFromCents(o.totalCents || 0)}</div>
    `;

    detailLines.innerHTML = "";
    const lines = Array.isArray(o.lines) ? o.lines : [];
    for (const l of lines){
      const li = document.createElement("li");
      li.textContent = `${l.qty}x ${l.sku} — ${l.condition}`;
      detailLines.appendChild(li);
    }
  }

  async function approveOrder(id){
    await api(`/api/admin/orders/${encodeURIComponent(id)}/approve`, { method: "POST" });
    await loadOrders();
    showMsg(`Approved: ${id}`);
  }

  async function markFulfilled(id){
    await api(`/api/admin/orders/${encodeURIComponent(id)}/fulfill`, { method: "POST" });
    await loadOrders();
    showMsg(`Marked fulfilled: ${id}`);
  }

  // ---- events ----
  if (tokenInput){
    const t = getToken();
    if (t) tokenInput.value = t;
  }

  saveTokenBtn?.addEventListener("click", async () => {
    const t = String(tokenInput?.value || "").trim();
    if (!t) { showMsg("Paste your ADMIN_TOKEN first.", false); return; }
    setToken(t);
    showMsg("Token saved for this session.");
    try { await loadOrders(); } catch(e){ showMsg(e.message, false); }
  });

  clearTokenBtn?.addEventListener("click", () => {
    clearToken();
    if (tokenInput) tokenInput.value = "";
    showMsg("Token cleared.");
    ORDERS = [];
    renderTable();
  });

  refreshBtn?.addEventListener("click", async () => {
    try { await loadOrders(); } catch(e){ showMsg(e.message, false); }
  });

  statusFilter?.addEventListener("change", () => renderTable());

  collapseDetailBtn?.addEventListener("click", () => {
    detailPanel?.classList.remove("open");
  });

  document.addEventListener("click", async (e) => {
    const view = e.target.closest("[data-view]")?.getAttribute("data-view");
    if (view){
      renderDetails(view);
      return;
    }

    const approve = e.target.closest("[data-approve]")?.getAttribute("data-approve");
    if (approve){
      try { await approveOrder(approve); renderDetails(approve); }
      catch(err){ showMsg(err.message, false); }
      return;
    }

    const fulfill = e.target.closest("[data-fulfill]")?.getAttribute("data-fulfill");
    if (fulfill){
      try { await markFulfilled(fulfill); renderDetails(fulfill); }
      catch(err){ showMsg(err.message, false); }
      return;
    }
  });

  detailApproveBtn?.addEventListener("click", async () => {
    if (!selectedId) return;
    try { await approveOrder(selectedId); renderDetails(selectedId); }
    catch(err){ showMsg(err.message, false); }
  });

  detailMarkFulfilledBtn?.addEventListener("click", async () => {
    if (!selectedId) return;
    try { await markFulfilled(selectedId); renderDetails(selectedId); }
    catch(err){ showMsg(err.message, false); }
  });

  // auto-load if token exists
  (async () => {
    if (getToken()){
      try { await loadOrders(); }
      catch(e){ showMsg(e.message, false); }
    }
  })();
});
