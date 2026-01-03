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
    return JSON.parse(fs.readFileSync(filePath, "utf8") || "{}");
  } catch (e) {
    console.error("readJsonSafe failed:", filePath, e);
    return {};
  }
}

function writeJsonSafe(filePath, obj) {
  try {
    ensureDirForFile(filePath);
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("writeJsonSafe failed:", filePath, e);
    return false;
  }
}

function makeOrderId() {
  return `ord_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function appendOrder(order) {
  const db = readJsonSafe(ORDERS_PATH);
  const out = {
    orders: Array.isArray(db.orders) ? db.orders : []
  };
  out.orders.unshift(order);
  writeJsonSafe(ORDERS_PATH, out);
}

const CONDITION_MULT = {
  "Near Mint": 1,
  "Lightly Played": 0.9,
  "Moderately Played": 0.8,
  "Heavily Played": 0.65
};

function normalizeCondition(c) {
  const s = String(c || "").trim();
  return CONDITION_MULT[s] ? s : "Near Mint";
}

function centsForCondition(base, cond) {
  const b = Number(base || 0);
  return Math.round(b * (CONDITION_MULT[normalizeCondition(cond)] || 1));
}

function decrementStock(catalog, sku, cond, qty) {
  const sSku = String(sku || "").trim();
  const condition = normalizeCondition(cond);
  const nQty = Number(qty || 0);

  const product = catalog?.[sSku];
  if (!product) return { ok: false, error: `Unknown SKU: ${sSku}` };

  if (!product.stock || typeof product.stock !== "object") {
    return { ok: false, error: `SKU ${sSku} missing stock object` };
  }

  const cur = Number(product.stock[condition] ?? 0);
  if (nQty <= 0) return { ok: false, error: "Invalid qty" };
  if (cur < nQty) return { ok: false, error: `Insufficient stock for ${sSku} (${condition})` };

  product.stock[condition] = cur - nQty;
  return { ok: true };
}

function requireAdmin(req, res, next) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!ADMIN_TOKEN) return res.status(500).json({ ok: false, error: "ADMIN_TOKEN not set" });
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });
  next();
}

/* =========================
   STRIPE WEBHOOK (RAW BODY)
   NOTE: must be BEFORE express.json()
========================= */
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.sendStatus(500);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verify failed:", err?.message || err);
    return res.status(400).send("Webhook error");
  }

  try {
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

        const dec = decrementStock(catalog, sku, condition, qty);
        if (!dec.ok) {
          console.error("Inventory decrement failed:", dec.error);

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

          // respond 200 so Stripe does not retry forever
          return res.json({ received: true });
        }

        lines.push({ sku, condition, qty });

        const name = String(product.name || sku);
        emailLines.push(
          `${qty}x ${name} — ${condition} — $${(unitCents / 100).toFixed(2)} each = $${(lineCents / 100).toFixed(2)}`
        );
      }

      // persist updated inventory
      writeJsonSafe(CATALOG_PATH, catalog);

      // save order
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

      // optional emails
      if (resend && EMAIL_FROM) {
        const totalNice = `$${(totalCents / 100).toFixed(2)}`;

        if (OWNER_EMAIL) {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: OWNER_EMAIL,
            subject: `New order ${orderId}`,
            text: `Order ${orderId}\nCustomer: ${shipName} <${customerEmail}>\nTotal: ${totalNice}\n\n${emailLines.join("\n")}`
          });
        }

        if (customerEmail) {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: customerEmail,
            subject: `Your Riftbound order receipt (${orderId})`,
            text: `Thanks for your purchase!\nOrder: ${orderId}\nTotal: ${totalNice}\n\n${emailLines.join("\n")}`
          });
        }
      }
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).send("Webhook handler error");
  }
});

/* =========================
   NORMAL MIDDLEWARE + STATIC
========================= */
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured" });

    const email = String(req.body?.email || "").trim();
    const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];

    if (!cart.length) return res.status(400).json({ ok: false, error: "Cart is empty" });

    const catalog = readJsonSafe(CATALOG_PATH);
    const line_items = [];

    for (const item of cart) {
      const sku = String(item?.sku || "").trim();
      const condition = normalizeCondition(item?.condition);
      const qty = Math.max(1, Number(item?.qty || 0));

      const product = catalog[sku];
      if (!product) return res.status(400).json({ ok: false, error: `Unknown SKU: ${sku}` });

      // Stock check
      const curStock = Number(product?.stock?.[condition] ?? 0);
      if (qty > curStock) {
        return res.status(400).json({
          ok: false,
          error: `Not enough stock for ${product.name || sku} (${condition}). Have ${curStock}, requested ${qty}`
        });
      }

      const unitCents = centsForCondition(Number(product.price_cents || 0), condition);

      line_items.push({
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: unitCents,
          product_data: { name: `${product.name || sku} (${condition})` }
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
        email: email || ""
      }
    });

    return res.json({ ok: true, url: session.url, id: session.id, orderId });
  } catch (e) {
    console.error("Create checkout session error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Could not create checkout session" });
  }
});

/* =========================
   HEALTH
========================= */
app.get("/health", (req, res) => res.send("OK"));

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
   SELL SUBMIT (basic)
   NOTE: this currently just records an order.
   You can extend it to also decrement selllist max, etc.
========================= */
app.post("/api/submit", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const order = Array.isArray(req.body?.order) ? req.body.order : [];

    if (!order.length) return res.status(400).json({ ok: false, error: "Empty sell order" });

    // Load selllist (buylist caps)
    const selllist = readJsonSafe(SELLLIST_PATH);

    // Decrement remaining/max for each item
    for (const l of order) {
      const sku = String(l.sku || "").trim();
      const tab = String(l.tab || "").trim().toUpperCase(); // NM/LP/MP
      const qty = Math.max(0, Number(l.qty || 0));

      if (!sku || !qty) continue;
      if (!selllist[sku]) continue;

      // Ensure structure exists
      selllist[sku].max = selllist[sku].max || {};
      const cur = Number(selllist[sku].max[tab] ?? 0);
      selllist[sku].max[tab] = Math.max(0, cur - qty);
    }

    writeJsonSafe(SELLLIST_PATH, selllist);

    // (optional) append an order for admin view
    appendOrder({
      id: makeOrderId(),
      type: "sell",
      status: "submitted",
      createdAt: new Date().toISOString(),
      customer: { name, email },
      lines: order.map(l => ({
        sku: String(l.sku || ""),
        condition: String(l.condition || "Near Mint"),
        qty: Math.max(1, Number(l.qty || 0))
      })),
      totalCents: 0
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("Sell submit error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Could not submit" });
  }
});


/* =========================
   ADMIN ROUTES
========================= */
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const db = readJsonSafe(ORDERS_PATH) || { orders: [] };
  const orders = Array.isArray(db.orders) ? db.orders : [];
  res.json({ ok: true, orders });
});

app.post("/api/admin/orders/:id/approve", requireAdmin, (req, res) => {
  const id = String(req.params.id || "").trim();
  const db = readJsonSafe(ORDERS_PATH) || { orders: [] };
  db.orders = Array.isArray(db.orders) ? db.orders : [];

  const order = db.orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

  if (order.status === "approved" || order.status === "checked_in" || order.status === "fulfilled") {
    return res.json({ ok: true, order });
  }

  if (order.type === "sell") {
    const catalog = readJsonSafe(CATALOG_PATH);

    for (const l of (order.lines || [])) {
      const sku = String(l.sku || "").trim();
      const cond = normalizeCondition(l.condition);
      const qty = Math.max(0, Number(l.qty || 0));
      if (!sku || qty <= 0) continue;
      if (!catalog[sku]) continue;

      if (!catalog[sku].stock || typeof catalog[sku].stock !== "object") {
        catalog[sku].stock = { "Near Mint": 0, "Lightly Played": 0, "Moderately Played": 0, "Heavily Played": 0 };
      }
      catalog[sku].stock[cond] = Number(catalog[sku].stock[cond] || 0) + qty;
    }

    writeJsonSafe(CATALOG_PATH, catalog);
    order.status = "checked_in";
    order.checkedInAt = new Date().toISOString();
  } else {
    order.status = "approved";
    order.approvedAt = new Date().toISOString();
  }

  writeJsonSafe(ORDERS_PATH, db);
  res.json({ ok: true, order });
});

app.post("/api/admin/orders/:id/fulfill", requireAdmin, (req, res) => {
  const id = String(req.params.id || "").trim();
  const db = readJsonSafe(ORDERS_PATH) || { orders: [] };
  db.orders = Array.isArray(db.orders) ? db.orders : [];

  const order = db.orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

  order.status = "shipped";
  order.shippedAt = new Date().toISOString();


  writeJsonSafe(ORDERS_PATH, db);
  res.json({ ok: true, order });
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});


