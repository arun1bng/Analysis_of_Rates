import ExcelJS from "exceljs";
import { buildHierarchicalRows } from "./dsrHierarchy";

type ZipFile = { name: string; data: string | Uint8Array };
type MeasurementSourceItem = { itemCode?: unknown; code?: unknown; unit?: unknown };
type MeasurementDocumentSettings = {
  projectDetails?: Partial<Record<"state" | "division" | "branch" | "subDivision" | "leftAETitle" | "leftAEOffice" | "rightAETitle" | "rightAEOffice", string>>;
};

export type SharedEstimateData = {
  estimateRows: Array<Record<string, unknown>>;
  rates: Array<Record<string, unknown>>;
  marketRates: Record<string, number | string | null | undefined>;
  projectDetails: Record<string, unknown>;
  rateAnalyses?: Record<string, any>;
};

export type SharedWorkbookRowRefs = {
  msmt: Record<string, { descRow: number; totalQtyRow?: number }>;
  abst: Record<string, { descRow: number; subtotalRow?: number; itemRow?: number }>;
  customRateAnalyses?: Record<string, { sheetName: string; descriptionRow: number; sayRow: number; description: string; unit: string; rate: number }>;
};

type SharedItemGroup = {
  itemCode: string;
  description: string;
  unit: string;
  rate: number;
  quantity: number;
  rows: Array<Record<string, unknown>>;
};

type SharedSubtotal = { code: string; label: string; row: number; amount: number; serial: string };

const sharedNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const sharedText = (value: unknown, fallback = "") => String(value ?? fallback);
const sharedFirstText = (...values: unknown[]) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const candidate = String(value).trim();
    if (candidate) return candidate;
  }
  return "";
};
const sharedSectionKey = (code: string) => `SH:${code}`;
const sharedSectionLabel = (code: string, label: string) => {
  if (code === "50") return "SH 50: MODIFIED DSR ITEMS";
  if (code === "51") return "SH 51: NON-SCHEDULED ITEMS";
  return label;
};
const sharedRowHeight = (text: string, charsPerLine: number, lineHeight: number) => {
  const lines = text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.max(lineHeight, lines * lineHeight);
};
const measurementDescriptionHeight = (text: string) => {
  const descriptionText = text.trim();
  if (!descriptionText) return 15;
  const charsPerLine = 95;
  const textLines = descriptionText.split(/\r?\n/);
  const numLines = textLines.reduce((total, line) => total + (Math.ceil(line.length / charsPerLine) || 1), 0);
  return numLines * 15;
};

function sharedContext(data: SharedEstimateData) {
  const rateByCode = new Map<string, Record<string, unknown>>();
  for (const rate of data.rates) {
    const code = sharedText(rate.code ?? rate.itemCode).trim();
    if (code && !rateByCode.has(code)) rateByCode.set(code, rate);
  }
  const groups = new Map<string, SharedItemGroup>();
  for (const row of data.estimateRows) {
    const code = sharedText(row.itemCode).trim() || sharedText(row.dsrCode ?? row.code).trim();
    if (!code) continue;
    let group = groups.get(code);
    if (!group) {
      const base = rateByCode.get(code);
      group = {
        itemCode: code,
        // Keep measurement quantities from the estimate row, while resolving
        // mutable NS/mDSR metadata and rates from the latest saved rate record.
        description: sharedFirstText(row.userDescription, base?.description, base?.itemDescription, base?.item_description, row.description),
        unit: sharedFirstText(base?.unit, row.unit),
        rate: sharedNumber((/^(?:NSR|51\.)/i.test(code) ? data.marketRates[code] : undefined)
          ?? base?.rate ?? base?.dsrRate ?? base?.dsr_rate ?? row.rate),
        quantity: 0,
        rows: [],
      };
      groups.set(code, group);
    }
    group.quantity += sharedNumber(row.quantity);
    group.rows.push(row);
  }
  const items = [...groups.values()];
  return { groups, hierarchyRows: buildHierarchicalRows(items, data.rates), projectDetails: data.projectDetails };
}

function sharedDsrCode(itemCode: string, data: SharedEstimateData, rows: Array<Record<string, unknown>> = []) {
  const rate = data.rates.find(candidate =>
    sharedText(candidate.code ?? candidate.itemCode).trim() === itemCode,
  );
  return sharedText(rows.find(item => sharedText(item.dsrCode).trim())?.dsrCode).trim()
    || sharedText(rate?.dsrCode).trim()
    || sharedText(rows.find(item => sharedText(item.code).trim())?.code).trim()
    || sharedText(rate?.code ?? rate?.itemCode).trim()
    || itemCode;
}

function sharedCellFormula(sheet: ExcelJS.Worksheet, row: number, column: number, formula: string, result: number | string) {
  sheet.getCell(row, column).value = { formula, result };
}

function sharedTitle(
  sheet: ExcelJS.Worksheet,
  title: string,
  workName: string,
  details: Record<string, unknown>,
  lastColumn = 7,
  generalAbstract = false,
) {
  const lastColumnLetter = columnName(lastColumn);
  // Keep the division details in a wide merged range so long names do not clip.
  const leftInfoEnd = lastColumn > 7 ? 6 : generalAbstract ? 2 : 3;
  const rightInfoStart = generalAbstract ? 6 : leftInfoEnd + 1;
  const rightInfoStartLetter = columnName(rightInfoStart);
  const leftInfoEndLetter = columnName(leftInfoEnd);
  sheet.mergeCells(`A1:${lastColumnLetter}1`);
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { name: "Book Antiqua", size: 14, bold: true };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 24;
  sheet.getCell("A3").value = `STATE : ${sharedText(details.state, "GOA")}`;
  sheet.getCell(`${rightInfoStartLetter}3`).value = `DIVISION : ${sharedText(details.division, "GCD")}`;
  sheet.getCell("A4").value = `BRANCH : ${sharedText(details.branch, "B&R")}`;
  sheet.getCell(`${rightInfoStartLetter}4`).value = `SUB DIVISION : ${sharedText(details.subDivision, "Kolhapur Sub Division")}`;
  sheet.mergeCells(`A3:${leftInfoEndLetter}3`);
  sheet.mergeCells(`A4:${leftInfoEndLetter}4`);
  sheet.mergeCells(`${rightInfoStartLetter}3:${lastColumnLetter}3`);
  sheet.mergeCells(`${rightInfoStartLetter}4:${lastColumnLetter}4`);
  sheet.getRow(3).height = 20;
  sheet.getRow(4).height = 30;
  for (const address of ["A3", `${rightInfoStartLetter}3`, "A4", `${rightInfoStartLetter}4`]) {
    sheet.getCell(address).font = { name: "Book Antiqua", size: 10 };
  }
  sheet.getCell("A3").alignment = sheet.getCell("A4").alignment = { horizontal: "left", vertical: "middle" };
  sheet.getCell(`${rightInfoStartLetter}3`).alignment = { horizontal: "right", vertical: "middle", wrapText: true, shrinkToFit: true };
  sheet.getCell(`${rightInfoStartLetter}4`).alignment = { horizontal: "right", vertical: "middle", wrapText: true, shrinkToFit: true };
  sheet.mergeCells(`A6:${lastColumnLetter}6`);
  sheet.getCell("A6").value = `Name of Work : ${workName}`;
  sheet.getCell("A6").font = { name: "Book Antiqua", size: 10 };
  sheet.getCell("A6").alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.getRow(6).height = Math.max(18, Math.ceil(workName.length / 100) * 18);
  sheet.addRow([]);
}

function sharedFormattedCellValue(cell: ExcelJS.Cell): string {
  const value = cell.value;
  const raw = value && typeof value === "object" && "result" in value
    ? (value as { result?: unknown }).result
    : value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const numFmt = cell.numFmt || "";
    const decimals = numFmt.split(".")[1]?.match(/[0#]+/)?.[0] || "";
    const minFractionDigits = decimals.split("").filter(char => char === "0").length;
    const maxFractionDigits = decimals.length;
    return new Intl.NumberFormat("en-IN", {
      useGrouping: true,
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    }).format(raw);
  }
  if (typeof raw === "object" && "text" in raw) return String((raw as { text?: unknown }).text ?? "");
  if (typeof raw === "object" && "richText" in raw) return (raw as { richText: Array<{ text: string }> }).richText.map(part => part.text).join("");
  return String(raw);
}

function sharedAutoFitColumn(sheet: ExcelJS.Worksheet, column: number, minWidth: number, maxWidth: number) {
  let longest = 0;
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const cell = sheet.getCell(rowNumber, column);
    if (cell.isMerged) continue;
    const text = sharedFormattedCellValue(cell);
    const lineLength = text.split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
    longest = Math.max(longest, lineLength);
  }
  sheet.getColumn(column).width = Math.max(minWidth, Math.min(maxWidth, longest + 2));
}

function sharedHeader(sheet: ExcelJS.Worksheet, values: string[]) {
  const header = sheet.addRow(values);
  header.height = 30;
  header.eachCell({ includeEmpty: true }, cell => {
    cell.font = { name: "Book Antiqua", size: 10, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });
}

function sharedTableStyles(sheet: ExcelJS.Worksheet, endRow: number, lastColumn: number, measurement = false) {
  const standardBorder: Partial<ExcelJS.Borders> = measurement
    ? { top: { style: "hair" }, bottom: { style: "hair" }, left: { style: "thin" }, right: { style: "thin" } }
    : { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  const headerBorder: Partial<ExcelJS.Borders> = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  for (let rowNumber = 8; rowNumber <= endRow; rowNumber++) {
    for (let column = 1; column <= lastColumn; column++) {
      const cell = sheet.getCell(rowNumber, column);
      cell.font = { name: "Book Antiqua", size: 10, ...(cell.font || {}) };
      cell.border = measurement && rowNumber === 8 ? headerBorder : standardBorder;
      if (!measurement) {
        const mergedFinancialLabel = column === 2
          && typeof sheet.getCell(rowNumber, 1).value === "string"
          && sheet.getCell(rowNumber, 2).value == null;
        if (column === 2 && !mergedFinancialLabel) cell.alignment = { ...cell.alignment, vertical: "middle", wrapText: true };
        continue;
      }
      if (column === 1 || column === 12) cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      else if (column === 2) cell.alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
      else if ((column >= 3 && column <= 9) || column === 11) cell.alignment = { horizontal: "center", vertical: "middle", ...(column === 11 ? { wrapText: true } : {}) };
      else if (column === 10) cell.alignment = { horizontal: "right", vertical: "middle" };
    }
  }
}

function sharedSignatories(sheet: ExcelJS.Worksheet, details: Record<string, unknown>, lastColumn = 7) {
  const measurementLayout = lastColumn > 7;
  const lastColumnLetter = columnName(lastColumn);
  for (let index = 0; index < 3; index++) sheet.addRow([]);
  const titleRow = sheet.addRow([]);
  titleRow.height = 20;
  const officeRow = sheet.addRow([]);
  officeRow.height = 20;
  titleRow.getCell(1).value = sharedText(details.leftAETitle, "Assistant Engineer,");
  officeRow.getCell(1).value = sharedText(details.leftAEOffice, "CPWD, Kolhapur.");
  const leftEndColumn = measurementLayout ? 6 : 4;
  const rightStartColumn = measurementLayout ? 7 : 5;
  const rightEndColumn = measurementLayout ? 12 : 7;
  titleRow.getCell(rightStartColumn).value = sharedText(details.rightAETitle, "Assistant Engineer,");
  officeRow.getCell(rightStartColumn).value = sharedText(details.rightAEOffice, "GCD, CPWD, Goa.");
  for (const row of [titleRow, officeRow]) {
    sheet.mergeCells(`A${row.number}:${columnName(leftEndColumn)}${row.number}`);
    sheet.mergeCells(`${columnName(rightStartColumn)}${row.number}:${columnName(rightEndColumn)}${row.number}`);
    row.getCell(1).font = row.getCell(rightStartColumn).font = { name: "Book Antiqua", size: 10 };
    for (let column = 1; column <= leftEndColumn; column++) {
      row.getCell(column).alignment = { horizontal: "left", vertical: "middle", wrapText: false, shrinkToFit: true };
    }
    for (let column = rightStartColumn; column <= rightEndColumn; column++) {
      row.getCell(column).alignment = { horizontal: "right", vertical: "middle", wrapText: false, shrinkToFit: true };
    }
  }
  const signatureSpacer = sheet.addRow([]);
  signatureSpacer.height = 20;
  const executiveTitle = sheet.addRow([sharedText(details.eeTitle, "Executive Engineer & Senior Manager (C)-I,")]);
  const executiveOffice = sheet.addRow([sharedText(details.eeOffice, "GCD, CPWD, Goa.")]);
  for (const row of [executiveTitle, executiveOffice]) {
    row.height = 20;
    row.getCell(1).font = { name: "Book Antiqua", size: 10 };
    sheet.mergeCells(`A${row.number}:${lastColumnLetter}${row.number}`);
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
}

function sharedConfigurePrint(sheet: ExcelJS.Worksheet, title: string, estimateId: string, orientation: "portrait" | "landscape", general = false) {
  sheet.views = [{ state: "normal", style: "pageBreakPreview" }];
  sheet.pageSetup = {
    paperSize: 9,
    orientation,
    scale: 85,
    fitToPage: false,
    printTitlesRow: "8:8",
    margins: { left: 0.75, right: 0.75, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  const safeId = (estimateId || "N/A").replace(/&/g, "&&");
  sheet.headerFooter = {
    oddFooter: general ? `&LGeneral Abstract&R${safeId}` : `&L${title}&CPage &P of &N&R${safeId}`,
    evenFooter: general ? `&LGeneral Abstract&R${safeId}` : `&L${title}&CPage &P of &N&R${safeId}`,
  };
}

function sharedSummaryRow(sheet: ExcelJS.Worksheet, label: string, amount: number, formula: string, reference = "", bold = true, labelColumn = 2, labelAlignment: "left" | "right" = "left") {
  const values: Array<string | number | null> = [null, null, null, null, null, amount, reference];
  values[labelColumn - 1] = label;
  const row = sheet.addRow(values);
  row.height = sharedRowHeight(label, 48, 15);
  sheet.mergeCells(`${columnName(labelColumn)}${row.number}:E${row.number}`);
  row.getCell(labelColumn).font = { name: "Book Antiqua", size: 10, bold };
  row.getCell(labelColumn).alignment = { horizontal: labelAlignment, vertical: "middle", wrapText: true };
  sharedCellFormula(sheet, row.number, 6, formula, amount);
  row.getCell(6).font = { name: "Book Antiqua", size: 10, bold };
  row.getCell(6).numFmt = "##,##,##0";
  row.getCell(6).alignment = { horizontal: "right", vertical: "middle", shrinkToFit: true };
  row.getCell(7).alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
  return row.number;
}

function sharedFinancialSummary(sheet: ExcelJS.Worksheet, subtotals: SharedSubtotal[], details: Record<string, unknown>, labelColumn = 2, mergeSeparator = false) {
  const separatorRow = sheet.addRow([]);
  if (mergeSeparator) sheet.mergeCells(`A${separatorRow.number}:G${separatorRow.number}`);
  const addSummaryRow = (label: string, amount: number, formula: string, reference = "", bold = true, labelAlignment: "left" | "right" = "left") =>
    sharedSummaryRow(sheet, label, amount, formula, reference, bold, labelColumn, labelAlignment);
  const rate = sharedNumber(details.costIndex);
  const factor = sharedNumber(details.gstModificationFactor, 1) || 1;
  const scheduled = subtotals.filter(row => row.code !== "51");
  const nonScheduled = subtotals.filter(row => row.code === "51");
  const sumFormula = (items: SharedSubtotal[]) => items.length
    ? `ROUND(SUM(${items.map(item => `F${item.row}`).join(",")}),0)`
    : "ROUND(0,0)";
  const totalSchedule = Math.round(scheduled.reduce((sum, item) => sum + item.amount, 0));
  const totalScheduleRow = addSummaryRow("Total of Schedule & mDSR Items:", totalSchedule, sumFormula(scheduled), "A");
  const ci = Math.round(totalSchedule * rate / 100);
  const ciRow = rate ? addSummaryRow(`Add Cost Index @ ${rate}% on DSR & mDSR Items:`, ci, `ROUND(F${totalScheduleRow}*${rate / 100},0)`, `${rate / 100}A`, false, "left") : undefined;
  const dsrEnhanced = totalSchedule + (ciRow ? ci : 0);
  const enhancedRow = ciRow
    ? addSummaryRow(`Subtotal of DSR and mDSR items enhanced by CI @ ${rate}%:`, dsrEnhanced, `ROUND(F${totalScheduleRow}+F${ciRow},0)`, `B = ${1 + rate / 100}`)
    : totalScheduleRow;
  const modifiedCost = Math.round(dsrEnhanced * factor);
  const modifiedRow = addSummaryRow(`Modified estimated cost after applying multiplying factor (${factor}) on DSR and mDSR items:`, modifiedCost, `ROUND(F${enhancedRow}*${factor},0)`, "C");
  const nonScheduleAmount = Math.round(nonScheduled.reduce((sum, item) => sum + item.amount, 0));
  const nsRow = addSummaryRow("Total of Non-Schedule (NS) Items:", nonScheduleAmount, sumFormula(nonScheduled), "D", false);
  const base = modifiedCost + nonScheduleAmount;
  const baseRow = addSummaryRow("Base Estimate Total (Schedule + Non-Schedule):", base, `ROUND(F${modifiedRow}+F${nsRow},0)`, "E = C + D");
  sheet.getCell(baseRow, 7).font = { name: "Book Antiqua", size: 10, bold: true };
  const epfRate = sharedNumber(details.epf) / 100;
  const esiRate = sharedNumber(details.esi) / 100;
  const epf = Math.round(base * epfRate);
  const esi = Math.round(base * esiRate);
  const contributionRows = [
    addSummaryRow(`Add EPF @ ${sharedNumber(details.epf).toFixed(3)}%:`, epf, `ROUND(F${baseRow}*${epfRate},0)`, "F", false, "left"),
    addSummaryRow(`Add ESI @ ${sharedNumber(details.esi).toFixed(3)}%:`, esi, `ROUND(F${baseRow}*${esiRate},0)`, "G", false, "left"),
  ];
  let contingency = 0;
  let contingencyFormula = "";
  const contingencyType = details.contingencyType;
  if (contingencyType === "Custom (%)") {
    const customRate = sharedNumber(details.customContingency) / 100;
    contingency = Math.round(base * customRate);
    contingencyFormula = `ROUND(F${baseRow}*${customRate},0)`;
  } else if (contingencyType !== "Zero (0%)") {
    const percentage = base <= 10000000 ? 0.05 : 0.03;
    contingency = base <= 10000000 ? Math.round(base * percentage) : Math.max(500000, Math.round(base * percentage));
    contingencyFormula = base <= 10000000
      ? `ROUND(F${baseRow}*${percentage},0)`
      : `MAX(500000,ROUND(F${baseRow}*${percentage},0))`;
  }
  if (contingency > 0) {
    const label = contingencyType === "Custom (%)"
      ? `Add Contingency @ ${sharedNumber(details.customContingency)}%:`
      : `Add Contingency @ ${base <= 10000000 ? 5 : 3}%:`;
    contributionRows.push(addSummaryRow(label, contingency, contingencyFormula, "H", false, "left"));
  }
  const customTaxName = sharedText(details.customTaxName).trim();
  const customTaxRate = sharedNumber(details.customTaxRate) / 100;
  let customTax = 0;
  if (customTaxName && customTaxRate > 0) {
    customTax = Math.round(base * customTaxRate);
    contributionRows.push(addSummaryRow(
      `Add ${customTaxName} @ ${customTaxRate * 100}%:`,
      customTax,
      `ROUND(F${baseRow}*${customTaxRate},0)`,
      "I",
      false,
      "left",
    ));
  }
  const grand = base + epf + esi + contingency + customTax;
  const grandRow = addSummaryRow(
    "GRAND TOTAL:",
    grand,
    `ROUND(SUM(F${baseRow}:F${contributionRows[contributionRows.length - 1]}),0)`,
    contingency || customTax ? "E + F + G + H" : "E + F + G",
  );
  const say = Math.round(grand / 100) * 100;
  const sayRow = addSummaryRow("SAY:", say, `ROUND(F${grandRow},-2)`);
  sheet.getCell(sayRow, 6).font = { name: "Book Antiqua", size: 10, bold: true };
  return sayRow;
}

function sharedSummaryAmountBorders(sheet: ExcelJS.Worksheet) {
  const thickBorder: Partial<ExcelJS.Borders> = {
    top: { style: "medium" },
    bottom: { style: "medium" },
    left: { style: "medium" },
    right: { style: "medium" },
  };
  for (const label of ["Base Estimate Total (Schedule + Non-Schedule):", "SAY:"]) {
    const labelColumn = sheet.getColumn(1).values.includes(label) ? 1 : 2;
    const row = sheet.getColumn(labelColumn).values.findIndex(value => value === label);
    if (row > 0) sheet.getCell(row, 6).border = thickBorder;
  }
}

function alignFinancialSummaryLabelsLeft(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, labelColumn = 1) {
  const alignment: Partial<ExcelJS.Alignment> = { horizontal: "left", vertical: "middle", wrapText: true };
  for (let row = startRow; row <= endRow; row++) {
    const label = sheet.getCell(row, labelColumn);
    const firstMergedPlaceholder = sheet.getCell(row, labelColumn + 1);
    if (typeof label.value !== "string" || firstMergedPlaceholder.value != null) continue;
    for (let column = labelColumn; column <= 5; column++) {
      sheet.getCell(row, column).alignment = { ...alignment };
    }
  }
}

function sharedUnboldGeneralSummaryRows(sheet: ExcelJS.Worksheet) {
  const labels = [
    "Add Cost Index @ 15% on DSR & mDSR Items:",
    "Total of Non-Schedule (NS) Items:",
    "Add EPF @ 8.750%:",
    "Add ESI @ 2.275%:",
    "Add Contingency @ 5%:",
  ];
  for (const label of labels) {
    const labelColumn = sheet.getColumn(1).values.includes(label) ? 1 : 2;
    const row = sheet.getColumn(labelColumn).values.findIndex(value => value === label);
    if (row > 0) {
      sheet.getCell(row, labelColumn).font = { name: "Book Antiqua", size: 10, bold: false };
      sheet.getCell(row, 6).font = { name: "Book Antiqua", size: 10, bold: false };
    }
  }
}

export function buildMeasurementSheetLayout(
  worksheet: ExcelJS.Worksheet,
  estimateData: SharedEstimateData,
  estimateId: string,
  rowRefs: SharedWorkbookRowRefs | null = null,
) {
  sharedConfigurePrint(worksheet, "Measurement Sheet", estimateId, "portrait");
  worksheet.views = [{ state: "normal", style: "pageBreakPreview" }];
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    scale: 85,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "8:8",
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  const { groups, hierarchyRows, projectDetails } = sharedContext(estimateData);
  worksheet.getColumn(1).width = 6.5;
  worksheet.getColumn(2).width = 33.0;
  worksheet.getColumn(3).width = 3.5;
  worksheet.getColumn(4).width = 3.5;
  worksheet.getColumn(5).width = 3.5;
  worksheet.getColumn(6).width = 8.0;
  worksheet.getColumn(7).width = 8.0;
  worksheet.getColumn(8).width = 8.0;
  worksheet.getColumn(9).width = 5.0;
  worksheet.getColumn(10).width = 9.5;
  worksheet.getColumn(11).width = 5.5;
  worksheet.getColumn(12).width = 11.0;
  const projectName = sharedText(projectDetails.nameOfWork);
  sharedTitle(worksheet, "MEASUREMENT SHEET", projectName, projectDetails, 12);
  sharedHeader(worksheet, ["Item\nNo.", "Description", "No.", "No.", "No.", "Length", "Width", "Height", "Co-ef.", "Quantity", "Unit", "DSR\nCode"]);
  for (const entry of hierarchyRows) {
    if (entry.isSubhead) {
      const label = sharedSectionLabel(entry.sectionCode, entry.description);
      const row = worksheet.addRow([entry.serialNo, label, null, null, null, null, null, null, null, null, null, entry.sectionCode]);
      worksheet.mergeCells(`B${row.number}:K${row.number}`);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: "Book Antiqua", bold: true, size: 10 };
      });
      row.getCell(2).alignment = { wrapText: true, vertical: "middle", horizontal: "justify" };
      row.height = measurementDescriptionHeight(label);
      if (rowRefs) rowRefs.msmt[sharedSectionKey(entry.sectionCode)] = { descRow: row.number };
      continue;
    }
    if (entry.isParent) {
      const parentDsrCode = sharedDsrCode(entry.itemCode, estimateData);
      const row = worksheet.addRow([entry.serialNo, entry.description, null, null, null, null, null, null, null, null, null, parentDsrCode]);
      worksheet.mergeCells(`B${row.number}:K${row.number}`);
      row.getCell(2).alignment = { wrapText: true, vertical: "middle", horizontal: "justify" };
      row.height = measurementDescriptionHeight(entry.description);
      if (rowRefs) rowRefs.msmt[entry.itemCode] = { descRow: row.number };
      continue;
    }
    const group = groups.get(entry.itemCode);
    if (!group) continue;
    const dsrCode = sharedDsrCode(entry.itemCode, estimateData, group.rows);
    const itemHeader = worksheet.addRow([entry.serialNo, entry.description, null, null, null, null, null, null, null, null, null, dsrCode]);
    worksheet.mergeCells(`B${itemHeader.number}:K${itemHeader.number}`);
    itemHeader.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: "Book Antiqua", bold: false, size: 10 };
    });
    itemHeader.getCell(2).alignment = { wrapText: true, vertical: "middle", horizontal: "justify" };
    itemHeader.height = measurementDescriptionHeight(entry.description);
    if (rowRefs) rowRefs.msmt[entry.itemCode] = { descRow: itemHeader.number };
    const detailRows: number[] = [];
    const roundOffAmounts: number[] = [];
    for (const item of group.rows) {
      const description = sharedText(item.userDescription);
      const quantity = sharedNumber(item.quantity);
      const isRoundOff = /^rounded off$/i.test(description);
      if (isRoundOff) {
        roundOffAmounts.push(quantity);
        continue;
      }
      const detail = worksheet.addRow([
        null, description, item.nos === "" ? null : sharedNumber(item.nos, 1),
        item.num1 === "" ? null : sharedNumber(item.num1, 1), item.num2 === "" ? null : sharedNumber(item.num2, 1),
        item.length === "" ? null : sharedNumber(item.length, 1), item.breadth === "" ? null : sharedNumber(item.breadth, 1),
        item.height === "" ? null : sharedNumber(item.height, 1), item.coefficient === "" ? null : sharedNumber(item.coefficient, 1),
        null,
      ]);
      for (let column = 3; column <= 10; column++) {
        const cell = detail.getCell(column);
        if (cell.value !== null && cell.value !== undefined) cell.numFmt = column <= 5 ? "0.##" : "0.00";
      }
      detail.getCell(2).alignment = { wrapText: true, vertical: "middle", horizontal: "justify" };
      detail.height = measurementDescriptionHeight(description);
      const r = detail.number;
      const factors = ["C", "D", "E", "F", "G", "H", "I"].map(column => `IF(${column}${r}="",1,${column}${r})`).join("*");
      const hasDimensions = [item.nos, item.num1, item.num2, item.length, item.breadth, item.height, item.coefficient]
        .some(value => value !== "" && value !== null && value !== undefined);
      if (!hasDimensions) worksheet.getCell(r, 10).value = quantity;
      else sharedCellFormula(worksheet, r, 10, `ROUND(${factors},2)`, quantity);
      worksheet.getCell(r, 10).numFmt = "0.00";
      detailRows.push(r);
    }
    let totalRow = itemHeader.number;
    if (detailRows.length || roundOffAmounts.length) {
      const calcStartRow = detailRows[0];
      const calcEndRow = detailRows[detailRows.length - 1];
      const totalFormula = detailRows.length ? `ROUND(SUM(J${calcStartRow}:J${calcEndRow}),2)` : "ROUND(0,2)";
      totalRow = worksheet.addRow([null, "Total", null, null, null, null, null, null, null,
        { formula: totalFormula,
          result: detailRows.reduce((sum, row) => sum + sharedNumber(worksheet.getCell(row, 10).value && typeof worksheet.getCell(row, 10).value === "object" ? (worksheet.getCell(row, 10).value as { result?: number }).result : worksheet.getCell(row, 10).value), 0) },
      ]).number;
      worksheet.getCell(totalRow, 10).numFmt = "0.00";
      const roundOffAmount = roundOffAmounts.reduce((sum, amount) => sum + amount, 0);
      let roundOffRow: number | undefined;
      if (roundOffAmounts.length) {
        roundOffRow = worksheet.addRow([null, "Round off", null, null, null, null, null, null, null, roundOffAmount]).number;
        worksheet.getCell(roundOffRow, 10).numFmt = "0.00";
      }
      const roundOffFormula = roundOffRow ? `+J${roundOffRow}` : "";
      const sayRow = worksheet.addRow([null, "Say", null, null, null, null, null, null, null,
          { formula: `ROUND(J${totalRow}${roundOffFormula},2)`, result: group.quantity }, group.unit,
      ]);
      worksheet.getCell(sayRow.number, 10).numFmt = "0.00";
      totalRow = sayRow.number;
    }
    if (rowRefs) rowRefs.msmt[entry.itemCode] = { descRow: itemHeader.number, totalQtyRow: totalRow };
  }
  sharedTableStyles(worksheet, worksheet.rowCount, 12, true);
  for (let rowNumber = 8; rowNumber <= worksheet.rowCount; rowNumber++) {
    const description = sharedText(worksheet.getCell(rowNumber, 2).value).trim();
    if (rowNumber >= 9) {
      worksheet.getCell(rowNumber, 1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      worksheet.getCell(rowNumber, 2).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
      worksheet.getRow(rowNumber).height = measurementDescriptionHeight(description);
    }
    for (let column = 3; column <= 10; column++) {
      const cell = worksheet.getCell(rowNumber, column);
      if (column <= 5) cell.numFmt = typeof cell.value === "number" && cell.value % 1 !== 0 ? "0.00" : "0";
      else cell.numFmt = "0.00";
    }
    if (description === "Total") {
      const label = worksheet.getCell(rowNumber, 2);
      label.font = { name: "Book Antiqua", size: 10, bold: true };
      worksheet.getCell(rowNumber, 10).font = { name: "Book Antiqua", size: 10, bold: true };
    }
    if (description === "Round off") {
      worksheet.getCell(rowNumber, 2).font = { name: "Book Antiqua", size: 10, bold: false };
      worksheet.getCell(rowNumber, 10).font = { name: "Book Antiqua", size: 10, bold: false };
    } else if (description === "Say") {
      worksheet.getCell(rowNumber, 2).font = { name: "Book Antiqua", size: 10, bold: false };
      const sayQuantity = worksheet.getCell(rowNumber, 10);
      sayQuantity.font = { name: "Book Antiqua", size: 10, bold: true };
      sayQuantity.alignment = { horizontal: "right", vertical: "middle" };
      sayQuantity.border = { top: { style: "medium" }, bottom: { style: "medium" }, left: { style: "medium" }, right: { style: "medium" } };
    }
  }
  const lastDataRow = worksheet.rowCount;
  for (let column = 1; column <= 12; column++) {
    const cell = worksheet.getCell(lastDataRow, column);
    const existingBottomStyle = cell.border?.bottom?.style;
    const bottomStyle = existingBottomStyle === "medium" ? "medium" : "thin";
    cell.border = { ...cell.border, bottom: { style: bottomStyle } };
  }
  sharedSignatories(worksheet, projectDetails, 12);
  for (const [column, min, max] of [[1, 5, 12], [3, 4, 6], [4, 4, 8], [5, 4, 8], [6, 6, 12], [7, 6, 12], [8, 6, 12], [9, 6, 10], [10, 7, 12], [12, 6, 12]]) {
    sharedAutoFitColumn(worksheet, column, min, max);
  }
  worksheet.getColumn(2).width = 33;
  worksheet.getColumn(11).width = 8;
  worksheet.autoFilter = { from: "A8", to: `L${worksheet.rowCount}` };
}

export function buildAbstractSheetLayout(
  worksheet: ExcelJS.Worksheet,
  estimateData: SharedEstimateData,
  estimateId: string,
  rowRefs: SharedWorkbookRowRefs | null = null,
) {
  const indianAmountFormat = "##,##,##,##0.00";
  sharedConfigurePrint(worksheet, "Abstract of Cost", estimateId, "portrait");
  const { groups, hierarchyRows, projectDetails } = sharedContext(estimateData);
  worksheet.views = [{ state: "normal", style: "pageBreakPreview" }];
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    scale: 85,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "8:8",
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  worksheet.getColumn(1).width = 7.5;
  worksheet.getColumn(2).width = 52.0;
  worksheet.getColumn(3).width = 7.5;
  worksheet.getColumn(4).width = 11.5;
  worksheet.getColumn(5).width = 11.5;
  worksheet.getColumn(6).width = 12.5;
  worksheet.getColumn(7).width = 9.5;
  sharedTitle(worksheet, "ABSTRACT OF COST", sharedText(projectDetails.nameOfWork), projectDetails);
  sharedHeader(worksheet, ["Item\nNo.", "Description", "Unit", "Quantity", "Rate (₹)", "Amount (₹)", "DSR\nCode"]);
  const subtotals: SharedSubtotal[] = [];
  const sections = new Map<string, typeof hierarchyRows>();
  for (const row of hierarchyRows) {
    const rows = sections.get(row.sectionCode) ?? [];
    rows.push(row);
    sections.set(row.sectionCode, rows);
  }
  for (const [sectionCode, section] of sections) {
    const subhead = section.find(row => row.isSubhead);
    if (!subhead) continue;
    const sectionLabel = sharedSectionLabel(sectionCode, subhead.description);
    let total = 0;
    const shRow = worksheet.addRow([null, null, null, null, null, null, null]);
    const sectionRef = rowRefs?.msmt[sharedSectionKey(sectionCode)];
    if (rowRefs && !sectionRef) throw new Error(`Missing Measurement Sheet subhead reference for ${sectionCode}.`);
    if (sectionRef) {
      sharedCellFormula(worksheet, shRow.number, 1, `'Measurement Sheet'!A${sectionRef.descRow}`, subhead.serialNo);
      sharedCellFormula(worksheet, shRow.number, 2, `'Measurement Sheet'!B${sectionRef.descRow}`, sectionLabel);
      sharedCellFormula(worksheet, shRow.number, 7, `'Measurement Sheet'!L${sectionRef.descRow}`, sectionCode);
    } else {
      shRow.getCell(1).value = subhead.serialNo;
      shRow.getCell(2).value = sectionLabel;
      shRow.getCell(7).value = sectionCode;
    }
    const sectionStartRow = shRow.number + 1;
    shRow.font = { name: "Book Antiqua", size: 10, bold: true };
    shRow.getCell(2).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
    if (rowRefs) rowRefs.abst[sharedSectionKey(sectionCode)] = { descRow: shRow.number };
    for (const entry of section) {
      if (entry.isSubhead) continue;
      if (entry.isParent) {
        const parentRow = worksheet.addRow([null, null]);
        const parentRef = rowRefs?.msmt[entry.itemCode];
        if (rowRefs && !parentRef) throw new Error(`Missing Measurement Sheet parent reference for ${entry.itemCode}.`);
        if (parentRef) {
          sharedCellFormula(worksheet, parentRow.number, 1, `'Measurement Sheet'!A${parentRef.descRow}`, entry.serialNo);
          sharedCellFormula(worksheet, parentRow.number, 2, `'Measurement Sheet'!B${parentRef.descRow}`, entry.description);
          sharedCellFormula(worksheet, parentRow.number, 7, `'Measurement Sheet'!L${parentRef.descRow}`, sharedDsrCode(entry.itemCode, estimateData, entry.sourceRow ? [entry.sourceRow as Record<string, unknown>] : []));
        } else {
          parentRow.getCell(1).value = entry.serialNo;
          parentRow.getCell(2).value = entry.description;
          parentRow.getCell(7).value = sharedDsrCode(entry.itemCode, estimateData, entry.sourceRow ? [entry.sourceRow as Record<string, unknown>] : []);
        }
        parentRow.getCell(2).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
        parentRow.height = sharedRowHeight(entry.description, 56, 15);
        continue;
      }
      const group = groups.get(entry.itemCode);
      if (!group) continue;
      const quantity = group.quantity;
      const amount = Math.round(quantity * group.rate);
      const dsrCode = sharedDsrCode(entry.itemCode, estimateData, group.rows);
      const itemRow = worksheet.addRow([entry.serialNo, entry.description, group.unit, quantity, group.rate,
        { formula: `ROUND(D${worksheet.rowCount + 1}*E${worksheet.rowCount + 1},0)`, result: amount }, dsrCode]);
      itemRow.height = sharedRowHeight(entry.description, 56, 15);
      itemRow.getCell(2).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
      if (entry.description.startsWith("SH") || entry.description.toUpperCase().includes("SUBTOTAL")) {
        itemRow.getCell(2).font = { name: "Book Antiqua", size: 10, bold: true };
      }
      const measurementRef = rowRefs?.msmt[entry.itemCode];
      if (rowRefs && (!measurementRef?.totalQtyRow)) throw new Error(`Missing Measurement Sheet item reference for ${entry.itemCode}.`);
      if (measurementRef?.totalQtyRow) {
        sharedCellFormula(worksheet, itemRow.number, 1, `'Measurement Sheet'!A${measurementRef.descRow}`, entry.serialNo);
        sharedCellFormula(worksheet, itemRow.number, 2, `'Measurement Sheet'!B${measurementRef.descRow}`, entry.description);
        sharedCellFormula(worksheet, itemRow.number, 3, `'Measurement Sheet'!K${measurementRef.totalQtyRow}`, group.unit);
        sharedCellFormula(worksheet, itemRow.number, 4, `'Measurement Sheet'!J${measurementRef.totalQtyRow}`, quantity);
        sharedCellFormula(worksheet, itemRow.number, 7, `'Measurement Sheet'!L${measurementRef.descRow}`, entry.itemCode);
      }
      itemRow.getCell(4).numFmt = "#,##0.00";
      itemRow.getCell(5).numFmt = "#,##0.00";
      itemRow.getCell(6).numFmt = indianAmountFormat;
      if (rowRefs) rowRefs.abst[entry.itemCode] = { descRow: itemRow.number, itemRow: itemRow.number };
      total += amount;
    }
    const subtotalLabel = `SUBTOTAL FOR SH ${sectionCode}:`;
     const subtotalRow = worksheet.addRow([null, subtotalLabel, null, null, null, total, null]);
    subtotalRow.height = sharedRowHeight(subtotalLabel, 56, 15);
    subtotalRow.getCell(2).font = { name: "Book Antiqua", size: 10, bold: true };
    subtotalRow.getCell(2).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
    const calcEndRow = subtotalRow.number - 1;
    sharedCellFormula(worksheet, subtotalRow.number, 6, sectionStartRow <= calcEndRow
      ? `ROUND(SUM(F${sectionStartRow}:F${calcEndRow}),0)`
      : "ROUND(0,0)", total);
    const subtotalAmount = subtotalRow.getCell(6);
    subtotalAmount.numFmt = indianAmountFormat;
    subtotalAmount.font = { name: "Book Antiqua", size: 10, bold: true };
    if (rowRefs?.abst[sharedSectionKey(sectionCode)]) rowRefs.abst[sharedSectionKey(sectionCode)].subtotalRow = subtotalRow.number;
    subtotals.push({ code: sectionCode, label: sectionLabel, row: subtotalRow.number, amount: total, serial: subhead.serialNo });
  }
  const summaryFirstRow = worksheet.rowCount + 2; // separator row precedes the financial summary
  sharedFinancialSummary(worksheet, subtotals, projectDetails, 1, true);
  const sayRow = worksheet.rowCount;
  sharedTableStyles(worksheet, sayRow, 7);
  for (let rowNumber = 9; rowNumber <= sayRow; rowNumber++) {
    const firstCell = worksheet.getCell(rowNumber, 1);
    const isMergedSummaryLabel = typeof firstCell.value === "string" && worksheet.getCell(rowNumber, 2).value == null;
    firstCell.alignment = isMergedSummaryLabel
      ? { horizontal: "left", vertical: "middle", wrapText: true }
      : { horizontal: "center", vertical: "middle", wrapText: true };
    if (!isMergedSummaryLabel) {
      worksheet.getCell(rowNumber, 2).alignment = { horizontal: "justify", vertical: "middle", wrapText: true };
      worksheet.getCell(rowNumber, 3).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      worksheet.getCell(rowNumber, 4).alignment = { horizontal: "center", vertical: "middle" };
      worksheet.getCell(rowNumber, 5).alignment = { horizontal: "right", vertical: "middle" };
    }
    worksheet.getCell(rowNumber, 6).alignment = { horizontal: "right", vertical: "middle" };
    worksheet.getCell(rowNumber, 7).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  sharedUnboldGeneralSummaryRows(worksheet);
  sharedSummaryAmountBorders(worksheet);
  sharedSignatories(worksheet, projectDetails);
  alignFinancialSummaryLabelsLeft(worksheet, summaryFirstRow, sayRow, 1);
  for (const [column, min, max] of [[1, 6, 12], [3, 6, 12], [4, 8, 14], [5, 8, 14], [6, 10, 18], [7, 7, 14]]) {
    sharedAutoFitColumn(worksheet, column, min, max);
  }
  worksheet.getColumn(2).width = 52;
  for (let rowNumber = 8; rowNumber <= worksheet.rowCount; rowNumber++) {
    worksheet.getCell(rowNumber, 3).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
}

export function buildGenAbstSheetLayout(
  worksheet: ExcelJS.Worksheet,
  estimateData: SharedEstimateData,
  estimateId: string,
  rowRefs: SharedWorkbookRowRefs | null = null,
) {
  sharedConfigurePrint(worksheet, "General Abstract", estimateId, "portrait", true);
  worksheet.views = [{ state: "normal", style: "pageBreakPreview" }];
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    scale: 85,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "8:8",
    margins: { left: 1.25, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  const { hierarchyRows, projectDetails } = sharedContext(estimateData);
  worksheet.getColumn(1).width = 6;
  worksheet.getColumn(2).width = 52.0;
  worksheet.getColumn(3).width = 7.5;
  worksheet.getColumn(3).hidden = true;
  worksheet.getColumn(4).width = 11.5;
  worksheet.getColumn(4).hidden = true;
  worksheet.getColumn(5).width = 11.5;
  worksheet.getColumn(5).hidden = true;
  worksheet.getColumn(6).width = 13;
  worksheet.getColumn(7).width = 9;
  sharedTitle(worksheet, "GENERAL ABSTRACT", sharedText(projectDetails.nameOfWork), projectDetails, 7, true);
  sharedHeader(worksheet, ["Sl. No.", "Description of Item", "", "", "", "Amount (₹)", "Ref"]);
  worksheet.mergeCells("B8:E8");
  const sections = new Map<string, typeof hierarchyRows>();
  for (const row of hierarchyRows) {
    const rows = sections.get(row.sectionCode) ?? [];
    rows.push(row);
    sections.set(row.sectionCode, rows);
  }
  const subtotals: SharedSubtotal[] = [];
  let index = 0;
  for (const [sectionCode, rows] of sections) {
    const subhead = rows.find(row => row.isSubhead);
    if (!subhead) continue;
    const sectionLabel = sharedSectionLabel(sectionCode, subhead.description);
    index++;
    const ref = rowRefs?.abst[sharedSectionKey(sectionCode)];
    if (rowRefs && (!ref?.descRow || !ref.subtotalRow)) throw new Error(`Missing Abstract of Cost row references for subhead ${sectionCode}.`);
    const amount = rows.reduce((sum, entry) => entry.isItem
      ? sum + Math.round(sharedNumber(entry.quantity) * sharedNumber(entry.rate))
      : sum, 0);
    const row = worksheet.addRow([index, null, null, null, null, amount, ""]);
    row.height = sharedRowHeight(subhead.description, 55, 18);
    worksheet.mergeCells(`B${row.number}:E${row.number}`);
    if (ref?.descRow) sharedCellFormula(worksheet, row.number, 2, `'Abstract of Cost'!B${ref.descRow}`, subhead.description);
    else row.getCell(2).value = sectionLabel;
    row.getCell(2).font = { name: "Book Antiqua", size: 10, bold: false };
    row.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    if (ref?.subtotalRow) sharedCellFormula(worksheet, row.number, 6, `'Abstract of Cost'!F${ref.subtotalRow}`, amount);
    else row.getCell(6).value = amount;
    row.getCell(6).font = { name: "Book Antiqua", size: 10, bold: false };
    row.getCell(6).numFmt = "##,##,##0";
    row.getCell(6).alignment = { horizontal: "right", vertical: "middle", shrinkToFit: true };
    subtotals.push({ code: sectionCode, label: sectionLabel, row: row.number, amount, serial: String(index) });
  }
  const summaryFirstRow = worksheet.rowCount + 2; // separator is followed by the first summary row
  const sayRow = sharedFinancialSummary(worksheet, subtotals, projectDetails, 1, true);
  const indianAmountFormat = "##,##,##,##0.00";
  for (let rowNumber = summaryFirstRow; rowNumber <= sayRow; rowNumber++) {
    const label = String(worksheet.getCell(rowNumber, 1).value ?? "").trim().toUpperCase();
    const amountCell = worksheet.getCell(rowNumber, 6);
    amountCell.numFmt = label === "GRAND TOTAL:" || label === "SAY:"
      ? "##,##,##,##0"
      : indianAmountFormat;
  }
  sharedTableStyles(worksheet, sayRow, 7);
  sharedUnboldGeneralSummaryRows(worksheet);
  sharedSummaryAmountBorders(worksheet);
  sharedSignatories(worksheet, projectDetails);
  sharedAutoFitColumn(worksheet, 1, 6, 8);
  sharedAutoFitColumn(worksheet, 6, 12, 15);
  sharedAutoFitColumn(worksheet, 7, 8, 11);
  worksheet.getColumn(2).width = 52;
  alignFinancialSummaryLabelsLeft(worksheet, summaryFirstRow, sayRow, 1);
}

async function downloadSharedSheet(workbook: ExcelJS.Workbook, fileBaseName: string) {
  try {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileBaseName.replace(/[^\w-]+/g, "_")}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("Could not create the Excel workbook:", error);
    window.alert(error instanceof Error ? error.message : "Could not create the Excel workbook.");
  }
}

async function exportSharedSheet(
  sheetName: string,
  fileBaseName: string,
  builder: (worksheet: ExcelJS.Worksheet) => void,
) {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);
    builder(worksheet);
    await downloadSharedSheet(workbook, fileBaseName);
  } catch (error) {
    console.error(`Could not export ${sheetName}:`, error);
    window.alert(error instanceof Error ? error.message : `Could not export ${sheetName}.`);
  }
}

/** Build the same ExcelJS layout used by the workbook export, then print that
 * worksheet as a portrait PDF. This avoids printing the interactive React UI
 * (controls, scroll containers, and screen-only totals) as if it were a sheet.
 */
export function exportEstimateWorksheetToPdf(
  sheetName: string,
  estimateId: string,
  builder: (worksheet: ExcelJS.Worksheet) => void,
) {
  const printWindow = window.open("", "_blank", "width=1000,height=800");
  if (!printWindow) throw new Error("The PDF print window was blocked. Allow pop-ups and try again.");

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  builder(worksheet);

  const visibleColumns = Array.from({ length: worksheet.columnCount }, (_, index) => ({
    index: index + 1,
    width: Math.max(1, worksheet.getColumn(index + 1).width || 10),
    hidden: Boolean(worksheet.getColumn(index + 1).hidden),
  })).filter(column => !column.hidden);
  const columnWidths = visibleColumns.map(column => column.width);
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) || 1;
  const merges = worksheet.model.merges || [];
  const mergeByStart = new Map<string, number>();
  const mergedCells = new Set<string>();
  const mergeAnchorByVisibleStart = new Map<string, string>();
  const columnNumber = (address: string) => {
    const letters = address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
    return [...letters].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0);
  };
  const rowNumber = (address: string) => Number(address.match(/\d+/)?.[0] || 1);
  for (const range of merges) {
    const [start, end] = range.split(":");
    const startRow = rowNumber(start);
    const endRow = rowNumber(end);
    const startColumn = columnNumber(start);
    const endColumn = columnNumber(end);
    const visibleMergeColumns = visibleColumns.map(column => column.index).filter(column => column >= startColumn && column <= endColumn);
    if (!visibleMergeColumns.length) continue;
    const visibleStartColumn = visibleMergeColumns[0];
    const visibleStartKey = `${startRow}:${visibleStartColumn}`;
    mergeByStart.set(visibleStartKey, visibleMergeColumns.length);
    mergeAnchorByVisibleStart.set(visibleStartKey, start);
    for (let row = startRow; row <= endRow; row++) {
      for (const col of visibleMergeColumns) {
        if (row !== startRow || col !== visibleStartColumn) mergedCells.add(`${row}:${col}`);
      }
    }
  }
  const cellText = (cell: ExcelJS.Cell) => sharedFormattedCellValue(cell);
  const color = (argb?: string) => argb ? `#${argb.slice(-6)}` : undefined;
  const borderStyle = (style?: ExcelJS.BorderStyle) => {
    if (!style) return "none";
    if (style === "hair") return "0.5px dotted #222";
    const width = style === "double" ? "2px" : style === "medium" || style === "thick" ? "1.5px" : "1px";
    return `${width} solid #222`;
  };
  const safe = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  const rows: string[] = [];
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const cells: string[] = [];
    for (const visibleColumn of visibleColumns) {
      const col = visibleColumn.index;
      if (mergedCells.has(`${rowNumber}:${col}`)) continue;
      const visibleKey = `${rowNumber}:${col}`;
      const cellAddress = mergeAnchorByVisibleStart.get(visibleKey);
      const cell = cellAddress ? worksheet.getCell(cellAddress) : row.getCell(col);
      const style = cell.style || {};
      const alignment = style.alignment || {};
      const font = style.font || {};
      const fill = style.fill && style.fill.type === "pattern" && style.fill.fgColor?.argb
        ? color(style.fill.fgColor.argb) : undefined;
      const borders = style.border || {};
      const styles = [
        `text-align:${alignment.horizontal === "justify" ? "justify" : alignment.horizontal || "left"}`,
        `vertical-align:${alignment.vertical === "top" ? "top" : "middle"}`,
        `font-family:${safe(font.name || "Book Antiqua")}`,
        `font-size:${font.size || 10}pt`,
        `font-weight:${font.bold ? "bold" : "normal"}`,
        font.italic ? "font-style:italic" : "",
        `white-space:${alignment.wrapText ? "pre-wrap" : "nowrap"}`,
        alignment.wrapText ? "overflow-wrap:anywhere" : "",
        fill ? `background:${fill}` : "",
        color(font.color?.argb) ? `color:${color(font.color?.argb)}` : "",
        `border-top:${borderStyle(borders.top?.style)}`,
        `border-right:${borderStyle(borders.right?.style)}`,
        `border-bottom:${borderStyle(borders.bottom?.style)}`,
        `border-left:${borderStyle(borders.left?.style)}`,
        alignment.shrinkToFit ? "font-stretch:condensed" : "",
      ].filter(Boolean).join(";");
      const colSpan = mergeByStart.get(visibleKey);
      const text = safe(cellText(cell)).replace(/\r?\n/g, "<br>");
      cells.push(`<td${colSpan ? ` colspan="${colSpan}"` : ""} style="${styles}">${text || "&nbsp;"}</td>`);
    }
    const height = row.height ? ` style="height:${row.height}pt"` : "";
    rows.push(`<tr${height}>${cells.join("")}</tr>`);
  }

  const headerRowNumber = worksheet.pageSetup.printTitlesRow?.split(":")[0];
  const headerNumber = Number(headerRowNumber) || 0;
  const preamble = headerNumber ? rows.slice(0, headerNumber - 1).join("") : "";
  const head = headerNumber ? rows[headerNumber - 1] || "" : "";
  const body = rows.slice(headerNumber).join("");
  const margins = worksheet.pageSetup.margins || { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75 };
  const marginIn = (value: number | undefined, fallback: number) => `${Math.max(0, value ?? fallback)}in`;
  const tableColumns = columnWidths.map(width => `<col style="width:${(width / totalWidth * 100).toFixed(4)}%">`).join("");
  const title = safe(sheetName);
  const safeFilePart = (value: string) => value.trim().replace(/[<>:"\\|?*\x00-\x1F]/g, "").replace(/\//g, "").replace(/\s+/g, "_");
  const suggestedFilename = safe(`${safeFilePart(sheetName)}_${safeFilePart(estimateId || "Estimate")}`);
  const id = safe(estimateId || "N/A");
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${suggestedFilename}</title>
    <style>
      @page { size: A4 portrait; margin: ${marginIn(margins.top, .75)} ${marginIn(margins.right, .5)} ${marginIn(margins.bottom, .75)} ${marginIn(margins.left, .5)};
        @bottom-left { content: "${title}"; font: 8pt "Book Antiqua", serif; }
        @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8pt "Book Antiqua", serif; }
        @bottom-right { content: "${id}"; font: 8pt "Book Antiqua", serif; }
      }
      * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      html,body { margin:0; padding:0; color:#111; background:#fff; font-family:"Book Antiqua",serif; }
      table { width:100%; table-layout:fixed; border-collapse:collapse; margin:0; }
      colgroup { display:table-column-group; }
      td { padding:2pt 3pt; }
      thead { display:table-header-group; }
      tr { break-inside:avoid; page-break-inside:avoid; }
      tbody { display:table-row-group; }
    </style></head><body>${preamble ? `<table><colgroup>${tableColumns}</colgroup><tbody>${preamble}</tbody></table>` : ""}<table><colgroup>${tableColumns}</colgroup>${head ? `<thead>${head}</thead>` : ""}<tbody>${body}</tbody></table>
    <script>window.addEventListener('load',()=>{window.focus();setTimeout(()=>window.print(),200)});window.addEventListener('afterprint',()=>window.close());</script>
    </body></html>`);
  printWindow.document.close();
}

/** Print all sheets from an ExcelJS workbook as one PDF. The Justfn exports use
 * the same worksheet builders as their Excel counterparts, including per-sheet
 * orientation, footer, print margins, formulas, merges, and formatting. */
export function openEstimatePdfWindow() {
  const printWindow = window.open("", "_blank", "width=1000,height=800");
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write("<!doctype html><html><head><title>Preparing PDF</title></head><body>Preparing PDF…</body></html>");
    printWindow.document.close();
  }
  return printWindow;
}

export function exportEstimateWorkbookToPdf(workbook: ExcelJS.Workbook, estimateId: string, fileBaseName: string, openedWindow?: Window | null) {
  const printWindow = openedWindow ?? window.open("", "_blank", "width=1000,height=800");
  if (!printWindow) throw new Error("The PDF print window was blocked. Allow pop-ups and try again.");

  const safe = (value: unknown) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  const colNumber = (address: string) => [...(address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A")]
    .reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0);
  const rowNumber = (address: string) => Number(address.match(/\d+/)?.[0] || 1);
  const borderCss = (side: ExcelJS.Border | undefined) => {
    if (!side?.style) return "none";
    const width = side.style === "hair" ? "0.5px" : side.style === "medium" || side.style === "thick" ? "1.5px" : "1px";
    const line = side.style === "hair" ? "dotted" : "solid";
    return `${width} ${line} #111`;
  };
  const sheetsHtml = workbook.worksheets.map((worksheet, sheetIndex) => {
    const columns = Array.from({ length: worksheet.columnCount }, (_, index) => ({
      index: index + 1,
      width: Math.max(1, worksheet.getColumn(index + 1).width || 10),
      hidden: Boolean(worksheet.getColumn(index + 1).hidden),
    })).filter(column => !column.hidden);
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0) || 1;
    const merges = worksheet.model.merges || [];
    const mergeByStart = new Map<string, { colSpan: number; rowSpan: number }>();
    const mergedCells = new Set<string>();
    const anchorByStart = new Map<string, string>();
    for (const range of merges) {
      const [start, end] = range.split(":");
      const startRow = rowNumber(start), endRow = rowNumber(end);
      const startCol = colNumber(start), endCol = colNumber(end);
      const visible = columns.filter(column => column.index >= startCol && column.index <= endCol);
      if (!visible.length) continue;
      const visibleStart = visible[0].index;
      const key = `${startRow}:${visibleStart}`;
      mergeByStart.set(key, { colSpan: visible.length, rowSpan: endRow - startRow + 1 });
      anchorByStart.set(key, start);
      for (let row = startRow; row <= endRow; row++) {
        for (const column of visible) if (row !== startRow || column.index !== visibleStart) mergedCells.add(`${row}:${column.index}`);
      }
    }
    const rows: string[] = [];
    for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex++) {
      const row = worksheet.getRow(rowIndex);
      const cells = columns.flatMap(column => {
        const key = `${rowIndex}:${column.index}`;
        if (mergedCells.has(key)) return [];
        const cell = worksheet.getCell(anchorByStart.get(key) || row.getCell(column.index).address);
        const alignment = cell.alignment || {};
        const font = cell.font || {};
        const fill = cell.fill?.type === "pattern" && cell.fill.fgColor?.argb
          ? `#${cell.fill.fgColor.argb.slice(-6)}` : "transparent";
        const argb = font.color?.argb;
        const color = argb ? `#${argb.slice(-6)}` : "#111";
        const border = cell.border || {};
        const styles = [
          `text-align:${alignment.horizontal === "justify" ? "justify" : alignment.horizontal || "left"}`,
          `vertical-align:${alignment.vertical === "top" ? "top" : "middle"}`,
          `font-family:${safe(font.name || "Book Antiqua")}`,
          `font-size:${font.size || 10}pt`,
          `font-weight:${font.bold ? "bold" : "normal"}`,
          font.italic ? "font-style:italic" : "",
          `color:${color}`,
          `background:${fill}`,
          `white-space:${alignment.wrapText ? "pre-wrap" : "nowrap"}`,
          alignment.wrapText ? "overflow-wrap:anywhere" : "",
          `border-top:${borderCss(border.top)}`,
          `border-right:${borderCss(border.right)}`,
          `border-bottom:${borderCss(border.bottom)}`,
          `border-left:${borderCss(border.left)}`,
        ].filter(Boolean).join(";");
        const span = mergeByStart.get(key);
        const value = safe(sharedFormattedCellValue(cell)).replace(/\r?\n/g, "<br>");
        const spanAttributes = span
          ? `${span.colSpan > 1 ? ` colspan="${span.colSpan}"` : ""}${span.rowSpan > 1 ? ` rowspan="${span.rowSpan}"` : ""}`
          : "";
        return [`<td${spanAttributes} style="${styles}">${value || "&nbsp;"}</td>`];
      }).join("");
      rows.push(`<tr${row.height ? ` style="height:${row.height}pt"` : ""}>${cells}</tr>`);
    }
    const colgroup = columns.map(column => `<col style="width:${(column.width / totalWidth * 100).toFixed(4)}%">`).join("");
    const titleRows = String(worksheet.pageSetup.printTitlesRow || "").match(/\$?(\d+):\$?(\d+)/);
    const titleStart = titleRows ? Number(titleRows[1]) : 0;
    const titleEnd = titleRows ? Number(titleRows[2]) : 0;
    const tableHtml = titleStart > 0 && titleEnd >= titleStart
      ? `<table><colgroup>${colgroup}</colgroup><tbody>${rows.slice(0, titleStart - 1).join("")}</tbody></table><table><colgroup>${colgroup}</colgroup><thead>${rows.slice(titleStart - 1, titleEnd).join("")}</thead><tbody>${rows.slice(titleEnd).join("")}</tbody></table>`
      : `<table><colgroup>${colgroup}</colgroup><tbody>${rows.join("")}</tbody></table>`;
    const oddFooter = String(worksheet.headerFooter?.oddFooter || worksheet.headerFooter?.evenFooter || "");
    const footerLeft = oddFooter.match(/&L([\s\S]*?)(?=&[CR]|$)/i)?.[1]
      ?.replace(/&"[^"]*"/g, "").replace(/&\d+/g, "").replace(/&[BIUSXY]/gi, "").trim() || worksheet.name;
    const pageSetup = worksheet.pageSetup;
    const orientation = pageSetup.orientation === "landscape" ? "landscape" : "portrait";
    const margins = pageSetup.margins || { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75 };
    const toInches = (value: number | undefined, fallback: number) => `${Math.max(0, Number.isFinite(value) ? value as number : fallback)}in`;
    const pageRule = `@page sheetpage${sheetIndex} { size: A4 ${orientation}; margin: ${toInches(margins.top, 0.75)} ${toInches(margins.right, 0.5)} ${toInches(margins.bottom, 0.75)} ${toInches(margins.left, 0.5)}; @bottom-left { content: "${safe(footerLeft)}"; font: 8pt "Book Antiqua",serif; } @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8pt "Book Antiqua",serif; } @bottom-right { content: "${safe(estimateId || "N/A")}"; font: 8pt "Book Antiqua",serif; } }`;
    return { html: `<section class="sheet sheet-page${sheetIndex}${sheetIndex ? " sheet-break" : ""}">${tableHtml}</section>`, pageRule };
  });
  const sheetDocuments = sheetsHtml;
  const filename = `${String(fileBaseName || "Estimate").trim().replace(/[^\w-]+/g, "_")}_${String(estimateId || "Estimate").trim().replace(/[^\w-]+/g, "_")}`;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safe(filename)}</title>
    <style>
      ${sheetDocuments.map(sheet => sheet.pageRule).join("\n")}
      * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      html,body { margin:0; padding:0; color:#111; background:#fff; font-family:"Book Antiqua",serif; }
      .sheet { width:100%; page:sheetpage0; }
      ${sheetDocuments.map((_, index) => `.sheet-page${index} { page:sheetpage${index}; }`).join("\n")}
      .sheet-break { break-before:page; page-break-before:always; }
      table { width:100%; table-layout:fixed; border-collapse:collapse; margin:0; }
      td { padding:2pt 3pt; }
      thead { display:table-header-group; }
      tr { break-inside:avoid; page-break-inside:avoid; }
    </style></head><body>${sheetDocuments.map(sheet => sheet.html).join("")}
    <script>window.addEventListener('load',()=>{window.focus();setTimeout(()=>window.print(),200)});window.addEventListener('afterprint',()=>window.close());</script>
    </body></html>`);
  printWindow.document.close();
}

const xml = (value: unknown) => Array.from(String(value ?? ""))
  .filter(character => {
    const point = character.codePointAt(0) ?? 0;
    return point === 0x9 || point === 0xa || point === 0xd || (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff);
  })
  .join("")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&apos;");
const columnName = (number: number) => {
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
};

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files: ZipFile[]) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const header = (length: number, entries: Array<[number, number, number]>) => {
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    entries.forEach(([position, value, size]) => size === 2 ? view.setUint16(position, value, true) : view.setUint32(position, value, true));
    return bytes;
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const contents = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const checksum = crc32(contents);
    const localHeader = header(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [14, checksum, 4], [18, contents.length, 4], [22, contents.length, 4], [26, name.length, 2]]);
    local.push(localHeader, name, contents);
    const centralHeader = header(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [16, checksum, 4], [20, contents.length, 4], [24, contents.length, 4], [28, name.length, 2], [42, offset, 4]]);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + contents.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22, [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, centralSize, 4], [16, offset, 4]]);
  const parts: BlobPart[] = [...local, ...central, end].map(part => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer);
  return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function cellText(cell: HTMLTableCellElement) {
  const clone = cell.cloneNode(true) as HTMLTableCellElement;
  clone.querySelectorAll("button, input[type=checkbox], svg").forEach(element => element.remove());
  clone.querySelectorAll("input, textarea, select").forEach(element => {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const value = field instanceof HTMLInputElement && field.type === "checkbox" ? (field.checked ? "Yes" : "No") : field.value;
    field.replaceWith(document.createTextNode(value));
  });
  return (clone.innerText || clone.textContent || "").replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").trim();
}

function cleanDescription(value: string) {
  return value.replace(/^\s+|\s+$/g, "");
}

function buildMeasurementStyles(): { xml: string; sayQuantityStyle: number } {
  const fonts = [
    `<font><sz val="10"/><name val="Book Antiqua"/></font>`,
    `<font><b/><sz val="14"/><name val="Book Antiqua"/></font>`,
    `<font><b/><sz val="10"/><name val="Book Antiqua"/></font>`,
    `<font><sz val="10"/><name val="Book Antiqua"/></font>`,
    `<font><sz val="9"/><name val="Book Antiqua"/></font>`,
    `<font><sz val="8"/><name val="Book Antiqua"/></font>`,
    `<font><b/><sz val="10"/><name val="Book Antiqua"/></font>`,
  ];
  type Style = { font: number; border: number; numFmt?: number; horizontal: string; vertical?: string; wrap?: boolean; shrink?: boolean };
  const styles: Style[] = [
    { font: 0, border: 0, horizontal: "center" },
    { font: 1, border: 0, horizontal: "center" },
    { font: 2, border: 0, horizontal: "left", wrap: true },
    { font: 2, border: 1, horizontal: "center", wrap: true },
    { font: 0, border: 2, horizontal: "justify", wrap: true },
    { font: 0, border: 2, numFmt: 164, horizontal: "center", shrink: true },
    { font: 2, border: 2, numFmt: 164, horizontal: "center", shrink: true },
    { font: 2, border: 1, horizontal: "center", vertical: "top", wrap: true },
    { font: 3, border: 1, horizontal: "center", wrap: true },
    { font: 3, border: 1, horizontal: "justify", vertical: "center", wrap: true },
    { font: 3, border: 1, horizontal: "justify", vertical: "center", wrap: true },
    { font: 3, border: 2, horizontal: "center", wrap: true },
    { font: 3, border: 2, horizontal: "center", shrink: true },
    { font: 3, border: 2, numFmt: 164, horizontal: "center", shrink: true },
    { font: 2, border: 0, horizontal: "center", wrap: true },
    { font: 3, border: 0, horizontal: "left" },
    { font: 3, border: 0, horizontal: "right" },
    { font: 2, border: 0, horizontal: "center", wrap: true },
    { font: 3, border: 1, horizontal: "center", wrap: true },
    { font: 2, border: 1, horizontal: "justify", vertical: "center", wrap: true },
    { font: 4, border: 1, horizontal: "center", wrap: true },
    { font: 5, border: 1, horizontal: "center", wrap: true },
    { font: 4, border: 2, horizontal: "center", wrap: true },
    { font: 5, border: 2, horizontal: "center", wrap: true },
    { font: 4, border: 1, horizontal: "center", wrap: true },
    { font: 5, border: 1, horizontal: "center", wrap: true },
    { font: 2, border: 1, horizontal: "center", wrap: true },
  ];
  const baseStyleCount = styles.length;
  for (const border of [3, 4, 5, 6]) {
    styles.push(...styles.slice(0, baseStyleCount).map(style => ({ ...style, border })));
  }
  const sayQuantityStyle = styles.length;
  styles.push({ font: 6, border: 7, numFmt: 164, horizontal: "center", shrink: true });
  const xfXml = styles.map(style => {
    const alignment = `<alignment horizontal="${style.horizontal}" vertical="${style.vertical || "center"}"${style.wrap ? ` wrapText="1"` : ""}${style.shrink ? ` shrinkToFit="1"` : ""}/>`;
    return `<xf numFmtId="${style.numFmt || 0}" fontId="${style.font}" fillId="0" borderId="${style.border}" xfId="0" applyAlignment="1"${style.numFmt ? ` applyNumberFormat="1"` : ""}>${alignment}</xf>`;
  }).join("");
  const styleXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0"/></numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="8"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border><border><left style="hair"/><right style="hair"/><top style="hair"/><bottom style="hair"/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="hair"/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="hair"/><bottom style="hair"/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="hair"/><bottom style="thin"/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border><border><left style="thick"/><right style="thick"/><top style="thick"/><bottom style="thick"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${xfXml}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { xml: styleXml, sayQuantityStyle };
}

function fittingItemCodeStyle(style: number, value: string) {
  const length = value.length;
  if (style === 8) return length <= 8 ? 8 : length <= 9 ? 20 : 21;
  if (style === 18) return length <= 8 ? 18 : length <= 9 ? 24 : 25;
  if (style === 11) return length <= 10 ? 11 : length <= 11 ? 22 : 23;
  return style;
}

/** Measurement Sheet workbook layout based on the supplied A:L reference sheet. */
export async function exportMeasurementSheetToExcel(root: HTMLElement | null, workName: string, fileBaseName = "Measurement_Sheet", sourceItems: MeasurementSourceItem[] = [], documentSettings: MeasurementDocumentSettings = {}, estimateId = "N/A", estimateData?: SharedEstimateData) {
  if (estimateData) {
    await exportSharedSheet("Measurement Sheet", fileBaseName, worksheet => {
      buildMeasurementSheetLayout(worksheet, estimateData, estimateId);
    });
    return;
  }
  if (!root) {
    window.alert("The Measurement Sheet is not ready to export yet.");
    return;
  }
  const table = root.querySelector("table");
  if (!table) {
    window.alert("There are no measurements to export.");
    return;
  }

  type Cell = { value: string | number; style?: number; formula?: string };
  type Row = { cells: Cell[]; height?: number; merge?: Array<[number, number]> };
  const columnCount = 12;
  const project = documentSettings.projectDetails ?? {};
  const stateRow = Array.from({ length: columnCount }, () => ({ value: "" } as Cell));
  stateRow[0] = { value: `STATE : ${project.state || "GOA"}`, style: 15 };
  stateRow[11] = { value: `DIVISION : ${project.division || "GCD"}`, style: 16 };
  const branchRow = Array.from({ length: columnCount }, () => ({ value: "" } as Cell));
  branchRow[0] = { value: `BRANCH : ${project.branch || "B&R"}`, style: 15 };
  branchRow[11] = { value: `SUB DIVISION : ${project.subDivision || "Kolhapur Sub Division"}`, style: 16 };
  const columnHeaders = ["Item\nNo.", "Description", "No.", "No.", "No.", "Length", "Width", "Height", "Co-ef.", "Quantity", "Unit", "DSR\nCode"];
  const rows: Row[] = [
    { cells: [{ value: "MEASUREMENT SHEET", style: 1 }], height: 22, merge: [[1, 12]] },
    { cells: [] },
    { cells: stateRow },
    { cells: branchRow },
    { cells: [] },
    { cells: [{ value: `Name of Work : ${workName.trim()} `, style: 2 }], height: wrappedHeight(`Name of Work : ${workName.trim()}`, 100, 14), merge: [[1, 12]] },
    { cells: [] },
    { cells: columnHeaders.map((value, index) => ({ value, style: index >= 5 && index <= 8 ? 26 : 3 })), height: 30 },
  ];
  const merges: string[] = ["<mergeCell ref=\"A1:L1\"/>", "<mergeCell ref=\"A6:L6\"/>"];
  const rowsSource = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  let activeItem: { unit: string; itemCode: string; rawQty: number; roundQty: number; hasEntries: boolean; hasRoundOff: boolean; detailStart: number | null; detailEnd: number | null } | null = null;
  const addRow = (cells: Cell[], height?: number, merge?: Array<[number, number]>) => {
    rows.push({ cells, height, merge });
    const rowIndex = rows.length;
    const summaryLabel = String(cells[1]?.value ?? "").trim();
    const isSummaryRow = /^(?:round off|total|say|summary)$/i.test(summaryLabel);
    if (!isSummaryRow) {
      merge?.forEach(([start, end]) => {
        if (start < end) merges.push(`<mergeCell ref=\"${columnName(start)}${rowIndex}:${columnName(end)}${rowIndex}\"/>`);
      });
    }
    return rowIndex;
  };
  const blankCells = () => Array.from({ length: columnCount }, () => ({ value: "" } as Cell));
  const finishItem = () => {
    if (!activeItem || !activeItem.hasEntries) {
      activeItem = null;
      return;
    }
    const total = activeItem.rawQty;
    const finalQty = total + activeItem.roundQty;
    const totalCells = blankCells();
    totalCells[1] = { value: "Total", style: 2 };
    totalCells[9] = { value: Number(total.toFixed(2)), style: 6, formula: activeItem.detailStart && activeItem.detailEnd ? `SUM(J${activeItem.detailStart}:J${activeItem.detailEnd})` : "0" };
    const totalRow = addRow(totalCells);
    let roundRow: number | null = null;
    if (activeItem.hasRoundOff) {
      const roundCells = blankCells();
      roundCells[1] = { value: "Round off", style: 4 };
      roundCells[9] = { value: Number(activeItem.roundQty.toFixed(2)), style: 5 };
      roundRow = addRow(roundCells);
    }
    const sayCells = blankCells();
    sayCells[1] = { value: "Say", style: 2 };
    sayCells[9] = { value: Number(finalQty.toFixed(2)), style: 6, formula: roundRow ? `ROUND(J${totalRow}+J${roundRow},2)` : `ROUND(J${totalRow},2)` };
    sayCells[10] = { value: activeItem.unit, style: 5 };
    addRow(sayCells);
    activeItem = null;
  };

  for (const tr of rowsSource) {
    const cells = Array.from(tr.cells);
    if (!cells.length) continue;
    const cls = tr.className;
    // Subhead rows are the first row of each SH section in the screen table.
    if (cls.includes("border-t-2")) {
      finishItem();
      const row = blankCells();
      const description = cleanDescription(cellText(cells[3]));
      row[1] = { value: description, style: 19 };
      addRow(row, mergedDescriptionHeight(description), [[2, 11]]);
      continue;
    }
    // Item and ancestor rows contain serial number, DSR code and item description.
    if (cells.length >= 4 && (cls.includes("border-b-2") || cls.includes("bg-slate-900/50"))) {
      finishItem();
      const isItem = cls.includes("border-b-2");
      const serial = cellText(cells[1]);
      const itemCode = cellText(cells[2]);
      const description = cleanDescription(cellText(cells[3]));
      const output = blankCells();
      output[0] = { value: serial, style: isItem ? 8 : 18 };
      output[1] = { value: description, style: isItem ? 10 : 9 };
      output[11] = { value: itemCode, style: 11 };
      addRow(output, mergedDescriptionHeight(description), [[2, 11]]);
      if (isItem) {
        const summary = cellText(cells[4]);
        const unitMatch = summary.match(/Total Qty:\s*[\d,.]+\s*(.*)$/i);
        const sourceItem = sourceItems.find(item => String(item?.itemCode ?? item?.code ?? "").trim() === itemCode);
        const summaryUnit = (unitMatch?.[1] || "").replace(/\s*Add\s*rows?\s*:?\s*\d+.*$/i, "").trim();
        const sourceUnit = String(sourceItem?.unit || "").trim();
        activeItem = { unit: sourceUnit || summaryUnit, itemCode, rawQty: 0, roundQty: 0, hasEntries: false, hasRoundOff: false, detailStart: null, detailEnd: null };
      }
      continue;
    }
    // Measurement lines have a two-column blank action/serial cell, then description and values.
    if (cells[0]?.colSpan >= 2 && cells.length >= 12) {
      if (!activeItem) continue;
      const output = blankCells();
      const description = cleanDescription(cellText(cells[2]));
      output[1] = { value: description, style: 10 };
      const inputColumns = [3, 4, 5, 6, 7, 8, 9];
      const outputColumns = [2, 3, 4, 5, 6, 7, 8];
      inputColumns.forEach((sourceIndex, index) => {
        const input = cells[sourceIndex]?.querySelector("input") as HTMLInputElement | null;
        const value = input?.value || "";
        if (value !== "") {
          const outputColumn = outputColumns[index];
          const style = outputColumn >= 5 && outputColumn <= 7 ? 13 : 12;
          output[outputColumn] = { value: Number.isFinite(Number(value)) ? Number(value) : value, style };
        }
      });
      const qtyText = cellText(cells[10]);
      const qty = Number(qtyText.replace(/,/g, "")) || 0;
      const isRoundOff = /^rounded off$/i.test(description);
      if (qtyText) output[9] = { value: qty, style: 13, formula: isRoundOff ? undefined : `ROUND(PRODUCT(C${rows.length + 1}:I${rows.length + 1}),2)` };
      if (isRoundOff) {
        activeItem.roundQty += qty;
        activeItem.hasRoundOff = true;
        activeItem.hasEntries = true;
        continue;
      }
      const detailRow = addRow(output);
      activeItem.hasEntries = true;
      activeItem.rawQty += qty;
      activeItem.detailStart ??= detailRow;
      activeItem.detailEnd = detailRow;
    }
  }
  finishItem();
  const lastMeasurementRow = rows.length;

  for (let index = 0; index < 4; index++) {
    addRow(blankCells(), 18);
  }

  const footerValues = [
    [project.leftAETitle || "Assistant Engineer,", project.rightAETitle || "Assistant Engineer,"],
    [project.leftAEOffice || "CPWD, Kolhapur.", project.rightAEOffice || "GCD, CPWD, Goa."],
  ];
  footerValues.forEach(([left, right]) => {
    const footerRow = blankCells();
    footerRow[0] = { value: left, style: 15 };
    footerRow[6] = { value: right, style: 16 };
    addRow(footerRow, undefined, [[1, 6], [7, 12]]);
  });
  for (let index = 0; index < 2; index++) {
    const blankFooterRow = blankCells();
    addRow(blankFooterRow, 18, [[1, 6], [7, 12]]);
  }
  const { xml: styles, sayQuantityStyle } = buildMeasurementStyles();
  const rowXml = rows.map((row, index) => {
    const rowNumber = index + 1;
    const inMeasurementGrid = rowNumber >= 9 && rowNumber <= lastMeasurementRow;
    const gridVariant = rowNumber === 9 && rowNumber === lastMeasurementRow ? 3 : rowNumber === 9 ? 0 : rowNumber === lastMeasurementRow ? 2 : 1;
    const values = row.cells.map((cell, colIndex) => {
      const value = cell.value;
      if ((value === "" || value === null || value === undefined) && !inMeasurementGrid) return "";
      const ref = `${columnName(colIndex + 1)}${rowNumber}`;
      const baseStyle = inMeasurementGrid && colIndex >= 5 && colIndex <= 9
        ? 13
        : typeof value === "string" ? fittingItemCodeStyle(cell.style ?? 10, value) : (cell.style ?? 10);
      const isSayQuantity = row.cells[1]?.value === "Say" && colIndex === 9;
      const style = isSayQuantity ? sayQuantityStyle : inMeasurementGrid ? 27 + gridVariant * 27 + baseStyle : baseStyle;
      if (value === "" || value === null || value === undefined) return `<c r="${ref}" s="${style}"/>`;
      if (cell.formula) return `<c r=\"${ref}\" s=\"${style}\"><f>${xml(cell.formula)}</f><v>${typeof value === "number" ? value : xml(value)}</v></c>`;
      return typeof value === "number" && Number.isFinite(value)
        ? `<c r=\"${ref}\" s=\"${style}\"><v>${value}</v></c>`
        : `<c r=\"${ref}\" s=\"${style}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r=\"${index + 1}\"${row.height ? ` ht=\"${row.height}\" customHeight=\"1\"` : ""}>${values}</row>`;
  }).join("");
  // Key every width by its worksheet column index so no column can be skipped.
  const widthsByColumn: Record<number, number> = {
    1: 7.5, // A: Item No.
    2: 35,  // B: Description
    3: 3.5, // C: No.
    4: 3.5, // D: No.
    5: 3.5, // E: No.
    6: 9,   // F: Length
    7: 8,   // G: Width
    8: 8,   // H: Height
    9: 5,   // I: Co-ef.
    10: 9,  // J: Quantity
    11: 6,  // K: Unit
    12: 9,  // L: DSR Code
  };
  const widths = Array.from({ length: columnCount }, (_, zeroBasedIndex) => {
    const columnIndex = zeroBasedIndex + 1;
    const width = widthsByColumn[columnIndex];
    if (width === undefined) throw new Error(`Missing Measurement Sheet width for column ${columnIndex}.`);
    return width;
  });
  const cols = widths.map((width, index) => `<col min=\"${index + 1}\" max=\"${index + 1}\" width=\"${width}\" customWidth=\"1\"/>`).join("");
  const mergesXml = `<mergeCells count=\"${merges.length}\">${merges.join("")}</mergeCells>`;
  const lastRow = rows.length;
  const safeEstimateId = String(estimateId || "N/A").replace(/&/g, "&&");
  const pageFooter = xml(`&LMeasurement Sheet&CPage &P of &N&R${safeEstimateId}`);
  const worksheet = `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetPr><pageSetUpPr fitToPage=\"0\" autoPageBreaks=\"1\"/></sheetPr><sheetViews><sheetView workbookViewId=\"0\" showGridLines=\"0\" zoomScale=\"115\" view=\"pageBreakPreview\"/></sheetViews><sheetFormatPr defaultRowHeight=\"14.5\" defaultColWidth=\"8.6273\" baseColWidth=\"8\"/><cols>${cols}</cols><sheetData>${rowXml}</sheetData>${mergesXml}<printOptions horizontalCentered=\"0\" verticalCentered=\"0\"/><pageMargins left=\"0.75\" right=\"0.75\" top=\"0.75\" bottom=\"0.75\" header=\"0.3\" footer=\"0.3\"/><pageSetup paperSize=\"9\" orientation=\"portrait\" scale=\"85\"/><headerFooter differentOddEven=\"1\"><oddFooter>${pageFooter}</oddFooter><evenFooter>${pageFooter}</evenFooter></headerFooter></worksheet>`;
  const workbook = `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"mmt\" sheetId=\"1\" r:id=\"rId1\"/></sheets><definedNames><definedName name=\"_xlnm.Print_Area\" localSheetId=\"0\">'mmt'!$A$1:$L$${lastRow}</definedName><definedName name=\"_xlnm.Print_Titles\" localSheetId=\"0\">'mmt'!$8:$8</definedName></definedNames></workbook>`;
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>` },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>` },
    { name: "xl/styles.xml", data: styles }, { name: "xl/worksheets/sheet1.xml", data: worksheet },
  ];
  const url = URL.createObjectURL(createStoredZip(files));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileBaseName.replace(/[^\w-]+/g, "_")}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wrappedHeight(text: string, width: number, lineHeight: number) {
  if (!text) return 14.5;
  const approxChars = Math.max(10, width * 1.5);
  const lines = text.split(/\r?\n/).reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / approxChars)), 0);
  return Math.max(14.5, Math.min(420, lines * lineHeight + 4));
}

function mergedDescriptionHeight(text: string) {
  const CHARS_PER_LINE = 85;
  const BASE_ROW_HEIGHT = 15;
  const descriptionText = text.replace(/\s+$/g, "");
  if (descriptionText.length === 0) return undefined;
  let calculatedLines = 0;
  const paragraphs = descriptionText.split("\n");
  paragraphs.forEach(paragraph => {
    calculatedLines += paragraph.length === 0
      ? 1
      : Math.ceil(paragraph.length / CHARS_PER_LINE);
  });
  return calculatedLines * BASE_ROW_HEIGHT;
}

type AbstractCell = { value: string | number; style: number; formula?: string };
type AbstractRow = { cells: AbstractCell[]; height?: number; borderless?: boolean };

function abstractRow(): AbstractCell[] {
  return Array.from({ length: 7 }, () => ({ value: "", style: 0 }));
}

function abstractNumber(value: string) {
  if (!value.trim()) return "";
  const parsed = Number(value.replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : value;
}

function abstractRowHeight(value: string, charsPerLine: number, lineHeight: number) {
  const trimmed = value.replace(/\s+$/g, "");
  const lines = trimmed.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.max(18, Math.min(420, lines * lineHeight + 4));
}

function normalizeAbstractDescription(value: string) {
  const description = value.trim();
  const modifiedDsrDescription = description
    .replace(/^SH\s*:?\s*50\s*:\s*/i, "")
    .replace(/\s*\(mDSR\)\s*$/i, "")
    .trim();
  if (modifiedDsrDescription.toUpperCase() === "MODIFIED DSR ITEMS") {
    return "SH 50: MODIFIED DSR ITEMS";
  }
  const normalized = description.toUpperCase();
  if (normalized.includes("NON-SCHEDULE ITEMS") || normalized.includes("NON-SCHEDULED ITEMS")) {
    return "SH 51: NON-SCHEDULED ITEMS";
  }
  if (description.includes("Total of DSR / Schedule Items:") || description.includes("Total of mDSR & Schedule Items:")) {
    return "Total of Schedule & mDSR Items:";
  }
  if (description.includes("Add Cost Index @ 15% on DSR Items:") || description.includes("Add Cost Index @ 15% on DSR & mDSR Items:")) {
    return "Add Cost Index @ 15% on DSR & mDSR Items:";
  }
  if (description.toUpperCase().includes("SUBTOTAL OF DSR AND MDSR ITEMS ENHANCED BY CI")) {
    return "Subtotal of DSR and mDSR items enhanced by CI @ 15%:";
  }
  return description.replace(/\s+$/g, "");
}

function abstractFormulaResult(value: AbstractCell["value"]) {
  const parsed = Number(String(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundedAbstractFormula(expression: string) {
  return /^ROUND\(/i.test(expression) ? expression : `ROUND(${expression},0)`;
}

/** Exports the Detailed Abstract as a seven-column Abstract of Cost workbook. */
export async function exportAbstractOfCostToExcel(
  root: HTMLElement | null,
  projectName: string,
  fileBaseName = "Abstract_of_Cost",
  projectDetails: Record<string, unknown> = {},
  estimateId = "N/A",
  estimateData?: SharedEstimateData,
) {
  if (estimateData) {
    await exportSharedSheet("Abstract of Cost", fileBaseName, worksheet => {
      buildAbstractSheetLayout(worksheet, estimateData, estimateId);
    });
    return;
  }
  if (!root) {
    window.alert("The Abstract Sheet is not ready to export yet.");
    return;
  }
  const table = root.querySelector("table");
  if (!table) {
    window.alert("There is no Abstract Sheet to export.");
    return;
  }

  const rows: AbstractRow[] = [];
  const merges: string[] = ["<mergeCell ref=\"A1:G1\"/>"];
  const title = abstractRow();
  title[0] = { value: "ABSTRACT OF COST", style: 1 };
  rows.push({ cells: title, height: 24 });
  rows.push({ cells: abstractRow() });

  const stateRow = abstractRow();
  stateRow[0] = { value: `STATE : ${String(projectDetails.state || "GOA")}`, style: 2 };
  stateRow[6] = { value: `DIVISION : ${String(projectDetails.division || "GCD")}`, style: 3 };
  rows.push({ cells: stateRow });
  const branchRow = abstractRow();
  branchRow[0] = { value: `BRANCH : ${String(projectDetails.branch || "B&R")}`, style: 2 };
  branchRow[6] = { value: `SUB DIVISION : ${String(projectDetails.subDivision || "Kolhapur Sub Division")}`, style: 3 };
  rows.push({ cells: branchRow });
  rows.push({ cells: abstractRow() });

  const workName = `Name of Work : ${projectName.replace(/\s+$/g, "")}`;
  const workRow = abstractRow();
  workRow[0] = { value: workName, style: 4 };
  rows.push({ cells: workRow, height: abstractRowHeight(workName, 110, 18) });
  merges.push("<mergeCell ref=\"A6:G6\"/>");
  rows.push({ cells: abstractRow() });

  const headings = ["Item\nNo.", "Description", "Unit", "Quantity", "Rate (₹)", "Amount (₹)", "DSR\nCode"];
  const headerRow = abstractRow();
  headings.forEach((value, index) => {
    headerRow[index] = { value, style: 5 };
  });
  rows.push({ cells: headerRow, height: 30 });

  const unboldSummaryLabels = new Set([
    "Add Cost Index @ 15% on DSR & mDSR Items:",
    "Total of Non-Schedule (NS) Items:",
    "Add EPF @ 8.750%:",
    "Add ESI @ 2.275%:",
    "Add Contingency @ 5%:",
  ]);
  const detailedDescriptionStyle = (description: string) =>
    description.startsWith("SH") || description.toUpperCase().includes("SUBTOTAL") ? 16 : 9;
  let skipEmptyAfterSH51Subtotal = false;
  let currentShStartRow: number | null = null;
  let currentShItemAmount = 0;
  let currentShLabel = "";
  const shSubtotalRows: Array<{ row: number; label: string; result: number }> = [];
  for (const sourceRow of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
    const sourceCells = Array.from(sourceRow.cells);
    if (!sourceCells.length) continue;

    const output = abstractRow();
    const sourceText = sourceCells.map(cellText);
    const mergedSummary = sourceCells[0]?.colSpan >= 7 && sourceCells.length >= 3;
    const isCISubtotal = mergedSummary && sourceText[0].toUpperCase().includes("SUBTOTAL OF DSR AND MDSR ITEMS ENHANCED BY CI");
    const subheadSubtotal = mergedSummary && sourceText[0].toUpperCase().includes("SUBTOTAL") && !isCISubtotal;
    const summarySubhead = mergedSummary && (sourceText[0].trim().startsWith("SH") || /SUB HEAD/i.test(sourceText[0]));
    const sectionHeading = sourceCells[3]?.colSpan > 1 && sourceCells.length >= 4;
    const emptySeparator = sourceCells.every(cell => !cellText(cell));
    const descriptionText = normalizeAbstractDescription(sourceText[3] || "");

    if (skipEmptyAfterSH51Subtotal && emptySeparator) {
      skipEmptyAfterSH51Subtotal = false;
      continue;
    }
    skipEmptyAfterSH51Subtotal = false;

    if (mergedSummary) {
      const label = normalizeAbstractDescription(sourceText[0]);
      const unboldSummary = unboldSummaryLabels.has(label);
      if (subheadSubtotal) {
        output[1] = { value: label, style: detailedDescriptionStyle(label) };
        const subtotalRow = rows.length + 1;
        const subtotalResult = currentShStartRow === null
          ? abstractFormulaResult(abstractNumber(sourceText[1]))
          : currentShItemAmount;
        output[5] = {
          value: Math.round(subtotalResult),
          style: 7,
          formula: currentShStartRow === null ? undefined : `ROUND(SUM(F${currentShStartRow}:F${subtotalRow - 1}),0)`,
        };
        shSubtotalRows.push({ row: subtotalRow, label: `${currentShLabel} ${label}`, result: subtotalResult });
        currentShStartRow = null;
        currentShItemAmount = 0;
      } else if (summarySubhead) {
        output[1] = { value: label, style: detailedDescriptionStyle(label) };
        output[5] = { value: abstractNumber(sourceText[1]), style: 7 };
      } else {
        output[0] = { value: label, style: unboldSummary ? 19 : 6 };
        merges.push(`<mergeCell ref="A${rows.length + 1}:E${rows.length + 1}"/>`);
        output[5] = { value: abstractNumber(sourceText[1]), style: 7 };
      }
      output[6] = { value: sourceText[2], style: 20 };
    } else if (sectionHeading) {
      output[0] = { value: sourceText[1], style: 8 };
      const isSubhead = descriptionText.startsWith("SH") || /SUB HEAD/i.test(descriptionText);
      output[1] = { value: descriptionText, style: detailedDescriptionStyle(descriptionText) };
      output[6] = { value: sourceText[2], style: 8 };
      if (!isSubhead) merges.push(`<mergeCell ref="B${rows.length + 1}:F${rows.length + 1}"/>`);
      if (isSubhead) {
        currentShStartRow = rows.length + 2;
        currentShItemAmount = 0;
        currentShLabel = descriptionText;
      }
    } else if (sourceCells[0]?.colSpan >= 9 && sourceText[0]) {
      output[0] = { value: sourceText[0].replace(/\s+$/g, ""), style: 9 };
      merges.push(`<mergeCell ref="A${rows.length + 1}:G${rows.length + 1}"/>`);
    } else if (!emptySeparator) {
      output[0] = { value: sourceText[1], style: 0 };
      output[1] = { value: descriptionText, style: detailedDescriptionStyle(descriptionText) };
      output[2] = { value: sourceText[4], style: 0 };
      output[3] = { value: abstractNumber(sourceText[5] || ""), style: 10 };
      output[4] = { value: abstractNumber(sourceText[6] || ""), style: 10 };
      output[5] = { value: abstractNumber(sourceText[7] || ""), style: 10 };
      output[6] = { value: sourceText[2], style: 0 };
      if (sourceText[5].trim() && sourceText[6].trim()) {
        const quantity = abstractFormulaResult(output[3].value);
        const rate = abstractFormulaResult(output[4].value);
        const calculatedAmount = Math.round(quantity * rate);
        const itemRow = rows.length + 1;
        output[5] = { value: calculatedAmount, style: 10, formula: `ROUND(D${itemRow}*E${itemRow},0)` };
        currentShItemAmount += calculatedAmount;
      }
    }

    rows.push({
      cells: output,
      height: sectionHeading
        ? abstractRowHeight(String(output[1].value), 56, 15)
        : output[1].value
          ? abstractRowHeight(String(output[1].value), 56, 15)
          : undefined,
    });

    if (subheadSubtotal && sourceText[0].trim().toUpperCase().startsWith("SUBTOTAL FOR SH 51: NON-SCHEDULE ITEMS (NS)")) {
      rows.push({ cells: abstractRow(), height: 18, borderless: true });
      merges.push(`<mergeCell ref="A${rows.length}:G${rows.length}"/>`);
      skipEmptyAfterSH51Subtotal = true;
    }
  }

  const summaryRows = rows.map((row, index) => {
    const label = row.cells.slice(0, 2).find(cell => typeof cell.value === "string" && cell.value.trim())?.value;
    return { row, rowNumber: index + 1, label: typeof label === "string" ? label : "" };
  });
  const findSummaryRow = (predicate: (label: string) => boolean) => summaryRows.find(entry => predicate(entry.label));
  const formulaFor = (
    entry: (typeof summaryRows)[number] | undefined,
    formula: (rowNumber: number) => string | undefined,
    result?: number,
  ) => {
    if (!entry) return;
    const amountCell = entry.row.cells[5];
    const expression = formula(entry.rowNumber);
    if (!expression) return;
    amountCell.formula = roundedAbstractFormula(expression);
    amountCell.value = Math.round(result ?? abstractFormulaResult(amountCell.value));
  };
  const sumFormula = (subtotalEntries: typeof shSubtotalRows) => subtotalEntries.length
    ? `SUM(${subtotalEntries.map(entry => `F${entry.row}`).join(",")})`
    : undefined;
  const totalDsr = findSummaryRow(label => label.includes("Total of Schedule & mDSR Items:"));
  const ci = findSummaryRow(label => label.includes("Add Cost Index @"));
  const subtotalDsrCi = findSummaryRow(label => label.toLowerCase().includes("subtotal of dsr and mdsr items enhanced by ci"));
  const modifiedCost = findSummaryRow(label => label.includes("Modified estimated cost after applying multiplying factor"));
  const totalNs = findSummaryRow(label => label.includes("Total of Non-Schedule (NS) Items:"));
  const baseTotal = findSummaryRow(label => label.includes("Base Estimate Total"));
  const epf = findSummaryRow(label => label.includes("Add EPF @"));
  const esi = findSummaryRow(label => label.includes("Add ESI @"));
  const contingency = findSummaryRow(label => label.includes("Add Contingency @"));
  const grandTotal = findSummaryRow(label => label.includes("GRAND TOTAL:"));
  const say = findSummaryRow(label => label.trim() === "SAY:");
  const scheduleSubtotals = shSubtotalRows.filter(entry => !/SH\s*:?\s*51\b|NON-SCHEDULED ITEMS|NON-SCHEDULE ITEMS/i.test(entry.label));
  const nonScheduleSubtotals = shSubtotalRows.filter(entry => /SH\s*:?\s*51\b|NON-SCHEDULED ITEMS|NON-SCHEDULE ITEMS/i.test(entry.label));
  const percentage = (entry: (typeof summaryRows)[number] | undefined, fallback = 0) => {
    const match = entry?.label.match(/@\s*([\d.]+)\s*%/);
    return match ? Number(match[1]) / 100 : fallback;
  };

  formulaFor(totalDsr, () => sumFormula(scheduleSubtotals), scheduleSubtotals.reduce((sum, entry) => sum + entry.result, 0));
  formulaFor(ci, () => totalDsr ? `F${totalDsr.rowNumber}*${percentage(ci)}` : undefined);
  formulaFor(subtotalDsrCi, () => totalDsr && ci ? `F${totalDsr.rowNumber}+F${ci.rowNumber}` : undefined);
  const factorMatch = modifiedCost?.label.match(/factor\s*\(([\d.]+)\)/i);
  const modificationFactor = factorMatch ? Number(factorMatch[1]) : Number(projectDetails.gstModificationFactor) || 1;
  formulaFor(modifiedCost, () => subtotalDsrCi ? `F${subtotalDsrCi.rowNumber}*${modificationFactor}` : undefined);
  formulaFor(totalNs, () => sumFormula(nonScheduleSubtotals), nonScheduleSubtotals.reduce((sum, entry) => sum + entry.result, 0));
  formulaFor(baseTotal, () => modifiedCost && totalNs ? `F${modifiedCost.rowNumber}+F${totalNs.rowNumber}` : undefined);

  for (const contribution of [
    { entry: epf, rate: percentage(epf) },
    { entry: esi, rate: percentage(esi) },
    { entry: contingency, rate: percentage(contingency) },
  ]) {
    formulaFor(contribution.entry, () => baseTotal ? `F${baseTotal.rowNumber}*${contribution.rate}` : undefined);
  }
  if (grandTotal && baseTotal) {
    formulaFor(grandTotal, () => `SUM(F${baseTotal.rowNumber}:F${grandTotal.rowNumber - 1})`);
  }
  formulaFor(
    say,
    () => grandTotal ? `ROUND(F${grandTotal.rowNumber},-2)` : undefined,
    grandTotal ? Math.round(abstractFormulaResult(grandTotal.row.cells[5].value) / 100) * 100 : undefined,
  );

  const lastDataRow = say?.rowNumber || rows.length;
  const signatoryCells = (values: Array<[number, string, number]>) => {
    const cells = abstractRow();
    values.forEach(([column, value, style]) => {
      cells[column] = { value, style };
    });
    return cells;
  };
  rows.push({ cells: abstractRow(), height: 18, borderless: true });
  rows.push({ cells: abstractRow(), height: 18, borderless: true });
  rows.push({ cells: abstractRow(), height: 18, borderless: true });
  rows.push({ cells: signatoryCells([[1, "Assistant Engineer,", 21], [5, "Assistant Engineer,", 23]]), height: 18, borderless: true });
  rows.push({ cells: signatoryCells([[1, "CPWD, Kolhapur.", 21], [5, "GCD, CPWD, Goa.", 23]]), height: 18, borderless: true });
  for (let index = 0; index < 3; index++) rows.push({ cells: abstractRow(), height: 18, borderless: true });
  const executiveTitleRow = rows.length + 1;
  rows.push({ cells: signatoryCells([[0, "Executive Engineer & Senior Manager (C)-I,", 22]]), height: 18, borderless: true });
  merges.push(`<mergeCell ref="A${executiveTitleRow}:G${executiveTitleRow}"/>`);
  const executiveOfficeRow = rows.length + 1;
  rows.push({ cells: signatoryCells([[0, "GCD, CPWD, Goa.", 22]]), height: 18, borderless: true });
  merges.push(`<mergeCell ref="A${executiveOfficeRow}:G${executiveOfficeRow}"/>`);

  const widths = [8, 56, 7.5, 9, 9, 12.5, 10];
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const cellFormats = [
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="justify" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="justify" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
  ];
  const baseAmountStyle = cellFormats.length;
  cellFormats.push(`<xf numFmtId="165" fontId="4" fillId="0" borderId="2" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`);
  const grandTotalAmountStyle = cellFormats.length;
  cellFormats.push(`<xf numFmtId="165" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`);
  const sayAmountStyle = cellFormats.length;
  cellFormats.push(`<xf numFmtId="165" fontId="5" fillId="0" borderId="2" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`);
  const baseReferenceStyle = cellFormats.length;
  cellFormats.push(`<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`);
  const rowXml = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.cells.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowNumber}`;
      let style = cell.style;
      if (!row.borderless && rowNumber > 8 && rowNumber <= lastDataRow) {
        if (style === 0) style = 14;
        if ([2, 3, 6].includes(columnIndex)) {
          style = cell.style === 20
            ? 20
            : cell.style === 6 || cell.style === 8
              ? 17
              : cell.style === 7
                ? 18
                : cell.style === 10 && columnIndex === 3
                  ? 15
                  : 14;
        }
      }
      if (rowNumber === baseTotal?.rowNumber && columnIndex === 5) style = baseAmountStyle;
      if (rowNumber === grandTotal?.rowNumber && columnIndex === 5) style = grandTotalAmountStyle;
      if (rowNumber === say?.rowNumber && columnIndex === 5) style = sayAmountStyle;
      if (rowNumber === baseTotal?.rowNumber && columnIndex === 6) style = baseReferenceStyle;
      if (cell.value === "") return `<c r="${reference}" s="${style}"/>`;
      if (cell.formula) return `<c r="${reference}" s="${style}"><f>${xml(cell.formula)}</f><v>${abstractFormulaResult(cell.value)}</v></c>`;
      if (typeof cell.value === "number") return `<c r="${reference}" s="${style}"><v>${cell.value}</v></c>`;
      return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}"${row.height ? ` ht="${row.height}" customHeight="1"` : ""}>${cells}</row>`;
  }).join("");
  const borders = `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border><border><left style="medium"/><right style="medium"/><top style="medium"/><bottom style="medium"/><diagonal/></border></borders>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="##,##,##0"/></numFmts><fonts count="6"><font><sz val="10"/><name val="Book Antiqua"/></font><font><b/><sz val="14"/><name val="Book Antiqua"/></font><font><sz val="10"/><name val="Book Antiqua"/></font><font><sz val="10"/><name val="Book Antiqua"/></font><font><b/><sz val="10"/><name val="Book Antiqua"/></font><font><b/><sz val="14"/><name val="Book Antiqua"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>${borders}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${cellFormats.length}">${cellFormats.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const mergeXml = `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>`;
  const safeEstimateId = String(estimateId || "N/A").replace(/&/g, "&&");
  const footer = xml(`&LAbstract of Cost&CPage &P of &N&R${safeEstimateId}`);
  const lastRow = rows.length;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="0"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100" view="pageBreakPreview"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rowXml}</sheetData>${mergeXml}<pageMargins left="0.75" right="0.75" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" scale="85"/><headerFooter differentOddEven="1"><oddFooter>${footer}</oddFooter><evenFooter>${footer}</evenFooter></headerFooter></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Abstract of Cost" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Abstract of Cost'!$A$1:$G$${lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Abstract of Cost'!$8:$8</definedName></definedNames></workbook>`;
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: worksheet },
  ];
  const url = URL.createObjectURL(createStoredZip(files));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileBaseName.replace(/[^\w-]+/g, "_")}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports the General Abstract using the seven-column Abstract of Cost print layout. */
export async function exportGenAbstToExcel(
  root: HTMLElement | null,
  projectName: string,
  fileBaseName = "General_Abstract",
  projectDetails: Record<string, unknown> = {},
  estimateId = "N/A",
  estimateData?: SharedEstimateData,
) {
  if (estimateData) {
    await exportSharedSheet("General Abstract", fileBaseName, worksheet => {
      buildGenAbstSheetLayout(worksheet, estimateData, estimateId);
    });
    return;
  }
  if (!root) {
    window.alert("The General Abstract is not ready to export yet.");
    return;
  }
  const table = root.querySelector("table");
  if (!table) {
    window.alert("There is no General Abstract to export.");
    return;
  }

  const rows: AbstractRow[] = [];
  const merges: string[] = ["<mergeCell ref=\"A1:G1\"/>", "<mergeCell ref=\"A6:G6\"/>", "<mergeCell ref=\"B8:E8\"/>"];
  const title = abstractRow();
  title[0] = { value: "GENERAL ABSTRACT", style: 1 };
  rows.push({ cells: title, height: 24 });
  rows.push({ cells: abstractRow() });

  const stateRow = abstractRow();
  stateRow[0] = { value: `STATE : ${String(projectDetails.state || "GOA")}`, style: 2 };
  stateRow[6] = { value: `DIVISION : ${String(projectDetails.division || "GCD")}`, style: 3 };
  rows.push({ cells: stateRow });
  const branchRow = abstractRow();
  branchRow[0] = { value: `BRANCH : ${String(projectDetails.branch || "B&R")}`, style: 2 };
  branchRow[6] = { value: `SUB DIVISION : ${String(projectDetails.subDivision || "Kolhapur Sub Division")}`, style: 3 };
  rows.push({ cells: branchRow });
  rows.push({ cells: abstractRow() });

  const workName = `Name of Work : ${String(projectName || projectDetails.nameOfWork || "").replace(/\s+$/g, "")}`;
  const workRow = abstractRow();
  workRow[0] = { value: workName, style: 4 };
  rows.push({ cells: workRow, height: abstractRowHeight(workName, 110, 18) });
  rows.push({ cells: abstractRow() });

  const headerRow = abstractRow();
  ["Sl. No.", "Description of Item", "", "", "", "Amount (₹)", "Ref"].forEach((value, index) => {
    headerRow[index] = { value, style: 5 };
  });
  rows.push({ cells: headerRow, height: 30 });

  const unboldSummaryItems = new Set([
    "Add Cost Index @ 15% on DSR & mDSR Items:",
    "Total of Non-Schedule (NS) Items:",
    "Add EPF @ 8.750%:",
    "Add ESI @ 2.275%:",
    "Add Contingency @ 5%:",
  ]);
  type SummaryEntry = { row: AbstractRow; rowNumber: number; label: string };
  const summaryRows: SummaryEntry[] = [];
  const sectionRows: Array<{ rowNumber: number; label: string; result: number }> = [];
  for (const sourceRow of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
    const sourceCells = Array.from(sourceRow.cells);
    if (!sourceCells.length) continue;
    const texts = sourceCells.map(cellText);
    if (!texts.some(Boolean)) continue;

    const output = abstractRow();
    const isSummary = sourceCells[0].colSpan > 1 && sourceCells.length >= 3;
    const label = isSummary ? texts[0] : texts[1] || "";
    const isSection = !isSummary && /^SH\b/i.test(label);
    const rowNumber = rows.length + 1;
    const amount = abstractFormulaResult(isSummary ? texts[1] : texts[2]);
    const ref = isSummary ? texts[2] : texts[3];
    const canonicalLabel = label.trim().replace(/^Add EPF @ 8\.75%:$/, "Add EPF @ 8.750%:");
    const unboldSummary = isSummary && unboldSummaryItems.has(canonicalLabel);

    if (isSummary) {
      output[1] = { value: label, style: unboldSummary ? 7 : 8 };
      merges.push(`<mergeCell ref="B${rowNumber}:E${rowNumber}"/>`);
      output[5] = { value: amount, style: unboldSummary ? 9 : 10 };
      output[6] = { value: ref, style: /[+=]/.test(ref) ? 11 : 5 };
      summaryRows.push({ row: { cells: output }, rowNumber, label });
    } else {
      output[0] = { value: texts[0], style: 5 };
      output[1] = { value: label, style: 7 };
      merges.push(`<mergeCell ref="B${rowNumber}:E${rowNumber}"/>`);
      output[5] = { value: amount, style: isSection ? 10 : 9 };
      if (isSection) sectionRows.push({ rowNumber, label, result: amount });
    }
    if (!isSummary) output[6] = { value: ref, style: 11 };
    rows.push({ cells: output, height: abstractRowHeight(label, 55, 18) });
  }

  const findSummary = (predicate: (label: string) => boolean) => summaryRows.find(entry => predicate(entry.label));
  const formulaFor = (
    entry: SummaryEntry | undefined,
    expression: () => string | undefined,
    result?: number,
  ) => {
    if (!entry) return;
    const formula = expression();
    if (!formula) return;
    const amountCell = entry.row.cells[5];
    amountCell.formula = roundedAbstractFormula(formula);
    amountCell.value = Math.round(result ?? abstractFormulaResult(amountCell.value));
  };
  const totalSchedule = findSummary(label => /Total of Schedule & mDSR Items/i.test(label));
  const costIndex = findSummary(label => /Add Cost Index @/i.test(label));
  const scheduleSubtotal = findSummary(label => /Subtotal of DSR and mDSR items enhanced by CI/i.test(label));
  const modifiedCost = findSummary(label => /Modified estimated cost after applying multiplying factor/i.test(label));
  const totalNonSchedule = findSummary(label => /Total of Non-Schedule \(NS\) Items/i.test(label));
  const baseTotal = findSummary(label => /Base Estimate Total/i.test(label));
  const epf = findSummary(label => /Add EPF @/i.test(label));
  const esi = findSummary(label => /Add ESI @/i.test(label));
  const contingency = findSummary(label => /Add Contingency @/i.test(label));
  const customTax = findSummary(label => /^Add (?!Cost Index|EPF|ESI|Contingency)/i.test(label));
  const grandTotal = findSummary(label => /GRAND TOTAL/i.test(label));
  const say = findSummary(label => label.trim().toUpperCase() === "SAY:");
  const numericRate = (entry: SummaryEntry | undefined) => {
    const match = entry?.label.match(/@\s*([\d.]+)\s*%/);
    return match ? Number(match[1]) / 100 : 0;
  };
  const scheduleSections = sectionRows.filter(entry => !/SH\s*:?\s*51\b|NON-SCHEDULED ITEMS|NON-SCHEDULE ITEMS/i.test(entry.label));
  const nonScheduleSections = sectionRows.filter(entry => /SH\s*:?\s*51\b|NON-SCHEDULED ITEMS|NON-SCHEDULE ITEMS/i.test(entry.label));
  const sumFormula = (entries: typeof sectionRows) => entries.length
    ? `SUM(${entries.map(entry => `F${entry.rowNumber}`).join(",")})`
    : undefined;

  formulaFor(totalSchedule, () => sumFormula(scheduleSections), scheduleSections.reduce((sum, entry) => sum + entry.result, 0));
  formulaFor(costIndex, () => totalSchedule ? `F${totalSchedule.rowNumber}*${numericRate(costIndex)}` : undefined);
  formulaFor(scheduleSubtotal, () => totalSchedule && costIndex ? `F${totalSchedule.rowNumber}+F${costIndex.rowNumber}` : undefined);
  const factorMatch = modifiedCost?.label.match(/factor\s*\(([\d.]+)\)/i);
  const modificationFactor = factorMatch ? Number(factorMatch[1]) : Number(projectDetails.gstModificationFactor) || 1;
  formulaFor(modifiedCost, () => scheduleSubtotal ? `F${scheduleSubtotal.rowNumber}*${modificationFactor}` : undefined);
  formulaFor(totalNonSchedule, () => sumFormula(nonScheduleSections), nonScheduleSections.reduce((sum, entry) => sum + entry.result, 0));
  formulaFor(baseTotal, () => modifiedCost && totalNonSchedule ? `F${modifiedCost.rowNumber}+F${totalNonSchedule.rowNumber}` : undefined);
  for (const entry of [
    { summary: epf, rate: numericRate(epf) },
    { summary: esi, rate: numericRate(esi) },
    { summary: contingency, rate: numericRate(contingency) },
    { summary: customTax, rate: numericRate(customTax) },
  ]) {
    formulaFor(entry.summary, () => baseTotal ? `F${baseTotal.rowNumber}*${entry.rate}` : undefined);
  }
  if (grandTotal && baseTotal) {
    formulaFor(grandTotal, () => `SUM(F${baseTotal.rowNumber}:F${grandTotal.rowNumber - 1})`);
  }
  if (say && grandTotal) {
    formulaFor(
      say,
      () => `ROUND(F${grandTotal.rowNumber},-2)`,
      Math.round(abstractFormulaResult(grandTotal.row.cells[5].value) / 100) * 100,
    );
  }

  const lastTableRow = say?.rowNumber || rows.length;
  const signatoryCells = (values: Array<[number, string, number]>) => {
    const cells = abstractRow();
    values.forEach(([column, value, style]) => {
      cells[column] = { value, style };
    });
    return cells;
  };
  rows.push({ cells: abstractRow(), height: 18, borderless: true });
  rows.push({ cells: abstractRow(), height: 18, borderless: true });
  rows.push({ cells: abstractRow(), height: 18, borderless: true });
  rows.push({ cells: signatoryCells([[1, String(projectDetails.leftAETitle || "Assistant Engineer,"), 12], [5, String(projectDetails.rightAETitle || "Assistant Engineer,"), 13]]), height: 18, borderless: true });
  rows.push({ cells: signatoryCells([[1, String(projectDetails.leftAEOffice || "CPWD, Kolhapur."), 12], [5, String(projectDetails.rightAEOffice || "GCD, CPWD, Goa."), 13]]), height: 18, borderless: true });
  for (let index = 0; index < 3; index++) rows.push({ cells: abstractRow(), height: 18, borderless: true });
  const executiveTitleRow = rows.length + 1;
  rows.push({ cells: signatoryCells([[0, "Executive Engineer & Senior Manager (C)-I,", 14]]), height: 18, borderless: true });
  merges.push(`<mergeCell ref="A${executiveTitleRow}:G${executiveTitleRow}"/>`);
  const executiveOfficeRow = rows.length + 1;
  rows.push({ cells: signatoryCells([[0, "GCD, CPWD, Goa.", 14]]), height: 18, borderless: true });
  merges.push(`<mergeCell ref="A${executiveOfficeRow}:G${executiveOfficeRow}"/>`);

  const widths = [8, 48, 7.5, 9, 9, 12.5, 10];
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const cellFormats = [
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
  ];
  const baseAmountStyle = cellFormats.length;
  cellFormats.push(`<xf numFmtId="165" fontId="2" fillId="0" borderId="2" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`);
  const grandTotalAmountStyle = cellFormats.length;
  cellFormats.push(`<xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`);
  const sayAmountStyle = cellFormats.length;
  cellFormats.push(`<xf numFmtId="165" fontId="4" fillId="0" borderId="2" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf>`);
  const baseReferenceStyle = cellFormats.length;
  cellFormats.push(`<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`);
  const rowXml = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.cells.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowNumber}`;
      let style = !row.borderless && rowNumber >= 8 && rowNumber <= lastTableRow && cell.style === 0 ? 6 : cell.style;
      if (rowNumber === baseTotal?.rowNumber && columnIndex === 5) style = baseAmountStyle;
      if (rowNumber === grandTotal?.rowNumber && columnIndex === 5) style = grandTotalAmountStyle;
      if (rowNumber === say?.rowNumber && columnIndex === 5) style = sayAmountStyle;
      if (rowNumber === baseTotal?.rowNumber && columnIndex === 6) style = baseReferenceStyle;
      if (cell.value === "") return `<c r="${reference}" s="${style}"/>`;
      if (cell.formula) return `<c r="${reference}" s="${style}"><f>${xml(cell.formula)}</f><v>${abstractFormulaResult(cell.value)}</v></c>`;
      if (typeof cell.value === "number") return `<c r="${reference}" s="${style}"><v>${cell.value}</v></c>`;
      return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}"${row.height ? ` ht="${row.height}" customHeight="1"` : ""}>${cells}</row>`;
  }).join("");
  const borders = `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border><border><left style="medium"/><right style="medium"/><top style="medium"/><bottom style="medium"/><diagonal/></border></borders>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="##,##,##0"/></numFmts><fonts count="5"><font><sz val="10"/><name val="Book Antiqua"/></font><font><b/><sz val="14"/><name val="Book Antiqua"/></font><font><b/><sz val="10"/><name val="Book Antiqua"/></font><font><sz val="10"/><name val="Book Antiqua"/></font><font><b/><sz val="14"/><name val="Book Antiqua"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>${borders}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${cellFormats.length}">${cellFormats.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const mergeXml = `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>`;
  const safeEstimateId = String(estimateId || "N/A").replace(/&/g, "&&");
  const footer = xml(`&LGeneral Abstract&R${safeEstimateId}`);
  const lastRow = rows.length;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="0"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100" view="pageBreakPreview"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rowXml}</sheetData>${mergeXml}<pageMargins left="0.75" right="0.75" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" scale="85"/><headerFooter differentOddEven="1"><oddFooter>${footer}</oddFooter><evenFooter>${footer}</evenFooter></headerFooter></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="General Abstract" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'General Abstract'!$A$1:$G$${lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'General Abstract'!$8:$8</definedName></definedNames></workbook>`;
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: worksheet },
  ];
  const url = URL.createObjectURL(createStoredZip(files));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileBaseName.replace(/[^\w-]+/g, "_")}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type RateAnalysisExportOptions = {
  calculationMethod?: string;
  customCharges?: Array<{ name?: string; rate?: number | string }>;
  excludeAMarkedItems?: boolean;
};

type ExportMarkRows = Map<string, number[]>;

function exportMarkExpression(markRows: ExportMarkRows, mark: string, beforeRow: number) {
  const refs = (markRows.get(mark.toUpperCase()) || []).filter(row => row < beforeRow);
  if (!refs.length) return undefined;
  return refs.length === 1 ? `F${refs[0]}` : `SUM(${refs.map(row => `F${row}`).join(",")})`;
}

function exportAlgebraExpression(description: string, marks: ExportMarkRows, rowNumber: number, base?: string) {
  const expression = description.split("=").pop()?.trim().toUpperCase() || "";
  let match = /^([A-Z])\s*\/\s*(\d+(?:\.\d+)?)$/.exec(expression);
  if (match) {
    const ref = exportMarkExpression(marks, match[1], rowNumber);
    if (ref) return `(${ref}/${match[2]})`;
  }
  match = /^([A-Z])\s*[X*]\s*(0\.\d+|1\.\d+|\d+(?:\.\d+)?)$/.exec(expression);
  if (match) {
    const ref = exportMarkExpression(marks, match[1], rowNumber);
    if (ref) return `(${ref}*${match[2]})`;
  }
  match = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+OF\s+([A-Z])$/.exec(expression);
  if (match && Number(match[2]) !== 0) {
    const ref = exportMarkExpression(marks, match[3], rowNumber);
    if (ref) return `((${ref}*${match[1]})/${match[2]})`;
  }
  const terms = [...expression.matchAll(/([+-]?)\s*(\d+(?:\.\d+)?)\s*(?:%|PER\s*CENT)\s*(?:OF|ON)\s+["']?([A-Z])\b/gi)]
    .flatMap(term => {
      const ref = exportMarkExpression(marks, term[3], rowNumber);
      return ref ? [`${term[1] === "-" ? "-" : "+"}(${ref}*${Number(term[2]) / 100})`] : [];
    });
  if (terms.length) return `(${terms.join("")})`;
  if (/\bEXTRA\b/i.test(description)) {
    const percent = description.match(/@\s*(\d+(?:\.\d+)?)\s*%/i);
    if (percent && base) return `(${base}*${Number(percent[1]) / 100})`;
  }
  return undefined;
}

/** Adds live formulas to the financial rows in the rendered Rate Analysis tables. */
function applyRateAnalysisFormulaRows(
  rows: Array<{ cells: Array<{ text: string; formula?: string; result?: number }>; rowNumber: number }>,
  options: RateAnalysisExportOptions = {},
) {
  const numeric = (value: string) => {
    const parsed = Number(String(value || "").replace(/[₹,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const totalRowsByMark = new Map<string, number>();
  const markRows: ExportMarkRows = new Map();
  let componentStartRow: number | undefined;
  let latestTotalRow: number | undefined;
  let latestDerivedRow: number | undefined;
  let costOfOneRow: number | undefined;
  let customChargeIndex = 0;
  let amountColumn = 5;
  const sumRange = (start: number, end: number) => start <= end ? `SUM(F${start}:F${end})` : "0";

  for (const entry of rows) {
    const cells = entry.cells;
    if (cells.some(cell => /^amount\s*\(₹\)$/i.test(cell.text.trim()))) {
      const headerIndex = rows.indexOf(entry);
      const amountHeader = cells.findIndex(cell => /^amount\s*\(₹\)$/i.test(cell.text.trim()));
      if (amountHeader >= 0) amountColumn = amountHeader;
      const next = rows[headerIndex + 1];
      if (next) componentStartRow = next.rowNumber;
      totalRowsByMark.clear();
      markRows.clear();
      latestTotalRow = undefined;
      latestDerivedRow = undefined;
      costOfOneRow = undefined;
      customChargeIndex = 0;
      continue;
    }
    if (componentStartRow === undefined || cells.length <= amountColumn) continue;
    const description = String(cells[1]?.text || "").trim();
    const upper = description.toUpperCase();
    const amountCell = cells[amountColumn];
    const result = numeric(amountCell.text);
    const mark = String(cells[6]?.text || "").trim().toUpperCase();
    const totalMatch = description.match(/^TOTAL\s*["'“”]?([WXYZ])["'“”]?\s*$/i);
    const isTotalRow = Boolean(totalMatch) || /^TOTAL\b/i.test(description);
    if (isTotalRow) {
      const previousTotal = latestTotalRow;
      amountCell.formula = previousTotal
        ? `ROUND(F${previousTotal}+${sumRange(previousTotal + 1, entry.rowNumber - 1)},2)`
        : `ROUND(${sumRange(componentStartRow, entry.rowNumber - 1)},2)`;
      amountCell.result = result;
      const totalMark = totalMatch?.[1]?.toUpperCase() || (/^[WXYZ]$/.test(mark) ? mark : "");
      const resolvedMark = totalMark || (/^[A-Z]$/.test(mark) ? mark : "");
      if (resolvedMark) {
        totalRowsByMark.set(resolvedMark, entry.rowNumber);
        markRows.set(resolvedMark, [entry.rowNumber]);
      }
      latestTotalRow = entry.rowNumber;
      latestDerivedRow = undefined;
      continue;
    }

    if (/^(?:ADD|LESS|DEDUCT)\b/i.test(description)) {
      // Accept both legacy DAR labels (on "W-A") and the NSR modal's
      // standardized labels (on (W - A)).
      const refMatch = description.match(/\b(?:on|of)\s*["'“‘(]*([A-Z])(?:\s*-\s*A)?["'”’)]*/i);
      const refMark = refMatch?.[1]?.toUpperCase();
      const customMode = options.calculationMethod === "Custom charges";
      const refRow = !customMode && refMark ? totalRowsByMark.get(refMark) : latestTotalRow;
      let baseExpression: string | undefined;
      if (refMark && !customMode) baseExpression = exportMarkExpression(markRows, refMark, entry.rowNumber) || (refRow ? `F${refRow}` : undefined);
      else if (refRow) baseExpression = `F${refRow}${refRow + 1 <= entry.rowNumber - 1 ? `+${sumRange(refRow + 1, entry.rowNumber - 1)}` : ""}`;
      if (!baseExpression && latestTotalRow) baseExpression = `F${latestTotalRow}${latestTotalRow + 1 <= entry.rowNumber - 1 ? `+${sumRange(latestTotalRow + 1, entry.rowNumber - 1)}` : ""}`;
      if (baseExpression && componentStartRow !== undefined && (/\b[WXYZ]\s*-\s*A\b/i.test(description) || (customMode && options.excludeAMarkedItems))) {
        const end = entry.rowNumber - 1;
        const start = componentStartRow;
        baseExpression = `MAX(0,${baseExpression}-SUMIF(G${start}:G${end},"A",F${start}:F${end}))`;
      }
      const multiplier = description.match(/multiplying\s+factor\s+([\d.]+)/i);
      const percent = description.match(/([\d.]+)\s*%/);
      const customRate = customMode ? Number(options.customCharges?.[customChargeIndex]?.rate) : NaN;
      const factor = Number.isFinite(customRate)
        ? customRate / 100
        : multiplier ? Number(multiplier[1]) : percent ? Number(percent[1]) / 100 : NaN;
      if (baseExpression && Number.isFinite(factor)) {
        const sign = /^(?:LESS|DEDUCT)\b/i.test(description) ? "-" : "";
        amountCell.formula = `ROUND(${sign}(${baseExpression})*${factor},2)`;
        amountCell.result = result;
      }
      if (/^[A-Z]$/.test(mark)) markRows.set(mark, [...(markRows.get(mark) || []), entry.rowNumber]);
      if (customMode) customChargeIndex++;
      continue;
    }

    const costMatch = description.match(/^COST\s+(?:OF|FOR)\s+([\d.]+)/i);
    if (costMatch && latestTotalRow) {
      const quantity = Number(costMatch[1]);
      const detailStartRow = componentStartRow ?? rows[0]?.rowNumber ?? entry.rowNumber;
      const detailHeader = rows.find(row => row.rowNumber >= detailStartRow && /DETAILS\s+OF\s+COST\s+(?:FOR|OF)\s+[\d.]+/i.test(String(row.cells[1]?.text || "")));
      const baseQuantity = Number(String(detailHeader?.cells[1]?.text || "").match(/DETAILS\s+OF\s+COST\s+(?:FOR|OF)\s+([\d.]+)/i)?.[1] || 1) || 1;
      const costSourceRow = latestDerivedRow ?? latestTotalRow;
      const costBase = latestDerivedRow
        ? `F${costSourceRow}`
        : `F${costSourceRow}${costSourceRow + 1 <= entry.rowNumber - 1 ? `+${sumRange(costSourceRow + 1, entry.rowNumber - 1)}` : ""}`;
      amountCell.formula = `ROUND((${costBase})*${quantity / baseQuantity},2)`;
      amountCell.result = result;
      if (Math.abs(quantity - 1) < 1e-9) costOfOneRow = entry.rowNumber;
      continue;
    }

    if (/^SAY\b/i.test(description)) {
      const finalBase = costOfOneRow ? `F${costOfOneRow}` : latestDerivedRow ? `F${latestDerivedRow}` : latestTotalRow ? `ROUND(F${latestTotalRow},2)` : undefined;
      if (finalBase) {
        amountCell.formula = `MROUND(${finalBase},0.05)`;
        amountCell.result = result;
      }
      continue;
    }

    const runningBase = latestTotalRow
      ? `F${latestTotalRow}${latestTotalRow + 1 <= entry.rowNumber - 1 ? `+${sumRange(latestTotalRow + 1, entry.rowNumber - 1)}` : ""}`
      : componentStartRow !== undefined ? sumRange(componentStartRow, entry.rowNumber - 1) : undefined;
    const algebra = exportAlgebraExpression(description, markRows, entry.rowNumber, runningBase);
    if (algebra) {
      amountCell.formula = `ROUND(${algebra},2)`;
      amountCell.result = result;
      latestDerivedRow = entry.rowNumber;
    }
    if (/^[A-Z]$/.test(mark)) markRows.set(mark, [...(markRows.get(mark) || []), entry.rowNumber]);
  }
}

/** Exports the rendered table(s) in a component to a formatted .xlsx workbook. */
export function exportTableToExcel(root: HTMLElement | null, title: string, fileBaseName: string, rateAnalysisOptions: RateAnalysisExportOptions = {}) {
  if (!root) {
    window.alert("The table is not ready to export yet.");
    return;
  }
  const tables = Array.from(root.querySelectorAll("table"));
  if (!tables.length) {
    window.alert("There are no tables on this page to export.");
    return;
  }

  type SheetCell = { text: string; style: number; span?: number; formula?: string; result?: number };
  const sheetRows: SheetCell[][] = [[{ text: title, style: 1 }]];
  const sheetMerges: string[] = [];
  let headerLabels: string[] = [];
  const marketSayRows = new Map<string, number>();
  const pendingMarketSubAnalysisLinks: Array<{ cells: SheetCell[]; rowNumber: number; contextKey: string }> = [];
  for (const [tableIndex, table] of tables.entries()) {
    if (tableIndex > 0) sheetRows.push([]);
    const exportCard = table.closest<HTMLElement>("[data-export-title]");
    if (exportCard) {
      const contextRows = [
        exportCard.getAttribute("data-export-title")?.trim(),
        exportCard.getAttribute("data-export-description")?.trim(),
      ].filter((value): value is string => Boolean(value));
      for (const value of contextRows) {
        sheetRows.push([{ text: value, style: 3 }, ...Array.from({ length: 6 }, () => ({ text: "", style: 3 }))]);
        const contextRowNumber = sheetRows.length;
        sheetMerges.push(`<mergeCell ref="A${contextRowNumber}:G${contextRowNumber}"/>`);
      }
    }
    const tableOutputRows: Array<{ cells: SheetCell[]; rowNumber: number }> = [];
    const sourceRows = Array.from(table.querySelectorAll("tr"));
    const headerRow = sourceRows.find(row => row.closest("thead")) || sourceRows[0];
    const excluded = new Set<number>();
    if (headerRow) {
      headerLabels = [];
      Array.from(headerRow.cells).forEach((cell, index) => {
        const label = cellText(cell);
        if (/^(action|actions)$/i.test(label)) excluded.add(index);
        else {
          const span = Math.max(1, cell.colSpan || 1);
          for (let i = 0; i < span; i++) headerLabels.push(label);
        }
      });
    }
    for (const row of sourceRows) {
      const sourceCells = Array.from(row.cells);
      const hasHeader = row.closest("thead") !== null;
      const mapped: SheetCell[] = [];
      const pendingMerges: Array<{ start: number; end: number }> = [];
      sourceCells.forEach((cell, index) => {
        if (excluded.has(index)) return;
        const text = cellText(cell);
        const span = Math.max(1, cell.colSpan || 1);
        const start = mapped.length + 1;
        mapped.push({ text, style: hasHeader ? 2 : 3, span });
        for (let i = 1; i < span; i++) mapped.push({ text: "", style: hasHeader ? 2 : 3 });
        if (span > 1 && text) pendingMerges.push({ start, end: start + span - 1 });
      });
      if (mapped.some(cell => cell.text)) {
        sheetRows.push(mapped);
        const sheetRowNumber = sheetRows.length;
        tableOutputRows.push({ cells: mapped, rowNumber: sheetRowNumber });
        pendingMerges.forEach(({ start, end }) => sheetMerges.push(`<mergeCell ref="${columnName(start)}${sheetRowNumber}:${columnName(end)}${sheetRowNumber}"/>`));
      }
    }
    if (/^RATE ANALYSIS/i.test(title)) applyRateAnalysisFormulaRows(tableOutputRows, rateAnalysisOptions);
    if (/^RATE ANALYSIS\s*\(MARKET\)/i.test(title) && exportCard) {
      const context = exportCard.getAttribute("data-export-context") === "ns" ? "ns" : "schedule";
      const itemCode = exportCard.getAttribute("data-export-title")?.match(/\[DSR\s+No\.\s*([^\]]+)\]/i)?.[1]?.trim();
      if (itemCode) {
        const sayRow = tableOutputRows.find(row => /^SAY\b/i.test(String(row.cells[1]?.text || "").trim()));
        if (sayRow) marketSayRows.set(`${context}:${itemCode}`, sayRow.rowNumber);
      }
      for (const row of tableOutputRows) {
        const componentCode = String(row.cells[0]?.text || "").trim();
        const description = String(row.cells[1]?.text || "").trim();
        if (itemCode && /^\d+(?:\.\d+)+$/.test(componentCode) && /^RATE\s+AS\s+PER\s+ITEM\b/i.test(description)) {
          pendingMarketSubAnalysisLinks.push({ cells: row.cells, rowNumber: row.rowNumber, contextKey: `${context}:${componentCode}` });
        }
      }
    }
  }

  for (const link of pendingMarketSubAnalysisLinks) {
    const sayRow = marketSayRows.get(link.contextKey);
    if (!sayRow) continue;
    const rateCell = link.cells[4];
    if (!rateCell) continue;
    const parsedRate = Number(String(link.cells[4]?.text || "0").replace(/[₹,\s]/g, ""));
    const fallback = Number.isFinite(parsedRate) ? parsedRate : 0;
    rateCell.formula = `'${title}'!F${sayRow}`;
    rateCell.result = fallback;
    if (link.cells[5]) {
      link.cells[5].formula = `ROUND(D${link.rowNumber}*E${link.rowNumber},2)`;
      const parsedQuantity = Number(String(link.cells[3]?.text || "0").replace(/[₹,\s]/g, ""));
      link.cells[5].result = (Number.isFinite(parsedQuantity) ? parsedQuantity : 0) * fallback;
    }
  }

  const maxColumns = Math.max(1, ...sheetRows.map(row => row.length));
  if (maxColumns > 1) sheetMerges.push(`<mergeCell ref="A1:${columnName(maxColumns)}1"/>`);
  const rowsXml = sheetRows.map((row, rowIndex) => {
    let column = 1;
    const cells = row.map(cell => {
      const ref = `${columnName(column)}${rowIndex + 1}`;
      column++;
      if (cell.formula) {
        const result = Number.isFinite(cell.result) ? cell.result : 0;
        return `<c r="${ref}" s="${cell.style}"><f>${xml(cell.formula)}</f><v>${result}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr" s="${cell.style}"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="28" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const label = String(headerLabels[index] || "").toLowerCase();
    const width = /description/.test(label) ? 58 : /item code|code/.test(label) ? 18 : /sl\.?\s*no/.test(label) ? 12 : /unit/.test(label) ? 12 : /quantity|qty/.test(label) ? 14 : /amount|rate/.test(label) ? 18 : index === 0 ? 18 : 16;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Book Antiqua"/></font><font><b/><sz val="16"/><name val="Book Antiqua"/><color rgb="FF1D4ED8"/></font><font><b/><sz val="11"/><name val="Book Antiqua"/><color rgb="FFFFFFFF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const mergesXml = sheetMerges.length ? `<mergeCells count="${sheetMerges.length}">${sheetMerges.join("")}</mergeCells>` : "";
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rowsXml}</sheetData>${mergesXml}<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/><printOptions horizontalCentered="1"/></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(title).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: worksheet },
  ];
  const blob = createStoredZip(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileBaseName.replace(/[^\w-]+/g, "_")}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
