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
const EMAIL_FROM = process.env.EMAIL_FROM || "";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/* =========================
   FILE PATHS
========================= */
const CATALOG_PATH = path.join(__dirname, "catalog.json");
const SELLLIST_PATH = path.join(__dirname, "selllist.json");
const ORDERS_PATH = path.join(__dirname, "data", "orders.json");

/* =========================
   HELPERS
========================= */
function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeJsonSafe(filePath, obj) {
  try {
    ensureDirForFile(filePath);
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
    return true;
  } catch (e) {
    console.error("Write failed:", filePath, e);
    return false;
  }
}

function makeOrderId() {
  return `ord_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function appendOrder(order) {
  const db = readJsonSafe(ORDERS_PATH) || { orders: [] };
  db.orders = Array.isArray(db.orders) ? db.orders : [];
  db.orders.unshift(order);
  writeJsonSafe(ORDERS_PATH, db);
}

const CONDITION_MULT = {
  "Near Mint": 1,
  "Lightly Played": 0.9,
  "Moderately Played": 0.8,
  "Heavily Played": 0.65
};

function normalizeCondition(c) {
  return CONDITION_MULT[c] ? c : "Near Mint";
}

function centsForCondition(base, cond) {
  return Math.round(base * (CONDITION_MULT[normalizeCondition(cond)] || 1));
}

function getStockForCondition(p, cond) {
  return Number(p?.stock?.[normalizeCondition(cond)] || 0);
}

function decrementStock(catalog, sku, cond, qty) {
  if (!catalog[sku]) return { ok: false };
  if (catalog[sku].stock[cond] < qty) return { ok: false };
  catalog[sku].stock[cond] -= qty;
  return { ok: true };
}

/* =========================
   STRIPE WEBHOOK (RAW BODY)
========================= */
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe) return res.sendStatus(500);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send("Webhook error");
    }

    if (event.type === "checkout.session.completed") {
  const session = event.data.object;

  const orderId = String(session?.metadata?.orderId || "").trim() || makeOrderId();

  let cart = [];
  try {
    cart = JSON.parse(session?.metadata?.cart || "[]");
  } catch {
    cart = [];
  }

  const catalog = readJsonSafe(CATALOG_PATH);

  const customerEmail =
    session.customer_details?.email ||
    session.customer_email ||
    String(session?.metadata?.email || "").trim() ||
    "";

  const shipName = session.customer_details?.name || "";

  const lines = [];
  const emailLines = [];

  let totalCents = 0;

  // ---- inventory update + price calc (server-side truth) ----
  for (const it of cart) {
    const sku = String(it?.sku || "").trim();
    const condition = normalizeCondition(it?.condition);
    const qty = Math.max(1, Number(it?.qty || 0));

    if (!sku || !Number.isFinite(qty) || qty <= 0) continue;

    const product = catalog[sku];
    if (!product) {
      console.warn("Unknown SKU in cart:", sku);
      continue;
    }

    const unitCents = centsForCondition(Number(product.price_cents || 0), condition);
    const lineCents = unitCents * qty;
    totalCents += lineCents;

    // decrement stock (must succeed)
    const dec = decrementStock(catalog, sku, condition, qty);
    if (!dec.ok) {
      console.error("Inventory decrement failed:", dec.error);

      // still save the order as "needs_review" so you see it in admin
      appendOrder({
        id: orderId,
        type: "buy",
        status: "needs_review",
        createdAt: new Date().toISOString(),
        customer: { name: shipName, email: customerEmail },
        lines: cart.map(x => ({
          sku: String(x?.sku || ""),
          condition: normalizeCondition(x?.condition),
          qty: Math.max(1, Number(x?.qty || 0))
        })),
        totalCents,
        stripeSessionId: session.id,
        error: dec.error || "Inventory decrement failed"
      });

      // IMPORTANT: still respond 200 to Stripe or it retries forever
      writeJsonSafe(CATALOG_PATH, catalog); // optional: you may skip writing if you want strictness
      return res.json({ received: true });
    }

    lines.push({ sku, condition, qty });

    const name = String(product.name || sku);
    emailLines.push(
      `${qty}x ${name} — ${condition} — $${(unitCents / 100).toFixed(2)} each = $${(lineCents / 100).toFixed(2)}`
    );
  }

  // write updated catalog
  writeJsonSafe(CATALOG_PATH, catalog);

  // ✅ SAVE ORDER
  appendOrder({
    id: orderId,
    type: "buy",
    status: "paid",
    createdAt: new Date().toISOString(),
    customer: { name: shipName, email: customerEmail },
    lines,
    totalCents,
    stripeSessionId: session.id
  });

  // ---- emails (owner + customer recap) ----
  if (resend && EMAIL_FROM) {
    const totalNice = `$${(totalCents / 100).toFixed(2)}`;

    const ownerText =
`New order received: ${orderId}

Customer: ${shipName || "(no name)"} <${customerEmail || "no email"}>
Total: ${totalNice}

Items:
${emailLines.map(l => `- ${l}`).join("\n")}

Stripe session: ${session.id}
`;

    const customerText =
`Thanks for your purchase!

Order: ${orderId}
Total: ${totalNice}

Items:
${emailLines.map(l => `- ${l}`).join("\n")}

Riftbound Trading Co
`;

    if (OWNER_EMAIL) {
      await resend.emails.send({
        from: EMAIL_FROM,
        to: OWNER_EMAIL,
        subject: `New order ${orderId}`,
        text: ownerText
      });
    }

    if (customerEmail) {
      await resend.emails.send({
        from: EMAIL_FROM,
        to: customerEmail,
        subject: `Your Riftbound order receipt (${orderId})`,
        text: customerText
      });
    }
  }
}


    res.json({ received: true });
  }
);

/* =========================
   NORMAL MIDDLEWARE
========================= */
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   API ROUTES
========================= */
app.get("/api/catalog", (req, res) => {
  res.json({ ok: true, catalog: readJsonSafe(CATALOG_PATH) });
});

app.get("/api/selllist", (req, res) => {
  res.json({ ok: true, selllist: readJsonSafe(SELLLIST_PATH) });
});


function requireAdmin(req, res, next) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({ ok: false, error: "ADMIN_TOKEN not set" });
  }
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}
// List orders
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const db = readJsonSafe(ORDERS_PATH) || { orders: [] };
  const orders = Array.isArray(db.orders) ? db.orders : [];
  res.json({ ok: true, orders });
});

// Approve (sell = check-in stock, buy = approve)
app.post("/api/admin/orders/:id/approve", requireAdmin, (req, res) => {
  const id = String(req.params.id || "").trim();
  const db = readJsonSafe(ORDERS_PATH) || { orders: [] };
  db.orders = Array.isArray(db.orders) ? db.orders : [];

  const order = db.orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

  // Idempotent: if already checked-in/approved, do nothing
  if (order.status === "approved" || order.status === "checked_in" || order.status === "fulfilled") {
    return res.json({ ok: true, order });
  }

  // If this is a SELL order, approving means: add inventory into catalog stock
  if (order.type === "sell") {
    const catalog = readJsonSafe(CATALOG_PATH);

    for (const l of (order.lines || [])) {
      const sku = String(l.sku || "").trim();
      const cond = normalizeCondition(l.condition);
      const qty = Math.max(0, Number(l.qty || 0));

      if (!sku || qty <= 0) continue;
      if (!catalog[sku]) continue;
      if (!catalog[sku].stock || typeof catalog[sku].stock !== "object") continue;

      const cur = Number(catalog[sku].stock[cond] || 0);
      catalog[sku].stock[cond] = cur + qty;
    }

    writeJsonSafe(CATALOG_PATH, catalog);
    order.status = "checked_in";
    order.checkedInAt = new Date().toISOString();
  } else {
    // BUY order approval just marks approved
    order.status = "approved";
    order.approvedAt = new Date().toISOString();
  }

  writeJsonSafe(ORDERS_PATH, db);
  res.json({ ok: true, order });
});

// Mark fulfilled (shipping complete)
app.post("/api/admin/orders/:id/fulfill", requireAdmin, (req, res) => {
  const id = String(req.params.id || "").trim();
  const db = readJsonSafe(ORDERS_PATH) || { orders: [] };
  db.orders = Array.isArray(db.orders) ? db.orders : [];

  const order = db.orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

  order.status = "fulfilled";
  order.fulfilledAt = new Date().toISOString();

  writeJsonSafe(ORDERS_PATH, db);
  res.json({ ok: true, order });
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});




