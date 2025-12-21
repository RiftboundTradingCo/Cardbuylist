require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const Stripe = require("stripe");
const { Resend } = require("resend");

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// 1) Webhook route FIRST with raw body
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // We stored an orderId in metadata when creating the session
      const orderId = session.metadata?.orderId;
      if (!orderId) throw new Error("Missing orderId in session metadata");

      // Load order + catalog, fulfill
      const orders = readJson("orders.json", {});
      const catalog = readJson("catalog.json", {});

      const order = orders[orderId];
      if (!order) throw new Error("Order not found: " + orderId);

      // idempotency: if already paid, do nothing
      if (order.status === "paid") {
        return res.json({ received: true });
      }

      // decrement inventory
      for (const item of order.items) {
        const sku = item.sku;
        const qty = item.qty;

        if (!catalog[sku]) throw new Error("Unknown SKU in order: " + sku);
        if (catalog[sku].stock < qty) {
          // In real life, you might refund or partially fulfill.
          throw new Error(`Insufficient stock for ${sku}`);
        }
      }

      for (const item of order.items) {
        catalog[item.sku].stock -= item.qty;
      }

      // mark paid + store Stripe info
      order.status = "paid";
      order.stripeSessionId = session.id;
      order.customerEmail = session.customer_details?.email || session.customer_email || order.customerEmail || "";
      order.paidAt = new Date().toISOString();

      writeJson("catalog.json", catalog);
      orders[orderId] = order;
      writeJson("orders.json", orders);

      // send emails (receipt to customer + notification to you)
      await sendReceiptEmails({ order, catalog });

      return res.json({ received: true });
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).send("Webhook handler failed");
  }
});

// 2) Normal JSON middleware AFTER webhook
app.use(express.json());
app.use(express.static("."));

app.get("/health", (req, res) => res.send("OK"));

// Serve catalog for frontend rendering (optional but helpful)
app.get("/api/catalog", (req, res) => {
  const catalog = readJson("catalog.json", {});
  res.json({ ok: true, catalog });
});

// Create checkout session (SERVER-SIDE pricing + stock check)
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { cart, customerEmail } = req.body; // cart = [{ sku, qty }]
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ ok: false, error: "Cart is empty." });
    }

    const catalog = readJson("catalog.json", {});
    const normalized = cart.map(i => ({
      sku: String(i.sku || "").trim(),
      qty: Math.max(1, Math.min(999, Number(i.qty) || 1))
    })).filter(i => i.sku);

    if (normalized.length === 0) {
      return res.status(400).json({ ok: false, error: "Invalid cart." });
    }

    // Validate SKUs + stock
    for (const item of normalized) {
      const p = catalog[item.sku];
      if (!p) return res.status(400).json({ ok: false, error: `Unknown item: ${item.sku}` });
      if (p.stock < item.qty) return res.status(400).json({ ok: false, error: `Out of stock: ${p.name}` });
    }

    // Create an internal order (pending)
    const orders = readJson("orders.json", {});
    const orderId = "ord_" + Date.now() + "_" + Math.random().toString(16).slice(2, 8);

    // Build Stripe line_items from server catalog
    const line_items = normalized.map(item => {
      const p = catalog[item.sku];
      return {
        quantity: item.qty,
        price_data: {
          currency: "usd",
          unit_amount: p.price_cents,
          product_data: {
            name: p.name,
            images: p.image ? [new URL(p.image, process.env.PUBLIC_BASE_URL).toString()] : undefined
          }
        }
      };
    });

    const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: customerEmail || undefined,
      success_url: `${baseUrl}/buy-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/buy-cart.html`,
      metadata: { orderId }
    });

    // Save pending order
    const subtotalCents = normalized.reduce((sum, i) => sum + (catalog[i.sku].price_cents * i.qty), 0);

    orders[orderId] = {
      id: orderId,
      status: "pending",
      items: normalized,
      subtotal_cents: subtotalCents,
      createdAt: new Date().toISOString(),
      customerEmail: customerEmail || ""
    };

    writeJson("orders.json", orders);

    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("Create checkout session error:", err);
    res.status(500).json({ ok: false, error: "Could not create checkout session." });
  }
});

function readJson(filename, fallback) {
  try {
    const full = path.join(__dirname, filename);
    if (!fs.existsSync(full)) return fallback;
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filename, data) {
  const full = path.join(__dirname, filename);
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

async function sendReceiptEmails({ order, catalog }) {
  const from = process.env.FROM_EMAIL || "Buylist <onboarding@resend.dev>";
  const owner = process.env.OWNER_EMAIL;

  const lines = order.items.map(i => {
    const p = catalog[i.sku];
    const lineCents = p.price_cents * i.qty;
    return `${i.qty}x ${p.name} — $${(p.price_cents / 100).toFixed(2)} = $${(lineCents / 100).toFixed(2)}`;
  });

  const total = (order.subtotal_cents / 100).toFixed(2);

  const receiptText =
`Thanks for your order!

Order ID: ${order.id}

Items:
${lines.join("\n")}

Subtotal: $${total}

We’ll follow up with shipping updates soon.
`;

  // Customer receipt
  if (order.customerEmail) {
    await resend.emails.send({
      from,
      to: order.customerEmail,
      subject: `Your order receipt (${order.id})`,
      text: receiptText
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

Subtotal: $${total}
`
    });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));







