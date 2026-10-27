import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import Database from "better-sqlite3";

export const runtime = "nodejs";

function normalizeProjectId(value: unknown) { return String(value ?? "").trim().toUpperCase(); }
function databasePath(projectId: string) {
  const temporary = /^TEMP-(\d{13})-([A-F0-9]{8})$/i.exec(projectId);
  if (temporary) return path.resolve(process.cwd(), "backend", "projects", `temp_estimate_${temporary[1]}-${temporary[2].toLowerCase()}.db`);
  const slug = projectId.replace(/[^A-Z0-9_-]+/g, "_").replace(/_+/g, "_").slice(0, 48) || "PROJECT";
  const suffix = createHash("sha256").update(projectId).digest("hex").slice(0, 10);
  return path.resolve(process.cwd(), "backend", "projects", `project-${slug}-${suffix}.db`);
}

function ensureSnapshotSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_market_rates (code TEXT PRIMARY KEY, market_rate REAL NOT NULL CHECK (market_rate >= 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS project_custom_items (
      code TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', rate REAL NOT NULL DEFAULT 0,
      analysis_json TEXT NOT NULL DEFAULT '[]', is_external_ar INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS estimate_snapshots (
      snapshot_id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      payload_json TEXT NOT NULL, sha256 TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshot_financial_parameters (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), name TEXT NOT NULL, value_json TEXT NOT NULL,
      PRIMARY KEY(snapshot_id, name)
    );
    CREATE TABLE IF NOT EXISTS snapshot_selected_items (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), item_key TEXT NOT NULL, item_code TEXT NOT NULL DEFAULT '',
      item_json TEXT NOT NULL, PRIMARY KEY(snapshot_id, item_key)
    );
    CREATE TABLE IF NOT EXISTS snapshot_measurement_entries (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), row_index INTEGER NOT NULL, entry_id TEXT NOT NULL DEFAULT '',
      item_code TEXT NOT NULL DEFAULT '', sl_no TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '',
      quantity REAL, rate REAL, amount REAL, row_json TEXT NOT NULL, PRIMARY KEY(snapshot_id, row_index)
    );
    CREATE TABLE IF NOT EXISTS snapshot_detailed_abstract_rows (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), row_index INTEGER NOT NULL, item_code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', amount REAL, row_json TEXT NOT NULL, PRIMARY KEY(snapshot_id, row_index)
    );
    CREATE TABLE IF NOT EXISTS snapshot_general_abstract_rows (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), row_index INTEGER NOT NULL, item_code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', amount REAL, row_json TEXT NOT NULL, PRIMARY KEY(snapshot_id, row_index)
    );
    CREATE TABLE IF NOT EXISTS snapshot_market_rates (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), code TEXT NOT NULL, market_rate REAL NOT NULL,
      PRIMARY KEY(snapshot_id, code)
    );
    CREATE TABLE IF NOT EXISTS snapshot_custom_items (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), code TEXT NOT NULL, item_json TEXT NOT NULL,
      PRIMARY KEY(snapshot_id, code)
    );
    CREATE TABLE IF NOT EXISTS snapshot_rate_analyses (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), item_code TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'master',
      analysis_json TEXT NOT NULL, PRIMARY KEY(snapshot_id, item_code)
    );
    CREATE TABLE IF NOT EXISTS snapshot_rate_analysis_rows (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), item_code TEXT NOT NULL, row_index INTEGER NOT NULL,
      row_type TEXT NOT NULL DEFAULT '', component_code TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '', quantity REAL, rate REAL, amount REAL, mark TEXT NOT NULL DEFAULT '', row_json TEXT NOT NULL,
      PRIMARY KEY(snapshot_id, item_code, row_index)
    );
    CREATE TABLE IF NOT EXISTS snapshot_history_rows (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), row_index INTEGER NOT NULL, row_json TEXT NOT NULL,
      PRIMARY KEY(snapshot_id, row_index)
    );
    CREATE TABLE IF NOT EXISTS snapshot_justification_rows (
      snapshot_id TEXT NOT NULL REFERENCES estimate_snapshots(snapshot_id), row_index INTEGER NOT NULL, row_json TEXT NOT NULL,
      PRIMARY KEY(snapshot_id, row_index)
    );
  `);
  const immutableTables = [
    "estimate_snapshots", "snapshot_financial_parameters", "snapshot_selected_items", "snapshot_measurement_entries",
    "snapshot_detailed_abstract_rows", "snapshot_general_abstract_rows", "snapshot_market_rates", "snapshot_custom_items",
    "snapshot_rate_analyses", "snapshot_rate_analysis_rows", "snapshot_history_rows", "snapshot_justification_rows",
  ];
  for (const table of immutableTables) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_prevent_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'Estimate snapshots are immutable'); END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_prevent_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'Estimate snapshots are immutable'); END;`);
  }
}

function asArray(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const projectId = normalizeProjectId(new URL(request.url).searchParams.get("projectId"));
  if (!projectId) return NextResponse.json({ error: "An active Estimate ID is required." }, { status: 400 });
  const file = databasePath(projectId);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "No saved estimate exists for this Estimate ID." }, { status: 404 });
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const hasSnapshots = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='estimate_snapshots'").get();
    if (!hasSnapshots) return NextResponse.json({ error: "This project database has no saved estimate snapshots yet." }, { status: 404 });
    const snapshot = db.prepare("SELECT snapshot_id, version, created_at, payload_json, sha256 FROM estimate_snapshots ORDER BY version DESC LIMIT 1").get() as any;
    if (!snapshot) return NextResponse.json({ error: "No saved estimate snapshot was found." }, { status: 404 });
    const actualHash = createHash("sha256").update(snapshot.payload_json).digest("hex");
    if (actualHash !== snapshot.sha256) return NextResponse.json({ error: "The saved estimate snapshot failed its SHA-256 integrity check." }, { status: 409 });
    return NextResponse.json({ snapshotId: snapshot.snapshot_id, version: snapshot.version, savedAt: snapshot.created_at, sha256: snapshot.sha256, estimate: JSON.parse(snapshot.payload_json) });
  } catch (error) {
    console.error("Project estimate load error:", error);
    return NextResponse.json({ error: "Could not load the saved project estimate." }, { status: 500 });
  } finally { db?.close(); }
}

export async function POST(request: Request) {
  let db: Database.Database | undefined;
  try {
    const body = await request.json();
    const projectId = normalizeProjectId(body?.projectId);
    const estimate = body?.estimate;
    if (!projectId || !estimate || typeof estimate !== "object" || Array.isArray(estimate)) {
      return NextResponse.json({ error: "An Estimate ID and estimate snapshot are required." }, { status: 400 });
    }
    if (!Array.isArray(estimate.estimateRows) || !estimate.projectDetails || typeof estimate.projectDetails !== "object") {
      return NextResponse.json({ error: "The estimate snapshot must include project details and measurement rows." }, { status: 400 });
    }

    const file = databasePath(projectId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    ensureSnapshotSchema(db);
    const snapshotId = randomUUID();
    let version = 0;
    const payloadJson = JSON.stringify(estimate);
    const sha256 = createHash("sha256").update(payloadJson).digest("hex");
    const measurementRows = asArray(estimate.estimateRows);
    const selectedItems = asArray(estimate.selectedItems);
    const customItems = asArray(estimate.customItems);
    const detailedRows = asArray(estimate.detailedAbstractRows).length ? asArray(estimate.detailedAbstractRows) : measurementRows;
    const generalRows = asArray(estimate.generalAbstractRows).length ? asArray(estimate.generalAbstractRows) : measurementRows;
    const rateList = estimate.marketRates && typeof estimate.marketRates === "object" ? Object.entries(estimate.marketRates) : [];
    const analyses = estimate.rateAnalyses && typeof estimate.rateAnalyses === "object" ? Object.entries(estimate.rateAnalyses) : [];
    for (const [code, value] of rateList) {
      if (!String(code).trim() || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`Invalid market rate for ${code}.`);
    }
    for (const item of customItems) {
      if (!String(item?.code ?? "").trim() || !Number.isFinite(Number(item?.rate ?? 0)) || Number(item?.rate ?? 0) < 0) {
        throw new Error("A project item has an invalid code or rate.");
      }
    }

    const saveSnapshot = db.transaction(() => {
      version = Number((db!.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM estimate_snapshots").get() as any).next_version);
      db!.prepare("INSERT INTO estimate_snapshots (snapshot_id, version, payload_json, sha256) VALUES (?, ?, ?, ?)").run(snapshotId, version, payloadJson, sha256);
      const parameterInsert = db!.prepare("INSERT INTO snapshot_financial_parameters (snapshot_id, name, value_json) VALUES (?, ?, ?)");
      for (const [name, value] of Object.entries(estimate.projectDetails)) parameterInsert.run(snapshotId, name, JSON.stringify(value));
      const selectedInsert = db!.prepare("INSERT INTO snapshot_selected_items (snapshot_id, item_key, item_code, item_json) VALUES (?, ?, ?, ?)");
      selectedItems.forEach((item: any, index: number) => selectedInsert.run(snapshotId, String(item?.id ?? item?.code ?? index), String(item?.code ?? item?.itemCode ?? item ?? ""), JSON.stringify(item)));
      const measurementInsert = db!.prepare(`INSERT INTO snapshot_measurement_entries
        (snapshot_id,row_index,entry_id,item_code,sl_no,description,unit,quantity,rate,amount,row_json)
        VALUES (@snapshot_id,@row_index,@entry_id,@item_code,@sl_no,@description,@unit,@quantity,@rate,@amount,@row_json)`);
      measurementRows.forEach((row: any, index: number) => measurementInsert.run({ snapshot_id: snapshotId, row_index: index,
        entry_id: String(row?.id ?? ""), item_code: String(row?.itemCode ?? ""), sl_no: String(row?.slNo ?? ""), description: String(row?.userDescription || row?.description || ""),
        unit: String(row?.unit ?? ""), quantity: numeric(row?.quantity), rate: numeric(row?.rate), amount: numeric(row?.amount), row_json: JSON.stringify(row) }));
      const saveAbstract = (table: string, rows: any[]) => {
        const insert = db!.prepare(`INSERT INTO ${table} (snapshot_id,row_index,item_code,description,amount,row_json) VALUES (?,?,?,?,?,?)`);
        rows.forEach((row, index) => insert.run(snapshotId, index, String(row?.itemCode ?? row?.code ?? ""), String(row?.description ?? ""), numeric(row?.amount), JSON.stringify(row)));
      };
      saveAbstract("snapshot_detailed_abstract_rows", detailedRows);
      saveAbstract("snapshot_general_abstract_rows", generalRows);
      const rateInsert = db!.prepare("INSERT INTO snapshot_market_rates (snapshot_id,code,market_rate) VALUES (?,?,?)");
      rateList.forEach(([code, rate]: [string, any]) => { if (Number.isFinite(Number(rate))) rateInsert.run(snapshotId, code, Number(rate)); });
      db!.prepare("DELETE FROM project_market_rates").run();
      const saveCurrentRate = db!.prepare("INSERT INTO project_market_rates (code,market_rate) VALUES (?,?) ON CONFLICT(code) DO UPDATE SET market_rate=excluded.market_rate,updated_at=CURRENT_TIMESTAMP");
      rateList.forEach(([code, rate]: [string, any]) => { if (Number.isFinite(Number(rate))) saveCurrentRate.run(code, Number(rate)); });
      const customInsert = db!.prepare("INSERT INTO snapshot_custom_items (snapshot_id,code,item_json) VALUES (?,?,?)");
      const saveCurrentCustom = db!.prepare(`INSERT INTO project_custom_items (code,description,unit,rate,analysis_json,is_external_ar,updated_at)
        VALUES (@code,@description,@unit,@rate,@analysis_json,@is_external_ar,CURRENT_TIMESTAMP)
        ON CONFLICT(code) DO UPDATE SET description=excluded.description,unit=excluded.unit,rate=excluded.rate,
        analysis_json=excluded.analysis_json,is_external_ar=excluded.is_external_ar,updated_at=CURRENT_TIMESTAMP`);
      customItems.forEach((item: any) => {
        if (!item?.code) return;
        customInsert.run(snapshotId, String(item.code), JSON.stringify(item));
        saveCurrentCustom.run({ code: String(item.code), description: String(item.description ?? ""), unit: String(item.unit ?? ""),
          rate: Number(item.rate) || 0, analysis_json: JSON.stringify(item.isExternalAR ? [] : asArray(item.analysisRows)), is_external_ar: item.isExternalAR || Number(item.is_external_ar) === 1 ? 1 : 0 });
      });
      const analysisInsert = db!.prepare("INSERT INTO snapshot_rate_analyses (snapshot_id,item_code,source,analysis_json) VALUES (?,?,?,?)");
      const analysisRowInsert = db!.prepare(`INSERT INTO snapshot_rate_analysis_rows
        (snapshot_id,item_code,row_index,row_type,component_code,description,unit,quantity,rate,amount,mark,row_json)
        VALUES (@snapshot_id,@item_code,@row_index,@row_type,@component_code,@description,@unit,@quantity,@rate,@amount,@mark,@row_json)`);
      analyses.forEach(([code, raw]: [string, any]) => {
        const info = raw && !Array.isArray(raw) && typeof raw === "object" ? raw : { rows: raw, source: "master" };
        const rows = asArray(info.rows);
        analysisInsert.run(snapshotId, code, String(info.source || "master"), JSON.stringify(rows));
        rows.forEach((row: any, index: number) => analysisRowInsert.run({ snapshot_id: snapshotId, item_code: code, row_index: index,
          row_type: String(row?.row_type ?? ""), component_code: String(row?.component_code ?? row?.code ?? ""), description: String(row?.description ?? ""),
          unit: String(row?.unit ?? ""), quantity: numeric(row?.quantity), rate: numeric(row?.rate), amount: numeric(row?.amount), mark: String(row?.mark ?? row?.calc_mark ?? ""), row_json: JSON.stringify(row) }));
      });
      const historyInsert = db!.prepare("INSERT INTO snapshot_history_rows (snapshot_id,row_index,row_json) VALUES (?,?,?)");
      asArray(estimate.historyRows).forEach((row, index) => historyInsert.run(snapshotId, index, JSON.stringify(row)));
      const justificationInsert = db!.prepare("INSERT INTO snapshot_justification_rows (snapshot_id,row_index,row_json) VALUES (?,?,?)");
      asArray(estimate.justificationRows).forEach((row, index) => justificationInsert.run(snapshotId, index, JSON.stringify(row)));
      db!.prepare("INSERT INTO project_metadata (key,value) VALUES ('estimate_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(projectId);
    });
    saveSnapshot.immediate();
    return NextResponse.json({ success: true, projectId, snapshotId, version, sha256 });
  } catch (error) {
    console.error("Project estimate save error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the estimate snapshot." }, { status: 500 });
  } finally { db?.close(); }
}
