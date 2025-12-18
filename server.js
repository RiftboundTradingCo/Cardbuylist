require("dotenv").config();
console.log("Starting server...");

const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());
app.use(express.static("."));

// health check
app.get("/health", (req, res) => {
  res.send("OK");
});

// SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true", // false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  requireTLS: true,
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 20000
});


// submit endpoint
app.post("/api/submit", async (req, res) => {
  try {
    const { name, email, cards, total } = req.body;

    if (!name || !email || !cards) {
      return res.status(400).json({ ok: false, error: "Missing fields." });
    }

    await transporter.sendMail({
      from: `"Buylist Website" <${process.env.SMTP_USER}>`,
      to: process.env.TO_EMAIL,
      subject: `New Sell Order from ${name}`,
      text:
`New sell order received:

Name: ${name}
Email: ${email}
Total: $${total}

Cards:
${cards}
`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Email failed to send." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});

