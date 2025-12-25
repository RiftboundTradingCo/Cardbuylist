const fs = require("fs");
const { parse } = require("csv-parse/sync");

const INPUT = "selllist.csv";
const OUTPUT = "selllist.json";

if (!fs.existsSync(INPUT)) {
  console.error(`❌ Missing ${INPUT}. Put it in the same folder as this script.`);
  process.exit(1);
}

const csv = fs.readFileSync(INPUT, "utf8");

// Detect delimiter: comma or semicolon
const firstLine = (csv.split(/\r?\n/)[0] || "");
const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";

const rows = parse(csv, {
  columns: true,
  skip_empty_lines: true,
  delimiter,
  bom: true,
  trim: true
});

console.log(`✅ Parsed rows: ${rows.length}`);
console.log(`✅ Delimiter detected: "${delimiter}"`);

if (!rows.length) {
  console.error("❌ 0 rows parsed. Your CSV may be empty or not saved correctly.");
  process.exit(1);
}

console.log("🔎 Detected headers:", Object.keys(rows[0]));

function getCol(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && String(row[n]).trim() !== "") {
      return String(row[n]).trim();
    }
  }
  return "";
}

function num(val, fallback = 0) {
  const s = String(val ?? "").trim();
  if (!s) return fallback;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function int(val, fallback = 0) {
  const n = Math.floor(num(val, fallback));
  return Number.isFinite(n) ? n : fallback;
}

const output = {};
let skipped = 0;

for (const row of rows) {
  const sku = getCol(row, ["SKU", "sku", "Sku"]);
  if (!sku) { skipped++; continue; }

  const name = getCol(row, ["Name", "name"]) || sku;

  let image = getCol(row, ["Image", "image", "IMG", "img", "Path", "path"]);
  if (image && !image.startsWith("/")) image = "/" + image.replace(/^\/+/, "");

  const nm = num(getCol(row, ["NM", "nm"]), 0);
  const lp = num(getCol(row, ["LP", "lp"]), 0);
  const mp = num(getCol(row, ["MP", "mp"]), 0);

  // These MUST exist in CSV to show up in JSON:
  const max_nm = int(getCol(row, ["max_nm", "MAX_NM", "Max_NM", "Max NM", "max nm"]), 0);
  const max_lp = int(getCol(row, ["max_lp", "MAX_LP", "Max_LP", "Max LP", "max lp"]), 0);
  const max_mp = int(getCol(row, ["max_mp", "MAX_MP", "Max_MP", "Max MP", "max mp"]), 0);

  output[sku] = {
    name,
    image,
    prices: { NM: nm, LP: lp, MP: mp },
    max: { NM: max_nm, LP: max_lp, MP: max_mp }
  };
}

fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");

console.log(`✅ Converted ${Object.keys(output).length} cards`);
if (skipped) console.log(`⚠️ Skipped ${skipped} rows (missing SKU)`);

// show first item proof
const firstSku = Object.keys(output)[0];
console.log("🧪 First item preview:", firstSku, output[firstSku]);

