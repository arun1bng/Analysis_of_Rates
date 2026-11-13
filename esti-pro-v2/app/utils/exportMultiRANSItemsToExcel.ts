import ExcelJS from "exceljs";

type ExportRow = {
  type?: string;
  row_type?: string;
  code?: string;
  component_code?: string;
  sub_analysis_code?: string;
  description?: string;
  unit?: string;
  quantity?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  mark?: string;
  calc_mark?: string;
  reference_mark?: string;
  dependentMark?: string;
  dependent_mark?: string;
  percentage?: number | string | null;
  isNote?: boolean;
  isSubAR?: boolean | number | string;
  is_sub_ar?: boolean | number | string;
  isTotal?: boolean;
  is_total?: boolean;
  isUnitRate?: boolean;
  is_unit_rate?: boolean;
  isSayRow?: boolean;
  is_say_row?: boolean;
  isExternalAR?: boolean;
  sourceItemCode?: string;
  source_item_code?: string;
  excludeAMarkedItems?: boolean;
  exclude_a_marked_items?: boolean;
  baseQty?: number | string | null;
  base_qty?: number | string | null;
  componentDivisor?: number | string | null;
  component_divisor?: number | string | null;
  bulkDivisor?: number | string | null;
  bulk_divisor?: number | string | null;
  operation?: string;
  sumOfMarks?: string[];
  useRunningBase?: boolean;
};

export type MultiRANSItemExportData = {
  itemNo?: string | number;
  item_no?: string | number;
  slNo?: string | number;
  code?: string;
  itemCode?: string;
  description?: string;
  itemDescription?: string;
  unit?: string;
  baseQty?: number | string | null;
  base_qty?: number | string | null;
  analysisRows?: ExportRow[] | string;
  rows?: ExportRow[];
  isExternalAR?: boolean;
  is_external_ar?: boolean | number;
  isParentHeading?: boolean;
  is_parent_heading?: boolean | number;
  nsrSettings?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  settings_json?: string;
  rate?: number | string | null;
  [key: string]: unknown;
};

type ItemBlock = {
  item: MultiRANSItemExportData;
  code: string;
  itemNo: string;
  description: string;
  unit: string;
  baseQty: number | null;
  rows: ExportRow[];
  external: boolean;
};

const FONT = { name: "Book Antiqua", size: 10 };
const MIN_TWO_DECIMAL_FORMAT = "0.00##########";
const INDIAN_AMOUNT_FORMAT = "##,##,##,##0.00";
const THIN = { style: "thin" as const };
const MEDIUM = { style: "medium" as const };
const COLUMNS = [
  { key: "code", width: 8.6 },
  { key: "description", width: 46 },
  { key: "unit", width: 7 },
  { key: "quantity", width: 8.5 },
  { key: "rate", width: 8.5 },
  { key: "amount", width: 11 },
  { key: "mark", width: 6 },
];
const EXTERNAL_AR_MESSAGE = "Being an External Analysis of Rate (AR) item, no corresponding detailed Rate Analysis is available in this export.";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function wrappedDescriptionHeight(value: string, charsPerLine = 85, minimum = 18): number {
  const paragraphs = value.replace(/\r/g, "").split("\n");
  const lineCount = paragraphs.reduce((count, paragraph) => {
    return count + (paragraph.length === 0 ? 1 : Math.ceil(paragraph.length / charsPerLine));
  }, 0);
  return Math.max(minimum, lineCount * 15);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(typeof value === "string" ? value.replace(/[₹,\s]/g, "") : value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value: number): number {
  // Match Excel's ROUND-to-cents behavior at decimal half-points (for example,
  // 0.25 × 4,211.70 = 1,052.925 must display as 1,052.93).
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function enabled(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function parseRows(value: unknown): ExportRow[] {
  if (Array.isArray(value)) return value as ExportRow[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as ExportRow[] : [];
    } catch { return []; }
  }
  return [];
}

function itemCode(item: MultiRANSItemExportData): string {
  return text(item.itemCode ?? item.code);
}

function itemSettings(item: MultiRANSItemExportData): Record<string, unknown> {
  let parsed: Record<string, unknown> = {};
  if (typeof item.settings_json === "string") {
    try {
      const value: unknown = JSON.parse(item.settings_json);
      parsed = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch { parsed = {}; }
  }
  return {
    ...parsed,
    ...(item.settings || {}),
    ...(item.nsrSettings || {}),
    ...item,
  };
}

function rawItemRows(item: MultiRANSItemExportData): ExportRow[] {
  return parseRows(item.analysisRows ?? item.rows);
}

function rowKind(row: ExportRow): string {
  return text(row.type ?? row.row_type).toUpperCase();
}

function rowCode(row: ExportRow): string {
  return text(row.code ?? row.component_code ?? row.sub_analysis_code);
}

function rowMark(row: ExportRow): string {
  return text(row.mark ?? row.calc_mark ?? row.reference_mark).toUpperCase();
}

function isCostRow(row: ExportRow): boolean {
  return rowKind(row) === "CR";
}

function isFinancialRow(row: ExportRow): boolean {
  return Boolean(
    row.isTotal || row.is_total || row.isUnitRate || row.is_unit_rate || row.isSayRow || row.is_say_row ||
    (row.percentage !== null && row.percentage !== undefined && (row.dependentMark || row.dependent_mark)) ||
    ["W", "X", "Y", "Z"].includes(rowMark(row)),
  );
}

function isExternal(item: MultiRANSItemExportData): boolean {
  return enabled(item.isExternalAR ?? item.is_external_ar);
}

function isParent(item: MultiRANSItemExportData): boolean {
  const settings = itemSettings(item);
  return enabled(item.isParentHeading ?? item.is_parent_heading ?? settings.isParentHeading);
}

function parseLegacyChargeMetadata(row: ExportRow): { percentage: number; dependentMark: string; excludeA: boolean } | null {
  // Persisted CALC_SNAPSHOT rows predate the structured fields. For those only, recover
  // metadata from the app-generated arithmetic label (not from arbitrary note text).
  const description = text(row.description);
  const hasChargeLabel = /\b(?:ADD|WATER CHARGES|CPOH|CESS|GST)\b/i.test(description);
  const hasPercentOfLabel = /^\s*\d+(?:\.\d+)?\s*%\s+of\s+[A-Z]\b/i.test(description);
  if (!hasChargeLabel && !hasPercentOfLabel) return null;

  const factorMatch = description.match(/multiplying\s+factor\s+(\d+(?:\.\d+)?)/i);
  const percentMatch = description.match(/(\d+(?:\.\d+)?)\s*%/i);
  const percentage = factorMatch ? Number(factorMatch[1]) * 100 : percentMatch ? Number(percentMatch[1]) : null;
  const dependencyMatch = description.match(/\b(?:ON|OF)\s*["“']?\(?\s*([WXYZP])\s*(?:[-–]\s*A)?/i);
  const dependencyMark = text(row.dependentMark ?? row.dependent_mark ?? dependencyMatch?.[1]).toUpperCase();
  if (percentage === null || !Number.isFinite(percentage)) return null;
  return {
    percentage,
    dependentMark: dependencyMark,
    excludeA: Boolean(row.excludeAMarkedItems ?? row.exclude_a_marked_items) || /[-–]\s*A\b/i.test(description),
  };
}

function resolveBaseQuantity(item: MultiRANSItemExportData, rows: ExportRow[]): number | null {
  const settings = itemSettings(item);
  const explicit = numberOrNull(item.baseQty ?? item.base_qty ?? settings.baseQty ?? settings.base_qty);
  if (explicit !== null && explicit > 0) return explicit;
  const detailsHeader = rows.map(row => text(row.description)).find(description => /^\s*details\s+of\s+cost\s+(?:for|of)\s+\d+(?:\.\d+)?/i.test(description));
  const detailsQuantity = detailsHeader?.match(/^\s*details\s+of\s+cost\s+(?:for|of)\s+(\d+(?:\.\d+)?)\s*([\w²³]+)/i);
  if (detailsQuantity) {
    const amount = Number(detailsQuantity[1]);
    const sourceUnit = detailsQuantity[2].toLowerCase();
    const targetUnit = text(item.unit).toLowerCase();
    const massUnits: Record<string, number> = { g: 0.001, kg: 1, quintal: 100, qtl: 100, tonne: 1000, ton: 1000 };
    const lengthUnits: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, metre: 1, meter: 1 };
    if (Number.isFinite(amount) && amount > 0) {
      if (sourceUnit === targetUnit) return amount;
      if (sourceUnit in massUnits && targetUnit in massUnits) return amount * massUnits[sourceUnit] / massUnits[targetUnit];
      if (sourceUnit in lengthUnits && targetUnit in lengthUnits) return amount * lengthUnits[sourceUnit] / lengthUnits[targetUnit];
    }
  }
  const unitRateRow = rows.find(row => row.isUnitRate === true || row.is_unit_rate === true);
  const rowBase = numberOrNull(unitRateRow?.baseQty ?? unitRateRow?.base_qty);
  if (rowBase !== null && rowBase > 0) return rowBase;

  // Older snapshots often kept the denominator in the generated “Cost of X unit” row.
  const targetUnit = text(item.unit).toLowerCase();
  const costDescriptions = rows.map(row => text(row.description));
  const bulkCostDescription = costDescriptions.find(description => {
    const match = description.match(/^\s*cost\s+of\s+(\d+(?:\.\d+)?)\s+([\w²³]+)/i);
    return Boolean(match && Number(match[1]) > 0 && Number(match[1]) !== 1 && match[2].toLowerCase() === targetUnit);
  });
  if (bulkCostDescription) {
    const match = bulkCostDescription.match(/^\s*cost\s+of\s+(\d+(?:\.\d+)?)\s+([\w²³]+)/i);
    if (match) {
      const amount = Number(match[1]);
      if (amount > 0 && amount !== 1) return amount;
    }
  }

  // If the Cost of X row was lost and only a duplicated “Cost of 1 unit” remains,
  // parse the physical build-up note’s parenthesized quantity and convert its unit.
  const conversionToKg: Record<string, number> = { g: 0.001, kg: 1, quintal: 100, qtl: 100, tonne: 1000, ton: 1000 };
  const conversionToM: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, metre: 1, meter: 1 };
  const note = rows.map(row => text(row.description)).find(description => /\bdetails\b/i.test(description) && /\(\s*\d+(?:\.\d+)?\s*[a-z]/i.test(description));
  const quantityMatch = note?.match(/\((\d+(?:\.\d+)?)\s*([a-z²³]+)/i);
  if (quantityMatch) {
    const amount = Number(quantityMatch[1]);
    const sourceUnit = quantityMatch[2].toLowerCase();
    if (targetUnit in conversionToKg && sourceUnit in conversionToKg) {
      const converted = amount * conversionToKg[sourceUnit] / conversionToKg[targetUnit];
      if (converted > 0) return converted;
    }
    if (targetUnit in conversionToM && sourceUnit in conversionToM) {
      const converted = amount * conversionToM[sourceUnit] / conversionToM[targetUnit];
      if (converted > 0) return converted;
    }
    if (sourceUnit === targetUnit && amount > 0) return amount;
  }

  const oneUnitDescription = costDescriptions.find(description => {
    const match = description.match(/^\s*cost\s+of\s+(\d+(?:\.\d+)?)\s+([\w²³]+)/i);
    return Boolean(match && Number(match[1]) === 1 && match[2].toLowerCase() === targetUnit);
  });
  if (oneUnitDescription) return 1;

  const total = rows.find(row => row.isTotal === true && !rowMark(row));
  const totalAmount = numberOrNull(total?.amount);
  const rate = numberOrNull(item.rate);
  if (totalAmount !== null && rate !== null && rate > 0) {
    const derived = totalAmount / rate;
    if (derived > 0 && Number.isFinite(derived)) return Math.round(derived * 1_000_000) / 1_000_000;
  }
  return null;
}

/** Shared DSR/Market base-quantity resolver for analyses exported outside this builder. */
export function resolveAnalysisBaseQuantity(item: MultiRANSItemExportData, rows: any[]): number | null {
  return resolveBaseQuantity(item, rows as ExportRow[]);
}

/**
 * Normalize legacy CALC_SNAPSHOT rows into the explicit calculation properties emitted by
 * current CreateNSR. New data's flags always take precedence. Legacy classification uses row
 * kind, marks, saved method/settings and terminal row order; formula generation never parses
 * the display description.
 */
function normalizeAnalysisRows(item: MultiRANSItemExportData): ExportRow[] {
  const rows = rawItemRows(item).map(source => ({ ...source }));
  const calculationRows = rows.filter(row => ["CALC_SNAPSHOT", "NCR", "NOTE", "SCR"].includes(rowKind(row)));
  if (!calculationRows.length) return rows;

  // Promote only recognized calculation rows. A physical NCR subtotal remains a note,
  // even when its display text contains the word “Total”.
  let activeMark = "";
  let chargesOnActiveMark = 0;
  const amountByMark: Record<string, number> = {};
  const markedAAmounts: number[] = [];
  const precedingChargesByMark: Record<string, number[]> = {};
  for (const row of rows) {
    const label = text(row.description);
    const mark = rowMark(row);
    // SCR rows from saved analyses may only retain their rule as display text
    // (for example, "100% of P"). Normalize that legacy row into the same
    // structured fields used by current NSR calculations, then formulas below
    // depend on percentage/dependentMark rather than label matching.
    if (rowKind(row) === "SCR" && numberOrNull(row.percentage) === null && !(row.dependentMark || row.dependent_mark)) {
      const specialRule = label.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of|on)\s*[\"'“‘]?([A-Za-z])\b/i);
      if (specialRule) {
        row.percentage = Number(specialRule[1]);
        row.dependentMark = specialRule[2].toUpperCase();
      }
    }
    // Legacy database analyses store the priced bulk build-up and the
    // converted one-unit rate as unmarked NCR/CALC_SNAPSHOT rows. Classify
    // those explicit cost rows so the formula engine can link the actual bulk
    // total to the unit-rate row instead of summing adjacent display rows.
    if (!mark && !row.isTotal && !row.is_total && !row.isUnitRate && !row.is_unit_rate &&
        ["NCR", "NOTE", "CALC_SNAPSHOT"].includes(rowKind(row))) {
      const costQuantity = label.match(/^\s*cost\s+(?:of|for)\s+(\d+(?:\.\d+)?)(?:\s|$)/i);
      if (costQuantity) {
        const quantity = Number(costQuantity[1]);
        if (Number.isFinite(quantity) && quantity > 1) {
          row.isTotal = true;
          row.type = "TOTAL";
        } else if (Number.isFinite(quantity) && quantity === 1) {
          row.isUnitRate = true;
          row.type = "UNIT_RATE";
        }
      }
    }
    if (!row.isTotal && !row.is_total && (["W", "X", "Y", "Z"].includes(mark) || /^\s*TOTAL\s+[WXYZ](?:\s|[-(]|$)/i.test(label))) {
      row.isTotal = true;
      row.type = "TOTAL";
    }
    if (row.isTotal || row.is_total) {
      if (["W", "X", "Y", "Z"].includes(mark)) {
        activeMark = mark;
        chargesOnActiveMark = 0;
        amountByMark[mark] = numberOrNull(row.amount) ?? 0;
        precedingChargesByMark[mark] = [];
      }
      continue;
    }
    if (!(row.percentage !== null && row.percentage !== undefined && (row.dependentMark || row.dependent_mark))) {
      const charge = parseLegacyChargeMetadata(row);
      if (charge) {
        row.percentage ??= charge.percentage;
        row.dependentMark ??= charge.dependentMark || activeMark;
        if (!charge.dependentMark && activeMark) row.useRunningBase ??= chargesOnActiveMark > 0;
        const dependency = text(row.dependentMark).toUpperCase();
        const hasSavedExclusion = typeof row.excludeAMarkedItems === "boolean" || typeof row.exclude_a_marked_items === "boolean";
        if (charge.excludeA) row.excludeAMarkedItems = true;

        // Old CALC_SNAPSHOT rows did not persist the A-exclusion flag. Recover it
        // from their saved computed amount, using the actual marked-A component rows.
        // This makes legacy 51.10 match its saved calculation without an item-specific rule.
        const savedAmount = numberOrNull(row.amount);
        if (!hasSavedExclusion && !charge.excludeA && dependency && savedAmount !== null) {
          const priorCharges = row.useRunningBase ? (precedingChargesByMark[dependency] || []) : [];
          const base = (amountByMark[dependency] ?? 0) + priorCharges.reduce((sum, amount) => sum + amount, 0);
          const markedA = markedAAmounts.reduce((sum, amount) => sum + amount, 0);
          const inclusiveAmount = Number((base * charge.percentage / 100).toFixed(2));
          const excludingAAmount = Number((Math.max(0, base - markedA) * charge.percentage / 100).toFixed(2));
          if (Math.abs(savedAmount - excludingAAmount) + 0.005 < Math.abs(savedAmount - inclusiveAmount)) {
            row.excludeAMarkedItems = true;
          }
        }
        if (dependency && savedAmount !== null) (precedingChargesByMark[dependency] ||= []).push(savedAmount);
        if (row.dependentMark) chargesOnActiveMark++;
      }
    }
    if (rowKind(row) === "CR" && mark === "A") {
      const amount = numberOrNull(row.amount);
      if (amount !== null) markedAAmounts.push(Number(amount.toFixed(2)));
    }
  }

  // Legacy DSR/NSR records often store the Say label as an NCR with no saved
  // amount. Treat the exact terminal label as structural metadata so it gets
  // a live formula and never remains a blank note row.
  const sayIndex = rows.findIndex(row => /^\s*say(?:\b|$)/i.test(text(row.description)));
  if (sayIndex >= 0) {
    rows[sayIndex].isSayRow = true;
    rows[sayIndex].type = "SAY";
    if (!rows.some(row => row.isUnitRate || row.is_unit_rate)) {
      const unitRateIndex = rows.slice(0, sayIndex).map((row, index) => ({ row, index })).reverse()
        .find(({ row }) => /^\s*cost\s+(?:of|for)\s+1(?:\.0+)?\b/i.test(text(row.description)))?.index;
      if (unitRateIndex !== undefined) {
        rows[unitRateIndex].isUnitRate = true;
        rows[unitRateIndex].type = "UNIT_RATE";
      } else {
        const baseQty = resolveBaseQuantity(item, rows) ?? 1;
        rows.splice(sayIndex, 0, {
          row_type: "CALC_SNAPSHOT",
          type: "UNIT_RATE",
          isUnitRate: true,
          baseQty,
          description: `Cost of 1.00 ${text(item.unit) || "unit"}`,
          unit: "",
          quantity: null,
          rate: null,
          amount: null,
        });
      }
    }
  }

  // Older snapshots do not carry terminal flags; infer these only from the stable final
  // rows emitted by CreateNSR. New flags are always preserved as the source of truth.
  const explicitTerminalFlags = calculationRows.some(row => row.isSayRow || row.is_say_row || row.isUnitRate || row.is_unit_rate);
  const lastRecord = rows[rows.length - 1];
  if (!explicitTerminalFlags && lastRecord && !rowMark(lastRecord) && numberOrNull(lastRecord.amount) !== null &&
      ["NCR", "NOTE", "CALC_SNAPSHOT"].includes(rowKind(lastRecord))) {
    lastRecord.isSayRow = true;
    lastRecord.type = "SAY";
    const sayIndex = rows.length - 1;
    const unitRateIndex = rows.slice(0, sayIndex).map((row, index) => ({ row, index })).reverse()
      .find(({ row }) => !rowMark(row) && numberOrNull(row.amount) !== null && ["NCR", "NOTE", "CALC_SNAPSHOT"].includes(rowKind(row)))?.index;
    if (unitRateIndex !== undefined) {
      rows[unitRateIndex].isUnitRate = true;
      rows[unitRateIndex].type = "UNIT_RATE";
      const totalIndex = rows.slice(0, unitRateIndex).map((row, index) => ({ row, index })).reverse()
        .find(({ row }) => !rowMark(row) && numberOrNull(row.amount) !== null && ["NCR", "NOTE", "CALC_SNAPSHOT"].includes(rowKind(row)))?.index;
      if (totalIndex !== undefined) {
        rows[totalIndex].isTotal = true;
        rows[totalIndex].type = "TOTAL";
      }
    }
  }

  const baseQty = resolveBaseQuantity(item, rows);
  if (baseQty !== null && baseQty > 0) {
    for (const row of rows) {
      if (row.isUnitRate || row.is_unit_rate) row.baseQty = baseQty;
      if ((row.isTotal || row.is_total) && !rowMark(row) && /^\s*cost\s+of\s+1(?:\.0+)?\b/i.test(text(row.description)) && baseQty > 1) {
        row.description = `Cost of ${baseQty.toFixed(2)} ${text(item.unit)}`;
      }
    }
  }
  return rows;
}

function makeBlocks(items: MultiRANSItemExportData[]): ItemBlock[] {
  return (Array.isArray(items) ? items : []).map(item => {
    const rows = normalizeAnalysisRows(item);
    const external = isExternal(item);
    return {
      item,
      code: itemCode(item),
      itemNo: text(item.itemNo ?? item.item_no ?? item.slNo ?? itemCode(item)),
      description: firstText(item.itemDescription, item.description, item.item_description),
      unit: text(item.unit),
      baseQty: resolveBaseQuantity(item, rows),
      rows,
      external,
    };
  }).filter(block => {
    if (block.external) return Boolean(block.code || block.description);
    if (isParent(block.item)) return false;
    // A heading with only NCR/physical-description rows is not an independent rate analysis.
    return block.rows.some(isCostRow) && Boolean(block.code || block.description);
  });
}

function referencedCodes(blocks: ItemBlock[]): string[] {
  const codes = new Set<string>();
  for (const block of blocks) {
    for (const row of block.rows) {
      if (!isCostRow(row)) continue;
      const code = rowCode(row);
      if (code && (enabled(row.isSubAR ?? row.is_sub_ar) || code.includes("."))) codes.add(code);
    }
  }
  return [...codes];
}

/** Load real referenced DSR/Sub-AR breakdowns from the app API, recursively and without fabricating missing rows. */
async function loadSubARBlocks(
  rootBlocks: ItemBlock[],
  sourceItems: MultiRANSItemExportData[] = [],
): Promise<ItemBlock[]> {
  const sourceByCode = new Map(sourceItems.map(item => [itemCode(item).toLowerCase(), item]));
  const pending = referencedCodes(rootBlocks);
  const visited = new Set<string>();
  const result: ItemBlock[] = [];
  while (pending.length) {
    const code = pending.shift()!;
    const key = code.toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);
    const source = sourceByCode.get(key);
    let analysisRows = rawItemRows(source || {});
    if (!analysisRows.length) {
      try {
        const response = await fetch(`/api/rate-analysis?code=${encodeURIComponent(code)}`);
        if (response.ok) analysisRows = parseRows(await response.json());
      } catch (error) {
        console.warn(`Could not fetch supporting analysis for Sub-AR ${code}:`, error);
      }
    }
    if (!analysisRows.length) continue;

    const firstReference = rootBlocks.flatMap(block => block.rows).find(row => rowCode(row).toLowerCase() === key);
    const item: MultiRANSItemExportData = {
      ...(source || {}),
      itemCode: code,
      itemNo: source?.itemNo ?? source?.item_no ?? code,
      description: firstText(
        source?.description,
        source?.itemDescription,
        source?.item_description,
        firstReference?.description,
      ) || `Rate analysis for ${code}`,
      unit: source?.unit ?? firstReference?.unit ?? "",
      baseQty: source?.baseQty ?? source?.base_qty,
      analysisRows,
    };
    const block: ItemBlock = {
      item,
      code,
      itemNo: text(item.itemNo),
      description: text(item.description),
      unit: text(item.unit),
      baseQty: resolveBaseQuantity(item, analysisRows),
      rows: normalizeAnalysisRows(item),
      external: false,
    };
    // Sub-ARs sheet contains only genuine supporting analyses.
    if (!block.rows.some(isCostRow)) continue;
    result.push(block);
    for (const nested of referencedCodes([block])) if (!visited.has(nested.toLowerCase())) pending.push(nested);
  }
  // Supporting analyses are presented in DSR code order, independent of the
  // order in which parent analyses happened to reference them.
  const compareDsrCodes = (left: string, right: string) => {
    const leftParts = left.split(".");
    const rightParts = right.split(".");
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
      if (leftParts[index] === undefined) return -1;
      if (rightParts[index] === undefined) return 1;
      const leftNumber = Number(leftParts[index]);
      const rightNumber = Number(rightParts[index]);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      const textOrder = leftParts[index].localeCompare(rightParts[index], undefined, { numeric: true, sensitivity: "base" });
      if (textOrder) return textOrder;
    }
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  };
  return result.sort((a, b) => compareDsrCodes(a.code, b.code));
}

/** Prepare normalized primary and supporting rows for the matching PDF export. */
export async function prepareMultiRANSItemsForPdf(
  items: MultiRANSItemExportData[],
  supportingItems: MultiRANSItemExportData[] = [],
  family: "NS" | "mDSR" = "NS",
): Promise<{ mainItems: MultiRANSItemExportData[]; supportingItems: MultiRANSItemExportData[] }> {
  const familyPrefix = family === "mDSR" ? "50" : "51";
  const roots = makeBlocks(items).filter(block => block.code === familyPrefix || block.code.startsWith(`${familyPrefix}.`));
  const blocks = await loadSubARBlocks(roots, supportingItems);
  const asExportItem = (block: ItemBlock): MultiRANSItemExportData => ({
    ...block.item,
    itemCode: block.code,
    itemNo: block.itemNo,
    description: block.description,
    itemDescription: block.description,
    unit: block.unit,
    baseQty: block.baseQty ?? undefined,
    analysisRows: block.rows,
  });
  return {
    mainItems: roots.map(asExportItem),
    supportingItems: blocks.map(asExportItem),
  };
}

function formulaSum(rows: number[]): string | null {
  const uniqueRows = [...new Set(rows)].filter(Number.isFinite);
  return uniqueRows.length ? `SUM(${uniqueRows.map(row => `F${row}`).join(",")})` : null;
}

function resolveComponentDivisor(row: ExportRow): number {
  const explicit = numberOrNull(row.componentDivisor ?? row.component_divisor ?? row.bulkDivisor ?? row.bulk_divisor);
  if (explicit !== null && explicit > 0) return explicit;
  const unitMatch = text(row.unit).match(/^\s*(\d+(?:\.\d+)?)/);
  const unitDivisor = unitMatch ? Number(unitMatch[1]) : 1;
  if (unitDivisor <= 1) return 1;

  // Some DSR rows already express quantity in the stated bulk unit (e.g. 3.8 × rate
  // for 3.8 lots of 10 cudm). Respect that persisted source convention when its amount
  // proves the D×E calculation; otherwise treat the prefix as a rate denominator.
  const quantity = numberOrNull(row.quantity);
  const rate = numberOrNull(row.rate);
  const amount = numberOrNull(row.amount);
  if (quantity !== null && rate !== null && amount !== null) {
    const direct = quantity * rate;
    const divided = direct / unitDivisor;
    if (Math.abs(direct - amount) < 0.011) return 1;
    if (Math.abs(divided - amount) < 0.011) return unitDivisor;
  }
  return unitDivisor;
}

function borderForRow(financialBlockStart = false, financialBlockEnd = false) {
  // The template has a top/bottom boundary around the whole financial block, no
  // inner horizontal rules, and continuous vertical dividers through each row.
  return {
    ...(financialBlockStart ? { top: THIN } : {}),
    ...(financialBlockEnd ? { bottom: THIN } : {}),
    left: THIN,
    right: THIN,
  } as ExcelJS.Borders;
}

function styleCalculationRow(
  row: ExcelJS.Row,
  sayAmount = false,
  financialBlockStart = false,
  financialBlockEnd = false,
) {
  for (let c = 1; c <= 7; c++) {
    const cell = row.getCell(c);
    cell.font = { ...FONT, ...(sayAmount && c === 6 ? { bold: true } : {}) };
    cell.alignment = {
      horizontal: c === 2 ? "left" : [4, 5, 6].includes(c) ? "right" : "center",
      vertical: "middle",
      ...(c === 2 ? { wrapText: true } : {}),
    };
    cell.border = borderForRow(financialBlockStart, financialBlockEnd);
  }
  row.getCell(4).numFmt = MIN_TWO_DECIMAL_FORMAT;
  row.getCell(5).numFmt = MIN_TWO_DECIMAL_FORMAT;
  row.getCell(6).numFmt = INDIAN_AMOUNT_FORMAT;
  if (sayAmount) {
    row.getCell(6).border = { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM };
  }
  const desc = text(row.getCell(2).value);
  row.height = desc ? Math.max(18, Math.ceil(desc.length / 46) * 15) : 18;
}

type RenderMaps = {
  itemHeaderRows: Record<string, number>;
  itemHeaderCodeCells: Record<string, ExcelJS.Cell>;
  subARReferrerRows: Record<string, number>;
  sayRows: Record<string, number>;
  sayRates: Record<string, number>;
  hyperlinkCells: Array<{ cell: ExcelJS.Cell; code: string }>;
  rateLinkCells: Array<{ cell: ExcelJS.Cell; code: string }>;
};

function addBlock(
  worksheet: ExcelJS.Worksheet,
  block: ItemBlock,
  currentRow: number,
  maps: RenderMaps,
  options: { subAnalysis: boolean; mainSheetName: string },
): number {
  const { code, itemNo, description, rows, item } = block;
  const itemNoRow = worksheet.getRow(currentRow++);
  itemNoRow.getCell(1).value = "Item No.";
  itemNoRow.getCell(2).value = itemNo;
  worksheet.mergeCells(itemNoRow.number, 2, itemNoRow.number, 7);
  itemNoRow.height = 22;
  for (let col = 1; col <= 7; col++) {
    const cell = itemNoRow.getCell(col);
    cell.font = { ...FONT, size: 12, bold: true };
    cell.border = { top: THIN, bottom: THIN, ...(col === 1 ? { left: THIN } : {}), ...(col === 7 ? { right: THIN } : {}) };
    cell.alignment = { horizontal: col === 1 ? "center" : "left", vertical: "middle" };
  }
  if (code) maps.itemHeaderRows[`${options.subAnalysis ? "sub" : "main"}:${code.toLowerCase()}`] = itemNoRow.number;

  const descriptionRow = worksheet.getRow(currentRow++);
  descriptionRow.getCell(1).value = code || null;
  descriptionRow.getCell(1).font = { ...FONT };
  descriptionRow.getCell(1).alignment = { horizontal: "center", vertical: "top", wrapText: true };
  descriptionRow.getCell(1).border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  descriptionRow.getCell(2).value = description;
  worksheet.mergeCells(descriptionRow.number, 2, descriptionRow.number, 7);
  descriptionRow.getCell(2).font = { ...FONT };
  descriptionRow.getCell(2).alignment = { horizontal: "justify", vertical: "top", wrapText: true };
  for (let col = 2; col <= 7; col++) {
    descriptionRow.getCell(col).border = { top: THIN, bottom: THIN, ...(col === 7 ? { right: THIN } : {}) };
  }
  descriptionRow.height = wrappedDescriptionHeight(description);
  if (options.subAnalysis && code) {
    maps.itemHeaderCodeCells[`sub:${code.toLowerCase()}`] = descriptionRow.getCell(1);
  }

  if (block.external) {
    const messageRow = worksheet.getRow(currentRow++);
    messageRow.getCell(1).value = null;
    messageRow.getCell(2).value = EXTERNAL_AR_MESSAGE;
    worksheet.mergeCells(messageRow.number, 2, messageRow.number, 7);
    messageRow.getCell(2).font = { ...FONT, italic: true };
    messageRow.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    for (let c = 1; c <= 7; c++) messageRow.getCell(c).border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
    messageRow.height = wrappedDescriptionHeight(EXTERNAL_AR_MESSAGE, 85, 30);
    return currentRow + 1;
  }

  const headerRow = worksheet.getRow(currentRow++);
  ["Code", "Description", "Unit", "Quantity", "Rate Rs.", "Amount Rs.", "Mark"].forEach((label, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    cell.font = { ...FONT, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  });
  headerRow.height = 22;

  const markRows: Record<string, number> = {};
  const markValues: Record<string, number> = {};
  const chargeRowsByMark: Record<string, number[]> = {};
  const markedARows: number[] = [];
  const amountValuesByRow: Record<number, number> = {};
  let pendingAmountRows: number[] = [];
  let finalTotalRow = 0;
  let finalTotalValue: number | null = null;
  let finalUnitRateRow = 0;
  let finalUnitRateValue: number | null = null;
  let financialBlockStarted = false;
  const itemSettingsResolved = itemSettings(item);
  const excludeAByDefault = enabled(itemSettingsResolved.excludeAMarkedItems ?? itemSettingsResolved.exclude_a_marked_items);

  const isDuplicateOneUnitTotal = (row: ExportRow, index: number): boolean => {
    if (!(row.isTotal === true || row.is_total === true) || rowMark(row)) return false;
    const nextUnitRate = rows.slice(index + 1).find(candidate =>
      candidate.isUnitRate === true || candidate.is_unit_rate === true,
    );
    if (!nextUnitRate) return false;
    const baseQty = numberOrNull(
      nextUnitRate.baseQty ?? nextUnitRate.base_qty ?? item.baseQty ?? item.base_qty ?? itemSettingsResolved.baseQty,
    );
    const totalAmount = numberOrNull(row.amount);
    const unitAmount = numberOrNull(nextUnitRate.amount);
    return baseQty === 1 && totalAmount !== null && unitAmount !== null && Math.abs(totalAmount - unitAmount) < 0.005;
  };

  for (let analysisIndex = 0; analysisIndex < rows.length; analysisIndex++) {
    const sourceRow = rows[analysisIndex];
    // Older saved analyses can contain both an unmarked one-unit total and a
    // separate unit-rate row. In that case, the total is redundant; omit it.
    if (isDuplicateOneUnitTotal(sourceRow, analysisIndex)) continue;
    const row = sourceRow;
    const kind = rowKind(row);
    const isNCR = (kind === "NCR" || kind === "NOTE" || row.isNote === true) && !isFinancialRow(row);
    const codeValue = rowCode(row);
    const mark = rowMark(row);
    const dataRow = worksheet.getRow(currentRow++);
    dataRow.getCell(1).value = codeValue || null;
    dataRow.getCell(2).value = text(row.description);
    dataRow.getCell(3).value = text(row.unit) || null;
    dataRow.getCell(4).value = isNCR ? null : numberOrNull(row.quantity);
    dataRow.getCell(5).value = isNCR ? null : numberOrNull(row.rate);
    dataRow.getCell(6).value = isNCR ? null : numberOrNull(row.amount);
    dataRow.getCell(7).value = mark || null;
    if (mark) markRows[mark] = dataRow.number;
    if (mark === "A" && !isNCR) markedARows.push(dataRow.number);

    const dependentMark = text(row.dependentMark ?? row.dependent_mark).toUpperCase();
    const percentage = numberOrNull(row.percentage);
    // Older DSR records do not persist these flags in the database. The
    // normalizer sets them from the explicit terminal analysis rows before
    // this renderer runs; keep a narrow fallback for raw legacy rows too.
    const isTotal = row.isTotal === true || row.is_total === true ||
      (kind === "NCR" && /^[WXYZ]$/.test(mark));
    const isUnitRate = row.isUnitRate === true || row.is_unit_rate === true ||
      (kind === "NCR" && /^COST\s+(?:OF|FOR)\s+1(?:\.0+)?(?:\s|$)/i.test(text(row.description)));
    const isSay = row.isSayRow === true || row.is_say_row === true ||
      (kind === "NCR" && /^SAY\s*$/i.test(text(row.description)));
    // Component rows calculate from their own displayed inputs, with any bulk-unit divisor
    // kept separate from the item's overall base quantity divisor.
    if (!isNCR && kind === "CR" && numberOrNull(row.quantity) !== null && numberOrNull(row.rate) !== null) {
      const divisor = resolveComponentDivisor(row);
      const formula = divisor === 1
        ? `ROUND(D${dataRow.number}*E${dataRow.number},2)`
        : `ROUND((D${dataRow.number}*E${dataRow.number})/${divisor},2)`;
      const subARRate = codeValue.includes(".") ? maps.sayRates[`sub:${codeValue.toLowerCase()}`] : undefined;
      const effectiveRate = subARRate ?? numberOrNull(row.rate) ?? 0;
      const calculatedAmount = roundMoney((numberOrNull(row.quantity) ?? 0) * effectiveRate / divisor);
      dataRow.getCell(6).value = { formula, result: calculatedAmount };
      amountValuesByRow[dataRow.number] = calculatedAmount;
      if (mark) markValues[mark] = calculatedAmount;
      pendingAmountRows.push(dataRow.number);
    } else if (percentage !== null && dependentMark && markRows[dependentMark]) {
      const dependencyRow = markRows[dependentMark];
      const excludesA = enabled(row.excludeAMarkedItems ?? row.exclude_a_marked_items ?? excludeAByDefault);
      const excludeRows = excludesA ? markedARows.filter(markedRow => markedRow < dataRow.number) : [];
      const priorCharges = row.useRunningBase ? (chargeRowsByMark[dependentMark] || []) : [];
      const baseParts = [`F${dependencyRow}`, ...priorCharges.map(r => `F${r}`)];
      const baseSum = baseParts.length > 1 ? `SUM(${baseParts.join(",")})` : baseParts[0];
      const baseWithoutA = excludeRows.length ? `(${baseSum}-SUM(${excludeRows.map(r => `F${r}`).join(",")}))` : baseSum;
      const baseFormula = excludeRows.length ? `MAX(0,${baseWithoutA})` : baseSum;
      const baseValue = (markValues[dependentMark] ?? 0) + priorCharges.reduce((sum, rowNum) => sum + (amountValuesByRow[rowNum] ?? 0), 0);
      const excludedAValue = excludeRows.reduce((sum, rowNum) => sum + (amountValuesByRow[rowNum] ?? 0), 0);
      const calculatedAmount = roundMoney(Math.max(0, baseValue - excludedAValue) * (percentage / 100));
      dataRow.getCell(6).value = {
        formula: `ROUND(${baseFormula}*(${percentage}/100),2)`,
        result: calculatedAmount,
      };
      amountValuesByRow[dataRow.number] = calculatedAmount;
      pendingAmountRows.push(dataRow.number);
      if (!chargeRowsByMark[dependentMark]) chargeRowsByMark[dependentMark] = [];
      chargeRowsByMark[dependentMark].push(dataRow.number);
    } else if (isTotal) {
      const sum = formulaSum(pendingAmountRows);
      const calculatedTotal = roundMoney(pendingAmountRows.reduce((total, rowNum) => total + (amountValuesByRow[rowNum] ?? 0), 0));
      if (sum) dataRow.getCell(6).value = { formula: `ROUND(${sum},2)`, result: calculatedTotal };
      amountValuesByRow[dataRow.number] = calculatedTotal;
      dataRow.getCell(6).font = { ...FONT, bold: true };
      pendingAmountRows = [dataRow.number];
      if (mark) {
        markRows[mark] = dataRow.number;
        markValues[mark] = calculatedTotal;
        chargeRowsByMark[mark] = [];
      }
      // The final unmarked total preceding unit-rate/SAY is the total cost of the item's base quantity.
      if (!mark) {
        finalTotalRow = dataRow.number;
        finalTotalValue = calculatedTotal;
      }
    } else if (isUnitRate) {
      const baseQty = numberOrNull(row.baseQty ?? row.base_qty ?? item.baseQty ?? item.base_qty ?? itemSettingsResolved.baseQty) ?? block.baseQty;
      // pendingAmountRows contains the current financial subtotal plus only
      // eligible charges/components since that subtotal; summing this explicit
      // row list avoids pulling in NCR text and physical quantity subtotals.
      const sourceTotalFormula = formulaSum(pendingAmountRows) ??
        (finalTotalRow ? `F${finalTotalRow}` : `F${dataRow.number - 1}`);
      if (baseQty !== null && baseQty > 0) {
        const pendingTotal = pendingAmountRows.reduce((total, rowNum) => total + (amountValuesByRow[rowNum] ?? 0), 0);
        const totalForUnitRate = pendingAmountRows.length ? pendingTotal : finalTotalValue ?? 0;
        const cachedUnitRate = roundMoney(totalForUnitRate / baseQty);
        finalUnitRateValue = cachedUnitRate;
        dataRow.getCell(6).value = {
          formula: `ROUND(${sourceTotalFormula.startsWith("SUM(") ? sourceTotalFormula : sourceTotalFormula}/${baseQty},2)`,
          result: cachedUnitRate,
        };
      } else {
        // Keep the stored amount if a legacy record has no reliable denominator.
        dataRow.getCell(6).value = numberOrNull(row.amount);
        finalUnitRateValue = numberOrNull(row.amount);
      }
      amountValuesByRow[dataRow.number] = finalUnitRateValue ?? 0;
      dataRow.getCell(6).font = { ...FONT, bold: true };
      finalUnitRateRow = dataRow.number;
    } else if (isSay) {
      const sourceRateRow = finalUnitRateRow || dataRow.number - 1;
      const sayResult = finalUnitRateValue === null
        ? numberOrNull(row.amount) ?? 0
        : roundMoney(Math.round((finalUnitRateValue + Number.EPSILON) / 0.05) * 0.05);
      dataRow.getCell(6).value = { formula: `MROUND(F${sourceRateRow},0.05)`, result: sayResult };
      // Column G is the unused Mark cell on the final Say row. Keep component
      // units in column C, and expose the analyzed item's unit here so the
      // Measurement Sheet can link its total-quantity row reliably.
      dataRow.getCell(7).value = block.unit || null;
      amountValuesByRow[dataRow.number] = sayResult;
      dataRow.getCell(6).font = { ...FONT, bold: true };
      if (code) {
        const key = `${options.subAnalysis ? "sub" : "main"}:${code.toLowerCase()}`;
        maps.sayRows[key] = dataRow.number;
        maps.sayRates[key] = sayResult;
      }
    }

    const financialBlockStart = mark === "W" && !financialBlockStarted;
    if (financialBlockStart) financialBlockStarted = true;
    styleCalculationRow(dataRow, isSay, financialBlockStart, isSay);
    if (isTotal || isUnitRate) dataRow.getCell(6).font = { ...FONT, bold: true };
    if (isSay) dataRow.getCell(6).font = { ...FONT, bold: true };

    // A true Sub-AR reference is identified by the backend flag, or by the DSR code shape
    // used by existing legacy NSR rows. Link only decimal item codes, never numeric resources.
    const isSubARReference = enabled(row.isSubAR ?? row.is_sub_ar) || (kind === "CR" && codeValue.includes("."));
    if (isSubARReference && codeValue) {
      maps.hyperlinkCells.push({ cell: dataRow.getCell(1), code: codeValue });
      maps.rateLinkCells.push({ cell: dataRow.getCell(5), code: codeValue });
      if (!options.subAnalysis && maps.subARReferrerRows[codeValue.toLowerCase()] === undefined) {
        maps.subARReferrerRows[codeValue.toLowerCase()] = maps.itemHeaderRows[`main:${code.toLowerCase()}`];
      }
    }
  }
  const unitLabel = block.unit || "unit";
  const resolvedBaseQty = block.baseQty && block.baseQty > 0 ? block.baseQty : 1;
  const terminalSource = formulaSum(pendingAmountRows) ?? (finalTotalRow ? `F${finalTotalRow}` : undefined);
  const terminalValue = pendingAmountRows.length
    ? roundMoney(pendingAmountRows.reduce((sum, rowNum) => sum + (amountValuesByRow[rowNum] ?? 0), 0))
    : finalTotalValue;

  // Some DSR database analyses stop after their financial charges, while
  // others save an empty Say NCR. Ensure both cases still get a calculated
  // unit rate and a populated, formula-backed terminal Say amount.
  if (!finalUnitRateRow && terminalSource) {
    const unitRateRow = worksheet.getRow(currentRow++);
    unitRateRow.getCell(2).value = `Cost of 1.00 ${unitLabel}`;
    unitRateRow.getCell(6).value = {
      formula: `ROUND((${terminalSource})/${resolvedBaseQty},2)`,
      result: roundMoney((terminalValue ?? 0) / resolvedBaseQty),
    };
    styleCalculationRow(unitRateRow);
    unitRateRow.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    unitRateRow.getCell(6).font = { ...FONT, bold: true };
    finalUnitRateRow = unitRateRow.number;
    finalUnitRateValue = roundMoney((terminalValue ?? 0) / resolvedBaseQty);
  }

  const sayKey = `${options.subAnalysis ? "sub" : "main"}:${code.toLowerCase()}`;
  if (!maps.sayRows[sayKey] && finalUnitRateRow) {
    const sayRow = worksheet.getRow(currentRow++);
    sayRow.getCell(2).value = "Say";
    sayRow.getCell(6).value = {
      formula: `MROUND(F${finalUnitRateRow},0.05)`,
      result: roundMoney(Math.round(((finalUnitRateValue ?? 0) + Number.EPSILON) / 0.05) * 0.05),
    };
    sayRow.getCell(7).value = unitLabel;
    styleCalculationRow(sayRow, true, false, true);
    sayRow.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    sayRow.getCell(6).font = { ...FONT, bold: true };
    maps.sayRows[sayKey] = sayRow.number;
    maps.sayRates[sayKey] = roundMoney(Math.round(((finalUnitRateValue ?? 0) + Number.EPSILON) / 0.05) * 0.05);
  }
  return currentRow + 1;
}

function createWorksheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: "normal", style: "pageBreakPreview", zoomScale: 90, showGridLines: false }],
  });
  worksheet.pageSetup.orientation = "portrait";
  worksheet.pageSetup.paperSize = 9;
  worksheet.pageSetup.scale = 90;
  worksheet.pageSetup.fitToPage = false;
  worksheet.pageSetup.margins = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.2, footer: 0.2 };
  worksheet.columns = COLUMNS.map((column, index) => ({
    ...column,
    style: {
      font: { ...FONT },
      alignment: {
        horizontal: index === 1 ? "left" : [3, 4, 5].includes(index) ? "right" : "center",
        vertical: "middle",
        ...(index === 1 ? { wrapText: true } : {}),
      },
      ...(index === 3 || index === 4 ? { numFmt: MIN_TWO_DECIMAL_FORMAT } : index === 5 ? { numFmt: INDIAN_AMOUNT_FORMAT } : {}),
    },
  }));
  return worksheet;
}

function addSheetTitle(worksheet: ExcelJS.Worksheet, titleText: string) {
  worksheet.mergeCells("A2:G2");
  const title = worksheet.getCell("A2");
  title.value = titleText;
  title.font = { ...FONT, size: 12, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(2).height = 22;
}

function resolveHyperlinks(
  maps: RenderMaps,
  subSheetName: string,
  mainSheetName: string,
) {
  const setInternalLink = (cell: ExcelJS.Cell, sheetName: string, address: string, displayText: string) => {
    const quotedSheet = sheetName.replace(/'/g, "''");
    const safeDisplayText = displayText.replace(/"/g, '""');
    // ExcelJS serializes its `hyperlink` value as an external relationship even
    // when the URL is a workbook location. Use Excel's HYPERLINK formula so
    // these are true in-workbook jumps with no external target/duplicate tooltip.
    cell.value = {
      formula: `HYPERLINK("#'${quotedSheet}'!${address}","${safeDisplayText}")`,
      result: displayText,
    };
    cell.font = { ...FONT, color: { argb: "FFFF0000" }, underline: true };
  };
  for (const { cell, code } of maps.hyperlinkCells) {
    const targetRow = maps.itemHeaderRows[`sub:${code.toLowerCase()}`];
    if (!targetRow) continue;
    const display = text(cell.value);
    setInternalLink(cell, subSheetName, `A${targetRow}`, display);
  }
  for (const { cell, code } of maps.rateLinkCells) {
    const targetSayRow = maps.sayRows[`sub:${code.toLowerCase()}`];
    if (targetSayRow) {
      cell.value = {
        formula: `'${subSheetName}'!F${targetSayRow}`,
        result: maps.sayRates[`sub:${code.toLowerCase()}`] ?? numberOrNull(cell.value) ?? 0,
      };
    }
  }
  // Return navigation in every supporting block is placed at its item-code cell.
  for (const key of Object.keys(maps.itemHeaderRows)) {
    if (!key.startsWith("sub:")) continue;
    const code = key.slice(4);
    const mainTarget = maps.subARReferrerRows[code] ?? maps.itemHeaderRows[`main:${code}`];
    if (mainTarget) {
      const cell = maps.itemHeaderCodeCells[key];
      if (cell) {
        setInternalLink(cell, mainSheetName, `A${mainTarget}`, text(cell.value));
      }
    }
  }
}

export type MultiRANSItemSheetReference = {
  sheetName: string;
  descriptionRow: number;
  sayRow: number;
  description: string;
  unit: string;
  rate: number;
};

export type RateAnalysisSheetPairConfig = {
  mainName: string;
  subName: string;
  mainTitle: string;
  subTitle: string;
  include: (code: string) => boolean;
  mainFooterTitle?: string;
  subFooterTitle?: string;
};

type ExportSignatoryDetails = {
  estimateId?: string;
  leftAETitle?: string;
  leftAEOffice?: string;
  rightAETitle?: string;
  rightAEOffice?: string;
  eeTitle?: string;
  eeOffice?: string;
};

function appendSignatories(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  details: ExportSignatoryDetails,
): number {
  // Leave one clear row after the last analysis block, matching the single-item export.
  const first = startRow + 3;
  const leftTitle = worksheet.getRow(first);
  worksheet.mergeCells(`A${first}:B${first}`);
  worksheet.mergeCells(`F${first}:G${first}`);
  leftTitle.getCell(1).value = details.leftAETitle || "Assistant Engineer,";
  leftTitle.getCell(6).value = details.rightAETitle || "Assistant Engineer,";
  leftTitle.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  leftTitle.getCell(6).alignment = { horizontal: "right", vertical: "middle", wrapText: true };

  const offices = worksheet.getRow(first + 1);
  worksheet.mergeCells(`A${first + 1}:B${first + 1}`);
  worksheet.mergeCells(`F${first + 1}:G${first + 1}`);
  offices.getCell(1).value = details.leftAEOffice || "";
  offices.getCell(6).value = details.rightAEOffice || "";
  offices.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  offices.getCell(6).alignment = { horizontal: "right", vertical: "middle", wrapText: true };

  const eeTitle = worksheet.getRow(first + 2);
  worksheet.mergeCells(`B${first + 2}:F${first + 2}`);
  eeTitle.getCell(2).value = details.eeTitle || "Executive Engineer & Senior Manager (C)-I,";
  eeTitle.getCell(2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  const eeOffice = worksheet.getRow(first + 3);
  worksheet.mergeCells(`B${first + 3}:F${first + 3}`);
  eeOffice.getCell(2).value = details.eeOffice || "";
  eeOffice.getCell(2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  for (const row of [leftTitle, offices, eeTitle, eeOffice]) {
    row.height = 18;
    row.eachCell({ includeEmpty: true }, cell => { cell.font = { ...FONT }; });
  }
  return eeOffice.number;
}

/**
 * Add caller-defined analysis/supporting-analysis sheet pairs using the same
 * calculation, formatting, and Sub-AR linking engine as the NSR export.
 */
export async function appendRateAnalysisSheetPairs(
  workbook: ExcelJS.Workbook,
  itemsData: MultiRANSItemExportData[],
  supportingItems: MultiRANSItemExportData[],
  configurations: RateAnalysisSheetPairConfig[],
  estimateId = "",
): Promise<Record<string, MultiRANSItemSheetReference>> {
  const allMainBlocks = makeBlocks(itemsData);
  const pairs: Array<RateAnalysisSheetPairConfig & {
    mainBlocks: ItemBlock[];
    subBlocks: ItemBlock[];
    mainSheet?: ExcelJS.Worksheet;
    subSheet?: ExcelJS.Worksheet;
    maps: RenderMaps;
  }> = [];
  for (const config of configurations) {
    const mainBlocks = allMainBlocks.filter(block => config.include(block.code));
    // Do not create empty NS or supporting-AR sheets in the workbook.
    if (!mainBlocks.length) continue;
    pairs.push({
      ...config,
      mainBlocks,
      subBlocks: await loadSubARBlocks(mainBlocks, supportingItems),
      maps: { itemHeaderRows: {}, itemHeaderCodeCells: {}, subARReferrerRows: {}, sayRows: {}, sayRates: {}, hyperlinkCells: [], rateLinkCells: [] },
    });
  }

  for (const pair of pairs) {
    pair.mainSheet = createWorksheet(workbook, pair.mainName);
    addSheetTitle(pair.mainSheet, pair.mainTitle);
    const footerTitle = pair.mainFooterTitle ?? pair.mainTitle;
    const footer = `&L${footerTitle}&CPage &P of &N&R${estimateId}`;
    pair.mainSheet.headerFooter = { oddFooter: footer, evenFooter: footer };
  }
  for (const pair of pairs) {
    if (!pair.subBlocks.length) continue;
    pair.subSheet = createWorksheet(workbook, pair.subName);
    addSheetTitle(pair.subSheet, pair.subTitle);
    const footerTitle = pair.subFooterTitle ?? pair.subTitle;
    const footer = `&L${footerTitle}&CPage &P of &N&R${estimateId}`;
    pair.subSheet.headerFooter = { oddFooter: footer, evenFooter: footer };
  }
  for (const pair of pairs) {
    let subRow = 4;
    if (pair.subSheet) {
      for (const block of pair.subBlocks) {
        subRow = addBlock(pair.subSheet, block, subRow, pair.maps, { subAnalysis: true, mainSheetName: pair.mainName });
      }
      pair.subSheet.pageSetup.printArea = `A1:G${subRow - 1}`;
    }

    let mainRow = 4;
    for (const block of pair.mainBlocks) {
      mainRow = addBlock(pair.mainSheet!, block, mainRow, pair.maps, { subAnalysis: false, mainSheetName: pair.mainName });
    }
    pair.mainSheet!.pageSetup.printArea = `A1:G${mainRow - 1}`;
    resolveHyperlinks(pair.maps, pair.subName, pair.mainName);
  }

  const references: Record<string, MultiRANSItemSheetReference> = {};
  for (const pair of pairs) {
    for (const block of pair.mainBlocks) {
      if (block.external) continue;
      const key = `main:${block.code.toLowerCase()}`;
      const itemHeaderRow = pair.maps.itemHeaderRows[key];
      const sayRow = pair.maps.sayRows[key];
      if (!itemHeaderRow || !sayRow) continue;
      references[block.code] = {
        sheetName: pair.mainName,
        descriptionRow: itemHeaderRow + 1,
        sayRow,
        description: block.description,
        unit: block.unit,
        rate: pair.maps.sayRates[key] ?? numberOrNull(block.item.rate) ?? 0,
      };
    }
  }
  return references;
}

/** Add the tested four-sheet NS/mDSR layout to an existing workbook and return item row refs. */
export async function appendMultiRANSItemsWorksheets(
  workbook: ExcelJS.Workbook,
  itemsData: MultiRANSItemExportData[],
  supportingItems: MultiRANSItemExportData[] = [],
  projectDetails: ExportSignatoryDetails = {},
): Promise<Record<string, MultiRANSItemSheetReference>> {
  const allMainBlocks = makeBlocks(itemsData);

  const families = [
    {
      code: "51",
      mainName: "AR _ NS Items",
      subName: "Sub AR _ NS Items",
      mainTitle: "RATE ANALYSIS FOR NON SCHEDULE ITEMS",
      subTitle: "SUPPORTING SUB-ARs — NS ITEMS",
    },
    {
      code: "50",
      mainName: "AR _ mDSR Items",
      subName: "Sub AR _ mDSR Items",
      mainTitle: "RATE ANALYSIS FOR MODIFIED DSR ITEMS",
      subTitle: "SUPPORTING SUB-ARs — mDSR ITEMS",
    },
  ] as const;
  // Create all four tabs in the requested order. Keep a separate mapping context
  // for each family so each Sub-AR hyperlink resolves within its matching pair.
  const sheetPairs = families.map(family => {
    const mainBlocks = allMainBlocks.filter(block => block.code === family.code || block.code.startsWith(`${family.code}.`));
    return {
      ...family,
      mainBlocks,
      subBlocks: [] as ItemBlock[],
      mainSheet: undefined as ExcelJS.Worksheet | undefined,
      subSheet: undefined as ExcelJS.Worksheet | undefined,
      maps: { itemHeaderRows: {}, itemHeaderCodeCells: {}, subARReferrerRows: {}, sayRows: {}, sayRates: {}, hyperlinkCells: [], rateLinkCells: [] } as RenderMaps,
    };
  }).filter(pair => pair.mainBlocks.length > 0);
  for (const pair of sheetPairs) {
    pair.mainSheet = createWorksheet(workbook, pair.mainName);
    addSheetTitle(pair.mainSheet, pair.mainTitle);
  }
  for (const pair of sheetPairs) {
    const subBlocks = await loadSubARBlocks(pair.mainBlocks, supportingItems);
    pair.subBlocks = subBlocks;
    if (subBlocks.length) {
      pair.subSheet = createWorksheet(workbook, pair.subName);
      addSheetTitle(pair.subSheet, pair.subTitle);
    }
  }

  const safeEstimateId = String(projectDetails.estimateId || "Estimate").replace(/&/g, "&&");
  for (const pair of sheetPairs) {
    const mainFooter = `&L${pair.mainTitle}&CPage &P of &N&REST ID: ${safeEstimateId}`;
    pair.mainSheet!.headerFooter = { oddFooter: mainFooter, evenFooter: mainFooter };
    if (pair.subSheet) {
      const subFooter = `&L${pair.subTitle}&CPage &P of &N&REST ID: ${safeEstimateId}`;
      pair.subSheet.headerFooter = { oddFooter: subFooter, evenFooter: subFooter };
    }
  }

  for (const pair of sheetPairs) {
    let subRow = 4;
    const subSheet = pair.subSheet;
    const mainSheet = pair.mainSheet!;
    if (subSheet) {
      for (const block of pair.subBlocks) {
        subRow = addBlock(subSheet, block, subRow, pair.maps, { subAnalysis: true, mainSheetName: pair.mainName });
      }
      const lastSubRow = appendSignatories(subSheet, subRow - 1, projectDetails);
      subSheet.pageSetup.printArea = `A1:G${lastSubRow}`;
    }

    // Render support analyses first so Sub-AR formula caches are ready for the main sheet.
    let row = 4;
    for (const block of pair.mainBlocks) {
      row = addBlock(mainSheet, block, row, pair.maps, { subAnalysis: false, mainSheetName: pair.mainName });
    }
    const lastMainRow = appendSignatories(mainSheet, row - 1, projectDetails);
    mainSheet.pageSetup.printArea = `A1:G${lastMainRow}`;
    resolveHyperlinks(pair.maps, pair.subName, pair.mainName);
  }

  const references: Record<string, MultiRANSItemSheetReference> = {};
  for (const pair of sheetPairs) {
    for (const block of pair.mainBlocks) {
      if (block.external) continue;
      const key = `main:${block.code.toLowerCase()}`;
      const itemHeaderRow = pair.maps.itemHeaderRows[key];
      const sayRow = pair.maps.sayRows[key];
      if (!itemHeaderRow || !sayRow) continue;
      references[block.code] = {
        sheetName: pair.mainName,
        descriptionRow: itemHeaderRow + 1,
        sayRow,
        description: block.description,
        unit: block.unit,
        rate: pair.maps.sayRates[key] ?? numberOrNull(block.item.rate) ?? 0,
      };
    }
  }
  return references;
}

/** Build the four-sheet NS/mDSR workbook without downloading. */
export async function buildMultiRANSItemsWorkbook(
  itemsData: MultiRANSItemExportData[],
  supportingItems: MultiRANSItemExportData[] = [],
  projectDetails: ExportSignatoryDetails = {},
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.subject = "CPWD NS and mDSR Rate Analysis";
  workbook.calcProperties.fullCalcOnLoad = true;
  await appendMultiRANSItemsWorksheets(workbook, itemsData, supportingItems, projectDetails);
  return workbook;
}

/** Export the selected NSR items plus their actual, recursively referenced Sub-AR analyses. */
export async function exportMultiRANSItemsToExcel(
  itemsData: MultiRANSItemExportData[],
  fileName = "All_NSR_Rate_Analysis",
  supportingItems: MultiRANSItemExportData[] = [],
  projectDetails: ExportSignatoryDetails = {},
) {
  const workbook = await buildMultiRANSItemsWorkbook(itemsData, supportingItems, projectDetails);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileName}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
