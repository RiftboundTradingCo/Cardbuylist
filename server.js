require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const Stripe = require("stripe");
const { Resend } = require("resend");

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// -----------------------------
// Helpers: read/write JSON files
// -----------------------------
function readJson(filename, fallback) {
  try {
    const full = path.join(__dirname, filename);
    if (!fs.existsSync(full)) return fallback;
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function writeJson(filename, data) {
  const full = path.join(__dirname, filename);
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

// -----------------------------
// STRIPE WEBHOOK (must be FIRST)
// -----------------------------
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;

    try {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      // We fulfill on successful Checkout payment
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const orderId = session?.metadata?.orderId;
        if (!orderId) throw new Error("Missing orderId in Stripe session metadata");

        const orders = readJson("orders.json", {});
        const catalog = readJson("catalog.json", {});

        const order = orders[orderId];
        if (!order) throw new Error("Order not found: " + orderId);

        // Idempotency: if already processed, just ACK.
        if (order.status === "paid") {
          return res.json({ received: true });
        }

        // Confirm inventory exists before decrement
        for (const item of order.items) {
          const p = catalog[item.sku];
          if (!p) throw new Error("Unknown SKU in order: " + item.sku);
          if ((p.stock ?? 0) < item.qty) {
            // In real stores you might refund here, but for v1 we error
            throw new Error(`Insufficient stock for ${p.name}`);
          }
        }

        // Decrement inventory
        for (const item of order.items) {
          catalog[item.sku].stock -= item.qty;
        }
        writeJson("catalog.json", catalog);

        // Mark order paid + store useful Stripe fields
        order.status = "paid";
        order.stripeSessionId = session.id;
        order.paidAt = new Date().toISOString();
        order.customerEmail =
          session.customer_details?.email ||
          session.customer_email ||
          order.customerEmail ||
          "";
shipping_address_collection: {
  allowed_countries: ["US"]
},

        orders[orderId] = order;
        writeJson("orders.json", orders);

        // Send emails: receipt to customer, notification to owner
        await sendOrderEmails({ order, catalog });
      }

      // Always ACK to Stripe
      res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err);
      // Stripe will retry if we 500
      res.status(500).send("Webhook handler failed");
    }
  }
);

// -----------------------------
// NORMAL MIDDLEWARE (after webhook)
// -----------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname))); // serve index.html, buy.html, js, css, images

app.get("/health", (req, res) => res.send("OK"));

// -----------------------------
// API: Catalog (server source of truth)
// -----------------------------
app.get("/api/catalog", (req, res) => {
  const catalog = readJson("catalog.json", {});
  res.json({ ok: true, catalog });
});

// -----------------------------
// API: Create Stripe Checkout Session (server-side pricing)
// cart format from browser: [{ sku, qty }]
// -----------------------------
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { cart, customerEmail } = req.body;

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ ok: false, error: "Cart is empty." });
    }

    const catalog = readJson("catalog.json", {});
    const normalized = cart
      .map((i) => ({
        sku: String(i.sku || "").trim(),
        qty: Math.max(1, Math.min(999, Number(i.qty) || 1)),
      }))
      .filter((i) => i.sku);

    if (normalized.length === 0) {
      return res.status(400).json({ ok: false, error: "Invalid cart." });
    }

    // Validate SKUs + stock BEFORE creating session
    for (const item of normalized) {
      const p = catalog[item.sku];
      if (!p) {
        return res.status(400).json({ ok: false, error: `Unknown SKU: ${item.sku}` });
      }
      if ((p.stock ?? 0) < item.qty) {
        return res.status(400).json({ ok: false, error: `Out of stock: ${p.name}` });
      }
      if (!Number.isFinite(p.price_cents) || p.price_cents < 0) {
        return res.status(500).json({ ok: false, error: `Invalid price for: ${p.name}` });
      }
    }

    // Create internal order (pending)
    const orders = readJson("orders.json", {});
    const orderId =
      "ord_" + Date.now() + "_" + Math.random().toString(16).slice(2, 8);

    const subtotalCents = normalized.reduce(
      (sum, i) => sum + catalog[i.sku].price_cents * i.qty,
      0
    );

    orders[orderId] = {
      id: orderId,
      status: "pending",
      items: normalized, // [{ sku, qty }]
      subtotal_cents: subtotalCents,
      createdAt: new Date().toISOString(),
      customerEmail: String(customerEmail || "").trim(),
    };
    writeJson("orders.json", orders);

    const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

    // Build Stripe line items from SERVER catalog
    const line_items = normalized.map((item) => {
      const p = catalog[item.sku];
      return {
        quantity: item.qty,
        price_data: {
          currency: "usd",
          unit_amount: p.price_cents,
          product_data: {
            name: p.name,
            images: p.image
              ? [new URL(p.image, baseUrl).toString()]
              : undefined,
          },
        },
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: orders[orderId].customerEmail || undefined,
      success_url: `${baseUrl}/buy-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/buy-cart.html`,
      metadata: { orderId },
    });

    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("Create checkout session error:", err);
    res.status(500).json({ ok: false, error: "Could not create checkout session." });
  }
});

// -----------------------------
// API: Sell order email (your buylist "sell to us" flow)
// -----------------------------
app.post("/api/submit", async (req, res) => {
  try {
    const { name, email, total, order } = req.body;

    if (!name || !email || !Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing fields or empty order." });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: "RESEND_API_KEY not set." });
    }
    if (!process.env.TO_EMAIL) {
      return res.status(500).json({ ok: false, error: "TO_EMAIL not set." });
    }

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

    const from = process.env.FROM_EMAIL || "Buylist <onboarding@resend.dev>";

    await resend.emails.send({
      from,
      to: process.env.TO_EMAIL,
      reply_to: email,
      subject: `New Sell Order from ${name}`,
      text: emailText,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("SELL EMAIL ERROR:", err);
    res.status(500).json({ ok: false, error: "Email failed to send." });
  }
});

// -----------------------------
// Email helpers for paid orders
// -----------------------------
async function sendOrderEmails({ order, catalog }) {
  const from = process.env.FROM_EMAIL || "Orders <onboarding@resend.dev>";
  const owner = process.env.OWNER_EMAIL;

  const lines = order.items.map((i) => {
    const p = catalog[i.sku];
    const lineCents = p.price_cents * i.qty;
    return `${i.qty}x ${p.name} — $${(p.price_cents / 100).toFixed(2)} = $${(lineCents / 100).toFixed(2)}`;
  });

  const subtotal = (order.subtotal_cents / 100).toFixed(2);

  const receiptText =
`Thanks for your order!

Order ID: ${order.id}

Items:
${lines.join("\n")}

Subtotal: $${subtotal}

We’ll follow up with shipping updates soon.
`;

  // Customer receipt
  if (order.customerEmail) {
    await resend.emails.send({
      from,
      to: order.customerEmail,
      subject: `Your receipt (${order.id})`,
      text: receiptText,
    });
  }

  // Owner notification
  if (owner) {
    await resend.emails.send({
      from,
      to: owner,
      subject: `New paid order: ${order.id}`,
      text:
`PAID ORDER

Order ID: ${order.id}
Customer: ${order.customerEmail || "(no email collected)"}

Items:
${lines.join("\n")}

Subtotal: $${subtotal}
`,
    });
  }
}

// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));









