"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Stripe = require("stripe");
const { Resend } = require("resend");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");

const app = express();
app.use(cookieParser());

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
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/* =========================
   POSTGRES
========================= */
if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL not set. DB features will fail.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

/* =========================
   FILE PATHS (catalog stays JSON for now)
========================= */
const CATALOG_PATH = path.join(__dirname, "catalog.json");
const SELLLIST_PATH = path.join(__dirname, "selllist.json");

/* =========================
   JSON helpers (catalog/selllist only)
========================= */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("readJsonSafe failed:", filePath, e);
    return {};
  }
}

function writeJsonSafe(filePath, obj) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("writeJsonSafe failed:", filePath, e);
    return false;
  }
}

/* =========================
   CONDITIONS / PRICING
========================= */
const CONDITION_MULT = {
  "Near Mint": 1,
  "Lightly Played": 0.9,
  "Moderately Played": 0.8,
  "Heavily Played": 0.65,
};

function normalizeCondition(c) {
  const s = String(c || "").trim();
  return CONDITION_MULT[s] ? s : "Near Mint";
}

function centsForCondition(base, cond) {
  const b = Number(base || 0);
  return Math.round(b * (CONDITION_MULT[normalizeCondition(cond)] || 1));
}

/* =========================
   SESSION (signed cookie)
========================= */
function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || "")
  );
}

function setSession(res, userId) {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex");
  res.cookie("sid", `${userId}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

function clearSession(res) {
  res.clearCookie("sid");
}

function getSessionUserId(req) {
  const raw = String(req.cookies?.sid || "");
  const [userId, sig] = raw.split(".");
  if (!userId || !sig) return null;

  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex");
  if (sig !== expected) return null;

  if (!isUuid(userId)) return null;

  return userId;
}

function requireAuth(req, res, next) {
  const userId = getSessionUserId(req);
  if (!userId) {  
        clearSession(res); 
        return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  req.userId = userId;
  next();
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

      const orderId = String(session?.metadata?.orderId || "").trim();
      if (!orderId) {
        console.error("Webhook missing metadata.orderId");
        return res.json({ received: true });
      }

      // 1) Load pending checkout from DB (cart, email, userId)
      const pendingRes = await pool.query(
        `SELECT order_id, user_id, email, cart_json
           FROM app.pending_checkout
          WHERE order_id = $1`,
        [orderId]
      );

      const pending = pendingRes.rows[0] || null;

      // ✅ FIX: cart_json might be json/jsonb (object/array) OR a string (older rows).
      // Prefer json/jsonb; fallback to JSON.parse if string.
      let cart = [];
      try {
        if (Array.isArray(pending?.cart_json)) {
          cart = pending.cart_json;
        } else if (typeof pending?.cart_json === "string") {
          cart = JSON.parse(pending.cart_json || "[]");
        } else if (pending?.cart_json && typeof pending.cart_json === "object") {
          // jsonb can come back as an object/array depending on driver/config
          cart = Array.isArray(pending.cart_json) ? pending.cart_json : [];
        } else {
          cart = [];
        }
      } catch {
        cart = [];
      }

      const userId = pending?.user_id || (session?.metadata?.userId ? session.metadata.userId : null);

      const customerEmail =
        session.customer_details?.email ||
        session.customer_email ||
        pending?.email ||
        session?.metadata?.email ||
        "";

      const shipName = session.customer_details?.name || "";

      const shipAddr =
        session.shipping_details?.address ||
        session.customer_details?.address ||
        null;

      const shippingAddress = shipAddr
        ? {
            line1: shipAddr.line1 || "",
            line2: shipAddr.line2 || "",
            city: shipAddr.city || "",
            state: shipAddr.state || "",
            postal: shipAddr.postal_code || "",
            country: shipAddr.country || "US",
          }
        : null;

      // 2) Build order lines (still using catalog.json for names/prices)
      const catalog = readJsonSafe(CATALOG_PATH) || {};
      const lines = [];
      let totalCents = 0;

      for (const it of cart || []) {
        const sku = String(it?.sku || "").trim();
        const condition = normalizeCondition(it?.condition);
        const qty = Math.max(1, Number(it?.qty || 0));
        if (!sku || qty <= 0) continue;

        const product = catalog[sku];
        if (!product) continue;

        const unitCents = centsForCondition(Number(product.price_cents || 0), condition);
        const lineCents = unitCents * qty;
        totalCents += lineCents;

        lines.push({
          sku,
          name: String(product.name || sku),
          condition,
          qty,
          unitPriceCents: unitCents,
          lineTotalCents: lineCents,
        });
      }

      // 3) Write order + lines in ONE DB transaction (atomic)
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // ✅ FIX: placeholder count matches param array (12 placeholders, 12 params)
        await client.query(
          `INSERT INTO app.orders
            (id, user_id, type, status, total_cents, customer_name, customer_email,
             ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country,
             stripe_session_id)
           VALUES
            ($1,$2,'buy','paid',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO NOTHING`,
          [
            orderId,                        // $1
            userId,                         // $2
            totalCents,                     // $3
            shipName,                       // $4
            customerEmail,                  // $5
            shippingAddress?.line1 || null, // $6
            shippingAddress?.line2 || null, // $7
            shippingAddress?.city || null,  // $8
            shippingAddress?.state || null, // $9
            shippingAddress?.postal || null,// $10
            shippingAddress?.country || null,// $11
            session.id,                     // $12
          ]
        );

        // ✅ FIX: don’t rely on gen_random_uuid(); generate in Node
        for (const l of lines) {
          await client.query(
            `INSERT INTO app.order_lines
              (id, order_id, sku, name, condition, qty, unit_price_cents, line_total_cents)
             VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              crypto.randomUUID(),
              orderId,
              l.sku,
              l.name,
              l.condition,
              l.qty,
              l.unitPriceCents,
              l.lineTotalCents,
            ]
          );
        }

        // Save shipping address onto the user (optional)
        if (userId && shippingAddress) {
          await client.query(
            `UPDATE app.users
                SET address_line1=$2, address_line2=$3, address_city=$4, address_state=$5,
                    address_postal=$6, address_country=$7, address_updated_at=NOW()
              WHERE id=$1`,
            [
              userId,
              shippingAddress.line1,
              shippingAddress.line2,
              shippingAddress.city,
              shippingAddress.state,
              shippingAddress.postal,
              shippingAddress.country,
            ]
          );
        }

        // Delete pending checkout (so it can’t be replayed)
        await client.query(`DELETE FROM app.pending_checkout WHERE order_id=$1`, [orderId]);

        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("Webhook DB transaction failed:", e);
      } finally {
        client.release();
      }

      // Optional emails (now that order is saved)
      if (resend && EMAIL_FROM) {
        const totalNice = `$${(totalCents / 100).toFixed(2)}`;
        const emailLines = lines.map(
          (l) =>
            `${l.qty}x ${l.name} — ${l.condition} — $${(l.unitPriceCents / 100).toFixed(2)} each = $${(
              l.lineTotalCents / 100
            ).toFixed(2)}`
        );

        if (OWNER_EMAIL) {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: OWNER_EMAIL,
            subject: `New order ${orderId}`,
            text: `Order ${orderId}\nCustomer: ${shipName} <${customerEmail}>\nTotal: ${totalNice}\n\n${emailLines.join(
              "\n"
            )}`,
          });
        }

        if (customerEmail) {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: customerEmail,
            subject: `Your Riftbound order receipt (${orderId})`,
            text: `Thanks for your purchase!\nOrder: ${orderId}\nTotal: ${totalNice}\n\n${emailLines.join("\n")}`,
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

/* =========================
   STRIPE CHECKOUT SESSION
========================= */
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured" });

    const email = String(req.body?.email || "").trim();
    const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];
    if (!cart.length) return res.status(400).json({ ok: false, error: "Cart is empty" });

    const orderId = crypto.randomUUID(); // UUID
    const userId = getSessionUserId(req);

    // ✅ FIX: store cart as real JSON/JSONB (not a string) if your cart_json column is json/jsonb
    // If your column is TEXT, change this back to JSON.stringify(cart)
    await pool.query(
      `INSERT INTO app.pending_checkout(order_id, user_id, email, cart_json)
       VALUES ($1,$2,$3,$4)`,
      [orderId, userId, email || null, cart]
    );

    // Build Stripe line items from catalog.json
    const catalog = readJsonSafe(CATALOG_PATH) || {};
    const line_items = [];

    for (const item of cart) {
      const sku = String(item?.sku || "").trim();
      const condition = normalizeCondition(item?.condition);
      const qty = Math.max(1, Number(item?.qty || 0));

      const product = catalog[sku];
      if (!product) return res.status(400).json({ ok: false, error: `Unknown SKU: ${sku}` });

      const unitCents = centsForCondition(Number(product.price_cents || 0), condition);

      line_items.push({
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: unitCents,
          product_data: { name: `${product.name || sku} (${condition})` },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email || undefined,
      line_items,
      shipping_address_collection: { allowed_countries: ["US"] },
      success_url: `${PUBLIC_BASE_URL}/success.html?order=${encodeURIComponent(orderId)}`,
      cancel_url: `${PUBLIC_BASE_URL}/buy-cart.html`,
      metadata: {
        orderId,
        userId: userId || "",
        email,
      },
    });

    return res.json({ ok: true, url: session.url, id: session.id, orderId });
  } catch (e) {
    console.error("Create checkout session error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Could not create checkout session" });
  }
});

/* =========================
   SELL SUBMIT (DB-backed)
========================= */
app.post("/api/submit", async (req, res) => {
  try {
    const name = String(req.body?.name || "Sell Customer").trim();
    const email = String(req.body?.email || "").trim();
    const order = Array.isArray(req.body?.order) ? req.body.order : [];

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "Missing/invalid email" });
    }
    if (!order.length) {
      return res.status(400).json({ ok: false, error: "Empty sell order" });
    }

    const orderId = crypto.randomUUID(); // ✅ uuid, matches DB
    const userId = getSessionUserId(req); // uuid or null

    // Build normalized lines (client already sends unitPriceCents/lineTotalCents)
    const lines = [];
    let totalCents = 0;

    for (const l of order) {
      const sku = String(l?.sku || "").trim();
      const cardName = String(l?.name || "").trim();
      const condition = String(l?.condition || "NM").trim().toUpperCase(); // NM/LP/MP
      const qty = Math.max(0, Number(l?.qty || 0));

      const unitPriceCents = Number(l?.unitPriceCents || 0);
      const lineTotalCents = Number(l?.lineTotalCents || unitPriceCents * qty);

      if (!sku || qty <= 0) continue;

      lines.push({
        sku,
        name: cardName || sku,
        condition,
        qty,
        unitPriceCents,
        lineTotalCents,
      });

      totalCents += lineTotalCents;
    }

    if (!lines.length) {
      return res.status(400).json({ ok: false, error: "No valid items in sell order" });
    }

    // Write order + lines atomically
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO app.orders
          (id, user_id, type, status, total_cents, customer_name, customer_email)
         VALUES
          ($1, $2, 'sell', 'submitted', $3, $4, $5)`,
        [orderId, userId && isUuid(userId) ? userId : null, totalCents, name, email]
      );

      for (const ln of lines) {
        await client.query(
          `INSERT INTO app.order_lines
            (id, order_id, sku, name, condition, qty, unit_price_cents, line_total_cents)
           VALUES
            (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [orderId, ln.sku, ln.name, ln.condition, ln.qty, ln.unitPriceCents, ln.lineTotalCents]
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return res.json({ ok: true, orderId });
  } catch (e) {
    console.error("Sell submit error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Could not submit" });
  }
});

/* =========================
   PUBLIC API ROUTES
========================= */
app.get("/api/catalog", (req, res) => {
  res.json({ ok: true, catalog: readJsonSafe(CATALOG_PATH) });
});

app.get("/api/selllist", (req, res) => {
  res.json({ ok: true, selllist: readJsonSafe(SELLLIST_PATH) });
});

/* =========================
   AUTH (DB-backed)
========================= */
app.post("/api/auth/signup", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();

    if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: "Valid email required" });
    if (!password || password.length < 8) return res.status(400).json({ ok: false, error: "Password must be 8+ characters" });

    const exists = await pool.query(`SELECT 1 FROM app.users WHERE email=$1`, [email]);
    if (exists.rowCount) return res.status(409).json({ ok: false, error: "Email already in use" });

    const hash = await bcrypt.hash(password, 12);
    const id = crypto.randomUUID();

    await pool.query(
      `INSERT INTO app.users(id, email, name, password_hash)
       VALUES ($1,$2,$3,$4)`,
      [id, email, name || null, hash]
    );

    setSession(res, id);

    return res.json({ ok: true, user: { id, email, name } });
  } catch (e) {
    console.error("signup error:", e);
    return res.status(500).json({ ok: false, error: "Signup failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    const r = await pool.query(
      `SELECT id, email, name, password_hash
         FROM app.users
        WHERE email=$1`,
      [email]
    );
    const user = r.rows[0];
    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    setSession(res, user.id);
    return res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ ok: false, error: "Login failed" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const userId = getSessionUserId(req);
  if (!userId) return res.json({ ok: true, user: null });

  const r = await pool.query(
    `SELECT id, email, name,
            address_line1, address_line2, address_city, address_state, address_postal, address_country
       FROM app.users
      WHERE id=$1`,
    [userId]
  );
  const u = r.rows[0];
  if (!u) return res.json({ ok: true, user: null });

  const address = u.address_line1
    ? {
        line1: u.address_line1,
        line2: u.address_line2 || "",
        city: u.address_city || "",
        state: u.address_state || "",
        postal: u.address_postal || "",
        country: u.address_country || "US",
      }
    : null;

  res.json({
    ok: true,
    user: { id: u.id, email: u.email, name: u.name, address },
  });
});

/* =========================
   MY ORDERS (DB-backed)
========================= */
app.get("/api/my/orders", requireAuth, async (req, res) => {
  const userId = req.userId;

  const ordersRes = await pool.query(
    `SELECT *
       FROM app.orders
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [userId]
  );

  const orders = ordersRes.rows;
  if (!orders.length) return res.json({ ok: true, orders: [] });

  const ids = orders.map((o) => o.id);
  const linesRes = await pool.query(
    `SELECT *
       FROM app.order_lines
      WHERE order_id = ANY($1::uuid[])
      ORDER BY order_id, name`,
    [ids]
  );

  const linesByOrder = new Map();
  for (const l of linesRes.rows) {
    const key = l.order_id;
    if (!linesByOrder.has(key)) linesByOrder.set(key, []);
    linesByOrder.get(key).push(l);
  }

  const out = orders.map((o) => ({
    id: o.id,
    userId: o.user_id,
    type: o.type,
    status: o.status,
    totalCents: o.total_cents,
    createdAt: o.created_at,
    customer: {
      name: o.customer_name,
      email: o.customer_email,
      address: o.ship_line1
        ? {
            line1: o.ship_line1,
            line2: o.ship_line2 || "",
            city: o.ship_city || "",
            state: o.ship_state || "",
            postal: o.ship_postal || "",
            country: o.ship_country || "US",
          }
        : null,
    },
    lines: (linesByOrder.get(o.id) || []).map((l) => ({
      sku: l.sku,
      name: l.name,
      condition: l.condition,
      qty: l.qty,
      unitPriceCents: l.unit_price_cents,
      lineTotalCents: l.line_total_cents,
    })),
    stripeSessionId: o.stripe_session_id || null,
  }));

  res.json({ ok: true, orders: out });
});

/* =========================
   HEALTH + START
========================= */
app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

