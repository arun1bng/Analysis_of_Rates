import ExcelJS from "exceljs";
import { buildMasterEstimateWorkbook, type MasterEstimateData } from "./exportMasterEstimateToExcel";

type HistoryPayload = {
  historySheet?: Record<string, unknown> | null;
  estimateSummary?: Record<string, unknown> | null;
  projectSettings?: Record<string, unknown> | null;
  error?: string;
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");

function historyHtml(payload: HistoryPayload, projectId: string) {
  const form = payload.historySheet || {};
  const summary = payload.estimateSummary || {};
  const settings = payload.projectSettings || {};
  const f = (key: string, fallback = "") => escapeHtml(form[key] ?? fallback);
  const p = (key: string, fallback = "") => escapeHtml(settings[key] ?? fallback);
  const s = (key: string, fallback = "") => escapeHtml(summary[key] ?? fallback);
  const paragraphs = (value: unknown) => String(value ?? "").split(/\r?\n/).map(line => `<p>${escapeHtml(line) || "&nbsp;"}</p>`).join("");
  const amount = `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(Number(summary.probableCost) || 0))}/-`;
  const surcharge = [
    Number(summary.contingencyRate) > 0 ? `${escapeHtml(summary.contingencyRate)}% contingencies` : "",
    Number(summary.epfRate) > 0 ? `EPF Charges @ ${escapeHtml(summary.epfRate)}%` : "",
    Number(summary.esiRate) > 0 ? `ESI Charges @ ${escapeHtml(summary.esiRate)}%` : "",
  ].filter(Boolean).join(", ");
  const cpwdLogo = f("cpwdLogoDataUrl", "/logos/cpwd-logo.png");
  const goiLogo = f("goiLogoDataUrl", "/logos/goi-emblem.png");
  const type = form.estimateType === "DE" ? "Detailed Estimate" : "Preliminary Estimate cum Detailed Estimate";
  return `<section class="history-page"><div class="masthead"><div><img src="${cpwdLogo}" alt="CPWD"></div><div><h1>GOVERNMENT OF INDIA</h1><b>CENTRAL PUBLIC WORKS DEPARTMENT</b><br>Office of the ${p("eeTitle", "Executive Engineer & Senior Manager (C)-I,")}<br>${p("eeOffice", "GCD, CPWD, Goa.")}</div><div><img src="${goiLogo}" alt="Government of India"></div></div>
    <div class="offices"><b>STATE : ${p("state", "GOA")}</b><b>DIVISION : ${p("division", "GCD")}</b></div><div class="offices"><b>BRANCH : ${p("branch", "B & R")}</b><b>SUB DIVISION : ${p("subDivision", "Kolhapur Sub Division")}</b></div>
    <p><b>ESTIMATE NO:</b> ${s("estimateId", projectId)}</p><p><b>Name of work:</b> ${s("nameOfWork", "—")}</p><p><b>SH:</b> ${s("subHeads", "—")}</p>
    <table class="major-head"><thead><tr><th>Major Head</th><th>Minor Head</th><th>Detailed Head</th></tr></thead><tbody><tr><td>${f("majorHead")}</td><td>${f("minorHead")}</td><td>${f("detailedHead")}</td></tr></tbody></table>
    <p class="justify">This ${form.isDraft === false ? "" : "Draft "}${escapeHtml(type)} has been framed by ${f("framedBy", "Assistant Engineer Civil, Kolhapur Sub-division, CPWD, Kolhapur")} and further scrutinized in the Office of ${f("scrutinizedBy", "Executive Engineer and Senior Manager (C)-I, CPWD, Bambolim, Goa")}, at a probable cost of ${escapeHtml(amount)} (Civil work)${surcharge ? ` including ${surcharge}` : ""}.</p>
    <h2>REPORT</h2><h3>History:</h3>${paragraphs(form.historyNarrative)}<h3>Design &amp; Scope:</h3>${paragraphs(form.designScopeNarrative)}
    <p><b><u>Specification:</u></b> ${f("specifications")}</p><p><b><u>Cost:</u></b> ${escapeHtml(amount)} (Civil work)${surcharge ? ` including ${surcharge}` : ""}.</p><p><b><u>Rate (Civil):</u></b> D.S.R. ${s("dsrYear", "2023")} and market rates for Non-scheduled items.</p>
    <p><b><u>Method:</u></b> ${f("methodOfExecution", "By contract after call of tender")}</p><p><b><u>Time Limit:</u></b> ${s("timeLimitMonths", "Not specified")} months for execution.</p><p><b><u>Tools &amp; plant:</u></b> ${f("toolsAndPlant", "To be arranged by the contractor")}</p><p><b><u>Land:</u></b> ${f("landAvailability", "Available")}</p>
    ${form.includeNote === false ? "" : `<h3>Note:</h3>${paragraphs(form.noteText)}`}<div class="signatories"><div>${p("leftAETitle", "Assistant Engineer,")}<br>${p("leftAEOffice", "CPWD, Kolhapur.")}</div><div>${p("rightAETitle", "Assistant Engineer,")}<br>${p("rightAEOffice", "GCD, CPWD, Goa.")}</div><div class="executive">${p("eeTitle", "Executive Engineer & Senior Manager (C)-I,")}<br>${p("eeOffice", "GCD, CPWD, Goa.")}</div></div></section>`;
}

function tableHtml(sheet: ExcelJS.Worksheet) {
  const cols = Array.from({ length: sheet.columnCount }, (_, i) => ({ index: i + 1, width: sheet.getColumn(i + 1).width || 10, hidden: Boolean(sheet.getColumn(i + 1).hidden) })).filter(col => !col.hidden);
  const totalWidth = cols.reduce((sum, col) => sum + col.width, 0) || 1;
  const colNumber = (address: string) => [...(address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A")].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
  const rowNumber = (address: string) => Number(address.match(/\d+/)?.[0] || 1);
  const mergeStarts = new Map<string, { address: string; span: number }>();
  const hidden = new Set<string>();
  for (const merge of sheet.model.merges || []) {
    const [start, end] = merge.split(":");
    const r1 = rowNumber(start), r2 = rowNumber(end), c1 = colNumber(start), c2 = colNumber(end);
    const visible = cols.map(col => col.index).filter(col => col >= c1 && col <= c2);
    if (!visible.length) continue;
    mergeStarts.set(`${r1}:${visible[0]}`, { address: start, span: visible.length });
    for (let r = r1; r <= r2; r++) for (const col of visible) if (r !== r1 || col !== visible[0]) hidden.add(`${r}:${col}`);
  }
  const border = (style?: ExcelJS.BorderStyle) => !style ? "none" : style === "hair" ? "0.5px dotted #222" : `${style === "medium" || style === "thick" ? 1.5 : style === "double" ? 2 : 1}px solid #222`;
  const formatValue = (cell: ExcelJS.Cell) => {
    const val = cell.value;
    const result = val && typeof val === "object" && "result" in val ? val.result : val && typeof val === "object" && "text" in val ? val.text : val && typeof val === "object" && "richText" in val ? val.richText.map(part => part.text).join("") : val;
    if (typeof result === "number" && Number.isFinite(result)) {
      const decimals = (cell.numFmt || "").split(".")[1]?.match(/[0#]+/)?.[0] || "";
      return new Intl.NumberFormat("en-IN", { useGrouping: true, minimumFractionDigits: decimals.split("").filter(char => char === "0").length, maximumFractionDigits: decimals.length }).format(result);
    }
    return String(result ?? "");
  };
  const rows: string[] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const cells: string[] = [];
    for (const col of cols) {
      const key = `${r}:${col.index}`;
      if (hidden.has(key)) continue;
      const cell = sheet.getCell(mergeStarts.get(key)?.address || `${String.fromCharCode(64 + col.index)}${r}`);
      const a = cell.alignment || {}, f = cell.font || {}, b = cell.border || {};
      const fill = cell.fill?.type === "pattern" && cell.fill.fgColor?.argb ? `#${cell.fill.fgColor.argb.slice(-6)}` : "";
      const fontColor = f.color && "argb" in f.color && f.color.argb ? `#${f.color.argb.slice(-6)}` : "";
      const style = [`text-align:${a.horizontal === "justify" ? "justify" : a.horizontal || "left"}`, `vertical-align:${a.vertical === "top" ? "top" : "middle"}`, `font-family:${escapeHtml(f.name || "Book Antiqua")}`, `font-size:${f.size || 10}pt`, `font-weight:${f.bold ? "bold" : "normal"}`, `white-space:${a.wrapText ? "pre-wrap" : "nowrap"}`, a.wrapText ? "overflow-wrap:anywhere" : "", fill ? `background:${fill}` : "", fontColor ? `color:${fontColor}` : "", `border-top:${border(b.top?.style)}`, `border-right:${border(b.right?.style)}`, `border-bottom:${border(b.bottom?.style)}`, `border-left:${border(b.left?.style)}`].filter(Boolean).join(";");
      const text = escapeHtml(formatValue(cell)).replace(/\r?\n/g, "<br>") || "&nbsp;";
      const span = mergeStarts.get(key)?.span;
      cells.push(`<td${span ? ` colspan="${span}"` : ""} style="${style}">${text}</td>`);
    }
    const height = sheet.getRow(r).height;
    rows.push(`<tr${height ? ` style="height:${height}pt"` : ""}>${cells.join("")}</tr>`);
  }
  const titleRow = Number(sheet.pageSetup.printTitlesRow?.split(":")[0]) || 0;
  const preamble = titleRow ? rows.slice(0, titleRow - 1).join("") : "";
  const head = titleRow ? rows[titleRow - 1] || "" : "";
  const body = rows.slice(titleRow).join("");
  const colgroup = cols.map(col => `<col style="width:${(col.width / totalWidth * 100).toFixed(4)}%">`).join("");
  return `${preamble ? `<table class="grid"><colgroup>${colgroup}</colgroup><tbody>${preamble}</tbody></table>` : ""}<table class="grid"><colgroup>${colgroup}</colgroup>${head ? `<thead>${head}</thead>` : ""}<tbody>${body}</tbody></table>`;
}

/** Download the master estimate as a single portrait PDF, retaining the populated workbook sheet order. */
export async function exportMasterEstimateToPdf(estimateData: MasterEstimateData, estimateId: string, projectId: string) {
  const printWindow = window.open("", "_blank", "width=1000,height=800");
  if (!printWindow) throw new Error("The PDF print window was blocked. Allow pop-ups and try again.");
  try {
    const response = await fetch(`/api/history-sheet?projectId=${encodeURIComponent(projectId)}`);
    const payload = await response.json() as HistoryPayload;
    if (!response.ok) throw new Error(payload.error || "Could not load the History Sheet for the master PDF.");
    const workbook = await buildMasterEstimateWorkbook(estimateData, estimateId);
    const names = ["General Abstract", "Abstract of Cost", "Measurement Sheet", "AR _ mDSR Items", "Sub AR _ mDSR Items", "AR _ NS Items", "Sub AR _ NS Items"];
    const sheets = names.map(name => workbook.getWorksheet(name)).filter((sheet): sheet is ExcelJS.Worksheet => Boolean(sheet));
    const sections = [historyHtml(payload, projectId), ...sheets.map((sheet, index) => `<section class="workbook-sheet${index ? " page-start" : ""}${sheet.name === "General Abstract" ? " general-abstract" : ""}">${tableHtml(sheet)}</section>`)].join("");
    const safeId = String(estimateId || "Estimate").trim().replace(/[<>:"\\|?*\x00-\x1F]/g, "").replace(/\s+/g, "_");
    const filename = `Master_Estimate_${safeId}`;
    const baseUrl = escapeHtml(window.location.origin);
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${baseUrl}/"><title>${escapeHtml(filename)}</title><style>
      @page{size:A4 portrait;margin:.75in .5in .75in .5in;@bottom-center{content:"Page " counter(page) " of " counter(pages);font:8pt "Book Antiqua",serif}@bottom-right{content:"${escapeHtml(estimateId)}";font:8pt "Book Antiqua",serif}}
      *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;padding:0;color:#111;background:#fff;font-family:"Book Antiqua",serif}.history-page{break-after:page;font-size:10pt;line-height:1.3}.masthead{display:grid;grid-template-columns:15% 70% 15%;align-items:center;text-align:center;min-height:1in}.masthead img{max-width:.72in;max-height:.9in;object-fit:contain}.masthead h1{font-size:14pt;margin:3pt}.offices{display:flex;justify-content:space-between;margin:12pt 0}.major-head{border-collapse:collapse;width:100%;margin:12pt 0}.major-head th,.major-head td{border:1px solid #111;padding:5pt;text-align:left;height:28pt}.justify{text-align:justify;text-indent:24pt}.history-page h2{text-align:center;margin:14pt 0 7pt;font-size:13pt}.history-page h3{margin:10pt 0 4pt;text-decoration:underline}.history-page p{margin:5pt 0;text-align:justify}.signatories{display:grid;grid-template-columns:1fr 1fr;gap:7pt 20pt;margin-top:30pt;font-weight:bold}.signatories>div:nth-child(2){text-align:right}.signatories .executive{grid-column:1/3;text-align:center;margin-top:14pt}.workbook-sheet{font-size:10pt}.workbook-sheet.page-start{break-before:page}.workbook-sheet.general-abstract{padding-left:.75in}.grid{width:100%;table-layout:fixed;border-collapse:collapse;margin:0}.grid td{padding:2pt 3pt;overflow-wrap:anywhere}.grid tr{break-inside:avoid;page-break-inside:avoid}.grid thead{display:table-header-group}
      </style></head><body>${sections}<script>window.addEventListener('load',()=>{window.focus();setTimeout(()=>window.print(),300)});window.addEventListener('afterprint',()=>window.close());</script></body></html>`);
    printWindow.document.close();
  } catch (error) {
    printWindow.close();
    throw error;
  }
}
