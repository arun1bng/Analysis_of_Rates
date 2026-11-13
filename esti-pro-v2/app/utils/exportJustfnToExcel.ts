import ExcelJS from "exceljs";
import { buildHierarchicalRows } from "./dsrHierarchy";
import { calculateAbstractTotals, resolveEstimateRate } from "./abstractTotals";
import { exportEstimateWorkbookToPdf, type SharedEstimateData } from "./exportTableToExcel";
import { fitPngWithinBox } from "./pngSizing";
import { appendRateAnalysisSheetPairs, resolveAnalysisBaseQuantity, type MultiRANSItemExportData } from "./exportMultiRANSItemsToExcel";

export type JustfnSummaryInputs = {
  nitNumber: string;
  lowestContractor: string;
  contractorTenderedAmount: string;
};

export type JustfnExportData = {
  estimateData: SharedEstimateData;
  statementRows: Array<Record<string, any>>;
  justifiedRates: Record<string, number | string | null | undefined>;
  baseMarketRates?: Record<string, number | string | null | undefined>;
  /** Live Rate List UI state; takes precedence over estimate/default rates. */
  rateListMarketRates?: Record<string, number | string | null | undefined>;
  summaryInputs: JustfnSummaryInputs;
  analysisSnapshot?: Record<string, any>;
  calculationMethod?: string;
  customCharges?: Array<{ id?: string; name?: string; rate?: number | string }>;
  excludeAMarkedItems?: boolean;
};

type JustfnStatementSummaryRefs = {
  totalDsrAndMdsrRow: number;
  costIndexRow: number;
  subtotalScheduleRow: number;
  modifiedEstimatedCostRow: number;
  nonScheduleRow: number;
  consideredCostRow: number;
  baseEcptRow: number;
  totalJustifiedRow: number;
  proRataRow: number;
  justifiedPercentageRow: number;
  verdictRow: number;
};

type JustfnWorkbookRowRefs = {
  marketSayRows: Record<string, number>;
  marketSaySheets: Record<string, string>;
  marketUnitCostRows: Record<string, number>;
  marketItemHeaderRows: Record<string, number>;
  marketItemCodeRows: Record<string, number>;
  marketItemSheetNames: Record<string, string>;
  marketSubReferrerRows: Record<string, number>;
  rateListRows: Record<string, number>;
  analysisSayRefs: Record<string, { sheetName: string; sayRow: number; rate: number }>;
  pendingMarketSubAnalysisLinks: Array<{
    row: number;
    sourceSheetName: string;
    sourceContextKey: string;
    targetSheetName: string;
    targetContextKey: string;
    code: string;
    fallbackRate: number;
    divisor?: number;
  }>;
  statementSummary?: JustfnStatementSummaryRefs;
};

const INDIAN_AMOUNT = "##,##,##,##0.00";
const FONT = "Book Antiqua";
const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" },
};
const BORDER_HAIR: Partial<ExcelJS.Borders> = {
  top: { style: "hair" }, bottom: { style: "hair" }, left: { style: "thin" }, right: { style: "thin" },
};
const BORDER_MEDIUM: Partial<ExcelJS.Borders> = {
  top: { style: "medium" }, bottom: { style: "medium" }, left: { style: "medium" }, right: { style: "medium" },
};

const text = (value: unknown, fallback = "") => String(value ?? fallback);
const num = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "string" ? Number(value.replace(/[₹,\s]/g, "")) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const roundMarketMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isNS = (code: string) => /^(?:NSR|51(?:\.|$))/i.test(code);
const exportFlag = (value: unknown) => value === true || value === 1 || String(value).toLowerCase() === "true";
const isExternal = (item: any) => item?.isExternalAR === true || Number(item?.is_external_ar) === 1;
const normalizeBasicRateCode = (value: unknown) => {
  const code = text(value).trim().replace(/\*+$/, "");
  return /^\d+$/.test(code) ? String(Number(code)) : code;
};
type MarketAnalysisResult = { rows: any[]; rate: number; sayRate: number; baseQty: number };
const analysisComponentCode = (row: any) => text(
  row?.sub_analysis_code ?? row?.subAnalysisCode ?? row?.component_code ?? row?.code,
).trim();

type ExcelMarkRows = Map<string, number[]>;

function excelMarkExpression(markRows: ExcelMarkRows, mark: string, beforeRow: number) {
  const refs = (markRows.get(mark.toUpperCase()) || []).filter(row => row < beforeRow);
  if (!refs.length) return undefined;
  return refs.length === 1 ? `F${refs[0]}` : `SUM(${refs.map(row => `F${row}`).join(",")})`;
}

/** Convert DAR's hidden algebra notes (for example "... using once = S/40")
 * into a live Excel expression that points at the rows carrying each mark. */
function algebraFormulaExpression(description: string, markRows: ExcelMarkRows, rowNumber: number, runningBase?: string) {
  const expression = description.split("=").pop()?.trim().toUpperCase() || "";
  const directDivide = /^([A-Z])\s*\/\s*(\d+(?:\.\d+)?)$/.exec(expression);
  if (directDivide) {
    const markRef = excelMarkExpression(markRows, directDivide[1], rowNumber);
    if (markRef) return `(${markRef}/${directDivide[2]})`;
  }
  const directMultiply = /^([A-Z])\s*[X*]\s*(0\.\d+|1\.\d+|\d+(?:\.\d+)?)$/.exec(expression);
  if (directMultiply) {
    const markRef = excelMarkExpression(markRows, directMultiply[1], rowNumber);
    if (markRef) return `(${markRef}*${directMultiply[2]})`;
  }
  const fractionOfMark = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+OF\s+([A-Z])$/.exec(expression);
  if (fractionOfMark && Number(fractionOfMark[2]) !== 0) {
    const markRef = excelMarkExpression(markRows, fractionOfMark[3], rowNumber);
    if (markRef) return `((${markRef}*${fractionOfMark[1]})/${fractionOfMark[2]})`;
  }

  const percentageTerms = [...expression.matchAll(/([+-]?)\s*(\d+(?:\.\d+)?)\s*(?:%|PER\s*CENT)\s*(?:OF|ON)\s+["']?([A-Z])\b/gi)];
  if (percentageTerms.length) {
    const terms = percentageTerms.flatMap(match => {
      const markRef = excelMarkExpression(markRows, match[3], rowNumber);
      return markRef ? [`${match[1] === "-" ? "-" : "+"}(${markRef}*${Number(match[2]) / 100})`] : [];
    });
    if (terms.length) return `(${terms.join("")})`;
  }

  if (/\bEXTRA\b/i.test(description)) {
    const percent = description.match(/@\s*(\d+(?:\.\d+)?)\s*%/i);
    if (percent && runningBase) return `(${runningBase}*${Number(percent[1]) / 100})`;
  }
  return undefined;
}
function findRateItemByCode(rates: any[], codeValue: unknown) {
  const code = text(codeValue).trim();
  return rates.find(rate => text((rate as any).code ?? (rate as any).itemCode).trim() === code)
    ?? rates.find(rate => normalizeBasicRateCode((rate as any).code ?? (rate as any).itemCode) === normalizeBasicRateCode(code));
}
const lookupMarketRate = (rates: Record<string, number | string | null | undefined> | undefined, code: string) => {
  if (!rates) return undefined;
  if (Object.prototype.hasOwnProperty.call(rates, code)) {
    const exact = rates[code];
    if (exact !== null && exact !== undefined && String(exact).trim() !== "") return exact;
  }
  const normalized = normalizeBasicRateCode(code);
  return Object.entries(rates).find(([key, value]) =>
    normalizeBasicRateCode(key) === normalized && value !== null && value !== undefined && String(value).trim() !== "",
  )?.[1];
};
function resolveMarketRate(data: JustfnExportData, code: string, fallbackRate?: unknown) {
  const override = lookupMarketRate(data.rateListMarketRates, code)
    ?? lookupMarketRate(data.baseMarketRates, code)
    ?? lookupMarketRate(data.estimateData.marketRates, code);
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    const parsed = Number(typeof override === "string" ? override.replace(/[₹,\s]/g, "") : override);
    if (Number.isFinite(parsed)) return parsed;
  }

  const basicItem = findRateItemByCode(data.estimateData.rates, code) as any;
  const dsrRate = basicItem?.rate ?? basicItem?.dsrRate ?? basicItem?.dsr_rate ?? fallbackRate;
  return num(dsrRate, 0);
}
type RateListCategory = "materials" | "labour" | "machinery" | "carriage";
const RATE_LIST_CATEGORIES: Array<{ id: RateListCategory; title: string }> = [
  { id: "materials", title: "Materials" },
  { id: "labour", title: "Labour" },
  { id: "machinery", title: "Hire charges of plants and machinery" },
  { id: "carriage", title: "Carriage of materials" },
];
function rateListCategory(codeValue: unknown): RateListCategory | null {
  const code = normalizeBasicRateCode(codeValue);
  if (!/^\d+$/.test(code)) return null;
  const numericCode = Number(code);
  if (numericCode >= 222 && numericCode <= 9999 && !(numericCode >= 2200 && numericCode <= 2358)) return "materials";
  if (numericCode >= 100 && numericCode <= 221) return "labour";
  if (numericCode >= 1 && numericCode <= 99) return "machinery";
  if (numericCode >= 2200 && numericCode <= 2358) return "carriage";
  return null;
}
const sortCode = (a: string, b: string) => {
  const left = a.match(/\d+|[a-z]+/gi) || [];
  const right = b.match(/\d+|[a-z]+/gi) || [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const ln = Number(left[i]), rn = Number(right[i]);
    if (Number.isFinite(ln) && Number.isFinite(rn) && ln !== rn && String(ln) === left[i] && String(rn) === right[i]) return ln - rn;
    const order = left[i].localeCompare(right[i]);
    if (order) return order;
  }
  return 0;
};

function configureSheet(sheet: ExcelJS.Worksheet, title: string, projectDetails: Record<string, unknown>, lastColumn: number) {
  sheet.views = [{ state: "normal", style: "pageBreakPreview" }];
  sheet.pageSetup = {
    paperSize: 9, orientation: lastColumn > 7 ? "landscape" : "portrait", scale: 85,
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  sheet.headerFooter = { oddFooter: `&L${title}&CPage &P of &N`, evenFooter: `&L${title}&CPage &P of &N` };
  if (!sheet.columns || sheet.columns.length === 0) {
    sheet.columns = Array.from({ length: lastColumn }, () => ({ style: { font: { name: FONT, size: 10 } } }));
  }
  sheet.columns.forEach(column => { column.style = { font: { name: FONT, size: 10 } }; });
  sheet.eachRow(row => row.eachCell({ includeEmpty: true }, cell => { cell.font = { name: FONT, size: 10 }; }));
  sheet.getColumn(1).width = 11;
  if (lastColumn === 9) {
    [14, 15, 70, 12, 12, 17, 18, 17, 18].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  }
  if (lastColumn === 7) [18, 72, 14, 15, 17, 18, 14].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  const titleRow = sheet.addRow([title]);
  sheet.mergeCells(1, 1, 1, lastColumn);
  titleRow.height = 28;
  titleRow.getCell(1).font = { name: FONT, size: 14, bold: true };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  const state = `STATE : ${text(projectDetails.state, "GOA")}`;
  const division = `DIVISION : ${text(projectDetails.division, "GCD")}`;
  const branch = `BRANCH : ${text(projectDetails.branch, "B&R")}`;
  const subDivision = `SUB DIVISION : ${text(projectDetails.subDivision, "Kolhapur Sub Division")}`;
  const meta1 = sheet.addRow([state, division]);
  sheet.mergeCells(meta1.number, 1, meta1.number, Math.max(1, Math.floor(lastColumn / 2)));
  sheet.mergeCells(meta1.number, Math.floor(lastColumn / 2) + 1, meta1.number, lastColumn);
  meta1.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  meta1.getCell(Math.floor(lastColumn / 2) + 1).alignment = { horizontal: "right", vertical: "middle" };
  const meta2 = sheet.addRow([branch, subDivision]);
  sheet.mergeCells(meta2.number, 1, meta2.number, Math.max(1, Math.floor(lastColumn / 2)));
  sheet.mergeCells(meta2.number, Math.floor(lastColumn / 2) + 1, meta2.number, lastColumn);
  meta2.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  meta2.getCell(Math.floor(lastColumn / 2) + 1).alignment = { horizontal: "right", vertical: "middle" };
  sheet.addRow([]);
  const work = sheet.addRow([`Name of Work: ${text(projectDetails.nameOfWork)}`]);
  sheet.mergeCells(work.number, 1, work.number, lastColumn);
  work.height = Math.max(22, Math.ceil(text(projectDetails.nameOfWork).length / 100) * 18);
  work.getCell(1).font = { name: FONT, size: 10, bold: true };
  work.getCell(1).alignment = { wrapText: true, vertical: "middle" };
  sheet.addRow([]);
}

function addColumnHeaders(sheet: ExcelJS.Worksheet, titleGroups: Array<{ label: string; start: number; end: number }>, headers: string[]) {
  const groupRow = sheet.addRow([]);
  for (const group of titleGroups) {
    groupRow.getCell(group.start).value = group.label;
    if (group.end > group.start) sheet.mergeCells(groupRow.number, group.start, groupRow.number, group.end);
    groupRow.getCell(group.start).alignment = { horizontal: "center", vertical: "middle" };
    groupRow.getCell(group.start).font = { name: FONT, size: 10, bold: true };
  }
  groupRow.eachCell({ includeEmpty: true }, cell => { cell.border = BORDER_THIN; });
  groupRow.height = 20;
  const header = sheet.addRow(headers);
  header.height = 34;
  header.eachCell({ includeEmpty: true }, cell => {
    cell.font = { name: FONT, size: 10, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });
  return header.number;
}

function applyDataRow(row: ExcelJS.Row, lastColumn: number, descriptionColumn: number, description: string, charsPerLine = 95, lineHeight = 15) {
  row.eachCell({ includeEmpty: true }, cell => {
    cell.font = { name: FONT, size: 10 };
    cell.border = BORDER_HAIR;
    cell.alignment = { vertical: "middle" };
  });
  row.getCell(descriptionColumn).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
  const lines = Math.max(1, ...description.split(/\r?\n/).map(line => Math.ceil(line.length / charsPerLine)));
  row.height = Math.max(15, lines * lineHeight);
  for (let col = descriptionColumn + 1; col <= lastColumn; col++) row.getCell(col).alignment = { horizontal: "right", vertical: "middle" };
}

function addSignatureBlock(sheet: ExcelJS.Worksheet, details: Record<string, unknown>, lastColumn: number) {
  for (let i = 0; i < 4; i++) sheet.addRow([]);
  const leftStart = 2, leftEnd = 4;
  const rightStart = lastColumn === 9 ? 5 : lastColumn > 7 ? 9 : 5;
  const rightEnd = lastColumn === 9 ? 9 : lastColumn > 7 ? 11 : lastColumn;
  const titles = sheet.addRow([]);
  const offices = sheet.addRow([]);
  for (const row of [titles, offices]) {
    row.height = 20;
    sheet.mergeCells(row.number, leftStart, row.number, leftEnd);
    sheet.mergeCells(row.number, rightStart, row.number, rightEnd);
    row.getCell(leftStart).font = row.getCell(rightStart).font = { name: FONT, size: 10 };
    row.getCell(leftStart).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    row.getCell(rightStart).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  }
  titles.getCell(leftStart).value = text(details.leftAETitle, "Assistant Engineer,");
  offices.getCell(leftStart).value = text(details.leftAEOffice, "CPWD, Kolhapur.");
  titles.getCell(rightStart).value = text(details.rightAETitle, "Assistant Engineer,");
  offices.getCell(rightStart).value = text(details.rightAEOffice, "GCD, CPWD, Goa.");
  sheet.addRow([]).height = 20;
  const executiveTitle = sheet.addRow([text(details.eeTitle, "Executive Engineer & Senior Manager (C)-I,")]);
  const executiveOffice = sheet.addRow([text(details.eeOffice, "GCD, CPWD, Goa.")]);
  for (const row of [executiveTitle, executiveOffice]) {
    row.height = 20;
    sheet.mergeCells(row.number, 1, row.number, lastColumn);
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
}

function aggregateItems(rows: Array<Record<string, any>>, rates: Array<Record<string, any>>, nsMarketRates: Record<string, any> = {}) {
  const rateByCode = new Map(rates.map(item => [text(item.code ?? item.itemCode).trim(), item]));
  const groups = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const code = text(row.itemCode ?? row.itemNo ?? row.code).trim();
    if (!code || row.isSubtotal || row.isSubhead || String(row.type || "").toLowerCase() === "sh") continue;
    const base = rateByCode.get(code);
    const existing = groups.get(code);
    const quantity = num(row.quantity);
    if (existing) existing.quantity += quantity;
    else {
      const storedRate = resolveEstimateRate({ itemCode: code, rate: row.rate ?? base?.rate }, rates);
      const rate = isNS(code) ? num(nsMarketRates[code], storedRate) : storedRate;
      groups.set(code, { ...row, itemCode: code, description: text(base?.description ?? row.description ?? row.userDescription), unit: text(row.unit ?? base?.unit), quantity, rate, sourceRows: [row] });
    }
    if (existing) existing.sourceRows.push(row);
  }
  return [...groups.values()];
}

function findSummaryValues(data: JustfnExportData) {
  const nsMarketRates = data.baseMarketRates ?? data.estimateData.marketRates ?? {};
  const all = aggregateItems(data.estimateData.estimateRows, data.estimateData.rates, nsMarketRates);
  const selected = aggregateItems(data.statementRows, data.estimateData.rates, nsMarketRates);
  const dsrEstimate = selected.reduce((sum, row) => !isNS(row.itemCode) && !/^50(?:\.|$)/.test(row.itemCode) ? sum + Math.round(row.quantity * row.rate) : sum, 0);
  const scheduledEstimate = selected.reduce((sum, row) => !isNS(row.itemCode) ? sum + Math.round(row.quantity * row.rate) : sum, 0);
  const nsEstimate = selected.reduce((sum, row) => isNS(row.itemCode) ? sum + Math.round(row.quantity * row.rate) : sum, 0);
  const justified = selected.reduce((sum, row) => {
    const rate = isNS(row.itemCode) ? row.rate : num(data.justifiedRates[row.itemCode], row.rate);
    return sum + Math.round(row.quantity * rate);
  }, 0);
  const costIndex = num(data.estimateData.projectDetails.costIndex, 15);
  const factor = num(data.estimateData.projectDetails.gstModificationFactor, 0.973) || 0.973;
  const estimatedConsidered = Math.round((scheduledEstimate + Math.round(scheduledEstimate * costIndex / 100)) * factor) + nsEstimate;
  const estimatedPutToTender = calculateAbstractTotals(data.estimateData.estimateRows, data.estimateData.projectDetails, data.baseMarketRates ?? data.estimateData.marketRates, data.estimateData.rates).baseCombined;
  const proRata = estimatedConsidered ? Math.round(estimatedPutToTender * justified / estimatedConsidered) : 0;
  const tender = num(data.summaryInputs.contractorTenderedAmount);
  const percent = (a: number, b: number) => b ? ((a - b) / b) * 100 : 0;
  return { all, selected, dsrEstimate, scheduledEstimate, nsEstimate, justified, estimatedConsidered, estimatedPutToTender, proRata, tender, costIndex, factor,
    consideredPercent: estimatedPutToTender ? estimatedConsidered / estimatedPutToTender * 100 : 0,
    ecptDeviation: percent(proRata, estimatedPutToTender), clause12: percent(tender, estimatedPutToTender), lowestVsJustified: percent(tender, proRata) };
}

function currencyFormat(details: Record<string, unknown>) {
  return details.currencyFormat === "Exact Value" ? "0" : details.currencyFormat === "Standard (Millions)" ? "#,##0" : "#,##,##0";
}

export async function buildJustfnFrontSheetLayout(sheet: ExcelJS.Worksheet, data: JustfnExportData, estimateId = "Estimate") {
  const { projectDetails } = data.estimateData;
  sheet.views = [{ state: "normal", style: "pageBreakPreview", showGridLines: false }];
  sheet.pageSetup = {
    paperSize: 9, orientation: "portrait", scale: 85, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  const footerEstimateId = estimateId && estimateId !== "Estimate"
    ? estimateId
    : text(projectDetails.estimateId, "Estimate");
  const frontSheetFooter = `&LJUSTIFICATION FRONT SHEET&CPage &P of &N&REST ID: ${footerEstimateId}`;
  sheet.headerFooter = { oddFooter: frontSheetFooter, evenFooter: frontSheetFooter };
  [16, 35, 26, 3, 22].forEach((width, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = width;
    column.style = { font: { name: FONT, size: 10 } };
  });
  const summary = findSummaryValues(data);
  const moneyFormat = currencyFormat(projectDetails);
  const merge = (row: number, start: number, end: number, value: unknown, bold = false, align: "left" | "right" | "center" = "left") => {
    sheet.getCell(row, start).value = value as ExcelJS.CellValue;
    if (end > start) sheet.mergeCells(row, start, row, end);
    const cell = sheet.getCell(row, start);
    cell.font = { name: FONT, size: 10, bold };
    cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
    return cell;
  };
  merge(1, 1, 5, "GOVERNMENT OF INDIA", true, "center").font = { name: FONT, size: 12, bold: true };
  merge(2, 1, 5, "CENTRAL PUBLIC WORKS DEPARTMENT", true, "center").font = { name: FONT, size: 12, bold: true };
  const officeTitle = text(projectDetails.eeTitle, "Executive Engineer & Senior Manager (C)-I,").replace(/^Office of the\s+/i, "").trim();
  merge(3, 1, 5, `Office of the ${officeTitle}`, true, "center").font = { name: FONT, size: 12, bold: true };
  merge(4, 1, 5, text(projectDetails.eeOffice, "GCD, CPWD, Goa."), true, "center").font = { name: FONT, size: 12, bold: true };
  for (let rowNo = 1; rowNo <= 4; rowNo++) sheet.getRow(rowNo).height = 22;

  const stateCell = sheet.getCell("A5");
  stateCell.value = `STATE : ${text(projectDetails.state, "GOA")}`;
  stateCell.font = { name: FONT, size: 10, bold: true };
  stateCell.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
  const divisionCell = sheet.getCell("E5");
  divisionCell.value = `DIVISION : ${text(projectDetails.division, "GCD")}`;
  divisionCell.font = { name: FONT, size: 10, bold: true };
  divisionCell.alignment = { horizontal: "right", vertical: "middle", wrapText: false, shrinkToFit: true };
  sheet.getRow(5).height = 20;

  const branchCell = sheet.getCell("A6");
  branchCell.value = `BRANCH : ${text(projectDetails.branch, "B & R")}`;
  branchCell.font = { name: FONT, size: 10, bold: true };
  branchCell.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
  const subDivisionCell = sheet.getCell("E6");
  subDivisionCell.value = `SUB DIVISION : ${text(projectDetails.subDivision, "Kolhapur Sub Division")}`;
  subDivisionCell.font = { name: FONT, size: 10, bold: true };
  subDivisionCell.alignment = { horizontal: "right", vertical: "middle", wrapText: false };
  sheet.getRow(6).height = 20;
  sheet.getRow(7).height = 12;

  const frontTitle = merge(8, 1, 5, "JUSTIFICATION STATEMENT (CIVIL WORK)", true, "center");
  frontTitle.font = { name: FONT, size: 14, bold: true };
  sheet.getRow(8).height = 28;
  const infoRows = [
    ["N.I.T. No.:-", data.summaryInputs.nitNumber],
    ["Name of Work :-", text(projectDetails.nameOfWork)],
  ];
  for (let i = 0; i < infoRows.length; i++) {
    const rowNo = 9 + i;
    merge(rowNo, 1, 2, infoRows[i][0], true);
    merge(rowNo, 3, 5, infoRows[i][1]);
    sheet.getRow(rowNo).height = i === 0 ? 24 : Math.max(36, Math.ceil(String(infoRows[i][1]).length / 50) * 18);
  }
  merge(11, 1, 5, "With Respect to Lowest Tender", true, "center").font = { name: FONT, size: 12, bold: true };
  sheet.getRow(11).height = 24;
  const summaryRows: Array<[string, string, string, number | string, boolean, boolean]> = [
    ["1.", "Estimated cost put to tender [ECPT]:-", "Rs.", summary.estimatedPutToTender, true, false],
    ["2.", "Total of Estimated Cost of Items considered for Justificatoin:-", "Rs.", summary.estimatedConsidered, false, false],
    ["3.", "Percentage of Estimated cost considered for Justification:-", "", summary.consideredPercent, false, true],
    ["4.", "Corresponding Justified Amount:-", "Rs.", summary.justified, false, false],
    ["5.", "Total Justified amount on Pro-Rata basis:-", "Rs.", summary.proRata, true, false],
    ["6.", "Justified Percentage Below Estimated cost put to tender (ECPT):-", "", Math.abs(summary.ecptDeviation), false, true],
    ["7.", "Name of First lowest Contractor (L1):-", "", data.summaryInputs.lowestContractor, false, false],
    ["8.", "First lowest Contractor's (L1) Tendered Amount:-", "Rs.", summary.tender, true, false],
    ["9.", "Clause 12: % age:-", "", Math.abs(summary.clause12), false, true],
    ["10.", "Lowest tender percentage Above Justified amount:-", "", Math.abs(summary.lowestVsJustified), false, true],
  ];
  const formatPercentDescription = (value: number, subject: string) => Math.abs(value) < 0.005 ? `At Par ${subject}` : `${Math.abs(value).toFixed(2)}% ${value < 0 ? "Below" : "Above"} ${subject}`;
  const writeSummaryRow = (item: typeof summaryRows[number], index: number, rowNo: number) => {
    const row = sheet.addRow([item[0], item[1], item[2], null, null]);
    sheet.mergeCells(rowNo, 2, rowNo, 3);
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(1).font = { name: FONT, size: 10, bold: item[4] };
    row.getCell(2).font = { name: FONT, size: 10, bold: item[4] };
    row.getCell(2).alignment = { vertical: "middle", wrapText: true };
    row.getCell(4).value = item[2];
    row.getCell(4).alignment = { horizontal: "right", vertical: "middle" };
    const value = item[5]
      ? index === 2 ? `${num(item[3]).toFixed(2)}%` : formatPercentDescription(index === 5 ? summary.ecptDeviation : index === 8 ? summary.clause12 : summary.lowestVsJustified, index === 5 ? "ECPT" : "ECPT")
      : item[3];
    row.getCell(5).value = typeof value === "number" ? value : String(value);
    const centeredValue = index === 2 || index === 6 || index === 8 || index === 9;
    row.getCell(5).alignment = { horizontal: centeredValue ? "center" : typeof value === "string" ? "left" : "right", vertical: "middle", wrapText: true };
    row.getCell(5).font = { name: FONT, size: 10, bold: item[4] };
    row.eachCell({ includeEmpty: true }, cell => { cell.border = BORDER_THIN; });
    const labelForHeight = index === 0
      ? `Estimated cost put to tender [ECPT] : ${summary.estimatedPutToTender.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : index === 1
        ? `Total of Estimated Cost of Items considered for Justificatoin : ${summary.estimatedConsidered.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : String(row.getCell(2).value || "");
    row.height = Math.max(24, Math.ceil(labelForHeight.length / 45) * 18, Math.ceil(String(value).length / 28) * 18);
    if (!item[5] && typeof item[3] === "number") row.getCell(5).numFmt = moneyFormat;
  };
  summaryRows.slice(0, 5).forEach((item, index) => writeSummaryRow(item, index, 12 + index));
  const proRataText = `Pro-rata calculation: ${summary.estimatedPutToTender.toLocaleString("en-IN")} × ${summary.justified.toLocaleString("en-IN")} ÷ ${summary.estimatedConsidered.toLocaleString("en-IN")} = Rs. ${summary.proRata.toLocaleString("en-IN")}`;
  const formulaRow = sheet.addRow([]);
  sheet.mergeCells(17, 2, 17, 5);
  formulaRow.getCell(2).value = proRataText;
  formulaRow.height = 26;
  formulaRow.getCell(2).font = { name: FONT, size: 10, bold: true };
  formulaRow.getCell(2).alignment = { horizontal: "left", vertical: "middle" };
  formulaRow.eachCell({ includeEmpty: true }, cell => { cell.border = BORDER_THIN; });
  summaryRows.slice(5).forEach((item, index) => writeSummaryRow(item, index + 5, 18 + index));
  try {
    const [cpwd, goi] = await Promise.all(["/logos/cpwd-logo.png", "/logos/goi-emblem.png"].map(async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load ${url}`);
      return await response.arrayBuffer();
    }));
    const cpwdBytes = new Uint8Array(cpwd);
    const goiBytes = new Uint8Array(goi);
    const cpwdSize = fitPngWithinBox(cpwdBytes, 48, 66);
    const goiSize = fitPngWithinBox(goiBytes, 40, 66);
    const cpwdId = sheet.workbook.addImage({ buffer: cpwd, extension: "png" });
    const goiId = sheet.workbook.addImage({ buffer: goi, extension: "png" });
    sheet.addImage(cpwdId, { tl: { col: 0.08, row: 0.15 }, ext: cpwdSize });
    // Column E ends at zero-based column 5; the image width is about one quarter
    // of the column, so 4.75 anchors its right edge at E's right border.
    sheet.addImage(goiId, { tl: { col: 4.75, row: 0.15 }, ext: goiSize });
  } catch (error) {
    console.warn("Justification logos were not embedded in the Excel export.", error);
  }
  addSignatureBlock(sheet, projectDetails, 5);
  sheet.eachRow({ includeEmpty: true }, row => row.eachCell({ includeEmpty: true }, cell => {
    const currentFont = cell.font ?? {};
    cell.font = { ...currentFont, name: FONT, size: currentFont.size ?? 10 };
  }));
}

function linkFrontSheetToStatement(sheet: ExcelJS.Worksheet, data: JustfnExportData, summaryRefs: JustfnStatementSummaryRefs) {
  const summary = findSummaryValues(data);
  const statementRef = (column: "G" | "I", row: number) => `'Justfn Statement'!${column}${row}`;
  const setFormula = (cellAddress: string, formula: string, result: number | string, numberFormat?: string) => {
    const cell = sheet.getCell(cellAddress);
    cell.value = { formula: formula.replace(/^=/, ""), result };
    if (numberFormat) cell.numFmt = numberFormat;
  };

  setFormula(
    "E12",
    `=${statementRef("G", summaryRefs.baseEcptRow)}`,
    summary.estimatedPutToTender,
    moneyFormatForProject(data),
  );
  setFormula(
    "E13",
    `=${statementRef("G", summaryRefs.consideredCostRow)}`,
    summary.estimatedConsidered,
    moneyFormatForProject(data),
  );
  // Keep each label in its label cell and the linked numeric amount visible in
  // column E, matching the Front Sheet table layout.
  sheet.getCell("B12").value = "Estimated cost put to tender [ECPT]:-";
  sheet.getCell("B13").value = "Total of Estimated Cost of Items considered for Justificatoin:-";
  sheet.getCell("E12").numFmt = moneyFormatForProject(data);
  sheet.getCell("E13").numFmt = moneyFormatForProject(data);
  setFormula(
    "E14",
    `=IF(E12=0,0,E13/E12)`,
    summary.consideredPercent / 100,
    "0.00%",
  );
  setFormula("E15", `=${statementRef("I", summaryRefs.totalJustifiedRow)}`, summary.justified, moneyFormatForProject(data));
  setFormula("E16", `=${statementRef("I", summaryRefs.proRataRow)}`, summary.proRata, moneyFormatForProject(data));

  const percentageRef = statementRef("I", summaryRefs.justifiedPercentageRow);
  const percentText = (expression: string) => `TEXT(ABS(${expression}),"0.00")&"%"`;
  setFormula(
    "E18",
    `=IF(${percentageRef}<0,${percentText(percentageRef)}&" Below ECPT",IF(${percentageRef}>0,${percentText(percentageRef)}&" Above ECPT","At Par ECPT"))`,
    summary.ecptDeviation < 0 ? `${Math.abs(summary.ecptDeviation).toFixed(2)}% Below ECPT` : summary.ecptDeviation > 0 ? `${summary.ecptDeviation.toFixed(2)}% Above ECPT` : "At Par ECPT",
  );
  sheet.getCell("E18").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  const clause12Formula = `=IF(E12=0,"At Par ECPT",IF(E20<E12,TEXT(ABS(E20/E12-1)*100,"0.00")&"% Below ECPT",IF(E20>E12,TEXT(ABS(E20/E12-1)*100,"0.00")&"% Above ECPT","At Par ECPT")))`;
  const lowestFormula = `=IF(E16=0,"At Par ECPT",IF(E20<E16,TEXT(ABS(E20/E16-1)*100,"0.00")&"% Below ECPT",IF(E20>E16,TEXT(ABS(E20/E16-1)*100,"0.00")&"% Above ECPT","At Par ECPT")))`;
  setFormula("E21", clause12Formula, `${Math.abs(summary.clause12).toFixed(2)}% ${summary.clause12 < 0 ? "Below" : "Above"} ECPT`);
  setFormula("E22", lowestFormula, `${Math.abs(summary.lowestVsJustified).toFixed(2)}% ${summary.lowestVsJustified < 0 ? "Below" : "Above"} ECPT`);

  sheet.getCell("B17").value = {
    formula: `"Pro-rata calculation: "&TEXT(E12,"##,##,##0")&" × "&TEXT(E15,"##,##,##0")&" ÷ "&TEXT(E13,"##,##,##0")&" = Rs. "&TEXT(E16,"##,##,##0")`,
    result: `Pro-rata calculation: ${summary.estimatedPutToTender.toLocaleString("en-IN")} × ${summary.justified.toLocaleString("en-IN")} ÷ ${summary.estimatedConsidered.toLocaleString("en-IN")} = Rs. ${summary.proRata.toLocaleString("en-IN")}`,
  };
  sheet.getCell("B17").alignment = { horizontal: "left", vertical: "middle" };
}

function moneyFormatForProject(data: JustfnExportData) {
  return currencyFormat(data.estimateData.projectDetails);
}

export async function buildJustfnStatementLayout(
  worksheet: ExcelJS.Worksheet,
  data: JustfnExportData,
  rowRefs: JustfnWorkbookRowRefs = {
    marketSayRows: {},
    marketSaySheets: {},
    marketUnitCostRows: {},
    marketItemHeaderRows: {},
    marketItemCodeRows: {},
    marketItemSheetNames: {},
    marketSubReferrerRows: {},
    rateListRows: {},
    analysisSayRefs: {},
    pendingMarketSubAnalysisLinks: [],
  },
  estimateId = "",
) {
  const { estimateData, statementRows, justifiedRates } = data;
  const details = estimateData.projectDetails;
  worksheet.views = [{ state: "normal", style: "pageBreakPreview", showGridLines: false }];
  worksheet.pageSetup = {
    paperSize: 9, orientation: "landscape", scale: 90, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: "11:12",
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  const footerEstimateId = estimateId && estimateId !== "Estimate"
    ? estimateId
    : text(details.estimateId, "Estimate");
  const pageFooter = `&LJUSTIFICATION STATEMENT&CPage &P of &N&R${footerEstimateId}`;
  worksheet.headerFooter = { oddFooter: pageFooter, evenFooter: pageFooter };
  [10, 10, 70, 9, 8, 12, 12, 12, 12].forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
    worksheet.getColumn(index + 1).style = { font: { name: FONT, size: 10 } };
  });
  const putMergedHeaderText = (rowNumber: number, start: number, end: number, value: string, options: { bold?: boolean; size?: number; align?: "left" | "right" | "center" } = {}) => {
    if (end > start) worksheet.mergeCells(rowNumber, start, rowNumber, end);
    const cell = worksheet.getCell(rowNumber, start);
    cell.value = value;
    cell.font = { name: FONT, size: options.size ?? 10, bold: options.bold ?? true };
    cell.alignment = { horizontal: options.align ?? "center", vertical: "middle", wrapText: true };
    return cell;
  };
  putMergedHeaderText(1, 2, 8, "GOVERNMENT OF INDIA", { size: 12 });
  putMergedHeaderText(2, 2, 8, "CENTRAL PUBLIC WORKS DEPARTMENT", { size: 12 });
  const eeTitle = text(details.eeTitle, "Executive Engineer & Senior Manager (C)-I,").replace(/^Office of the\s+/i, "").trim();
  putMergedHeaderText(3, 2, 8, `Office of the ${eeTitle}`, { size: 12 });
  putMergedHeaderText(4, 2, 8, text(details.eeOffice, "GCD, CPWD, Goa."), { size: 12 });
  const metadataRows = [
    [`STATE : ${text(details.state, "GOA")}`, `DIVISION : ${text(details.division, "GCD")}`],
    [`BRANCH : ${text(details.branch, "B&R")}`, `SUB DIVISION : ${text(details.subDivision, "Kolhapur Sub Division")}`],
  ];
  metadataRows.forEach((values, index) => {
    const rowNumber = 5 + index;
    putMergedHeaderText(rowNumber, 1, 5, values[0], { align: "left" });
    putMergedHeaderText(rowNumber, 6, 9, values[1], { align: "right" });
  });
  worksheet.getRow(1).height = 22;
  worksheet.getRow(2).height = 22;
  worksheet.getRow(3).height = 22;
  worksheet.getRow(4).height = 22;
  worksheet.getRow(5).height = 20;
  worksheet.getRow(6).height = 20;
  putMergedHeaderText(7, 1, 9, "JUSTIFICATION STATEMENT", { size: 14 });
  worksheet.getRow(7).height = 28;
  const workName = text(details.nameOfWork);
  putMergedHeaderText(8, 1, 9, `Name of Work: ${workName}`, { align: "left" });
  worksheet.getRow(8).height = Math.max(22, Math.ceil(workName.length / 110) * 18);
  worksheet.addRow([]);
  worksheet.addRow([]);

  // Keep the government header visually consistent with the Front Sheet logos.
  try {
    const [cpwd, goi] = await Promise.all(["/logos/cpwd-logo.png", "/logos/goi-emblem.png"].map(async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load ${url}`);
      return response.arrayBuffer();
    }));
    const cpwdId = worksheet.workbook.addImage({ buffer: cpwd, extension: "png" });
    const goiId = worksheet.workbook.addImage({ buffer: goi, extension: "png" });
    worksheet.addImage(cpwdId, { tl: { col: 0.08, row: 0.15 }, ext: fitPngWithinBox(new Uint8Array(cpwd), 48, 66) });
  worksheet.addImage(goiId, { tl: { col: 8.75, row: 0.15 }, ext: fitPngWithinBox(new Uint8Array(goi), 40, 66) });
  } catch (error) {
    console.warn("Justification statement logos were not embedded in the Excel export.", error);
  }
  const uniqueItems = aggregateItems(statementRows, estimateData.rates);
  const hierarchy = buildHierarchicalRows(uniqueItems, estimateData.rates);
  const summary = findSummaryValues(data);
  const headerTop = worksheet.addRow([]);
  const headerLabels = worksheet.addRow([]);
  const mergedHeaders: Array<[number, string]> = [[1, "Sl. No."], [2, "DSR No."], [3, "Description"], [4, "Quantity"], [5, "Unit"]];
  for (const [column, label] of mergedHeaders) {
    worksheet.mergeCells(headerTop.number, column, headerLabels.number, column);
    headerTop.getCell(column).value = label;
  }
  worksheet.mergeCells(headerTop.number, 6, headerTop.number, 7);
  headerTop.getCell(6).value = "Estimate";
  worksheet.mergeCells(headerTop.number, 8, headerTop.number, 9);
  headerTop.getCell(8).value = "Justified";
  ["Rate (₹)", "Amount (₹)", "Rate (₹)", "Amount (₹)"].forEach((label, index) => { headerLabels.getCell(index + 6).value = label; });
  for (const row of [headerTop, headerLabels]) {
    row.height = 24;
    for (let column = 1; column <= 9; column++) {
      const cell = row.getCell(column);
      cell.font = { name: FONT, size: 10, bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = BORDER_THIN;
    }
  }
  const statementItemRows: Array<{ row: number; code: string }> = [];
  for (const item of hierarchy) {
    const code = String(item.itemCode);
    if (!item.isItem) {
      const description = text(item.description);
      const row = worksheet.addRow([item.serialNo, code, description, "", "", "", "", "", ""]);
      row.eachCell({ includeEmpty: true }, cell => { cell.font = { name: FONT, size: 10, bold: item.isSubhead }; cell.border = BORDER_HAIR; cell.alignment = { vertical: "middle" }; });
      row.getCell(3).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
      const descriptionLines = Math.max(1, ...description.split(/\r?\n/).map((line: string) => Math.ceil(line.length / 70)));
      row.height = Math.max(15, descriptionLines * 13);
      continue;
    }
    const quantity = num((item as any).quantity);
    const rateItem = findRateItemByCode(estimateData.rates, code) as any;
    const masterRate = num(rateItem?.rate ?? rateItem?.dar_rate ?? rateItem?.dsrRate ?? rateItem?.dsr_rate, NaN);
    const estimateRate = isNS(code) || !Number.isFinite(masterRate) ? num((item as any).rate) : masterRate;
    const justifiedRate = isNS(code) ? estimateRate : num(justifiedRates[code], estimateRate);
    const estimateAmount = Math.round(quantity * estimateRate);
    const justifiedAmount = Math.round(quantity * justifiedRate);
    const dataRowNumber = worksheet.rowCount + 1;
    const row = worksheet.addRow([item.serialNo, code, item.description, quantity, text((item as any).unit), estimateRate,
      { formula: `ROUND(D${dataRowNumber}*F${dataRowNumber},0)`, result: estimateAmount }, justifiedRate,
      { formula: `ROUND(D${dataRowNumber}*H${dataRowNumber},0)`, result: justifiedAmount }]);
    statementItemRows.push({ row: row.number, code });
    applyDataRow(row, 9, 3, item.description, 70, 13);
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(4).numFmt = "0.00";
    for (const col of [6, 7, 8, 9]) row.getCell(col).numFmt = INDIAN_AMOUNT;
    row.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
    const analysisRateRef = rowRefs.analysisSayRefs[code];
    if (analysisRateRef) {
      row.getCell(6).value = {
        formula: `'${analysisRateRef.sheetName.replace(/'/g, "''")}'!F${analysisRateRef.sayRow}`,
        result: analysisRateRef.rate ?? estimateRate,
      };
    }
    const marketContextKey = `${isNS(code) ? "ns" : "schedule"}:${code.toLowerCase()}`;
    const marketRateRef = rowRefs.marketSayRows[marketContextKey];
    const marketSheetName = rowRefs.marketSaySheets[marketContextKey];
    if (marketRateRef && marketSheetName) {
      row.getCell(8).value = {
        formula: `'${marketSheetName.replace(/'/g, "''")}'!F${marketRateRef}`,
        result: justifiedRate,
      };
    }
  }
  const lastItemsRow = worksheet.rowCount;
  if (lastItemsRow >= headerLabels.number + 1) {
    for (let column = 1; column <= 9; column++) {
      const cell = worksheet.getCell(lastItemsRow, column);
      cell.border = { ...(cell.border || BORDER_HAIR), bottom: { style: "thin" } };
    }
  }
  for (let rowNumber = headerTop.number; rowNumber <= lastItemsRow; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    for (const column of [1, 2]) {
      row.getCell(column).alignment = { horizontal: "center", vertical: "middle" };
    }
  }
  const costIndexAmount = Math.round(summary.scheduledEstimate * summary.costIndex / 100);
  const scheduleWithCostIndex = summary.scheduledEstimate + costIndexAmount;
  const modifiedScheduleCost = Math.round(scheduleWithCostIndex * summary.factor);
  const scheduleItemRows = statementItemRows.filter(item => !isNS(item.code)).map(item => item.row);
  const nonScheduleItemRows = statementItemRows.filter(item => isNS(item.code)).map(item => item.row);
  const amountSumFormula = (column: "G" | "I", rows: number[]) => {
    if (!rows.length) return "0";
    const sortedRows = [...new Set(rows)].sort((a, b) => a - b);
    const ranges: Array<[number, number]> = [];
    for (const row of sortedRows) {
      const lastRange = ranges[ranges.length - 1];
      if (lastRange && row === lastRange[1] + 1) lastRange[1] = row;
      else ranges.push([row, row]);
    }
    const references = ranges.map(([start, end]) => start === end ? `${column}${start}` : `${column}${start}:${column}${end}`);
    return `ROUND(SUM(${references.join(",")}),0)`;
  };
  const detailedRows: Array<{ label: string; column: 7 | 9; value: number | string; numberFormat?: string; formula: (rowNumber: number, refs: Partial<JustfnStatementSummaryRefs>) => string }> = [
    { label: "Total of DSR and mDSR items", column: 7, value: summary.scheduledEstimate, formula: () => amountSumFormula("G", scheduleItemRows) },
    { label: `Add Cost Index @ ${summary.costIndex}% on DSR & mDSR items`, column: 7, value: costIndexAmount, formula: (_row, refs) => `ROUND(G${refs.totalDsrAndMdsrRow}*${summary.costIndex}/100,0)` },
    { label: "Subtotal of DSR and mDSR items", column: 7, value: scheduleWithCostIndex, formula: (_row, refs) => `ROUND(G${refs.totalDsrAndMdsrRow}+G${refs.costIndexRow},0)` },
    { label: `Modified estimated cost after applying multiplier factor ${summary.factor} on DSR and mDSR items`, column: 7, value: modifiedScheduleCost, formula: (_row, refs) => `ROUND(G${refs.subtotalScheduleRow}*${summary.factor},0)` },
    { label: "Total of non-schedule items", column: 7, value: summary.nsEstimate, formula: () => amountSumFormula("G", nonScheduleItemRows) },
    { label: "Total of Estimated Cost of Items considered for Justificatoin", column: 7, value: summary.estimatedConsidered, formula: (_row, refs) => `ROUND(G${refs.modifiedEstimatedCostRow}+G${refs.nonScheduleRow},0)` },
    { label: "Estimated cost put to tender [ECPT]", column: 7, value: summary.estimatedPutToTender, formula: () => `ROUND(${summary.estimatedPutToTender},0)` },
    { label: "Total justified amount", column: 9, value: summary.justified, formula: () => amountSumFormula("I", statementItemRows.map(item => item.row)) },
    { label: "Total Justified amount on Pro-Rata basis", column: 9, value: summary.proRata, formula: (_row, refs) => `IF(G${refs.consideredCostRow}=0,0,ROUND(G${refs.baseEcptRow}*I${refs.totalJustifiedRow}/G${refs.consideredCostRow},0))` },
    { label: "Justified percentage", column: 9, value: summary.ecptDeviation, numberFormat: '0.00"%"', formula: (_row, refs) => `IF(G${refs.baseEcptRow}=0,0,(I${refs.proRataRow}/G${refs.baseEcptRow}-1)*100)` },
  ];
  const statementSummaryRefs: Partial<JustfnStatementSummaryRefs> = {};
  for (const detail of detailedRows) {
    const row = worksheet.addRow([]);
    worksheet.mergeCells(row.number, 1, row.number, 6);
    row.getCell(1).value = detail.label;
    row.getCell(detail.column).value = {
      formula: detail.formula(row.number, statementSummaryRefs),
      result: typeof detail.value === "number" ? detail.value : num(detail.value),
    };
    row.height = 22;
    for (let column = 1; column <= 9; column++) {
      const cell = row.getCell(column);
      cell.font = { name: FONT, size: 10, bold: false };
      cell.border = { ...BORDER_HAIR, bottom: { style: "thin" } };
      cell.alignment = { vertical: "middle", horizontal: column === detail.column ? "right" : "left", wrapText: true };
    }
    if (detail.column === 7) row.getCell(7).numFmt = INDIAN_AMOUNT;
    if (detail.column === 9) row.getCell(9).numFmt = detail.numberFormat ?? INDIAN_AMOUNT;
    if ([
      "Total of DSR and mDSR items",
      "Total of Estimated Cost of Items considered for Justificatoin",
      "Estimated cost put to tender [ECPT]",
      "Total Justified amount on Pro-Rata basis",
    ].includes(detail.label)) {
      row.getCell(1).font = { name: FONT, size: 10, bold: true };
      row.getCell(detail.column).font = { name: FONT, size: 10, bold: true };
    }
    if (detail.label === "Justified percentage") row.eachCell({ includeEmpty: true }, cell => { cell.font = { name: FONT, size: 10, bold: true }; });
    if (detail.label === "Total of DSR and mDSR items") statementSummaryRefs.totalDsrAndMdsrRow = row.number;
    else if (detail.label.startsWith("Add Cost Index")) statementSummaryRefs.costIndexRow = row.number;
    else if (detail.label === "Subtotal of DSR and mDSR items") statementSummaryRefs.subtotalScheduleRow = row.number;
    else if (detail.label.startsWith("Modified estimated cost")) statementSummaryRefs.modifiedEstimatedCostRow = row.number;
    else if (detail.label === "Total of non-schedule items") statementSummaryRefs.nonScheduleRow = row.number;
    else if (detail.label === "Total of Estimated Cost of Items considered for Justificatoin") statementSummaryRefs.consideredCostRow = row.number;
    else if (detail.label === "Estimated cost put to tender [ECPT]") statementSummaryRefs.baseEcptRow = row.number;
    else if (detail.label === "Total justified amount") statementSummaryRefs.totalJustifiedRow = row.number;
    else if (detail.label === "Total Justified amount on Pro-Rata basis") statementSummaryRefs.proRataRow = row.number;
    else if (detail.label === "Justified percentage") statementSummaryRefs.justifiedPercentageRow = row.number;
  }
  const percentage = summary.ecptDeviation;
  const absPercentage = Math.abs(percentage).toFixed(2);
  const verdict = percentage < 0
    ? `Justification is ${absPercentage}% below the estimated cost`
    : percentage > 0
      ? `Justification is ${absPercentage}% above the estimated cost`
      : "Justification is at par with the estimated cost";
  const verdictRow = worksheet.addRow([verdict]);
  worksheet.mergeCells(verdictRow.number, 1, verdictRow.number, 9);
  verdictRow.height = 24;
  verdictRow.getCell(1).value = {
    formula: `IF(I${statementSummaryRefs.justifiedPercentageRow}<0,"Justification is "&TEXT(ABS(I${statementSummaryRefs.justifiedPercentageRow}),"0.00")&"% below the estimated cost",IF(I${statementSummaryRefs.justifiedPercentageRow}>0,"Justification is "&TEXT(I${statementSummaryRefs.justifiedPercentageRow},"0.00")&"% above the estimated cost","Justification is at par with the estimated cost"))`,
    result: verdict,
  };
  verdictRow.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  verdictRow.getCell(1).font = { name: FONT, size: 14, bold: true };
  verdictRow.eachCell({ includeEmpty: true }, cell => { cell.font = { name: FONT, size: 14, bold: true }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.border = { ...BORDER_HAIR, bottom: { style: "thin" } }; });
  statementSummaryRefs.verdictRow = verdictRow.number;
  rowRefs.statementSummary = {
    ...statementSummaryRefs,
  } as JustfnStatementSummaryRefs;
  addSignatureBlock(worksheet, details, 9);
  worksheet.eachRow({ includeEmpty: true }, row => row.eachCell({ includeEmpty: true }, cell => {
    const currentFont = cell.font ?? {};
    cell.font = { ...currentFont, name: FONT, size: currentFont.size ?? 10 };
  }));
}

function analysisSnapshot(data: JustfnExportData, code: string) {
  const saved = data.analysisSnapshot?.[code];
  if (Array.isArray(saved)) return saved;
  if (Array.isArray(saved?.rows)) return saved.rows;
  const item = findRateItemByCode(data.estimateData.rates, code) as any;
  return Array.isArray(item?.analysisRows) ? item.analysisRows : [];
}

async function loadAnalyses(data: JustfnExportData) {
  const result: Record<string, any[]> = {};
  const roots = [...new Set((data.statementRows.length ? data.statementRows : data.estimateData.estimateRows).map(row => text(row.itemCode ?? row.itemNo).trim()).filter(Boolean))];
  const queue = [...roots];
  const visited = new Set<string>();
  let depth = 0;
  while (queue.length && depth < 10) {
    const batch = queue.splice(0).filter(code => !visited.has(code));
    if (!batch.length) break;
    for (const code of batch) visited.add(code);
    await Promise.all(batch.map(async code => {
      const cached = analysisSnapshot(data, code);
      if (cached.length) { result[code] = cached; return; }
      try {
        const response = await fetch(`/api/rate-analysis?code=${encodeURIComponent(code)}`);
        const rows = await response.json();
        result[code] = response.ok && Array.isArray(rows) ? rows : [];
      } catch {
        result[code] = [];
      }
    }));
    for (const code of batch) {
      for (const row of result[code] || []) {
        const child = analysisComponentCode(row);
        if (/^\d+(?:\.\d+)+$/.test(child) && !visited.has(child)) queue.push(child);
      }
    }
    depth++;
  }
  return result;
}

function analysisEntries(data: JustfnExportData, analyses: Record<string, any[]>) {
  const roots = [...new Set((data.statementRows.length ? data.statementRows : data.estimateData.estimateRows).map(row => text(row.itemCode ?? row.itemNo).trim()).filter(Boolean))].sort(sortCode);
  const result: Array<{ code: string; nonScheduleContext: boolean }> = [];
  const visited = new Set<string>();
  const queue = roots.map(code => ({ code, nonScheduleContext: isNS(code) }));
  while (queue.length) {
    const entry = queue.shift()!;
    const key = `${entry.nonScheduleContext ? "ns" : "schedule"}:${entry.code}`;
    if (visited.has(key)) continue;
    visited.add(key);
    result.push(entry);
    for (const row of analyses[entry.code] || []) {
      const type = text(row.row_type).toUpperCase();
      const child = analysisComponentCode(row);
      if (type === "NCR" || type === "SCR" || !/^\d+(?:\.\d+)+$/.test(child)) continue;
      queue.push({ code: child, nonScheduleContext: entry.nonScheduleContext || isNS(child) });
    }
  }
  return result;
}

function isFinancialRow(row: any) {
  const type = text(row.row_type ?? row.type).toUpperCase();
  const description = text(row.description).trim();
  const normalizedDescription = description.replace(/\s+/g, " ").toUpperCase();
  const mark = text(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref).trim().toUpperCase();
  if (row.isTotal === true || row.is_total === true || row.isUnitRate === true || row.is_unit_rate === true || row.isSayRow === true || row.is_say_row === true) return true;
  if (["CALC", "CALC_SNAPSHOT"].includes(type)) return true;
  // Legacy financial rows may be saved as NCR/Note. Filter them by stable
  // calculation metadata or known financial labels, while preserving physical
  // quantity notes such as "Total = 14.49 kg".
  if (/^TOTAL(?:\s*["'“”]?[WXYZ]["'“”]?)?$/.test(normalizedDescription) && (/^[WXYZ]$/.test(mark) || /[WXYZ]/.test(normalizedDescription))) return true;
  if (/^(?:ADD\s+(?:(?:\d+(?:\.\d+)?\s*%\s*)?(?:WATER\s+CHARGES|CPOH|CESS)|GST)\b|LESS\s+(?:WATER\s+CHARGES|CPOH|CESS|GST)\b|DEDUCT\s+(?:WATER\s+CHARGES|CPOH|CESS|GST)\b)/i.test(normalizedDescription)) return true;
  if (/^COST\s+OF\s+\d+(?:\.\d+)?(?:\s+.*)?$/i.test(normalizedDescription)) return true;
  return /^SAY(?:\s*\(MARKET\s+RATE\))?$/i.test(normalizedDescription);
}

function findConventionalGstMultiplier(rows: any[], fallback?: number): number | undefined {
  for (const row of rows || []) {
    const description = text(row?.description);
    if (!/\bGST\b/i.test(description)) continue;
    const factor = description.match(/multiplying\s+factor\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (factor) return Number(factor[1]);
    const percentage = description.match(/@\s*(\d+(?:\.\d+)?)\s*%/);
    if (percentage) return Number(percentage[1]) / 100;
    const direct = num(row?.gstMultiplier ?? row?.gst_multiplier ?? row?.gstFactor ?? row?.gst_factor);
    if (direct > 0) return direct;
  }
  return Number.isFinite(fallback) && Number(fallback) > 0 ? Number(fallback) : undefined;
}

function buildMarketRows(code: string, data: JustfnExportData, analyses: Record<string, any[]>, cache: Map<string, MarketAnalysisResult>, active = new Set<string>()): MarketAnalysisResult {
  if (cache.has(code)) return cache.get(code)!;
  const source = analyses[code] || [];
  const item = findRateItemByCode(data.estimateData.rates, code) as any;
  const baseQty = analysisBaseQuantity(source, item);
  if (isExternal(item)) {
    const rate = num(item?.rate ?? item?.dsrRate ?? item?.dsr_rate);
    const unchanged = { rows: source, rate, sayRate: rate, baseQty };
    cache.set(code, unchanged);
    return unchanged;
  }
  if (active.has(code) || source.length === 0) {
    const rate = resolveMarketRate(data, code, item?.rate ?? item?.dsrRate ?? item?.dsr_rate);
    const unchanged = { rows: source, rate, sayRate: rate, baseQty };
    cache.set(code, unchanged);
    return unchanged;
  }
  const nextActive = new Set(active).add(code);
  const details: any[] = source.filter((row: any) => !isFinancialRow(row)).map((row: any): any => {
    const type = text(row.row_type).toUpperCase();
    if (type !== "CR") return { ...row };
    const component = analysisComponentCode(row);
    if (!component) return { ...row };
    let rate: number | undefined;
    if (/^\d+(?:\.\d+)+$/.test(component) && analyses[component]) {
      rate = buildMarketRows(component, data, analyses, cache, nextActive).rate;
    } else {
      rate = resolveMarketRate(data, component, row.rate);
    }
    if (!Number.isFinite(rate)) rate = 0;
    const qty = num(row.quantity) / baseQty;
    return { ...row, quantity: qty, rate, amount: roundMarketMoney(qty * rate) };
  });
  const amountsByMark = new Map<string, number>();
  for (const row of details) {
    if (text(row.row_type).toUpperCase() !== "CR") continue;
    const mark = text(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref).trim().toUpperCase();
    if (/^[A-Z]$/.test(mark)) amountsByMark.set(mark, (amountsByMark.get(mark) || 0) + num(row.amount));
  }
  for (const row of details) {
    if (text(row.row_type).toUpperCase() !== "SCR" || row.amount_override) continue;
    const match = text(row.description).match(/(\d+(?:\.\d+)?)\s*%\s*(?:of|on)\s*["'“‘]?([A-Za-z])\b/i);
    if (match) row.amount = roundMarketMoney((amountsByMark.get(match[2].toUpperCase()) || 0) * Number(match[1]) / 100);
  }
  const markedA = details.filter(row => text(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref).trim().toUpperCase() === "A" && text(row.row_type).toUpperCase() !== "NCR")
    .reduce((sum, row) => sum + num(row.amount), 0);
  // Only cost-bearing rows enter W. Textual subtotals and instructions can carry
  // cached amounts in legacy databases, so row kind rather than description
  // text is the authority for what contributes to the financial calculation.
  const totalBase = roundMarketMoney(details
    .filter(row => ["CR", "SCR"].includes(text(row.row_type ?? row.type).toUpperCase()))
    .reduce((sum, row) => sum + num(row.amount), 0));
  const excludeA = data.excludeAMarkedItems !== false;
  const base = (value: number) => Math.max(0, value - (excludeA ? markedA : 0));
  const rows: any[] = [...details];
  let current = totalBase;
  let w = totalBase;
  const hasAMarkedRows = excludeA && markedA > 0;
  const suffix = hasAMarkedRows ? "-A" : "";
  const add = (description: string, amount: number, mark = "", metadata: Record<string, unknown> = {}) =>
    rows.push({ row_type: "CALC", description, amount: roundMarketMoney(amount), mark, ...metadata });
  let finalRate = 0;
  const exemptOverheads = Number(/^([0-9]+)/.exec(code)?.[1] || Number.MAX_SAFE_INTEGER) === 3;
  if (current > 0 && exemptOverheads) {
    add('TOTAL "W"', w, "W", { isTotal: true });
    finalRate = Math.round(current * 20) / 20;
    add(`Cost of 1.00 ${text(item?.unit, "unit")}`, current, "", { isUnitRate: true, baseQty: 1 });
    add("Say (Market Rate)", finalRate, "", { isSayRow: true });
    const result = { rows, rate: current, sayRate: finalRate, baseQty };
    cache.set(code, result);
    return result;
  }
  if (current > 0 && base(w) > 0) {
    add('TOTAL "W"', w, "W", { isTotal: true });
    if (data.calculationMethod === "Custom charges") {
      const charges = data.customCharges?.length ? data.customCharges : [
        { name: "Water charges", rate: 1 }, { name: "CPOH", rate: 15 }, { name: "Cess", rate: 1 }, { name: "GST", rate: 18 },
      ];
      let priorMark = "W";
      const nextMarks = ["X", "Y", "Z"];
      charges.forEach((charge, index) => {
        const chargeName = text(charge.name, `Charge ${index + 1}`).trim();
        const percent = num(charge.rate);
        const amount = roundMarketMoney(base(current) * percent / 100);
        current = roundMarketMoney(current + amount);
        add(`Add ${chargeName} @ ${percent}% on "${priorMark}${suffix}"`, amount, "", {
          percentage: percent,
          dependentMark: priorMark,
          excludeAMarkedItems: hasAMarkedRows,
        });
        const nextMark = nextMarks[index];
        if (nextMark) {
          add(`TOTAL "${nextMark}"`, current, nextMark, { isTotal: true });
          priorMark = nextMark;
        }
      });
    } else {
    const conventional = data.calculationMethod !== "Modified DSR";
    const addCharge = (description: string, pct: number, mark: string, dependentMark: string) => {
      const amount = roundMarketMoney(base(current) * pct / 100);
      current = roundMarketMoney(current + amount);
      add(description, amount, "", { percentage: pct, dependentMark, excludeAMarkedItems: hasAMarkedRows });
      add(`TOTAL "${mark}"`, current, mark, { isTotal: true });
    };
    addCharge(`Add 1% Water charges on "W${suffix}"`, 1, "X", "W");
    if (conventional) {
      const gstMultiplier = findConventionalGstMultiplier(
        source,
        num(item?.gstMultiplier ?? item?.gst_multiplier) || findConventionalGstMultiplier(Object.values(analyses).flat()),
      );
      if (gstMultiplier !== undefined) {
        const gst = roundMarketMoney(base(current) * gstMultiplier);
        add(`Add GST on "X${suffix}" (multiplying factor ${gstMultiplier})`, gst, "", {
          percentage: gstMultiplier * 100,
          multiplier: gstMultiplier,
          dependentMark: "X",
          excludeAMarkedItems: hasAMarkedRows,
        });
        current = roundMarketMoney(current + gst);
      }
      add(`TOTAL "Y"`, current, "Y", { isTotal: true });
      addCharge(`Add 15% CPOH on "Y${suffix}"`, 15, "Z", "Y");
      const cess = roundMarketMoney(base(current) * 0.01);
      add(`Add Cess @ 1% on "Z${suffix}"`, cess, "", { percentage: 1, dependentMark: "Z", excludeAMarkedItems: hasAMarkedRows });
      current = roundMarketMoney(current + cess);
    } else {
      addCharge(`Add 15% CPOH on "X${suffix}"`, 15, "Y", "X");
      addCharge(`Add Cess @ 1% on "Y${suffix}"`, 1, "Z", "Y");
      const gst = roundMarketMoney(base(current) * 0.18);
      add(`Add GST @ 18% on "Z${suffix}"`, gst, "", { percentage: 18, dependentMark: "Z", excludeAMarkedItems: hasAMarkedRows });
      current = roundMarketMoney(current + gst);
    }
    }
  }
  finalRate = Math.round(current * 20) / 20;
  if (totalBase > 0) {
    if (Math.abs(baseQty - 1) > 1e-9) {
      add(`Cost of ${baseQty.toFixed(2)} ${text(item?.unit, "unit")}`, current * baseQty, "", { isBaseCost: true, baseQty });
    }
    add(`Cost of 1.00 ${text(item?.unit, "unit")}`, current, "", { isUnitRate: true, baseQty });
    add("Say (Market Rate)", finalRate, "", { isSayRow: true });
  }
  const result: MarketAnalysisResult = { rows, rate: current, sayRate: finalRate, baseQty };
  cache.set(code, result);
  return result;
}

function analysisBaseQuantity(rows: any[], item?: any) {
  const resolved = resolveAnalysisBaseQuantity({
    unit: text(item?.unit ?? item?.measurement_unit ?? item?.measurementUnit),
    baseQty: item?.baseQty ?? item?.base_qty,
    base_qty: item?.baseQty ?? item?.base_qty,
    rate: item?.rate ?? item?.dsrRate ?? item?.dsr_rate,
    settings: item?.nsrSettings ?? item?.settings,
    settings_json: item?.settings_json,
    analysisRows: rows,
  }, rows);
  if (resolved !== null && Number.isFinite(resolved) && resolved > 0) return resolved;
  const header = rows.map(row => text(row.description)).find(value => /DETAILS\s+OF\s+COST/i.test(value));
  const match = header?.match(/DETAILS\s+OF\s+COST\s+(?:FOR|OF)\s+([\d.]+)/i);
  const parsed = match ? Number(match[1]) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function canonicalizeDSRSummary(rows: any[], canonicalRate: unknown, item?: any): any[] {
  const rate = Number(canonicalRate);
  if (!Number.isFinite(rate) || rate < 0) return rows;

  const normalized = rows.map(sourceRow => {
    const row = { ...sourceRow };
    const description = text(row.description).trim();
    const upper = description.replace(/\s+/g, " ").toUpperCase();
    const mark = text(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref).trim().toUpperCase();
    if (/^TOTAL(?:\s*[\"'“”]?[WXYZ][\"'“”]?)?$/.test(upper) && /^[WXYZ]$/.test(mark)) row.isTotal = true;
    if (/^(?:ADD|LESS|DEDUCT)\b/i.test(description)) {
      const dependent = description.match(/\bON\s*[\"'“”]?([WXYZ])(?:\s*-\s*A)?/i);
      const factor = description.match(/multiplying\s+factor\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
      const percentage = description.match(/(\d+(?:\.\d+)?)\s*%/);
      if (dependent) {
        row.dependentMark = dependent[1].toUpperCase();
        row.excludeAMarkedItems = /-\s*A\b/i.test(dependent[0]);
      }
      if (factor) row.multiplier = Number(factor[1]);
      else if (percentage) row.percentage = Number(percentage[1]);
    }
    if (/^COST\s+(?:OF|FOR)\s+1(?:\.0+)?(?:\s|$)/i.test(description)) row.isUnitRate = true;
    if (/^SAY$/i.test(description)) row.isSayRow = true;
    return row;
  });
  let costOneIndex = -1;
  let sayIndex = -1;
  let lastZIndex = -1;
  normalized.forEach((row, index) => {
    const description = text(row.description).trim();
    const mark = text(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref).trim().toUpperCase();
    if (normalized[index].isUnitRate === true || normalized[index].is_unit_rate === true) costOneIndex = index;
    if (normalized[index].isSayRow === true || normalized[index].is_say_row === true) sayIndex = index;
    if (mark === "Z") lastZIndex = index;
  });

  const baseQty = analysisBaseQuantity(normalized, item);
  if (costOneIndex >= 0) {
    let unitCost = rate;
    if (lastZIndex >= 0 && lastZIndex < costOneIndex) {
      const subsequentCharges = normalized.slice(lastZIndex + 1, costOneIndex).reduce((sum, row) => {
        const description = text(row.description).trim();
        const amount = Number(row.amount);
        return /^(?:ADD|LESS|DEDUCT)\b/i.test(description) && Number.isFinite(amount) ? sum + amount : sum;
      }, 0);
      const zAmount = Number(normalized[lastZIndex].amount);
      if (Number.isFinite(zAmount)) unitCost = Math.round((zAmount + subsequentCharges + Number.EPSILON) * 100) / 100;
    }
    normalized[costOneIndex] = {
      ...normalized[costOneIndex],
      amount: unitCost,
      isUnitRate: true,
      baseQty,
    };
  }
  if (sayIndex >= 0) {
    normalized[sayIndex] = { ...normalized[sayIndex], amount: rate, isSayRow: true };
  }
  return normalized;
}

function componentDivisor(row: any): number {
  const explicit = num(row?.componentDivisor ?? row?.component_divisor ?? row?.bulkDivisor ?? row?.bulk_divisor, 0);
  if (explicit > 0) return explicit;
  const match = text(row?.unit).trim().match(/^(\d+(?:\.\d+)?)(?=\s|$)/);
  const unitDivisor = match ? Number(match[1]) : 1;
  if (!Number.isFinite(unitDivisor) || unitDivisor <= 1) return 1;
  const quantity = Number(row?.quantity);
  const rate = Number(row?.rate);
  const amount = Number(row?.amount);
  if (Number.isFinite(quantity) && Number.isFinite(rate) && Number.isFinite(amount)) {
    if (Math.abs(quantity * rate - amount) < 0.011) return 1;
    if (Math.abs(quantity * rate / unitDivisor - amount) < 0.011) return unitDivisor;
  }
  return unitDivisor;
}

function configureMarketAnalysisSheet(sheet: ExcelJS.Worksheet, title: string, footerTitle: string, estimateId: string) {
  sheet.views = [{ state: "normal", style: "pageBreakPreview", zoomScale: 90, showGridLines: false }];
  sheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    scale: 90,
    fitToPage: false,
    margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.2, footer: 0.2 },
  };
  [8.6, 46, 7, 8.5, 8.5, 11, 6].forEach((width, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = width;
    column.style = {
      font: { name: FONT, size: 10 },
      alignment: {
        horizontal: index === 1 ? "left" : [3, 4, 5].includes(index) ? "right" : "center",
        vertical: "middle",
        ...(index === 1 ? { wrapText: true } : {}),
      },
      ...(index === 3 || index === 4 ? { numFmt: "0.00##########" } : index === 5 ? { numFmt: INDIAN_AMOUNT } : {}),
    };
  });
  sheet.addRow([]);
  const titleRow = sheet.addRow([title]);
  sheet.mergeCells("A2:G2");
  titleRow.height = 22;
  titleRow.getCell(1).font = { name: FONT, size: 12, bold: true };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  sheet.addRow([]);
  const footer = `&L${footerTitle}&CPage &P of &N&R${estimateId}`;
  sheet.headerFooter = { oddFooter: footer, evenFooter: footer };
}

function addAnalysisCard(
  sheet: ExcelJS.Worksheet,
  entry: { code: string; nonScheduleContext: boolean },
  index: number,
  data: JustfnExportData,
  analysisRows: any[],
  analyses: Record<string, any[]>,
  useMarket: boolean,
  marketCache: Map<string, MarketAnalysisResult>,
  rowRefs?: JustfnWorkbookRowRefs,
  itemNo = "",
  options: { isSubAnalysis?: boolean; rootCodes?: Set<string>; subAnalysisCodes?: Set<string> } = {},
) {
  const item = findRateItemByCode(data.estimateData.rates, entry.code) as any;
  const description = text(item?.description ?? data.estimateData.estimateRows.find(row => text(row.itemCode).trim() === entry.code)?.description);
  const itemUnit = text(item?.unit ?? data.estimateData.estimateRows.find(row => text(row.itemCode).trim() === entry.code)?.unit);
  const isSubAnalysis = options.isSubAnalysis === true;
  const contextBase = `${entry.nonScheduleContext ? "ns" : "schedule"}:${entry.code.toLowerCase()}`;
  const currentContextKey = `${isSubAnalysis ? "sub:" : ""}${contextBase}`;
  const itemNumberRow = sheet.addRow(["Item No.", itemNo || String(index + 1)]);
  sheet.mergeCells(itemNumberRow.number, 2, itemNumberRow.number, 7);
  itemNumberRow.height = 22;
  for (let col = 1; col <= 7; col++) {
    const cell = itemNumberRow.getCell(col);
    cell.font = { name: FONT, size: 12, bold: true };
    cell.alignment = { horizontal: col === 1 ? "center" : "left", vertical: "middle" };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, ...(col === 1 ? { left: { style: "thin" } } : {}), ...(col === 7 ? { right: { style: "thin" } } : {}) };
  }
  if (rowRefs) rowRefs.marketItemHeaderRows[currentContextKey] = itemNumberRow.number;
  if (rowRefs) rowRefs.marketItemSheetNames[currentContextKey] = sheet.name;
  const itemDescriptionRow = sheet.addRow([entry.code, description]);
  sheet.mergeCells(itemDescriptionRow.number, 2, itemDescriptionRow.number, 7);
  itemDescriptionRow.getCell(1).font = { name: FONT, size: 10 };
  itemDescriptionRow.getCell(1).alignment = { horizontal: "center", vertical: "top", wrapText: true };
  itemDescriptionRow.getCell(1).border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  itemDescriptionRow.getCell(2).font = { name: FONT, size: 10 };
  itemDescriptionRow.getCell(2).alignment = { horizontal: "justify", vertical: "top", wrapText: true };
  for (let col = 2; col <= 7; col++) itemDescriptionRow.getCell(col).border = { top: { style: "thin" }, bottom: { style: "thin" }, ...(col === 7 ? { right: { style: "thin" } } : {}) };
  const itemDescriptionLines = description.replace(/\r/g, "").split("\n").reduce((count, line) => count + (line.length ? Math.ceil(line.length / 85) : 1), 0);
  itemDescriptionRow.height = Math.max(18, itemDescriptionLines * 15);
  if (rowRefs) rowRefs.marketItemCodeRows[currentContextKey] = itemDescriptionRow.number;
  let rows: any[];
  let sayRate = num(item?.rate);
  let marketResult: MarketAnalysisResult | undefined;
  if (useMarket) {
    const result = buildMarketRows(entry.code, data, analyses, marketCache);
    marketResult = result;
    // Use the DSR structure with market rates and newly calculated finance rows.
    // This avoids retaining stale DSR totals or unit-rate rows from snapshots.
    // buildMarketRows has already removed persisted/stale calculation rows and
    // rebuilt the current finance block. Never fall back to the source snapshot
    // here, or it reintroduces duplicate W/X/Y/Z and Say rows.
    rows = result.rows;
    sayRate = result.sayRate;
  } else {
    rows = entry.nonScheduleContext || isNS(entry.code) || isExternal(item)
      ? analysisRows
      : canonicalizeDSRSummary(analysisRows, item?.rate, item);
    if (entry.nonScheduleContext || isNS(entry.code) || isExternal(item)) sayRate = num(item?.rate);
  }
  const calculationBaseQty = marketResult?.baseQty ?? analysisBaseQuantity(analysisRows, item);
  if (isExternal(item)) rows = [{ row_type: "NCR", description: "External analysis — detailed calculation is maintained outside the software.", amount: item?.rate, mark: "Ext. RA" }];
  if (!rows.length) rows = [{ row_type: "NCR", description: "No calculation breakdown available.", amount: "", mark: "" }];
  const markRows: ExcelMarkRows = new Map();
  const amountValuesByRow = new Map<number, number>();
  const markedARows: number[] = [];
  let pendingAmountRows: number[] = [];
  let baseCostRow: number | undefined;
  let unitRateRow: number | undefined;
  let firstFinancialRow = true;
  const sumFormula = (rowNumbers: number[]) => rowNumbers.length
    ? `SUM(${rowNumbers.map(rowNumber => `F${rowNumber}`).join(",")})`
    : "0";
  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const writeCalculationFormula = (cell: ExcelJS.Cell, formula: string, result: number) => {
    cell.value = { formula, result };
  };

  const tableHeader = sheet.addRow(["Code", "Description", "Unit", "Quantity", "Market\nRate (₹)", "Amount (₹)", "Mark"]);
  tableHeader.height = 32;
  tableHeader.eachCell({ includeEmpty: true }, cell => {
    cell.font = { name: FONT, size: 10, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = BORDER_THIN;
  });

  for (const sourceRow of rows) {
    const componentRawCode = analysisComponentCode(sourceRow);
    const rowType = text(sourceRow.row_type ?? sourceRow.type).toUpperCase();
    const isNCR = (rowType === "NCR" || rowType === "NOTE" || sourceRow.isNote === true) && !isFinancialRow(sourceRow);
    const mark = text(sourceRow.calc_mark ?? sourceRow.mark ?? sourceRow.reference_mark ?? sourceRow.ref).trim().toUpperCase();
    const descriptionText = text(sourceRow.description).trim();
    const row = sheet.addRow([
      componentRawCode || null, descriptionText, text(sourceRow.unit) || null,
      isNCR ? null : sourceRow.quantity === null || sourceRow.quantity === undefined || sourceRow.quantity === "" ? null : num(sourceRow.quantity),
      isNCR ? null : sourceRow.rate === null || sourceRow.rate === undefined || sourceRow.rate === "" ? null : num(sourceRow.rate),
      isNCR ? null : sourceRow.amount === null || sourceRow.amount === undefined || sourceRow.amount === "" ? null : num(sourceRow.amount),
      mark || null,
    ]);
    const amountCell = row.getCell(6);
    const fallbackAmount = num(sourceRow.amount);
    const isTotalRow = sourceRow.isTotal === true || sourceRow.is_total === true;
    const isUnitRateRow = sourceRow.isUnitRate === true || sourceRow.is_unit_rate === true;
    const isBaseCostRow = sourceRow.isBaseCost === true || sourceRow.is_base_cost === true;
    const isSayRow = sourceRow.isSayRow === true || sourceRow.is_say_row === true;
    const dependentMark = text(sourceRow.dependentMark ?? sourceRow.dependent_mark).trim().toUpperCase();
    const percentage = num(sourceRow.percentage, NaN);
    const multiplier = num(sourceRow.multiplier ?? sourceRow.rateFactor ?? sourceRow.rate_factor, NaN);
    if (mark && /^[A-Z]$/.test(mark) && rowType !== "CALC" && rowType !== "CALC_SNAPSHOT") {
      markRows.set(mark, [...(markRows.get(mark) || []), row.number]);
    }

    // The working DSR layout uses separate item-number, description and table
    // header rows, then a typed calculation pipeline. Mirror that structure and
    // link each CR rate to the active Market Rate cell in Rate List.
    if (!isNCR && rowType === "CR") {
      const rate = useMarket ? resolveMarketRate(data, componentRawCode, sourceRow.rate) : num(sourceRow.rate);
      const divisor = componentDivisor(sourceRow);
      const quantity = num(sourceRow.quantity);
      const amount = roundMoney(quantity * rate / divisor);
      const componentCode = normalizeBasicRateCode(componentRawCode);
      if (useMarket && componentCode && rowRefs?.rateListRows[componentCode]) {
        row.getCell(5).value = { formula: `'Rate List'!F${rowRefs.rateListRows[componentCode]}`, result: rate };
      } else {
        row.getCell(5).value = rate;
      }
      writeCalculationFormula(amountCell,
        divisor === 1 ? `ROUND(D${row.number}*E${row.number},2)` : `ROUND((D${row.number}*E${row.number})/${divisor},2)`,
        amount);
      amountValuesByRow.set(row.number, amount);
      pendingAmountRows.push(row.number);
      if (mark === "A") markedARows.push(row.number);
    } else if (!isNCR && Number.isFinite(percentage) && dependentMark) {
      const refs = markRows.get(dependentMark)?.filter(rowNumber => rowNumber < row.number) || [];
      if (refs.length) {
        const dependency = sumFormula(refs);
        const excludeA = sourceRow.excludeAMarkedItems === true || sourceRow.exclude_a_marked_items === true;
        const eligibleA = excludeA ? markedARows.filter(rowNumber => rowNumber < row.number) : [];
        const baseExpression = eligibleA.length
          ? `MAX(0,${dependency}-SUM(${eligibleA.map(rowNumber => `F${rowNumber}`).join(",")}))`
          : dependency;
        const factor = Number.isFinite(multiplier) ? multiplier : percentage / 100;
        const baseValue = refs.reduce((sum, rowNumber) => sum + (amountValuesByRow.get(rowNumber) || 0), 0)
          - eligibleA.reduce((sum, rowNumber) => sum + (amountValuesByRow.get(rowNumber) || 0), 0);
        const calculatedAmount = roundMoney(Math.max(0, baseValue) * factor);
        writeCalculationFormula(amountCell, `ROUND((${baseExpression})*${factor},2)`, calculatedAmount);
        amountValuesByRow.set(row.number, calculatedAmount);
        pendingAmountRows.push(row.number);
      }
    } else if (isTotalRow) {
      const totalValue = roundMoney(pendingAmountRows.reduce((sum, rowNumber) => sum + (amountValuesByRow.get(rowNumber) || 0), 0));
      if (pendingAmountRows.length) writeCalculationFormula(amountCell, `ROUND(${sumFormula(pendingAmountRows)},2)`, totalValue);
      amountValuesByRow.set(row.number, totalValue);
      pendingAmountRows = [row.number];
      if (mark) markRows.set(mark, [row.number]);
      firstFinancialRow = false;
    } else if (isBaseCostRow) {
      const baseQty = Math.max(0.0000001, num(sourceRow.baseQty ?? sourceRow.base_qty, calculationBaseQty));
      const unitTotal = pendingAmountRows.reduce((sum, rowNumber) => sum + (amountValuesByRow.get(rowNumber) || 0), 0);
      const formula = pendingAmountRows.length ? `ROUND(${sumFormula(pendingAmountRows)}*${baseQty},2)` : `ROUND(F${row.number - 1}*${baseQty},2)`;
      const result = roundMoney(unitTotal * baseQty);
      writeCalculationFormula(amountCell, formula, result);
      amountValuesByRow.set(row.number, result);
      baseCostRow = row.number;
    } else if (isUnitRateRow) {
      const baseQty = Math.max(0.0000001, num(sourceRow.baseQty ?? sourceRow.base_qty, calculationBaseQty));
      const sourceFormula = baseCostRow ? `F${baseCostRow}` : sumFormula(pendingAmountRows);
      const unitTotal = pendingAmountRows.reduce((sum, rowNumber) => sum + (amountValuesByRow.get(rowNumber) || 0), 0);
      const result = roundMoney((baseCostRow ? num(amountValuesByRow.get(baseCostRow)) : unitTotal) / baseQty);
      writeCalculationFormula(amountCell, `ROUND((${sourceFormula})/${baseQty},2)`, result);
      amountValuesByRow.set(row.number, result);
      unitRateRow = row.number;
    } else if (isSayRow) {
      const result = num(sourceRow.amount, sayRate);
      const sourceRowNumber = unitRateRow ?? row.number - 1;
      writeCalculationFormula(amountCell, `MROUND(F${sourceRowNumber},0.05)`, result);
      amountValuesByRow.set(row.number, result);
      if (rowRefs) {
        rowRefs.marketSayRows[currentContextKey] = row.number;
        rowRefs.marketSaySheets[currentContextKey] = sheet.name;
      }
    } else if (!isNCR) {
      const derivedExpression = algebraFormulaExpression(descriptionText, markRows, row.number,
        pendingAmountRows.length ? sumFormula(pendingAmountRows) : undefined);
      if (derivedExpression) {
        const result = fallbackAmount;
        writeCalculationFormula(amountCell, `ROUND(${derivedExpression},2)`, result);
        amountValuesByRow.set(row.number, result);
        pendingAmountRows.push(row.number);
      }
    }

    const isFinancialCalculationRow = isTotalRow || Number.isFinite(percentage) || isBaseCostRow || isUnitRateRow || isSayRow;
    for (let col = 1; col <= 7; col++) {
      const cell = row.getCell(col);
      cell.font = { name: FONT, size: 10, ...(isTotalRow && col === 2 ? { bold: true } : {}) };
      cell.alignment = {
        horizontal: col === 2 ? "left" : [4, 5, 6].includes(col) ? "right" : "center",
        vertical: "middle",
        ...(col === 2 ? { wrapText: true } : {}),
      };
      cell.border = {
        ...(isFinancialCalculationRow && firstFinancialRow ? { top: { style: "thin" as const } } : {}),
        left: { style: "thin" as const },
        right: { style: "thin" as const },
      };
    }
    const descLines = descriptionText.replace(/\r/g, "").split("\n").reduce((count, line) => count + (line.length ? Math.ceil(line.length / 46) : 1), 0);
    row.height = Math.max(18, descLines * 15);
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    row.getCell(2).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
    row.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(4).numFmt = "0.000";
    row.getCell(5).numFmt = INDIAN_AMOUNT;
    row.getCell(6).numFmt = INDIAN_AMOUNT;
    if (isSayRow) {
      row.getCell(6).font = { name: FONT, size: 10, bold: true };
      for (let col = 1; col <= 7; col++) {
        if (col !== 6) row.getCell(col).border = { ...(row.getCell(col).border || {}), bottom: { style: "thin" } };
      }
      row.getCell(6).border = BORDER_MEDIUM;
      if (rowRefs) {
        rowRefs.marketSayRows[currentContextKey] = row.number;
        if (!isSubAnalysis) rowRefs.marketUnitCostRows[contextBase] = unitRateRow ?? row.number;
      }
    }
    if (isTotalRow) {
      row.getCell(2).font = { name: FONT, size: 10, bold: true };
      row.getCell(6).font = { name: FONT, size: 10, bold: true };
      firstFinancialRow = false;
    }

    if (useMarket && rowType === "CR" && /^\d+(?:\.\d+)+$/.test(componentRawCode) && rowRefs) {
      const referencedMarketRate = analyses[componentRawCode]
        ? buildMarketRows(componentRawCode, data, analyses, marketCache).sayRate
        : resolveMarketRate(data, componentRawCode, sourceRow.rate);
      const targetIsNonSchedule = entry.nonScheduleContext || isNS(componentRawCode);
      const referencedBaseContext = `${targetIsNonSchedule ? "ns" : "schedule"}:${componentRawCode.toLowerCase()}`;
      const isSupportingTarget = options.subAnalysisCodes?.has(componentRawCode.toLowerCase()) === true;
      const targetContextKey = `${isSupportingTarget ? "sub:" : ""}${referencedBaseContext}`;
      const targetSheetName = isSupportingTarget
        ? targetIsNonSchedule ? "Sub AR (Market NS)" : "Sub AR (Market DSR and mDSR)"
        : targetIsNonSchedule ? "Rate Analysis (Market NS)" : "Rate Analysis (Market)";
      rowRefs.pendingMarketSubAnalysisLinks.push({
        row: row.number,
        sourceSheetName: sheet.name,
        sourceContextKey: currentContextKey,
        targetSheetName,
        targetContextKey,
        code: componentRawCode,
        fallbackRate: referencedMarketRate,
        divisor: componentDivisor(sourceRow),
      });
      if (isSupportingTarget && !isSubAnalysis) {
        rowRefs.marketSubReferrerRows[targetContextKey] ??= itemNumberRow.number;
      }
    }
    if (isSayRow) row.getCell(7).value = itemUnit || null;
  }
  if (!rows.some(row => row.isSayRow === true || row.is_say_row === true)) {
    const say = sheet.addRow(["", `Say (Market Rate)`, "", "", "", sayRate, ""]);
    for (let col = 1; col <= 7; col++) {
      say.getCell(col).font = { name: FONT, size: 10 };
      say.getCell(col).alignment = { horizontal: col === 2 ? "left" : "right", vertical: "middle", wrapText: col === 2 };
      say.getCell(col).border = { left: { style: "thin" }, right: { style: "thin" }, bottom: { style: "thin" } };
    }
    say.getCell(7).value = itemUnit || null;
    say.getCell(6).numFmt = INDIAN_AMOUNT;
    say.getCell(6).font = { name: FONT, size: 10, bold: true };
    say.getCell(6).border = BORDER_MEDIUM;
      if (rowRefs) {
        rowRefs.marketSayRows[currentContextKey] = say.number;
        rowRefs.marketSaySheets[currentContextKey] = sheet.name;
      }
  }
  sheet.addRow([]);
}

function linkMarketSubAnalysisRows(workbook: ExcelJS.Workbook, rowRefs: JustfnWorkbookRowRefs) {
  for (const link of rowRefs.pendingMarketSubAnalysisLinks) {
    const sourceSheet = workbook.getWorksheet(link.sourceSheetName);
    const targetSheet = workbook.getWorksheet(link.targetSheetName);
    if (!sourceSheet || !targetSheet) continue;
    const sayRow = rowRefs.marketSayRows[link.targetContextKey];
    const targetHeaderRow = rowRefs.marketItemHeaderRows[link.targetContextKey];
    if (sayRow) {
      const rateCell = sourceSheet.getCell(link.row, 5);
      rateCell.value = { formula: `'${link.targetSheetName}'!F${sayRow}`, result: link.fallbackRate };
      const amountCell = sourceSheet.getCell(link.row, 6);
      amountCell.value = {
        formula: link.divisor && link.divisor !== 1
          ? `ROUND((D${link.row}*E${link.row})/${link.divisor},2)`
          : `ROUND(D${link.row}*E${link.row},2)`,
        result: num(sourceSheet.getCell(link.row, 4).value) * link.fallbackRate / (link.divisor || 1),
      };
    }
    if (targetHeaderRow) {
      const codeCell = sourceSheet.getCell(link.row, 1);
      const display = link.code.replace(/"/g, '""');
      const quotedSheet = link.targetSheetName.replace(/'/g, "''");
      codeCell.value = { formula: `HYPERLINK("#'${quotedSheet}'!A${targetHeaderRow}","${display}")`, result: link.code };
      codeCell.font = { name: FONT, size: 10, color: { argb: "FFFF0000" }, underline: true };
      if (link.targetSheetName.startsWith("Sub AR (Market")) {
        const subCodeRow = rowRefs.marketItemCodeRows[link.targetContextKey];
        const returnRow = rowRefs.marketSubReferrerRows[link.targetContextKey];
        const mainSheetName = rowRefs.marketItemSheetNames[link.sourceContextKey];
        const mainSheet = mainSheetName ? workbook.getWorksheet(mainSheetName) : undefined;
        if (subCodeRow && returnRow && mainSheet) {
          const subCodeCell = targetSheet.getCell(subCodeRow, 1);
          const quotedMain = mainSheet.name.replace(/'/g, "''");
          subCodeCell.value = { formula: `HYPERLINK("#'${quotedMain}'!A${returnRow}","${link.code}")`, result: link.code };
          subCodeCell.font = { name: FONT, size: 10, color: { argb: "FFFF0000" }, underline: true };
        }
      }
    }
  }
}

export function buildRateListSheetLayout(
  sheet: ExcelJS.Worksheet,
  data: JustfnExportData,
  selectedEntries: Array<{ code: string; nonScheduleContext: boolean }>,
  analyses: Record<string, any[]>,
  rowRefs?: JustfnWorkbookRowRefs,
) {
  const details = data.estimateData.projectDetails;
  sheet.views = [{ state: "normal", style: "pageBreakPreview", showGridLines: false }];
  sheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    scale: 90,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  const estimateId = text(details.estimateId ?? (data.estimateData as any).estimateId);
  const rateListFooter = `&LRATE LIST&CPage &P of &N&R${estimateId}`;
  sheet.headerFooter = { oddFooter: rateListFooter, evenFooter: rateListFooter };
  const widths = [8, 8, 50, 10, 10, 10];
  widths.forEach((width, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = width;
    column.style = { font: { name: FONT, size: 10 } };
  });

  // Keep the title and work name while removing the unused blank rows at the top.
  const title = sheet.addRow(["RATE LIST"]);
  sheet.mergeCells(title.number, 1, title.number, 6);
  title.height = 22;
  title.getCell(1).font = { name: FONT, size: 10, bold: true };
  title.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  const workName = sheet.addRow([`Name of Work: ${text(details.nameOfWork)}`]);
  sheet.mergeCells(workName.number, 1, workName.number, 6);
  workName.height = Math.max(22, Math.ceil(text(details.nameOfWork).length / 95) * 16);
  workName.getCell(1).font = { name: FONT, size: 10, bold: true };
  workName.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  const header = sheet.addRow(["Sl. No.", "Code", "Description", "Unit", "DSR Rate (₹)", "Market Rate (₹)"]);
  sheet.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
  header.height = 30;
  for (let column = 1; column <= 6; column++) {
    const cell = header.getCell(column);
    cell.font = { name: FONT, size: 10, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  }

  const usedComponents = new Map<string, { code: string; fallback: any }>();
  // Collect every basic component from both the source analyses and the derived
  // market analyses for the selected BOQ scope. Numeric code normalization
  // ensures values such as 0295 and 295 resolve to the same master record.
  const rateListEntries = data.statementRows.length ? selectedEntries : [];
  const marketCache = new Map<string, MarketAnalysisResult>();
  const collectComponents = (rows: any[]) => {
    for (const analysisRow of rows) {
      if (isFinancialRow(analysisRow)) continue;
      const rawCode = analysisComponentCode(analysisRow);
      const normalizedCode = normalizeBasicRateCode(rawCode);
      if (!rateListCategory(normalizedCode)) continue;
      if (!usedComponents.has(normalizedCode)) usedComponents.set(normalizedCode, { code: rawCode, fallback: analysisRow });
    }
  };
  for (const entry of rateListEntries) {
    // Collect from the same recalculated Market RA row set used for the
    // market-analysis sheet. NS entries return their native project analysis.
    const marketAnalysisRows = buildMarketRows(entry.code, data, analyses, marketCache).rows;
    collectComponents(marketAnalysisRows);
  }

  const marketRateFor = (code: string, fallbackRate?: unknown) => resolveMarketRate(data, code, fallbackRate);

  const masterRateByCode = new Map<string, any>();
  for (const rate of data.estimateData.rates) {
    const rawCode = text((rate as any).code ?? (rate as any).itemCode).trim();
    const normalizedCode = normalizeBasicRateCode(rawCode);
    if (rateListCategory(normalizedCode) && !masterRateByCode.has(normalizedCode)) masterRateByCode.set(normalizedCode, rate);
  }
  const itemsByCategory = new Map<RateListCategory, Array<{ code: string; rate: any; category: RateListCategory }>>(
    RATE_LIST_CATEGORIES.map(category => [category.id, []]),
  );
  for (const [normalizedCode, component] of usedComponents) {
    const category = rateListCategory(normalizedCode);
    if (!category) continue;
    const rate = masterRateByCode.get(normalizedCode) ?? {
      code: component.code,
      description: component.fallback.description,
      unit: component.fallback.unit,
      rate: component.fallback.rate,
    };
    itemsByCategory.get(category)!.push({ code: text((rate as any).code ?? component.code), rate, category });
  }
  for (const category of RATE_LIST_CATEGORIES) {
    itemsByCategory.get(category.id)!.sort((a, b) => sortCode(a.code, b.code));
  }

  let serial = 0;
  let lastDataRow: ExcelJS.Row | undefined;
  for (const category of RATE_LIST_CATEGORIES) {
    const categoryHeader = sheet.addRow([category.title]);
    sheet.mergeCells(categoryHeader.number, 1, categoryHeader.number, 6);
    categoryHeader.height = 21;
    categoryHeader.getCell(1).font = { name: FONT, size: 10, bold: true };
    categoryHeader.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    for (let column = 1; column <= 6; column++) categoryHeader.getCell(column).border = BORDER_THIN;
    lastDataRow = categoryHeader;

    for (const item of itemsByCategory.get(category.id) || []) {
      const code = text((item.rate as any).code ?? item.code).trim();
      const description = text((item.rate as any).description ?? item.code);
      const marketRateValue = marketRateFor(code, (item.rate as any).rate ?? (item.rate as any).dsrRate);
      const row = sheet.addRow([
        ++serial,
        code,
        description,
        text((item.rate as any).unit ?? item.rate.unit),
        num((item.rate as any).rate ?? item.rate.rate),
        marketRateValue === null || marketRateValue === undefined || String(marketRateValue).trim() === "" ? null : num(marketRateValue),
      ]);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: FONT, size: 10 };
        cell.border = BORDER_HAIR;
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
      row.getCell(3).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
      for (const column of [5, 6]) row.getCell(column).numFmt = INDIAN_AMOUNT;
      const lineCount = Math.max(1, ...description.split(/\r?\n/).map(line => Math.ceil(line.length / 75)));
      row.height = Math.max(15, lineCount * 15);
      lastDataRow = row;
      if (rowRefs) rowRefs.rateListRows[normalizeBasicRateCode(code)] = row.number;
    }
  }

  if (!usedComponents.size) {
    const emptyRow = sheet.addRow(["No basic-rate components are used by the selected items."]);
    sheet.mergeCells(emptyRow.number, 1, emptyRow.number, 6);
    emptyRow.height = 22;
    emptyRow.getCell(1).font = { name: FONT, size: 10 };
    emptyRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    lastDataRow = emptyRow;
  }
  if (lastDataRow) {
    for (let column = 1; column <= 6; column++) {
      const cell = lastDataRow.getCell(column);
      cell.border = { ...(cell.border || BORDER_HAIR), bottom: { style: "medium" } };
    }
  }

  addSignatureBlock(sheet, details, 6);
  sheet.eachRow({ includeEmpty: true }, row => row.eachCell({ includeEmpty: true }, cell => {
    const currentFont = cell.font ?? {};
    cell.font = { ...currentFont, name: FONT, size: currentFont.size ?? 10 };
  }));
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, estimateId: string, prefix: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${prefix}_${String(estimateId || "Estimate").replace(/[^\w-]+/g, "_")}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportJustfnStatementToExcel(data: JustfnExportData, estimateId = "Estimate") {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const statement = workbook.addWorksheet("Justfn Statement");
  await buildJustfnStatementLayout(statement, data, undefined, estimateId);
  await downloadWorkbook(workbook, estimateId, "Justfn_Statement");
}

export async function exportJustfnStatementToPdf(data: JustfnExportData, estimateId = "Estimate", printWindow?: Window | null) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const statement = workbook.addWorksheet("Justfn Statement");
  await buildJustfnStatementLayout(statement, data, undefined, estimateId);
  exportEstimateWorkbookToPdf(workbook, estimateId, "Justfn_Statement", printWindow);
}

export async function exportJustfnFrontSheetToExcel(data: JustfnExportData, estimateId = "Estimate") {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const frontSheet = workbook.addWorksheet("Front Sheet");
  await buildJustfnFrontSheetLayout(frontSheet, data, estimateId);
  await downloadWorkbook(workbook, estimateId, "Justfn_Front_Sheet");
}

export async function exportJustfnFrontSheetToPdf(data: JustfnExportData, estimateId = "Estimate", printWindow?: Window | null) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const frontSheet = workbook.addWorksheet("Front Sheet");
  await buildJustfnFrontSheetLayout(frontSheet, data, estimateId);
  exportEstimateWorkbookToPdf(workbook, estimateId, "Justfn_Front_Sheet", printWindow);
}

/** Export only the Rate List sheet, using the same builder as the master file. */
export async function exportRateListSingleSheetToExcel(data: JustfnExportData, estimateId = "Estimate") {
  const rateListData: JustfnExportData = {
    ...data,
    // The standalone Rate List represents every item currently in the estimate;
    // the master Justfn export continues to pass only its selected statement rows.
    statementRows: data.estimateData.estimateRows || [],
  };
  const analyses = await loadAnalyses(rateListData);
  const entries = analysisEntries(rateListData, analyses);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const rateListSheet = workbook.addWorksheet("Rate List");
  buildRateListSheetLayout(rateListSheet, rateListData, entries, analyses);
  await downloadWorkbook(workbook, estimateId, "Rate_List");
}

export async function exportRateListSingleSheetToPdf(data: JustfnExportData, estimateId = "Estimate", printWindow?: Window | null) {
  const rateListData: JustfnExportData = {
    ...data,
    statementRows: data.estimateData.estimateRows || [],
  };
  const analyses = await loadAnalyses(rateListData);
  const entries = analysisEntries(rateListData, analyses);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet("Rate List");
  buildRateListSheetLayout(sheet, rateListData, entries, analyses);
  exportEstimateWorkbookToPdf(workbook, estimateId, "Rate_List", printWindow);
}

export async function exportMasterJustfnToExcel(
  data: JustfnExportData,
  estimateId = "Estimate",
  output: "excel" | "pdf" = "excel",
  printWindow?: Window | null,
) {
  let exportData = data;
  if (typeof window !== "undefined") {
    try {
      const savedSettings = window.localStorage.getItem("esti-pro-nsr-custom-charges-v1");
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        exportData = {
          ...data,
          customCharges: data.customCharges ?? (Array.isArray(parsed.charges) ? parsed.charges : undefined),
          excludeAMarkedItems: data.excludeAMarkedItems ?? (typeof parsed.excludeAMarkedItems === "boolean" ? parsed.excludeAMarkedItems : undefined),
        };
      }
    } catch (error) {
      console.warn("Could not load the saved market calculation settings for the Justification export.", error);
    }
  }
  const exportEstimateId = estimateId !== "Estimate"
    ? estimateId
    : text(exportData.estimateData.projectDetails.estimateId, estimateId);
  const analyses = await loadAnalyses(exportData);
  const entries = analysisEntries(exportData, analyses);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const summarySheet = workbook.addWorksheet("Front Sheet");
  const statementSheet = workbook.addWorksheet("Justfn Statement");
  const rateListSheet = workbook.addWorksheet("Rate List");
  const rowRefs: JustfnWorkbookRowRefs = {
    marketSayRows: {},
    marketSaySheets: {},
    marketUnitCostRows: {},
    marketItemHeaderRows: {},
    marketItemCodeRows: {},
    marketItemSheetNames: {},
    marketSubReferrerRows: {},
    rateListRows: {},
    analysisSayRefs: {},
    pendingMarketSubAnalysisLinks: [],
  };
  await buildJustfnFrontSheetLayout(summarySheet, exportData, exportEstimateId);
  buildRateListSheetLayout(rateListSheet, exportData, entries, analyses, rowRefs);

  // Use the same normalized, data-driven RA workbook builder as the tested
  // Estimate export. Keep only selected estimate roots in the main analysis
  // sheets; recursively referenced analyses are placed on the matching Sub-AR
  // sheet by the builder.
  const selectedRows = exportData.statementRows.length
    ? exportData.statementRows
    : exportData.estimateData.estimateRows;
  const rootCodes = [...new Set(selectedRows
    .map(row => text(row.itemCode ?? row.itemNo).trim())
    .filter(Boolean))].sort(sortCode);
  const statementSerialByCode = new Map(
    buildHierarchicalRows(aggregateItems(selectedRows, exportData.estimateData.rates), exportData.estimateData.rates)
      .filter(row => row.isItem)
      .map(row => [row.itemCode, row.serialNo] as const),
  );
  const itemExportData = (code: string): MultiRANSItemExportData => {
    const rateItem = findRateItemByCode(exportData.estimateData.rates, code) as any;
    const estimateRow = exportData.estimateData.estimateRows.find(row => text(row.itemCode).trim() === code) as any;
    return {
      ...(rateItem || {}),
      itemCode: code,
      // Rate-analysis blocks should carry the same hierarchical BOQ number
      // shown on the Justfn Statement (for example 1.1.1), not a flat row
      // sequence such as 38 from the source estimate table.
      itemNo: statementSerialByCode.get(code) ?? code,
      description: text(rateItem?.description ?? estimateRow?.description),
      unit: text(rateItem?.unit ?? estimateRow?.unit),
      rate: rateItem?.rate ?? estimateRow?.rate,
      baseQty: rateItem?.baseQty ?? rateItem?.base_qty ?? estimateRow?.baseQty ?? estimateRow?.base_qty,
      analysisRows: analyses[code] || [],
      isExternalAR: exportFlag(rateItem?.isExternalAR ?? rateItem?.is_external_ar ?? rateItem?.externalAR ?? rateItem?.external_ar),
      isParentHeading: exportFlag(rateItem?.isParentHeading ?? rateItem?.is_parent_heading ?? estimateRow?.isParentHeading ?? estimateRow?.is_parent_heading),
    };
  };
  const mainRateItems = rootCodes.map(itemExportData);
  const rootCodeSet = new Set(rootCodes.map(code => code.toLowerCase()));
  const supportingRateItems = entries
    .filter(entry => !rootCodeSet.has(entry.code.toLowerCase()))
    .map(entry => itemExportData(entry.code));
  const analysisSayRefs = await appendRateAnalysisSheetPairs(workbook, mainRateItems, supportingRateItems, [
    {
      mainName: "Rate Analysis (DSR and mDSR)",
      subName: "Sub AR (DSR and mDSR)",
      mainTitle: "RATE ANALYSIS (DSR AND mDSR ITEMS)",
      subTitle: "SUPPORTING SUB-ARs — DSR AND mDSR ITEMS",
      mainFooterTitle: "Rate Analysis of DSR and mDSR Items",
      subFooterTitle: "Sub-AR Items of DSR and mDSR",
      include: code => !isNS(code),
    },
    {
      mainName: "Rate Analysis (NS)",
      subName: "Sub AR (NS)",
      mainTitle: "RATE ANALYSIS FOR NON SCHEDULE ITEMS",
      subTitle: "SUPPORTING SUB-ARs — NS ITEMS",
      mainFooterTitle: "Rate Analysis of NS Items",
      subFooterTitle: "Sub-AR Items of NS",
      include: code => isNS(code),
    },
  ], exportEstimateId);
  rowRefs.analysisSayRefs = analysisSayRefs;

  const marketRootCodeSet = new Set(rootCodes.map(code => code.toLowerCase()));
  const marketMainEntries = entries.filter(entry => marketRootCodeSet.has(entry.code.toLowerCase()));
  const supportingEntryMap = new Map<string, { code: string; nonScheduleContext: boolean }>();
  for (const entry of entries) {
    if (marketRootCodeSet.has(entry.code.toLowerCase()) || !(analyses[entry.code] || []).length) continue;
    if (isExternal(findRateItemByCode(exportData.estimateData.rates, entry.code))) continue;
    const key = `${entry.nonScheduleContext ? "ns" : "schedule"}:${entry.code.toLowerCase()}`;
    if (!supportingEntryMap.has(key)) supportingEntryMap.set(key, entry);
  }
  const marketSubEntries = [...supportingEntryMap.values()];
  const marketSubCodeSet = new Set(marketSubEntries.map(entry => entry.code.toLowerCase()));
  const marketDsrEntries = marketMainEntries.filter(entry => !entry.nonScheduleContext);
  const marketNsEntries = marketMainEntries.filter(entry => entry.nonScheduleContext);
  const marketDsrSubEntries = marketSubEntries.filter(entry => !entry.nonScheduleContext);
  const marketNsSubEntries = marketSubEntries.filter(entry => entry.nonScheduleContext);
  const marketSheets = new Map<string, ExcelJS.Worksheet>();
  const marketDsrSheet = marketDsrEntries.length
    ? workbook.addWorksheet("Rate Analysis (Market)")
    : undefined;
  if (marketDsrSheet) {
    configureMarketAnalysisSheet(marketDsrSheet, "RATE ANALYSIS (MARKET)", "Rate Analysis of Market DSR and mDSR Items", exportEstimateId);
    marketSheets.set("schedule", marketDsrSheet);
  }
  const marketNsSheet = marketNsEntries.length
    ? workbook.addWorksheet("Rate Analysis (Market NS)")
    : undefined;
  if (marketNsSheet) {
    configureMarketAnalysisSheet(marketNsSheet, "RATE ANALYSIS (MARKET NS ITEMS)", "Rate Analysis of Market NS Items", exportEstimateId);
    marketSheets.set("ns", marketNsSheet);
  }
  const marketDsrSubSheet = marketDsrSubEntries.length
    ? workbook.addWorksheet("Sub AR (Market DSR and mDSR)")
    : undefined;
  if (marketDsrSubSheet) {
    configureMarketAnalysisSheet(marketDsrSubSheet, "SUPPORTING SUB-ARs — MARKET DSR AND mDSR", "Sub-AR Items of Market DSR and mDSR", exportEstimateId);
  }
  const marketNsSubSheet = marketNsSubEntries.length
    ? workbook.addWorksheet("Sub AR (Market NS)")
    : undefined;
  if (marketNsSubSheet) {
    configureMarketAnalysisSheet(marketNsSubSheet, "SUPPORTING SUB-ARs — MARKET NS", "Sub-AR Items of Market NS", exportEstimateId);
  }
  const marketCache = new Map<string, MarketAnalysisResult>();
  const renderMarketEntries = (
    sheet: ExcelJS.Worksheet | undefined,
    selectedEntries: Array<{ code: string; nonScheduleContext: boolean }>,
    isSubAnalysis: boolean,
  ) => {
    if (!sheet) return;
    selectedEntries.forEach((entry, index) => addAnalysisCard(
      sheet,
      entry,
      index,
      exportData,
      analyses[entry.code] || [],
      analyses,
      true,
      marketCache,
      rowRefs,
      statementSerialByCode.get(entry.code) ?? entry.code,
      { isSubAnalysis, rootCodes: marketRootCodeSet, subAnalysisCodes: marketSubCodeSet },
    ));
  };
  renderMarketEntries(marketDsrSheet, marketDsrEntries, false);
  renderMarketEntries(marketNsSheet, marketNsEntries, false);
  renderMarketEntries(marketDsrSubSheet, marketDsrSubEntries, true);
  renderMarketEntries(marketNsSubSheet, marketNsSubEntries, true);
  for (const sheet of [marketDsrSheet, marketNsSheet, marketDsrSubSheet, marketNsSubSheet]) {
    if (sheet) sheet.pageSetup.printArea = `A1:G${sheet.rowCount}`;
  }
  linkMarketSubAnalysisRows(workbook, rowRefs);
  await buildJustfnStatementLayout(statementSheet, exportData, rowRefs, exportEstimateId);
  if (rowRefs.statementSummary) linkFrontSheetToStatement(summarySheet, exportData, rowRefs.statementSummary);
  if (output === "pdf") exportEstimateWorkbookToPdf(workbook, exportEstimateId, "Master_Justfn", printWindow);
  else await downloadWorkbook(workbook, exportEstimateId, "Master_Justfn");
}

/** Export only the multi-item rate-analysis sheets, reusing the tested Justfn builders. */
export async function exportRateAnalysisWorkbook(
  data: JustfnExportData,
  variant: "dsr" | "market" = "dsr",
  output: "excel" | "pdf" = "excel",
  printWindow?: Window | null,
) {
  const exportEstimateId = text(data.estimateData.projectDetails.estimateId, "Estimate");
  const roots = data.estimateData.estimateRows || [];
  const exportData: JustfnExportData = { ...data, statementRows: roots };
  const analyses = await loadAnalyses(exportData);
  const entries = analysisEntries(exportData, analyses);
  const rootCodes = [...new Set(roots.map(row => text(row.itemCode ?? row.itemNo).trim()).filter(Boolean))].sort(sortCode);
  if (!rootCodes.length) throw new Error("There are no estimate items with rate analyses to export.");

  const serialByCode = new Map(
    buildHierarchicalRows(aggregateItems(roots, data.estimateData.rates), data.estimateData.rates)
      .filter(row => row.isItem)
      .map(row => [row.itemCode, row.serialNo] as const),
  );
  const itemExportData = (code: string): MultiRANSItemExportData => {
    const rateItem = findRateItemByCode(data.estimateData.rates, code) as any;
    const estimateRow = roots.find(row => text(row.itemCode ?? row.itemNo).trim() === code) as any;
    return {
      ...(rateItem || {}),
      itemCode: code,
      itemNo: serialByCode.get(code) ?? code,
      description: text(rateItem?.description ?? estimateRow?.description),
      unit: text(rateItem?.unit ?? estimateRow?.unit),
      rate: rateItem?.rate ?? estimateRow?.rate,
      baseQty: rateItem?.baseQty ?? rateItem?.base_qty ?? estimateRow?.baseQty ?? estimateRow?.base_qty,
      analysisRows: analyses[code] || [],
      isExternalAR: exportFlag(rateItem?.isExternalAR ?? rateItem?.is_external_ar ?? rateItem?.externalAR ?? rateItem?.external_ar),
      isParentHeading: exportFlag(rateItem?.isParentHeading ?? rateItem?.is_parent_heading ?? estimateRow?.isParentHeading ?? estimateRow?.is_parent_heading),
    };
  };
  const rootItems = rootCodes.map(itemExportData);
  const rootsSet = new Set(rootCodes.map(code => code.toLowerCase()));
  const supportingItems = entries
    .filter(entry => !rootsSet.has(entry.code.toLowerCase()))
    .map(entry => itemExportData(entry.code));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;

  if (variant === "dsr") {
    await appendRateAnalysisSheetPairs(workbook, rootItems, supportingItems, [
      {
        mainName: "Rate Analysis (DSR and mDSR)",
        subName: "Sub AR (DSR and mDSR)",
        mainTitle: "RATE ANALYSIS (DSR AND mDSR ITEMS)",
        subTitle: "SUPPORTING SUB-ARs — DSR AND mDSR ITEMS",
        mainFooterTitle: "Rate Analysis of DSR and mDSR Items",
        subFooterTitle: "Sub-AR Items of DSR and mDSR",
        include: code => !isNS(code),
      },
      {
        mainName: "Rate Analysis (NS)",
        subName: "Sub AR (NS)",
        mainTitle: "RATE ANALYSIS FOR NON SCHEDULE ITEMS",
        subTitle: "SUPPORTING SUB-ARs — NS ITEMS",
        mainFooterTitle: "Rate Analysis of NS Items",
        subFooterTitle: "Sub-AR Items of NS",
        include: code => isNS(code),
      },
    ], exportEstimateId);
  } else {
    const rootSet = new Set(rootCodes.map(code => code.toLowerCase()));
    const mainEntries = entries.filter(entry => rootSet.has(entry.code.toLowerCase()));
    const subMap = new Map<string, { code: string; nonScheduleContext: boolean }>();
    for (const entry of entries) {
      if (rootSet.has(entry.code.toLowerCase()) || !(analyses[entry.code] || []).length) continue;
      if (isExternal(findRateItemByCode(data.estimateData.rates, entry.code))) continue;
      const key = `${entry.nonScheduleContext ? "ns" : "schedule"}:${entry.code.toLowerCase()}`;
      if (!subMap.has(key)) subMap.set(key, entry);
    }
    const subEntries = [...subMap.values()];
    const dsrEntries = mainEntries.filter(entry => !entry.nonScheduleContext);
    const nsEntries = mainEntries.filter(entry => entry.nonScheduleContext);
    const dsrSubs = subEntries.filter(entry => !entry.nonScheduleContext);
    const nsSubs = subEntries.filter(entry => entry.nonScheduleContext);
    const refs: JustfnWorkbookRowRefs = {
      marketSayRows: {}, marketSaySheets: {}, marketUnitCostRows: {}, marketItemHeaderRows: {},
      marketItemCodeRows: {}, marketItemSheetNames: {}, marketSubReferrerRows: {}, rateListRows: {},
      analysisSayRefs: {}, pendingMarketSubAnalysisLinks: [],
    };
    const cache = new Map<string, MarketAnalysisResult>();
    const rootCodeSet = new Set(rootCodes.map(code => code.toLowerCase()));
    const subCodeSet = new Set(subEntries.map(entry => entry.code.toLowerCase()));
    const specs = [
      { name: "Rate Analysis (DSR and mDSR)", title: "RATE ANALYSIS (MARKET DSR AND mDSR ITEMS)", footer: "Rate Analysis of Market DSR and mDSR Items", entries: dsrEntries, isSub: false },
      { name: "Rate Analysis (NS)", title: "RATE ANALYSIS (MARKET NS ITEMS)", footer: "Rate Analysis of Market NS Items", entries: nsEntries, isSub: false },
      { name: "Sub AR (DSR and mDSR)", title: "SUPPORTING SUB-ARs — MARKET DSR AND mDSR", footer: "Sub-AR Items of Market DSR and mDSR", entries: dsrSubs, isSub: true },
      { name: "Sub AR (NS)", title: "SUPPORTING SUB-ARs — MARKET NS", footer: "Sub-AR Items of Market NS", entries: nsSubs, isSub: true },
    ];
    for (const spec of specs) {
      if (!spec.entries.length) continue;
      const sheet = workbook.addWorksheet(spec.name);
      configureMarketAnalysisSheet(sheet, spec.title, spec.footer, exportEstimateId);
      spec.entries.forEach((entry, index) => addAnalysisCard(
        sheet, entry, index, exportData, analyses[entry.code] || [], analyses, true, cache, refs,
        serialByCode.get(entry.code) ?? entry.code,
        { isSubAnalysis: spec.isSub, rootCodes: rootCodeSet, subAnalysisCodes: subCodeSet },
      ));
      sheet.pageSetup.printArea = `A1:G${sheet.rowCount}`;
    }
    linkMarketSubAnalysisRows(workbook, refs);
  }

  if (!workbook.worksheets.length) throw new Error("No rate-analysis items were available for the requested sheets.");
  const filePrefix = variant === "market" ? "RA_Market" : "Rate_Analysis";
  if (output === "pdf") exportEstimateWorkbookToPdf(workbook, exportEstimateId, filePrefix, printWindow);
  else await downloadWorkbook(workbook, exportEstimateId, filePrefix);
}
