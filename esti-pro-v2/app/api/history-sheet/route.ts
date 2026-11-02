import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import { calculateHistoryEstimateSummary } from "../../utils/historyEstimateSummary";
import { DEFAULT_HISTORY_NOTE_TEXT } from "../../utils/historySheetDefaults";
import {
  getProjectDocumentSettings,
  ensureProjectSettingsSchema,
  removeLegacyHistoryDocumentSettings,
} from "../../utils/projectDocumentSettings";

export const runtime = "nodejs";

const estimateTypeValues = ["PE_CUM_DE", "DE"] as const;
const submissionPurposeValues = ["AA_ES", "CLIENT", "HIGHER_AUTH", "TS"] as const;
const textFields = [
  "framedBy", "scrutinizedBy", "clientRequisitionRef", "historyNarrative", "designScopeNarrative",
  "majorHead", "minorHead", "detailedHead", "noteText",
  "specifications", "methodOfExecution", "toolsAndPlant", "landAvailability",
] as const;
const imageFields = ["goiLogoDataUrl", "cpwdLogoDataUrl"] as const;

type HistorySheet = {
  isDraft: boolean;
  estimateType: (typeof estimateTypeValues)[number];
  submissionPurpose: (typeof submissionPurposeValues)[number];
  framedBy: string;
  scrutinizedBy: string;
  clientRequisitionRef: string;
  siteInspectionDate: string | null;
  specifications: string;
  historyNarrative: string;
  designScopeNarrative: string;
  majorHead: string;
  minorHead: string;
  detailedHead: string;
  includeNote: boolean;
  noteText: string;
  goiLogoDataUrl: string;
  cpwdLogoDataUrl: string;
  methodOfExecution: string;
  toolsAndPlant: string;
  landAvailability: string;
};

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

function ensureHistorySchema(db: Database.Database, projectId: string) {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS estimates (
      estimate_id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL UNIQUE,
      name_of_work TEXT NOT NULL DEFAULT '',
      estimate_summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS history_sheets (
      estimate_id INTEGER NOT NULL UNIQUE REFERENCES estimates(estimate_id) ON DELETE CASCADE,
      is_draft INTEGER NOT NULL DEFAULT 1 CHECK (is_draft IN (0, 1)),
      estimate_type TEXT NOT NULL DEFAULT 'PE_CUM_DE' CHECK (estimate_type IN ('PE_CUM_DE', 'DE')),
      submission_purpose TEXT NOT NULL DEFAULT 'AA_ES' CHECK (submission_purpose IN ('AA_ES', 'CLIENT', 'HIGHER_AUTH', 'TS')),
      framed_by TEXT NOT NULL DEFAULT 'Assistant Engineer Civil, Kolhapur Subdivision, CPWD, Kolhapur',
      scrutinized_by TEXT NOT NULL DEFAULT 'Executive Engineer and Senior Manager (C)-I, CPWD, Bambolim, Goa',
      client_requisition_ref TEXT NOT NULL DEFAULT '',
      site_inspection_date TEXT,
      specifications TEXT NOT NULL DEFAULT 'CPWD specifications 2019 volume one and volume two up to date with correction slips',
      time_limit_numeric INTEGER,
      time_limit_words TEXT NOT NULL DEFAULT '',
      history_narrative TEXT NOT NULL DEFAULT '',
      design_scope_narrative TEXT NOT NULL DEFAULT '',
      major_head TEXT NOT NULL DEFAULT '',
      minor_head TEXT NOT NULL DEFAULT '',
      detailed_head TEXT NOT NULL DEFAULT '',
      include_note INTEGER NOT NULL DEFAULT 1 CHECK (include_note IN (0, 1)),
      note_text TEXT NOT NULL DEFAULT '',
      goi_logo_data_url TEXT NOT NULL DEFAULT '',
      cpwd_logo_data_url TEXT NOT NULL DEFAULT '',
      method_of_execution TEXT NOT NULL DEFAULT 'By contract after call of tender',
      tools_and_plant TEXT NOT NULL DEFAULT 'To be arranged by the contractor',
      land_availability TEXT NOT NULL DEFAULT 'Available'
    );
  `);
  ensureProjectSettingsSchema(db);
  const columns = new Set((db.prepare("PRAGMA table_info(history_sheets)").all() as Array<{ name: string }>).map(column => column.name));
  const additions: Array<[string, string]> = [
    ["design_scope_narrative", "TEXT NOT NULL DEFAULT ''"],
    ["major_head", "TEXT NOT NULL DEFAULT ''"],
    ["minor_head", "TEXT NOT NULL DEFAULT ''"],
    ["detailed_head", "TEXT NOT NULL DEFAULT ''"],
    ["include_note", "INTEGER NOT NULL DEFAULT 1"],
    ["note_text", "TEXT NOT NULL DEFAULT ''"],
    ["goi_logo_data_url", "TEXT NOT NULL DEFAULT ''"],
    ["cpwd_logo_data_url", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE history_sheets ADD COLUMN ${name} ${definition}`);
      if (name === "note_text") {
        db.prepare("UPDATE history_sheets SET note_text = ? WHERE note_text = ''").run(DEFAULT_HISTORY_NOTE_TEXT);
      }
    }
  }

  removeLegacyHistoryDocumentSettings(db, projectId);
}

function hasTable(db: Database.Database, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function readEstimateSession(db: Database.Database, projectId: string) {
  if (hasTable(db, "project_session_state")) {
    const stored = db.prepare("SELECT payload_json FROM project_session_state WHERE session_id = ?").get(projectId) as { payload_json: string } | undefined;
    if (stored) return JSON.parse(stored.payload_json);
  }
  if (hasTable(db, "estimate_snapshots")) {
    const stored = db.prepare("SELECT payload_json FROM estimate_snapshots ORDER BY version DESC LIMIT 1").get() as { payload_json: string } | undefined;
    if (stored) {
      const snapshot = JSON.parse(stored.payload_json);
      return { ...snapshot, projectDetails: snapshot.projectDetails ?? {}, estimateRows: snapshot.estimateRows ?? [], marketRates: snapshot.marketRates ?? {} };
    }
  }
  return {};
}

function syncEstimateRecord(db: Database.Database, projectId: string) {
  const session = readEstimateSession(db, projectId);
  const summary = calculateHistoryEstimateSummary(session);
  const summaryJson = JSON.stringify(summary);
  db.prepare(`
    INSERT INTO estimates (project_id, name_of_work, estimate_summary_json)
    VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      name_of_work = excluded.name_of_work,
      estimate_summary_json = excluded.estimate_summary_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(projectId, summary.nameOfWork, summaryJson);
  return {
    estimateId: (db.prepare("SELECT estimate_id FROM estimates WHERE project_id = ?").get(projectId) as { estimate_id: number }).estimate_id,
    estimateSummary: summary,
  };
}

function mapHistoryRow(row: Record<string, unknown> | undefined): HistorySheet | null {
  if (!row) return null;
  return {
    isDraft: Boolean(row.is_draft),
    estimateType: row.estimate_type as HistorySheet["estimateType"],
    submissionPurpose: row.submission_purpose as HistorySheet["submissionPurpose"],
    framedBy: String(row.framed_by),
    scrutinizedBy: String(row.scrutinized_by),
    clientRequisitionRef: String(row.client_requisition_ref),
    siteInspectionDate: row.site_inspection_date ? String(row.site_inspection_date) : null,
    specifications: String(row.specifications),
    historyNarrative: String(row.history_narrative),
    designScopeNarrative: String(row.design_scope_narrative ?? ""),
    majorHead: String(row.major_head ?? ""),
    minorHead: String(row.minor_head ?? ""),
    detailedHead: String(row.detailed_head ?? ""),
    includeNote: row.include_note === undefined ? true : Boolean(row.include_note),
    noteText: String(row.note_text ?? DEFAULT_HISTORY_NOTE_TEXT),
    goiLogoDataUrl: String(row.goi_logo_data_url ?? ""),
    cpwdLogoDataUrl: String(row.cpwd_logo_data_url ?? ""),
    methodOfExecution: String(row.method_of_execution),
    toolsAndPlant: String(row.tools_and_plant),
    landAvailability: String(row.land_availability),
  };
}

function validateHistorySheet(body: unknown): HistorySheet {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("History Sheet data must be an object.");
  const value = body as Record<string, unknown>;
  if (typeof value.isDraft !== "boolean") throw new Error("Draft must be a boolean.");
  if (typeof value.includeNote !== "boolean") throw new Error("Include Note must be a boolean.");
  if (!estimateTypeValues.includes(value.estimateType as HistorySheet["estimateType"])) throw new Error("Choose a valid estimate type.");
  if (!submissionPurposeValues.includes(value.submissionPurpose as HistorySheet["submissionPurpose"])) throw new Error("Choose a valid submission purpose.");
  for (const field of textFields) {
    if (typeof value[field] !== "string") throw new Error(`${field} must be text.`);
    if (["historyNarrative", "designScopeNarrative", "noteText"].includes(field) ? String(value[field]).length > 50000 : String(value[field]).length > 10000) {
      throw new Error(`${field} is too long.`);
    }
  }
  for (const field of imageFields) {
    const image = value[field];
    if (typeof image !== "string" || image.length > 5_000_000 || (image !== "" && !/^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+$/i.test(image))) {
      throw new Error(`${field} must be an uploaded PNG or JPEG image under 5 MB.`);
    }
  }
  const date = value.siteInspectionDate;
  if (date !== null && date !== undefined && date !== "") {
    const dateParts = typeof date === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!dateParts) throw new Error("Site inspection date must be a valid date.");
    const parsedDate = new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3])));
    if (parsedDate.getUTCFullYear() !== Number(dateParts[1]) || parsedDate.getUTCMonth() !== Number(dateParts[2]) - 1 || parsedDate.getUTCDate() !== Number(dateParts[3])) {
      throw new Error("Site inspection date must be a valid date.");
    }
  }
  return {
    isDraft: value.isDraft,
    estimateType: value.estimateType as HistorySheet["estimateType"],
    submissionPurpose: value.submissionPurpose as HistorySheet["submissionPurpose"],
    framedBy: String(value.framedBy),
    scrutinizedBy: String(value.scrutinizedBy),
    clientRequisitionRef: String(value.clientRequisitionRef),
    siteInspectionDate: date ? String(date) : null,
    specifications: String(value.specifications),
    historyNarrative: String(value.historyNarrative),
    designScopeNarrative: String(value.designScopeNarrative),
    majorHead: String(value.majorHead),
    minorHead: String(value.minorHead),
    detailedHead: String(value.detailedHead),
    includeNote: value.includeNote,
    noteText: String(value.noteText),
    goiLogoDataUrl: String(value.goiLogoDataUrl),
    cpwdLogoDataUrl: String(value.cpwdLogoDataUrl),
    methodOfExecution: String(value.methodOfExecution),
    toolsAndPlant: String(value.toolsAndPlant),
    landAvailability: String(value.landAvailability),
  };
}

const saveHistorySheet = (db: Database.Database, estimateId: number, data: HistorySheet, insert: boolean) => {
  const columns = [
    "is_draft", "estimate_type", "submission_purpose", "framed_by", "scrutinized_by", "client_requisition_ref",
    "site_inspection_date", "specifications", "history_narrative", "design_scope_narrative",
    "major_head", "minor_head", "detailed_head", "include_note", "note_text", "goi_logo_data_url", "cpwd_logo_data_url",
    "method_of_execution", "tools_and_plant", "land_availability",
  ];
  const values = [
    data.isDraft ? 1 : 0, data.estimateType, data.submissionPurpose, data.framedBy, data.scrutinizedBy,
    data.clientRequisitionRef, data.siteInspectionDate, data.specifications,
    data.historyNarrative, data.designScopeNarrative, data.majorHead, data.minorHead, data.detailedHead,
    data.includeNote ? 1 : 0, data.noteText, data.goiLogoDataUrl, data.cpwdLogoDataUrl,
    data.methodOfExecution, data.toolsAndPlant, data.landAvailability,
  ];
  if (insert) {
    db.prepare(`INSERT INTO history_sheets (estimate_id, ${columns.join(", ")}) VALUES (?, ${values.map(() => "?").join(", ")})`).run(estimateId, ...values);
    return;
  }
  const result = db.prepare(`UPDATE history_sheets SET ${columns.map(column => `${column} = ?`).join(", ")} WHERE estimate_id = ?`).run(...values, estimateId);
  if (result.changes === 0) throw new Error("No History Sheet exists for this estimate. Create it before updating.");
};

export async function GET(request: Request) {
  const projectId = normalizeProjectId(new URL(request.url).searchParams.get("projectId"));
  if (!projectId) return NextResponse.json({ error: "An active Estimate ID is required." }, { status: 400 });
  const file = getDatabasePath(projectId);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "The active estimate database could not be found." }, { status: 404 });
  let db: Database.Database | undefined;
  try {
    db = new Database(file);
    ensureHistorySchema(db, projectId);
    const estimate = syncEstimateRecord(db, projectId);
    const row = db.prepare("SELECT * FROM history_sheets WHERE estimate_id = ?").get(estimate.estimateId) as Record<string, unknown> | undefined;
    const projectSettings = getProjectDocumentSettings(db, projectId);
    return NextResponse.json({ ...estimate, historySheet: mapHistoryRow(row), projectSettings });
  } catch (error) {
    console.error("History Sheet load error:", error);
    return NextResponse.json({ error: "Could not load this estimate's History Sheet." }, { status: 500 });
  } finally {
    db?.close();
  }
}

async function save(request: Request, insert: boolean) {
  let db: Database.Database | undefined;
  try {
    const body = await request.json();
    const projectId = normalizeProjectId(body?.projectId);
    if (!projectId) return NextResponse.json({ error: "An active Estimate ID is required." }, { status: 400 });
    const data = validateHistorySheet(body?.historySheet);
    const file = getDatabasePath(projectId);
    if (!fs.existsSync(file)) return NextResponse.json({ error: "The active estimate database could not be found." }, { status: 404 });
    db = new Database(file);
    ensureHistorySchema(db, projectId);
    const save = db.transaction(() => {
      const estimate = syncEstimateRecord(db!, projectId);
      saveHistorySheet(db!, estimate.estimateId, data, insert);
      return { ...estimate, projectSettings: getProjectDocumentSettings(db!, projectId) };
    });
    const estimate = save();
    return NextResponse.json({ success: true, ...estimate, historySheet: data });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: history_sheets\.estimate_id/.test(error.message)) {
      return NextResponse.json({ error: "A History Sheet already exists for this estimate. Reload it before saving changes." }, { status: 409 });
    }
    if (error instanceof Error && error.message.startsWith("No History Sheet exists")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && /History Sheet data|Draft must|Include Note|Choose a valid|must be text|is too long|Site inspection|goiLogoDataUrl|cpwdLogoDataUrl/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("History Sheet save error:", error);
    return NextResponse.json({ error: "Could not save this estimate's History Sheet." }, { status: 500 });
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  return save(request, true);
}

export async function PUT(request: Request) {
  return save(request, false);
}
