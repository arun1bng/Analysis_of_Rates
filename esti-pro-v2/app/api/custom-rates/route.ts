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
      is_external_ar INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const customRateColumns = new Set((db.prepare("PRAGMA table_info(custom_rates)").all() as Array<{ name: string }>).map(column => column.name));
  if (!customRateColumns.has("is_external_ar")) db.exec("ALTER TABLE custom_rates ADD COLUMN is_external_ar INTEGER NOT NULL DEFAULT 0");

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
  return { ...row, analysisRows, isExternalAR: Boolean(row.is_external_ar) };
}

export async function GET() {
  let db: Database.Database | undefined;
  try {
    db = openNsrDb();
    const rows = db.prepare("SELECT code, description, unit, rate, analysisRows, is_external_ar, created_at, updated_at FROM custom_rates ORDER BY code").all() as Array<Record<string, any>>;
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
    db = openNsrDb();
    db.prepare(`INSERT INTO custom_rates (code, description, unit, rate, analysisRows, is_external_ar, updated_at)
      VALUES (@code, @description, @unit, @rate, @analysisRows, @is_external_ar, CURRENT_TIMESTAMP)
      ON CONFLICT(code) DO UPDATE SET description=excluded.description, unit=excluded.unit,
      rate=excluded.rate, analysisRows=excluded.analysisRows, is_external_ar=excluded.is_external_ar, updated_at=CURRENT_TIMESTAMP`).run({
      code, description, unit,
      rate, analysisRows: JSON.stringify(analysisRows), is_external_ar: isExternalAR ? 1 : 0,
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
