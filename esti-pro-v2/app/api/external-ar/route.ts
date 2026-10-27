import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
const dbPath = path.resolve(process.cwd(), "backend", "NSR_Items.db");

function openDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS external_rate_analyses (
    item_no TEXT PRIMARY KEY,
    parent_item_no TEXT,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    rate REAL NOT NULL CHECK(rate >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  return db;
}

export async function GET() {
  let db: Database.Database | undefined;
  try {
    db = openDb();
    const rows = db.prepare(`SELECT item_no, parent_item_no, description, unit, rate
      FROM external_rate_analyses ORDER BY item_no COLLATE NOCASE`).all();
    return NextResponse.json(rows);
  } catch (error) {
    console.error("GET external A/R error:", error);
    return NextResponse.json({ error: "Could not load External A/R items." }, { status: 500 });
  } finally { db?.close(); }
}

export async function POST(request: Request) {
  let db: Database.Database | undefined;
  try {
    const body = await request.json();
    const itemNo = String(body?.item_no ?? "").trim();
    const parentNo = String(body?.parent_item_no ?? "").trim() || null;
    const description = String(body?.description ?? "").trim();
    const unit = String(body?.unit ?? "").trim();
    const rawRate = String(body?.rate ?? "").trim();
    const rate = Number(rawRate);
    if (!itemNo || !description || !unit || !rawRate || !Number.isFinite(rate) || rate < 0) {
      return NextResponse.json({ error: "Item No., description, unit, and a valid non-negative rate are required." }, { status: 400 });
    }
    if (parentNo === itemNo) return NextResponse.json({ error: "An item cannot be its own parent." }, { status: 400 });

    db = openDb();
    if (parentNo && !db.prepare("SELECT 1 FROM external_rate_analyses WHERE item_no = ?").get(parentNo)) {
      return NextResponse.json({ error: "The selected parent item no longer exists." }, { status: 400 });
    }
    if (db.prepare("SELECT 1 FROM external_rate_analyses WHERE item_no = ?").get(itemNo)) {
      return NextResponse.json({ error: `External A/R item ${itemNo} already exists.` }, { status: 409 });
    }
    db.prepare(`INSERT INTO external_rate_analyses (item_no, parent_item_no, description, unit, rate)
      VALUES (?, ?, ?, ?, ?)`).run(itemNo, parentNo, description, unit, rate);
    return NextResponse.json({ item: { item_no: itemNo, parent_item_no: parentNo, description, unit, rate } });
  } catch (error) {
    console.error("POST external A/R error:", error);
    return NextResponse.json({ error: "Could not save External A/R item." }, { status: 500 });
  } finally { db?.close(); }
}

export async function DELETE(request: Request) {
  let db: Database.Database | undefined;
  try {
    const body = await request.json();
    const itemNo = String(body?.item_no ?? "").trim();
    if (!itemNo) return NextResponse.json({ error: "Item No. is required." }, { status: 400 });
    db = openDb();
    const deleted = db.transaction(() => {
      const pending = [itemNo];
      const visited = new Set<string>();
      while (pending.length) {
        const parent = pending.pop()!;
        if (visited.has(parent)) continue;
        visited.add(parent);
        const children = db!.prepare("SELECT item_no FROM external_rate_analyses WHERE parent_item_no = ?").all(parent) as Array<{ item_no: string }>;
        children.forEach(child => pending.push(child.item_no));
      }
      const remove = db!.prepare("DELETE FROM external_rate_analyses WHERE item_no = ?");
      visited.forEach(code => remove.run(code));
      return [...visited];
    })();
    return NextResponse.json({ success: true, deletedItems: deleted });
  } catch (error) {
    console.error("DELETE external A/R error:", error);
    return NextResponse.json({ error: "Could not delete External A/R item." }, { status: 500 });
  } finally { db?.close(); }
}
