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
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

/* =========================
   FILE PATHS (kept for seeding)
========================= */
const CATALOG_PATH = path.join(__dirname, "catalog.json");
const SELLLIST_PATH = path.join(__dirname, "selllist.json");

/* =========================
   JSON helper (read-only)
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
   INVENTORY HELPERS
========================= */
function stockColumnForCondition(condition) {
  switch (condition) {
    case "Near Mint":
      return "stock_nm";
    case "Lightly Played":
      return "stock_lp";
    case "Moderately Played":
      return "stock_mp";
    case "Heavily Played":
      return "stock_hp";
    default:
      return "stock_nm";
  }
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
   ADMIN API ENDPOINTS
========================= */

app.get("/api/admin/inventory", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT sku, name, price_cents, stock, image, set_code, card_number, rarity, foil
      FROM app.inventory
      ORDER BY name ASC
    `);
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Failed to load inventory" });
  }
});

app.put("/api/admin/inventory/:sku", requireAdmin, async (req, res) => {
  try {
    const sku = String(req.params.sku || "").trim();
    if (!sku) return res.status(400).json({ ok: false, error: "Missing SKU" });

    const {
      name,
      price_cents,
      stock,
      image,
      set_code,
      card_number,
      rarity,
      foil,
    } = req.body || {};

    // Normalize
    const nName = name == null ? null : String(name).trim();
    const nPrice = price_cents == null ? null : Number(price_cents);
    const nStock = stock == null ? null : Number(stock);
    const nImage = image == null ? null : String(image).trim();
    const nSet = set_code == null ? null : String(set_code).trim();
    const nNum = card_number == null ? null : String(card_number).trim();
    const nRarity = rarity == null ? null : String(rarity).trim();
    const nFoil = !!foil;

    if (nPrice != null && (!Number.isFinite(nPrice) || nPrice < 0)) {
      return res.status(400).json({ ok: false, error: "Invalid price_cents" });
    }
    if (nStock != null && (!Number.isFinite(nStock) || nStock < 0)) {
      return res.status(400).json({ ok: false, error: "Invalid stock" });
    }

    const r = await pool.query(
      `
      UPDATE app.inventory
      SET
        name = COALESCE($2, name),
        price_cents = COALESCE($3, price_cents),
        stock = COALESCE($4, stock),
        image = COALESCE($5, image),
        set_code = $6,
        card_number = $7,
        rarity = $8,
        foil = $9
      WHERE sku = $1
      RETURNING sku, name, price_cents, stock, image, set_code, card_number, rarity, foil
      `,
      [sku, nName, nPrice, nStock, nImage, nSet, nNum, nRarity, nFoil]
    );

    if (!r.rowCount) return res.status(404).json({ ok: false, error: "SKU not found" });

    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || "Update failed" });
  }
});

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
      if (!orderId) return res.json({ received: true });

      // 1) Load pending checkout
      const pendingRes = await pool.query(
        `SELECT order_id, user_id, email, cart_json
           FROM app.pending_checkout
          WHERE order_id = $1`,
        [orderId]
      );
      const pending = pendingRes.rows[0] || null;

      // cart_json might be json/jsonb object/array OR a text string
      let cart = [];
      try {
        if (Array.isArray(pending?.cart_json)) cart = pending.cart_json;
        else if (typeof pending?.cart_json === "string") cart = JSON.parse(pending.cart_json || "[]");
        else if (pending?.cart_json && typeof pending.cart_json === "object") {
          cart = Array.isArray(pending.cart_json) ? pending.cart_json : [];
        } else cart = [];
      } catch {
        cart = [];
      }

      const userIdRaw = pending?.user_id || session?.metadata?.userId || null;
      const userId = isUuid(userIdRaw) ? userIdRaw : null;

      const customerEmail =
        session.customer_details?.email ||
        session.customer_email ||
        pending?.email ||
        session?.metadata?.email ||
        "";

      const shipName = session.customer_details?.name || "";

      const shipAddr = session.shipping_details?.address || session.customer_details?.address || null;

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

      // 2) Build lines FROM DB inventory (preferred) with fallback to catalog.json
      // (This keeps your totals consistent with your pricing data.)
      const catalogFallback = readJsonSafe(CATALOG_PATH) || {};

      const lines = [];
      let totalCents = 0;

      for (const it of cart || []) {
        const sku = String(it?.sku || "").trim();
        const condition = normalizeCondition(it?.condition);
        const qty = Math.max(1, Number(it?.qty || 0));
        if (!sku || qty <= 0) continue;

        // Try DB first
        const invRes = await pool.query(
          `SELECT sku, name, price_cents
             FROM app.inventory
            WHERE sku = $1`,
          [sku]
        );
        const inv = invRes.rows[0] || null;

        const name = String(inv?.name || catalogFallback?.[sku]?.name || sku);
        const basePriceCents = Number(inv?.price_cents ?? catalogFallback?.[sku]?.price_cents ?? 0);

        const unitCents = centsForCondition(basePriceCents, condition);
        const lineCents = unitCents * qty;
        totalCents += lineCents;

        lines.push({
          sku,
          name,
          condition,
          qty,
          unitPriceCents: unitCents,
          lineTotalCents: lineCents,
        });
      }

const shippingCents = Number(session?.total_details?.amount_shipping || 0) || 0;
totalCents += shippingCents;

// optional: add a shipping line item so your order_lines sum matches total
if (shippingCents > 0) {
  lines.push({
    sku: "SHIPPING",
    name: "Shipping",
    condition: "N/A",
    qty: 1,
    unitPriceCents: shippingCents,
    lineTotalCents: shippingCents,
  });
}

      // 3) Transaction: insert order, order_lines, decrement inventory, cleanup pending
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO app.orders
            (id, user_id, type, status, total_cents, customer_name, customer_email,
             ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country,
             stripe_session_id)
           VALUES
            ($1,$2,'buy','paid',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO NOTHING`,
          [
            orderId, // $1
            userId, // $2
            totalCents, // $3
            shipName, // $4
            customerEmail, // $5
            shippingAddress?.line1 || null, // $6
            shippingAddress?.line2 || null, // $7
            shippingAddress?.city || null, // $8
            shippingAddress?.state || null, // $9
            shippingAddress?.postal || null, // $10
            shippingAddress?.country || null, // $11
            String(session.id || ""), // $12
          ]
        );

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

        // Decrement inventory (oversell-safe)
        for (const l of lines) {
           if (l.sku === "SHIPPING") continue; // ✅ skip non-inventory line

          const col = stockColumnForCondition(l.condition); // safe: from switch
          const r = await client.query(
            `UPDATE app.inventory
                SET ${col} = ${col} - $2,
                    updated_at = NOW()
              WHERE sku = $1
                AND ${col} >= $2`,
            [l.sku, l.qty]
          );
          if (r.rowCount === 0) {
            throw new Error(`Insufficient stock for ${l.sku} (${l.condition})`);
          }
        }

        // Save shipping to user (optional)
        if (userId && shippingAddress) {
          await client.query(
            `UPDATE app.users
                SET address_line1=$2, address_line2=$3, address_city=$4, address_state=$5,
                    address_postal=$6, address_country=$7, address_updated_at=NOW()
              WHERE id=$1`,
            [
              userId,
              shippingAddress.line1,
              shippingAddress.line2 || null,
              shippingAddress.city,
              shippingAddress.state,
              shippingAddress.postal,
              shippingAddress.country || "US",
            ]
          );
        }

        await client.query(`DELETE FROM app.pending_checkout WHERE order_id=$1`, [orderId]);

        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("Webhook DB transaction failed:", e);
      } finally {
        client.release();
      }

      // Optional emails
      if (resend && EMAIL_FROM) {
        const totalNice = `$${(totalCents / 100).toFixed(2)}`;
        const emailLines = lines.map(
          (l) =>
            `${l.qty}x ${l.name} — ${l.condition} — $${(l.unitPriceCents / 100).toFixed(
              2
            )} each = $${(l.lineTotalCents / 100).toFixed(2)}`
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

function maxColumnForTab(tab) {
  switch (String(tab || "").toUpperCase()) {
    case "NM": return "max_nm";
    case "LP": return "max_lp";
    case "MP": return "max_mp";
    default: return "max_nm";
  }
}

async function requireAdmin(req, res, next) {
  try {
    const userIdRaw = getSessionUserId(req);
    if (!userIdRaw || !isUuid(userIdRaw)) {
      return res.status(401).json({ ok: false, error: "Not signed in" });
    }

    const r = await pool.query(
      `SELECT is_admin FROM app.users WHERE id=$1`,
      [userIdRaw]
    );

    const isAdmin = !!r.rows[0]?.is_admin;
    if (!isAdmin) return res.status(403).json({ ok: false, error: "Admin only" });

    req.adminUserId = userIdRaw;
    next();
  } catch (e) {
    console.error("requireAdmin error:", e);
    return res.status(500).json({ ok: false, error: "Auth error" });
  }
}


/* =========================
   STRIPE CHECKOUT SESSION
========================= */
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured" });

    const email = String(req.body?.email || "").trim();
    const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];
    const shippingMethodIdRaw = String(req.body?.shippingMethodId || "standard").trim(); // free|standard|priority|express

    if (!cart.length) return res.status(400).json({ ok: false, error: "Cart is empty" });
    if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: "Valid email required" });

    const orderId = crypto.randomUUID();
    const userIdRaw = getSessionUserId(req);
    const userId = isUuid(userIdRaw) ? userIdRaw : null;

    // Save pending checkout
    await pool.query(
      `INSERT INTO app.pending_checkout(order_id, user_id, email, cart_json)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [orderId, userId, email || null, JSON.stringify(cart)]
    );

    // ---- Build Stripe line items from DB inventory (fallback to catalog.json) ----
    const catalogFallback = readJsonSafe(CATALOG_PATH) || {};
    const line_items = [];

    for (const item of cart) {
      const sku = String(item?.sku || "").trim();
      const condition = normalizeCondition(item?.condition); // uses your CONDITION_MULT helper
      const qty = Math.max(1, Number(item?.qty || 0));

      if (!sku) return res.status(400).json({ ok: false, error: "Missing SKU" });

      const invRes = await pool.query(
        `SELECT name, price_cents FROM app.inventory WHERE sku=$1`,
        [sku]
      );
      const inv = invRes.rows[0] || null;

      const name = String(inv?.name || catalogFallback?.[sku]?.name || sku);
      const basePriceCents = Number(inv?.price_cents ?? catalogFallback?.[sku]?.price_cents ?? 0);

      const unitCents = centsForCondition(basePriceCents, condition); // your helper

      line_items.push({
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: unitCents,
          product_data: { name: `${name} (${condition})` },
        },
      });
    }

    // ---- Subtotal (items only) for free-shipping eligibility ----
    const subtotalCents = line_items.reduce((sum, li) => {
      const unit = Number(li?.price_data?.unit_amount || 0);
      const qty = Number(li?.quantity || 0);
      return sum + unit * qty;
    }, 0);

    const FREE_THRESHOLD_CENTS = 9900;

    // ---- Build Stripe shipping_options (fixed_amount) ----
    const SHIPPING_METHODS = {
      free:     { id: "free",     label: "Free Shipping (3–5 business days)", cents: 0,    minDays: 3, maxDays: 5 },
      standard: { id: "standard", label: "Standard (3–5 business days)",      cents: 599,  minDays: 3, maxDays: 5 },
      priority: { id: "priority", label: "Priority (2–3 business days)",      cents: 999,  minDays: 2, maxDays: 3 },
      express:  { id: "express",  label: "Express (1–2 business days)",       cents: 1999, minDays: 1, maxDays: 2 },
    };

    const allowFree = subtotalCents >= FREE_THRESHOLD_CENTS;

    // Validate requested selection
    let shippingMethodId = SHIPPING_METHODS[shippingMethodIdRaw] ? shippingMethodIdRaw : "standard";
    if (shippingMethodId === "free" && !allowFree) shippingMethodId = "standard";

    // Choose which methods to offer
    let offered = ["standard", "priority", "express"];
    if (allowFree) offered = ["free", "priority", "express"]; // or include standard too if you want

    // Put selected method first so Stripe preselects it
    offered = [shippingMethodId, ...offered.filter((id) => id !== shippingMethodId)];

    const shipping_options = offered.map((id) => {
      const o = SHIPPING_METHODS[id];
      return {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: o.cents, currency: "usd" },
          display_name: o.label,
          delivery_estimate: {
            minimum: { unit: "business_day", value: o.minDays },
            maximum: { unit: "business_day", value: o.maxDays },
          },
        },
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email || undefined,
      line_items,

      shipping_address_collection: { allowed_countries: ["US"] },
      shipping_options,

      success_url: `${PUBLIC_BASE_URL}/success.html?order=${encodeURIComponent(orderId)}`,
      cancel_url: `${PUBLIC_BASE_URL}/shipping.html`,

      metadata: {
        orderId,
        userId: userId || "",
        email,
        shippingMethodId,
        subtotalCents: String(subtotalCents),
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
   - Writes order + order_lines
   - INCREMENTS inventory for submitted sell orders
========================= */
app.post("/api/submit", async (req, res) => {
  try {
    const name = String(req.body?.name || "Sell Customer").trim();
    const email = String(req.body?.email || "").trim();
    const order = Array.isArray(req.body?.order) ? req.body.order : [];

    if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: "Missing/invalid email" });
    if (!order.length) return res.status(400).json({ ok: false, error: "Empty sell order" });

    const orderId = crypto.randomUUID();
    const userIdRaw = getSessionUserId(req);
    const userId = isUuid(userIdRaw) ? userIdRaw : null;

    const lines = [];
    let totalCents = 0;

    for (const l of order) {
      const sku = String(l?.sku || "").trim();
      const cardName = String(l?.name || "").trim();
      const condition = normalizeCondition(l?.condition); // normalize to full
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

    if (!lines.length) return res.status(400).json({ ok: false, error: "No valid items in sell order" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO app.orders
          (id, user_id, type, status, total_cents, customer_name, customer_email)
         VALUES
          ($1, $2, 'sell', 'submitted', $3, $4, $5)`,
        [orderId, userId, totalCents, name, email]
      );

      for (const ln of lines) {
        await client.query(
          `INSERT INTO app.order_lines
            (id, order_id, sku, name, condition, qty, unit_price_cents, line_total_cents)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            crypto.randomUUID(),
            orderId,
            ln.sku,
            ln.name,
            ln.condition,
            ln.qty,
            ln.unitPriceCents,
            ln.lineTotalCents,
          ]
        );
      }

// Decrease "max capacity" on the buylist/selllist table
for (const ln of lines) {
  const tab = String(ln.condition || "").toUpperCase(); // NM/LP/MP
  const col =
    tab === "LP" ? "max_lp" :
    tab === "MP" ? "max_mp" :
    "max_nm";

  const r = await client.query(
    `UPDATE app.selllist
        SET ${col} = GREATEST(${col} - $2, 0),
            updated_at = NOW()
      WHERE sku = $1`,
    [ln.sku, ln.qty]
  );

  // Optional: if you want strict behavior (error when sku missing)
  if (r.rowCount === 0) {
    throw new Error(`Selllist row missing for sku ${ln.sku}`);
  }
}

      // Increment inventory (auto-create row if missing)
      for (const ln of lines) {
        const col = stockColumnForCondition(ln.condition); // safe
        // Ensure NOT NULL name
        const safeName = (typeof ln.name === "string" && ln.name.trim()) ? ln.name.trim() : ln.sku;

        await client.query(
          `INSERT INTO app.inventory
            (sku, name, price_cents, image, stock_nm, stock_lp, stock_mp, stock_hp, updated_at)
           VALUES
            ($1, $2, 0, NULL, 0, 0, 0, 0, NOW())
           ON CONFLICT (sku) DO NOTHING`,
          [ln.sku, safeName]
        );

        await client.query(
          `UPDATE app.inventory
              SET ${col} = ${col} + $2,
                  updated_at = NOW()
            WHERE sku = $1`,
          [ln.sku, ln.qty]
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

// ... inside app.post("/api/submit", async (req, res) => { ... })

    // after COMMIT, before return res.json(...)
    // ---------------------------------------
    // EMAILS (SELL ORDER)
    // ---------------------------------------
    if (resend && EMAIL_FROM) {
      const totalNice = `$${(totalCents / 100).toFixed(2)}`;

      // build readable lines for the email
      const emailLines = lines.map((l) => {
        const unit = `$${(Number(l.unitPriceCents || 0) / 100).toFixed(2)}`;
        const lineT = `$${(Number(l.lineTotalCents || 0) / 100).toFixed(2)}`;
        return `${l.qty}x ${l.name} — ${l.condition} — ${unit} each = ${lineT}`;
      });

      // 1) send to you (OWNER_EMAIL)
      if (OWNER_EMAIL) {
        try {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: OWNER_EMAIL,
            subject: `New SELL order ${orderId}`,
            text:
              `Sell Order: ${orderId}\n` +
              `Customer: ${name} <${email}>\n` +
              `Total: ${totalNice}\n\n` +
              emailLines.join("\n"),
          });
        } catch (e) {
          console.error("Sell email to owner failed:", e);
        }
      }

      // 2) send receipt/confirmation to customer
      if (email) {
        try {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: email,
            subject: `Riftbound Sell Order Confirmation (${orderId})`,
            text:
              `Thanks! We received your sell order.\n` +
              `Order: ${orderId}\n` +
              `Total: ${totalNice}\n\n` +
              emailLines.join("\n"),
          });
        } catch (e) {
          console.error("Sell email to customer failed:", e);
        }
      }
    }

    return res.json({ ok: true, orderId });

    return res.json({ ok: true, orderId });
  } catch (e) {
    console.error("Sell submit error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Could not submit" });
  }
});

app.get("/api/catalog", async (req, res) => {
  try {

    const t = await pool.query(`
      SELECT table_schema
      FROM information_schema.tables
      WHERE table_name = 'inventory'
        AND table_schema IN ('app','public')
      ORDER BY CASE WHEN table_schema='app' THEN 0 ELSE 1 END
      LIMIT 1
    `);

    const schema = t.rows?.[0]?.table_schema;
    if (!schema) {
      return res.status(500).json({ ok: false, error: "Inventory table not found (app/public)." });
    }

    const c = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='inventory'
      `,
      [schema]
    );
    const cols = new Set(c.rows.map(r => r.column_name));

    const hasSplitStock =
      cols.has("stock_nm") && cols.has("stock_lp") && cols.has("stock_mp") && cols.has("stock_hp");
    const hasSingleStock = cols.has("stock");

    // new optional metadata columns
    const hasMeta =
      cols.has("set_code") && cols.has("card_number") && cols.has("rarity") && cols.has("foil");

    // 3) Query inventory in a way that matches your schema
    let r;
    if (hasSplitStock) {
      r = await pool.query(`
        SELECT sku, name, price_cents, image,
               stock_nm, stock_lp, stock_mp, stock_hp
               ${hasMeta ? ", set_code, card_number, rarity, foil" : ""}
        FROM ${schema}".inventory
        ORDER BY name
      `);
    } else if (hasSingleStock) {
      r = await pool.query(`
        SELECT sku, name, price_cents, image,
               stock
               ${hasMeta ? ", set_code, card_number, rarity, foil" : ""}
        FROM ${schema}.inventory
        ORDER BY name
      `);
    } else {
      return res.status(500).json({
        ok: false,
        error: `Inventory table missing stock columns (need stock OR stock_nm/stock_lp/stock_mp/stock_hp).`,
      });
    }

    // 4) Build catalog in the format your buy.js expects (keyed by SKU)
    const catalog = {};
    for (const row of r.rows) {
      const meta = hasMeta ? {
        set_code: row.set_code || null,
        card_number: row.card_number || null,
        rarity: row.rarity || null,
        foil: !!row.foil,
      } : {
        set_code: null,
        card_number: null,
        rarity: null,
        foil: false,
      };

      if (hasSplitStock) {
        catalog[row.sku] = {
          name: row.name,
          price_cents: row.price_cents,
          image: row.image,
          stock: {
            "Near Mint": Number(row.stock_nm || 0),
            "Lightly Played": Number(row.stock_lp || 0),
            "Moderately Played": Number(row.stock_mp || 0),
            "Heavily Played": Number(row.stock_hp || 0),
          },
          ...meta,
        };
      } else {
        // single stock column -> treat as NM for now
        const nm = Number(row.stock || 0);
        catalog[row.sku] = {
          name: row.name,
          price_cents: row.price_cents,
          image: row.image,
          stock: {
            "Near Mint": nm,
            "Lightly Played": 0,
            "Moderately Played": 0,
            "Heavily Played": 0,
          },
          ...meta,
        };
      }
    }

    return res.json({ ok: true, catalog });
  } catch (e) {
    console.error("catalog error:", e);
    return res.status(500).json({ ok: false, error: "Catalog load failed" });
  }
});

app.get("/api/selllist", async (req, res) => {
  try {
    const r = await pool.query(
      `
      SELECT
        sku,
        name,
        image,
        price_nm,
        price_lp,
        price_mp,
        max_nm,
        max_lp,
        max_mp
      FROM app.selllist
      ORDER BY sku
      `
    );

    const selllist = {};
    for (const row of r.rows) {
      selllist[row.sku] = {
        name: row.name,
        image: row.image || null,
        prices: {
          NM: (Number(row.price_nm) || 0) / 100,
          LP: (Number(row.price_lp) || 0) / 100,
          MP: (Number(row.price_mp) || 0) / 100,
        },
        max: {
          NM: Number(row.max_nm) || 0,
          LP: Number(row.max_lp) || 0,
          MP: Number(row.max_mp) || 0,
        },
      };
    }

    return res.json({ ok: true, selllist });
  } catch (e) {
    console.error("selllist db error:", e);
    return res.status(500).json({ ok: false, error: "Selllist load failed" });
  }
});


    const schema = t.rows?.[0]?.table_schema;
    if (!schema) {
      return res.status(500).json({ ok: false, error: "Inventory table not found (app/public)." });
    }

    // 2) Detect which columns exist
    const c = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='inventory'
      `,
      [schema]
    );
    const cols = new Set(c.rows.map(r => r.column_name));

    const hasSplitStock =
      cols.has("stock_nm") && cols.has("stock_lp") && cols.has("stock_mp") && cols.has("stock_hp");
    const hasSingleStock = cols.has("stock");

    // 3) Query inventory in a way that matches your schema
    let r;
    if (hasSplitStock) {
      r = await pool.query(`
        SELECT sku, name, price_cents, image, stock_nm, stock_lp, stock_mp, stock_hp
        FROM ${schema}.inventory
        ORDER BY name
      `);
    } else if (hasSingleStock) {
      r = await pool.query(`
        SELECT sku, name, price_cents, image, stock
        FROM ${schema}.inventory
        ORDER BY name
      `);
    } else {
      return res.status(500).json({
        ok: false,
        error: `Inventory table missing stock columns (need stock OR stock_nm/stock_lp/stock_mp/stock_hp).`,
      });
    }

    // 4) Build catalog in the format your buy.js expects
    const catalog = {};
    for (const row of r.rows) {
      if (hasSplitStock) {
        catalog[row.sku] = {
          name: row.name,
          price_cents: row.price_cents,
          image: row.image,
          stock: {
            "Near Mint": Number(row.stock_nm || 0),
            "Lightly Played": Number(row.stock_lp || 0),
            "Moderately Played": Number(row.stock_mp || 0),
            "Heavily Played": Number(row.stock_hp || 0),
          },
        };
      } else {
        // single stock column -> treat as NM for now
        const nm = Number(row.stock || 0);
        catalog[row.sku] = {
          name: row.name,
          price_cents: row.price_cents,
          image: row.image,
          stock: {
            "Near Mint": nm,
            "Lightly Played": 0,
            "Moderately Played": 0,
            "Heavily Played": 0,
          },
        };
      }
    }

    return res.json({ ok: true, catalog });
  } catch (e) {
    console.error("catalog error:", e); // IMPORTANT: this will show the real cause in Render logs
    return res.status(500).json({ ok: false, error: "Catalog load failed" });
  }
});



/* =========================
   AUTH (DB-backed)
========================= */
app.post("/api/auth/signup", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();

    const a = req.body?.address && typeof req.body.address === "object" ? req.body.address : null;
    const address = {
      line1: String(a?.line1 || "").trim(),
      line2: String(a?.line2 || "").trim(),
      city: String(a?.city || "").trim(),
      state: String(a?.state || "").trim(),
      postal: String(a?.postal || "").trim(),
      country: String(a?.country || "US").trim(),
    };

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "Valid email required" });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be 8+ characters" });
    }
    if (!address.line1 || !address.city || !address.state || !address.postal) {
      return res.status(400).json({ ok: false, error: "Address required (line1, city, state, postal)." });
    }

    const exists = await pool.query(`SELECT 1 FROM app.users WHERE email=$1`, [email]);
    if (exists.rowCount) {
      return res.status(409).json({ ok: false, error: "Email already in use" });
    }

    const hash = await bcrypt.hash(password, 12);
    const id = crypto.randomUUID();

    await pool.query(
      `INSERT INTO app.users (
         id, email, name, password_hash,
         address_line1, address_line2, address_city, address_state, address_postal, address_country,
         address_updated_at
       )
       VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9, $10,
         NOW()
       )`,
      [
        id,
        email,
        name || null,
        hash,
        address.line1,
        address.line2 || null,
        address.city,
        address.state,
        address.postal,
        address.country || "US",
      ]
    );

    setSession(res, id);

    return res.json({ ok: true, user: { id, email, name, address } });
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

  res.json({ ok: true, user: { id: u.id, email: u.email, name: u.name, address } });
});

app.post("/api/me/address", requireAuth, async (req, res) => {
  try {
    const a = req.body?.address || {};
    const next = {
      line1: String(a.line1 || "").trim(),
      line2: String(a.line2 || "").trim(),
      city: String(a.city || "").trim(),
      state: String(a.state || "").trim(),
      postal: String(a.postal || "").trim(),
      country: String(a.country || "US").trim(),
    };

    if (!next.line1 || !next.city || !next.state || !next.postal) {
      return res.status(400).json({ ok: false, error: "Missing required fields (line1, city, state, postal)." });
    }

    const r = await pool.query(
      `UPDATE app.users
          SET address_line1=$2, address_line2=$3, address_city=$4, address_state=$5,
              address_postal=$6, address_country=$7, address_updated_at=NOW()
        WHERE id=$1`,
      [req.userId, next.line1, next.line2 || null, next.city, next.state, next.postal, next.country || "US"]
    );

    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "User not found" });
    return res.json({ ok: true, address: next });
  } catch (e) {
    console.error("save address error:", e);
    return res.status(500).json({ ok: false, error: "Could not save address" });
  }
});

/* =========================
   MY ORDERS
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
   ADMIN: LIST ALL ORDERS
========================= */
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const ordersRes = await pool.query(
      `SELECT id, user_id, type, status, total_cents, created_at,
              customer_name, customer_email,
              ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country,
              stripe_session_id
         FROM app.orders
        ORDER BY created_at DESC
        LIMIT 500`
    );

    const orders = ordersRes.rows;
    if (!orders.length) return res.json({ ok: true, orders: [] });

    const ids = orders.map((o) => o.id);

    const linesRes = await pool.query(
      `SELECT order_id, sku, name, condition, qty, unit_price_cents, line_total_cents
         FROM app.order_lines
        WHERE order_id = ANY($1::uuid[])
        ORDER BY order_id, name`,
      [ids]
    );

    const linesByOrder = new Map();
    for (const l of linesRes.rows) {
      if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, []);
      linesByOrder.get(l.order_id).push(l);
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
  } catch (e) {
    console.error("Admin orders error:", e);
    res.status(500).json({ ok: false, error: "Failed to load orders" });
  }
});

/* =========================
   ADMIN: SEED INVENTORY FROM catalog.json
   (THIS is where your "name cannot be null" fix lives)
========================= */
app.post("/api/admin/seed-inventory", requireAdmin, async (req, res) => {
  try {
    const catalog = readJsonSafe(CATALOG_PATH) || {};
    const entries = Object.entries(catalog);

    const client = await pool.connect();
    let upserted = 0;
    let currentSku = "";

    try {
      await client.query("BEGIN");

      for (const [rawSku, p] of entries) {
        const sku = String(rawSku || "").trim();
        if (!sku) continue;
        currentSku = sku;

        const obj = p && typeof p === "object" ? p : {};

        const nameRaw =
          typeof obj.name === "string" ? obj.name.trim() : "";

        // keep as "" here; SQL will enforce fallback to sku if blank
        const name = nameRaw;

        const priceCents = Number.isFinite(Number(obj.price_cents))
          ? Number(obj.price_cents)
          : 0;

        const image =
          typeof obj.image === "string" && obj.image.trim()
            ? obj.image.trim()
            : null;

        const stockObj =
          obj.stock && typeof obj.stock === "object" ? obj.stock : {};

        const stockNm = Number(stockObj["Near Mint"] ?? 0) || 0;
        const stockLp = Number(stockObj["Lightly Played"] ?? 0) || 0;
        const stockMp = Number(stockObj["Moderately Played"] ?? 0) || 0;
        const stockHp = Number(stockObj["Heavily Played"] ?? 0) || 0;

        await client.query(
          `
          INSERT INTO app.inventory
            (sku, name, price_cents, image, stock_nm, stock_lp, stock_mp, stock_hp, updated_at)
          VALUES
            (
              $1::text,
              COALESCE(NULLIF($2::text, ''), $1::text),
              $3::int,
              $4::text,
              $5::int,
              $6::int,
              $7::int,
              $8::int,
              NOW()
            )
          ON CONFLICT (sku) DO UPDATE SET
            name        = EXCLUDED.name,
            price_cents = EXCLUDED.price_cents,
            image       = EXCLUDED.image,
            stock_nm    = EXCLUDED.stock_nm,
            stock_lp    = EXCLUDED.stock_lp,
            stock_mp    = EXCLUDED.stock_mp,
            stock_hp    = EXCLUDED.stock_hp,
            updated_at  = NOW()
          `,
          [sku, name, priceCents, image, stockNm, stockLp, stockMp, stockHp]
        );

        upserted++;
      }

      await client.query("COMMIT");
      return res.json({ ok: true, upserted });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("seed inventory failed on sku:", currentSku, e);
      return res.status(500).json({
        ok: false,
        error: `Seed failed on SKU: ${currentSku}`,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("seed inventory error:", e);
    return res.status(500).json({ ok: false, error: "Seed failed" });
  }
});


app.post("/api/admin/seed-buylist", requireAdmin, async (req, res) => {
  try {
    const catalog = readJsonSafe(CATALOG_PATH) || {};
    const skus = Object.keys(catalog);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const sku of skus) {
        const p = catalog[sku] || {};
        const name = String(p.name || "").trim();
        const priceCents = Number(p.price_cents || 0);
        const image = p.image ? String(p.image).trim() : null;

        if (!sku || !name) continue;

        await client.query(
          `INSERT INTO app.buylist (sku, name, price_cents, image, updated_at)
           VALUES ($1,$2,$3,$4, now())
           ON CONFLICT (sku) DO UPDATE
             SET name=EXCLUDED.name,
                 price_cents=EXCLUDED.price_cents,
                 image=EXCLUDED.image,
                 updated_at=now()`,
          [sku, name, priceCents, image]
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    res.json({ ok: true, seeded: skus.length });
  } catch (e) {
    console.error("seed-buylist error:", e);
    res.status(500).json({ ok: false, error: "Seed buylist failed" });
  }
});

app.post("/api/admin/seed-selllist", requireAdmin, async (req, res) => {
  try {
    const selllist = readJsonSafe(SELLLIST_PATH) || {};
    const skus = Object.keys(selllist);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const sku of skus) {
        const p = selllist[sku] || {};
        const name = String(p.name || "").trim();
        const image = p.image ? String(p.image).trim() : null;

        // JS selllist uses dollars; store cents in DB
        const prices = p.prices || {};
        const max = p.max || {};

        const price_nm = Math.round(Number(prices.NM || 0) * 100);
        const price_lp = Math.round(Number(prices.LP || 0) * 100);
        const price_mp = Math.round(Number(prices.MP || 0) * 100);

        const max_nm = Math.max(0, Number(max.NM ?? 0));
        const max_lp = Math.max(0, Number(max.LP ?? 0));
        const max_mp = Math.max(0, Number(max.MP ?? 0));

        if (!sku || !name) continue;

        await client.query(
          `INSERT INTO app.selllist
            (sku, name, image, price_nm, price_lp, price_mp, max_nm, max_lp, max_mp, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
           ON CONFLICT (sku) DO UPDATE
             SET name=EXCLUDED.name,
                 image=EXCLUDED.image,
                 price_nm=EXCLUDED.price_nm,
                 price_lp=EXCLUDED.price_lp,
                 price_mp=EXCLUDED.price_mp,
                 max_nm=EXCLUDED.max_nm,
                 max_lp=EXCLUDED.max_lp,
                 max_mp=EXCLUDED.max_mp,
                 updated_at=now()`,
          [sku, name, image, price_nm, price_lp, price_mp, max_nm, max_lp, max_mp]
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    res.json({ ok: true, seeded: skus.length });
  } catch (e) {
    console.error("seed-selllist error:", e);
    res.status(500).json({ ok: false, error: "Seed selllist failed" });
  }
});

/* =========================
   HEALTH + START
========================= */
app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

