"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Stripe = require("stripe");
const { Resend } = require("resend");

const app = express();

/* =========================
   ENV
========================= */
const PORT = process.env.PORT || 10000;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "";     // e.g. "Riftbound Trading Co <orders@riftboundtradingco.com>"
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";   // your email to receive notifications
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

if (!STRIPE_SECRET_KEY) console.warn("⚠️ STRIPE_SECRET_KEY not set");
if (!STRIPE_WEBHOOK_SECRET) console.warn("⚠️ STRIPE_WEBHOOK_SECRET not set");
if (!RESEND_API_KEY) console.warn("⚠️ RESEND_API_KEY not set");
if (!EMAIL_FROM) console.warn("⚠️ EMAIL_FROM not set");
if (!OWNER_EMAIL) console.warn("⚠️ OWNER_EMAIL not set");

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/* =========================
   FILE PATHS
========================= */
const CATALOG_PATH = path.join(__dirname, "catalog.json");   // BUY catalog (you sell to customers)
const SELLLIST_PATH = path.join(__dirname, "selllist.json"); // SELL list (you buy from customers)

/* =========================
   HELPERS
========================= */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("Failed to read JSON:", filePath, e);
    return {};
  }
}

function writeJsonSafe(filePath, obj) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("Failed to write JSON:", filePath, e);
    return false;
  }
}

function normalizeCondition(cond) {
  const allowed = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"];
  const s = String(cond || "").trim();
  return allowed.includes(s) ? s : "Near Mint";
}

const CONDITION_MULT = {
  "Near Mint": 1.0,
  "Lightly Played": 0.9,
  "Moderately Played": 0.8,
  "Heavily Played": 0.65
};

function centsForCondition(baseCents, condition) {
  const cond = normalizeCondition(condition);
  const mult = CONDITION_MULT[cond] ?? 1.0;
  return Math.round(Number(baseCents || 0) * mult);
}

function getStockForCondition(product, condition) {
  const cond = normalizeCondition(condition);
  if (product?.stock && typeof product.stock === "object") {
    return Number(product.stock[cond] ?? 0);
  }
  return Number(product?.stock ?? 0);
}

function decrementStock(catalogObj, sku, condition, qty) {
  const cond = normalizeCondition(condition);
  const product = catalogObj[sku];
  if (!product) return { ok: false, error: `Unknown SKU: ${sku}` };

  if (!product.stock || typeof product.stock !== "object") {
    return { ok: false, error: `SKU ${sku} has no condition stock object` };
  }

  const current = Number(product.stock[cond] ?? 0);
  const nQty = Number(qty || 0);

  if (nQty <= 0) return { ok: false, error: "Invalid qty" };
  if (current < nQty) {
    return { ok: false, error: `Insufficient stock for ${sku} (${cond}). Have ${current}, need ${nQty}` };
  }

  product.stock[cond] = current - nQty;
  return { ok: true };
}

function formatMoney(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function makeOrderId() {
  return `ord_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

/* =========================
   STRIPE WEBHOOK (RAW BODY)
========================= */
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      console.log("==== STRIPE WEBHOOK HIT ====");
      console.log("Time:", new Date().toISOString());
      console.log("Signature header present:", Boolean(req.headers["stripe-signature"]));

      if (!stripe) return res.status(500).send("Stripe not configured");

      const sig = req.headers["stripe-signature"];
      let event;

      try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.error("Webhook signature verify failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      console.log("Stripe event:", event.type, "id:", event.id);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const orderId = session?.metadata?.orderId || "unknown";
        console.log("Checkout completed. Session:", session.id, "orderId:", orderId);

        // Cart from metadata
        const cartJson = session?.metadata?.cart || "[]";
        let cart = [];
        try { cart = JSON.parse(cartJson); } catch { cart = []; }

        // Load catalog once (source of truth)
        const catalog = readJsonSafe(CATALOG_PATH);

        // ---- inventory update ----
        let inventoryOk = true;
        let inventoryErr = "";

        for (const item of cart) {
          const sku = String(item.sku || "").trim();
          const cond = normalizeCondition(item.condition);
          const qty = Number(item.qty || 0);

          const r = decrementStock(catalog, sku, cond, qty);
          if (!r.ok) {
            inventoryOk = false;
            inventoryErr = r.error || "Inventory update error";
            break;
          }
        }

        if (inventoryOk) {
          writeJsonSafe(CATALOG_PATH, catalog);
          console.log("✅ Fulfilled order + updated inventory:", orderId);
        } else {
          console.error("❌ Inventory update failed:", inventoryErr);
        }

        // ---- build itemized lines (server-side prices) ----
        const lines = [];
        let computedTotalCents = 0;

        for (const item of cart) {
          const sku = String(item.sku || "").trim();
          const cond = normalizeCondition(item.condition);
          const qty = Math.max(1, Number(item.qty || 0));

          const product = catalog[sku];
          const name = product?.name || sku;

          const baseCents = Number(product?.price_cents || 0);
          const unitCents = centsForCondition(baseCents, cond);
          const lineCents = unitCents * qty;
          computedTotalCents += lineCents;

          lines.push(`${qty}x ${name} — ${cond} — ${formatMoney(unitCents)} each = ${formatMoney(lineCents)}`);
        }

        // ---- customer + shipping info ----
        const emailFromStripe =
          session.customer_details?.email ||
          session.customer_email ||
          "";

        const emailFromMetadata = String(session?.metadata?.email || "").trim();

        const customerEmail = String(emailFromStripe || emailFromMetadata || "").trim();

        console.log("Customer email (stripe):", emailFromStripe || "(none)");
        console.log("Customer email (metadata):", emailFromMetadata || "(none)");
        console.log("Customer email (final):", customerEmail || "(none)");

        const shipName = session.customer_details?.name || "";
        const shipAddress = session.customer_details?.address || null;

        const shipBlock = shipAddress
          ? [
              shipName,
              shipAddress.line1,
              shipAddress.line2,
              `${shipAddress.city || ""}, ${shipAddress.state || ""} ${shipAddress.postal_code || ""}`,
              shipAddress.country || ""
            ].filter(Boolean).join("\n")
          : "(not provided)";

        // ---- email content ----
        const ownerSubject = `New order ${orderId}`;
        const ownerText =
`New order received: ${orderId}

Customer: ${shipName || "(no name)"} <${customerEmail || "no email"}>
Total (computed): ${formatMoney(computedTotalCents)}

Items:
${lines.map(l => `- ${l}`).join("\n")}

Shipping address:
${shipBlock}

Stripe session: ${session.id}
`;

        const customerSubject = `Your Riftbound order receipt (${orderId})`;
        const customerText =
`Thanks for your purchase!

Order: ${orderId}
Total: ${formatMoney(computedTotalCents)}

Items:
${lines.map(l => `- ${l}`).join("\n")}

Shipping to:
${shipBlock}

We’ll process and ship your order soon.

Riftbound Trading Co
`;

        // ---- send emails ----
        if (!resend || !EMAIL_FROM) {
          console.warn("Resend not configured; skipping order emails.");
        } else {
          // Owner email
          if (OWNER_EMAIL) {
            const r1 = await resend.emails.send({
              from: EMAIL_FROM,
              to: OWNER_EMAIL,
              subject: ownerSubject,
              text: ownerText
            });
            console.log("Resend owner email result:", r1);
          } else {
            console.warn("OWNER_EMAIL not set; skipping owner notification email.");
          }

          // Customer receipt
          if (customerEmail) {
            const r2 = await resend.emails.send({
              from: EMAIL_FROM,
              to: customerEmail,
              subject: customerSubject,
              text: customerText
            });
            console.log("Resend customer email result:", r2);
          } else {
            console.warn("No customer email; skipping customer receipt.");
          }
        }
      }

      return res.json({ received: true });
    } catch (e) {
      console.error("Webhook handler error:", e);
      return res.status(500).send("Webhook handler error");
    }
  }
);

/* =========================
   NORMAL MIDDLEWARE
========================= */
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   ROUTES
========================= */
app.get("/health", (req, res) => res.send("OK"));

app.get("/api/catalog", (req, res) => {
  const catalog = readJsonSafe(CATALOG_PATH);
  res.json({ ok: true, catalog });
});

app.get("/api/selllist", (req, res) => {
  const selllist = readJsonSafe(SELLLIST_PATH);
  res.json({ ok: true, selllist });
});

/**
 * Create Stripe Checkout session
 * Client sends: { email, cart: [{sku, condition, qty}] }
 * Server loads catalog.json and computes prices (LOCKED server-side).
 */
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured" });

    const email = String(req.body?.email || "").trim();
    const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];

    if (!cart.length) return res.status(400).json({ ok: false, error: "Cart is empty" });

    const catalog = readJsonSafe(CATALOG_PATH);

    const line_items = [];

    for (const item of cart) {
      const sku = String(item.sku || "").trim();
      const condition = normalizeCondition(item.condition);
      const qty = Math.max(1, Number(item.qty || 0));

      const product = catalog[sku];
      if (!product) return res.status(400).json({ ok: false, error: `Unknown SKU: ${sku}` });

      // Stock check (server-side)
      const stock = getStockForCondition(product, condition);
      if (qty > stock) {
        return res.status(400).json({
          ok: false,
          error: `Not enough stock for ${product.name || sku} (${condition}). Have ${stock}, requested ${qty}`
        });
      }

      const baseCents = Number(product.price_cents || 0);
      const unitCents = centsForCondition(baseCents, condition);

      line_items.push({
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: unitCents,
          product_data: {
            name: `${product.name || sku} (${condition})`
          }
        }
      });
    }

    const orderId = makeOrderId();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email || undefined,
      line_items,
      shipping_address_collection: { allowed_countries: ["US"] },
      success_url: `${PUBLIC_BASE_URL}/success.html?order=${encodeURIComponent(orderId)}`,
      cancel_url: `${PUBLIC_BASE_URL}/buy-cart.html`,
      metadata: {
        orderId,
        cart: JSON.stringify(cart),
        email: email || ""   // ✅ fallback for webhook
      }
    });

    res.json({ ok: true, url: session.url, id: session.id, orderId });
  } catch (e) {
    console.error("Create checkout session error:", e);
    res.status(500).json({ ok: false, error: e.message || "Could not create checkout session" });
  }
});

/**
 * Sell form submit -> emails YOU + customer confirmation
 * Client sends: { name, email, total, order: [{name, condition, qty, unitPrice}] }
 */
app.post("/api/submit", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const total = String(req.body?.total || "").trim();
    const order = Array.isArray(req.body?.order) ? req.body.order : [];

    if (!order.length) return res.status(400).json({ ok: false, error: "Empty sell order" });

    const lines = order.map((l) => {
      const qty = Number(l.qty || 0) || 0;
      const cond = String(l.condition || "");
      const cardName = String(l.name || l.sku || "");
      const unit = Number(l.unitPrice || 0);
      const lineTotal = qty * unit;
      return `${qty}x ${cardName} (${cond}) — $${unit.toFixed(2)} each = $${lineTotal.toFixed(2)}`;
    });

    if (!resend || !EMAIL_FROM) {
      console.warn("Sell email skipped (Resend/EMAIL_FROM not configured)");
      return res.json({ ok: true, skipped: true });
    }

    // Owner email
    if (OWNER_EMAIL) {
      const r1 = await resend.emails.send({
        from: EMAIL_FROM,
        to: OWNER_EMAIL,
        subject: `New Sell Order from ${name || "Customer"}`,
        text:
`New sell order submitted

Name: ${name}
Email: ${email}
Total: $${total}

Cards:
${lines.map(l => `- ${l}`).join("\n")}
`
      });
      console.log("Resend sell owner email result:", r1);
    } else {
      console.warn("OWNER_EMAIL not set; skipping owner sell email.");
    }

    // Customer confirmation
    if (email) {
      const r2 = await resend.emails.send({
        from: EMAIL_FROM,
        to: email,
        subject: `We received your sell order`,
        text:
`Thanks! We received your sell order.

Name: ${name}
Email: ${email}
Total: $${total}

Cards:
${lines.map(l => `- ${l}`).join("\n")}

We’ll review your order and follow up soon.

Riftbound Trading Co
`
      });
      console.log("Resend sell customer email result:", r2);
    } else {
      console.warn("Customer email missing; skipping sell confirmation.");
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("Sell submit error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Could not send sell email" });
  }
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log("Starting server...");
  console.log(`Server running on http://localhost:${PORT}`);
});




