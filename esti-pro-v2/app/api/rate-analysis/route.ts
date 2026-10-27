import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import db from "../../../lib/db";

export const runtime = "nodejs";

const nsrDatabasePath = path.resolve(process.cwd(), "backend", "NSR_Items.db");

function parseStoredAnalysis(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findCustomAnalysis(code: string) {
  if (fs.existsSync(nsrDatabasePath)) {
    let customDb: Database.Database | undefined;
    try {
      customDb = new Database(nsrDatabasePath, { readonly: true, fileMustExist: true });
      const hasCustomRates = customDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_rates'").get();
      if (hasCustomRates) {
        const row = customDb.prepare("SELECT analysisRows FROM custom_rates WHERE LOWER(TRIM(code)) = LOWER(?)").get(code) as { analysisRows?: unknown } | undefined;
        if (row) return parseStoredAnalysis(row.analysisRows);
      }
    } finally {
      customDb?.close();
    }
  }

  // Compatibility with older installs where NSR analyses were stored in the main DSR database.
  const hasLegacyCustomRates = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_rates'").get();
  if (hasLegacyCustomRates) {
    const row = db.prepare("SELECT analysisRows FROM custom_rates WHERE LOWER(TRIM(code)) = LOWER(?)").get(code) as { analysisRows?: unknown } | undefined;
    if (row) return parseStoredAnalysis(row.analysisRows);
  }
  return null;
}

function addMissingBulkCostAmounts(rows: any[]) {
  let runningTotal = 0;
  return rows.map(row => {
    const description = String(row.description || "").trim();
    const upperDescription = description.toUpperCase();
    const amount = row.amount === null || row.amount === undefined ? null : Number(row.amount);
    if (row.row_type === "CR") {
      runningTotal += Number.isFinite(amount) ? amount as number : 0;
    } else if (/^TOTAL\b/.test(upperDescription) && Number.isFinite(amount)) {
      runningTotal = amount as number;
    } else if (/^(?:ADD|LESS|DEDUCT)\b/.test(upperDescription) && Number.isFinite(amount)) {
      runningTotal += amount as number;
    } else if (amount === null && /^COST\s+(?:OF|FOR)\s+\d+(?:\.\d+)?\s*KGS?\s*\(\s*=\s*\d+(?:\.\d+)?\s*(?:QUINTAL|QTL)\b/i.test(description)) {
      row.amount = Math.round((runningTotal + Number.EPSILON) * 100) / 100;
    }
    return row;
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = String(searchParams.get("code") || "").trim();
  if (!code) return NextResponse.json({ error: "Code is required" }, { status: 400 });

  try {
    const customAnalysis = findCustomAnalysis(code);
    if (customAnalysis !== null) return NextResponse.json(customAnalysis);

    const itemInfo = db.prepare("SELECT dar_item_id FROM dar_items WHERE LOWER(TRIM(item_code)) = LOWER(?)").get(code) as { dar_item_id: number } | undefined;
    if (!itemInfo) return NextResponse.json([]);

    const rows = db.prepare(`
      SELECT component_sequence, row_type, component_code, description, unit, quantity, rate, amount, amount_str, calc_mark, is_sub_ar
      FROM rate_analysis
      WHERE dar_item_id = ?
      ORDER BY component_sequence ASC
    `).all(itemInfo.dar_item_id) as any[];

    return NextResponse.json(addMissingBulkCostAmounts(rows));
  } catch (error) {
    console.error("API Error in /api/rate-analysis:", error);
    const message = error instanceof Error ? error.message : "Unknown database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
