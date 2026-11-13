import ExcelJS from "exceljs";

type ExportRow = {
  type?: string;
  row_type?: string;
  code?: string;
  component_code?: string;
  description?: string;
  unit?: string;
  quantity?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  mark?: string;
  isNote?: boolean;
  percentage?: number | null;
  dependentMark?: string;
  isTotal?: boolean;
  isUnitRate?: boolean;
  isSayRow?: boolean;
};

export type SingleRANSItemExportData = {
  itemNo?: string | number;
  code?: string;
  itemCode?: string;
  description?: string;
  itemDescription?: string;
  unit?: string;
  baseQty?: number | string | null;
  analysisRows?: ExportRow[];
  projectDetails?: {
    estimateId?: string;
    leftAETitle?: string;
    leftAEOffice?: string;
    rightAETitle?: string;
    rightAEOffice?: string;
    eeTitle?: string;
    eeOffice?: string;
  };
};

const FONT = { name: "Book Antiqua", size: 10 };
const MIN_TWO_DECIMAL_FORMAT = "0.00##########";
const INDIAN_AMOUNT_FORMAT = "##,##,##,##0.00";

const THIN_SIDES = {
  left: { style: "thin" as const },
  right: { style: "thin" as const },
};
const THIN_ALL = {
  top: { style: "thin" as const },
  bottom: { style: "thin" as const },
  left: { style: "thin" as const },
  right: { style: "thin" as const },
};
const MEDIUM_BOX = {
  top: { style: "medium" as const },
  bottom: { style: "medium" as const },
  left: { style: "medium" as const },
  right: { style: "medium" as const },
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(typeof value === "string" ? value.replace(/[₹,\s]/g, "") : value);
  return Number.isFinite(n) ? n : null;
}

export async function exportSingleRANSItemToExcel(
  itemData: SingleRANSItemExportData,
  sourceItemCode = "",
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const currentItemCode = String(itemData.itemCode ?? itemData.code ?? "").trim();
  const familyLabel = /^(?:50)(?:\.|$)/.test(currentItemCode) ? "mDSR" : "NS";
  // Excel worksheet titles are limited to 31 characters and cannot contain
  // these reserved characters. Item codes are normally short, but keep names safe.
  const worksheetName = `AR _ ${familyLabel} Item ${currentItemCode || "Unknown"}`
    .replace(/[\\/?*:[\]]/g, " ")
    .slice(0, 31);
  
  // 1. Force Page Break Preview explicitly during creation
  const worksheet = workbook.addWorksheet(worksheetName, {
    views: [{ state: 'normal', style: 'pageBreakPreview', zoomScale: 100, zoomScaleNormal: 100, showGridLines: false }]
  });

  worksheet.pageSetup.orientation = "portrait";
  worksheet.pageSetup.paperSize = 9;
  worksheet.pageSetup.scale = 90;
  worksheet.pageSetup.margins = { left: 0.35, right: 0.35, top: 0.5, bottom: 0.75, header: 0.2, footer: 0.25 };
  const estimateId = String(itemData.projectDetails?.estimateId || "Estimate").replace(/&/g, "&&");
  const footer = `&LRate Analysis - ${familyLabel} Items&CPage &P of &N&REST ID: ${estimateId}`;
  worksheet.headerFooter = { oddFooter: footer, evenFooter: footer };
  
  // 2. Column Widths
  worksheet.columns = [
    { key: "code", width: 8.6, style: { font: { ...FONT }, alignment: { horizontal: "center", vertical: "middle" } } },
    { key: "description", width: 46, style: { font: { ...FONT }, alignment: { horizontal: "left", vertical: "middle", wrapText: true } } },
    { key: "unit", width: 7, style: { font: { ...FONT }, alignment: { horizontal: "center", vertical: "middle" } } },
    { key: "quantity", width: 8.5, style: { font: { ...FONT }, alignment: { horizontal: "right", vertical: "middle" }, numFmt: MIN_TWO_DECIMAL_FORMAT } },
    { key: "rate", width: 8.5, style: { font: { ...FONT }, alignment: { horizontal: "right", vertical: "middle" }, numFmt: MIN_TWO_DECIMAL_FORMAT } },
    { key: "amount", width: 11, style: { font: { ...FONT }, alignment: { horizontal: "right", vertical: "middle" }, numFmt: INDIAN_AMOUNT_FORMAT } },
    { key: "mark", width: 6, style: { font: { ...FONT }, alignment: { horizontal: "center", vertical: "middle" } } },
  ];

  // 3. Title Row
  worksheet.mergeCells("A2:G2"); 
  const title = worksheet.getCell("A2");
  title.value = familyLabel === "mDSR" ? "RATE ANALYSIS FOR MODIFIED DSR ITEMS" : "RATE ANALYSIS FOR NON SCHEDULE ITEMS";
  title.font = { name: "Book Antiqua", size: 12, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(2).height = 22;

  // 4. Headers (Rows 4 and 5)
  worksheet.getCell("A4").value = "Item No.";
  worksheet.getCell("A4").font = { ...FONT, bold: true };
  worksheet.getCell("A4").alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getCell("A4").border = { top: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };

  worksheet.getCell("B4").value = itemData.itemNo ?? itemData.itemCode ?? itemData.code ?? "";
  worksheet.getCell("B4").font = { ...FONT, bold: true };
  worksheet.getCell("B4").alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  worksheet.mergeCells("B4:G4");
  for (let c = 2; c <= 7; c++) {
    worksheet.getCell(4, c).border = { top: { style: "thin" }, right: c === 7 ? { style: "thin" } : undefined };
  }

  worksheet.getCell("A5").value = itemData.itemCode ?? itemData.code ?? "";
  worksheet.getCell("A5").alignment = { horizontal: "center", vertical: "top", wrapText: true };
  worksheet.getCell("A5").border = { left: { style: "thin" }, right: { style: "thin" } };

  worksheet.getCell("B5").value = itemData.itemDescription ?? itemData.description ?? "";
  worksheet.getCell("B5").alignment = { horizontal: "justify", vertical: "top", wrapText: true };
  worksheet.mergeCells("B5:G5");
  for (let c = 2; c <= 7; c++) {
    worksheet.getCell(5, c).border = { right: c === 7 ? { style: "thin" } : undefined };
  }
  const itemDescription = String(itemData.itemDescription ?? itemData.description ?? "").trim();
  worksheet.getRow(5).height = Math.max(18, Math.ceil(itemDescription.length / 90) * 15);

  // Column Headers (Row 6)
  const headerRow = worksheet.getRow(6);
  ["Code", "Description", "Unit", "Quantity", "Rate Rs.", "Amount Rs.", "Mark"].forEach((label, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    cell.font = { ...FONT, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = THIN_ALL; 
  });
  headerRow.height = 22;

  let rowNum = 7;
  let referenceAdded = false;
  let hasDrawnTotalWLine = false; // Flag to ensure the horizontal line is drawn only once
  
  const sourceCode = String(sourceItemCode || "").trim();
  const analysisRows = Array.isArray(itemData.analysisRows) ? itemData.analysisRows : [];

  const markRowMap: Record<string, number> = {};
  // Keep explicit amount-cell references for each financial block. Text/NCR
  // rows (for example MATERIAL and LABOUR headings) must not move the start of
  // TOTAL W past earlier cost rows.
  let pendingFinancialAmountRows: number[] = [];

  analysisRows.forEach(row => {
    const rowDescription = String(row.description ?? "");
    const descLower = rowDescription.toLowerCase().trim();
    
    // Prevent duplicate consecutive "Cost of" rows (occurs when baseQty is 1)
    if (rowNum > 7 && descLower.startsWith("cost of")) {
        const prevDesc = String(worksheet.getCell(rowNum - 1, 2).value || "").trim().toLowerCase();
        if (prevDesc === descLower) {
            return; 
        }
    }

    if (!referenceAdded && sourceCode && /details\s+of\s+cost\s+(?:for|of)\s+[\d.]+/i.test(rowDescription)) {
      const referenceRow = worksheet.getRow(rowNum++);
      referenceRow.getCell(2).value = `Reference to item number: ${sourceCode}`;
      referenceRow.getCell(2).font = { ...FONT, italic: true };
      referenceRow.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      // ExcelJS only iterates through instantiated cells here. Explicitly
      // create/style all seven cells so the table's vertical borders continue
      // through this sparse reference row.
      for (let column = 1; column <= 7; column++) {
        referenceRow.getCell(column).border = THIN_SIDES;
        if (column !== 2) referenceRow.getCell(column).font = { ...FONT };
      }
      referenceAdded = true;
    }

    const rowType = String(row.type ?? row.row_type ?? (row.isNote ? "NCR" : "")).trim().toUpperCase();
    const isNote = rowType === "NCR" || rowType === "NOTE";
    const dataRow = worksheet.getRow(rowNum++);
    
    dataRow.getCell(1).value = row.code ?? row.component_code ?? null;
    dataRow.getCell(2).value = rowDescription;
    dataRow.getCell(3).value = row.unit || null;
    dataRow.getCell(4).value = isNote ? null : numberOrNull(row.quantity);
    dataRow.getCell(5).value = isNote ? null : numberOrNull(row.rate);
    dataRow.getCell(6).value = isNote ? null : numberOrNull(row.amount);
    dataRow.getCell(7).value = row.mark || null;

    if (row.mark) markRowMap[row.mark] = dataRow.number;
    
    // Check if this is TOTAL "W" or the first Total row. If so, draw a full horizontal line above it.
    if (!hasDrawnTotalWLine && (row.isTotal || descLower.startsWith("total") || descLower === 'total "w"')) {
        const prevRow = worksheet.getRow(dataRow.number - 1);
        for (let c = 1; c <= 7; c++) {
            // Apply bottom border to the cell directly above to create a solid line
            const currentBorder = prevRow.getCell(c).border || {};
            prevRow.getCell(c).border = { ...currentBorder, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
        }
        hasDrawnTotalWLine = true;
    }

    const rowCode = String(row.code ?? row.component_code ?? "");

    // INJECT DATA-DRIVEN FORMULAS
    
    if (!isNote && rowType === "CR" && numberOrNull(row.quantity) !== null && numberOrNull(row.rate) !== null) {
      let divisor = 1;
      const unitMatch = String(row.unit || "").trim().match(/^(\d+)/);
      if (unitMatch) divisor = parseInt(unitMatch[1], 10);

      dataRow.getCell(6).value = {
        formula: divisor === 1 ? `ROUND(D${dataRow.number}*E${dataRow.number}, 2)` : `ROUND((D${dataRow.number}*E${dataRow.number})/${divisor}, 2)`,
        result: numberOrNull(row.amount) ?? 0,
      };
      // TOTAL W (and subsequent block totals) uses the actual CR rows rather
      // than a range whose start can be shifted by intervening headings.
      pendingFinancialAmountRows.push(dataRow.number);
    }
    else if (row.percentage != null && row.dependentMark && markRowMap[row.dependentMark]) {
      const targetRow = markRowMap[row.dependentMark];
      dataRow.getCell(6).value = {
        formula: `ROUND(F${targetRow}*(${row.percentage}/100), 2)`,
        result: numberOrNull(row.amount) ?? 0,
      };
      pendingFinancialAmountRows.push(dataRow.number);
    }
    else if (row.isTotal === true) {
      // Sum only rows already classified as cost components or calculated
      // financial additions. This excludes text notes and physical subtotals.
      const amountReferences = pendingFinancialAmountRows.map(rowNumber => `F${rowNumber}`);
      dataRow.getCell(6).value = {
        formula: amountReferences.length ? `ROUND(SUM(${amountReferences.join(",")}), 2)` : "0",
        result: numberOrNull(row.amount) ?? 0,
      };
      dataRow.font = { ...FONT, bold: true };
      pendingFinancialAmountRows = [dataRow.number];
    }
    else if (row.isUnitRate || descLower.startsWith("cost of 1") || descLower.startsWith("cost of one")) {
      const baseQty = numberOrNull(itemData.baseQty) || 1;
      dataRow.getCell(6).value = {
        formula: `ROUND(F${dataRow.number - 1}/${baseQty}, 2)`,
        result: numberOrNull(row.amount) ?? 0,
      };
      dataRow.font = { ...FONT, bold: true };
    }
    else if (row.isSayRow || descLower === "say") {
      dataRow.getCell(6).value = {
        formula: `MROUND(F${dataRow.number - 1}, 0.05)`,
        result: numberOrNull(row.amount) ?? 0,
      };
      dataRow.font = { ...FONT, bold: true };
      dataRow.getCell(6).border = MEDIUM_BOX;
      
      // Seal the bottom of the table for the remaining cells
      for (let c = 1; c <= 7; c++) {
          if (c !== 6) dataRow.getCell(c).border = { ...THIN_SIDES, bottom: { style: "thin" } };
      }
    }

    // Apply strict outline styling
    if (!row.isSayRow && descLower !== "say") {
      dataRow.eachCell({ includeEmpty: true }, (cell, column) => {
        if (column <= 7) cell.border = THIN_SIDES;
      });
    }

    dataRow.eachCell({ includeEmpty: true }, (cell, column) => {
      if (!cell.font) cell.font = { ...FONT };
      cell.alignment = {
        horizontal: column === 2 ? "left" : [4, 5, 6].includes(column) ? "right" : "center",
        vertical: "middle",
        ...(column === 2 ? { wrapText: true } : {}),
      };
    });

    dataRow.getCell(4).numFmt = MIN_TWO_DECIMAL_FORMAT;
    dataRow.getCell(5).numFmt = MIN_TWO_DECIMAL_FORMAT;
    dataRow.getCell(6).numFmt = INDIAN_AMOUNT_FORMAT;
    dataRow.height = rowDescription ? Math.max(18, Math.ceil(rowDescription.length / 46) * 15) : 18;
    if (rowType === "CR" && rowCode) dataRow.getCell(1).value = rowCode;
  });

  // Signatories use the project document settings configured on the Home page.
  const signatories = itemData.projectDetails || {};
  rowNum += 3;
  const signatureRow = worksheet.getRow(rowNum++);
  worksheet.mergeCells(`A${signatureRow.number}:B${signatureRow.number}`);
  worksheet.mergeCells(`F${signatureRow.number}:G${signatureRow.number}`);
  signatureRow.getCell(1).value = signatories.leftAETitle || "Assistant Engineer,";
  signatureRow.getCell(6).value = signatories.rightAETitle || "Assistant Engineer,";
  signatureRow.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  signatureRow.getCell(6).alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  const signatoryOfficeRow = worksheet.getRow(rowNum++);
  worksheet.mergeCells(`A${signatoryOfficeRow.number}:B${signatoryOfficeRow.number}`);
  worksheet.mergeCells(`F${signatoryOfficeRow.number}:G${signatoryOfficeRow.number}`);
  signatoryOfficeRow.getCell(1).value = signatories.leftAEOffice || "";
  signatoryOfficeRow.getCell(6).value = signatories.rightAEOffice || "";
  signatoryOfficeRow.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  signatoryOfficeRow.getCell(6).alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  const eeTitleRow = worksheet.getRow(rowNum++);
  worksheet.mergeCells(`B${eeTitleRow.number}:F${eeTitleRow.number}`);
  eeTitleRow.getCell(2).value = signatories.eeTitle || "Executive Engineer & Senior Manager (C)-I,";
  eeTitleRow.getCell(2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  const eeOfficeRow = worksheet.getRow(rowNum++);
  worksheet.mergeCells(`B${eeOfficeRow.number}:F${eeOfficeRow.number}`);
  eeOfficeRow.getCell(2).value = signatories.eeOffice || "";
  eeOfficeRow.getCell(2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  for (const row of [signatureRow, signatoryOfficeRow, eeTitleRow, eeOfficeRow]) {
    row.height = 18;
    row.eachCell({ includeEmpty: true }, cell => { cell.font = { ...FONT }; });
  }

  // Force Print Area for Page Break Preview perfection
  worksheet.pageSetup.printArea = `A1:G${eeOfficeRow.number}`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${String(itemData.itemCode ?? itemData.code ?? "NSR_Item").replace(/[^\w.-]+/g, "_")}_Rate_Analysis.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
