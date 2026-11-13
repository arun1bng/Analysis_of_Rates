import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const nsrDatabasePath = path.resolve(process.cwd(), "backend", "NSR_Items.db");
const legacyDatabasePath = path.resolve(process.cwd(), "backend", "CPWD_Software_Backend.db");

function openNsrDb() {
  fs.mkdirSync(path.dirname(nsrDatabasePath), { recursive: true });
  const db = new Database(nsrDatabasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_rates (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      rate REAL NOT NULL DEFAULT 0,
      analysisRows TEXT NOT NULL DEFAULT '[]',
      settings_json TEXT NOT NULL DEFAULT '{}',
      is_external_ar INTEGER NOT NULL DEFAULT 0,
      base_qty REAL,
      calc_method TEXT,
      clc_period TEXT,
      clc_area TEXT,
      conventional_gst_multiplier REAL,
      custom_charges_json TEXT NOT NULL DEFAULT '[]',
      exclude_a_marked_items INTEGER NOT NULL DEFAULT 1,
      is_parent_heading INTEGER NOT NULL DEFAULT 0,
      source_item_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const customRateColumns = new Set((db.prepare("PRAGMA table_info(custom_rates)").all() as Array<{ name: string }>).map(column => column.name));
  const migrations: Array<[string, string]> = [
    ["is_external_ar", "INTEGER NOT NULL DEFAULT 0"],
    ["settings_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["base_qty", "REAL"],
    ["calc_method", "TEXT"],
    ["clc_period", "TEXT"],
    ["clc_area", "TEXT"],
    ["conventional_gst_multiplier", "REAL"],
    ["custom_charges_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["exclude_a_marked_items", "INTEGER NOT NULL DEFAULT 1"],
    ["is_parent_heading", "INTEGER NOT NULL DEFAULT 0"],
    ["source_item_code", "TEXT"],
  ];
  for (const [column, definition] of migrations) {
    if (!customRateColumns.has(column)) db.exec(`ALTER TABLE custom_rates ADD COLUMN ${column} ${definition}`);
  }

  // Preserve saved NSRs from older versions the first time this separate file is opened.
  const migration = db.prepare("SELECT 1 FROM app_migrations WHERE name = ?").get("legacy-custom-rates-v1");
  if (!migration) {
    if (fs.existsSync(legacyDatabasePath)) {
      let legacy: Database.Database | undefined;
      try {
        legacy = new Database(legacyDatabasePath, { readonly: true, fileMustExist: true });
        const hasTable = legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_rates'").get();
        if (hasTable) {
          const columns = legacy.prepare("PRAGMA table_info(custom_rates)").all() as Array<{ name: string }>;
          const columnNames = new Set(columns.map(column => column.name));
          if (["code", "description", "unit", "rate", "analysisRows"].every(column => columnNames.has(column))) {
            const oldRows = legacy.prepare("SELECT code, description, unit, rate, analysisRows FROM custom_rates").all() as Array<Record<string, unknown>>;
            const insert = db.prepare(`INSERT OR IGNORE INTO custom_rates (code, description, unit, rate, analysisRows)
              VALUES (@code, @description, @unit, @rate, @analysisRows)`);
            const copyRows = db.transaction((rows: Array<Record<string, unknown>>) => {
              for (const row of rows) insert.run({
                code: String(row.code ?? ""), description: String(row.description ?? ""), unit: String(row.unit ?? ""),
                rate: Number(row.rate) || 0, analysisRows: typeof row.analysisRows === "string" ? row.analysisRows : "[]",
              });
            });
            copyRows(oldRows);
          }
        }
      } catch (error) {
        console.error("Could not migrate legacy custom rates:", error);
      } finally {
        legacy?.close();
      }
    }
    db.prepare("INSERT OR IGNORE INTO app_migrations (name) VALUES (?)").run("legacy-custom-rates-v1");
  }
  return db;
}

function parseItem(row: Record<string, any>) {
  let analysisRows: unknown[] = [];
  try {
    const parsed = JSON.parse(row.analysisRows || "[]");
    if (Array.isArray(parsed)) analysisRows = parsed;
  } catch {
    console.error(`Invalid analysisRows JSON for NSR ${row.code}`);
  }
  let nsrSettings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.settings_json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) nsrSettings = parsed;
  } catch { console.error(`Invalid settings JSON for NSR ${row.code}`); }
  let customCharges: unknown[] = [];
  try {
    const parsed = JSON.parse(row.custom_charges_json || "[]");
    if (Array.isArray(parsed)) customCharges = parsed;
  } catch { console.error(`Invalid custom charge settings for NSR ${row.code}`); }
  const settings = {
    ...nsrSettings,
    ...(row.base_qty !== null && row.base_qty !== undefined ? { baseQty: row.base_qty } : {}),
    ...(row.calc_method ? { calcMethod: row.calc_method } : {}),
    ...(row.clc_period ? { clcPeriod: row.clc_period } : {}),
    ...(row.clc_area ? { clcArea: row.clc_area } : {}),
    ...(row.conventional_gst_multiplier !== null && row.conventional_gst_multiplier !== undefined
      ? { conventionalGstMultiplier: row.conventional_gst_multiplier } : {}),
    ...(customCharges.length ? { customCharges } : {}),
    excludeAMarkedItems: typeof nsrSettings.excludeAMarkedItems === "boolean"
      ? nsrSettings.excludeAMarkedItems
      : Boolean(row.exclude_a_marked_items),
    isParentHeading: Boolean(row.is_parent_heading) || Boolean(nsrSettings.isParentHeading),
    ...(row.source_item_code ? { sourceItemCode: row.source_item_code } : {}),
  };
  return {
    ...row,
    ...settings,
    nsrSettings: settings,
    analysisRows,
    isExternalAR: Boolean(row.is_external_ar),
    isParentHeading: Boolean(row.is_parent_heading),
    baseQty: settings.baseQty ?? null,
    sourceItemCode: row.source_item_code ?? settings.sourceItemCode ?? null,
  };
}

export async function GET() {
  let db: Database.Database | undefined;
  try {
    db = openNsrDb();
    const rows = db.prepare("SELECT * FROM custom_rates ORDER BY code").all() as Array<Record<string, any>>;
    return NextResponse.json(rows.map(parseItem));
  } catch (error) {
    console.error("GET custom-rates error:", error);
    return NextResponse.json({ error: "Failed to fetch custom rates" }, { status: 500 });
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  let db: Database.Database | undefined;
  try {
    const body = await request.json();
    const code = String(body?.code ?? "").trim();
    const isExternalAR = body?.isExternalAR === true || body?.is_external_ar === true;
    if (!code) return NextResponse.json({ error: "An item code is required" }, { status: 400 });
    if (!isExternalAR && !Array.isArray(body?.analysisRows)) return NextResponse.json({ error: "analysisRows must be an array" }, { status: 400 });
    const description = String(body.description ?? "").trim();
    const unit = String(body.unit ?? "").trim();
    if (isExternalAR && (!description || !unit)) return NextResponse.json({ error: "External AR items require a description and unit." }, { status: 400 });
    if (isExternalAR && String(body.rate ?? "").trim() === "") return NextResponse.json({ error: "External AR items require a final rate." }, { status: 400 });
    const rate = Number(body?.rate);
    if (!Number.isFinite(rate) || rate < 0) return NextResponse.json({ error: "A valid non-negative rate is required" }, { status: 400 });
    const analysisRows = isExternalAR ? [] : body.analysisRows;
    const suppliedSettings = body?.nsrSettings && typeof body.nsrSettings === "object" && !Array.isArray(body.nsrSettings)
      ? body.nsrSettings as Record<string, unknown>
      : {};
    const settings = {
      ...{
          baseQty: body.baseQty,
          calcMethod: body.calcMethod,
          clcPeriod: body.clcPeriod,
          clcArea: body.clcArea,
          conventionalGstMultiplier: body.conventionalGstMultiplier,
          customCharges: body.customCharges,
          excludeAMarkedItems: body.excludeAMarkedItems,
          isParentHeading: body.isParentHeading,
          sourceItemCode: body.sourceItemCode,
        },
      ...suppliedSettings,
    };
    const baseQtyValue = Number(settings.baseQty);
    const baseQty = Number.isFinite(baseQtyValue) && baseQtyValue > 0 ? baseQtyValue : null;
    const calcMethod = String(settings.calcMethod ?? "Conventional DSR");
    const clcPeriod = String(settings.clcPeriod ?? "");
    const clcArea = String(settings.clcArea ?? "");
    const gstValue = Number(settings.conventionalGstMultiplier);
    const gstMultiplier = Number.isFinite(gstValue) && gstValue > 0 ? gstValue : null;
    const customCharges = Array.isArray(settings.customCharges) ? settings.customCharges : [];
    const excludeAMarkedItems = settings.excludeAMarkedItems !== false;
    const isParentHeading = Boolean(settings.isParentHeading ?? body.isParentHeading);
    const sourceItemCode = String(settings.sourceItemCode ?? body.sourceItemCode ?? "").trim() || null;
    db = openNsrDb();
    db.prepare(`INSERT INTO custom_rates (code, description, unit, rate, analysisRows, settings_json, is_external_ar,
      base_qty, calc_method, clc_period, clc_area, conventional_gst_multiplier, custom_charges_json,
      exclude_a_marked_items, is_parent_heading, source_item_code, updated_at)
      VALUES (@code, @description, @unit, @rate, @analysisRows, @settings_json, @is_external_ar,
      @base_qty, @calc_method, @clc_period, @clc_area, @conventional_gst_multiplier, @custom_charges_json,
      @exclude_a_marked_items, @is_parent_heading, @source_item_code, CURRENT_TIMESTAMP)
      ON CONFLICT(code) DO UPDATE SET description=excluded.description, unit=excluded.unit,
      rate=excluded.rate, analysisRows=excluded.analysisRows, settings_json=excluded.settings_json,
      is_external_ar=excluded.is_external_ar, base_qty=excluded.base_qty, calc_method=excluded.calc_method,
      clc_period=excluded.clc_period, clc_area=excluded.clc_area,
      conventional_gst_multiplier=excluded.conventional_gst_multiplier,
      custom_charges_json=excluded.custom_charges_json,
      exclude_a_marked_items=excluded.exclude_a_marked_items, is_parent_heading=excluded.is_parent_heading,
      source_item_code=excluded.source_item_code, updated_at=CURRENT_TIMESTAMP`).run({
      code, description, unit,
      rate, analysisRows: JSON.stringify(analysisRows), settings_json: JSON.stringify(settings), is_external_ar: isExternalAR ? 1 : 0,
      base_qty: isParentHeading || isExternalAR ? null : baseQty,
      calc_method: calcMethod, clc_period: clcPeriod, clc_area: clcArea,
      conventional_gst_multiplier: gstMultiplier, custom_charges_json: JSON.stringify(customCharges),
      exclude_a_marked_items: excludeAMarkedItems ? 1 : 0,
      is_parent_heading: isParentHeading ? 1 : 0,
      source_item_code: sourceItemCode,
    });
    return NextResponse.json({ success: true, code });
  } catch (error) {
    console.error("POST custom-rates error:", error);
    return NextResponse.json({ error: "Failed to save custom rate" }, { status: 500 });
  } finally {
    db?.close();
  }
}

export async function DELETE(request: Request) {
  let db: Database.Database | undefined;
  try {
    const body = await request.json();
    const code = String(body?.code ?? "").trim();
    if (!code) return NextResponse.json({ error: "An item code is required" }, { status: 400 });
    db = openNsrDb();
    const result = db.prepare("DELETE FROM custom_rates WHERE code = ?").run(code);
    return NextResponse.json({ success: true, deleted: result.changes > 0 });
  } catch (error) {
    console.error("DELETE custom-rates error:", error);
    return NextResponse.json({ error: "Failed to delete custom rate" }, { status: 500 });
  } finally {
    db?.close();
  }
}
