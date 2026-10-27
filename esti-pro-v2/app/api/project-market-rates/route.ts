import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import Database from "better-sqlite3";

export const runtime = "nodejs";

function normalizeProjectId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function getDatabasePath(projectId: string) {
  const temporary = /^TEMP-(\d{13})-([A-F0-9]{8})$/i.exec(projectId);
  if (temporary) return path.resolve(process.cwd(), "backend", "projects", `temp_estimate_${temporary[1]}-${temporary[2].toLowerCase()}.db`);
  const slug = projectId.replace(/[^A-Z0-9_-]+/g, "_").replace(/_+/g, "_").slice(0, 48) || "PROJECT";
  const suffix = createHash("sha256").update(projectId).digest("hex").slice(0, 10);
  return path.resolve(process.cwd(), "backend", "projects", `project-${slug}-${suffix}.db`);
}

function openProjectDatabase(projectId: string) {
  const databasePath = getDatabasePath(projectId);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS project_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_market_rates (
      code TEXT PRIMARY KEY,
      market_rate REAL NOT NULL CHECK (market_rate >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS project_custom_items (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      rate REAL NOT NULL DEFAULT 0,
      analysis_json TEXT NOT NULL DEFAULT '[]',
      is_external_ar INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database.prepare("INSERT INTO project_metadata (key, value) VALUES ('estimate_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(projectId);
  return database;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = normalizeProjectId(searchParams.get("projectId"));
  if (!projectId) return NextResponse.json({ error: "An active Estimate ID is required." }, { status: 400 });

  const databasePath = getDatabasePath(projectId);
  if (!fs.existsSync(databasePath)) return NextResponse.json({ projectId, marketRates: {} });

  let database: Database.Database | undefined;
  try {
    database = openProjectDatabase(projectId);
    const rows = database.prepare("SELECT code, market_rate FROM project_market_rates ORDER BY code").all() as Array<{ code: string; market_rate: number }>;
    const marketRates = Object.fromEntries(rows.map(row => [row.code, Number(row.market_rate)]));
    const customItems = database.prepare("SELECT code, description, unit, rate, analysis_json, is_external_ar FROM project_custom_items ORDER BY code").all() as Array<Record<string, any>>;
    return NextResponse.json({ projectId, marketRates, customItems: customItems.map(row => ({ ...row, analysisRows: JSON.parse(row.analysis_json || "[]"), isExternalAR: Boolean(row.is_external_ar) })) });
  } catch (error) {
    console.error("Project market-rate load error:", error);
    return NextResponse.json({ error: "Could not load this project's saved market rates." }, { status: 500 });
  } finally { database?.close(); }
}

export async function POST(request: Request) {
  let database: Database.Database | undefined;
  try {
    const body = await request.json();
    const projectId = normalizeProjectId(body?.projectId);
    const marketRates = body?.marketRates;
    if (!projectId) return NextResponse.json({ error: "An active Estimate ID is required." }, { status: 400 });
    if (marketRates !== undefined && (!marketRates || typeof marketRates !== "object" || Array.isArray(marketRates))) {
      return NextResponse.json({ error: "Market rates must be a code-to-rate object." }, { status: 400 });
    }

    const entries = Object.entries((marketRates || {}) as Record<string, unknown>).map(([rawCode, rawRate]) => {
      const code = String(rawCode).trim();
      const rate = Number(rawRate);
      if (!code || !Number.isFinite(rate) || rate < 0) throw new Error(`Invalid market rate for item ${rawCode}.`);
      return { code, rate };
    });

    database = openProjectDatabase(projectId);
    const customItems = body?.customItems;
    const deleteCustomCodes = body?.deleteCustomCodes;
    if (customItems !== undefined && !Array.isArray(customItems)) return NextResponse.json({ error: "Project custom items must be an array." }, { status: 400 });
    if (deleteCustomCodes !== undefined && !Array.isArray(deleteCustomCodes)) return NextResponse.json({ error: "deleteCustomCodes must be an array." }, { status: 400 });
    const saveData = database.transaction((rows: Array<{ code: string; rate: number }>, items?: any[], deletedCodes?: string[]) => {
      if (marketRates !== undefined) {
        database!.prepare("DELETE FROM project_market_rates").run();
        const insertRate = database!.prepare("INSERT INTO project_market_rates (code, market_rate) VALUES (?, ?)");
        for (const row of rows) insertRate.run(row.code, row.rate);
      }
      if (items) {
        const insertItem = database!.prepare(`INSERT INTO project_custom_items (code, description, unit, rate, analysis_json, is_external_ar, updated_at)
          VALUES (@code, @description, @unit, @rate, @analysis_json, @is_external_ar, CURRENT_TIMESTAMP)
          ON CONFLICT(code) DO UPDATE SET description=excluded.description, unit=excluded.unit, rate=excluded.rate,
          analysis_json=excluded.analysis_json, is_external_ar=excluded.is_external_ar, updated_at=CURRENT_TIMESTAMP`);
        for (const item of items) {
          const code = String(item?.code ?? "").trim();
          const rate = Number(item?.rate ?? 0);
          if (!code || !Number.isFinite(rate) || rate < 0 || (!item?.isExternalAR && !Array.isArray(item?.analysisRows))) throw new Error("A project item has invalid code, rate, or analysis rows.");
          insertItem.run({ code, description: String(item.description ?? ""), unit: String(item.unit ?? ""), rate,
            analysis_json: JSON.stringify(item.isExternalAR ? [] : item.analysisRows), is_external_ar: item.isExternalAR ? 1 : 0 });
        }
      }
      if (deletedCodes?.length) {
        const removeItem = database!.prepare("DELETE FROM project_custom_items WHERE code = ?");
        for (const code of deletedCodes) removeItem.run(code);
      }
    });
    saveData(entries, customItems, Array.isArray(deleteCustomCodes) ? deleteCustomCodes.map((code: unknown) => String(code).trim()).filter(Boolean) : []);
    return NextResponse.json({ success: true, projectId, savedCount: entries.length, savedItems: customItems?.length || 0 });
  } catch (error) {
    console.error("Project market-rate save error:", error);
    const message = error instanceof Error ? error.message : "Could not save this project's market rates.";
    return NextResponse.json({ error: message }, { status: 400 });
  } finally { database?.close(); }
}
