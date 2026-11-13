import { prepareMultiRANSItemsForPdf, type MultiRANSItemExportData } from "./exportMultiRANSItemsToExcel";

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
  isNote?: boolean;
  isTotal?: boolean;
  is_total?: boolean;
  isUnitRate?: boolean;
  is_unit_rate?: boolean;
  isSayRow?: boolean;
  is_say_row?: boolean;
  percentage?: number | string | null;
  dependentMark?: string;
  dependent_mark?: string;
};

type ProjectDetails = {
  estimateId?: string;
  leftAETitle?: string;
  leftAEOffice?: string;
  rightAETitle?: string;
  rightAEOffice?: string;
  eeTitle?: string;
  eeOffice?: string;
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const codeOf = (item: MultiRANSItemExportData) => String(item.itemCode ?? item.code ?? "").trim();
const rowsOf = (item: MultiRANSItemExportData): ExportRow[] => {
  const rows = item.analysisRows ?? item.rows;
  if (Array.isArray(rows)) return rows as ExportRow[];
  if (typeof rows === "string") {
    try { const parsed = JSON.parse(rows); return Array.isArray(parsed) ? parsed as ExportRow[] : []; }
    catch { return []; }
  }
  return [];
};

function formatNumber(value: unknown, decimals = 2) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(typeof value === "string" ? value.replace(/[₹,\s]/g, "") : value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(number)
    : String(value);
}

function renderItem(item: MultiRANSItemExportData, sourceCode = "") {
  const code = codeOf(item);
  const itemNo = item.itemNo ?? item.item_no ?? item.slNo ?? code;
  const description = String(item.itemDescription ?? item.description ?? "");
  const external = item.isExternalAR === true || Number(item.is_external_ar) === 1;
  const rows = rowsOf(item);
  let financialBlockStarted = false;
  const body = external
    ? `<tr><td></td><td colspan="6" class="external">Being an External Analysis of Rate (AR) item, no corresponding detailed Rate Analysis is available in this export.</td></tr>`
    : rows.map(row => {
      const rowType = String(row.type ?? row.row_type ?? "").toUpperCase();
      const descriptionText = String(row.description ?? "");
      const mark = String(row.mark ?? row.calc_mark ?? row.reference_mark ?? "").toUpperCase();
      const isTotal = rowType === "TOTAL" || Boolean(row.isTotal || row.is_total);
      const isUnitRate = rowType === "UNIT_RATE" || rowType === "UNITRATE" || Boolean(row.isUnitRate || row.is_unit_rate);
      const isSay = rowType === "SAY" || rowType === "SAYROW" || Boolean(row.isSayRow || row.is_say_row);
      const isPercentage = row.percentage !== null && row.percentage !== undefined && Boolean(row.dependentMark || row.dependent_mark);
      const isNote = (rowType === "NCR" || rowType === "NOTE" || Boolean(row.isNote && rowType !== "SCR")) &&
        !isTotal && !isUnitRate && !isSay && !isPercentage;
      const rowCode = row.code ?? row.component_code ?? row.sub_analysis_code ?? "";
      const reference = sourceCode && /details\s+of\s+cost\s+(?:for|of)\s+[\d.]+/i.test(descriptionText)
        ? `<tr class="reference"><td></td><td colspan="6">Reference to item number: ${escapeHtml(sourceCode)}</td></tr>` : "";
      const isFinancialStart = !financialBlockStarted && mark === "W";
      if (isFinancialStart) financialBlockStarted = true;
      const classes = [isTotal ? "total" : "", isUnitRate ? "unit-rate" : "", isSay ? "say" : "", isFinancialStart ? "financial-start" : ""]
        .filter(Boolean).join(" ");
      return `${reference}<tr class="${classes}">
        <td class="center">${escapeHtml(rowCode)}</td><td>${escapeHtml(descriptionText)}</td>
        <td class="center">${escapeHtml(row.unit ?? "")}</td>
        <td class="number">${isNote ? "" : formatNumber(row.quantity, 3)}</td>
        <td class="number">${isNote ? "" : formatNumber(row.rate)}</td>
        <td class="number amount">${isNote ? "" : formatNumber(row.amount)}</td>
        <td class="center">${escapeHtml(row.mark ?? row.calc_mark ?? row.reference_mark ?? "")}</td>
      </tr>`;
    }).join("");

  return `<section class="item-block">
    <table class="item-head"><tbody>
      <tr><td class="item-no-label">Item No.</td><td class="item-no" colspan="6">${escapeHtml(itemNo)}</td></tr>
      <tr><td class="item-code">${escapeHtml(code)}</td><td class="item-description" colspan="6">${escapeHtml(description)}</td></tr>
    </tbody></table>
    <table class="analysis"><colgroup><col class="code"><col class="description"><col class="unit"><col class="qty"><col class="rate"><col class="amount"><col class="mark"></colgroup>
      <thead><tr><th>Code</th><th>Description</th><th>Unit</th><th>Quantity</th><th>Rate Rs.</th><th>Amount Rs.</th><th>Mark</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

export function exportMultiRANSItemsToPdf(
  itemsData: MultiRANSItemExportData[],
  supportingItems: MultiRANSItemExportData[] = [],
  projectDetails: ProjectDetails = {},
  family: "NS" | "mDSR" = "NS",
): Promise<void> {
  const printWindow = window.open("", "_blank", "width=1000,height=800");
  if (!printWindow) throw new Error("The PDF print window was blocked. Allow pop-ups and try again.");

  // Open the print window synchronously from the click handler, then resolve
  // referenced analyses through the same data/API path as the Excel export.
  return prepareMultiRANSItemsForPdf(itemsData, supportingItems, family).then(({ mainItems, supportingItems: referencedItems }) => {
  const supportSection = referencedItems.length
    ? `<div class="support-title">SUPPORTING SUB-ARs — ${family === "mDSR" ? "mDSR" : "NS"} ITEMS</div>${referencedItems.map(item => renderItem(item)).join("")}`
    : "";

  const estimateId = String(projectDetails.estimateId || "Estimate");
  const cssEstimateId = estimateId.replace(/[\\"]/g, "\\$&").replace(/[\r\n]/g, " ");
  const leftTitle = projectDetails.leftAETitle || "Assistant Engineer,";
  const rightTitle = projectDetails.rightAETitle || "Assistant Engineer,";
  const leftOffice = projectDetails.leftAEOffice || "";
  const rightOffice = projectDetails.rightAEOffice || "";
  const eeTitle = projectDetails.eeTitle || "Executive Engineer & Senior Manager (C)-I,";
  const eeOffice = projectDetails.eeOffice || "";

  printWindow.document.open();
  const reportTitle = family === "mDSR" ? "RATE ANALYSIS FOR MODIFIED DSR ITEMS" : "RATE ANALYSIS FOR NON SCHEDULE ITEMS";
  const footerTitle = family === "mDSR" ? "mDSR Items" : "NS Items";
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${reportTitle}</title>
    <style>
      @page { size: A4 portrait; margin: 14mm 12mm 20mm; @bottom-left { content: "Rate Analysis - ${footerTitle}"; font: 8pt Arial; } @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial; } @bottom-right { content: "EST ID: ${cssEstimateId}"; font: 8pt Arial; } }
      * { box-sizing: border-box; } body { margin: 0; color: #111; font: 10pt "Book Antiqua", Georgia, serif; }
      h1 { margin: 0 0 18px; text-align: center; font-size: 12pt; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      col.code { width: 9%; } col.description { width: 47%; } col.unit { width: 8%; } col.qty { width: 9%; } col.rate { width: 10%; } col.amount { width: 11%; } col.mark { width: 6%; }
      td, th { padding: 4px 3px; vertical-align: middle; overflow-wrap: anywhere; }
      .item-head { margin-bottom: 0; border: 1px solid #111; } .item-head td { padding: 5px; }
      .item-no-label { width: 9%; font-weight: bold; } .item-no { font-weight: bold; }
      .item-code, .center { text-align: center; } .item-code { vertical-align: top; }
      .item-description { vertical-align: top; text-align: justify; white-space: pre-wrap; }
      .analysis { margin-bottom: 15px; } .analysis th { border: 1px solid #111; text-align: center; }
      .analysis td { border-left: 1px solid #111; border-right: 1px solid #111; }
      .financial-start td { border-top: 1px solid #111; } .say td { border-bottom: 1px solid #111; }
      .number { text-align: right; white-space: nowrap; } .total td, .unit-rate td, .say td { padding-top: 5px; padding-bottom: 5px; }
      .total td:nth-child(2), .unit-rate td:nth-child(2), .say td:nth-child(2), .total .amount, .say .amount { font-weight: bold; }
      .say .amount { border: 2px solid #111; } .external, .reference { font-style: italic; }
      .item-block { break-inside: avoid-page; } .support-title { break-before: page; margin: 0 0 12px; text-align: center; font-weight: bold; font-size: 12pt; }
      .signatories { margin-top: 28px; break-inside: avoid; } .signatory-gap { height: 14px; }
      .sign-row { display: flex; justify-content: space-between; gap: 24px; margin-top: 24px; }
      .signatory { width: 46%; white-space: pre-line; } .signatory.right { text-align: right; }
      .ee-signatory { margin-top: 30px; text-align: center; white-space: pre-line; }
      @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }
    </style></head><body>
      <h1>${reportTitle}</h1>
      ${mainItems.map(item => renderItem(item, String((item as any).sourceItemCode ?? (item as any).source_item_code ?? ""))).join("")}
      ${supportSection}
      <section class="signatories"><div class="signatory-gap"></div>
        <div class="sign-row"><div class="signatory">${escapeHtml(leftTitle)}<br>${escapeHtml(leftOffice)}</div><div class="signatory right">${escapeHtml(rightTitle)}<br>${escapeHtml(rightOffice)}</div></div>
        <div class="ee-signatory">${escapeHtml(eeTitle)}<br>${escapeHtml(eeOffice)}</div>
      </section>
      <script>window.addEventListener('load',()=>{window.focus();setTimeout(()=>window.print(),250)});window.addEventListener('afterprint',()=>window.close());</script>
    </body></html>`);
  printWindow.document.close();
  }).catch(error => {
    printWindow.close();
    throw error;
  });
}
