type PdfExportRow = {
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
  isTotal?: boolean;
  isUnitRate?: boolean;
  isSayRow?: boolean;
};

export type SingleRANSItemPdfData = {
  itemNo?: string | number;
  itemCode?: string;
  code?: string;
  description?: string;
  itemDescription?: string;
  unit?: string;
  analysisRows?: PdfExportRow[];
};

type SignatoryDetails = {
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

const formatNumber = (value: unknown, decimals = 2) => {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(typeof value === "string" ? value.replace(/[₹,\s]/g, "") : value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(number)
    : String(value);
};

export function exportSingleRANSItemToPdf(
  itemData: SingleRANSItemPdfData,
  sourceItemCode = "",
  projectDetails: SignatoryDetails = {},
) {
  // Open synchronously from the button gesture so browsers do not block the print window.
  const printWindow = window.open("", "_blank", "width=1000,height=800");
  if (!printWindow) throw new Error("The PDF print window was blocked. Allow pop-ups and try again.");

  const itemCode = String(itemData.itemCode ?? itemData.code ?? "").trim();
  const family = /^50(?:\.|$)/.test(itemCode) ? "MODIFIED DSR" : "NON SCHEDULE";
  const itemDescription = String(itemData.itemDescription ?? itemData.description ?? "");
  const rows = Array.isArray(itemData.analysisRows) ? itemData.analysisRows : [];
  let referencePrinted = false;
  const bodyRows = rows.map(row => {
    const description = String(row.description ?? "");
    if (!referencePrinted && sourceItemCode && /details\s+of\s+cost\s+(?:for|of)\s+[\d.]+/i.test(description)) {
      referencePrinted = true;
      // The reference row is inserted immediately before the cost details row below.
      // Keep one cell per export column so the reference row retains the same
      // vertical dividers as the analysis rows in print/PDF output.
      return `<tr class="reference"><td class="code"></td><td>Reference to item number: ${escapeHtml(sourceItemCode)}</td><td class="center"></td><td class="number"></td><td class="number"></td><td class="number amount"></td><td class="center"></td></tr>${renderRow(row)}`;
    }
    return renderRow(row);
  }).join("");

  function renderRow(row: PdfExportRow) {
    const rowType = String(row.type ?? row.row_type ?? (row.isNote ? "NCR" : "")).toUpperCase();
    const isNote = rowType === "NCR" || rowType === "NOTE" || Boolean(row.isNote && rowType !== "SCR");
    const description = String(row.description ?? "");
    const sayRow = rowType === "SAY" || Boolean(row.isSayRow);
    const totalRow = rowType === "TOTAL" || Boolean(row.isTotal);
    const unitRateRow = rowType === "UNIT_RATE" || Boolean(row.isUnitRate);
    return `<tr class="${[isNote ? "note" : "", totalRow ? "total" : "", unitRateRow ? "unit-rate" : "", sayRow ? "say" : ""].filter(Boolean).join(" ")}">
      <td class="code">${escapeHtml(row.code ?? row.component_code ?? "")}</td>
      <td>${escapeHtml(description)}</td>
      <td class="center">${escapeHtml(row.unit ?? "")}</td>
      <td class="number">${isNote ? "" : formatNumber(row.quantity, 3)}</td>
      <td class="number">${isNote ? "" : formatNumber(row.rate)}</td>
      <td class="number amount">${isNote ? "" : formatNumber(row.amount)}</td>
      <td class="center">${escapeHtml(row.mark ?? "")}</td>
    </tr>`;
  }

  const safeEstimateId = String(projectDetails.estimateId || "Estimate");
  const cssEstimateId = safeEstimateId.replace(/[\\"]/g, "\\$&").replace(/[\r\n]/g, " ");
  const leftTitle = projectDetails.leftAETitle || "Assistant Engineer,";
  const leftOffice = projectDetails.leftAEOffice || "";
  const rightTitle = projectDetails.rightAETitle || "Assistant Engineer,";
  const rightOffice = projectDetails.rightAEOffice || "";
  const eeTitle = projectDetails.eeTitle || "Executive Engineer & Senior Manager (C)-I,";
  const eeOffice = projectDetails.eeOffice || "";
  const title = family === "MODIFIED DSR" ? "RATE ANALYSIS FOR MODIFIED DSR ITEMS" : "RATE ANALYSIS FOR NON SCHEDULE ITEMS";

  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(itemCode)} Rate Analysis</title>
    <style>
      @page { size: A4 portrait; margin: 14mm 12mm 20mm; @bottom-left { content: "Rate Analysis - ${family === "MODIFIED DSR" ? "mDSR" : "NS"} Items"; font: 8pt Arial; } @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial; } @bottom-right { content: "EST ID: ${cssEstimateId}"; font: 8pt Arial; } }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font: 10pt "Book Antiqua", Georgia, serif; }
      h1 { margin: 0 0 18px; text-align: center; font-size: 12pt; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      col.code { width: 9%; } col.description { width: 47%; } col.unit { width: 8%; } col.qty { width: 9%; } col.rate { width: 10%; } col.amount { width: 11%; } col.mark { width: 6%; }
      td, th { padding: 4px 3px; vertical-align: middle; overflow-wrap: anywhere; }
      .item-head { border: 1px solid #111; }
      .item-head td { padding: 5px; }
      .item-no-label { width: 9%; font-weight: bold; }
      .item-no { font-weight: bold; }
      .item-code { text-align: center; vertical-align: top; }
      .item-description { vertical-align: top; text-align: justify; white-space: pre-wrap; }
      .column-head th { border: 1px solid #111; text-align: center; font-weight: bold; }
      .analysis td { border-left: 1px solid #111; border-right: 1px solid #111; }
      .analysis tr:first-child td { padding-top: 5px; }
      .analysis .code, .center { text-align: center; }
      .number { text-align: right; white-space: nowrap; }
      .note td { padding-top: 2px; padding-bottom: 2px; }
      .total td, .unit-rate td, .say td { padding-top: 5px; padding-bottom: 5px; }
      .total td:nth-child(2), .unit-rate td:nth-child(2), .say td:nth-child(2) { font-weight: bold; }
      .total .amount { font-weight: bold; }
      .reference td { font-style: italic; }
      .say td { border-bottom: 1px solid #111; }
      .say .amount { border: 2px solid #111; font-weight: bold; }
      .analysis tr:last-child td { border-bottom: 1px solid #111; }
      .signatories { margin-top: 28px; page-break-inside: avoid; }
      .signatory-gap { height: 14px; }
      .sign-row { display: flex; justify-content: space-between; gap: 24px; margin-top: 24px; }
      .signatory { width: 46%; white-space: pre-line; }
      .signatory.right { text-align: right; }
      .ee-signatory { margin-top: 30px; text-align: center; white-space: pre-line; }
      @media print { thead { display: table-header-group; } tr { break-inside: avoid; } .signatories { break-inside: avoid; } }
    </style></head><body>
      <h1>${title}</h1>
      <table class="item-head"><tbody>
        <tr><td class="item-no-label">Item No.</td><td class="item-no" colspan="6">${escapeHtml(itemData.itemNo ?? itemCode)}</td></tr>
        <tr><td class="item-code">${escapeHtml(itemCode)}</td><td class="item-description" colspan="6">${escapeHtml(itemDescription)}</td></tr>
      </tbody></table>
      <table><colgroup><col class="code"><col class="description"><col class="unit"><col class="qty"><col class="rate"><col class="amount"><col class="mark"></colgroup>
        <thead><tr class="column-head"><th>Code</th><th>Description</th><th>Unit</th><th>Quantity</th><th>Rate Rs.</th><th>Amount Rs.</th><th>Mark</th></tr></thead>
        <tbody class="analysis">${bodyRows}</tbody>
      </table>
      <section class="signatories">
        <div class="signatory-gap" aria-hidden="true"></div>
        <div class="sign-row"><div class="signatory">${escapeHtml(leftTitle)}<br>${escapeHtml(leftOffice)}</div><div class="signatory right">${escapeHtml(rightTitle)}<br>${escapeHtml(rightOffice)}</div></div>
        <div class="ee-signatory">${escapeHtml(eeTitle)}<br>${escapeHtml(eeOffice)}</div>
      </section>
      <script>window.addEventListener('load',()=>{window.focus();setTimeout(()=>window.print(),250)});window.addEventListener('afterprint',()=>window.close());</script>
    </body></html>`);
  printWindow.document.close();
}
