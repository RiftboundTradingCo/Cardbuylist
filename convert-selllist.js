const fs = require("fs");
const { parse } = require("csv-parse/sync");

// Read CSV
const csv = fs.readFileSync("selllist.csv", "utf8");

// Detect delimiter: comma or semicolon
const firstLine = (csv.split(/\r?\n/)[0] || "");
const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";

// Parse
const rows = parse(csv, {
  columns: true,
  skip_empty_lines: true,
  delimiter,
  bom: true,        // handles hidden BOM from Excel
  trim: true
});

// Helper: get a column with flexible header names
function getCol(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && String(row[n]).trim() !== "") {
      return String(row[n]).trim();
    }
  }
  return "";
}

const output = {};
let skipped = 0;

for (const row of rows) {
  const sku = getCol(row, ["SKU", "sku", "Sku", "Card SKU", "card_sku", "cardsku"]);
  if (!sku) { skipped++; continue; }

  const name = getCol(row, ["Name", "name", "Card Name", "card_name"]);
  const image = getCol(row, ["Image", "image", "IMG", "img", "Path", "path"]);

  const nm = Number(getCol(row, ["NM", "nm"])) || 0;
  const lp = Number(getCol(row, ["LP", "lp"])) || 0;
  const mp = Number(getCol(row, ["MP", "mp"])) || 0;

  output[sku] = {
    name: name || sku,
    image: image || "",
    prices: { NM: nm, LP: lp, MP: mp }
  };
}

fs.writeFileSync("selllist.json", JSON.stringify(output, null, 2), "utf8");

console.log(`✅ Parsed rows: ${rows.length}`);
console.log(`✅ Converted ${Object.keys(output).length} cards`);
if (skipped) console.log(`⚠️ Skipped ${skipped} rows (missing SKU)`);
console.log(`✅ Delimiter detected: "${delimiter}"`);
console.log("✅ First header line:", firstLine);

