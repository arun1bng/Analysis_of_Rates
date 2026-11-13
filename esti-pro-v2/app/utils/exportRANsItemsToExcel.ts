import ExcelJS from "exceljs";

const FONT_NAME = "Book Antiqua";
const THIN_BORDER: ExcelJS.Borders = {
  top: { style: "thin" },
  bottom: { style: "thin" },
  left: { style: "thin" },
  right: { style: "thin" },
  diagonal: {},
};

export type RANsAnalysisRow = {
  row_type?: string;
  type?: string;
  code?: string;
  component_code?: string;
  sub_analysis_code?: string;
  isSubItem?: boolean | number | string;
  is_sub_item?: boolean | number | string;
  isSubAR?: boolean | number | string;
  is_sub_ar?: boolean | number | string;
  targetItemCode?: string;
  parentItemCode?: string;
  parent_item_code?: string;
  dependentMark?: string;
  dependent_mark?: string;
  percentage?: number | string;
  isTotal?: boolean;
  isUnitRate?: boolean;
  isSayRow?: boolean;
  baseQty?: number | string | null;
  excludeAMarkedItems?: boolean;
  description?: string;
  unit?: string;
  quantity?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  mark?: string;
  calc_mark?: string;
  reference_mark?: string;
  ref?: string;
};

export type RANsExportItem = {
  itemNo?: string | number;
  baseQty?: number | string | null;
  slNo?: string | number;
  code?: string;
  itemCode?: string;
  ItemCode?: string;
  description?: string;
  itemDescription?: string;
  ItemDescription?: string;
  analysisRows?: RANsAnalysisRow[];
  rows?: RANsAnalysisRow[];
};

const text = (value: unknown) => String(value ?? "").trim();

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(typeof value === "string" ? value.replace(/[₹,\s]/g, "") : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function itemCode(item: RANsExportItem) {
  return text(item.itemCode ?? item.ItemCode ?? item.code);
}

/** Build the CPWD-style per-item rate analysis blocks in a worksheet. */
export function buildRANsItemsSheetLayout(
  worksheet: ExcelJS.Worksheet,
  estimateItems: RANsExportItem[],
) {
  const items = Array.isArray(estimateItems) ? estimateItems : [];
  worksheet.name = "RA NS Items";
  worksheet.pageSetup.orientation = "portrait";
  worksheet.pageSetup.scale = 90;
  worksheet.pageSetup.paperSize = 9;
  worksheet.views = [{ zoomScale: 90 }];

  worksheet.columns = [
    { key: "code", width: 10, style: { alignment: { horizontal: "center", vertical: "middle" } } },
    { key: "description", width: 70, style: { alignment: { horizontal: "left", vertical: "middle", wrapText: true } } },
    { key: "unit", width: 10, style: { alignment: { horizontal: "center", vertical: "middle" } } },
    { key: "qty", width: 12, style: { alignment: { horizontal: "right", vertical: "middle" }, numFmt: "0.000" } },
    { key: "rate", width: 12, style: { alignment: { horizontal: "right", vertical: "middle" }, numFmt: "0.00" } },
    { key: "amount", width: 15, style: { alignment: { horizontal: "right", vertical: "middle" }, numFmt: "0.00" } },
    { key: "mark", width: 8, style: { alignment: { horizontal: "center", vertical: "middle" } } },
  ];

  const tableHeaders = ["Code", "Description", "Unit", "Quantity", "Rate Rs.", "Amount Rs.", "Mark"];
  const itemCodeToRowMap: Record<string, number> = {};
  const containingItemRowMap: Record<string, number> = {};
  const cellsNeedingHyperlinks: Array<{ cell: ExcelJS.Cell; targetItemCode: string }> = [];
  let currentRow = 1;

  for (const item of items) {
    const code = itemCode(item);
    const itemNumber = text(item.itemNo ?? item.slNo);
    const description = text(item.ItemDescription ?? item.itemDescription ?? item.description);
    const analysisRows = Array.isArray(item.analysisRows)
      ? item.analysisRows
      : Array.isArray(item.rows)
        ? item.rows
        : [];

    const itemNoRow = worksheet.getRow(currentRow++);
    itemNoRow.getCell(1).value = "Item No.";
    itemNoRow.getCell(2).value = itemNumber;
    worksheet.mergeCells(itemNoRow.number, 2, itemNoRow.number, 7);
    itemNoRow.height = 20;
    itemNoRow.getCell(1).font = { name: FONT_NAME, size: 10, bold: true };
    itemNoRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    itemNoRow.getCell(1).border = THIN_BORDER;
    itemNoRow.getCell(2).font = { name: FONT_NAME, size: 10, bold: true };
    itemNoRow.getCell(2).alignment = { horizontal: "left", vertical: "middle" };
    itemNoRow.getCell(2).border = THIN_BORDER;

    const descriptionRow = worksheet.getRow(currentRow++);
    descriptionRow.getCell(1).value = code;
    descriptionRow.getCell(1).font = { name: FONT_NAME, size: 10 };
    descriptionRow.getCell(1).alignment = { horizontal: "center", vertical: "top" };
    descriptionRow.getCell(1).border = THIN_BORDER;
    descriptionRow.getCell(2).value = description;
    worksheet.mergeCells(descriptionRow.number, 2, descriptionRow.number, 7);
    descriptionRow.getCell(2).font = { name: FONT_NAME, size: 10 };
    descriptionRow.getCell(2).alignment = { horizontal: "left", vertical: "top", wrapText: true };
    descriptionRow.getCell(2).border = THIN_BORDER;
    descriptionRow.height = description ? Math.max(18, Math.ceil(description.length / 95) * 15) : 18;
    if (code && itemCodeToRowMap[code] === undefined) itemCodeToRowMap[code] = itemNoRow.number;

    const headerRow = worksheet.getRow(currentRow++);
    tableHeaders.forEach((label, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = label;
      cell.font = { name: FONT_NAME, size: 10, bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      cell.border = THIN_BORDER;
    });
    headerRow.height = 24;

    const markRowMap: Record<string, number> = {};
    const markedARows: number[] = [];
    let formulaRowsSinceTotal: number[] = [];

    if (Array.isArray(analysisRows)) {
      analysisRows.forEach((row) => {
        const rowType = text(row.type ?? row.row_type).toUpperCase();
        const isNCR = rowType === "NCR" || rowType === "NOTE";
        const rowCode = row.code || row.component_code || row.sub_analysis_code;
        const mark = text(row.mark ?? row.calc_mark ?? row.reference_mark ?? row.ref);
        const dependentMark = text(row.dependentMark ?? row.dependent_mark);
        const dataRow = worksheet.addRow([
          rowCode || null,
          row.description || "",
          row.unit || null,
          isNCR ? null : row.quantity,
          isNCR ? null : row.rate,
          isNCR ? null : row.amount,
          mark || null,
        ]);

        const rowNum = dataRow.number;
        currentRow = rowNum + 1;

        dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (colNumber <= 7) {
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" },
            };
          }
          cell.font = { name: FONT_NAME, size: 10 };
          cell.alignment = {
            horizontal: colNumber === 2 ? "left" : [4, 5, 6].includes(colNumber) ? "right" : "center",
            vertical: "middle",
            ...(colNumber === 2 ? { wrapText: true } : {}),
          };
        });
        dataRow.getCell(4).numFmt = "0.000";
        dataRow.getCell(5).numFmt = "0.00";
        dataRow.getCell(6).numFmt = "0.00";
        dataRow.height = row.description ? Math.max(18, Math.ceil(row.description.length / 95) * 15) : 18;

        if (mark) markRowMap[mark] = rowNum;
        if (mark.toUpperCase() === "A" && !isNCR) markedARows.push(rowNum);

        // Formulas are driven only by the stored row type and explicit calculation flags.
        // A. Cost Rows (with a bulk-unit divisor such as "10 Nos")
        if (rowType === "CR" && row.quantity != null && row.rate != null) {
          let divisor = 1;
          if (row.unit && /^\d+/.test(row.unit.toString().trim())) {
            const match = row.unit.toString().trim().match(/^(\d+)/);
            if (match) divisor = parseInt(match[1], 10);
          }
          dataRow.getCell(6).value = {
            formula: divisor === 1
              ? `ROUND(D${rowNum}*E${rowNum}, 2)`
              : `ROUND((D${rowNum}*E${rowNum})/${divisor}, 2)`,
            result: numberOrNull(row.amount) ?? 0,
          };
          formulaRowsSinceTotal.push(rowNum);
        }

        // B. Percentage additions explicitly link to their dependent mark.
        else if (row.percentage != null && dependentMark) {
          const targetRow = markRowMap[dependentMark];
          if (targetRow) {
            const percentage = Number(row.percentage);
            const baseFormula = row.excludeAMarkedItems && markedARows.length
              ? `MAX(0,(F${targetRow}-SUM(${markedARows.map(markedRow => `F${markedRow}`).join(",")})))`
              : `F${targetRow}`;
            dataRow.getCell(6).value = {
              formula: `ROUND(${baseFormula}*(${percentage}/100), 2)`,
              result: numberOrNull(row.amount) ?? 0,
            };
            formulaRowsSinceTotal.push(rowNum);
          }
        }

        // C. Totals are identified by `isTotal`; only previously calculated cost/addition
        // rows are included, so NCR text can never enter a numeric sum.
        else if (row.isTotal === true) {
          const sumFormula = formulaRowsSinceTotal.length
            ? `ROUND(SUM(${formulaRowsSinceTotal.map(sumRow => `F${sumRow}`).join(",")}), 2)`
            : "0";
          dataRow.getCell(6).value = {
            formula: sumFormula,
            result: numberOrNull(row.amount) ?? 0,
          };
          dataRow.eachCell({ includeEmpty: true }, cell => {
            cell.font = { name: FONT_NAME, size: 10, bold: true };
          });
          formulaRowsSinceTotal = [rowNum];
        }

        // D. Unit rate rows are explicitly flagged and divide by the saved base quantity.
        else if (row.isUnitRate === true) {
          const baseQty = numberOrNull(row.baseQty ?? item.baseQty) || 1;
          dataRow.getCell(6).value = {
            formula: `ROUND(F${rowNum - 1}/${baseQty}, 2)`,
            result: numberOrNull(row.amount) ?? 0,
          };
          dataRow.font = { name: FONT_NAME, size: 10, bold: true };
        }

        // E. The final Say row uses the same 5-paise rounding as the NSR UI.
        else if (row.isSayRow === true) {
          dataRow.getCell(6).value = {
            formula: `MROUND(F${rowNum - 1}, 0.05)`,
            result: numberOrNull(row.amount) ?? 0,
          };
          dataRow.font = { name: FONT_NAME, size: 10, bold: true };
        }

        // Decimal component codes represent Sub-AR items and should link to their item block.
        if (rowCode && rowCode.toString().includes(".")) {
          cellsNeedingHyperlinks.push({ cell: dataRow.getCell(1), targetItemCode: rowCode });
          // If the referenced Sub-AR has no standalone block in this export, link back to
          // the NS calculation block containing it. A later standalone block takes priority.
          if (containingItemRowMap[rowCode] === undefined) {
            containingItemRowMap[rowCode] = itemNoRow.number;
          }
        }
      });
    }

    // Two fully empty rows between item blocks.
    worksheet.addRow([]);
    worksheet.addRow([]);
    currentRow = worksheet.rowCount + 1;
  }

  // Pass 2 resolves internal links, including links to items printed later in the sheet.
  cellsNeedingHyperlinks.forEach(({ cell, targetItemCode }) => {
    const targetRowNumber = itemCodeToRowMap[targetItemCode] ?? containingItemRowMap[targetItemCode];
    if (!targetRowNumber) return;
    const displayCode = text(cell.value);
    cell.value = {
      formula: `HYPERLINK("#'RA NS Items'!A${targetRowNumber}","${displayCode.replace(/"/g, '""')}")`,
      result: displayCode,
    };
    cell.font = { name: FONT_NAME, size: 10, color: { argb: "FF0000FF" }, underline: true };
  });

  // No printTitlesRow: each item block contains its own physical table header.
  return worksheet;
}

/** Download a workbook containing only the RA NS Items sheet. */
export async function exportRateAnalysisToExcel(
  estimateItems: RANsExportItem[],
  fileName = "RA_NS_Items.xlsx",
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;
  const worksheet = workbook.addWorksheet("RA NS Items");
  worksheet.pageSetup.orientation = "portrait";
  worksheet.pageSetup.scale = 90;
  worksheet.pageSetup.paperSize = 9;
  worksheet.views = [{ zoomScale: 90 }];
  buildRANsItemsSheetLayout(worksheet, estimateItems);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

// Keep the earlier utility name as an alias for callers already using it.
export const exportRANsItemsToExcel = exportRateAnalysisToExcel;
