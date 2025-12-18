require("dotenv").config();
console.log("Starting server...");

const express = require("express");
const { Resend } = require("resend");

const app = express();
app.use(express.json());
app.use(express.static("."));

app.get("/health", (req, res) => res.send("OK"));

const resend = new Resend(process.env.RESEND_API_KEY);

app.post("/api/submit", async (req, res) => {
  try {
    const { name, email, total, order } = req.body;

    if (!name || !email || !Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing fields or empty order." });
    }

    // Build a clean breakdown
    let computedTotal = 0;
    const lines = order.map((l) => {
      const qty = Number(l.qty) || 0;
      const unitPrice = Number(l.unitPrice) || 0;
      const condition = String(l.condition || "");
      const cardName = String(l.name || "");
      const lineTotal = qty * unitPrice;

      computedTotal += lineTotal;

      return `${qty}x ${cardName} (${condition}) @ $${unitPrice.toFixed(2)} = $${lineTotal.toFixed(2)}`;
    });

    const emailText =
`New sell order received:

Name: ${name}
Seller Email: ${email}

Cards:
${lines.join("\n")}

Total (computed): $${computedTotal.toFixed(2)}
Total (client): $${Number(total || 0).toFixed(2)}
`;

    await resend.emails.send({
      from: "Buylist <onboarding@resend.dev>",
      to: process.env.TO_EMAIL,
      reply_to: email,
      subject: `New Sell Order from ${name}`,
      text: emailText
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("EMAIL ERROR:", err);
    res.status(500).json({ ok: false, error: "Email failed to send." });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});



