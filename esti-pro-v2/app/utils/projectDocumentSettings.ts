import type Database from "better-sqlite3";

export type LogoUsagePreference = "ALL_SHEETS" | "HISTORY_SHEET_ONLY";

export type ProjectDocumentSettings = {
  state: string;
  division: string;
  branch: string;
  subDivision: string;
  leftAETitle: string;
  leftAEOffice: string;
  rightAETitle: string;
  rightAEOffice: string;
  eeTitle: string;
  eeOffice: string;
  logoUsagePreference: LogoUsagePreference;
};

export const DEFAULT_PROJECT_DOCUMENT_SETTINGS: ProjectDocumentSettings = {
  state: "GOA",
  division: "GCD",
  branch: "B&R",
  subDivision: "Kolhapur Sub Division",
  leftAETitle: "Assistant Engineer,",
  leftAEOffice: "CPWD, Kolhapur.",
  rightAETitle: "Assistant Engineer,",
  rightAEOffice: "GCD, CPWD, Goa.",
  eeTitle: "Executive Engineer & Senior Manager (C)-I,",
  eeOffice: "GCD, CPWD, Goa.",
  logoUsagePreference: "HISTORY_SHEET_ONLY",
};

const settingsColumns = {
  state: "state",
  division: "division",
  branch: "branch",
  subDivision: "sub_division",
  leftAETitle: "left_ae_title",
  leftAEOffice: "left_ae_office",
  rightAETitle: "right_ae_title",
  rightAEOffice: "right_ae_office",
  eeTitle: "ee_title",
  eeOffice: "ee_office",
  logoUsagePreference: "logo_usage_preference",
} as const;

const textSettingKeys = [
  "state", "division", "branch", "subDivision",
  "leftAETitle", "leftAEOffice", "rightAETitle", "rightAEOffice", "eeTitle", "eeOffice",
] as const;

export function ensureProjectSettingsSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_settings (
      project_id TEXT PRIMARY KEY NOT NULL,
      state TEXT NOT NULL DEFAULT 'GOA',
      division TEXT NOT NULL DEFAULT 'GCD',
      branch TEXT NOT NULL DEFAULT 'B&R',
      sub_division TEXT NOT NULL DEFAULT 'Kolhapur Sub Division',
      left_ae_title TEXT NOT NULL DEFAULT 'Assistant Engineer,',
      left_ae_office TEXT NOT NULL DEFAULT 'CPWD, Kolhapur.',
      right_ae_title TEXT NOT NULL DEFAULT 'Assistant Engineer,',
      right_ae_office TEXT NOT NULL DEFAULT 'GCD, CPWD, Goa.',
      ee_title TEXT NOT NULL DEFAULT 'Executive Engineer & Senior Manager (C)-I,',
      ee_office TEXT NOT NULL DEFAULT 'GCD, CPWD, Goa.',
      logo_usage_preference TEXT NOT NULL DEFAULT 'HISTORY_SHEET_ONLY'
        CHECK (logo_usage_preference IN ('ALL_SHEETS', 'HISTORY_SHEET_ONLY')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function tableExists(db: Database.Database, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function migrateHistorySettings(db: Database.Database, projectId: string) {
  if (!tableExists(db, "estimates") || !tableExists(db, "history_sheets")) return;
  const historyColumns = new Set(
    (db.prepare("PRAGMA table_info(history_sheets)").all() as Array<{ name: string }>).map(column => column.name),
  );
  const legacyColumns = [
    ["state", "state", DEFAULT_PROJECT_DOCUMENT_SETTINGS.state],
    ["division", "division", DEFAULT_PROJECT_DOCUMENT_SETTINGS.division],
    ["branch", "branch", DEFAULT_PROJECT_DOCUMENT_SETTINGS.branch],
    ["sub_division", "sub_division", DEFAULT_PROJECT_DOCUMENT_SETTINGS.subDivision],
    ["assistant_engineer_left_title", "left_ae_title", DEFAULT_PROJECT_DOCUMENT_SETTINGS.leftAETitle],
    ["assistant_engineer_left_office", "left_ae_office", DEFAULT_PROJECT_DOCUMENT_SETTINGS.leftAEOffice],
    ["assistant_engineer_right_title", "right_ae_title", DEFAULT_PROJECT_DOCUMENT_SETTINGS.rightAETitle],
    ["assistant_engineer_right_office", "right_ae_office", DEFAULT_PROJECT_DOCUMENT_SETTINGS.rightAEOffice],
    ["executive_engineer_title", "ee_title", DEFAULT_PROJECT_DOCUMENT_SETTINGS.eeTitle],
    ["executive_engineer_office", "ee_office", DEFAULT_PROJECT_DOCUMENT_SETTINGS.eeOffice],
  ] as const;
  const sourceExpression = ([source, , fallback]: (typeof legacyColumns)[number]) =>
    historyColumns.has(source) ? `h.${source}` : `'${fallback.replace(/'/g, "''")}'`;
  const targetColumns = legacyColumns.map(([, target]) => target);
  const sourceColumns = legacyColumns.map(sourceExpression);

  db.prepare(`
    INSERT OR IGNORE INTO project_settings (
      project_id, ${targetColumns.join(", ")}
    )
    SELECT e.project_id, ${sourceColumns.join(", ")}
    FROM estimates e
    JOIN history_sheets h ON h.estimate_id = e.estimate_id
    WHERE e.project_id = ?
  `).run(projectId);
}

export function removeLegacyHistoryDocumentSettings(db: Database.Database, projectId: string) {
  if (!tableExists(db, "history_sheets")) return;
  const columns = new Set(
    (db.prepare("PRAGMA table_info(history_sheets)").all() as Array<{ name: string }>).map(column => column.name),
  );
  const legacyDocumentColumns = [
    "state", "division", "branch", "sub_division",
    "assistant_engineer_left_title", "assistant_engineer_left_office",
    "assistant_engineer_right_title", "assistant_engineer_right_office",
    "executive_engineer_title", "executive_engineer_office",
  ];
  if (!legacyDocumentColumns.some(column => columns.has(column))) return;
  getProjectDocumentSettings(db, projectId);
  for (const column of legacyDocumentColumns) {
    if (columns.has(column)) db.exec(`ALTER TABLE history_sheets DROP COLUMN ${column}`);
  }
}

function mapSettings(row: Record<string, unknown>): ProjectDocumentSettings {
  return {
    state: String(row.state),
    division: String(row.division),
    branch: String(row.branch),
    subDivision: String(row.sub_division),
    leftAETitle: String(row.left_ae_title),
    leftAEOffice: String(row.left_ae_office),
    rightAETitle: String(row.right_ae_title),
    rightAEOffice: String(row.right_ae_office),
    eeTitle: String(row.ee_title),
    eeOffice: String(row.ee_office),
    logoUsagePreference: row.logo_usage_preference === "ALL_SHEETS" ? "ALL_SHEETS" : "HISTORY_SHEET_ONLY",
  };
}

export function getProjectDocumentSettings(db: Database.Database, projectId: string): ProjectDocumentSettings {
  ensureProjectSettingsSchema(db);
  migrateHistorySettings(db, projectId);

  let row = db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get(projectId) as Record<string, unknown> | undefined;
  if (!row) {
    saveProjectDocumentSettings(db, projectId, DEFAULT_PROJECT_DOCUMENT_SETTINGS);
    row = db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get(projectId) as Record<string, unknown> | undefined;
  }
  if (!row) throw new Error("Could not initialize project document settings.");
  return mapSettings(row);
}

export function saveProjectDocumentSettings(
  db: Database.Database,
  projectId: string,
  input: Partial<ProjectDocumentSettings>,
): ProjectDocumentSettings {
  ensureProjectSettingsSchema(db);
  const existing = db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get(projectId) as Record<string, unknown> | undefined;
  const merged: ProjectDocumentSettings = existing
    ? { ...mapSettings(existing), ...input }
    : { ...DEFAULT_PROJECT_DOCUMENT_SETTINGS, ...input };
  for (const key of textSettingKeys) {
    if (typeof merged[key] !== "string") throw new Error(`${key} must be text.`);
    if (merged[key].length > 10000) throw new Error(`${key} is too long.`);
  }
  if (!["ALL_SHEETS", "HISTORY_SHEET_ONLY"].includes(merged.logoUsagePreference)) {
    throw new Error("Choose a valid logo usage preference.");
  }

  const columns = Object.values(settingsColumns);
  const values = Object.keys(settingsColumns).map(key => merged[key as keyof ProjectDocumentSettings]);
  db.prepare(`
    INSERT INTO project_settings (project_id, ${columns.join(", ")})
    VALUES (?, ${values.map(() => "?").join(", ")})
    ON CONFLICT(project_id) DO UPDATE SET
      ${columns.map(column => `${column} = excluded.${column}`).join(", ")},
      updated_at = CURRENT_TIMESTAMP
  `).run(projectId, ...values);
  return merged;
}
