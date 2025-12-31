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
      const orderId = session.metadata.orderId;
      const cart = JSON.parse(session.metadata.cart || "[]");

      const catalog = readJsonSafe(CATALOG_PATH);

      let totalCents = 0;
      const lines = [];

      for (const it of cart) {
        const product = catalog[it.sku];
        const unit = centsForCondition(product.price_cents, it.condition);
        totalCents += unit * it.qty;

        decrementStock(catalog, it.sku, it.condition, it.qty);

        lines.push({
          sku: it.sku,
          condition: it.condition,
          qty: it.qty
        });
      }

      writeJsonSafe(CATALOG_PATH, catalog);

      const customerEmail =
        session.customer_details?.email ||
        session.customer_email ||
        session.metadata.email ||
        "";

      const shipName = session.customer_details?.name || "";

      // ✅ SAVE ORDER HERE (FIX)
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

      // emails (optional but already correct)
      if (resend && EMAIL_FROM) {
        if (OWNER_EMAIL) {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: OWNER_EMAIL,
            subject: `New order ${orderId}`,
            text: `Order total: $${(totalCents / 100).toFixed(2)}`
          });
        }

        if (customerEmail) {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: customerEmail,
            subject: `Your Riftbound order (${orderId})`,
            text: `Thanks for your order!`
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

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});




