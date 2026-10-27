import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
const databasePath = path.resolve(process.cwd(), "backend", "CPWD_Software_Backend.db");
const editableCloRatesPath = path.resolve(process.cwd(), "backend", "CLC_Rates.db");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = String(searchParams.get("period") || "").trim();
  const area = String(searchParams.get("area") || "").trim().toUpperCase();
  if (!/^\d{4}-(04|10)$/.test(period) || !["A", "B", "C"].includes(area)) {
    return NextResponse.json({ error: "Choose a valid half-year period and A, B, or C Area." }, { status: 400 });
  }

  for (const sourcePath of [editableCloRatesPath, databasePath]) {
    if (!fs.existsSync(sourcePath)) continue;
    let db: Database.Database | undefined;
    try {
      db = new Database(sourcePath, { readonly: true, fileMustExist: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('clc_wages', 'clc_rates') ORDER BY CASE name WHEN 'clc_wages' THEN 0 ELSE 1 END LIMIT 1").get() as { name: string } | undefined;
      if (!table) continue;
      const columns = new Set((db.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{ name: string }>).map(column => column.name));
      const required = ["period", "area", "unskilled", "semi_skilled", "skilled_average", "skilled", "highly_skilled"];
      if (required.some(column => !columns.has(column))) continue;
      const row = db.prepare(`SELECT unskilled, semi_skilled AS semiSkilled, skilled_average AS skilledAverage, skilled, highly_skilled AS highlySkilled FROM ${table.name} WHERE period = ? AND UPPER(area) = ?`).get(period, area) as Record<string, number> | undefined;
      if (!row) continue;
      if (Object.values(row).some(value => value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0)) {
        return NextResponse.json({ error: `CLC wage values for ${period}, ${area} Area are incomplete or invalid.` }, { status: 500 });
      }
      const [year, month] = period.split("-").map(Number);
      const periodLabel = month === 10 ? `October ${year}` : `April ${year} to September ${year}`;
      return NextResponse.json({ period, periodLabel, area, wages: row });
    } catch (error) {
      console.error("CLC wage lookup error:", error);
    } finally { db?.close(); }
  }
  return NextResponse.json({ error: "No CLC wages are available for this period and area." }, { status: 404 });
}

export async function POST(request: Request) {
  let db: Database.Database | undefined;
  try {
    const body = await request.json();
    const period = String(body?.period || "").trim();
    const area = String(body?.area || "").trim().toUpperCase();
    const wages = body?.wages || {};
    const wageKeys = ["unskilled", "semi_skilled", "skilled_average", "skilled", "highly_skilled"] as const;
    if (!/^\d{4}-(04|10)$/.test(period) || !["A", "B", "C"].includes(area)) {
      return NextResponse.json({ error: "Choose a valid half-year period and A, B, or C Area." }, { status: 400 });
    }
    const normalizedWages: Record<string, number> = {};
    for (const key of wageKeys) {
      const value = Number(wages[key]);
      if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: `A valid non-negative ${key.replace(/_/g, " ")} wage is required.` }, { status: 400 });
      normalizedWages[key] = value;
    }

    // User-imported CLC rates live in an app-owned file. The master DSR database
    // remains read-only in every application route.
    db = new Database(editableCloRatesPath);
    db.pragma("busy_timeout = 5000");
    db.exec(`CREATE TABLE IF NOT EXISTS clc_wages (
      period TEXT NOT NULL,
      area TEXT NOT NULL CHECK(area IN ('A','B','C')),
      unskilled REAL NOT NULL,
      semi_skilled REAL NOT NULL,
      skilled_average REAL NOT NULL,
      skilled REAL NOT NULL,
      highly_skilled REAL NOT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(period, area)
    )`);
    db.prepare(`INSERT INTO clc_wages (period, area, unskilled, semi_skilled, skilled_average, skilled, highly_skilled)
      VALUES (@period, @area, @unskilled, @semi_skilled, @skilled_average, @skilled, @highly_skilled)
      ON CONFLICT(period, area) DO UPDATE SET unskilled=excluded.unskilled, semi_skilled=excluded.semi_skilled,
      skilled_average=excluded.skilled_average, skilled=excluded.skilled, highly_skilled=excluded.highly_skilled,
      updated_at=CURRENT_TIMESTAMP`).run({ period, area, ...normalizedWages });
    return NextResponse.json({ success: true, period, area });
  } catch (error) {
    console.error("CLC wage save error:", error);
    return NextResponse.json({ error: "Could not save CLC wages to the backend database." }, { status: 500 });
  } finally { db?.close(); }
}
