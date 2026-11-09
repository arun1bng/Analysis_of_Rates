import ExcelJS from "exceljs";
import {
  buildAbstractSheetLayout,
  buildGenAbstSheetLayout,
  buildMeasurementSheetLayout,
  type SharedEstimateData,
  type SharedWorkbookRowRefs,
} from "./exportTableToExcel";

export type MasterEstimateData = SharedEstimateData;

export async function exportMasterEstimateToExcel(estimateData: MasterEstimateData, estimateId: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eSTi-Pro";
  workbook.calcProperties.fullCalcOnLoad = true;

  const measurementSheet = workbook.addWorksheet("Measurement Sheet");
  const abstractSheet = workbook.addWorksheet("Abstract of Cost");
  const generalAbstractSheet = workbook.addWorksheet("General Abstract");
  const rowRefs: SharedWorkbookRowRefs = { msmt: {}, abst: {} };

  buildMeasurementSheetLayout(measurementSheet, estimateData, estimateId, rowRefs);
  buildAbstractSheetLayout(abstractSheet, estimateData, estimateId, rowRefs);
  buildGenAbstSheetLayout(generalAbstractSheet, estimateData, estimateId, rowRefs);

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
