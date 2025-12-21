require("dotenv").config();
console.log("Starting server...");

const express = require("express");
const { Resend } = require("resend");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);


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
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { cart } = req.body; // [{ name, price, qty, image }]

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ ok: false, error: "Cart is empty." });
    }

    // IMPORTANT: never trust prices from the browser in production.
    // For now, we’ll accept them (easy). Later, we’ll look up prices server-side.

    const line_items = cart.map((item) => {
      const name = String(item.name || "Item");
      const qty = Math.max(1, Math.min(999, Number(item.qty) || 1));
      const unitAmountCents = Math.round(Number(item.price) * 100);

      if (!Number.isFinite(unitAmountCents) || unitAmountCents < 0) {
        throw new Error("Invalid price for item: " + name);
      }

      return {
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: unitAmountCents,
          product_data: {
            name,
            images: item.image ? [new URL(item.image, process.env.PUBLIC_BASE_URL).toString()] : undefined
          }
        }
      };
    });

    const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${baseUrl}/buy-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/buy-cart.html`
    });

    // Stripe returns a hosted Checkout URL
    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("STRIPE ERROR:", err);
    res.status(500).json({ ok: false, error: "Could not create checkout session." });
  }
});





