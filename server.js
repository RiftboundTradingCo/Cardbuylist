require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const Stripe = require("stripe");
const { Resend } = require("resend");

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);


function loadJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error("Failed to read JSON:", filePath, e);
    return {};
  }
}

app.get("/api/selllist", (req, res) => {
  const sellPath = path.join(__dirname, "selllist.json");
  const selllist = loadJsonSafe(sellPath);
  res.json({ ok: true, selllist });
});

// -----------------------------
// Condition pricing (edit these)
// -----------------------------
const CONDITION_MULT = {
  "Near Mint": 1.0,
  "Lightly Played": 0.9,
  "Moderately Played": 0.8,
  "Heavily Played": 0.65
};

function normalizeCondition(c) {
  const s = String(c || "Near Mint").trim();
  return CONDITION_MULT[s] ? s : "Near Mint";
}

function centsForCondition(baseCents, condition) {
  const mult = CONDITION_MULT[normalizeCondition(condition)] ?? 1.0;
  return Math.round(Number(baseCents || 0) * mult);
}

// -----------------------------
// Helpers
// -----------------------------
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

function moneyFromCents(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function formatAddress(addr) {
  if (!addr) return "(no address collected)";
  const lines = [];
  if (addr.line1) lines.push(addr.line1);
  if (addr.line2) lines.push(addr.line2);

  const cityState = [addr.city, addr.state].filter(Boolean).join(", ");
  const postal = addr.postal_code ? String(addr.postal_code) : "";
  const cityLine = [cityState, postal].filter(Boolean).join(" ");
  if (cityLine) lines.push(cityLine);

  if (addr.country) lines.push(addr.country);

  return lines.join("\n") || "(no address collected)";
}

// ----------------------------------------------------
// STRIPE WEBHOOK (must be FIRST, before express.json())
// ----------------------------------------------------
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    console.log("==== STRIPE WEBHOOK HIT ====");
    console.log("Time:", new Date().toISOString());
    console.log(
      "Signature header present:",
      Boolean(req.headers["stripe-signature"])
    );

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

    console.log("Stripe event:", event.type, "id:", event.id);

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const orderId = session?.metadata?.orderId;

        console.log(
          "Checkout completed. Session:",
          session.id,
          "orderId:",
          orderId
        );

        if (!orderId) throw new Error("Missing orderId in Stripe session metadata");

        const orders = readJson("orders.json", {});
        const catalog = readJson("catalog.json", {});
        const order = orders[orderId];

        if (!order) throw new Error("Order not found: " + orderId);

        // Idempotency
        if (order.status === "paid") {
          console.log("Order already paid, skipping:", orderId);
          res.set("X-Riftbound-Webhook", "onrender-v1");
          return res.json({ received: true });
        }

        // Retrieve full session for address/email reliability
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ["line_items"]
        });

        const customerEmail =
          fullSession.customer_details?.email ||
          fullSession.customer_email ||
          order.customerEmail ||
          "";

        const customerPhone = fullSession.customer_details?.phone || "";

        const shippingAddr =
          fullSession.shipping_details?.address ||
          fullSession.customer_details?.address ||
          null;

        // Verify stock by SKU across all conditions (sum quantities)
        const qtyBySku = {};
        for (const item of order.items) {
          qtyBySku[item.sku] = (qtyBySku[item.sku] || 0) + item.qty;
        }

        for (const [sku, totalQty] of Object.entries(qtyBySku)) {
          const p = catalog[sku];
          if (!p) throw new Error("Unknown SKU in order: " + sku);
          if ((p.stock ?? 0) < totalQty) {
            throw new Error(`Insufficient stock for ${p.name}`);
          }
        }

        // Decrement stock by SKU totals
        for (const [sku, totalQty] of Object.entries(qtyBySku)) {
          catalog[sku].stock -= totalQty;
        }
        writeJson("catalog.json", catalog);

        // Mark paid
        order.status = "paid";
        order.stripeSessionId = fullSession.id;
        order.paidAt = new Date().toISOString();
        order.customerEmail = customerEmail;
        order.customerPhone = customerPhone;
        order.shippingAddress = shippingAddr;

        orders[orderId] = order;
        writeJson("orders.json", orders);

        console.log("About to send emails. customerEmail:", order.customerEmail);
        console.log("OWNER_EMAIL env present:", Boolean(process.env.OWNER_EMAIL));
        console.log("FROM_EMAIL:", process.env.FROM_EMAIL || "(default onboarding@resend.dev)");

        await sendPaidOrderEmails({ order, catalog });

        console.log("Fulfilled order:", orderId);
      }

      res.set("X-Riftbound-Webhook", "onrender-v1");
      res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err);
      res.status(500).send("Webhook handler failed");
    }
  }
);

// -----------------------------
// Normal middleware (AFTER webhook)
// -----------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get("/health", (req, res) => res.send("OK"));

// -----------------------------
// API: Catalog
// -----------------------------
app.get("/api/catalog", (req, res) => {
  const catalog = readJson("catalog.json", {});
  res.json({ ok: true, catalog });
});

// ----------------------------------------------------
// API: Create Stripe Checkout Session (server-side prices)
// Body: { cart: [{ sku, qty, condition }], customerEmail? }
// ----------------------------------------------------
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
        condition: normalizeCondition(i.condition)
      }))
      .filter((i) => i.sku);

    if (normalized.length === 0) {
      return res.status(400).json({ ok: false, error: "Invalid cart." });
    }

    // Stock check by SKU totals (across all conditions)
    const qtyBySku = {};
    for (const item of normalized) {
      qtyBySku[item.sku] = (qtyBySku[item.sku] || 0) + item.qty;
    }

    for (const [sku, totalQty] of Object.entries(qtyBySku)) {
      const p = catalog[sku];
      if (!p) return res.status(400).json({ ok: false, error: `Unknown SKU: ${sku}` });
      if ((p.stock ?? 0) < totalQty) return res.status(400).json({ ok: false, error: `Out of stock: ${p.name}` });
      if (!Number.isFinite(p.price_cents) || p.price_cents < 0) return res.status(500).json({ ok: false, error: `Invalid price for: ${p.name}` });
    }

    // Create internal order (pending)
    const orders = readJson("orders.json", {});
    const orderId = "ord_" + Date.now() + "_" + Math.random().toString(16).slice(2, 8);

    const subtotalCents = normalized.reduce((sum, i) => {
      const p = catalog[i.sku];
      const unit = centsForCondition(p.price_cents, i.condition);
      return sum + unit * i.qty;
    }, 0);

    orders[orderId] = {
      id: orderId,
      status: "pending",
      items: normalized, // [{sku, qty, condition}]
      subtotal_cents: subtotalCents,
      createdAt: new Date().toISOString(),
      customerEmail: String(customerEmail || "").trim()
    };
    writeJson("orders.json", orders);

    const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

    // Stripe line items (LOCKED server-side amounts)
    const line_items = normalized.map((item) => {
      const p = catalog[item.sku];
      const unitAmount = centsForCondition(p.price_cents, item.condition);

      return {
        quantity: item.qty,
        price_data: {
          currency: "usd",
          unit_amount: unitAmount,
          product_data: {
            name: `${p.name} (${item.condition})`,
            images: p.image ? [new URL(p.image, baseUrl).toString()] : undefined
          }
        }
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: orders[orderId].customerEmail || undefined,

      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },

      success_url: `${baseUrl}/buy-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/buy-cart.html`,

      metadata: { orderId }
    });

    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("Create checkout session error:", err);
    const stripeMsg = err?.raw?.message || err?.message || "Could not create checkout session.";
    res.status(500).json({ ok: false, error: stripeMsg });
  }
});

// ----------------------------------------------------
// API: Sell order email (sell-to-us flow)
// Body: { name, email, total, order: [{name, condition, qty, unitPrice}] }
// ----------------------------------------------------
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
      text: emailText
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
async function sendPaidOrderEmails({ order, catalog }) {
  const from = process.env.FROM_EMAIL || "Orders <onboarding@resend.dev>";
  const owner = process.env.OWNER_EMAIL;

  const lines = order.items.map((i) => {
    const p = catalog[i.sku];
    const cond = normalizeCondition(i.condition);
    const unit = centsForCondition(p.price_cents, cond);
    const lineCents = unit * i.qty;
    return `${i.qty}x ${p.name} (${cond}) — $${moneyFromCents(unit)} = $${moneyFromCents(lineCents)}`;
  });

  const subtotal = moneyFromCents(order.subtotal_cents);
  const shipTo = formatAddress(order.shippingAddress);
  const phoneLine = order.customerPhone ? `Phone: ${order.customerPhone}\n\n` : "";

  const receiptText =
`Thanks for your order!

Order ID: ${order.id}

Items:
${lines.join("\n")}

Subtotal: $${subtotal}

Shipping to:
${shipTo}

We’ll follow up with shipping updates soon.
`;

  // Customer receipt
  if (order.customerEmail) {
    console.log("Attempting customer receipt email to:", order.customerEmail);
    try {
      const result = await resend.emails.send({
        from,
        to: order.customerEmail,
        subject: `Your receipt (${order.id})`,
        text: receiptText
      });
      console.log("Customer receipt sent ✅ Resend id:", result?.data?.id);
    } catch (e) {
      console.error("Resend customer email FAILED:", e);
    }
  } else {
    console.log("No customer email collected; skipping customer receipt.");
  }

  // Owner notification (what you use to ship)
  if (owner) {
    console.log("Attempting owner order email to:", owner);
    try {
      const result = await resend.emails.send({
        from,
        to: owner,
        subject: `PAID ORDER: ${order.id}`,
        text:
`PAID ORDER ✅

Order ID: ${order.id}
Customer: ${order.customerEmail || "(no email collected)"}

${phoneLine}Shipping address:
${shipTo}

Items:
${lines.join("\n")}

Subtotal: $${subtotal}
`
      });
      console.log("Owner order email sent ✅ Resend id:", result?.data?.id);
    } catch (e) {
      console.error("Resend owner email FAILED:", e);
    }
  } else {
    console.log("OWNER_EMAIL not set; skipping owner notification email.");
  }
}

// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));





