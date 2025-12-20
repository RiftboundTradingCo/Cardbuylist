document.addEventListener("DOMContentLoaded", function () {
  const recapBox = document.getElementById("recapBox");

  const raw = sessionStorage.getItem("sellOrderRecap");
  if (!raw) {
    recapBox.innerHTML = "<p><strong>No recap found.</strong> Please submit a sell order first.</p>";
    return;
  }

  const data = JSON.parse(raw);
  const { name, email, order, computedTotal } = data;

  // Build lines in the same format as the email
  const lines = order.map(l => {
    const qty = Number(l.qty) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    const lineTotal = qty * unitPrice;
    return `
      <tr>
        <td>${qty}x</td>
        <td>${escapeHtml(l.name)}</td>
        <td>${escapeHtml(l.condition)}</td>
        <td>$${unitPrice.toFixed(2)}</td>
        <td>$${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join("");

  recapBox.innerHTML = `
    <div class="recap-card">
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>

      <h2>Cards</h2>
      <table class="recap-table">
        <thead>
          <tr>
            <th>Qty</th>
            <th>Card</th>
            <th>Cond</th>
            <th>Unit</th>
            <th>Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${lines}
        </tbody>
      </table>

      <p class="recap-total"><strong>Total:</strong> $${Number(computedTotal).toFixed(2)}</p>
    </div>
  `;

  // Optional: clear it so refresh doesn’t keep old orders forever
  // sessionStorage.removeItem("sellOrderRecap");
});

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
