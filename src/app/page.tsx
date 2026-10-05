"use client";
import React, { useEffect, useState, useRef, useMemo } from "react";
import Decimal from "decimal.js";

/* --- INTERFACES --- */
interface DsrItem { code: string; description: string; fullDescription?: string; unit: string; rate: number | null; rateDR?: number | null; isMain?: boolean; isDeleted?: boolean; }
interface SubHeadGroup { label: string; items: DsrItem[]; }
interface MeasurementRow { id: string; slNo: number; itemCode: string; description: string; locationDesc: string; unit: string; rate: number; nos: number | ""; num1: number | ""; num2: number | ""; length: number | ""; breadth: number | ""; height: number | ""; coefficient: number | ""; quantity: number; amount: number; referenceItemCode?: string; percentageVal?: number | ""; }
interface RateAnalysisRow { code?: string; description?: string; unit?: string; quantity?: string | number; rate?: string | number; amount?: string | number; mark?: string; }
interface RateAnalysis { code?: string; description?: string; analysis?: RateAnalysisRow[]; basisDescriptions?: string[]; databaseBasis?: string | number | null; databaseUnit?: string | null; }
interface DatabaseRateAnalysisComponent { component_code: string | null; component_type: string; description: string | null; unit: string | null; quantity: number | null; rate: number | null; amount: number | null; reference_item_code: string | null; reference_analysis_code: string | null; analysis_code?: string; }
interface DatabaseDarItem { item_code: string; description: string; unit: string | null; rate: number | null; rate_basis: string | number | null; }
interface DatabaseSubAnalysis { analysis_code: string; description: string | null; unit: string | null; quantity_basis: string | number | null; }
interface DatabaseAnalysisResponse {
  analyses: Record<string, {
    darItem: DatabaseDarItem | null;
    sourceItemCode: string;
    components: DatabaseRateAnalysisComponent[];
    subAnalysis: DatabaseSubAnalysis | null;
    subComponents: DatabaseRateAnalysisComponent[];
  }>;
  allSubAnalyses: DatabaseSubAnalysis[];
  allSubComponents: (DatabaseRateAnalysisComponent & { analysis_code: string })[];
}
interface ComputedRateAnalysis { rate: number; baseQuantity: number; unit: string; block: RateAnalysisRow[]; }
interface AbstractPathNode { slNo: string; itemCode: string; itemCodeForOverride?: string; description: string; isParentRow: boolean; unit?: string; rate?: number; subtotalQty?: number; finalGroupQty?: number; rows?: MeasurementRow[]; hasRate: boolean; }
interface AbstractSummaryItem { itemCode: string; treeSlNo: string; description: string; isParentRow: boolean; unit: string; totalQty: number; rate: number; rateDAR: number | null; amount: number; hasRate: boolean; }
interface JustificationMaterial { id: string; code: string; description: string; unit: string; dsrRate: number; group: string; isCarriage?: boolean; }
interface ProjectDetails { estimateId: string; nameOfWork: string; dsrVersion: string; numberFormat: "indian" | "international"; modificationFactorType: "0.973" | "custom"; customModificationFactor: string; costIndex: string; contingencyType: "cpwd" | "custom"; customContingency: string; workCategory: string; customEpf: string; customEsi: string; }
interface ThemeSettings { mode: 'dark' | 'light' | 'custom'; customBg: string; customPanelBg: string; customText: string; transparency: number; }
interface NsrAddon { id: string; label: string; pct: number; checked: boolean; }
interface NsrAnalysisRow { isExplanation: boolean; code: string; desc: string; unit: string; qty: number | string; rate: number | string; amt: number; mark: string; }
interface NsrForm { type: "50" | "51"; parentCode: string; isHeadingOnly: boolean; copyCode: string; code: string; description: string; unit: string; baseQty: number; format: string; customAddons: NsrAddon[]; rows: NsrAnalysisRow[]; }
interface SavedEstimate {
  projectDetails?: ProjectDetails;
  estimateRows?: MeasurementRow[];
  checkedItems?: Record<string, boolean>;
  marketRates?: Record<string, number>;
  marketRaFormat?: string;
  marketRaAddons?: NsrAddon[];
  customNsrs?: DsrItem[];
  rateAnalysisData?: Record<string, RateAnalysis>;
}
interface SpeechRecognitionResultLike { isFinal: boolean; 0: { transcript: string }; }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike>; }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionConstructor { new (): SpeechRecognitionLike; }

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNsrItems(value: unknown): DsrItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DsrItem =>
    isRecord(item) &&
    typeof item.code === "string" &&
    typeof item.description === "string" &&
    typeof item.unit === "string" &&
    (typeof item.rate === "number" || item.rate === null),
  );
}

function isRateAnalysis(value: unknown): value is RateAnalysis {
  return isRecord(value) && (
    value.analysis === undefined ||
    (Array.isArray(value.analysis) && value.analysis.every((row) =>
      isRecord(row) &&
      (row.code === undefined || typeof row.code === "string") &&
      (row.description === undefined || typeof row.description === "string"),
    ))
  );
}

function getBasisDescriptions(analysis: RateAnalysis | undefined) {
  return (analysis?.analysis || [])
    .map((row) => String(row.description || ""))
    .filter((description) =>
      /^\s*Cost\s+(?:of|for)\s+[\d.]+/i.test(description) ||
      /Details?\s+of\s+cost/i.test(description),
    );
}

/* --- CONSTANTS & REGEX (RESTORED) --- */
const DEFAULT_PROJECT_DETAILS: ProjectDetails = { estimateId: "", nameOfWork: "", dsrVersion: "DSR 2023", numberFormat: "indian", modificationFactorType: "0.973", customModificationFactor: "", costIndex: "", contingencyType: "cpwd", customContingency: "", workCategory: "buildings", customEpf: "", customEsi: "" };
const DEFAULT_THEME: ThemeSettings = { mode: 'dark', customBg: '#1e1e24', customPanelBg: '#2b2b36', customText: '#e0e0e0', transparency: 0.85 };
const WORK_CATEGORIES: Record<string, { label: string, epf: number, esi: number }> = {
  "buildings": { label: "Buildings", epf: 3.125, esi: 0.8125 },
  "roads": { label: "Road works & Pavements", epf: 0.625, esi: 0.1625 },
  "sewerage": { label: "External sewerage", epf: 1.250, esi: 0.325 },
  "water": { label: "External water supply", epf: 0.625, esi: 0.1625 },
  "bridge": { label: "Bridge/Flyover works", epf: 3.125, esi: 0.8125 },
  "maintenance_labour": { label: "Maintenance works (labour only)", epf: 12.500, esi: 3.250 },
  "maintenance_other": { label: "Other maintenance work", epf: 8.750, esi: 2.275 },
  "maintenance": { label: "Legacy Maintenance (Fallback)", epf: 8.750, esi: 2.275 },
  "custom": { label: "Custom", epf: 0, esi: 0 }
};

const BOQ_FIELDS: (keyof Pick<MeasurementRow, "nos" | "num1" | "num2" | "length" | "breadth" | "height" | "coefficient">)[] = ["nos", "num1", "num2", "length", "breadth", "height", "coefficient"];
const PERCENTAGE_ITEMS = ["5.9.14", "2.24.1", "2.24.2"];
const DEFAULT_ADDONS: NsrAddon[] = [ { id: 'water', label: 'Water Charges', pct: 1, checked: true }, { id: 'gst', label: 'GST', pct: 18, checked: true }, { id: 'cpoh', label: 'CPOH', pct: 15, checked: true }, { id: 'cess', label: 'Labour Cess', pct: 1, checked: true } ];

const DSR_CHAPTER_NAMES: Record<string, string> = { "sh_1": "SH 1: CARRIAGE OF MATERIALS", "sh_2": "SH 2: EARTH WORK", "sh_3": "SH 3: MORTARS", "sh_4": "SH 4: CONCRETE WORK", "sh_5": "SH 5: REINFORCED CEMENT CONCRETE", "sh_6": "SH 6: BRICK WORK", "sh_7": "SH 7: STONE WORK", "sh_8": "SH 8: MARBLE AND GRANITE WORK", "sh_9": "SH 9: WOOD AND P.V.C. WORK", "sh_10": "SH 10: STEEL WORK", "sh_11": "SH 11: FLOORING", "sh_12": "SH 12: ROOFING", "sh_13": "SH 13: FINISHING", "sh_14": "SH 14: REPAIRS TO BUILDINGS", "sh_15": "SH 15: DISMANTLING AND DEMOLISHING", "sh_16": "SH 16: ROAD WORK", "sh_17": "SH 17: SANITARY INSTALLATIONS", "sh_18": "SH 18: WATER SUPPLY", "sh_19": "SH 19: DRAINAGE", "sh_20": "SH 20: PILE WORK", "sh_21": "SH 21: ALUMINIUM WORK", "sh_22": "SH 22: WATER PROOFING", "sh_26": "SH 26: NEW TECHNOLOGIES AND MATERIALS", "sh_50": "SH 50: MODIFIED DSR ITEMS", "sh_51": "SH 51: NON-SCHEDULE ITEMS (NSR)" };

const ALPHA_NUM_REGEX = new RegExp("^(\\d+)(.*)$");
const SUB_AR_REGEX = new RegExp("Sub[\\s\\-_]*A/?R[\\s\\-_]*\\d+[A-Z]?", "i");
const ITEM_CODE_REGEX = new RegExp("^(\\d+[a-zA-Z]*)(\\.[a-zA-Z0-9()]+)+$");

function getRateAnalysisBasis(analysis: RateAnalysis) {
  const databaseBasis = Number(analysis.databaseBasis);
  if (Number.isFinite(databaseBasis) && databaseBasis > 0) return databaseBasis;

  const descriptions = [
    ...(analysis.basisDescriptions || []),
    ...(analysis.analysis || []).map((row) => String(row.description || "")),
  ];
  const headerRow = descriptions.find((description) => /Details?\s+of\s+cost/i.test(description));
  const headerMatch = headerRow?.match(/Details?\s+of\s+cost\s+for\s+([\d.]+)/i);
  if (headerMatch) {
    const basis = Number(headerMatch[1]);
    if (Number.isFinite(basis) && basis > 0) return basis;
  }

  const calculatedHeaderMatch = headerRow?.match(/(?:=|\()\s*([\d.]+)\s*(?:sqm|m2|sq\.?\s*m)\b/i);
  if (calculatedHeaderMatch) {
    const basis = Number(calculatedHeaderMatch[1]);
    if (Number.isFinite(basis) && basis > 0) return basis;
  }

  const footerRow = descriptions.find((description) => /^\s*Cost\s+(?:of|for)\s+/i.test(description));
  const footerMatch = footerRow?.match(/Cost\s+(?:of|for)\s+([\d.]+)/i);
  if (footerMatch) {
    const basis = Number(footerMatch[1]);
    if (Number.isFinite(basis) && basis > 0) return basis;
  }
  return 1;
}
/* --- HELPERS --- */
function roundCurrency(amount: number) {
  if (!Number.isFinite(amount)) return amount;
  return new Decimal(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function roundToIncrement(amount: number, increment: number) {
  if (!Number.isFinite(amount) || !Number.isFinite(increment) || increment <= 0) return amount;
  return new Decimal(amount).div(increment).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(increment).toNumber();
}

function hexToRgb(hex: string) { let c = hex.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); return `${parseInt(c.slice(0, 2), 16) || 0}, ${parseInt(c.slice(2, 4), 16) || 0}, ${parseInt(c.slice(4, 6), 16) || 0}`; }
function generateThemeCSS(t: ThemeSettings) {
  if (t.mode === 'dark') return ''; 
  if (t.mode === 'light') return `.app-theme-light.bg-slate-950 { background-color: #f8fafc !important; color: #000000 !important; } .app-theme-light .bg-slate-950 { background-color: #f8fafc !important; } .app-theme-light .bg-slate-900 { background-color: #f1f5f9 !important; } .app-theme-light .bg-slate-900\\/60, .app-theme-light .bg-slate-900\\/50, .app-theme-light .bg-slate-900\\/40, .app-theme-light .bg-slate-900\\/80, .app-theme-light .bg-slate-900\\/90, .app-theme-light .bg-slate-900\\/95 { background-color: #ffffff !important; border-color: #cbd5e1 !important; } .app-theme-light .bg-slate-800 { background-color: #e2e8f0 !important; } .app-theme-light .text-slate-100, .app-theme-light .text-slate-200, .app-theme-light .text-slate-300, .app-theme-light .text-slate-400, .app-theme-light .text-slate-500, .app-theme-light td, .app-theme-light th, .app-theme-light span { color: #000000 !important; font-weight: 800 !important; } .app-theme-light .text-blue-400 { color: #1d4ed8 !important; font-weight: 900 !important; } .app-theme-light .text-amber-400 { color: #b45309 !important; font-weight: 900 !important; } .app-theme-light .text-green-400 { color: #15803d !important; font-weight: 900 !important; } .app-theme-light input, .app-theme-light textarea, .app-theme-light select { background-color: #ffffff !important; color: #000000 !important; border-color: #94a3b8 !important; }`;
  const pRgb = hexToRgb(t.customPanelBg); const tRgb = hexToRgb(t.customText); const a = t.transparency; 
  return `.app-theme-custom.bg-slate-950 { background-color: ${t.customBg} !important; color: ${t.customText} !important; } .app-theme-custom .bg-slate-950 { background-color: transparent !important; } .app-theme-custom .bg-slate-900, .app-theme-custom .bg-slate-900\\/60, .app-theme-custom .bg-slate-900\\/95 { background-color: rgba(${pRgb}, ${a}) !important; backdrop-filter: blur(16px); } .app-theme-custom .border-slate-800 { border-color: rgba(${tRgb}, 0.15) !important; } .app-theme-custom .text-slate-100, .app-theme-custom .text-slate-200, .app-theme-custom .text-slate-300 { color: ${t.customText} !important; } .app-theme-custom input, .app-theme-custom textarea, .app-theme-custom select { background-color: rgba(${pRgb}, ${a}) !important; color: ${t.customText} !important; border-color: rgba(${tRgb}, 0.2) !important; backdrop-filter: blur(16px); }`;
}

function normalizeCode(c: string | undefined | null) { return c ? c.toString().split(' ').join('').toUpperCase() : ""; }
function factorVal(v: number | "" | undefined) { return (v === "" || v === undefined || v === null || isNaN(Number(v)) || Number(v) === 0 ? 1 : Number(v)); }
function matchesSearch(query: string, ...values: (string | undefined)[]) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return !normalizedQuery || values.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

function TableSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="search"
      aria-label="Search by code or description"
      placeholder="Search code or description..."
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-64 max-w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
    />
  );
}

function compareNumericStrings(a: string, b: string) {
    const normalizedA = a.replace(/^0+(?=\d)/, "");
    const normalizedB = b.replace(/^0+(?=\d)/, "");
    return normalizedA.length - normalizedB.length || normalizedA.localeCompare(normalizedB);
}

function compareDsrCodes(a: string, b: string) {
    const partsA = normalizeCode(a).split('.'); const partsB = normalizeCode(b).split('.');
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        if (partsA[i] === undefined) return -1; if (partsB[i] === undefined) return 1;
        const matchA = partsA[i].match(ALPHA_NUM_REGEX); const matchB = partsB[i].match(ALPHA_NUM_REGEX);
        if (matchA && matchB) {
            const numberComparison = compareNumericStrings(matchA[1], matchB[1]);
            if (numberComparison !== 0) return numberComparison;
            const alphaA = matchA[2] || ""; const alphaB = matchB[2] || "";
            if (alphaA !== alphaB) return alphaA.localeCompare(alphaB);
        } else {
            if (partsA[i] !== partsB[i]) return partsA[i].localeCompare(partsB[i]);
        }
    }
    return 0;
}

function findCatalogItemByCodeGlobal(catalog: Record<string, SubHeadGroup>, customNsrs: DsrItem[], code: string): DsrItem | null {
  const cleanCode = normalizeCode(code);
  const nsrFound = customNsrs.find(i => normalizeCode(i.code) === cleanCode); if (nsrFound) return nsrFound;
  for (const grpKey of Object.keys(catalog)) { const found = catalog[grpKey]?.items?.find((i) => normalizeCode(i.code) === cleanCode); if (found) return found; }
  return null;
}

function getStrictExactLevelDescriptionGlobal(catalog: Record<string, SubHeadGroup>, customNsrs: DsrItem[], code: string) {
  if (!code.includes(".")) return DSR_CHAPTER_NAMES[`sh_${code}`] || catalog[`sh_${code}`]?.label || `Subhead ${code}`;
  const item = findCatalogItemByCodeGlobal(catalog, customNsrs, code);
  return item ? (item.fullDescription || item.description || "") : code;
}

function getFullTreeDescriptionGlobal(catalog: Record<string, SubHeadGroup>, customNsrs: DsrItem[], code: string, rateAnalyses: Record<string, RateAnalysis> = {}) {
  const parts = normalizeCode(code).split("."); const paths = []; let current = "";
  for (let i = 0; i < parts.length; i++) { current = current ? `${current}.${parts[i]}` : parts[i]; paths.push(current); }
    const descriptions = paths.map(p => {
      const normalized = normalizeCode(p);
      const raItem = rateAnalyses[normalized] || Object.entries(rateAnalyses).find(([key]) => normalizeCode(key) === normalized)?.[1];
      if (!p.includes(".")) return DSR_CHAPTER_NAMES[`sh_${p}`] || catalog[`sh_${p}`]?.label || raItem?.description || "";
      const item = findCatalogItemByCodeGlobal(catalog, customNsrs, p);
      return item ? (item.fullDescription || item.description || "").replace(/:\s*$/, "").trim() : (raItem?.description || "").replace(/:\s*$/, "").trim();
    });
  return Array.from(new Set(descriptions.filter(Boolean))).join("\n");
}

function formatCurrency(amount: number, formatType: "indian" | "international", decimals: number = 2) {
  if (isNaN(amount) || amount === null || amount === undefined) return "0.00";
  return new Intl.NumberFormat(formatType === "indian" ? 'en-IN' : 'en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount);
}

function getCpwdMark(desc: string) {
  const d = desc.toLowerCase();
  if (d.includes("total materials & labour") || d.includes("total material")) return "W";
  if (d.includes("water charges")) return "W"; if (d.includes("gst")) return "X";
  if (d.includes("c.p") || d.includes("cpoh")) return "Y"; if (d.includes("cess")) return "Z";
  return "";
}

type RateAnalysisMarks = Record<string, number>;

function extractMarkExpression(description: string) {
  const markedExpression = description.match(/\bon\s*["']?\s*([PWARXYZ](?:\s*[-+*/]\s*[PWARXYZ])*)\b/i);
  if (markedExpression) return markedExpression[1];
  const directExpression = description.match(/\b([PWARXYZ](?:\s*[-+*/]\s*[PWARXYZ]){1,})\b/i);
  return directExpression?.[1] || null;
}

function evaluateMarkExpression(expression: string, marks: RateAnalysisMarks) {
  const matchedTokens = expression.match(/[PWARXYZ]|\d+(?:\.\d+)?|[()+\-*/]/gi);
  if (!matchedTokens || matchedTokens.join("").toUpperCase() !== expression.replace(/\s+/g, "").toUpperCase()) return null;
  const tokens = matchedTokens;
  let cursor = 0;
  function parseFactor(): number | null {
    const token = tokens[cursor++];
    if (token === "+" || token === "-") {
      const value = parseFactor();
      return value === null ? null : token === "-" ? -value : value;
    }
    if (token === "(") {
      const value = parseExpression();
      if (tokens[cursor++] !== ")") return null;
      return value;
    }
    if (/^\d/.test(token || "")) return Number(token);
    if (/^[PWARXYZ]$/i.test(token || "")) {
      const mark = token.toUpperCase();
      return marks[mark] ?? (["A", "P", "R"].includes(mark) ? 0 : null);
    }
    return null;
  }
  function parseTerm(): number | null {
    let value = parseFactor();
    while (value !== null && (tokens[cursor] === "*" || tokens[cursor] === "/")) {
      const operator = tokens[cursor++];
      const right = parseFactor();
      if (right === null || (operator === "/" && right === 0)) return null;
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function parseExpression(): number | null {
    let value = parseTerm();
    while (value !== null && (tokens[cursor] === "+" || tokens[cursor] === "-")) {
      const operator = tokens[cursor++];
      const right = parseTerm();
      if (right === null) return null;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = parseExpression();
  return cursor === tokens.length && result !== null && Number.isFinite(result) ? result : null;
}

function evaluateDescriptionAmount(
  description: string,
  marks: RateAnalysisMarks,
  runningTotal: number,
) {
  const percentOfMark = description.match(/(\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?s?)\s*of\s*([PWARXYZ])\b(?!\s*\.\s*[A-Za-z])/i);
  if (percentOfMark) {
    const mark = percentOfMark[2].toUpperCase();
    if (marks[mark] === undefined) throw new Error(`Rate-analysis formula refers to missing mark ${mark}: ${description}`);
    return roundCurrency(marks[mark] * Number(percentOfMark[1]) / 100);
  }

  const addPercentage = description.match(/\badd\s+(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent(?:age)?s?)\b/i);
  if (addPercentage) {
    const expression = extractMarkExpression(description);
    const base = expression ? evaluateMarkExpression(expression, marks) : runningTotal;
    if (base === null) throw new Error(`Rate-analysis formula refers to a missing mark: ${description}`);
    return roundCurrency(base * Number(addPercentage[1]) / 100);
  }

  const expression = extractMarkExpression(description);
  if (!expression) return null;
  const amount = evaluateMarkExpression(expression, marks);
  if (amount === null) throw new Error(`Rate-analysis formula refers to a missing mark: ${description}`);
  return roundCurrency(amount);
}

export default function DsrEstimatorApp() {
  const [hasExited, setHasExited] = useState(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadSlow, setLoadSlow] = useState<boolean>(false);
  const [appTheme, setAppTheme] = useState<ThemeSettings>(DEFAULT_THEME);
  const [showThemeModal, setShowThemeModal] = useState<boolean>(false);
  
  const [catalog, setCatalog] = useState<Record<string, SubHeadGroup>>({});
  const [rateAnalysisData, setRateAnalysisData] = useState<Record<string, RateAnalysis>>({});
  const [materialDb, setMaterialDb] = useState<Record<string, { desc: string, unit: string, rate: number }>>({});
  const [basicRateData, setBasicRateData] = useState<{ code: string; category: string; description: string; unit: string | null; rate: number | null }[]>([]);
  const [computedDarRates, setComputedDarRates] = useState<Record<string, number | null>>({});
  const [rateAnalysisLoading, setRateAnalysisLoading] = useState<boolean>(true);
  const [customNsrs, setCustomNsrs] = useState<DsrItem[]>([]);
  const rateAuditWarnings = useRef(new Set<string>());
  
  const [marketRates, setMarketRates] = useState<Record<string, number>>({});
  const [marketRatesHistory, setMarketRatesHistory] = useState<Record<string, number>[]>([]);
  const [marketRaFormat, setMarketRaFormat] = useState<string>("conventional");
  const [marketRaAddons, setMarketRaAddons] = useState<NsrAddon[]>([...DEFAULT_ADDONS]);
  
  const [selectedSubHead, setSelectedSubHead] = useState<string>("sh_2");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [tableSearchQueries, setTableSearchQueries] = useState<Record<string, string>>({});
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [estimateRows, setEstimateRows] = useState<MeasurementRow[]>([]);
  const [copiedRows, setCopiedRows] = useState<MeasurementRow[]>([]); 
  
  const [arModalStack, setArModalStack] = useState<string[]>([]);
  const [wrapDescriptions, setWrapDescriptions] = useState<boolean>(true);
  const [showSelectedSidebar, setShowSelectedSidebar] = useState<boolean>(true);
  const [globalMissingRa, setGlobalMissingRa] = useState<string[]>([]);
  
  const [mainNav, setMainNav] = useState<"home" | "selectItems" | "estimate" | "justification">("home");
  const [subEstimateNav, setSubEstimateNav] = useState<"measurement" | "abstract" | "generalAbstract" | "history" | "basicRatesList">("measurement");
  const [subJustificationNav, setSubJustificationNav] = useState<"raDsr" | "rateList" | "raMarket" | "justStatement" | "justSummary">("raDsr");
  const [activeTab, setActiveTab] = useState<string>("home"); 
  
  const [showNsrCreator, setShowNsrCreator] = useState<boolean>(false);
  const [nsrForm, setNsrForm] = useState<NsrForm>({ type: "51", parentCode: "", isHeadingOnly: false, copyCode: "", code: "", description: "", unit: "sqm", baseQty: 10, format: "conventional", customAddons: [...DEFAULT_ADDONS], rows: [{ isExplanation: false, code: "", desc: "", unit: "", qty: "", rate: "", amt: 0, mark: "" }] });
  const [isEditingNsr, setIsEditingNsr] = useState<string | null>(null);
  
  const [isListening, setIsListening] = useState<boolean>(false);
  const [voiceRecognitionObj, setVoiceRecognitionObj] = useState<SpeechRecognitionLike | null>(null);
  const [voiceModalItems, setVoiceModalItems] = useState<{code: string, checked: boolean, desc: string}[] | null>(null);
  const [voiceTranscriptBuffer, setVoiceTranscriptBuffer] = useState<string>("");
  
  const catalogRef = useRef<Record<string, SubHeadGroup>>({});
  const nsrRef = useRef<DsrItem[]>([]);
  const [addRowcounts, setAddRowcounts] = useState<Record<string, number>>({});
  const [existingDbIds, setExistingDbIds] = useState<string[]>([]);
  const [projectDetails, setProjectDetails] = useState<ProjectDetails>(DEFAULT_PROJECT_DETAILS);
  const [isEstimateLocked, setIsEstimateLocked] = useState<boolean>(false);
  
  const catalogScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const getRAData = (code: string) => {
      if (!code) return null; const norm = normalizeCode(code); if (rateAnalysisData[norm]) return rateAnalysisData[norm];
      const stripped = norm.replace(/[^A-Z0-9]/g, '');
      const foundKey = Object.keys(rateAnalysisData).find(k => k.replace(/[^A-Z0-9]/g, '') === stripped);
      return foundKey ? rateAnalysisData[foundKey] : null;
  };

  const resolveNestedAnalysisCode = (row: RateAnalysisRow) => {
      const rowText = `${row.description || ""} ${row.code || ""}`;
      const subArMatch = rowText.match(SUB_AR_REGEX);
      if (subArMatch) {
        const alias = normalizeCode(subArMatch[0]).replace(/[^A-Z0-9]/g, "");
        const candidates = Object.keys(rateAnalysisData).filter(key => normalizeCode(key).replace(/[^A-Z0-9]/g, "").startsWith(alias));
        const refMatch = rowText.match(/(?:REFERENCE|REF)\s*ITEM(?:\s*NO\.?)?\s*([0-9]+(?:\.[0-9]+)*)/i);
        if (refMatch) {
          const reference = normalizeCode(refMatch[1]).replace(/[^A-Z0-9]/g, "");
          const referencedKey = candidates.find(key => {
            const normalizedKey = normalizeCode(key).replace(/[^A-Z0-9]/g, "");
            return normalizedKey.includes(`REFERENCEITEMNO${reference}`) || normalizedKey.includes(`REFITEM${reference}`);
          });
          if (referencedKey) return referencedKey;
        }
        const exactKey = candidates.find(key => normalizeCode(key).replace(/[^A-Z0-9]/g, "") === alias);
        return exactKey || (candidates.length === 1 ? candidates[0] : "");
      }
      if (row.code && ITEM_CODE_REGEX.test(row.code.trim())) return normalizeCode(row.code);
      if (row.mark === "A") {
        const itemCode = rowText.match(/\d+[a-zA-Z]*(?:\.[a-zA-Z0-9()]+)+/);
        if (itemCode) return normalizeCode(itemCode[0]);
      }
      return "";
    };

  const handleSelectSubhead = (key: string) => {
    setSelectedSubHead(key);
    requestAnimationFrame(() => { if (catalogScrollRef.current) catalogScrollRef.current.scrollTop = 0; });
  };

  const getSelectedCountForSubhead = (shKey: string) => {
    const shGroup = catalog[shKey];
    if (!shGroup || !shGroup.items) return 0;
    const shCodes = new Set(shGroup.items.map(i => normalizeCode(i.code)));
    return Array.from(addedItemSet).filter(code => shCodes.has(normalizeCode(code))).length;
  };

  const buildAddonBlock = (
    sum: number,
    sumA: number,
    format: string,
    addons: NsrAddon[],
    itemCode: string,
    variableMarks: RateAnalysisMarks = {},
    sourceRows: RateAnalysisRow[] = [],
  ) => {
     const raBlock: RateAnalysisRow[] = [];
     const marks: RateAnalysisMarks = { ...variableMarks, W: sum };
     raBlock.push({ code: "", description: "TOTAL Materials & Labour", unit: "", quantity: "", rate: "", amount: sum.toFixed(2), mark: "W" });
     if (itemCode && itemCode.startsWith("3.")) return { finalGrandTotal: sum, raBlock };
     let currentTotal = sum;
     const subtotalMarks = ['X', 'Y', 'Z', 'B', 'C', 'D'];
     const getBase = (subtotalMark: string, keyword: RegExp) => {
       const sourceDescription = sourceRows.find((row) => keyword.test(String(row.description || "")) && /\badd\b/i.test(String(row.description || "")))?.description || "";
       const expression = extractMarkExpression(sourceDescription);
       const evaluated = expression ? evaluateMarkExpression(expression, marks) : null;
       return Math.max(0, evaluated ?? ((marks[subtotalMark] ?? currentTotal) - sumA));
     };

     if (format === 'conventional') {
         const waterBase = getBase("W", /water\s+charges/i); if (waterBase > 0) { const water = roundCurrency(waterBase * 0.01); raBlock.push({ code: "", description: sumA > 0 ? 'Add 1% Water charges on "W-A"' : "Add Water Charges @ 1%", unit: "", quantity: "", rate: "", amount: water.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + water); marks.X = currentTotal; raBlock.push({ code: "", description: "TOTAL", unit: "", quantity: "", rate: "", amount: currentTotal.toFixed(2), mark: "X" }); }
         const gstBase = getBase("X", /\bgst\b/i); if (gstBase > 0) { const gst = roundCurrency(gstBase * 0.2127); raBlock.push({ code: "", description: sumA > 0 ? 'Add GST on "X-A" (Factor 0.2127)' : "Add GST @ 18% (Factor 0.2127)", unit: "", quantity: "", rate: "", amount: gst.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + gst); marks.Y = currentTotal; raBlock.push({ code: "", description: "TOTAL", unit: "", quantity: "", rate: "", amount: currentTotal.toFixed(2), mark: "Y" }); }
         const cpohBase = getBase("Y", /cpoh/i); if (cpohBase > 0) { const cpoh = roundCurrency(cpohBase * 0.15); raBlock.push({ code: "", description: sumA > 0 ? 'Add 15% CPOH on "Y-A"' : "Add CPOH @ 15%", unit: "", quantity: "", rate: "", amount: cpoh.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + cpoh); marks.Z = currentTotal; raBlock.push({ code: "", description: "TOTAL", unit: "", quantity: "", rate: "", amount: currentTotal.toFixed(2), mark: "Z" }); }
         const cessBase = getBase("Z", /\bcess\b/i); if (cessBase > 0) { const cess = roundCurrency(cessBase * 0.01); raBlock.push({ code: "", description: sumA > 0 ? 'Add Cess @ 1% on "Z-A"' : "Add Labour Cess @ 1%", unit: "", quantity: "", rate: "", amount: cess.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + cess); }
     } else if (format === 'modified') {
         const waterBase = getBase("W", /water\s+charges/i); if (waterBase > 0) { const water = roundCurrency(waterBase * 0.01); raBlock.push({ code: "", description: sumA > 0 ? 'Add 1% Water charges on "W-A"' : "Add Water Charges @ 1%", unit: "", quantity: "", rate: "", amount: water.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + water); marks.X = currentTotal; raBlock.push({ code: "", description: "TOTAL", unit: "", quantity: "", rate: "", amount: currentTotal.toFixed(2), mark: "X" }); }
         const cpohBase = getBase("X", /cpoh/i); if (cpohBase > 0) { const cpoh = roundCurrency(cpohBase * 0.15); raBlock.push({ code: "", description: sumA > 0 ? 'Add 15% CPOH on "X-A"' : "Add CPOH @ 15%", unit: "", quantity: "", rate: "", amount: cpoh.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + cpoh); marks.Y = currentTotal; raBlock.push({ code: "", description: "TOTAL", unit: "", quantity: "", rate: "", amount: currentTotal.toFixed(2), mark: "Y" }); }
         const cessBase = getBase("Y", /\bcess\b/i); if (cessBase > 0) { const cess = roundCurrency(cessBase * 0.01); raBlock.push({ code: "", description: sumA > 0 ? 'Add Cess @ 1% on "Y-A"' : "Add Labour Cess @ 1%", unit: "", quantity: "", rate: "", amount: cess.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + cess); marks.Z = currentTotal; raBlock.push({ code: "", description: "TOTAL", unit: "", quantity: "", rate: "", amount: currentTotal.toFixed(2), mark: "Z" }); }
         const gstBase = getBase("Z", /\bgst\b/i); if (gstBase > 0) { const gst = roundCurrency(gstBase * 0.18); raBlock.push({ code: "", description: sumA > 0 ? 'Add GST on "Z-A" @ 18%' : "Add GST @ 18%", unit: "", quantity: "", rate: "", amount: gst.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + gst); }
     } else {
         let markIdx = 0;
         addons.filter(a => a.checked).forEach((addon, idx, arr) => {
             const amt = roundCurrency((Math.max(0, currentTotal - sumA)) * (addon.pct / 100));
             raBlock.push({ code: "", description: `Add ${addon.label} @ ${addon.pct}%`, unit: "", quantity: "", rate: "", amount: amt.toFixed(2), mark: "" }); currentTotal = roundCurrency(currentTotal + amt);
             if (idx < arr.length - 1) { const totalMark = subtotalMarks[markIdx] || ""; marks[totalMark] = currentTotal; raBlock.push({ code: "", description: "TOTAL", unit: "", quantity: "", rate: "", amount: currentTotal.toFixed(2), mark: totalMark }); markIdx++; }
         });
     }
     return { finalGrandTotal: currentTotal, raBlock };
  };

  const getComputedRA = (targetCode: string, isMarket: boolean, cache: Record<string, ComputedRateAnalysis> = {}) => {
      const inProgress = new Set<string>();
      const compute = (code: string) => {
          const normalizedCode = normalizeCode(code);
          if (cache[normalizedCode]) return cache[normalizedCode];
          if (inProgress.has(normalizedCode)) throw new Error(`Cyclic rate-analysis reference detected for item ${normalizedCode}.`);
          const orig = getRAData(normalizedCode);
          if (!orig || !orig.analysis) {
            const rate = isMarket && marketRates[normalizedCode] !== undefined
              ? marketRates[normalizedCode]
              : (findCatalogItemByCodeGlobal(catalog, customNsrs, normalizedCode)?.rate || 0);
            cache[normalizedCode] = { rate, baseQuantity: 1, unit: "unit", block: [] };
            return cache[normalizedCode];
          }
          inProgress.add(normalizedCode);
          try {
          let sum = 0; let sumA = 0; const baseRows: RateAnalysisRow[] = [];
          const marks: RateAnalysisMarks = {};
          let stopIdx = orig.analysis.findIndex((r: RateAnalysisRow) => { const d = (r.description || "").toLowerCase(); return d.includes("total materials & labour") || d.includes("total material") || r.mark === "W"; });
          if (stopIdx === -1) stopIdx = orig.analysis.length; 
          for (let i = 0; i < stopIdx; i++) {
              const r: RateAnalysisRow = orig.analysis[i]; const desc = (r.description || "").trim().toLowerCase();
              if (desc === "total" || /^(?:cost\s+(?:of|for|per)|rate\s+per|say)\b/.test(desc)) continue;
              if (!r.code && (!r.rate || r.rate === "") && (r.amount === "" || r.amount === null || r.amount === undefined) && !extractMarkExpression(String(r.description || "")) && !/\badd\s+\d+(?:\.\d+)?\s*(?:%|per\s*cent|percent)/i.test(String(r.description || ""))) { baseRows.push({ ...r, rate: "", amount: "" }); continue; }
              const c = String(r.code || "").trim(); let mRate = parseFloat(String(r.rate || "").replace(/,/g, "")) || 0;
              const analysisCode = resolveNestedAnalysisCode(r);
              const nestedAnalysis = analysisCode ? getRAData(analysisCode) : null;
              const numericCode = normalizeCode(c);
              const materialCode = /^\d+$/.test(numericCode) ? numericCode.replace(/^0+(?=\d)/, "") : numericCode;
              const mappedMaterial = materialDb[numericCode]
                || materialDb[materialCode]
                || (/^\d+$/.test(numericCode) ? materialDb[numericCode.padStart(4, "0")] : undefined);
              const localRateText = String(r.rate ?? "").replace(/,/g, "").trim();
              const hasExplicitArRate = localRateText !== "" && Number.isFinite(Number(localRateText));
              const localArRate = hasExplicitArRate ? Number(localRateText) : 0;
              if (isMarket) {
                  if (nestedAnalysis?.analysis?.length) { mRate = compute(analysisCode).rate; }
                  else if (numericCode && marketRates[numericCode] !== undefined) { mRate = marketRates[numericCode]; }
                  else if (["9999", "9988", "9977"].includes(numericCode)) { const id = `${numericCode}_${String(r.description || "").trim()}`; if (marketRates[id] !== undefined) mRate = marketRates[id]; else if (hasExplicitArRate) mRate = localArRate; else if (mappedMaterial) mRate = mappedMaterial.rate; }
                  else if (marketRates[String(r.description || "").trim()] !== undefined) { mRate = marketRates[String(r.description || "").trim()]; }
                  else if (hasExplicitArRate) { mRate = localArRate; }
                  else if (mappedMaterial) { mRate = mappedMaterial.rate; }
              } else {
                  if (hasExplicitArRate) { mRate = localArRate; }
                  else if (nestedAnalysis?.analysis?.length) { mRate = compute(analysisCode).rate; }
                  else if (mappedMaterial) { mRate = mappedMaterial.rate; }
              }
              const qty = parseFloat(String(r.quantity ?? "").replace(/,/g, "")) || 0;
              let rowMark = String(r.mark || "").trim().toUpperCase();
              const formulaMarks = { ...marks };
              ["W", "X", "Y", "Z"].forEach((subtotalMark) => {
                if (formulaMarks[subtotalMark] === undefined) formulaMarks[subtotalMark] = sum;
              });
              const formulaAmount = evaluateDescriptionAmount(String(r.description || ""), formulaMarks, sum);
              const staticAmountText = String(r.amount ?? "").replace(/,/g, "").trim();
              const staticAmount = staticAmountText !== "" && Number.isFinite(Number(staticAmountText)) ? Number(staticAmountText) : null;
              const hasRateBasedAmount = Boolean(c) && qty !== 0 && (mRate > 0 || hasExplicitArRate);
              const hasAmount = formulaAmount !== null || staticAmount !== null || hasRateBasedAmount;
              const amt = formulaAmount ?? (hasRateBasedAmount ? roundCurrency(qty * mRate) : (staticAmount === null ? 0 : roundCurrency(staticAmount)));
              const isSubhead3 = c
                ? c.trim().startsWith("3.")
                : /(?:item\s+no\.?\s*)?3\.\d+/i.test(desc);
              if (!rowMark && c && ITEM_CODE_REGEX.test(c.trim()) && !isSubhead3) { rowMark = "A"; }
              if (!rowMark && /rate as per item/i.test(desc) && !isSubhead3) { rowMark = "A"; }
              if (hasAmount) {
                sum = roundCurrency(sum + amt);
                if (rowMark === "A") {
                  sumA = roundCurrency(sumA + amt);
                  marks.A = roundCurrency((marks.A || 0) + amt);
                } else if (rowMark) {
                  marks[rowMark] = amt;
                }
              }
              baseRows.push({ ...r, rate: hasExplicitArRate || mRate > 0 ? mRate.toFixed(2) : "", amount: hasAmount ? amt.toFixed(2) : "", mark: rowMark });
          }
          const totals = buildAddonBlock(sum, sumA, isMarket ? marketRaFormat : "conventional", isMarket ? marketRaAddons : DEFAULT_ADDONS, code, marks, orig.analysis);
          const baseQty = getRateAnalysisBasis(orig);
          const catItem = findCatalogItemByCodeGlobal(catalog, customNsrs, code);
          const unit = orig.databaseUnit || catItem?.unit || "unit";
          const finalRateRaw = totals.finalGrandTotal / baseQty;
          const displayRateLabel = `Rate per 1 ${unit}`;
          totals.raBlock.push({ code: "", description: `Cost for ${baseQty} ${unit}`, unit: "", quantity: "", rate: "", amount: totals.finalGrandTotal.toFixed(2), mark: "" });
          const finalSayRate = roundToIncrement(finalRateRaw, 0.05); const footerRows = [ { code: "", description: displayRateLabel, unit: "", quantity: "", rate: "", amount: roundCurrency(finalRateRaw).toFixed(2), mark: "" }, { code: "", description: "Say", unit: "", quantity: "", rate: "", amount: finalSayRate.toFixed(2), mark: "" } ];
          cache[normalizedCode] = { rate: finalSayRate, baseQuantity: baseQty, unit, block: [...baseRows, ...totals.raBlock, ...footerRows] };
          return cache[normalizedCode];
          } finally {
            inProgress.delete(normalizedCode);
          }
      };
      return compute(targetCode);
  };

  const parentItemSet = useMemo(() => {
      const pSet = new Set<string>(); const allItems = [...Object.values(catalog).flatMap(g => g.items || []), ...customNsrs];
      allItems.forEach(i => { const c = normalizeCode(i.code); const parts = c.split("."); let curr = ""; for(let j=0; j<parts.length - 1; j++){ curr = curr ? `${curr}.${parts[j]}` : parts[j]; pSet.add(curr); } const alphaMatch = c.match(ALPHA_NUM_REGEX); if (alphaMatch) pSet.add(alphaMatch[1]); });
      ["2.14", "2.15", "9.1.2.4"].forEach(c => pSet.add(c)); return pSet;
  }, [catalog, customNsrs]);

  const addedItemSet = useMemo(() => new Set(estimateRows.map((r) => r.itemCode)), [estimateRows]);
  const checkedItemCodes = useMemo(() => Object.keys(checkedItems).filter((c) => checkedItems[c]), [checkedItems]);
  const combinedGlimpseCodes = useMemo(() => Array.from(new Set([...Array.from(addedItemSet), ...checkedItemCodes])).sort(compareDsrCodes), [addedItemSet, checkedItemCodes]);
  const allCatalogItems = useMemo(() => Object.values(catalog).flatMap((g) => g.items || []), [catalog]);
  const nsrUnitOptions = useMemo(() => Array.from(new Set([...Object.values(materialDb).map((material) => material.unit), ...allCatalogItems.map((item) => item.unit)].map((unit) => String(unit || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [materialDb, allCatalogItems]);
  const nsrLookupCodes = useMemo(() => Array.from(new Set([...Object.keys(materialDb), ...allCatalogItems.map((item) => item.code)])).sort(compareDsrCodes), [materialDb, allCatalogItems]);
  const searchedCatalogMatches = useMemo(() => { if (!searchQuery.trim()) return []; return [...allCatalogItems, ...customNsrs].filter((item) => !item.isMain && !item.isDeleted && (item.code.toLowerCase().includes(searchQuery.toLowerCase()) || item.description.toLowerCase().includes(searchQuery.toLowerCase()))); }, [searchQuery, allCatalogItems, customNsrs]);

  const hasItemsInBoq = addedItemSet.size > 0;
  const canHome = !isEstimateLocked; const canSelectItems = !isEstimateLocked; const canEstimate = hasItemsInBoq && !isEstimateLocked; const canJustification = hasItemsInBoq && isEstimateLocked;
  const subHeadKeys = useMemo(() => Object.keys(catalog).sort((a, b) => parseInt(a.replace("sh_", "") || "0") - parseInt(b.replace("sh_", "") || "0")), [catalog]);
  const currentGroup = useMemo(() => catalog[selectedSubHead] || { label: selectedSubHead, items: [] }, [catalog, selectedSubHead]);
  const filteredItems = useMemo(() => { return (currentGroup.items || []).filter((item) => { if (!searchQuery) return true; return item.code.toLowerCase().includes(searchQuery.toLowerCase()) || item.description.toLowerCase().includes(searchQuery.toLowerCase()); }); }, [currentGroup.items, searchQuery]);
  const sortedEstimateRows = useMemo(() => [...estimateRows].sort((a, b) => compareDsrCodes(a.itemCode, b.itemCode)), [estimateRows]);

  const groupedItemsMap = useMemo(() => {
      const map: { itemCode: string; description: string; unit: string; rate: number; rows: MeasurementRow[]; finalGroupQty: number; }[] = []; const indexMap: Record<string, number> = {};
      sortedEstimateRows.forEach((row) => { if (!(row.itemCode in indexMap)) { indexMap[row.itemCode] = map.length; map.push({ itemCode: row.itemCode, description: row.description, unit: row.unit, rate: row.rate, rows: [], finalGroupQty: 0 }); } const grp = map[indexMap[row.itemCode]]; grp.rows.push(row); grp.finalGroupQty += row.quantity; }); return map;
  }, [sortedEstimateRows]);

  const pathNodes = useMemo(() => {
    const codeToSlNo: Record<string, string> = {}; const chapterSeqMap: Record<string, number> = {}; const parentChildCounter: Record<string, number> = {}; let globalChapIdx = 0; const emittedSet = new Set<string>();
    return groupedItemsMap.flatMap((grp) => {
      const parts = grp.itemCode.split("."); const chapKey = parts[0] || "1";
      if (!(chapKey in chapterSeqMap)) { globalChapIdx++; chapterSeqMap[chapKey] = globalChapIdx; } const cIdx = chapterSeqMap[chapKey];
      const nodes: AbstractPathNode[] = []; const prefixes: string[] = []; let runningPrefix = "";
      for (let i = 0; i < parts.length; i++) { runningPrefix = runningPrefix ? `${runningPrefix}.${parts[i]}` : parts[i]; prefixes.push(runningPrefix); }
      prefixes.forEach((pref, idx) => {
        const prefParts = pref.split("."); const isLeafTarget = pref === grp.itemCode && idx === prefixes.length - 1;
        if (!codeToSlNo[pref]) { if (prefParts.length === 1) { codeToSlNo[pref] = `${cIdx}`; } else if (prefParts.length === 2) { const siblingParents = Object.keys(codeToSlNo).filter((k) => k.split(".").length === 2 && k.startsWith(`${chapKey}.`)).length + 1; codeToSlNo[pref] = `${cIdx}.${siblingParents}`; } else { const parentKey = prefParts.slice(0, -1).join("."); const baseSl = codeToSlNo[parentKey] || `${cIdx}.1`; parentChildCounter[parentKey] = (parentChildCounter[parentKey] || 0) + 1; codeToSlNo[pref] = `${baseSl}.${parentChildCounter[parentKey]}`; } }
        if (!emittedSet.has(pref) || isLeafTarget) { if (!emittedSet.has(pref)) emittedSet.add(pref); const catalogMat = findCatalogItemByCodeGlobal(catalog, customNsrs, pref); const hasLeafRate = catalogMat ? (Number(catalogMat.rate) || 0) > 0 : false; nodes.push({ slNo: codeToSlNo[pref], itemCode: pref, description: getStrictExactLevelDescriptionGlobal(catalog, customNsrs, pref), isParentRow: !isLeafTarget, unit: isLeafTarget ? grp.unit : undefined, rate: isLeafTarget ? grp.rate : undefined, subtotalQty: isLeafTarget ? grp.finalGroupQty : undefined, finalGroupQty: isLeafTarget ? grp.finalGroupQty : undefined, rows: isLeafTarget ? grp.rows : undefined, hasRate: isLeafTarget ? (Number(grp.rate) || 0) > 0 : hasLeafRate }); }
      });
      return nodes;
    });
  }, [groupedItemsMap, catalog, customNsrs]);

  const abstractSummaryList = useMemo<AbstractSummaryItem[]>(() => {
    const calculationCache: Record<string, ComputedRateAnalysis> = {};
    return pathNodes.map((node) => {
      const finalQty = node.finalGroupQty || (node.subtotalQty || 0);
      const rate = node.rate || 0;
      const analysis = getRAData(node.itemCode);
      const rateDAR = !node.isParentRow && analysis?.analysis?.length
        ? getComputedRA(node.itemCode, false, calculationCache).rate
        : null;
      return {
        itemCode: node.itemCode,
        treeSlNo: node.slNo,
        description: node.description,
        isParentRow: node.isParentRow,
        unit: node.unit || "cum",
        totalQty: finalQty,
        rate,
        rateDAR,
        amount: node.isParentRow ? 0 : Math.round(finalQty * rate),
        hasRate: node.hasRate,
      };
    });
  }, [pathNodes, rateAnalysisData, materialDb, catalog, customNsrs]);
  const abstractGroups: Record<string, AbstractSummaryItem[]> = useMemo(() => { const groups: Record<string, AbstractSummaryItem[]> = {}; abstractSummaryList.forEach((n) => { let shKey = "nsr"; if (!n.itemCode.startsWith("50.") && !n.itemCode.startsWith("51.")) { shKey = `sh_${n.itemCode.split(".")[0]}`; } else { shKey = n.itemCode.startsWith("50.") ? "sh_50" : "sh_51"; } if (!groups[shKey]) groups[shKey] = []; groups[shKey].push(n); }); return groups; }, [abstractSummaryList]);
  const { baseDsrMdsrTotal, baseNsrTotal } = useMemo(() => { let dsr = 0; let nsr = 0; abstractSummaryList.forEach(item => { if (item.itemCode.startsWith('51.')) nsr += item.amount; else dsr += item.amount; }); return { baseDsrMdsrTotal: dsr, baseNsrTotal: nsr }; }, [abstractSummaryList]);
  
  const modFactor = projectDetails.modificationFactorType === "custom" ? (parseFloat(projectDetails.customModificationFactor) || 1) : parseFloat(projectDetails.modificationFactorType) || 1;
  const cIndexPct = parseFloat(projectDetails.costIndex) || 0;
  const adjustedModTotal = Math.round(baseDsrMdsrTotal * modFactor);
  const costIndexAmount = Math.round(adjustedModTotal * (cIndexPct / 100)); 
  const adjustedSubTotalD = Math.round(adjustedModTotal + costIndexAmount + baseNsrTotal); 
  const currentCategory = WORK_CATEGORIES[projectDetails.workCategory] || WORK_CATEGORIES["maintenance"];
  const epfPct = projectDetails.workCategory === "custom" ? (parseFloat(projectDetails.customEpf)||0) : (currentCategory.epf || 0);
  const esiPct = projectDetails.workCategory === "custom" ? (parseFloat(projectDetails.customEsi)||0) : (currentCategory.esi || 0);
  const epfAmount = Math.round(adjustedSubTotalD * (epfPct / 100));
  const esiAmount = Math.round(adjustedSubTotalD * (esiPct / 100));
  let contingencyAmount = 0; let contingencyLabel = "";
  if (projectDetails.contingencyType === "cpwd") { if (adjustedSubTotalD <= 30000000) { contingencyAmount = Math.round(adjustedSubTotalD * 0.05); contingencyLabel = "5%"; } else { contingencyAmount = Math.round(Math.max(1500000, adjustedSubTotalD * 0.03)); contingencyLabel = "3% (Subject to minimum 15 lakhs)"; } } else { const cPct = parseFloat(projectDetails.customContingency) || 0; contingencyAmount = Math.round(adjustedSubTotalD * (cPct / 100)); contingencyLabel = `${cPct}% (Custom)`; }
  const grandTotalAbstractAmount = Math.round((adjustedSubTotalD + epfAmount + esiAmount + contingencyAmount) / 100) * 100;

  const generalAbstractList = useMemo(() => { const gMap: Record<string, { subheadKey: string; subheadLabel: string; totalAmount: number }> = {}; Object.keys(abstractGroups).forEach((shKey) => { gMap[shKey] = { subheadKey: shKey, subheadLabel: DSR_CHAPTER_NAMES[shKey] || catalog[shKey]?.label || `Subhead ${shKey.replace('sh_','')}`, totalAmount: abstractGroups[shKey].reduce((sum, i) => sum + i.amount, 0) }; }); return Object.values(gMap); }, [abstractGroups, catalog]);

  function getSubARCodesRecursive(baseCodes: string[]) {
     const subs = new Set<string>(); const queue = [...baseCodes]; const queued = new Set(queue.map(normalizeCode));
    while (queue.length > 0) {
       const code = queue.shift(); if (!code) continue;
       const obj = getRAData(code);
       if (obj && obj.analysis) {
          obj.analysis.forEach((row) => {
           const nestedCode = resolveNestedAnalysisCode(row);
           if (nestedCode && !queued.has(normalizeCode(nestedCode))) {
              subs.add(nestedCode);
              queue.push(nestedCode);
              queued.add(normalizeCode(nestedCode));
           }
          });
       }
    }
    return Array.from(subs);
  }

  const selectedBoqItemCodes = useMemo(() => Array.from(addedItemSet).sort(compareDsrCodes), [addedItemSet]);
  const basicRateRows = useMemo(() => {
    if (activeTab !== "basicRatesList") return [];
    const uniqueItems = new Map<string, { code: string; description: string; unit: string; rate: number; isCarriage: boolean }>();
    basicRateData.forEach((row) => {
      const code = normalizeCode(row.code);
      const description = String(row.description || "").trim();
      const unit = String(row.unit || "").trim();
      if (!code || !description) return;
      const key = code === "9999" ? code : `${code}:${row.category}`;
      if (!uniqueItems.has(key)) {
        uniqueItems.set(key, {
          code,
          description,
          unit: unit || "-",
          rate: Number(row.rate) || 0,
          isCarriage: /^carriage\s+of\b/i.test(description),
        });
      }
    });
    return Array.from(uniqueItems.values()).sort((a, b) => {
        if (a.isCarriage !== b.isCarriage) return a.isCarriage ? 1 : -1;
        if (/^\d+$/.test(a.code) && /^\d+$/.test(b.code)) return compareNumericStrings(a.code, b.code);
        return a.code.localeCompare(b.code) || a.description.localeCompare(b.description);
      });
  }, [activeTab, basicRateData]);
  const filteredBasicRateRows = useMemo(() => basicRateRows.filter((item) => matchesSearch(tableSearchQueries.basicRatesList || "", item.code, item.description)), [basicRateRows, tableSearchQueries.basicRatesList]);
  const globalSubARs = useMemo(() => { const subs = new Set<string>(); const renderBoqCodes = selectedBoqItemCodes.filter(c => !PERCENTAGE_ITEMS.includes(c)); renderBoqCodes.forEach(code => { const subList = getSubARCodesRecursive([code]); subList.forEach(s => subs.add(s)); }); renderBoqCodes.forEach(code => subs.delete(normalizeCode(code))); return Array.from(subs).sort(compareDsrCodes); }, [selectedBoqItemCodes, rateAnalysisData]);
  
  const justificationMaterials = useMemo(() => {
      const uniqueMaterialsMap = new Map<string, JustificationMaterial>();
      if (activeTab === "rateList" || activeTab === "marketRateAnalysis") {
        selectedBoqItemCodes.forEach(code => {
          [code, ...getSubARCodesRecursive([code])].forEach(c => {
             const ra = getRAData(c);
             if (ra && ra.analysis) {
                 ra.analysis.forEach((row, rowIndex) => {
                     if (row.rate && !isNaN(Number(row.rate)) && row.quantity && !isNaN(Number(row.quantity)) && row.description && !row.description.toLowerCase().includes("say") && !row.description.toLowerCase().includes("cost for") && !row.mark) {
                         const subArMatch = (row.description || "").match(SUB_AR_REGEX) || (row.code || "").match(SUB_AR_REGEX);
                         if (!subArMatch && !(row.code && ITEM_CODE_REGEX.test(row.code.trim())) && !(/rate as per item/i.test(row.description))) {
                             const isSundry = row.code === "9999" || row.code === "9988" || row.code === "9977"; const matId = isSundry ? `${normalizeCode(c)}_${rowIndex}_${row.code}_${row.description.trim()}` : (row.code ? row.code.trim() : row.description.trim());
                             if (!uniqueMaterialsMap.has(matId)) {
                                 let group = "3"; const leadingCode = row.code?.match(/^\d+/)?.[0]; if (leadingCode) { if (compareNumericStrings(leadingCode, "1") >= 0 && compareNumericStrings(leadingCode, "99") <= 0) group = "1"; else if (compareNumericStrings(leadingCode, "100") >= 0 && compareNumericStrings(leadingCode, "221") <= 0) group = "2"; else if (compareNumericStrings(leadingCode, "2200") >= 0 && compareNumericStrings(leadingCode, "2358") <= 0) group = "4"; }
                                 uniqueMaterialsMap.set(matId, { id: matId, code: row.code || "-", description: row.description, unit: row.unit || "-", dsrRate: Number(row.rate), group: group });
                             }
                         }
                     }
                 });
             }
          });
        });
      }
      return Array.from(uniqueMaterialsMap.values()).sort((a, b) => { if (a.group !== b.group) return a.group.localeCompare(b.group); if (a.group === "3") { const aIsNum = /^\d+$/.test(a.code); const bIsNum = /^\d+$/.test(b.code); if (aIsNum && !bIsNum) return -1; if (!aIsNum && bIsNum) return 1; if (aIsNum && bIsNum) return compareNumericStrings(a.code, b.code); } return a.code.localeCompare(b.code); });
  }, [activeTab, selectedBoqItemCodes, rateAnalysisData]);
  const filteredJustificationMaterials = useMemo(() => justificationMaterials.filter((item) => matchesSearch(tableSearchQueries.rateList || "", item.code, item.description)), [justificationMaterials, tableSearchQueries.rateList]);
  const filteredPathNodes = useMemo<AbstractPathNode[]>(() => {
    const query = tableSearchQueries.measurement || "";
    return pathNodes.flatMap((node) => {
      const nodeMatches = matchesSearch(query, node.itemCode, node.description);
      if (node.isParentRow) return nodeMatches ? [node] : [];
      const rows = (node.rows || []).filter((row: MeasurementRow) => nodeMatches || matchesSearch(query, row.itemCode, row.description, row.locationDesc));
      return nodeMatches || rows.length > 0 ? [{ ...node, rows }] : [];
    });
  }, [pathNodes, tableSearchQueries.measurement]);
  const filteredAbstractGroups = useMemo<Record<string, AbstractSummaryItem[]>>(() => {
    const filteredGroups: Record<string, AbstractSummaryItem[]> = {};
    Object.entries(abstractGroups).forEach(([key, items]) => {
      const filteredItems = items.filter((item) => matchesSearch(tableSearchQueries.abstract || "", item.itemCode, item.description));
      if (filteredItems.length > 0) filteredGroups[key] = filteredItems;
    });
    return filteredGroups;
  }, [abstractGroups, tableSearchQueries.abstract]);
  const filteredAbstractCount = Object.values(filteredAbstractGroups).reduce((count, items) => count + items.length, 0);
  const raSearchQuery = tableSearchQueries[activeTab] || "";
  const filteredRaItemCodes = useMemo(() => selectedBoqItemCodes.filter((code) => {
    if (PERCENTAGE_ITEMS.includes(code)) return false;
    const item = findCatalogItemByCodeGlobal(catalog, customNsrs, code);
    const analysis = getRAData(code);
    return matchesSearch(raSearchQuery, code, item?.description, item?.fullDescription, analysis?.description)
      || Boolean(analysis?.analysis?.some((row) => matchesSearch(raSearchQuery, row.code, row.description)));
  }), [selectedBoqItemCodes, raSearchQuery, catalog, customNsrs, rateAnalysisData]);
  const filteredRaSubCodes = useMemo(() => globalSubARs.filter((code) => {
    const item = findCatalogItemByCodeGlobal(catalog, customNsrs, code);
    const analysis = getRAData(code);
    return matchesSearch(raSearchQuery, code, item?.description, item?.fullDescription, analysis?.description)
      || Boolean(analysis?.analysis?.some((row) => matchesSearch(raSearchQuery, row.code, row.description)));
  }), [globalSubARs, raSearchQuery, catalog, customNsrs, rateAnalysisData]);

  useEffect(() => { const savedTheme = localStorage.getItem('estiPro_themeSettings'); if (savedTheme) { try { setAppTheme(JSON.parse(savedTheme)); } catch (e) {} } const savedIds = localStorage.getItem('estiPro_estimateIds'); if (savedIds) { try { setExistingDbIds(JSON.parse(savedIds)); } catch(e) {} } }, []);
  useEffect(() => { const interval = setInterval(() => { if (projectDetails.estimateId && projectDetails.estimateId.trim() !== "") { const customRaData: Record<string, RateAnalysis> = {}; Object.keys(rateAnalysisData).forEach(k => { if (k.startsWith('50.') || k.startsWith('51.')) customRaData[k] = rateAnalysisData[k]; }); try { localStorage.setItem(`estiPro_autoSave_${projectDetails.estimateId}`, JSON.stringify({ projectDetails, estimateRows, checkedItems, customNsrs, rateAnalysisData: customRaData, marketRates, marketRaFormat, marketRaAddons })); } catch (e) { console.warn("Auto-save quota exceeded. Custom RA items not saved."); } } }, 30000); return () => clearInterval(interval); }, [projectDetails, estimateRows, checkedItems, customNsrs, rateAnalysisData, marketRates, marketRaFormat, marketRaAddons]);
  useEffect(() => { catalogRef.current = catalog; nsrRef.current = customNsrs; }, [catalog, customNsrs]);
  useEffect(() => {
    let isActive = true;
    let loadedCatalog: Record<string, SubHeadGroup> | null = null;
    const slowTimer = setTimeout(() => setLoadSlow(true), 4000);
    const catalogPromise = fetch("/data/pure_dsr.json")
      .then((response) => {
        if (!response.ok) throw new Error(`DSR catalog request failed (${response.status}).`);
        return response.json();
      })
      .then((dsrData: Record<string, SubHeadGroup>) => {
        if (!isActive) return null;
        loadedCatalog = dsrData;
        let savedNsrsArray: DsrItem[] = [];
        try {
          savedNsrsArray = parseNsrItems(JSON.parse(localStorage.getItem("estiPro_nsrItems") || "[]") as unknown);
        } catch (error) {
          console.error("Could not restore saved NSR items:", error);
        }
        loadedCatalog["sh_50"] = {
          label: "SH 50: MODIFIED DSR ITEMS (MDSR/DR)",
          items: savedNsrsArray.filter((item) => item.code.startsWith("50.")),
        };
        loadedCatalog["sh_51"] = {
          label: "SH 51: NON-SCHEDULE ITEMS (NSR)",
          items: savedNsrsArray.filter((item) => item.code.startsWith("51.")),
        };
        setCatalog(loadedCatalog);
        setLoading(false);
        setLoadSlow(false);
        clearTimeout(slowTimer);
        return loadedCatalog;
      })
      .catch((error) => {
        if (isActive) {
          console.error("Could not load DSR catalog:", error);
          setLoading(false);
          setLoadSlow(false);
        }
        return null;
      });

    catalogPromise
      .then(async (catalogData) => {
        if (!isActive) return;
        if (!catalogData) {
          setRateAnalysisLoading(false);
          return;
        }

        const itemCodes = Array.from(new Set(
          Object.values(catalogData)
            .flatMap((group) => group.items || [])
            .map((item) => normalizeCode(item.code))
            .filter((code) => code && !code.startsWith("50.") && !code.startsWith("51.")),
        ));
        const [response, legacyResponse] = await Promise.all([
          fetch("/api/rate-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemCodes }),
          }),
          fetch("/data/rate_analysis_master.json"),
        ]);
        if (!response.ok) throw new Error(`Rate analysis request failed (${response.status}).`);
        if (!legacyResponse.ok) throw new Error(`Rate-analysis basis descriptions request failed (${legacyResponse.status}).`);
        const loadedDatabase = await response.json() as DatabaseAnalysisResponse;
        const legacyAnalyses = await legacyResponse.json() as Record<string, RateAnalysis>;
        const allDatabaseComponents = new Map<string, DatabaseRateAnalysisComponent[]>();
        loadedDatabase.allSubComponents.forEach((component) => {
          const components = allDatabaseComponents.get(component.analysis_code) || [];
          components.push(component);
          allDatabaseComponents.set(component.analysis_code, components);
        });
        const allDatabaseSubAnalyses = new Map(loadedDatabase.allSubAnalyses.map((analysis) => [analysis.analysis_code, analysis]));
        const catalogItems = new Map(
          Object.values(catalogData)
            .flatMap((group) => group.items || [])
            .map((item) => [normalizeCode(item.code), item] as const),
        );
        const normalizedRa: Record<string, RateAnalysis> = {};
        Object.entries(loadedDatabase.analyses).forEach(([itemCode, entry]) => {
          const nestedRecord = entry.subAnalysis || allDatabaseSubAnalyses.get(itemCode);
          const nestedComponents = entry.subComponents.length > 0
            ? entry.subComponents
            : (allDatabaseComponents.get(itemCode) || []);
          const components = entry.components.length > 0 ? entry.components : nestedComponents;
          const legacyAnalysis = legacyAnalyses[normalizeCode(itemCode)]
            || legacyAnalyses[normalizeCode(entry.sourceItemCode)];
          const basisDescriptions = getBasisDescriptions(legacyAnalysis);
          const analysis: RateAnalysisRow[] = components.length > 0
            ? components.map((component) => ({
              code: component.reference_analysis_code || component.reference_item_code || component.component_code || "",
              description: component.description || "",
              unit: component.unit || "",
              quantity: component.quantity ?? "",
              rate: component.rate ?? "",
              amount: component.amount ?? "",
              mark: component.reference_analysis_code || component.reference_item_code ||
                /SUB.?ANALYSIS|SUB.?AR/i.test(component.component_type) ? "A" : "",
            }))
            : (legacyAnalysis?.analysis || []);
          normalizedRa[normalizeCode(itemCode)] = {
            code: itemCode,
            description: entry.darItem?.description || nestedRecord?.description ||
              catalogItems.get(normalizeCode(itemCode))?.description || legacyAnalysis?.description || "",
            analysis,
            basisDescriptions,
            databaseBasis: entry.darItem?.rate_basis ?? nestedRecord?.quantity_basis ?? null,
            databaseUnit: entry.darItem?.unit || nestedRecord?.unit || null,
          };
        });
        allDatabaseSubAnalyses.forEach((subAnalysis, analysisCode) => {
          if (normalizedRa[normalizeCode(analysisCode)]) return;
          const legacyAnalysis = legacyAnalyses[normalizeCode(analysisCode)];
          normalizedRa[normalizeCode(analysisCode)] = {
            code: analysisCode,
            description: subAnalysis.description || legacyAnalysis?.description || "",
            analysis: (allDatabaseComponents.get(analysisCode) || []).map((component) => ({
              code: component.reference_analysis_code || component.reference_item_code || component.component_code || "",
              description: component.description || "",
              unit: component.unit || "",
              quantity: component.quantity ?? "",
              rate: component.rate ?? "",
              amount: component.amount ?? "",
              mark: component.reference_analysis_code || component.reference_item_code ||
                /SUB.?ANALYSIS|SUB.?AR/i.test(component.component_type) ? "A" : "",
            })),
            basisDescriptions: getBasisDescriptions(legacyAnalysis),
            databaseBasis: subAnalysis.quantity_basis,
            databaseUnit: subAnalysis.unit,
          };
        });
        Object.entries(legacyAnalyses).forEach(([analysisCode, legacyAnalysis]) => {
          const normalizedCode = normalizeCode(analysisCode);
          if (normalizedRa[normalizedCode] || !legacyAnalysis.analysis?.length) return;
          normalizedRa[normalizedCode] = {
            ...legacyAnalysis,
            basisDescriptions: getBasisDescriptions(legacyAnalysis),
          };
        });
        try {
          const savedNsrRa: unknown = JSON.parse(localStorage.getItem("estiPro_nsrRateAnalysis") || "{}");
          if (isRecord(savedNsrRa)) Object.entries(savedNsrRa).forEach(([key, analysis]) => {
            if (isRateAnalysis(analysis)) normalizedRa[normalizeCode(key)] = analysis;
          });
        } catch (error) {
          console.error("Could not restore saved NSR rate analyses:", error);
        }
        setRateAnalysisData(normalizedRa);

        const allItems = Object.values(catalogData).flatMap((group) => group.items || []);
        const parentCodes = new Set<string>();
        allItems.forEach((item) => {
          const code = normalizeCode(item.code);
          const parts = code.split(".");
          let parentCode = "";
          for (let index = 0; index < parts.length - 1; index++) {
            parentCode = parentCode ? `${parentCode}.${parts[index]}` : parts[index];
            parentCodes.add(parentCode);
          }
          const alphaMatch = code.match(ALPHA_NUM_REGEX);
          if (alphaMatch) parentCodes.add(alphaMatch[1]);
        });
        ["2.14", "2.15", "9.1.2.4"].forEach((code) => parentCodes.add(code));

        const missingItems = allItems
          .filter((item) => {
            if (item.isMain || item.isDeleted || !Number(item.rate) || parentCodes.has(normalizeCode(item.code)) || PERCENTAGE_ITEMS.includes(normalizeCode(item.code))) {
              return false;
            }
            const analysis = normalizedRa[normalizeCode(item.code)];
            return !analysis?.analysis?.length;
          })
          .map((item) => item.code);
        setGlobalMissingRa(Array.from(new Set(missingItems)));
        setRateAnalysisLoading(false);
      })
      .catch((error) => {
        if (isActive) {
          console.error("Could not load rate analyses:", error);
          setRateAnalysisLoading(false);
        }
      });

    return () => {
      isActive = false;
      clearTimeout(slowTimer);
    };
  }, []);

  useEffect(() => {
    const items = catalog[selectedSubHead]?.items || [];
    if (items.length === 0 || Object.keys(rateAnalysisData).length === 0) return;

    let isActive = true;
    let timer: ReturnType<typeof setTimeout>;
    let index = 0;
    const computedRates: Record<string, number | null> = {};
    const calculationCache: Record<string, ComputedRateAnalysis> = {};
    const batchSize = 30;

    const calculateBatch = () => {
      if (!isActive) return;
      const end = Math.min(index + batchSize, items.length);
      for (; index < end; index++) {
        const item = items[index];
        const analysis = getRAData(item.code);
        const rateDR = analysis?.analysis?.length
          ? getComputedRA(item.code, false, calculationCache)?.rate ?? null
          : null;
        computedRates[item.code] = rateDR;
        const rateDSR = Number(item.rate);
        if (rateDR !== null && Number.isFinite(rateDSR) && Math.abs(rateDR - rateDSR) > 1) {
          const auditKey = `${normalizeCode(item.code)}:${rateDSR}:${rateDR}`;
          if (!rateAuditWarnings.current.has(auditKey)) {
            rateAuditWarnings.current.add(auditKey);
            console.warn("Rate DR differs from Rate DSR by more than ₹1.", {
              itemCode: item.code,
              rateDSR,
              rateDR,
              difference: Number((rateDR - rateDSR).toFixed(2)),
            });
          }
        }
      }

      if (index < items.length) {
        timer = setTimeout(calculateBatch, 0);
      } else if (isActive) {
        setComputedDarRates((currentRates) => ({ ...currentRates, ...computedRates }));
      }
    };

    timer = setTimeout(calculateBatch, 0);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [catalog, selectedSubHead, rateAnalysisData, materialDb]);

  useEffect(() => {
    let isActive = true;
    fetch("/api/basic-rates")
      .then((response) => {
        if (!response.ok) throw new Error(`Basic rates request failed (${response.status}).`);
        return response.json();
      })
      .then((rows: { code: string; category: string; description: string; unit: string | null; rate: number | null }[]) => {
        if (!Array.isArray(rows)) throw new Error("Basic rates response was not an array.");
        if (!isActive) return;
        const materials: Record<string, { desc: string; unit: string; rate: number }> = {};
        rows.forEach((row) => {
          const code = normalizeCode(row.code);
          const desc = String(row.description || "").trim();
          const unit = String(row.unit || "").trim();
          const rate = Number(row.rate);
          if (/^\d+$/.test(code) && desc && unit) materials[code] = { desc, unit, rate: Number.isFinite(rate) ? rate : 0 };
        });
        setBasicRateData(rows);
        setMaterialDb(materials);
      })
      .catch((error) => console.error("Could not load basic material rates:", error));
    return () => { isActive = false; };
  }, []);

  function createNsrForm(type: "50" | "51") {
    setNsrForm({ type, parentCode: "", isHeadingOnly: false, copyCode: "", code: "", description: "", unit: nsrUnitOptions[0] || "sqm", baseQty: 10, format: "conventional", customAddons: DEFAULT_ADDONS.map((addon) => ({ ...addon })), rows: [{ isExplanation: false, code: "", desc: "", unit: "", qty: "" as number | string, rate: "" as number | string, amt: 0, mark: "" }] });
    setIsEditingNsr(null);
    setShowNsrCreator(true);
  }

  function getNextNsrCode(type: string, parentCode: string) {
    const prefix = parentCode ? `${parentCode}.` : `${type}.`;
    const depth = prefix.split(".").filter(Boolean).length + 1;
    const nextIndex = customNsrs.reduce((max, item) => {
      if (!item.code.startsWith(prefix) || item.code.split(".").length !== depth) return max;
      const suffix = item.code.slice(prefix.length);
      return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
    }, 0) + 1;
    return `${prefix}${nextIndex}`;
  }

  function handleNsrRowChange<K extends keyof NsrAnalysisRow>(index: number, field: K, value: NsrAnalysisRow[K]) {
    setNsrForm((current) => {
      const rows = current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : { ...row });
      const row = rows[index];
      if (field === "isExplanation" && value) {
        Object.assign(row, { code: "", unit: "", qty: "", rate: "", amt: 0, mark: "" });
      } else if (field === "code") {
        const code = normalizeCode(String(value));
        row.code = code;
        const material = materialDb[code] || (/^\d+$/.test(code) ? materialDb[code.padStart(4, "0")] : undefined);
        const item = findCatalogItemByCodeGlobal(catalog, customNsrs, code);
        const analysis = getRAData(code);
        Object.assign(row, { desc: "", unit: "", rate: "", mark: "" });
        if (code === "9999") Object.assign(row, { desc: "Sundries", unit: "L.S.", rate: 2.27, mark: "" });
        else if (material) Object.assign(row, { desc: material.desc, unit: material.unit, rate: material.rate, mark: "" });
        else if (item || analysis) {
          const rate = item?.rate ?? getComputedRA(code, false)?.rate ?? 0;
          Object.assign(row, { desc: item?.fullDescription || item?.description || analysis?.description || row.desc, unit: item?.unit || row.unit || current.unit, rate, mark: "A" });
        }
      }
      if (!row.isExplanation) row.amt = Math.round(((Number(row.qty) || 0) * (Number(row.rate) || 0)) * 100) / 100;
      return { ...current, rows };
    });
  }

  function copyNsrRateAnalysis() {
    const code = normalizeCode(nsrForm.copyCode);
    const source = getRAData(code);
    if (!source?.analysis) return alert("Rate Analysis for this code was not found.");
    const sourceItem = findCatalogItemByCodeGlobal(catalog, customNsrs, code);
    const rows = source.analysis
      .filter((row) => {
        const description = String(row.description || "").toLowerCase();
        return !description.startsWith("say") && !description.startsWith("rate per") && !description.startsWith("cost for") && !description.startsWith("cost of") && !description.startsWith("detail of cost") && !description.includes("total materials") && !description.startsWith("total") && !description.startsWith("add ");
      })
      .map((row) => ({ isExplanation: !row.code && !row.unit && !row.quantity && !row.rate && (row.amount === "" || row.amount == null), code: row.code || "", desc: row.description || "", unit: row.unit || "", qty: row.quantity || "", rate: row.rate || "", amt: Number(row.amount) || 0, mark: row.mark || "" }));
    setNsrForm((current) => ({ ...current, description: sourceItem?.description || source.description || current.description, unit: sourceItem?.unit || current.unit, baseQty: 1, rows: rows.length ? rows : current.rows }));
  }

  function calculateNsrTotals() {
    const sum = nsrForm.rows.reduce((total, row) => total + (row.isExplanation ? 0 : Number(row.amt) || 0), 0);
    const sumA = nsrForm.rows.reduce((total, row) => total + (!row.isExplanation && row.mark === "A" ? Number(row.amt) || 0 : 0), 0);
    const baseQty = Number(nsrForm.baseQty) > 0 ? Number(nsrForm.baseQty) : 1;
    const addonResult = buildAddonBlock(sum, sumA, nsrForm.format, nsrForm.customAddons, nsrForm.code);
    const rawRate = addonResult.finalGrandTotal / baseQty;
    return { sum, finalGrandTotal: addonResult.finalGrandTotal, finalRate: Math.round(rawRate * 20) / 20, raBlock: [...addonResult.raBlock, { code: "", description: `Cost for ${baseQty} ${nsrForm.unit}`, unit: "", quantity: "", rate: "", amount: addonResult.finalGrandTotal.toFixed(2), mark: "" }, { code: "", description: `Rate per 1 ${nsrForm.unit}`, unit: "", quantity: "", rate: "", amount: rawRate.toFixed(2), mark: "" }, { code: "", description: "Say", unit: "", quantity: "", rate: "", amount: (Math.round(rawRate * 20) / 20).toFixed(2), mark: "" }] };
  }

  function saveNsrItem() {
    if (!nsrForm.description.trim()) return alert("Description required.");
    const code = isEditingNsr || getNextNsrCode(nsrForm.type, nsrForm.parentCode);
    const totals = calculateNsrTotals();
    const item: DsrItem = { code, description: nsrForm.description.trim(), unit: nsrForm.isHeadingOnly ? "" : nsrForm.unit, rate: nsrForm.isHeadingOnly ? null : totals.finalRate, isMain: nsrForm.isHeadingOnly };
    const updatedItems = [...customNsrs.filter((existing) => existing.code !== code), item].sort((a, b) => compareDsrCodes(a.code, b.code));
    setCustomNsrs(updatedItems);
    localStorage.setItem("estiPro_nsrItems", JSON.stringify(updatedItems));
    setCatalog((previous) => ({ ...previous, sh_50: { label: "SH 50: MODIFIED DSR ITEMS (MDSR/DR)", items: updatedItems.filter((entry) => entry.code.startsWith("50.")) }, sh_51: { label: "SH 51: NON-SCHEDULE ITEMS (NSR)", items: updatedItems.filter((entry) => entry.code.startsWith("51.")) } }));
    const storedRa = JSON.parse(localStorage.getItem("estiPro_nsrRateAnalysis") || "{}");
    if (nsrForm.isHeadingOnly) {
      delete storedRa[code];
      setRateAnalysisData((previous) => { const next = { ...previous }; delete next[normalizeCode(code)]; return next; });
    } else {
      const analysis = nsrForm.rows.filter((row) => row.desc.trim()).map((row) => ({ code: row.code, description: row.desc, unit: row.unit, quantity: row.qty, rate: row.rate, amount: row.isExplanation ? "" : Number(row.amt).toFixed(2), mark: row.mark || "" }));
      const record = { code, description: nsrForm.description.trim(), analysis: [...analysis, ...totals.raBlock] };
      storedRa[code] = record;
      setRateAnalysisData((previous) => ({ ...previous, [normalizeCode(code)]: record }));
    }
    localStorage.setItem("estiPro_nsrRateAnalysis", JSON.stringify(storedRa));
    setSelectedSubHead(`sh_${nsrForm.type}`);
    setShowNsrCreator(false);
  }

  function handleCopyRows(rows: MeasurementRow[]) { setCopiedRows(rows); alert(`Copied ${rows.length} rows!`); }
  function handlePasteRows(itemCode: string) { if (copiedRows.length === 0) return alert("Clipboard is empty."); const exactDesc = getStrictExactLevelDescriptionGlobal(catalog, customNsrs, itemCode); const catItem = findCatalogItemByCodeGlobal(catalog, customNsrs, itemCode); const rateVal = catItem ? (Number(catItem.rate) || 0) : 0; const newRows = copiedRows.map(r => { const updated = { ...r, id: crypto.randomUUID(), itemCode: itemCode, description: exactDesc, unit: catItem?.unit || "cum", rate: rateVal }; updated.amount = Math.round(updated.quantity * updated.rate); return updated; }); setEstimateRows(prev => [...prev, ...newRows].map((r, i) => ({ ...r, slNo: i + 1 }))); }
  function computeRowQuantity(row: Pick<MeasurementRow, "nos" | "num1" | "num2" | "length" | "breadth" | "height" | "coefficient">): number { return factorVal(row.nos) * factorVal(row.num1) * factorVal(row.num2) * factorVal(row.length) * factorVal(row.breadth) * factorVal(row.height) * factorVal(row.coefficient); }
  function addSingleRowForItem(item: DsrItem) { if (parentItemSet.has(normalizeCode(item.code))) { return alert("This is a parent heading and cannot be added as a measurement item."); } setEstimateRows((prev) => { const newRow: MeasurementRow = { id: crypto.randomUUID(), slNo: prev.length + 1, itemCode: item.code.trim(), description: getStrictExactLevelDescriptionGlobal(catalog, customNsrs, item.code), locationDesc: "", unit: item.unit || "cum", rate: Number(item.rate) || 0, nos: 1, num1: 1, num2: 1, length: "", breadth: "", height: "", coefficient: "", quantity: 0, amount: 0 }; if (PERCENTAGE_ITEMS.includes(item.code)) { newRow.unit = item.code.startsWith("2.24") ? "metre depth" : "sqm"; newRow.percentageVal = item.code === "2.24.2" ? 25 : 20; newRow.quantity = 0; newRow.amount = 0; } else { newRow.quantity = computeRowQuantity(newRow); newRow.amount = Math.round(newRow.quantity * newRow.rate); } return [...prev, newRow].map((r, i) => ({ ...r, slNo: i + 1 })); }); }
  function patchRowValues<K extends keyof MeasurementRow>(id: string, field: K, value: MeasurementRow[K]) {
    setEstimateRows((previous) => {
      let updatedRows = previous.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, [field]: value };
        if (PERCENTAGE_ITEMS.includes(updated.itemCode)) {
          const referenceCode = normalizeCode(updated.referenceItemCode || "");
          const percentage = typeof updated.percentageVal === "number" ? updated.percentageVal / 100 : 0;
          const referenceItem = findCatalogItemByCodeGlobal(catalog, customNsrs, referenceCode);
          const baseRate = Number(referenceItem?.rate) || 0;
          const linkedRows = previous.filter((candidate) =>
            normalizeCode(candidate.itemCode) === referenceCode && candidate.id !== id,
          );
          const referenceQuantity = linkedRows.reduce((sum, candidate) => sum + candidate.quantity, 0);
          updated.rate = Math.round(baseRate * percentage * 100) / 100;
          updated.quantity = updated.itemCode.startsWith("2.24") || updated.itemCode === "5.9.14"
            ? referenceQuantity || 1
            : computeRowQuantity(updated);
          updated.amount = Math.round(updated.quantity * updated.rate * 100) / 100;
        } else {
          updated.quantity = computeRowQuantity(updated);
          updated.amount = Math.round(updated.quantity * updated.rate * 100) / 100;
        }
        return updated;
      });

      const updatedReferenceCode = normalizeCode(previous.find((row) => row.id === id)?.itemCode);
      if (!updatedReferenceCode) return updatedRows;
      updatedRows = updatedRows.map((row) => {
        if (!PERCENTAGE_ITEMS.includes(row.itemCode) || normalizeCode(row.referenceItemCode) !== updatedReferenceCode) {
          return row;
        }
        const percentage = typeof row.percentageVal === "number" ? row.percentageVal / 100 : 0;
        const linkedRows = updatedRows.filter((candidate) =>
          normalizeCode(candidate.itemCode) === updatedReferenceCode && candidate.id !== row.id,
        );
        const referenceQuantity = linkedRows.reduce((sum, candidate) => sum + candidate.quantity, 0);
        const referenceItem = findCatalogItemByCodeGlobal(catalog, customNsrs, updatedReferenceCode);
        const baseRate = Number(referenceItem?.rate) || 0;
        const calculatedRate = Math.round(baseRate * percentage * 100) / 100;
        const quantity = row.itemCode.startsWith("2.24") || row.itemCode === "5.9.14"
          ? referenceQuantity || 1
          : row.quantity;
        return {
          ...row,
          quantity,
          rate: calculatedRate,
          amount: Math.round(quantity * calculatedRate * 100) / 100,
        };
      });
      return updatedRows;
    });
  }
  function saveThemeSettings(newTheme: ThemeSettings) { setAppTheme(newTheme); localStorage.setItem('estiPro_themeSettings', JSON.stringify(newTheme)); } function handleNewEstimate() { if(window.confirm("Start a new estimate? Unsaved changes will be lost.")) { setProjectDetails(DEFAULT_PROJECT_DETAILS); setEstimateRows([]); setCheckedItems({}); setMarketRates({}); setMarketRatesHistory([]); setMarketRaFormat("conventional"); setIsEstimateLocked(false); setActiveTab("home"); setMainNav("home"); } } function handleSaveEstimate() { if (!projectDetails.estimateId) return alert("Please provide an Estimate ID on the Home page first."); const customRaData = Object.fromEntries(Object.entries(rateAnalysisData).filter(([k]) => k.startsWith('50.') || k.startsWith('51.'))); const dataToSave = { projectDetails, estimateRows, checkedItems, customNsrs, rateAnalysisData: customRaData, marketRates, marketRaFormat, marketRaAddons }; const blob = new Blob([JSON.stringify(dataToSave, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${projectDetails.estimateId}.est`; a.click(); URL.revokeObjectURL(url); const cleanId = projectDetails.estimateId.trim(); const updatedIds = Array.from(new Set([...existingDbIds, cleanId])); setExistingDbIds(updatedIds); localStorage.setItem('estiPro_estimateIds', JSON.stringify(updatedIds)); alert(`Estimate saved successfully!`); } function handleLoadEstimate(e: React.ChangeEvent<HTMLInputElement>) { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (evt) => { try { const parsed = JSON.parse(evt.target?.result as string) as SavedEstimate; if (parsed.projectDetails) setProjectDetails(parsed.projectDetails); if (parsed.estimateRows) setEstimateRows(parsed.estimateRows); if (parsed.checkedItems) setCheckedItems(parsed.checkedItems); if (parsed.marketRates) setMarketRates(parsed.marketRates); if (parsed.marketRaFormat) setMarketRaFormat(parsed.marketRaFormat); if (parsed.marketRaAddons) setMarketRaAddons(parsed.marketRaAddons); if (parsed.customNsrs) { const customNsrs = parsed.customNsrs; setCustomNsrs(customNsrs); setCatalog(prev => ({ ...prev, sh_50: { label: "SH 50: MODIFIED DSR ITEMS (MDSR/DR)", items: customNsrs.filter((item) => item.code.startsWith("50.")) }, sh_51: { label: "SH 51: NON-SCHEDULE ITEMS (NSR)", items: customNsrs.filter((item) => item.code.startsWith("51.")) } })); } if (parsed.rateAnalysisData) { const savedRateAnalyses = parsed.rateAnalysisData; const loaded: Record<string, RateAnalysis> = {}; Object.keys(savedRateAnalyses).forEach(k => { loaded[normalizeCode(k)] = savedRateAnalyses[k]; }); setRateAnalysisData(prev => ({...prev, ...loaded})); } setIsEstimateLocked(false); setActiveTab("home"); setMainNav("home"); } catch (err) { alert("Invalid .est file format."); } }; reader.readAsText(file); if (fileInputRef.current) fileInputRef.current.value = ''; } function handleExit() { if(window.confirm("Exit the application?")) { setHasExited(true); } } function handleEstimateIdChange(e: React.ChangeEvent<HTMLInputElement>) { const rawVal = e.target.value; if (!/^[a-zA-Z0-9 \-_.\/]*$/.test(rawVal)) return; const valWithoutSpaces = rawVal.split(' ').join(''); if (valWithoutSpaces.length > 10) return; setProjectDetails({ ...projectDetails, estimateId: rawVal.toUpperCase() }); } function handleSaveAndProceed() { const epf = projectDetails.workCategory === "custom" ? parseFloat(projectDetails.customEpf) : (WORK_CATEGORIES[projectDetails.workCategory]?.epf || 0); const esi = projectDetails.workCategory === "custom" ? parseFloat(projectDetails.customEsi) : (WORK_CATEGORIES[projectDetails.workCategory]?.esi || 0); const cont = projectDetails.contingencyType === "cpwd" ? 3 : parseFloat(projectDetails.customContingency); if (epf === 0 || esi === 0 || cont === 0 || isNaN(epf) || isNaN(esi) || isNaN(cont)) { alert("These values (EPF, ESI, Contingency) should not be made zero or left blank."); return; } if (projectDetails.estimateId.trim() !== "") { const cleanId = projectDetails.estimateId.trim(); const updatedIds = Array.from(new Set([...existingDbIds, cleanId])); setExistingDbIds(updatedIds); localStorage.setItem('estiPro_estimateIds', JSON.stringify(updatedIds)); } setMainNav("selectItems"); setActiveTab("selectItems"); }
  function addCodeDirectly(code: string) { const item = findCatalogItemByCodeGlobal(catalog, customNsrs, code); if (item && !addedItemSet.has(code)) addSingleRowForItem(item); } function addAllDsrItems() { Object.values(catalog).flatMap((g) => g.items || []).forEach((item) => { if (!item.isMain && !item.isDeleted && (Number(item.rate) || 0) > 0 && !addedItemSet.has(item.code)) { if (!parentItemSet.has(normalizeCode(item.code))) { addSingleRowForItem(item); } } }); } function downloadCSV(filename: string, rows: string[][]) { const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.map(cell => `"${String(cell || "").split('"').join('""')}"`).join(",")).join("\n"); const encodedUri = encodeURI(csvContent); const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", filename); document.body.appendChild(link); link.click(); document.body.removeChild(link); } function downloadMissingRaCSV() { const csvRows = [["Item Code", "Description", "Rate"]]; globalMissingRa.forEach(code => { const item = findCatalogItemByCodeGlobal(catalogRef.current, nsrRef.current, code); csvRows.push([code, item?.description || "Unknown", item?.rate ? item.rate.toString() : "N/A"]); }); downloadCSV("Missing_Rate_Analysis_DB.csv", csvRows); }
  function exportBasicRatesCSV() {
    const rows = [["Code", "Description", "Unit", "Rate"], ...filteredBasicRateRows.map((item) => [
      item.code,
      item.description,
      item.unit,
      item.rate.toFixed(2),
    ])];
    downloadCSV("eSTi-Pro_Basic_Rates_AR.csv", rows);
  }
  function startVoiceRecognition() { const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SpeechRecognition) { alert("Speech Recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge."); return; } try { const recognition = new SpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-IN'; let localBuffer = ""; recognition.onstart = () => { setIsListening(true); setVoiceTranscriptBuffer(""); setVoiceRecognitionObj(recognition); }; recognition.onerror = (event: { error: string }) => { console.error("Speech Error:", event.error); alert("Microphone Error: " + event.error + ". Please click the 🔒 lock icon near your URL bar and 'Allow' Microphone access."); setIsListening(false); setVoiceRecognitionObj(null); }; recognition.onend = () => { setIsListening(false); setVoiceRecognitionObj(null); }; recognition.onresult = (event: SpeechRecognitionEventLike) => { let interim = ""; for (let i = event.resultIndex; i < event.results.length; ++i) { if (event.results[i].isFinal) localBuffer += event.results[i][0].transcript.toLowerCase() + " "; else interim += event.results[i][0].transcript.toLowerCase() + " "; } setVoiceTranscriptBuffer(localBuffer + interim); const combined = localBuffer + interim; if (combined.includes("stop") || combined.includes("done") || combined.includes("okay") || combined.includes("ok")) { recognition.stop(); processVoiceTranscript(combined); } }; recognition.start(); } catch (e) { alert("Failed to start voice engine."); } } function stopVoiceRecognition() { if (voiceRecognitionObj) { voiceRecognitionObj.stop(); setIsListening(false); processVoiceTranscript(voiceTranscriptBuffer); } } function processVoiceTranscript(transcript: string) { const wordMap: Record<string, string> = { "zero":"0", "one":"1", "two":"2", "three":"3", "four":"4", "five":"5", "six":"6", "seven":"7", "eight":"8", "nine":"9", "ten":"10", "eleven":"11", "twelve":"12", "thirteen":"13", "fourteen":"14", "fifteen":"15", "sixteen":"16", "seventeen":"17", "eighteen":"18", "nineteen":"19", "twenty":"20", "thirty":"30", "forty":"40", "fifty":"50", "point": ".", "dot": "." }; let processed = transcript.toLowerCase(); for (const [w, n] of Object.entries(wordMap)) { processed = processed.split(w).join(n); } processed = processed.split(' . ').join('.'); const matches = processed.match(new RegExp('\\d+(\\.\\d+[a-zA-Z]*)+', 'g')); if (matches && matches.length > 0) { const foundItems: {code: string, checked: boolean, desc: string}[] = []; matches.forEach((m: string) => { const item = findCatalogItemByCodeGlobal(catalogRef.current, nsrRef.current, m); if (item && !item.isMain && (Number(item.rate) || 0) > 0 && !foundItems.find(i => i.code === m)) { foundItems.push({ code: m, checked: true, desc: item.description }); } }); if (foundItems.length > 0) setVoiceModalItems(foundItems); else alert("Voice Assist: Heard numbers, but they did not match any valid DSR codes."); } else { alert("Voice Assist: No valid DSR item codes recognized."); } setVoiceTranscriptBuffer(""); } function handleApplyVoiceSelection() { if (!voiceModalItems) return; const newChecks = { ...checkedItems }; voiceModalItems.forEach(i => { if (i.checked) newChecks[i.code] = true; }); setCheckedItems(newChecks); setVoiceModalItems(null); } function toggleCheck(code: string) { setCheckedItems((prev) => ({ ...prev, [code]: !prev[code] })); } function removeEntireItemGroup(itemCode: string) { setEstimateRows((prev) => prev.filter((r) => r.itemCode !== itemCode).map((r, i) => ({ ...r, slNo: i + 1 }))); } function duplicateRow(row: MeasurementRow) { setEstimateRows((prev) => [...prev, { ...row, id: crypto.randomUUID() }].map((r, idx) => ({ ...r, slNo: idx + 1 }))); } function addNRowsForItemCode(itemCode: string, count: number) { const catalogItem = findCatalogItemByCodeGlobal(catalog, customNsrs, itemCode); if (!catalogItem) return; for (let i = 0; i < count; i++) addSingleRowForItem(catalogItem); } function addCheckedToEstimate() { Object.keys(checkedItems).filter((c) => checkedItems[c]).forEach((code) => { const item = [...allCatalogItems, ...customNsrs].find((i) => i.code === code); if (item && !item.isMain && !item.isDeleted && item.rate && item.rate > 0 && !addedItemSet.has(item.code)) { if (!parentItemSet.has(normalizeCode(item.code))) addSingleRowForItem(item); } }); setCheckedItems({}); } function removeRow(id: string) { setEstimateRows((prev) => prev.filter((r) => r.id !== id).map((r, idx) => ({ ...r, slNo: idx + 1 }))); } function handleFieldKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowId: string, fieldIndex: number, globalRowIndex: number) { if (e.key === "Tab") { e.preventDefault(); const shift = e.shiftKey; let nextFieldIndex = shift ? fieldIndex - 1 : fieldIndex + 1; let nextRowIndex = globalRowIndex; if (nextFieldIndex >= BOQ_FIELDS.length + 1) { nextFieldIndex = 0; nextRowIndex = globalRowIndex + 1; } else if (nextFieldIndex < 0) { nextFieldIndex = BOQ_FIELDS.length; nextRowIndex = globalRowIndex - 1; } if (nextRowIndex >= 0 && nextRowIndex < estimateRows.length) { const nextField = nextFieldIndex === 0 ? "locationDesc" : BOQ_FIELDS[nextFieldIndex - 1]; const nextId = estimateRows[nextRowIndex].id; const targetRef = inputRefs.current[`${nextId}-${nextField}`]; if (targetRef) { targetRef.focus(); targetRef.select(); } } } } function handleMarketRateChange(id: string, val: number) { setMarketRatesHistory(prev => [...prev, { ...marketRates }]); setMarketRates(prev => ({ ...prev, [id]: val })); } function handleUndoMarketRate() { if (marketRatesHistory.length > 0) { const historyCopy = [...marketRatesHistory]; const lastState = historyCopy.pop(); if (lastState) { setMarketRates(lastState); setMarketRatesHistory(historyCopy); } } else { alert("No further actions to undo."); } }
  function exportEstimateItemsCSV() {
    const rows: string[][] = [["Item Code", "Description", "Unit", "Rate DSR (INR)", "Rate DAR (INR)"]];
    filteredItems.slice(0, 1000).forEach((item) => {
      const analysis = getRAData(item.code);
      const rateDAR = analysis?.analysis?.length ? getComputedRA(item.code, false).rate : "";
      rows.push([item.code, item.fullDescription || item.description, item.unit || "", String(item.rate ?? ""), String(rateDAR)]);
    });
    downloadCSV("eSTi-Pro_Estimate_Items.csv", rows);
  }
  function exportMeasurementExcel() {
    const rows = [["Serial No", "Item Code", "Description of item", "Location", "Unit", "Nos", "Num1", "Num2", "Length", "Breadth", "Height", "Coeff", "Quantity", "Rate", "Amount"]];
    filteredPathNodes.flatMap((node) => node.rows || []).forEach((row) => {
      rows.push([String(row.slNo), row.itemCode, row.description, row.locationDesc, row.unit, String(row.nos), String(row.num1), String(row.num2), String(row.length), String(row.breadth), String(row.height), String(row.coefficient), row.quantity.toFixed(2), row.rate.toFixed(2), row.amount.toFixed(2)]);
    });
    downloadCSV("eSTi-Pro_Measurements.csv", rows);
  }
  function exportAbstractExcel() {
    const rows: string[][] = [["SL.NO.", "Item Code", "Description of item", "Unit", "Total Quantity", "Rate DSR (INR)", "Rate DAR (INR)", "Amount (INR)"]];
    Object.entries(filteredAbstractGroups).forEach(([key, items]) => {
    items.forEach((item) => {
      rows.push([String(item.treeSlNo), item.itemCode, item.description, item.isParentRow ? "" : item.unit, item.isParentRow ? "" : String(item.totalQty.toFixed(2)), item.isParentRow ? "" : item.rate.toFixed(2), item.isParentRow || item.rateDAR == null ? "" : item.rateDAR.toFixed(2), item.isParentRow ? "" : String(item.amount)]);
    });
    const label = DSR_CHAPTER_NAMES[key] || catalog[key]?.label || key;
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    rows.push(["", "", `Total for ${label}:`, "", "", "", "", String(subtotal)]);
    });
    if (!tableSearchQueries.abstract?.trim()) {
      rows.push(["", "", "Subtotal of DSR and MDSR items (A)", "", "", "", "", String(baseDsrMdsrTotal)]);
      if (modFactor !== 1) rows.push(["", "", `Modified estimated cost after applying multiplying factor (${modFactor}) on DSR and MDSR items amounting to Rs. ${baseDsrMdsrTotal} (B)`, "", "", "", "", String(adjustedModTotal)]);
      if (costIndexAmount > 0) rows.push(["", "", `Add Cost Index @ ${cIndexPct}% (C)`, "", "", "", "", String(costIndexAmount)]);
      if (baseNsrTotal > 0) rows.push(["", "", "Total of Non-Schedule Items", "", "", "", "", String(baseNsrTotal)]);
      rows.push(["", "", "Total of Schedule + Non-Schedule Items (D)", "", "", "", "", String(adjustedSubTotalD)]);
      if (epfAmount > 0) rows.push(["", "", `Add EPF @ ${epfPct}%`, "", "", "", "", String(epfAmount)]);
      if (esiAmount > 0) rows.push(["", "", `Add ESI @ ${esiPct}%`, "", "", "", "", String(esiAmount)]);
      if (contingencyAmount > 0) rows.push(["", "", `Add Contingencies @ ${contingencyLabel}`, "", "", "", "", String(contingencyAmount)]);
      rows.push(["", "", "GRAND TOTAL", "", "", "", "", String(grandTotalAbstractAmount)]);
    }
    downloadCSV("eSTi-Pro_Abstract.csv", rows);
  }
  function exportJustificationRateListCSV() {
    const rows: string[][] = [["Code", "Description", "Unit", "DSR Rate (INR)", "Market Rate (INR)"]];
    filteredJustificationMaterials.forEach((item) => {
      const marketRate = marketRates[item.id] !== undefined ? marketRates[item.id] : item.dsrRate;
      rows.push([item.code, item.description, item.unit, String(item.dsrRate), String(marketRate)]);
    });
    downloadCSV("eSTi-Pro_Justification_Rates.csv", rows);
  }
  function exportRateAnalysisExcel() {
    const rows: string[][] = [["Item Code", "Description", "Unit", "Quantity", "Rate (INR)", "Amount (INR)", "Mark"]];
    const isMarket = activeTab === "marketRateAnalysis";
    filteredRaItemCodes.forEach((code) => {
      const analysis = getComputedRA(code, isMarket);
      rows.push([code, getFullTreeDescriptionGlobal(catalog, customNsrs, code).split("\n").join(" "), "", "", "", "", ""]);
      (analysis?.block || []).filter((row) => matchesSearch(raSearchQuery, row.code, row.description)).forEach((row) => {
        rows.push([String(row.code || ""), String(row.description || ""), String(row.unit || ""), String(row.quantity || ""), String(row.rate || ""), String(row.amount || ""), row.mark || getCpwdMark(String(row.description || ""))]);
      });
      rows.push(["", "", "", "", "", "", ""]);
    });
    filteredRaSubCodes.forEach((subCode) => {
      rows.push([`Sub-AR: ${subCode}`, findCatalogItemByCodeGlobal(catalog, customNsrs, subCode)?.description || "", "", "", "", "", ""]);
      const analysis = getComputedRA(subCode, isMarket);
      (analysis?.block || []).filter((row) => matchesSearch(raSearchQuery, row.code, row.description)).forEach((row) => {
        rows.push([String(row.code || ""), String(row.description || ""), String(row.unit || ""), String(row.quantity || ""), String(row.rate || ""), String(row.amount || ""), row.mark || getCpwdMark(String(row.description || ""))]);
      });
      rows.push(["", "", "", "", "", "", ""]);
    });
    downloadCSV(isMarket ? "eSTi-Pro_Market_RA.csv" : "eSTi-Pro_DSR_RA.csv", rows);
  }
  if (hasExited) { return <div className="flex h-screen items-center justify-center bg-black text-slate-500 font-mono text-xl">The estimator is closed.</div>; }
  if (loading) { return ( <div className="flex flex-col h-screen items-center justify-center bg-slate-950 text-slate-400 text-sm font-mono space-y-6"> <div className="animate-pulse">Loading eSTi-Pro DSR Catalog...</div> {loadSlow && ( <div className="flex flex-col items-center gap-2 animate-in fade-in zoom-in duration-300"> <p className="text-[10px] text-amber-500/80">The local server is taking longer than expected to serve the DSR catalog.</p> <button onClick={() => setLoading(false)} className="px-4 py-2 border border-red-500 text-red-400 hover:bg-red-500 hover:text-white rounded font-bold transition-colors"> Force Start (Skip Loading Data) </button> </div> )} </div> ); }

  return (
    <div className={`app-root flex h-screen font-sans overflow-hidden flex-col ${appTheme.mode === 'light' ? 'app-theme-light bg-slate-950 text-slate-100' : appTheme.mode === 'custom' ? 'app-theme-custom bg-slate-950 text-slate-100' : 'bg-slate-950 text-slate-100'}`}>
      <style dangerouslySetInnerHTML={{ __html: generateThemeCSS(appTheme) }} />
      
      <div className="bg-slate-950 text-slate-400 text-[11px] flex justify-between items-center px-4 py-1.5 border-b border-slate-800 font-semibold font-mono shadow-sm">
         <div className="flex gap-6 items-center">
            <button className="hover:text-amber-400 transition-colors flex items-center gap-1" onClick={handleNewEstimate}>➕ New Estimate</button>
            <label className="hover:text-amber-400 transition-colors cursor-pointer flex items-center gap-1"> 📂 Load Estimate <input ref={fileInputRef} type="file" accept=".est" className="hidden" onChange={handleLoadEstimate} /> </label>
            <button className="hover:text-amber-400 transition-colors flex items-center gap-1" onClick={handleSaveEstimate}>💾 Save Estimate</button>
            <button className="hover:text-blue-400 transition-colors flex items-center gap-1" onClick={() => setShowThemeModal(true)}>🎨 Theme Settings</button>
            <button className="hover:text-red-400 transition-colors flex items-center gap-1" onClick={handleExit}>❌ Exit</button>
         </div>
         <div className="text-blue-500 flex items-center gap-2">{rateAnalysisLoading && <span className="text-amber-400">Loading rate analyses...</span>}eSTi-Pro v0.1.0 <span className="text-slate-600">|</span> <span className="text-slate-300">{projectDetails.estimateId || "Unsaved Project"}</span></div>
      </div>

      <header className="h-12 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <nav className="flex border border-slate-800 rounded bg-slate-950 overflow-hidden text-xs mr-4">
            <button onClick={() => { canHome && setMainNav("home"); setActiveTab("home"); }} disabled={!canHome} className={`px-4 py-1.5 font-bold transition-colors ${mainNav === "home" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"} ${!canHome ? "opacity-30 cursor-not-allowed" : ""}`}>Home</button>
            <button onClick={() => { canSelectItems && setMainNav("selectItems"); setActiveTab("selectItems"); }} disabled={!canSelectItems} className={`px-4 py-1.5 font-bold transition-colors ${mainNav === "selectItems" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"} ${!canSelectItems ? "opacity-30 cursor-not-allowed" : ""}`}>Select Items</button>
            <button onClick={() => { canEstimate && setMainNav("estimate"); setActiveTab("measurement"); setSubEstimateNav("measurement"); }} disabled={!canEstimate} className={`px-4 py-1.5 font-bold transition-colors ${mainNav === "estimate" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"} ${!canEstimate ? "opacity-30 cursor-not-allowed" : ""}`}>Estimate ▾</button>
            <button onClick={() => { canJustification && setMainNav("justification"); setActiveTab("rateAnalysisTab"); setSubJustificationNav("raDsr"); }} disabled={!canJustification} className={`px-4 py-1.5 font-bold transition-colors ${mainNav === "justification" ? "bg-green-600 text-white" : "text-slate-400 hover:text-white"} ${!canJustification ? "opacity-30 cursor-not-allowed" : ""}`}>Justification ▾</button>
          </nav>
          {mainNav === "estimate" && (
            <div className="flex gap-1 items-center">
               <button onClick={() => { setSubEstimateNav("measurement"); setActiveTab("measurement"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subEstimateNav === "measurement" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>Measurements</button>
               <button onClick={() => { setSubEstimateNav("abstract"); setActiveTab("abstract"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subEstimateNav === "abstract" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>Abstract</button>
               <button onClick={() => { setSubEstimateNav("generalAbstract"); setActiveTab("generalAbstract"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subEstimateNav === "generalAbstract" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>Gen Abstract</button>
               <button onClick={() => { setSubEstimateNav("basicRatesList"); setActiveTab("basicRatesList"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subEstimateNav === "basicRatesList" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>Basic Rates List</button>
               <button onClick={() => { setSubEstimateNav("history"); setActiveTab("history"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subEstimateNav === "history" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>History Sheet</button>
               <div className="w-px h-4 bg-slate-700 mx-2"></div>
               <button onClick={() => { setIsEstimateLocked(true); setMainNav("justification"); setActiveTab("rateAnalysisTab"); setSubJustificationNav("raDsr"); }} className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[11px] font-bold shadow transition-colors">Lock Estimate 🔒</button>
            </div>
          )}
          {mainNav === "justification" && (
            <div className="flex gap-1 items-center">
               <button onClick={() => { setSubJustificationNav("raDsr"); setActiveTab("rateAnalysisTab"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subJustificationNav === "raDsr" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>RA (DSR)</button>
               <button onClick={() => { setSubJustificationNav("rateList"); setActiveTab("rateList"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subJustificationNav === "rateList" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>Rate List</button>
               <button onClick={() => { setSubJustificationNav("raMarket"); setActiveTab("marketRateAnalysis"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subJustificationNav === "raMarket" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>RA (Market)</button>
               <button onClick={() => { setSubJustificationNav("justStatement"); setActiveTab("justStatement"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subJustificationNav === "justStatement" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>Just. Statement</button>
               <button onClick={() => { setSubJustificationNav("justSummary"); setActiveTab("justSummary"); }} className={`px-3 py-1 rounded text-[11px] font-bold ${subJustificationNav === "justSummary" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>Just. Summary</button>
               <div className="w-px h-4 bg-slate-700 mx-2"></div>
               <button onClick={() => { setIsEstimateLocked(false); setMainNav("estimate"); setActiveTab("abstract"); setSubEstimateNav("abstract"); }} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-bold shadow transition-colors">Unlock Estimate 🔓</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-green-400 font-bold text-xs">Grand Total: ₹{formatCurrency(grandTotalAbstractAmount, projectDetails.numberFormat, 0)}</span>
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative flex">
        {(activeTab === "home" || mainNav === "home") && (
          <div className="flex-1 flex flex-col p-8 bg-slate-950 overflow-auto items-center">
            {globalMissingRa.length > 0 && (
                <div className="w-full max-w-4xl bg-red-950/40 border border-red-800/60 rounded-lg p-4 mb-6 animate-in slide-in-from-top-4 relative">
                    <div className="absolute top-4 right-4"><button onClick={downloadMissingRaCSV} className="px-3 py-1 bg-red-800 hover:bg-red-700 text-red-100 rounded text-xs font-bold shadow">📥 Download Missing RA List</button></div>
                    <h3 className="text-red-500 font-black text-sm mb-2 flex items-center gap-2">⚠️ Database Health Warning</h3>
                    <p className="text-xs text-red-300 font-bold mb-2">The following standard DSR items are missing their detailed Rate Analysis formulas. Please update your master Excel file with these items and re-parse. <br/><span className="text-amber-400">IMPORTANT: After re-parsing, you must copy the new JSON file into the public/data folder to overwrite the old one!</span></p>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-slate-950 rounded border border-red-900">
                        {globalMissingRa.map(c => <span key={c} className="bg-red-900/40 border border-red-700/50 text-red-200 px-2 py-0.5 rounded text-xs font-mono font-bold">{c}</span>)}
                    </div>
                </div>
            )}

            <div className="w-full max-w-4xl bg-slate-900/60 border border-slate-700 rounded-xl shadow-2xl p-8">
              <h2 className="text-xl font-bold text-blue-400 mb-6 border-b border-slate-700 pb-2 font-mono">Project Details & Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 flex flex-col gap-1 relative">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Estimate ID</label>
                  <input type="text" value={projectDetails.estimateId} onChange={handleEstimateIdChange} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none uppercase" placeholder="e.g. EST-2026-001" disabled={isEstimateLocked} list="saved-ids" />
                  <datalist id="saved-ids">{existingDbIds.map(id => <option key={id} value={id} />)}</datalist>
                  {existingDbIds.includes(projectDetails.estimateId.trim()) && <span className="text-[10px] text-red-400 font-bold absolute -bottom-4 left-1">⚠️ Estimate ID already exists!</span>}
                </div>
                <div className="md:col-span-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">DSR Version</label>
                  <select value={projectDetails.dsrVersion} onChange={(e) => setProjectDetails({...projectDetails, dsrVersion: e.target.value})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none appearance-none cursor-pointer" disabled={isEstimateLocked}>
                    <option value="DSR 2023">DSR 2023</option>
                  </select>
                </div>
                <div className="md:col-span-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Currency Round-Off Format</label>
                  <select value={projectDetails.numberFormat} onChange={(e) => setProjectDetails({...projectDetails, numberFormat: e.target.value as ProjectDetails["numberFormat"]})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none appearance-none cursor-pointer" disabled={isEstimateLocked}>
                    <option value="indian">Indian (Lakhs/Crores)</option>
                    <option value="international">International (Millions/Billions)</option>
                  </select>
                </div>
                <div className="md:col-span-3 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Name of Work</label>
                  <textarea value={projectDetails.nameOfWork} onChange={(e) => setProjectDetails({...projectDetails, nameOfWork: e.target.value})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none min-h-[100px]" placeholder="Enter comprehensive description of the work..." disabled={isEstimateLocked} />
                </div>
                <div className="md:col-span-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Modification Factor</label>
                  <div className="flex gap-2">
                    <select value={projectDetails.modificationFactorType} onChange={(e) => setProjectDetails({...projectDetails, modificationFactorType: e.target.value as ProjectDetails["modificationFactorType"]})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none appearance-none cursor-pointer flex-1" disabled={isEstimateLocked}>
                      <option value="0.973">0.973</option>
                      <option value="custom">Custom</option>
                    </select>
                    {projectDetails.modificationFactorType === "custom" && <input type="number" step="0.001" value={projectDetails.customModificationFactor} onChange={(e) => setProjectDetails({...projectDetails, customModificationFactor: e.target.value})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none w-24" placeholder="Value" disabled={isEstimateLocked} />}
                  </div>
                </div>
                <div className="md:col-span-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cost Index (%)</label>
                  <input type="number" step="0.01" value={projectDetails.costIndex} onChange={(e) => setProjectDetails({...projectDetails, costIndex: e.target.value})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none" placeholder="Blank for 0" disabled={isEstimateLocked} />
                </div>
                <div className="md:col-span-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Contingency</label>
                  <div className="flex gap-2">
                    <select value={projectDetails.contingencyType} onChange={(e) => setProjectDetails({...projectDetails, contingencyType: e.target.value as ProjectDetails["contingencyType"]})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none appearance-none cursor-pointer flex-1" disabled={isEstimateLocked}>
                      <option value="cpwd">As per CPWD norms</option>
                      <option value="custom">Custom</option>
                    </select>
                    {projectDetails.contingencyType === "custom" && <input type="number" step="0.01" value={projectDetails.customContingency} onChange={(e) => setProjectDetails({...projectDetails, customContingency: e.target.value})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none w-20" placeholder="%" disabled={isEstimateLocked} />}
                  </div>
                </div>
                <div className="md:col-span-3 flex flex-col gap-1 border-t border-slate-700 pt-4 mt-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Type of Work (For EPF & ESI Auto-Calculation)</label>
                  <select value={projectDetails.workCategory} onChange={(e) => setProjectDetails({...projectDetails, workCategory: e.target.value})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none appearance-none cursor-pointer w-full md:w-2/3" disabled={isEstimateLocked}>
                    {Object.entries(WORK_CATEGORIES).map(([key, data]) => <option key={key} value={key}>{data.label}</option>)}
                  </select>
                </div>
                <div className="md:col-span-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">EPF (%)</label>
                  {projectDetails.workCategory === "custom" ? <input type="number" step="0.001" value={projectDetails.customEpf} onChange={(e) => setProjectDetails({...projectDetails, customEpf: e.target.value})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none" placeholder="Enter EPF %" disabled={isEstimateLocked} /> : <div className="bg-slate-900 border border-slate-700 rounded p-2 text-sm text-green-400 font-mono font-bold cursor-not-allowed">{(WORK_CATEGORIES[projectDetails.workCategory]?.epf || 0).toFixed(3)}%</div>}
                </div>
                <div className="md:col-span-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ESI Charges (%)</label>
                  {projectDetails.workCategory === "custom" ? <input type="number" step="0.001" value={projectDetails.customEsi} onChange={(e) => setProjectDetails({...projectDetails, customEsi: e.target.value})} className="bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none" placeholder="Enter ESI %" disabled={isEstimateLocked} /> : <div className="bg-slate-900 border border-slate-700 rounded p-2 text-sm text-green-400 font-mono font-bold cursor-not-allowed">{(WORK_CATEGORIES[projectDetails.workCategory]?.esi || 0).toFixed(4)}%</div>}
                </div>
              </div>
              <div className="mt-10 flex justify-end">
                 <button onClick={handleSaveAndProceed} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold shadow-lg transition-colors"> Save & Proceed to Estimate ➔ </button>
              </div>
            </div>
          </div>
        )}

        {(activeTab === "selectItems" || mainNav === "selectItems") && (
          <div className="flex-1 flex overflow-hidden">
            <aside className="w-64 border-r border-slate-800 flex flex-col bg-slate-900/60">
              <div className="p-3 border-b border-slate-800 flex justify-between items-center">
                <div><h2 className="text-xs font-bold uppercase tracking-wider text-blue-400">Categories</h2></div>
                <button onClick={() => setShowSelectedSidebar(!showSelectedSidebar)} className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]">{showSelectedSidebar ? "Hide" : "Show"}</button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {subHeadKeys.map((key) => {
                  const grp = catalog[key]; const selCount = getSelectedCountForSubhead(key); const isCustom = key === "sh_50" || key === "sh_51";
                  return (
                    <button key={key} onClick={() => handleSelectSubhead(key)} className={`w-full text-left px-3 py-2 rounded text-xs transition-colors flex justify-between items-center ${selectedSubHead === key ? (isCustom ? "bg-amber-600 text-white font-bold" : "bg-blue-600 text-white font-semibold") : "text-slate-300 hover:bg-slate-900"}`}>
                      <span className="truncate pr-2">{DSR_CHAPTER_NAMES[key] || grp?.label || key}</span>
                      {selCount > 0 && <span className="bg-slate-950 text-white px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">{selCount}</span>}
                    </button>
                  );
                })}
              </div>
            </aside>
            {showSelectedSidebar && (
              <aside className="w-64 border-r border-slate-800 flex flex-col bg-slate-900/80 relative">
                <div className="p-3 border-b border-slate-800 bg-slate-950/40 space-y-2">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">Selected Glimpse</h3>
                    {!isListening ? ( <button onClick={startVoiceRecognition} className="px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 bg-slate-700 text-white hover:bg-slate-600">🎙️ Start Voice</button> ) : ( <button onClick={stopVoiceRecognition} className="px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 bg-red-600 animate-pulse text-white font-bold">🛑 Stop & Process</button> )}
                  </div>
                  <button onClick={addAllDsrItems} className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-sans font-semibold tracking-wide shadow">🚀 Add All Items of DSR</button>
                </div>
                <div className="flex-1 overflow-y-auto max-h-[calc(100vh-190px)] p-2 space-y-1.5 font-mono text-[11px] scrollbar-thin">
                  {searchQuery.trim() !== "" ? (
                    searchedCatalogMatches.length === 0 ? <div className="text-slate-500 text-center py-6 text-[11px] font-sans">No matching item found</div> : (
                      searchedCatalogMatches.map((item, idx) => {
                        const isAdded = addedItemSet.has(item.code); const isChecked = Boolean(checkedItems[item.code]); const hasRate = (Number(item.rate) || 0) > 0; const isParent = parentItemSet.has(normalizeCode(item.code)); const hasRA = !!getRAData(item.code);
                        return (
                          <div key={`search-match-${item.code}-${idx}`} className={`p-2 border rounded flex flex-col gap-1 ${isAdded ? "bg-green-950/40 border-green-800/60" : "bg-amber-950/40 border-amber-800/60"}`}>
                            <div className="flex justify-between items-center">
                              <span className="text-blue-400 font-bold">{item.code}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-sans font-semibold ${isAdded ? "bg-green-900/80 text-green-200" : isChecked ? "bg-amber-900/80 text-amber-200" : "bg-slate-800 text-slate-300"}`}>{isAdded ? "In BOQ" : isChecked ? "Checked" : "Not Added"}</span>
                            </div>
                            <span className="text-[10px] text-slate-800 dark:text-slate-300 font-sans line-clamp-2" title={item.description}>{item.description}</span>
                            <div className="flex gap-1 mt-1">
                                {!isParent && !isAdded && hasRate && <button onClick={() => addCodeDirectly(item.code)} className="w-full py-1 bg-green-600 hover:bg-green-500 text-white rounded text-[10px] font-sans font-medium">+ BOQ</button>}
                                {!isParent && hasRA && ( <button onClick={() => setArModalStack([item.code])} className="w-full py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-sans font-medium">📄 View AR</button> )}
                            </div>
                          </div>
                        );
                      })
                    )
                  ) : combinedGlimpseCodes.length === 0 ? <div className="text-slate-500 text-center py-6 text-[11px] font-sans">No items selected yet</div> : (
                    combinedGlimpseCodes.map((code) => {
                      const item = findCatalogItemByCodeGlobal(catalog, customNsrs, code); const isAdded = addedItemSet.has(code); const hasRate = item ? (Number(item.rate) || 0) > 0 : false; const isParent = parentItemSet.has(normalizeCode(code)); const hasRA = !!getRAData(code);
                      return (
                        <div key={code} className={`p-2 border rounded flex flex-col gap-1 ${isAdded ? "bg-green-950/40 border-green-800/60" : "bg-amber-950/40 border-amber-800/60"}`}>
                          <div className="flex justify-between items-center">
                            <span className="text-blue-400 font-bold">{code}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-sans font-semibold ${isAdded ? "bg-green-900/80 text-green-200" : "bg-amber-900/80 text-amber-200"}`}>{isAdded ? "In BOQ" : "Checked"}</span>
                          </div>
                          <span className="text-[10px] text-slate-800 dark:text-slate-300 font-sans line-clamp-2" title={item?.description}>{item?.description || "DSR Item"}</span>
                          <div className="flex gap-1 mt-1">
                              {!isParent && !isAdded && hasRate && <button onClick={() => addCodeDirectly(code)} className="w-full py-1 bg-green-600 hover:bg-green-500 text-white rounded text-[10px] font-sans font-medium">+ BOQ</button>}
                              {!isParent && hasRA && ( <button onClick={() => setArModalStack([code])} className="w-full py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-sans font-medium">📄 View AR</button> )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>
            )}
            <section className="flex-1 flex flex-col p-4 bg-slate-950 overflow-hidden relative">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-4">
                  <h1 className="text-sm font-bold text-slate-200">{currentGroup.label} ({filteredItems.length} entries)</h1>
                  {selectedSubHead === "sh_50" && <button onClick={() => createNsrForm("50")} className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold shadow">+ New MDSR</button>}
                  {selectedSubHead === "sh_51" && <button onClick={() => createNsrForm("51")} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold shadow">+ New NSR</button>}
                  <button onClick={addCheckedToEstimate} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium shadow">+ Add Checked Items Only</button>
                </div>
                <div className="flex items-center gap-4">
                  <TableSearch value={searchQuery} onChange={setSearchQuery} />
                  <button onClick={exportEstimateItemsCSV} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium shadow">📥 Export CSV</button>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-300">
                    <input type="checkbox" checked={wrapDescriptions} onChange={(e) => setWrapDescriptions(e.target.checked)} className="accent-blue-600" /> Full Multi-line Wrap
                  </label>
                </div>
              </div>
              <div id="catalog-scroll-container" ref={catalogScrollRef} className="flex-1 overflow-auto border border-slate-800 rounded bg-slate-900/30">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900 sticky top-0 text-slate-400 border-b border-slate-800 z-10">
                    <tr>
                      <th className="p-2 w-12 text-center">Sel (L)</th>
                      <th className="p-2 w-28">Item No.</th>
                      <th className="p-2 min-w-[320px]">Description</th>
                      <th className="p-2 w-20 text-center">Unit</th>
                      <th className="p-2 w-24 text-right">Rate DSR</th>
                      <th className="p-2 w-24 text-right">Rate DAR</th>
                      <th className="p-2 w-40 text-center">Full Text / AR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {filteredItems.slice(0, 1000).map((item, idx) => {
                      const isChecked = Boolean(checkedItems[item.code]); const rateNum = Number(item.rate) || 0; const isAddedToSheet = addedItemSet.has(item.code); const hasRate = rateNum > 0; const isParent = parentItemSet.has(normalizeCode(item.code)); const hasRA = !!getRAData(item.code);
                      if (item.isMain) {
                        return (
                          <tr key={`main-${item.code}-${idx}`} className="bg-slate-900/90 font-semibold text-amber-300">
                            <td className="p-2 text-center font-mono"></td>
                            <td className="p-2 font-mono">{item.code}</td>
                            <td className="p-2 text-justify"><div className={wrapDescriptions ? "whitespace-pre-wrap leading-relaxed" : "line-clamp-2"}>{item.fullDescription || item.description}</div></td>
                            <td className="p-2 text-center text-slate-600"></td>
                            <td className="p-2 text-right font-mono text-slate-600"></td>
                            <td className="p-2 text-right font-mono text-slate-600"></td>
                            <td className="p-2 text-center"></td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={`item-${item.code}-${idx}`} className={`hover:bg-slate-900/70 ${isAddedToSheet ? "opacity-75 bg-slate-900/50" : ""}`}>
                          <td className="p-2 text-center">{!isParent && (hasRate || PERCENTAGE_ITEMS.includes(item.code)) ? <input type="checkbox" checked={isAddedToSheet || isChecked} disabled={isAddedToSheet} onChange={() => !isAddedToSheet && toggleCheck(item.code)} className="accent-blue-600 disabled:opacity-40" /> : null}</td>
                          <td className="p-2 font-mono text-blue-400 font-semibold">{item.code} {isAddedToSheet && <span className="ml-1 text-[9px] text-green-400">[Added]</span>}</td>
                          <td className="p-2 text-slate-800 dark:text-slate-300 text-justify"><div className={wrapDescriptions ? "whitespace-pre-wrap leading-relaxed" : "line-clamp-2"}>{item.fullDescription || item.description}</div></td>
                          <td className="p-2 text-center text-slate-400">{!isParent ? (PERCENTAGE_ITEMS.includes(item.code) ? "L.S." : (item.unit || "")) : ""}</td>
                          <td className="p-2 text-right font-mono text-slate-800 dark:text-slate-300">{!isParent && hasRate ? formatCurrency(rateNum, projectDetails.numberFormat) : (!isParent && PERCENTAGE_ITEMS.includes(item.code) ? "Variable %" : "")}</td>
                          <td className="p-2 text-right font-mono text-cyan-300">{!isParent && computedDarRates[item.code] != null ? formatCurrency(computedDarRates[item.code] as number, projectDetails.numberFormat) : ""}</td>
                          <td className="p-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {hasRA && <button onClick={() => setArModalStack([normalizeCode(item.code)])} className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[10px]" title={`View rate analysis for ${item.code}`}>View AR</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: MEASUREMENT TAB */}
        {activeTab === "measurement" && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-blue-400 font-mono">Continuous Measurement Sheet</h2>
              <div className="flex items-center gap-2">
                <TableSearch value={tableSearchQueries.measurement || ""} onChange={(value) => setTableSearchQueries((previous) => ({ ...previous, measurement: value }))} />
                <button onClick={exportMeasurementExcel} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium shadow">📥 Meas. Excel</button>
                <button onClick={() => window.print()} className="px-3 py-1 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-medium shadow">📄 Meas. PDF</button>
                {estimateRows.length > 0 && ( <button onClick={() => setEstimateRows([])} className="px-3 py-1 bg-red-900/80 hover:bg-red-800 text-red-200 rounded text-xs font-medium ml-2">Clear All</button> )}
              </div>
            </div>

            <div className="flex-1 overflow-auto border border-slate-700 rounded bg-slate-950">
              {pathNodes.length === 0 ? ( <div className="flex h-full items-center justify-center text-xs text-slate-500 font-mono">No measurement items added yet.</div> ) : (
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="bg-slate-900 sticky top-0 text-slate-300 border-b border-slate-700 z-10">
                    <tr>
                      <th className="p-2 w-20 text-center border border-slate-700">SL.NO.</th>
                      <th className="p-2 w-28 text-center border border-slate-700">Item Code</th>
                      <th className="p-2 border border-slate-700 font-sans">Description of item</th>
                      <th className="p-2 w-16 text-center border border-slate-700">Unit</th>
                      <th className="p-2 w-14 text-center border border-slate-700">Nos</th>
                      <th className="p-2 w-14 text-center border border-slate-700">Num1</th>
                      <th className="p-2 w-14 text-center border border-slate-700">Num2</th>
                      <th className="p-2 w-16 text-center border border-slate-700">Length</th>
                      <th className="p-2 w-16 text-center border border-slate-700">Breadth</th>
                      <th className="p-2 w-16 text-center border border-slate-700">Height</th>
                      <th className="p-2 w-16 text-center border border-slate-700">Coeff</th>
                      <th className="p-2 w-20 text-right border border-slate-700">Qty</th>
                      <th className="p-2 w-24 text-center border border-slate-700">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredPathNodes.map((node, nodeIdx) => {
                      if (node.isParentRow) {
                        return (
                          <tr key={`parent-${node.itemCode}-${nodeIdx}`} className="bg-slate-900/90 font-semibold text-blue-300">
                            <td className="p-2 text-center font-mono text-amber-400 font-bold border border-slate-700">{node.slNo}</td>
                            <td className="p-2 text-center font-mono text-blue-400 border border-slate-700">{node.itemCode}</td>
                            <td className="p-2 text-slate-800 dark:text-slate-200 text-sm font-semibold border border-slate-700 font-sans text-justify whitespace-pre-wrap" colSpan={11}>
                              {node.description}
                            </td>
                          </tr>
                        );
                      }

                      const grpCode = node.itemCodeForOverride || node.itemCode;
                      const countN = addRowcounts[grpCode] ?? 2;
                      const isPercentageItem = PERCENTAGE_ITEMS.includes(node.itemCode);
                      const nodeRows = node.rows || [];
                      const nodeTotalQty = node.finalGroupQty ?? 0;

                      return (
                        <React.Fragment key={`leaf-block-${node.itemCode}-${nodeIdx}`}>
                          <tr className="bg-slate-900/95 font-semibold text-blue-300">
                            <td className="p-2 text-center font-mono text-amber-400 font-bold border border-slate-700 align-top">{node.slNo}</td>
                            <td className="p-2 text-center font-mono text-blue-400 border border-slate-700 align-top">{node.itemCode}</td>
                            <td className="p-2 text-slate-800 dark:text-slate-200 text-sm font-semibold border border-slate-700 font-sans align-top text-justify whitespace-pre-wrap" colSpan={2}>
                              <div className="flex flex-col gap-0.5">
                                <span>{node.description}</span>
                                {node.subtotalQty !== undefined && (
                                  <span className="text-[11px] text-amber-300 font-mono mt-1">[Total Qty: {nodeTotalQty.toFixed(2)} {node.unit}]</span>
                                )}
                              </div>
                            </td>
                            <td className="p-2 border border-slate-700 align-bottom pb-2 text-right" colSpan={9}>
                              <div className="flex flex-col items-end justify-end gap-2">
                                <div className="flex items-center gap-2">
                                  {nodeRows.length > 0 && ( <button onClick={() => handleCopyRows(nodeRows)} className="px-2 py-0.5 bg-emerald-600/70 hover:bg-emerald-600 text-white rounded text-[10px] shadow">📋 Copy Rows</button> )}
                                  {copiedRows.length > 0 && ( <button onClick={() => handlePasteRows(node.itemCode)} className="px-2 py-0.5 bg-amber-600/70 hover:bg-amber-600 text-white rounded text-[10px] shadow">📋 Paste</button> )}
                                  <button onClick={() => addSingleRowForItem(findCatalogItemByCodeGlobal(catalog, customNsrs, node.itemCode)!)} className="px-2 py-0.5 bg-blue-600/70 hover:bg-blue-600 text-white rounded text-[10px] shadow">+ Add Single Row</button>
                                  <button onClick={() => removeEntireItemGroup(node.itemCode)} className="px-2 py-0.5 bg-red-600/70 hover:bg-red-600 text-white rounded text-[10px] shadow">🗑️ Delete Item</button>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
                                  <span className="text-[10px] text-slate-400">Add multiple rows:</span>
                                  <input type="number" min={1} max={50} value={countN} onChange={(e) => setAddRowcounts(p => ({ ...p, [grpCode]: Math.max(1, parseInt(e.target.value) || 1) }))} className="w-10 bg-slate-950 border border-slate-700 text-center text-[10px] font-mono rounded text-slate-200 focus:outline-none focus:border-blue-500" />
                                  <button onClick={() => addNRowsForItemCode(node.itemCode, countN)} className="px-2 py-0.5 bg-indigo-600/70 hover:bg-indigo-600 text-white rounded text-[10px] shadow">+ Add {countN} Rows</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                          
                          {node.rows && node.rows.map((row: MeasurementRow) => {
                            const globalRowIndex = estimateRows.findIndex((r) => r.id === row.id);
                            
                            return (
                              <tr key={row.id} className="hover:bg-slate-900/40">
                                <td className="p-0 border border-slate-700 bg-slate-950" colSpan={3}>
                                  {isPercentageItem ? (
                                    <div className="flex items-center gap-2 px-2 h-full py-1">
                                      <span className="text-[9px] text-slate-400 font-bold uppercase w-16">Link To:</span>
                                      <input type="text" value={row.referenceItemCode || ""} onChange={(e) => patchRowValues(row.id, "referenceItemCode", e.target.value)} className="w-24 bg-slate-900 border border-slate-700 px-2 py-1 text-slate-200 font-mono text-xs focus:outline-none focus:border-amber-500 rounded" placeholder="Item Code" />
                                      <span className="text-[9px] text-slate-400 font-bold uppercase w-6 text-center">At</span>
                                      <input type="number" value={row.percentageVal || ""} onChange={(e) => patchRowValues(row.id, "percentageVal", parseFloat(e.target.value)||0)} className="w-16 bg-slate-900 border border-slate-700 px-2 py-1 text-slate-200 font-mono text-xs focus:outline-none focus:border-amber-500 rounded text-right" placeholder="%" />
                                      <span className="text-[10px] text-slate-400 font-bold uppercase ml-2">% Rate</span>
                                    </div>
                                  ) : (
                                    <input ref={(el) => { inputRefs.current[`${row.id}-locationDesc`] = el; }} type="text" value={row.locationDesc} placeholder="Description of item..." onChange={(e) => patchRowValues(row.id, "locationDesc", e.target.value)} className="w-full h-full bg-transparent px-3 py-1.5 text-left text-slate-800 dark:text-slate-200 focus:outline-none focus:bg-slate-900 border-0 font-sans font-bold" />
                                  )}
                                </td>
                                <td className="p-0 text-center border border-slate-700 text-slate-800 dark:text-slate-400 text-[11px] bg-slate-900/40 font-bold">{row.unit}</td>
                                
                                {BOQ_FIELDS.map((field, fIdx) => (
                                  <td key={field} className="p-0 text-right border border-slate-700">
                                    <input ref={(el) => { inputRefs.current[`${row.id}-${field}`] = el; }} type="number" step="any" value={row[field]} placeholder="" onChange={(e) => patchRowValues(row.id, field, e.target.value === "" ? "" : parseFloat(e.target.value) || 0)} onKeyDown={(e) => handleFieldKeyDown(e, row.id, fIdx + 1, globalRowIndex)} className="w-full h-full bg-transparent px-1.5 py-1.5 pr-2 text-right text-slate-800 dark:text-slate-100 focus:outline-none focus:bg-slate-900 border-0 font-bold" />
                                  </td>
                                ))}
                                <td className="p-0 text-right border border-slate-700 font-black text-slate-900 dark:text-slate-100 px-2 py-1.5 bg-slate-900/40">{row.quantity.toFixed(2)}</td>
                                <td className="p-0 text-center border border-slate-700 bg-slate-900/40">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button onClick={() => duplicateRow(row)} className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px]">📋</button>
                                    <button onClick={() => removeRow(row.id)} className="text-red-500 font-bold">✕</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                    {filteredPathNodes.length === 0 && <tr><td colSpan={13} className="p-6 text-center text-slate-500">No items match this search.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: DETAILED ABSTRACT */}
        {activeTab === "abstract" && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-blue-400 font-mono">Detailed Abstract Statement</h2>
              <div className="flex items-center gap-2">
                <TableSearch value={tableSearchQueries.abstract || ""} onChange={(value) => setTableSearchQueries((previous) => ({ ...previous, abstract: value }))} />
                <button onClick={exportAbstractExcel} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium shadow">📥 Abs. Excel</button>
                <button onClick={() => window.print()} className="px-3 py-1 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-medium shadow">📄 Abs. PDF</button>
              </div>
            </div>

            <div className="flex-1 overflow-auto border border-slate-700 rounded bg-slate-950">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead className="bg-slate-900 sticky top-0 text-slate-300 border-b border-slate-700 z-10">
                  <tr>
                    <th className="p-2.5 w-16 text-center border border-slate-700">SL.NO.</th>
                    <th className="p-2.5 w-24 text-center border border-slate-700">Item Code</th>
                    <th className="p-2.5 min-w-[500px] border border-slate-700 font-sans">Description of item</th>
                    <th className="p-2.5 w-14 text-center border border-slate-700">Unit</th>
                    <th className="p-2.5 w-20 text-right border border-slate-700">Qty</th>
                    <th className="p-2.5 w-24 text-right border border-slate-700">Rate DSR</th>
                    <th className="p-2.5 w-24 text-right border border-slate-700">Rate DAR</th>
                    <th className="p-2.5 w-32 text-right border border-slate-700">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {Object.keys(filteredAbstractGroups).map((shKey) => {
                    const groupItems = filteredAbstractGroups[shKey];
                    const subTotal = groupItems.reduce((s, i) => s + i.amount, 0);
                    const label = DSR_CHAPTER_NAMES[shKey] || catalog[shKey]?.label || shKey;
                    
                    return (
                      <React.Fragment key={`abs-grp-${shKey}`}>
                        {groupItems.map((item, idx) => (
                          <tr key={`abs-${item.itemCode}-${idx}`} className={item.isParentRow ? "bg-slate-900/95 font-semibold text-blue-300" : "hover:bg-slate-900/40"}>
                            <td className="p-2.5 font-mono text-amber-400 font-bold text-center border border-slate-700 align-top">{item.treeSlNo}</td>
                            <td className="p-2.5 font-mono text-blue-400 font-bold text-center border border-slate-700 align-top">{item.itemCode}</td>
                            <td className="p-2.5 text-slate-800 dark:text-slate-200 text-sm font-semibold border border-slate-700 font-sans align-top text-justify whitespace-pre-wrap">
                              {item.description}
                            </td>
                            {item.isParentRow ? (
                              <td className="p-2.5 border border-slate-700" colSpan={5}></td>
                            ) : (
                              <React.Fragment>
                                <td className="p-2.5 text-center text-slate-800 dark:text-slate-400 border border-slate-700 align-bottom font-bold">{item.unit || "cum"}</td>
                                <td className="p-2.5 text-right font-mono font-bold text-slate-900 dark:text-slate-100 border border-slate-700 align-bottom">{item.totalQty.toFixed(2)}</td>
                                <td className="p-2.5 text-right font-mono text-slate-800 dark:text-slate-300 border border-slate-700 align-bottom font-bold">{formatCurrency(item.rate, projectDetails.numberFormat)}</td>
                                <td className="p-2.5 text-right font-mono text-cyan-700 dark:text-cyan-300 border border-slate-700 align-bottom font-bold">{item.rateDAR == null ? "" : formatCurrency(item.rateDAR, projectDetails.numberFormat)}</td>
                                <td className="p-2.5 text-right font-mono font-black text-green-600 dark:text-green-400 border border-slate-700 align-bottom">₹{formatCurrency(item.amount, projectDetails.numberFormat, 0)}</td>
                              </React.Fragment>
                            )}
                          </tr>
                        ))}
                        <tr className="bg-slate-800/80 font-bold text-xs border-y-2 border-slate-600">
                          <td colSpan={7} className="p-2 border border-slate-700 text-right text-slate-900 dark:text-slate-300 font-sans">Total for {label}:</td>
                          <td className="p-2 border border-slate-700 text-right text-green-600 dark:text-green-400 font-mono">₹{formatCurrency(subTotal, projectDetails.numberFormat, 0)}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                  
                  {filteredAbstractCount === 0 && (
                    <tr><td colSpan={8} className="p-8 text-center text-slate-500 font-mono">{abstractSummaryList.length === 0 ? "No abstract quantities computed yet. Add measurement dimensions first." : "No items match this search."}</td></tr>
                  )}
                  
                  {/* Financial Addition Block */}
                  {abstractSummaryList.length > 0 && !tableSearchQueries.abstract?.trim() && (
                     <React.Fragment>
                        <tr className="bg-slate-900 border-t-4 border-slate-500 font-bold text-sm">
                          <td colSpan={7} className="p-3 border-r border-slate-700 font-sans text-right text-blue-300">Subtotal of DSR and MDSR items:</td>
                          <td className="p-3 text-right font-mono text-blue-300 border-r border-slate-700">₹{formatCurrency(baseDsrMdsrTotal, projectDetails.numberFormat, 0)}</td>
                        </tr>
                        {modFactor !== 1 && (
                          <tr className="bg-slate-900 font-semibold text-sm">
                            <td colSpan={7} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-300 font-bold">Modified estimated cost after applying multiplying factor ({modFactor}) on DSR and MDSR items:</td>
                            <td className="p-3 text-right font-mono text-slate-800 dark:text-slate-300 border-r border-slate-700 font-bold">₹{formatCurrency(adjustedModTotal, projectDetails.numberFormat, 0)}</td>
                          </tr>
                        )}
                        {costIndexAmount > 0 && (
                          <tr className="bg-slate-900 font-semibold text-sm border-b border-slate-700">
                            <td colSpan={7} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-300 font-bold">Add Cost Index @ {cIndexPct}%:</td>
                            <td className="p-3 text-right font-mono text-slate-800 dark:text-slate-300 border-r border-slate-700 font-bold">₹{formatCurrency(costIndexAmount, projectDetails.numberFormat, 0)}</td>
                          </tr>
                        )}
                        {baseNsrTotal > 0 && (
                          <tr className="bg-slate-900 font-semibold text-sm border-b border-slate-700">
                            <td colSpan={7} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-300 font-bold">Total of Non-Schedule Items:</td>
                            <td className="p-3 text-right font-mono text-slate-800 dark:text-slate-300 border-r border-slate-700 font-bold">₹{formatCurrency(baseNsrTotal, projectDetails.numberFormat, 0)}</td>
                          </tr>
                        )}
                        <tr className="bg-slate-900/80 font-bold text-sm">
                           <td colSpan={7} className="p-3 border-r border-slate-700 font-sans text-right text-amber-500 dark:text-amber-300 font-bold">Total of Schedule + Non-Schedule Items:</td>
                           <td className="p-3 text-right font-mono text-amber-500 dark:text-amber-300 border-r border-slate-700 font-bold">₹{formatCurrency(adjustedSubTotalD, projectDetails.numberFormat, 0)}</td>
                        </tr>
                        {epfAmount > 0 && (
                           <tr className="bg-slate-900/60 font-semibold text-sm">
                             <td colSpan={7} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Add EPF @ {epfPct}%:</td>
                             <td className="p-3 text-right font-mono text-slate-800 dark:text-slate-300 border-r border-slate-700 font-bold">₹{formatCurrency(epfAmount, projectDetails.numberFormat, 0)}</td>
                           </tr>
                        )}
                        {esiAmount > 0 && (
                           <tr className="bg-slate-900/60 font-semibold text-sm">
                             <td colSpan={7} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Add ESI @ {esiPct}%:</td>
                             <td className="p-3 text-right font-mono text-slate-800 dark:text-slate-300 border-r border-slate-700 font-bold">₹{formatCurrency(esiAmount, projectDetails.numberFormat, 0)}</td>
                           </tr>
                        )}
                        {contingencyAmount > 0 && (
                           <tr className="bg-slate-900/60 font-semibold text-sm">
                             <td colSpan={7} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Add Contingencies @ {contingencyLabel}:</td>
                             <td className="p-3 text-right font-mono text-slate-800 dark:text-slate-300 border-r border-slate-700 font-bold">₹{formatCurrency(contingencyAmount, projectDetails.numberFormat, 0)}</td>
                           </tr>
                        )}
                        <tr className="bg-slate-950 font-black border-t-4 border-slate-500 text-base">
                          <td colSpan={7} className="p-4 border-r border-slate-700 font-sans text-right text-green-600 dark:text-green-400 uppercase tracking-widest">Grand Total:</td>
                          <td className="p-4 text-right font-mono border-r border-slate-700 text-green-600 dark:text-green-400">₹{formatCurrency(grandTotalAbstractAmount, projectDetails.numberFormat, 0)}</td>
                        </tr>
                     </React.Fragment>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* GENERAL ABSTRACT */}
        {activeTab === "generalAbstract" && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 overflow-hidden space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-amber-300 font-mono">General Abstract (Financial Breakdown)</h2>
            </div>

            <div className="flex-1 overflow-auto border border-slate-700 rounded bg-slate-950 flex justify-center p-4">
              <div className="w-full max-w-4xl">
                <table className="w-full text-left text-sm border-collapse font-mono bg-slate-900/60 rounded border border-slate-700">
                  <thead className="bg-slate-900 text-slate-300 border-b border-slate-700">
                    <tr>
                      <th className="p-3 w-20 text-center border-r border-slate-700">SL.NO.</th>
                      <th className="p-3 border-r border-slate-700 font-sans">Description</th>
                      <th className="p-3 w-48 text-right border-r border-slate-700">Amount (₹)</th>
                      <th className="p-3 w-12 text-center text-slate-500 font-bold">Ref</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {generalAbstractList.map((sh, idx) => (
                      <tr key={sh.subheadKey} className="hover:bg-slate-900/40 text-xs">
                        <td className="p-3 text-center border-r border-slate-700 text-amber-600 dark:text-amber-500 font-bold">{idx + 1}</td>
                        <td className="p-3 border-r border-slate-700 font-sans font-bold text-base text-slate-900 dark:text-slate-100">{sh.subheadLabel}</td>
                        <td className="p-3 text-right border-r border-slate-700 text-slate-900 dark:text-slate-100 font-bold">{formatCurrency(sh.totalAmount, projectDetails.numberFormat, 0)}</td>
                        <td className="p-3 text-center text-slate-500"></td>
                      </tr>
                    ))}
                    
                    {generalAbstractList.length > 0 && (
                      <React.Fragment>
                        <tr className="bg-slate-900 font-bold border-t-2 border-slate-600">
                          <td colSpan={2} className="p-3 border-r border-slate-700 font-sans text-right text-blue-300">Subtotal of DSR and MDSR items:</td>
                          <td className="p-3 text-right border-r border-slate-700 text-blue-300">{formatCurrency(baseDsrMdsrTotal, projectDetails.numberFormat, 0)}</td>
                          <td className="p-3 text-center text-slate-300 font-bold">A</td>
                        </tr>
                        {modFactor !== 1 && (
                          <tr className="bg-slate-900/60">
                            <td colSpan={2} className="p-2.5 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Modified estimated cost after applying multiplying factor ({modFactor}) on DSR and MDSR items:</td>
                            <td className="p-2.5 text-right border-r border-slate-700 text-slate-800 dark:text-slate-300 font-bold">{formatCurrency(adjustedModTotal, projectDetails.numberFormat, 0)}</td>
                            <td className="p-2.5 text-center text-slate-800 dark:text-slate-300 font-bold">B</td>
                          </tr>
                        )}
                        {costIndexAmount > 0 && (
                          <tr className="bg-slate-900/60">
                            <td colSpan={2} className="p-2.5 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Add Cost Index @ {cIndexPct}%:</td>
                            <td className="p-2.5 text-right border-r border-slate-700 text-slate-800 dark:text-slate-300 font-bold">{formatCurrency(costIndexAmount, projectDetails.numberFormat, 0)}</td>
                            <td className="p-2.5 text-center text-slate-800 dark:text-slate-300 font-bold">C</td>
                          </tr>
                        )}
                        {baseNsrTotal > 0 && (
                          <tr className="bg-slate-900/60">
                            <td colSpan={2} className="p-2.5 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Total of Non-Schedule Items:</td>
                            <td className="p-2.5 text-right border-r border-slate-700 text-slate-800 dark:text-slate-300 font-bold">{formatCurrency(baseNsrTotal, projectDetails.numberFormat, 0)}</td>
                            <td className="p-2.5 text-center text-slate-800 dark:text-slate-300 font-bold">E</td>
                          </tr>
                        )}
                        <tr className="bg-slate-900/80 font-bold text-sm">
                           <td colSpan={2} className="p-2.5 border-r border-slate-700 font-sans text-right text-amber-600 dark:text-amber-300 font-bold">Total of Schedule + Non-Schedule Items:</td>
                           <td className="p-2.5 text-right border-r border-slate-700 text-amber-600 dark:text-amber-300 font-bold">{formatCurrency(adjustedSubTotalD, projectDetails.numberFormat, 0)}</td>
                           <td className="p-2.5 text-center text-slate-300 font-bold">D</td>
                        </tr>
                        {epfAmount > 0 && (
                           <tr className="bg-slate-900/60 font-semibold text-sm">
                             <td colSpan={2} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Add EPF @ {epfPct}%:</td>
                             <td className="p-3 text-right font-mono border-r border-slate-700 text-slate-800 dark:text-slate-300 font-bold">₹{formatCurrency(epfAmount, projectDetails.numberFormat, 0)}</td>
                             <td className="p-3 text-center text-slate-500 font-bold">G</td>
                           </tr>
                        )}
                        {esiAmount > 0 && (
                           <tr className="bg-slate-900/60 font-semibold text-sm">
                             <td colSpan={2} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Add ESI @ {esiPct}%:</td>
                             <td className="p-3 text-right font-mono border-r border-slate-700 text-slate-800 dark:text-slate-300 font-bold">₹{formatCurrency(esiAmount, projectDetails.numberFormat, 0)}</td>
                             <td className="p-3 text-center text-slate-500 font-bold">H</td>
                           </tr>
                        )}
                        {contingencyAmount > 0 && (
                           <tr className="bg-slate-900/60 font-semibold text-sm">
                             <td colSpan={2} className="p-3 border-r border-slate-700 font-sans text-right text-slate-800 dark:text-slate-400 font-bold">Add Contingencies @ {contingencyLabel}:</td>
                             <td className="p-3 text-right font-mono border-r border-slate-700 text-slate-800 dark:text-slate-300 font-bold">₹{formatCurrency(contingencyAmount, projectDetails.numberFormat, 0)}</td>
                             <td className="p-3 text-center text-slate-500 font-bold">I</td>
                           </tr>
                        )}
                        <tr className="bg-slate-950 font-black border-t-4 border-slate-500 text-base">
                          <td colSpan={2} className="p-4 border-r border-slate-700 font-sans text-right text-green-600 dark:text-green-400 uppercase tracking-widest">Grand Total:</td>
                          <td className="p-4 text-right font-mono border-r border-slate-700 text-green-600 dark:text-green-400">₹{formatCurrency(grandTotalAbstractAmount, projectDetails.numberFormat, 0)}</td>
                          <td className="p-4 text-center text-slate-500"></td>
                        </tr>
                      </React.Fragment>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================================== */}
        {/* RATE LIST, RA DSR, RA MARKET, MODALS */}
        {/* =================================================================================== */}
        {activeTab === "history" && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 items-center justify-center">
             <h2 className="text-2xl font-bold text-slate-600 mb-4 font-mono">History Sheet</h2>
             <p className="text-slate-500">This section is reserved for future implementation.</p>
          </div>
        )}

        {activeTab === "basicRatesList" && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-200">Basic Rates List</h2>
                <p className="text-xs text-slate-500 mt-1">Base items discovered across all loaded rate analyses · {filteredBasicRateRows.length} of {basicRateRows.length} items</p>
              </div>
              <div className="flex items-center gap-3">
                <TableSearch value={tableSearchQueries.basicRatesList || ""} onChange={(value) => setTableSearchQueries((previous) => ({ ...previous, basicRatesList: value }))} />
                <button onClick={exportBasicRatesCSV} className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium shadow">📥 Export CSV</button>
                <span className="text-[11px] text-amber-300">Zero or missing rates are highlighted</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto border border-slate-800 rounded">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-900 sticky top-0 text-slate-300 border-b border-slate-800 z-10">
                  <tr>
                    <th className="p-2 w-24">Code</th>
                    <th className="p-2">Description</th>
                    <th className="p-2 w-32 text-center">Unit</th>
                    <th className="p-2 w-36 text-right">Rate (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredBasicRateRows.map((item, index) => {
                    const hasRate = Number.isFinite(item.rate) && item.rate > 0;
                    return (
                      <tr key={`${item.code}-${item.description}-${index}`} className={hasRate ? "hover:bg-slate-900/70" : "bg-rose-950/60 text-rose-100"}>
                        <td className="p-2 font-mono">{/^\d+$/.test(item.code) ? item.code.padStart(4, "0") : item.code}</td>
                        <td className="p-2">{item.description}</td>
                        <td className="p-2 text-center">{item.unit}</td>
                        <td className="p-2 text-right font-mono">{hasRate ? formatCurrency(item.rate, projectDetails.numberFormat) : "MISSING / 0.00"}</td>
                      </tr>
                    );
                  })}
                  {filteredBasicRateRows.length === 0 && (
                    <tr><td colSpan={4} className="p-6 text-center text-slate-500">{basicRateRows.length === 0 ? "Rate analyses are not loaded yet." : "No basic-rate items match this search."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {activeTab === "justStatement" && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 items-center justify-center">
             <h2 className="text-2xl font-bold text-slate-600 mb-4 font-mono">Justification Statement</h2>
             <p className="text-slate-500">This section is reserved for future implementation.</p>
          </div>
        )}

        {activeTab === "justSummary" && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 items-center justify-center">
             <h2 className="text-2xl font-bold text-slate-600 mb-4 font-mono">Justification Summary</h2>
             <p className="text-slate-500">This section is reserved for future implementation.</p>
          </div>
        )}

        {activeTab === "rateList" && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 overflow-hidden space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-green-600 dark:text-green-300 font-mono">Rate List (Market Rates Justification)</h2>
                <div className="ml-4 flex items-center gap-2 bg-slate-900 border border-slate-700 rounded px-3 py-1">
                  <span className="text-xs text-slate-400 font-semibold">Global Market Format:</span>
                  <select value={marketRaFormat} onChange={e => setMarketRaFormat(e.target.value)} className="bg-slate-950 text-xs text-blue-600 dark:text-blue-300 border-none outline-none font-black">
                    <option value="conventional">Conventional DSR (Water → GST 0.2127 → CPOH → Cess)</option>
                    <option value="modified">Modified DSR (Water → CPOH → Cess → GST 18%)</option>
                    <option value="custom">Custom Format</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TableSearch value={tableSearchQueries.rateList || ""} onChange={(value) => setTableSearchQueries((previous) => ({ ...previous, rateList: value }))} />
                <button onClick={exportJustificationRateListCSV} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium shadow">📥 Export CSV</button>
                <button onClick={handleUndoMarketRate} disabled={marketRatesHistory.length === 0} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-white rounded text-xs font-medium shadow">↩ Undo Last Change</button>
                <button onClick={() => alert("Market rates updated successfully!")} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium shadow">✓ Update & Save</button>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto border border-slate-700 rounded bg-slate-950">
              {filteredJustificationMaterials.length === 0 ? (
                 <div className="text-slate-500 text-center py-12 text-xs font-mono">{justificationMaterials.length === 0 ? "No materials found in the current BOQ. Add items to BOQ first." : "No rate-list items match this search."}</div>
              ) : (
                <div className="p-4 space-y-8">
                  {["1", "2", "3", "4"].map(groupNum => {
                     const grpItems = filteredJustificationMaterials.filter((m) => m.group === groupNum);
                     if (grpItems.length === 0) return null;
                     
                     let groupTitle = "";
                     if (groupNum === "1") groupTitle = "0.1 Basic rates of hire charges of plants and machineries (0001 - 0099)";
                     if (groupNum === "2") groupTitle = "0.2 Basic rates of labour (0100 - 0221)";
                     if (groupNum === "3") groupTitle = "0.3 Basic rates of materials (0222 - 9999 except 2200-2358)";
                     if (groupNum === "4") groupTitle = "0.4 Carriage of materials (2200 - 2358)";

                     return (
                        <div key={groupNum} className="border border-slate-800 rounded bg-slate-900/40">
                           <h3 className="bg-slate-800 text-amber-600 dark:text-amber-300 text-xs font-black p-2 px-4 uppercase tracking-wider">{groupTitle}</h3>
                           <table className="w-full text-left font-mono text-xs border-collapse">
                             <thead className="bg-slate-900 sticky top-0 text-slate-400 border-b border-slate-700 z-10">
                               <tr>
                                 <th className="p-2 w-16 text-center border-r border-slate-800">Sl.No.</th>
                                 <th className="p-2 w-24 text-center border-r border-slate-800">Code</th>
                                 <th className="p-2 font-sans border-r border-slate-800">Description</th>
                                 <th className="p-2 w-20 text-center border-r border-slate-800">Unit</th>
                                 <th className="p-2 w-28 text-right border-r border-slate-800">DSR Rate (₹)</th>
                                 <th className="p-2 w-32 text-right">Market Rate (₹)</th>
                               </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-800/60">
                                {grpItems.map((mat, idx) => {
                                    const currentVal = marketRates[mat.id] !== undefined ? marketRates[mat.id] : mat.dsrRate;
                                    return (
                                      <tr key={idx} className="hover:bg-slate-900/80">
                                        <td className="p-2 text-center text-slate-800 dark:text-slate-500 border-r border-slate-800 font-bold">{idx + 1}</td>
                                        <td className="p-2 text-center text-amber-600 dark:text-amber-400 font-black border-r border-slate-800">{mat.code}</td>
                                        <td className="p-2 text-black dark:text-slate-200 font-sans border-r border-slate-800 font-bold">{mat.description}</td>
                                        <td className="p-2 text-center text-slate-800 dark:text-slate-400 border-r border-slate-800 font-bold">{mat.unit}</td>
                                        <td className="p-2 text-right border-r border-slate-400 dark:border-slate-800 cursor-not-allowed bg-slate-300/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-500 font-bold">{mat.dsrRate.toFixed(2)}</td>
                                        <td className="p-1 text-right">
                                          <input type="number" step="any" value={currentVal} onChange={(e) => handleMarketRateChange(mat.id, parseFloat(e.target.value) || 0)} className="w-full bg-slate-900 border border-slate-700 p-1.5 text-right text-green-600 dark:text-green-300 font-black focus:outline-none focus:border-green-500 rounded" />
                                        </td>
                                      </tr>
                                    );
                                })}
                             </tbody>
                           </table>
                        </div>
                     );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {(activeTab === "rateAnalysisTab" || activeTab === "marketRateAnalysis") && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 overflow-hidden space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-300 font-mono">Rate Analysis for Selected BOQ Items</h2>
                {activeTab === "marketRateAnalysis" && <span className="text-[10px] bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/50 px-2 py-0.5 rounded font-mono font-bold"> Using Format: {marketRaFormat.toUpperCase()} </span>}
              </div>
              <div className="flex items-center gap-2">
                <TableSearch value={raSearchQuery} onChange={(value) => setTableSearchQueries((previous) => ({ ...previous, [activeTab]: value }))} />
                <button onClick={exportRateAnalysisExcel} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium shadow">📥 RA Excel</button>
                <button onClick={() => window.print()} className="px-3 py-1 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-medium shadow">📄 RA PDF</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto border border-slate-700 rounded bg-slate-950 p-4">
              {filteredRaItemCodes.length === 0 && filteredRaSubCodes.length === 0 ? (
                <div className="text-slate-500 text-center py-12 text-xs font-mono">{raSearchQuery ? "No rate-analysis items match this search." : "No items in BOQ. Add items first."}</div>
              ) : (
                <div className="space-y-8">
                  {/* MAIN ITEMS ITERATION */}
                  {filteredRaItemCodes.map((code) => {
                    const cleanCode = code.trim();
                    const isMarket = activeTab === "marketRateAnalysis"; 
                    const analysisObj = getComputedRA(cleanCode, isMarket); 
                    const catalogItem = findCatalogItemByCodeGlobal(catalog, customNsrs, cleanCode);
                    const fullDesc = getFullTreeDescriptionGlobal(catalog, customNsrs, cleanCode, rateAnalysisData); 

                    return (
                      <div key={`ra-card-${cleanCode}`} className="border border-slate-800 rounded bg-slate-900/60 p-4 shadow-xl">
                        <div className="flex justify-between items-start pb-2 mb-3 border-b border-slate-800">
                          <div className="pr-8">
                            <span className="font-mono text-purple-700 dark:text-purple-400 font-black text-sm">Item Code: {cleanCode}</span>
                            <div className="flex flex-col mt-2 whitespace-pre-wrap text-xs text-black font-sans leading-relaxed font-bold">
                              {fullDesc}
                            </div>
                          </div>
                          <span className="font-mono text-xs text-green-600 dark:text-green-400 font-black bg-slate-200 dark:bg-slate-950 px-2 py-1 border border-green-900 rounded shadow">{isMarket ? "Market Rate" : "Rate"}: ₹{isMarket ? (analysisObj?.rate?.toFixed(2) ?? "N/A") : (catalogItem?.rate ?? "N/A")}</span>
                        </div>
                        
                        {analysisObj && analysisObj.block && analysisObj.block.length > 0 ? (
                          <div className="space-y-4">
                            <table className="w-full text-left font-mono text-xs border-collapse bg-slate-950 rounded overflow-hidden">
                              <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                                <tr>
                                  <th className="p-2 w-16 text-center">Code</th>
                                  <th className="p-2 font-sans">Description</th>
                                  <th className="p-2 w-16 text-center">Unit</th>
                                  <th className="p-2 w-20 text-right">Qty</th>
                                  <th className="p-2 w-24 text-right">Rate (₹)</th>
                                  <th className="p-2 w-28 text-right">Amount (₹)</th>
                                  <th className="p-2 w-12 text-center text-amber-500 font-bold">Mark</th>
                                  <th className="p-2 w-24 text-center">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {analysisObj.block.filter((row) => matchesSearch(raSearchQuery, row.code, row.description)).map((row, rIdx) => {
                                  const isHeaderRow = !row.code && !row.unit && !row.rate && (!row.amount || row.amount === "");
                                    const rowCode = resolveNestedAnalysisCode(row);
                                    const hasSubAr = Boolean(rowCode && getRAData(rowCode));
                                  
                                  return (
                                    <tr key={`${row.code || "-"}-${row.description}-${rIdx}`} className={isHeaderRow ? "bg-slate-900/60 font-semibold text-amber-300" : "hover:bg-slate-900/40"}>
                                      <td className="p-2 text-slate-800 dark:text-slate-400 text-center font-bold">{row.code || ""}</td>
                                      <td className="p-2 font-sans font-bold text-black">{row.description}</td>
                                      <td className="p-2 text-center text-slate-800 dark:text-slate-400 font-bold">{row.unit || ""}</td>
                                      <td className="p-2 text-right font-bold text-black dark:text-slate-200">{row.quantity !== "" && !isNaN(Number(row.quantity)) ? Number(row.quantity).toFixed(3) : row.quantity}</td>
                                      <td className="p-2 text-right text-slate-800 dark:text-slate-300 font-bold">{row.rate !== "" && !isNaN(Number(row.rate)) ? Number(row.rate).toFixed(2) : row.rate}</td>
                                      <td className="p-2 text-right font-bold text-green-600 dark:text-green-400">{row.amount !== "" && !isNaN(Number(row.amount)) ? Number(row.amount).toFixed(2) : row.amount}</td>
                                      <td className="p-2 text-center text-amber-500 font-bold">{row.mark || ""}</td>
                                      <td className="p-2 text-center">
                                        {hasSubAr && rowCode !== "" && getRAData(rowCode) && (
                                          <button onClick={() => setArModalStack([...arModalStack, rowCode])} className="px-2 py-1 bg-purple-600/80 hover:bg-purple-500 text-white rounded text-[10px] font-bold shadow">🔍 Nested AR</button>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-slate-500 text-xs italic py-2 font-bold">No detailed formula stored for this item code in master database.</div>
                        )}
                      </div>
                    );
                  })}

                  {/* GLOBAL SUB-AR RENDERING SECTION */}
                  {filteredRaSubCodes.length > 0 && (
                    <div className="mt-12 pt-8 border-t-4 border-slate-800/80">
                      <h2 className="text-xl font-black text-amber-500 uppercase tracking-widest mb-6 border-b border-amber-900/50 pb-2">📋 Sub-Analysis of Rates</h2>
                      <div className="space-y-8">
                        {filteredRaSubCodes.map((subCode) => {
                          const isMarket = activeTab === "marketRateAnalysis"; 
                          const subAnalysis = getComputedRA(subCode, isMarket);
                          const subCatalog = findCatalogItemByCodeGlobal(catalog, customNsrs, subCode);
                          
                          if (!subAnalysis || !subAnalysis.block || subAnalysis.block.length === 0) {
                              return (
                                <div key={`global-sub-${subCode}`} className="mb-4 border border-slate-800 rounded bg-slate-900/60 p-4 shadow-inner">
                                  <div className="flex justify-between items-center pb-2 mb-2 border-b border-slate-800">
                                    <span className="font-mono text-blue-500 font-black text-sm">Sub-AR: {subCode}</span>
                                    <span className="font-mono text-xs text-green-600 dark:text-green-400 font-black">Rate: ₹{subCatalog?.rate ?? subAnalysis?.rate?.toFixed(2) ?? "N/A"}</span>
                                  </div>
                                  <p className="text-xs text-black font-sans mb-3 whitespace-pre-wrap font-bold">{getFullTreeDescriptionGlobal(catalog, customNsrs, subCode, rateAnalysisData)}</p>
                                  <div className="text-slate-500 text-xs italic py-2 font-bold">No detailed formula stored in master database.</div>
                                </div>
                              );
                          }
                          
                          return (
                            <div key={`global-sub-${subCode}`} className="mb-4 border border-blue-900/40 rounded bg-slate-900/80 p-4 shadow-xl">
                              <div className="flex justify-between items-center pb-2 mb-3 border-b border-blue-900/50">
                                <span className="font-mono text-blue-500 font-black text-sm">Sub-AR: {subCode}</span>
                                <span className="font-mono text-xs text-green-600 dark:text-green-400 font-black">{isMarket ? "Market Rate" : "Rate"}: ₹{isMarket ? (subAnalysis?.rate?.toFixed(2) ?? "N/A") : (subCatalog?.rate ?? subAnalysis?.rate?.toFixed(2) ?? "N/A")}</span>
                              </div>
                              <p className="text-xs text-black font-sans mb-4 whitespace-pre-wrap font-bold leading-relaxed">{getFullTreeDescriptionGlobal(catalog, customNsrs, subCode, rateAnalysisData)}</p>
                              <table className="w-full text-left font-mono text-xs border-collapse bg-slate-950 rounded overflow-hidden">
                                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                                  <tr>
                                    <th className="p-2 w-16 text-center">Code</th>
                                    <th className="p-2 font-sans">Description</th>
                                    <th className="p-2 w-16 text-center">Unit</th>
                                    <th className="p-2 w-20 text-right">Qty</th>
                                    <th className="p-2 w-24 text-right">Rate (₹)</th>
                                    <th className="p-2 w-28 text-right">Amount (₹)</th>
                                    <th className="p-2 w-12 text-center text-amber-500 font-bold">Mark</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60">
                                  {subAnalysis.block.filter((row) => matchesSearch(raSearchQuery, row.code, row.description)).map((row, rIdx) => {
                                    const isHeaderRow = !row.code && !row.unit && !row.rate && (!row.amount || row.amount === "");
                                    return (
                                      <tr key={`global-sub-item-${subCode}-${rIdx}`} className={isHeaderRow ? "bg-slate-900/60 font-semibold text-amber-500" : "hover:bg-slate-900/40"}>
                                        <td className="p-2 text-slate-800 dark:text-slate-500 text-center font-bold">{row.code || ""}</td>
                                        <td className="p-2 font-sans font-bold text-black">{row.description}</td>
                                        <td className="p-2 text-center text-slate-800 dark:text-slate-500 font-bold">{row.unit || ""}</td>
                                        <td className="p-2 text-right font-bold text-black dark:text-slate-300">{row.quantity !== "" && !isNaN(Number(row.quantity)) ? Number(row.quantity).toFixed(3) : row.quantity}</td>
                                        <td className="p-2 text-right text-slate-800 dark:text-slate-400 font-bold">{row.rate !== "" && !isNaN(Number(row.rate)) ? Number(row.rate).toFixed(2) : row.rate}</td>
                                        <td className="p-2 text-right font-bold text-green-700 dark:text-green-500/80">{row.amount !== "" && !isNaN(Number(row.amount)) ? Number(row.amount).toFixed(2) : row.amount}</td>
                                        <td className="p-2 text-center text-amber-600 font-bold">{row.mark || ""}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* NESTED VIEW AR MODAL */}
        {arModalStack.length > 0 && (() => {
           const activeCode = arModalStack[arModalStack.length - 1];
           const isMarket = activeTab === "marketRateAnalysis";
           const ra = getComputedRA(activeCode, isMarket);
           if (!ra || !ra.block) return null;
           
           return (
             <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
               <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col w-full max-w-6xl max-h-[90vh]">
                 <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950 rounded-t-lg">
                    <div className="flex items-center gap-4">
                      {arModalStack.length > 1 && (
                          <button onClick={() => setArModalStack(arModalStack.slice(0, -1))} className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded font-bold shadow">← Back</button>
                      )}
                      <div>
                        <span className="font-mono text-purple-400 font-bold text-sm">Item Code: {activeCode}</span>
                        <div className="text-xs text-black font-sans leading-relaxed mt-1 font-bold">
                          {getFullTreeDescriptionGlobal(catalog, customNsrs, activeCode, rateAnalysisData)}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => setArModalStack([])} className="text-slate-400 hover:text-white font-bold ml-4">✕ Close</button>
                 </div>
                 <div className="flex-1 overflow-auto p-4 space-y-4">
                    <table className="w-full text-left font-mono text-xs border-collapse bg-slate-950 rounded overflow-hidden">
                      <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="p-2 w-16 text-center">Code</th>
                          <th className="p-2 font-sans">Description</th>
                          <th className="p-2 w-16 text-center">Unit</th>
                          <th className="p-2 w-20 text-right">Qty</th>
                          <th className="p-2 w-24 text-right">Rate (₹)</th>
                          <th className="p-2 w-28 text-right">Amount (₹)</th>
                          <th className="p-2 w-12 text-center text-amber-500 font-bold">Mark</th>
                          <th className="p-2 w-24 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {ra.block.map((row, rIdx) => {
                          const isHeaderRow = !row.code && !row.unit && !row.rate && (!row.amount || row.amount === "");
                            const rowCode = resolveNestedAnalysisCode(row);
                            const hasSubAr = Boolean(rowCode && getRAData(rowCode));
                          
                          return (
                            <tr key={`${row.code || "-"}-${row.description}-${rIdx}`} className={isHeaderRow ? "bg-slate-900/60 font-semibold text-amber-300" : "hover:bg-slate-900/40"}>
                              <td className="p-2 text-slate-800 dark:text-slate-400 text-center font-bold">{row.code || ""}</td>
                              <td className="p-2 font-sans font-bold text-black">{row.description}</td>
                              <td className="p-2 text-center text-slate-800 dark:text-slate-400 font-bold">{row.unit || ""}</td>
                              <td className="p-2 text-right font-bold text-black dark:text-slate-200">{row.quantity !== "" && !isNaN(Number(row.quantity)) ? Number(row.quantity).toFixed(3) : row.quantity}</td>
                              <td className="p-2 text-right text-slate-800 dark:text-slate-300 font-bold">{row.rate !== "" && !isNaN(Number(row.rate)) ? Number(row.rate).toFixed(2) : row.rate}</td>
                              <td className="p-2 text-right font-bold text-green-600 dark:text-green-400">{row.amount !== "" && !isNaN(Number(row.amount)) ? Number(row.amount).toFixed(2) : row.amount}</td>
                              <td className="p-2 text-center text-amber-500 font-bold">{row.mark || ""}</td>
                              <td className="p-2 text-center">
                                  {hasSubAr && rowCode !== "" && getRAData(rowCode) && (
                                      <button onClick={() => setArModalStack([...arModalStack, rowCode])} className="px-2 py-1 bg-purple-600/80 hover:bg-purple-500 text-white rounded text-[10px] font-bold shadow">🔍 Nested AR</button>
                                  )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                 </div>
               </div>
             </div>
           );
        })()}

                  {showNsrCreator && (() => {
                    const preview = calculateNsrTotals();
                    const parentItems = customNsrs.filter((item) => item.code.startsWith(`${nsrForm.type}.`) && (item.isMain || parentItemSet.has(normalizeCode(item.code))));
                    return (
                      <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-3 md:p-6">
                        <div className="w-full max-w-7xl max-h-[94vh] overflow-hidden flex flex-col bg-slate-900 border border-slate-700 rounded shadow-2xl">
                          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-700 bg-slate-950">
                            <div>
                              <h2 className="text-base font-bold text-amber-300">{isEditingNsr ? "Edit" : "Create"} {nsrForm.type === "50" ? "MDSR item" : "NSR item"}</h2>
                              <p className="text-xs text-slate-400 font-mono">Item code: {isEditingNsr || getNextNsrCode(nsrForm.type, nsrForm.parentCode)}</p>
                            </div>
                            <button onClick={() => setShowNsrCreator(false)} className="px-3 py-1 text-sm text-slate-300 hover:text-white" aria-label="Close item editor">✕ Close</button>
                          </div>

                          <div className="flex-1 overflow-auto p-4 md:p-5 space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                              <label className="flex flex-col gap-1 text-xs text-slate-400">Item family
                                <select value={nsrForm.type} onChange={(e) => setNsrForm({ ...nsrForm, type: e.target.value as NsrForm["type"], parentCode: "" })} className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-sm text-slate-100">
                                  <option value="51">NSR · SH 51</option><option value="50">MDSR · SH 50</option>
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 text-xs text-slate-400">Parent item · leave empty for top level
                                <select value={nsrForm.parentCode} onChange={(e) => setNsrForm({ ...nsrForm, parentCode: e.target.value })} className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-sm text-slate-100">
                                  <option value="">Top-level item</option>
                                  {parentItems.map((item) => <option key={item.code} value={item.code}>{`${"-- ".repeat(Math.max(0, item.code.split(".").length - 2))}${item.code} · ${item.description}`}</option>)}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 text-xs text-slate-400">Copy rate analysis from
                                <input list="nsr-copy-code-list" value={nsrForm.copyCode} onChange={(e) => setNsrForm({ ...nsrForm, copyCode: e.target.value })} placeholder="DSR / NSR / MDSR code" className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-sm text-slate-100 font-mono" />
                              </label>
                              <div className="flex items-end"><button onClick={copyNsrRateAnalysis} className="w-full px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-bold">Load source analysis</button></div>

                              <label className="md:col-span-2 flex flex-col gap-1 text-xs text-slate-400">Item description
                                <textarea value={nsrForm.description} onChange={(e) => setNsrForm({ ...nsrForm, description: e.target.value })} rows={2} className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-sm text-slate-100 resize-y" />
                              </label>
                              <label className="flex flex-col gap-1 text-xs text-slate-400">Unit
                                <input list="nsr-unit-list" value={nsrForm.unit} onChange={(e) => setNsrForm({ ...nsrForm, unit: e.target.value })} className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-sm text-slate-100" />
                              </label>
                              <label className="flex flex-col gap-1 text-xs text-slate-400">Base quantity for rate calculation
                                <input type="number" min="0.001" step="any" value={nsrForm.baseQty} onChange={(e) => setNsrForm({ ...nsrForm, baseQty: Number(e.target.value) })} className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-sm text-slate-100" />
                              </label>

                              <label className="flex flex-col gap-1 text-xs text-slate-400">Calculation method
                                <select value={nsrForm.format} onChange={(e) => setNsrForm({ ...nsrForm, format: e.target.value })} disabled={nsrForm.isHeadingOnly} className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-sm text-slate-100 disabled:opacity-50">
                                  <option value="conventional">Conventional DSR</option><option value="modified">Modified DSR</option><option value="custom">Custom charges</option>
                                </select>
                              </label>
                              <label className="flex items-center gap-2 text-xs text-slate-300 pt-5"><input type="checkbox" checked={nsrForm.isHeadingOnly} onChange={(e) => setNsrForm({ ...nsrForm, isHeadingOnly: e.target.checked })} className="accent-amber-500" /> Parent heading only</label>
                            </div>

                            <datalist id="nsr-unit-list">{nsrUnitOptions.map((unit) => <option key={unit} value={unit} />)}</datalist>
                            <datalist id="nsr-copy-code-list">{nsrLookupCodes.map((code) => <option key={code} value={code}>{findCatalogItemByCodeGlobal(catalog, customNsrs, code)?.description || getRAData(code)?.description || ""}</option>)}</datalist>
                            <datalist id="nsr-material-code-list">{nsrLookupCodes.map((code) => <option key={code} value={code}>{materialDb[code]?.desc || findCatalogItemByCodeGlobal(catalog, customNsrs, code)?.description || ""}</option>)}</datalist>

                            {nsrForm.format === "custom" && !nsrForm.isHeadingOnly && (
                              <section className="border border-slate-700 rounded p-3 space-y-2">
                                <div className="flex items-center justify-between"><h3 className="text-xs font-bold text-slate-200 uppercase">Custom charges</h3><button onClick={() => setNsrForm({ ...nsrForm, customAddons: [...nsrForm.customAddons, { id: crypto.randomUUID(), label: "Other charge", pct: 0, checked: true }] })} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs">+ Add charge</button></div>
                                {nsrForm.customAddons.map((addon, index) => <div key={addon.id} className="grid grid-cols-[auto_1fr_100px_auto] gap-2 items-center"><input type="checkbox" checked={addon.checked} onChange={(e) => setNsrForm({ ...nsrForm, customAddons: nsrForm.customAddons.map((current, i) => i === index ? { ...current, checked: e.target.checked } : current) })} className="accent-blue-500" /><input value={addon.label} onChange={(e) => setNsrForm({ ...nsrForm, customAddons: nsrForm.customAddons.map((current, i) => i === index ? { ...current, label: e.target.value } : current) })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100" /><input type="number" step="0.01" value={addon.pct} onChange={(e) => setNsrForm({ ...nsrForm, customAddons: nsrForm.customAddons.map((current, i) => i === index ? { ...current, pct: Number(e.target.value) } : current) })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100" /><button onClick={() => setNsrForm({ ...nsrForm, customAddons: nsrForm.customAddons.filter((_, i) => i !== index) })} className="text-red-300 hover:text-red-200" aria-label="Remove charge">✕</button></div>)}
                              </section>
                            )}

                            {!nsrForm.isHeadingOnly && (
                              <section className="space-y-2">
                                <div className="flex items-center justify-between"><h3 className="text-xs font-bold text-slate-200 uppercase">Rate analysis rows</h3><div className="flex gap-2"><button onClick={() => setNsrForm({ ...nsrForm, rows: [...nsrForm.rows, { isExplanation: false, code: "", desc: "", unit: "", qty: "", rate: "", amt: 0, mark: "" }] })} className="px-2.5 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs">+ Material / item</button><button onClick={() => setNsrForm({ ...nsrForm, rows: [...nsrForm.rows, { isExplanation: true, code: "", desc: "", unit: "", qty: "", rate: "", amt: 0, mark: "" }] })} className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs">+ Note row</button></div></div>
                                <div className="overflow-x-auto border border-slate-700 rounded">
                                  <table className="w-full min-w-[960px] text-left text-xs">
                                    <thead className="bg-slate-950 text-slate-400"><tr><th className="p-2 w-12">SL</th><th className="p-2 w-20">Type</th><th className="p-2 w-32">Code</th><th className="p-2">Description</th><th className="p-2 w-32">Unit</th><th className="p-2 w-24 text-right">Quantity</th><th className="p-2 w-28 text-right">Rate</th><th className="p-2 w-28 text-right">Amount</th><th className="p-2 w-12 text-center">Mark</th><th className="p-2 w-20">Order</th></tr></thead>
                                    <tbody className="divide-y divide-slate-800">
                                      {nsrForm.rows.map((row, index) => (
                                        <tr key={`nsr-row-${index}`} className={row.isExplanation ? "bg-slate-900/50" : ""}>
                                          <td className="p-2 font-mono text-slate-400">{index + 1}</td>
                                          <td className="p-2"><label className="flex items-center gap-1"><input type="checkbox" checked={row.isExplanation} onChange={(e) => handleNsrRowChange(index, "isExplanation", e.target.checked)} />Note</label></td>
                                          <td className="p-2"><input list="nsr-material-code-list" value={row.code} disabled={row.isExplanation} onChange={(e) => handleNsrRowChange(index, "code", e.target.value)} placeholder="Material / DSR code" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono disabled:opacity-40" /></td>
                                          <td className="p-2"><input value={row.desc} onChange={(e) => handleNsrRowChange(index, "desc", e.target.value)} placeholder="Description" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100" /></td>
                                          <td className="p-2"><input list="nsr-unit-list" value={row.unit} disabled={row.isExplanation} onChange={(e) => handleNsrRowChange(index, "unit", e.target.value)} placeholder="Choose or enter unit" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 disabled:opacity-40" /></td>
                                          <td className="p-2"><input type="number" step="any" value={row.qty} disabled={row.isExplanation} onChange={(e) => handleNsrRowChange(index, "qty", e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-right text-slate-100 disabled:opacity-40" /></td>
                                          <td className="p-2"><input type="number" step="any" value={row.rate} disabled={row.isExplanation} onChange={(e) => handleNsrRowChange(index, "rate", e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-right text-slate-100 disabled:opacity-40" /></td>
                                          <td className="p-2 text-right font-mono text-slate-200">{row.isExplanation ? "" : Number(row.amt || 0).toFixed(2)}</td>
                                          <td className="p-2 text-center">{row.mark === "A" ? <span className="px-1.5 py-0.5 bg-amber-700 text-white rounded font-bold">A</span> : ""}</td>
                                          <td className="p-2"><div className="flex gap-1"><button onClick={() => setNsrForm((current) => { const rows = [...current.rows]; if (index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; return { ...current, rows }; })} disabled={index === 0} className="px-1.5 py-1 bg-slate-700 text-white rounded disabled:opacity-30" aria-label="Move row up">↑</button><button onClick={() => setNsrForm((current) => { const rows = [...current.rows]; if (index < rows.length - 1) [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]]; return { ...current, rows }; })} disabled={index === nsrForm.rows.length - 1} className="px-1.5 py-1 bg-slate-700 text-white rounded disabled:opacity-30" aria-label="Move row down">↓</button><button onClick={() => setNsrForm((current) => ({ ...current, rows: current.rows.length > 1 ? current.rows.filter((_, i) => i !== index) : current.rows }))} className="px-1.5 py-1 bg-red-800 text-white rounded" aria-label="Remove row">×</button></div></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </section>
                            )}

                            {!nsrForm.isHeadingOnly && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 pt-3 text-sm"><span className="text-slate-400">Materials & labour: <strong className="text-slate-100">₹{preview.sum.toFixed(2)}</strong> · Total: <strong className="text-green-300">₹{preview.finalGrandTotal.toFixed(2)}</strong></span><span className="font-mono font-bold text-green-300">Calculated rate: ₹{preview.finalRate.toFixed(2)} / {nsrForm.unit}</span></div>}
                          </div>

                          <div className="flex justify-end gap-2 p-3 border-t border-slate-700 bg-slate-950"><button onClick={() => setShowNsrCreator(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs">Cancel</button><button onClick={saveNsrItem} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold">Save {nsrForm.type === "50" ? "MDSR" : "NSR"}</button></div>
                        </div>
                      </div>
                    );
                  })()}

                  {showThemeModal && (
           <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 backdrop-blur-sm">
             <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-full max-w-md shadow-2xl flex flex-col relative overflow-hidden">
                <div className="flex justify-between items-center pb-4 mb-4 border-b border-slate-800 relative z-10">
                   <h2 className="font-bold text-blue-400 text-lg flex items-center gap-2">🎨 Interface Personalization</h2>
                   <button onClick={() => setShowThemeModal(false)} className="text-slate-400 hover:text-white font-bold text-lg leading-none">✕</button>
                </div>
                
                <div className="space-y-6 relative z-10">
                   <div>
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Base Application Theme</label>
                      <div className="flex gap-2 bg-slate-950 p-1 rounded border border-slate-800">
                         <button onClick={() => setAppTheme({...appTheme, mode: 'dark'})} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${appTheme.mode === 'dark' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}`}>🌙 Dark</button>
                         <button onClick={() => setAppTheme({...appTheme, mode: 'light'})} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${appTheme.mode === 'light' ? 'bg-white text-black shadow' : 'text-slate-400 hover:text-white'}`}>☀️ Light</button>
                         <button onClick={() => setAppTheme({...appTheme, mode: 'custom'})} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${appTheme.mode === 'custom' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>💻 Custom UI</button>
                      </div>
                   </div>

                   {appTheme.mode === 'custom' && (
                      <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                         <div className="flex justify-between items-center bg-slate-950 p-3 rounded border border-slate-800">
                            <span className="text-sm font-medium text-slate-300">Global Background Color</span>
                            <input type="color" value={appTheme.customBg} onChange={(e) => setAppTheme({...appTheme, customBg: e.target.value})} className="w-8 h-8 rounded border-none cursor-pointer bg-transparent" />
                         </div>
                         <div className="flex justify-between items-center bg-slate-950 p-3 rounded border border-slate-800">
                            <span className="text-sm font-medium text-slate-300">Surface Overlay Color</span>
                            <input type="color" value={appTheme.customPanelBg} onChange={(e) => setAppTheme({...appTheme, customPanelBg: e.target.value})} className="w-8 h-8 rounded border-none cursor-pointer bg-transparent" />
                         </div>
                         <div className="flex justify-between items-center bg-slate-950 p-3 rounded border border-slate-800">
                            <span className="text-sm font-medium text-slate-300">Base Text Color</span>
                            <input type="color" value={appTheme.customText} onChange={(e) => setAppTheme({...appTheme, customText: e.target.value})} className="w-8 h-8 rounded border-none cursor-pointer bg-transparent" />
                         </div>
                         <div className="bg-slate-950 p-3 rounded border border-slate-800 flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                               <span className="text-sm font-medium text-slate-300">Surface Opacity (Acrylic Effect)</span>
                               <span className="text-xs text-blue-400 font-mono font-bold">{Math.round(appTheme.transparency * 100)}%</span>
                            </div>
                            <input type="range" min="0" max="1" step="0.05" value={appTheme.transparency} onChange={(e) => setAppTheme({...appTheme, transparency: parseFloat(e.target.value)})} className="w-full accent-blue-500 cursor-pointer" />
                         </div>
                      </div>
                   )}
                </div>

                <div className="mt-8 flex justify-end gap-3 relative z-10 border-t border-slate-800 pt-4">
                   <button onClick={() => saveThemeSettings(DEFAULT_THEME)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded font-bold transition-colors">Reset Defaults</button>
                   <button onClick={() => { saveThemeSettings(appTheme); setShowThemeModal(false); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-bold shadow transition-colors">✓ Apply Changes</button>
                </div>
             </div>
           </div>
        )}

      </div>
    </div>
  );
}