import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import Database from "better-sqlite3";

export const runtime = "nodejs";

const projectsDirectory = path.resolve(process.cwd(), "backend", "projects");
const tempIdPattern = /^TEMP-(\d{13})-([a-f0-9]{8})$/i;
const normalizeId = (value: unknown) => String(value ?? "").trim().toUpperCase();

function databasePath(projectId: string) {
  const temp = tempIdPattern.exec(projectId);
  if (temp) return path.join(projectsDirectory, `temp_estimate_${temp[1]}-${temp[2].toLowerCase()}.db`);
  const slug = projectId.replace(/[^A-Z0-9_-]+/g, "_").replace(/_+/g, "_").slice(0, 48) || "PROJECT";
  const suffix = createHash("sha256").update(projectId).digest("hex").slice(0, 10);
  return path.join(projectsDirectory, `project-${slug}-${suffix}.db`);
}

function ensureSessionSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_market_rates (code TEXT PRIMARY KEY, market_rate REAL NOT NULL CHECK (market_rate >= 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS project_custom_items (
      code TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', rate REAL NOT NULL DEFAULT 0,
      analysis_json TEXT NOT NULL DEFAULT '[]', is_external_ar INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS project_session_state (
      session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function saveSession(db: Database.Database, projectId: string, session: any) {
  ensureSessionSchema(db);
  db.prepare("INSERT INTO project_metadata (key,value) VALUES ('estimate_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(projectId);
  db.prepare(`INSERT INTO project_session_state (session_id,payload_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(session_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=CURRENT_TIMESTAMP`)
    .run(projectId, JSON.stringify(session));
  const marketRates = session?.marketRates && typeof session.marketRates === "object" ? Object.entries(session.marketRates) : [];
  db.prepare("DELETE FROM project_market_rates").run();
  const saveRate = db.prepare("INSERT INTO project_market_rates (code,market_rate) VALUES (?,?)");
  for (const [code, rawRate] of marketRates) {
    const rate = Number(rawRate);
    if (String(code).trim() && Number.isFinite(rate) && rate >= 0) saveRate.run(String(code).trim(), rate);
  }
  const saveItem = db.prepare(`INSERT INTO project_custom_items (code,description,unit,rate,analysis_json,is_external_ar,updated_at)
    VALUES (@code,@description,@unit,@rate,@analysis_json,@is_external_ar,CURRENT_TIMESTAMP)
    ON CONFLICT(code) DO UPDATE SET description=excluded.description,unit=excluded.unit,rate=excluded.rate,
    analysis_json=excluded.analysis_json,is_external_ar=excluded.is_external_ar,updated_at=CURRENT_TIMESTAMP`);
  for (const item of Array.isArray(session?.customItems) ? session.customItems : []) {
    const code = String(item?.code ?? "").trim();
    const rate = Number(item?.rate ?? 0);
    if (!code || !Number.isFinite(rate) || rate < 0) continue;
    saveItem.run({ code, description: String(item.description ?? ""), unit: String(item.unit ?? ""), rate,
      analysis_json: JSON.stringify(item.isExternalAR ? [] : Array.isArray(item.analysisRows) ? item.analysisRows : []),
      is_external_ar: item.isExternalAR || Number(item.is_external_ar) === 1 ? 1 : 0 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action === "recoverable") {
    try {
      if (!fs.existsSync(projectsDirectory)) return NextResponse.json({ sessions: [] });
      const sessions = fs.readdirSync(projectsDirectory).filter(name => /^temp_estimate_\d{13}-[a-f0-9]{8}\.db$/i.test(name)).flatMap(name => {
        const match = /^temp_estimate_(\d{13})-([a-f0-9]{8})\.db$/i.exec(name);
        if (!match) return [];
        const sessionId = `TEMP-${match[1]}-${match[2].toUpperCase()}`;
        let db: Database.Database | undefined;
        try {
          db = new Database(path.join(projectsDirectory, name), { readonly: true, fileMustExist: true });
          const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_session_state'").get();
          if (!table) return [];
          const stored = db.prepare("SELECT payload_json,updated_at FROM project_session_state ORDER BY updated_at DESC LIMIT 1").get() as any;
          if (!stored) return [];
          const payload = JSON.parse(stored.payload_json);
          return [{ sessionId, updatedAt: stored.updated_at, nameOfWork: payload.projectDetails?.nameOfWork || "", measurementCount: Array.isArray(payload.estimateRows) ? payload.estimateRows.length : 0 }];
        } catch (error) {
          console.error(`Could not inspect recovery file ${name}:`, error);
          return [];
        } finally { db?.close(); }
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return NextResponse.json({ sessions });
    } catch (error) {
      console.error("Recovery session scan failed:", error);
      return NextResponse.json({ error: "Could not check for recoverable estimates." }, { status: 500 });
    }
  }

  const sessionId = normalizeId(url.searchParams.get("sessionId"));
  if (!tempIdPattern.test(sessionId)) return NextResponse.json({ error: "A valid temporary session ID is required." }, { status: 400 });
  const file = databasePath(sessionId);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "The temporary estimate file could not be found." }, { status: 404 });
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const stored = db.prepare("SELECT payload_json,updated_at FROM project_session_state WHERE session_id=?").get(sessionId) as any;
    if (!stored) return NextResponse.json({ error: "This temporary estimate has no recoverable session data." }, { status: 404 });
    return NextResponse.json({ sessionId, updatedAt: stored.updated_at, session: JSON.parse(stored.payload_json) });
  } catch (error) {
    console.error("Recovery session load failed:", error);
    return NextResponse.json({ error: "Could not restore this temporary estimate." }, { status: 500 });
  } finally { db?.close(); }
}

export async function POST(request: Request) {
  let db: Database.Database | undefined;
  let copiedFile = "";
  try {
    const body = await request.json();
    const action = String(body?.action || "");
    fs.mkdirSync(projectsDirectory, { recursive: true });

    if (action === "create-temp") {
      const sessionId = `TEMP-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const session = { ...(body.session || {}), projectDetails: { ...(body.session?.projectDetails || {}), estimateId: sessionId } };
      db = new Database(databasePath(sessionId));
      saveSession(db, sessionId, session);
      return NextResponse.json({ success: true, sessionId, session });
    }

    if (action === "autosave") {
      const sessionId = normalizeId(body?.sessionId);
      if (!sessionId || !body?.session || typeof body.session !== "object") return NextResponse.json({ error: "A project session ID and session data are required." }, { status: 400 });
      const file = databasePath(sessionId);
      if (tempIdPattern.test(sessionId) && !fs.existsSync(file)) return NextResponse.json({ error: "This temporary session has already been moved or closed." }, { status: 409 });
      db = new Database(file);
      db.pragma("busy_timeout = 5000");
      saveSession(db, sessionId, body.session);
      return NextResponse.json({ success: true, sessionId });
    }

    if (action === "save-as") {
      const sourceId = normalizeId(body?.sessionId);
      const rawName = String(body?.filename || "").trim().replace(/\.db$/i, "");
      if (!sourceId || !body?.session || typeof body.session !== "object") {
        return NextResponse.json({ error: "Save As requires an active project and its current data." }, { status: 400 });
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(rawName)) {
        return NextResponse.json({ error: "Use 1–64 letters, numbers, spaces, hyphens, or underscores for the filename." }, { status: 400 });
      }
      const targetId = normalizeId(rawName);
      const sourceFile = databasePath(sourceId);
      const targetFile = databasePath(targetId);
      if (!fs.existsSync(sourceFile)) return NextResponse.json({ error: "The temporary estimate file could not be found." }, { status: 404 });
      if (fs.existsSync(targetFile)) return NextResponse.json({ error: `A project named ${rawName} already exists. Choose another filename.` }, { status: 409 });

      fs.copyFileSync(sourceFile, targetFile);
      copiedFile = targetFile;
      const session = { ...body.session, projectDetails: { ...(body.session.projectDetails || {}), estimateId: targetId } };
      db = new Database(targetFile);
      db.pragma("busy_timeout = 5000");
      ensureSessionSchema(db);
      if (sourceId !== targetId) db.prepare("DELETE FROM project_session_state WHERE session_id=?").run(sourceId);
      saveSession(db, targetId, session);
      db.close(); db = undefined;
      if (tempIdPattern.test(sourceId)) fs.unlinkSync(sourceFile);
      return NextResponse.json({ success: true, projectId: targetId, filename: path.basename(targetFile), session });
    }

    return NextResponse.json({ error: "Choose create-temp, autosave, or save-as." }, { status: 400 });
  } catch (error) {
    db?.close();
    if (copiedFile && fs.existsSync(copiedFile)) {
      try { fs.unlinkSync(copiedFile); } catch (cleanupError) { console.error("Could not clean up incomplete Save As file:", cleanupError); }
    }
    console.error("Project session operation failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Project session operation failed." }, { status: 500 });
  } finally { db?.close(); }
}
