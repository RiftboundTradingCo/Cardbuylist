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
    const { name, email, cards, total } = req.body;

    if (!name || !email || !cards) {
      return res.status(400).json({ ok: false, error: "Missing fields." });
    }
    if (!process.env.TO_EMAIL) {
      return res.status(500).json({ ok: false, error: "TO_EMAIL not set on server." });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: "RESEND_API_KEY not set on server." });
    }

    await resend.emails.send({
      from: "Buylist <onboarding@resend.dev>",
      to: process.env.TO_EMAIL,
      reply_to: email,
      subject: `New Sell Order from ${name}`,
      text:
`New sell order received:

Name: ${name}
Seller Email: ${email}
Total: $${total}

Cards:
${cards}
`
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


