#!/usr/bin/env node
/* Read-only DSR/DAR consistency audit. Writes a CSV of review flags; never edits a database. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  path.join(root, "CPWD_Software_Backend.db"),
  path.join(root, "backend", "CPWD_Software_Backend.db"),
  path.join(root, "backend", "NSR_Items.db"),
  ...walk(path.join(root, "backend", "projects")).filter(file => file.endsWith(".db")),
];
const output = path.join(root, "outputs", "dsr_database_audit.csv");
const findings = [];
const summary = new Map();
const canonicalRates = new Map();
const canonicalPath = path.join(root, "backend", "CPWD_Software_Backend.db");
if (fs.existsSync(canonicalPath)) {
  const canonicalDb = new Database(canonicalPath, { readonly: true, fileMustExist: true });
  if (tables(canonicalDb).has("dar_items")) {
    for (const row of canonicalDb.prepare("SELECT item_code,dar_rate FROM dar_items").all()) canonicalRates.set(normalizeCode(row.item_code), Number(row.dar_rate));
  }
  canonicalDb.close();
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
function csv(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function add(db, category, code, saved, expected, detail) {
  const delta = Number.isFinite(Number(saved)) && Number.isFinite(Number(expected))
    ? Number(saved) - Number(expected) : "";
  findings.push([db, category, code, saved ?? "", expected ?? "", delta, detail ?? ""]);
  summary.set(category, (summary.get(category) || 0) + 1);
}
function tables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
}
function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name));
}
function normalizeCode(value) { return String(value ?? "").trim().replace(/\*+$/, ""); }
function near(a, b, tolerance = 0.05) { return Math.abs(Number(a) - Number(b)) <= tolerance; }

for (const file of [...new Set(candidates)]) {
  if (!fs.existsSync(file)) continue;
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const tableSet = tables(db);
    const shortName = path.relative(root, file);

    if (tableSet.has("basic_rates")) {
      const cols = columns(db, "basic_rates");
      if (["code", "rate"].every(name => cols.has(name))) {
        const records = db.prepare("SELECT * FROM basic_rates").all();
        const byCode = new Map();
        for (const record of records) {
          const code = normalizeCode(record.code);
          if (!code) continue;
          const rates = byCode.get(code) || new Set();
          rates.add(Number(record.rate));
          byCode.set(code, rates);
        }
        for (const [code, rates] of byCode) {
          if (rates.size > 1) add(shortName, "BASIC_RATE_CONFLICT", code, [...rates].join(" | "), "one consistent rate", "Same normalized basic-rate code has multiple stored rates.");
        }
      }
    }

    if (tableSet.has("dar_items") && tableSet.has("rate_analysis")) {
      const darCols = columns(db, "dar_items");
      const raCols = columns(db, "rate_analysis");
      if (["dar_item_id", "item_code", "dar_rate"].every(name => darCols.has(name)) && ["dar_item_id", "component_sequence", "row_type", "description", "amount"].every(name => raCols.has(name))) {
        const darItems = db.prepare("SELECT dar_item_id,item_code,dar_rate,unit FROM dar_items").all();
        const rowsById = new Map();
        const allRows = db.prepare("SELECT * FROM rate_analysis ORDER BY dar_item_id, component_sequence").all();
        for (const row of allRows) {
          const rows = rowsById.get(row.dar_item_id) || [];
          rows.push(row);
          rowsById.set(row.dar_item_id, rows);
          if (String(row.row_type).toUpperCase() === "CR" && row.quantity != null && row.rate != null && row.amount != null) {
            const qty = Number(row.quantity), rate = Number(row.rate), amount = Number(row.amount);
            const unitPrefix = String(row.unit || "").match(/^\s*(\d+(?:\.\d+)?)(?=\s|$)/);
            const divisor = unitPrefix ? Number(unitPrefix[1]) : 1;
            const direct = qty * rate;
            const bulk = divisor > 1 ? direct / divisor : direct;
            if (!near(amount, direct) && !near(amount, bulk)) {
              add(shortName, "COMPONENT_AMOUNT_MISMATCH", `${row.component_code || "?"} (AR ${row.dar_item_id}, row ${row.component_sequence})`, amount, direct, `Neither Qty×Rate nor Qty×Rate/${divisor} matches saved Amount.`);
            }
          }
        }

        const basicRates = tableSet.has("basic_rates")
          ? db.prepare("SELECT code,rate,description,unit FROM basic_rates").all()
          : [];
        const basicByCode = new Map(basicRates.map(row => [normalizeCode(row.code), row]));
        for (const item of darItems) {
          const rows = rowsById.get(item.dar_item_id) || [];
          const terminal = [...rows].reverse().find(row => /^\s*SAY\s*$/i.test(String(row.description || "")) && row.amount != null);
          const costOne = [...rows].reverse().find(row => /^\s*COST\s+(?:OF|FOR)\s+1(?:\.0+)?(?:\s|$)/i.test(String(row.description || "")) && row.amount != null);
          if (terminal && item.dar_rate != null && Number.isFinite(Number(item.dar_rate)) && !near(item.dar_rate, terminal.amount)) {
            add(shortName, "DAR_RATE_VS_SAY", item.item_code, item.dar_rate, terminal.amount, `DAR rate disagrees with terminal Say row in analysis ${item.dar_item_id}.`);
          }
          if (costOne && item.dar_rate != null && Number.isFinite(Number(item.dar_rate)) && !near(item.dar_rate, costOne.amount)) {
            add(shortName, "DAR_RATE_VS_COST_OF_ONE", item.item_code, item.dar_rate, costOne.amount, `DAR rate disagrees with Cost of 1 row in analysis ${item.dar_item_id}.`);
          }
          // In legacy CPWD analyses, the W mark may be placed on the total
          // after Water charges. Compare component rows with the base TOTAL
          // immediately before the first financial addition instead.
          const firstChargeIndex = rows.findIndex(row => /^(?:ADD|LESS|DEDUCT)\b/i.test(String(row.description || "").trim()));
          const baseTotal = rows.find((row, index) => index < (firstChargeIndex < 0 ? rows.length : firstChargeIndex) &&
            /^TOTAL$/i.test(String(row.description || "").trim()) && row.amount != null);
          if (baseTotal) {
            const crTotal = rows.filter(row => String(row.row_type).toUpperCase() === "CR")
              .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
            if (!near(baseTotal.amount, crTotal)) {
              add(shortName, "BASE_TOTAL_VS_CR_SUM", item.item_code, baseTotal.amount, crTotal, `Base TOTAL before financial additions differs from cost-row amounts in analysis ${item.dar_item_id}.`);
            }
          }
          for (const row of rows) {
            if (String(row.row_type).toUpperCase() !== "CR" || !row.component_code) continue;
            const master = basicByCode.get(normalizeCode(row.component_code));
            // A numeric zero in the DAR analysis is an explicit item-level
            // override (common for carriage already included elsewhere). Only
            // compare non-zero DAR rates with the basic-rate catalog.
            if (master && row.rate != null && Number(row.rate) !== 0 && master.rate != null && !near(row.rate, master.rate, 0.005)) {
              add(shortName, "ANALYSIS_RATE_VS_BASIC_RATE", `${item.item_code} / ${row.component_code}`, row.rate, master.rate, `Analysis description: ${row.description}; basic-rate description: ${master.description}. Non-zero rate differs from catalog; confirm source.`);
            }
          }
        }

        // Basic-rate catalog entries are mirrored in dar_items for legacy
        // lookups. They are not DAR item-number duplicates; basic_rates is the
        // canonical keyed table and already enforces one row per component code.
        const duplicateCodes = db.prepare("SELECT item_code,COUNT(*) n,MIN(dar_rate) lo,MAX(dar_rate) hi FROM dar_items WHERE COALESCE(source_sheet,'') <> 'Basic rates' GROUP BY item_code HAVING COUNT(*)>1").all();
        for (const row of duplicateCodes) {
          if (!near(row.lo, row.hi, 0.005)) add(shortName, "DUPLICATE_DAR_CODE_CONFLICT", row.item_code, `${row.lo} .. ${row.hi}`, "one consistent rate", `${row.n} rows share this code.`);
        }
      }
    }

    // Compare saved estimate snapshots with master DSR rates without changing them.
    if (tableSet.has("snapshot_measurement_entries")) {
      const snapCols = columns(db, "snapshot_measurement_entries");
      if (snapCols.has("item_code") && snapCols.has("rate")) {
        for (const row of db.prepare("SELECT item_code,rate FROM snapshot_measurement_entries").all()) {
          const code = normalizeCode(row.item_code);
          if (/^(?:NSR|50\.|51\.)/i.test(code) || !canonicalRates.has(code) || near(row.rate, canonicalRates.get(code), 0.005)) continue;
          add(shortName, "PROJECT_SNAPSHOT_STALE_DSR_RATE", code, row.rate, canonicalRates.get(code), "Saved measurement snapshot differs from canonical DSR master; review item source and do not auto-overwrite project data.");
        }
      }
    }
  } catch (error) {
    add(path.relative(root, file), "AUDIT_ERROR", "", "", "", error.message);
  } finally {
    if (db) db.close();
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const header = ["database", "category", "item_or_component_code", "saved_value", "expected_or_comparison", "difference", "details"];
fs.writeFileSync(output, [header, ...findings].map(row => row.map(csv).join(",")).join("\r\n"), "utf8");
console.log(`Read-only DSR/DAR audit complete: ${findings.length} review flags across ${candidates.filter(fs.existsSync).length} database files.`);
for (const [category, count] of [...summary.entries()].sort((a, b) => b[1] - a[1])) console.log(`${category}: ${count}`);
console.log(`Report: ${output}`);
