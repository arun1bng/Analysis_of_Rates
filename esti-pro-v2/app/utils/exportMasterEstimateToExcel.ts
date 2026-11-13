import ExcelJS from "exceljs";
import {
  buildAbstractSheetLayout,
  buildGenAbstSheetLayout,
  buildMeasurementSheetLayout,
  type SharedEstimateData,
  type SharedWorkbookRowRefs,
} from "./exportTableToExcel";
import {
  appendMultiRANSItemsWorksheets,
  type MultiRANSItemExportData,
  type MultiRANSItemSheetReference,
} from "./exportMultiRANSItemsToExcel";

export type MasterEstimateData = SharedEstimateData;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readAnalysisRows(data: MasterEstimateData, code: string, item: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(item.analysisRows)) return item.analysisRows.filter(isRecord);
  if (typeof item.analysisRows === "string") {
    try {
      const parsed: unknown = JSON.parse(item.analysisRows);
      if (Array.isArray(parsed)) return parsed.filter(isRecord);
    } catch { /* Fall through to the saved project snapshot. */ }
  }
  const saved: unknown = data.rateAnalyses?.[code];
  if (Array.isArray(saved)) return saved.filter(isRecord);
  if (isRecord(saved) && Array.isArray(saved.rows)) return saved.rows.filter(isRecord);
  return [];
}

function truthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function firstNonEmptyText(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const candidate = String(value).trim();
    if (candidate) return candidate;
  }
  return "";
}

function estimateCode(row: Record<string, unknown>): string {
  return String(row.itemCode ?? row.code ?? "").trim();
}

function isCustomCode(code: string): boolean {
  return /^(?:50|51)(?:\.|$)/i.test(code) || /^NSR(?:\.|$)/i.test(code);
}

function buildCustomItems(data: MasterEstimateData): MultiRANSItemExportData[] {
  const ratesByCode = new Map<string, Record<string, unknown>>();
  for (const rate of data.rates || []) {
    const code = String(rate.code ?? rate.itemCode ?? "").trim();
    if (code) ratesByCode.set(code.toLowerCase(), rate);
  }

  const usedRows = new Map<string, Record<string, unknown>>();
  for (const row of data.estimateRows || []) {
    const code = estimateCode(row);
    if (isCustomCode(code)) usedRows.set(code.toLowerCase(), row);
  }

  const items: MultiRANSItemExportData[] = [];
  for (const row of usedRows.values()) {
    const code = estimateCode(row);
    const master = ratesByCode.get(code.toLowerCase()) || {};
    const analysisRows = readAnalysisRows(data, code, { ...row, ...master });
    // A cleared/stale estimate-row description must not mask the current saved
    // NSR/mDSR description. An explicit userDescription remains the override.
    const itemDescription = firstNonEmptyText(
      row.userDescription,
      master.description,
      master.itemDescription,
      master.item_description,
      row.itemDescription,
      row.description,
    );
    const settings = row.nsrSettings ?? row.settings ?? master.nsrSettings ?? master.settings ?? {};
    items.push({
      ...master,
      ...row,
      code,
      itemCode: code,
      itemNo: row.itemNo ?? row.item_no ?? code,
      description: itemDescription,
      itemDescription,
      unit: firstNonEmptyText(master.unit, row.unit),
      baseQty: row.baseQty ?? row.base_qty ?? (settings as Record<string, unknown>)?.baseQty ?? master.baseQty ?? master.base_qty ?? null,
      rate: master.rate ?? master.dsrRate ?? master.dsr_rate ?? row.rate ?? null,
      analysisRows,
      isExternalAR: truthyFlag(row.isExternalAR ?? row.is_external_ar ?? master.isExternalAR ?? master.is_external_ar),
      isParentHeading: truthyFlag(row.isParentHeading ?? row.is_parent_heading ?? master.isParentHeading ?? master.is_parent_heading),
      nsrSettings: settings as Record<string, unknown>,
    } as MultiRANSItemExportData);
  }
  return items;
}

function buildSupportingItems(data: MasterEstimateData): MultiRANSItemExportData[] {
  const supportingByCode = new Map<string, MultiRANSItemExportData>();
  const add = (code: string, source: Record<string, unknown>) => {
    const normalized = code.trim();
    if (!normalized) return;
    const prior = supportingByCode.get(normalized.toLowerCase()) || {};
    supportingByCode.set(normalized.toLowerCase(), {
      ...prior,
      ...source,
      code: normalized,
      itemCode: normalized,
      itemNo: source.itemNo ?? source.item_no ?? normalized,
      description: firstNonEmptyText(
        source.description,
        source.itemDescription,
        source.item_description,
        prior.description,
        prior.itemDescription,
        prior.item_description,
      ),
      unit: source.unit ?? prior.unit ?? "",
      analysisRows: readAnalysisRows(data, normalized, source),
    } as MultiRANSItemExportData);
  };

  for (const rate of data.rates || []) {
    const code = String(rate.code ?? rate.itemCode ?? "").trim();
    if (code) add(code, rate);
  }
  for (const [code, saved] of Object.entries(data.rateAnalyses || {})) {
    const existing = supportingByCode.get(code.toLowerCase());
    const rowSource = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
    add(code, { ...(existing || {}), ...rowSource, analysisRows: readAnalysisRows(data, code, existing || rowSource) });
  }
  return [...supportingByCode.values()];
}

function wireCustomAnalysisReferences(
  workbook: ExcelJS.Workbook,
  rowRefs: SharedWorkbookRowRefs,
  analysisRefs: Record<string, MultiRANSItemSheetReference>,
) {
  const measurement = workbook.getWorksheet("Measurement Sheet");
  const abstract = workbook.getWorksheet("Abstract of Cost");
  for (const [code, ref] of Object.entries(analysisRefs)) {
    const measurementRef = rowRefs.msmt[code];
    if (measurementRef && measurement) {
      measurement.getCell(measurementRef.descRow, 2).value = {
        formula: `'${ref.sheetName}'!B${ref.descriptionRow}`,
        result: ref.description,
      };
      if (measurementRef.totalQtyRow) {
        measurement.getCell(measurementRef.totalQtyRow, 11).value = {
          // The terminal Say row carries the item's unit in column G. Column C
          // is only populated for component rows and is blank on the summary row.
          formula: `'${ref.sheetName}'!G${ref.sayRow}`,
          result: ref.unit,
        };
      }
    }

    const abstractRow = rowRefs.abst[code]?.itemRow;
    if (abstractRow && abstract) {
      abstract.getCell(abstractRow, 5).value = {
        formula: `'${ref.sheetName}'!F${ref.sayRow}`,
        result: ref.rate,
      };
      const qtyValue = abstract.getCell(abstractRow, 4).value;
      const quantityValue = qtyValue && typeof qtyValue === "object" && "result" in qtyValue
        ? (qtyValue as { result?: unknown }).result
        : qtyValue;
      const quantity = Number(quantityValue) || 0;
      abstract.getCell(abstractRow, 6).value = {
        formula: `ROUND(D${abstractRow}*E${abstractRow},0)`,
        result: Math.round(quantity * ref.rate),
      };
    }
  }
}

export async function buildMasterEstimateWorkbook(estimateData: MasterEstimateData, estimateId: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;

  const measurementSheet = workbook.addWorksheet("Measurement Sheet");
  const abstractSheet = workbook.addWorksheet("Abstract of Cost");
  const generalAbstractSheet = workbook.addWorksheet("General Abstract");
  const rowRefs: SharedWorkbookRowRefs = { msmt: {}, abst: {}, customRateAnalyses: {} };

  buildMeasurementSheetLayout(measurementSheet, estimateData, estimateId, rowRefs);
  buildAbstractSheetLayout(abstractSheet, estimateData, estimateId, rowRefs);
  buildGenAbstSheetLayout(generalAbstractSheet, estimateData, estimateId, rowRefs);

  const analysisRefs = await appendMultiRANSItemsWorksheets(
    workbook,
    buildCustomItems(estimateData),
    buildSupportingItems(estimateData),
    {
      estimateId,
      leftAETitle: String(estimateData.projectDetails?.leftAETitle || "Assistant Engineer,"),
      leftAEOffice: String(estimateData.projectDetails?.leftAEOffice || "CPWD, Kolhapur."),
      rightAETitle: String(estimateData.projectDetails?.rightAETitle || "Assistant Engineer,"),
      rightAEOffice: String(estimateData.projectDetails?.rightAEOffice || "GCD, CPWD, Goa."),
      eeTitle: String(estimateData.projectDetails?.eeTitle || "Executive Engineer & Senior Manager (C)-I,"),
      eeOffice: String(estimateData.projectDetails?.eeOffice || "GCD, CPWD, Goa."),
    },
  );
  rowRefs.customRateAnalyses = analysisRefs;
  wireCustomAnalysisReferences(workbook, rowRefs, analysisRefs);

  return workbook;
}

export async function exportMasterEstimateToExcel(estimateData: MasterEstimateData, estimateId: string) {
  const workbook = await buildMasterEstimateWorkbook(estimateData, estimateId);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `Master_Estimate_${String(estimateId || "Export").replace(/[^\w-]+/g, "_")}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
