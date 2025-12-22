const fs = require("fs");
const csv = require("csv-parse/sync");

const input = process.argv[2] || "catalog.csv";
const text = fs.readFileSync(input, "utf8");

const rows = csv.parse(text, { columns: true, skip_empty_lines: true });
const out = {};

for (const r of rows) {
  const sku = String(r.sku || "").trim();
  if (!sku) continue;

  out[sku] = {
    name: String(r.name || "").trim(),
    price_cents: Number(r.price_cents || 0),
    stock: {
      "Near Mint": Number(r.stock_near_mint || 0),
      "Lightly Played": Number(r.stock_lightly_played || 0),
      "Moderately Played": Number(r.stock_moderately_played || 0),
      "Heavily Played": Number(r.stock_heavily_played || 0),
    },
    image: String(r.image || "").trim()
  };
}

process.stdout.write(JSON.stringify(out, null, 2));
