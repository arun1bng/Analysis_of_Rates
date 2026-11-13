"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { saveAs } from "file-saver";
import { usePageTools } from "./PageToolsContext";
import { calculateAbstractTotals, resolveEstimateRate } from "../utils/abstractTotals";
import { fitPngWithinBox } from "../utils/pngSizing";
import { exportJustfnFrontSheetToExcel, exportJustfnFrontSheetToPdf } from "../utils/exportJustfnToExcel";
import { openEstimatePdfWindow } from "../utils/exportTableToExcel";

type EstimateRow = { itemCode?: string; itemNo?: string; quantity?: number | string | null; rate?: number | string | null };
export type JustificationSummaryInputs = { nitNumber: string; lowestContractor: string; contractorTenderedAmount: string };
type Props = {
  estimateRows: EstimateRow[];
  baseEstimateRows?: EstimateRow[];
  rates?: any[];
  theme?: string;
  marketRates?: Record<string, number | string | null | undefined>;
  baseMarketRates?: Record<string, number | string | null | undefined>;
  projectDetails?: Record<string, unknown>;
  justificationPercentage?: number | null;
  projectId?: string;
  summaryInputs: JustificationSummaryInputs;
  onSummaryInputsChange: (next: JustificationSummaryInputs) => void;
  onExportMasterJustfn?: () => void;
};
type SummaryRow = { number: string; label: string; prefix?: string; value: number | string; suffix?: string; emphasis?: boolean };

const roundWhole = (value: number) => Math.round(Number.isFinite(value) ? value : 0);
const formatAmount = (value: number, format = "Indian (Lakhs/Crores)") => {
  const rounded = roundWhole(value);
  if (format === "Standard (Millions)") return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(rounded);
  if (format === "Exact Value") return String(rounded);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(rounded);
};
const formatPercent = (value: number) => Number.isFinite(value) ? value.toFixed(2) + "%" : "—";
const isNS = (code: string) => /^(?:NSR|51(?:\.|$))/i.test(code);
const escapeXml = (value: unknown) => String(value ?? "").replace(/[<>&'"]/g, char => {
  const entities: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" };
  return entities[char] || char;
});

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

function createStoredZip(files: Array<{ name: string; data: string | Uint8Array }>): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const writeHeader = (length: number, writes: Array<[number, number, number]>) => {
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    for (const [position, value, size] of writes) {
      if (size === 2) view.setUint16(position, value, true);
      else view.setUint32(position, value, true);
    }
    return bytes;
  };

  for (const file of files) {
    const name = encoder.encode(file.name);
    const contents = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const checksum = crc32(contents);
    const localHeader = writeHeader(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0, 2], [14, checksum, 4], [18, contents.length, 4], [22, contents.length, 4], [26, name.length, 2], [28, 0, 2]]);
    localParts.push(localHeader, name, contents);
    const centralHeader = writeHeader(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0, 2], [16, checksum, 4], [20, contents.length, 4], [24, contents.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 4], [42, offset, 4]]);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + contents.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = writeHeader(22, [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, centralSize, 4], [16, offset, 4], [20, 0, 2]]);
  const blobParts: BlobPart[] = [...localParts, ...centralParts, end].map(part =>
    part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer
  );
  return new Blob(blobParts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export default function JustificationSummary({
  estimateRows, baseEstimateRows = estimateRows, rates = [], theme = "dark", marketRates = {}, baseMarketRates = marketRates,
  projectDetails = {}, justificationPercentage, projectId = "Estimate", summaryInputs, onSummaryInputsChange, onExportMasterJustfn,
}: Props) {
  const { registerPageTools } = usePageTools();
  const exportWordRef = useRef<() => void>(() => undefined);
  const exportExcelRef = useRef<() => void>(() => undefined);
  const exportPdfRef = useRef<() => void>(() => undefined);
  const findContainerRef = useRef<HTMLDivElement>(null);
  const isDark = theme !== "light";
  const [tenderAmountFocused, setTenderAmountFocused] = useState(false);
  const currencyFormat = String(projectDetails.currencyFormat || "Indian (Lakhs/Crores)");
  const formatMoney = (value: number) => formatAmount(value, currencyFormat);
  const workName = String(projectDetails.nameOfWork || "").trim();
  const subHeads = String(projectDetails.subHeads || "").trim();
  const fullWorkName = [workName, subHeads ? "SH: " + subHeads : ""].filter(Boolean).join("\n");

  const groupedSelectedItems = new Map<string, { item: EstimateRow; quantity: number }>();
  estimateRows.forEach(item => {
    const code = String(item.itemCode || item.itemNo || "").trim();
    if (!code) return;
    const existing = groupedSelectedItems.get(code);
    if (existing) existing.quantity += Number(item.quantity) || 0;
    else groupedSelectedItems.set(code, { item, quantity: Number(item.quantity) || 0 });
  });
  const groupedItems = [...groupedSelectedItems.entries()].map(([code, group]) => ({ code, ...group }));
  const estimateRateFor = (code: string, item: EstimateRow) => isNS(code)
    ? Number(baseMarketRates[code] ?? resolveEstimateRate(item, rates)) || 0
    : resolveEstimateRate(item, rates);

  const scheduleEstimate = groupedItems.reduce((sum, { code, item, quantity }) => {
    return isNS(code) ? sum : sum + roundWhole(estimateRateFor(code, item) * quantity);
  }, 0);
  const nsEstimate = groupedItems.reduce((sum, { code, item, quantity }) => {
    return isNS(code) ? sum + roundWhole(estimateRateFor(code, item) * quantity) : sum;
  }, 0);
  const selectedJustifiedAmount = groupedItems.reduce((sum, { code, item, quantity }) => {
    const estimateRate = estimateRateFor(code, item);
    const justifiedRate = isNS(code) ? estimateRate : marketRates[code] !== undefined ? Number(marketRates[code]) || 0 : estimateRate;
    return sum + roundWhole(quantity * justifiedRate);
  }, 0);
  const costIndex = Number(projectDetails.costIndex ?? 15) || 0;
  const rawMultiplier = Number(projectDetails.gstModificationFactor ?? 0.973);
  const multiplier = Number.isFinite(rawMultiplier) ? rawMultiplier : 0.973;
  // Cost index applies to the full scheduled base (DSR + mDSR), matching the
  // Estimate Abstract and the Justification Statement calculation.
  const costIndexAmount = roundWhole(scheduleEstimate * costIndex / 100);
  const estimatedCostConsidered = roundWhole((scheduleEstimate + costIndexAmount) * multiplier) + roundWhole(nsEstimate);
  const estimatedPutToTender = calculateAbstractTotals(baseEstimateRows, projectDetails, baseMarketRates, rates).baseCombined;
  const correspondingJustifiedAmount = roundWhole(selectedJustifiedAmount);
  const proRataJustifiedAmount = estimatedCostConsidered > 0 ? roundWhole(estimatedPutToTender * correspondingJustifiedAmount / estimatedCostConsidered) : 0;
  const consideredPercent = estimatedPutToTender > 0 ? estimatedCostConsidered / estimatedPutToTender * 100 : 0;
  const belowTenderPercent = estimatedPutToTender > 0 ? (proRataJustifiedAmount - estimatedPutToTender) / estimatedPutToTender * 100 : 0;
  const tenderedAmount = Number(String(summaryInputs.contractorTenderedAmount).replace(/,/g, "")) || 0;
  const clause12Percent = estimatedPutToTender > 0 ? (tenderedAmount - estimatedPutToTender) / estimatedPutToTender * 100 : 0;
  const aboveJustifiedPercent = proRataJustifiedAmount > 0 ? (tenderedAmount - proRataJustifiedAmount) / proRataJustifiedAmount * 100 : 0;
  const deviationText = (percentage: number, subject: string) => {
    if (Math.abs(percentage) < 0.005) return "At Par " + subject;
    return formatPercent(Math.abs(percentage)) + (percentage < 0 ? " Below " : " Above ") + subject;
  };
  const belowTenderLabel = Math.abs(belowTenderPercent) < 0.005
    ? "Justified Percentage At Par Estimated cost put to tender (ECPT):-"
    : "Justified Percentage " + (belowTenderPercent < 0 ? "Below" : "Above") + " Estimated cost put to tender (ECPT):-";
  const tenderVsJustifiedDirection = Math.abs(aboveJustifiedPercent) < 0.005 ? "At Par" : aboveJustifiedPercent < 0 ? "below" : "Above";
  const deviationDirection = justificationPercentage == null || Math.abs(justificationPercentage) < 0.005
    ? "At Par"
    : justificationPercentage < 0 ? "Below" : "Above";
  const deviationSummary = justificationPercentage == null
    ? null
    : `Justified Percentage ${deviationDirection} ECPT: ${formatPercent(justificationPercentage)}`;
  const rows: SummaryRow[] = [
    { number: "1.", label: "Estimated cost put to tender [ECPT]:-", prefix: "Rs.", value: estimatedPutToTender, emphasis: true },
    { number: "2.", label: "Total of Estimated Cost of Items considered for Justificatoin:-", prefix: "Rs.", value: estimatedCostConsidered },
    { number: "3.", label: "Percentage of Estimated cost considered for Justification:-", value: consideredPercent, suffix: "%" },
    { number: "4.", label: "Corresponding Justified Amount:-", prefix: "Rs.", value: correspondingJustifiedAmount },
    { number: "5.", label: "Total Justified amount on Pro-Rata basis:-", prefix: "Rs.", value: proRataJustifiedAmount, emphasis: true },
    { number: "6.", label: belowTenderLabel, value: Math.abs(belowTenderPercent), suffix: "%", emphasis: true },
    { number: "7.", label: "Name of First lowest Contractor (L1):-", value: summaryInputs.lowestContractor },
    { number: "8.", label: "First lowest Contractor's (L1) Tendered Amount:-", prefix: "Rs.", value: tenderedAmount, emphasis: true },
    { number: "9.", label: "Clause 12: % age:-", value: deviationText(clause12Percent, "ECPT") },
    { number: "10.", label: "Lowest tender percentage " + tenderVsJustifiedDirection + " Justified amount:-", value: deviationText(aboveJustifiedPercent, "ECPT") },
  ];
  const displayValue = (row: SummaryRow) => typeof row.value === "number" ? row.suffix === "%" ? formatPercent(row.value) : formatMoney(row.value) : row.value;
  const updateInput = (key: keyof JustificationSummaryInputs, value: string) => onSummaryInputsChange({ ...summaryInputs, [key]: value });

  const exportToWord = async () => {
    const line = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
    const borders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };
    const noBorders = {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    };
    const cell = (text: string, align: "left" | "right" | "center" = AlignmentType.LEFT, bold = false, span = 1, showBorders = true, leftIndent = 0) => new TableCell({
      columnSpan: span, borders: showBorders ? borders : noBorders, margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new Paragraph({ alignment: align, indent: leftIndent ? { left: leftIndent } : undefined, children: [new TextRun({ text, font: "Book Antiqua", size: 22, bold })] })],
    });
    const detailRows = rows.slice(0, 5).map(row => new TableRow({ children: [
      cell(row.number, AlignmentType.RIGHT, !!row.emphasis),
      cell(row.label, AlignmentType.LEFT, !!row.emphasis, 2),
      cell((row.prefix ? row.prefix + "  " : "") + displayValue(row), AlignmentType.RIGHT, !!row.emphasis),
    ] }));
    const rowSix = rows.slice(5, 6).map(row => new TableRow({ children: [
      cell(row.number, AlignmentType.RIGHT, !!row.emphasis),
      cell(row.label, AlignmentType.LEFT, !!row.emphasis, 2),
      cell((row.prefix ? row.prefix + "  " : "") + displayValue(row), AlignmentType.RIGHT, !!row.emphasis),
    ] }));
    const contractorRows = rows.slice(6).map(row => new TableRow({ children: [
      cell(row.number, AlignmentType.RIGHT, !!row.emphasis),
      cell(row.label, AlignmentType.LEFT, !!row.emphasis, 2),
      cell(row.number === "7." ? summaryInputs.lowestContractor : (row.prefix ? row.prefix + "  " : "") + displayValue(row), AlignmentType.RIGHT, !!row.emphasis),
    ] }));
    const imageRun = async (url: string, width: number, height: number) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not load the default document logo: " + url);
      const data = new Uint8Array(await response.arrayBuffer());
      return new ImageRun({ type: "png", data, transformation: fitPngWithinBox(data, width, height) });
    };
    const [cpwdLogo, goiLogo] = await Promise.all([imageRun("/logos/cpwd-logo.png", 68, 80), imageRun("/logos/goi-emblem.png", 50, 85)]);
    const officeTitle = String(projectDetails.eeTitle || "Executive Engineer & Senior Manager (C)-I,").replace(/^Office of the\s+/i, "").trim();
    const officeName = String(projectDetails.eeOffice || "").trim();
    const doc = new Document({
      styles: { default: { document: { run: { font: "Book Antiqua" } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, right: 850, bottom: 850, left: 850 } } }, children: [
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [
          new TableRow({ children: [
            new TableCell({ width: { size: 12, type: WidthType.PERCENTAGE }, borders: noBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [cpwdLogo] })] }),
            new TableCell({ width: { size: 76, type: WidthType.PERCENTAGE }, borders: noBorders, children: [
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "GOVERNMENT OF INDIA", bold: true, size: 26 })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "CENTRAL PUBLIC WORKS DEPARTMENT", bold: true, size: 23 })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Office of the " + officeTitle, bold: true, size: 21 })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: officeName, bold: true, size: 21 })] }),
            ] }),
            new TableCell({ width: { size: 12, type: WidthType.PERCENTAGE }, borders: noBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [goiLogo] })] }),
          ] }),
        ] }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [
          new TableRow({ children: [cell("STATE : " + String(projectDetails.state || ""), AlignmentType.LEFT, true, 2, false), cell("DIVISION : " + String(projectDetails.division || ""), AlignmentType.RIGHT, true, 2, false)] }),
          new TableRow({ children: [cell("BRANCH : " + String(projectDetails.branch || ""), AlignmentType.LEFT, true, 2, false), cell("SUB DIVISION : " + String(projectDetails.subDivision || ""), AlignmentType.RIGHT, true, 2, false)] }),
        ] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 180, after: 180 }, children: [new TextRun({ text: "Justification Statement (Civil work)", font: "Book Antiqua", bold: true, underline: {}, size: 32 })] }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [2500, 2500, 2500, 2500], borders, rows: [
          new TableRow({ children: [cell("N.I.T. No.:-", AlignmentType.LEFT, true, 1, false), cell(summaryInputs.nitNumber, AlignmentType.LEFT, false, 3, false)] }),
          new TableRow({ children: [cell("Name of Work :-", AlignmentType.LEFT, true, 1, false), cell(fullWorkName || "—", AlignmentType.LEFT, false, 3, false)] }),
      ] }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [500, 3500, 4500, 1000], borders, rows: [
          new TableRow({ children: [cell("With Respect to Lowest Tender", AlignmentType.CENTER, true, 4)] }),
          ...detailRows,
          new TableRow({ children: [cell("Pro-rata calculation: " + formatMoney(estimatedPutToTender) + " × " + formatMoney(correspondingJustifiedAmount) + " ÷ " + formatMoney(estimatedCostConsidered) + " = Rs. " + formatMoney(proRataJustifiedAmount), AlignmentType.LEFT, true, 4, true, 650)] }),
          ...rowSix,
          ...contractorRows,
        ] }),
        new Paragraph({ text: "", spacing: { after: 700 } }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [
          new TableRow({ children: [cell(String(projectDetails.leftAETitle || "Assistant Engineer"), AlignmentType.CENTER, false, 1, false), cell(String(projectDetails.rightAETitle || "Assistant Engineer"), AlignmentType.CENTER, false, 1, false)] }),
          new TableRow({ children: [cell(String(projectDetails.leftAEOffice || ""), AlignmentType.CENTER, false, 1, false), cell(String(projectDetails.rightAEOffice || ""), AlignmentType.CENTER, false, 1, false)] }),
          new TableRow({ children: [cell("", AlignmentType.CENTER, false, 2, false)] }),
          new TableRow({ children: [cell("", AlignmentType.CENTER, false, 2, false)] }),
          new TableRow({ children: [cell(String(projectDetails.eeTitle || "Executive Engineer"), AlignmentType.CENTER, true, 2, false)] }),
          new TableRow({ children: [cell(String(projectDetails.eeOffice || ""), AlignmentType.CENTER, false, 2, false)] }),
        ] }),
      ] }],
    });
    saveAs(await Packer.toBlob(doc), "Justification_Front_Sheet_" + (projectId || "Estimate") + ".docx");
  };

  const exportToExcelLegacy = () => {
    const xmlCell = (style: string, value: unknown = "", merge = 0) =>
      '<Cell ss:StyleID="' + style + '"' + (merge ? ' ss:MergeAcross="' + merge + '"' : "") + '><Data ss:Type="String">' + escapeXml(value) + "</Data></Cell>";
    const xmlNumberCell = (value: number, isPercent = false) =>
      '<Cell ss:StyleID="' + (isPercent ? "Percent" : "Amount") + '"><Data ss:Type="Number">' + String(isPercent ? Math.round((Number(value) || 0) * 100) / 100 : Math.round(Number(value) || 0)) + "</Data></Cell>";
    const xmlRow = (cells: string[], height = 30) => '<Row ss:Height="' + height + '">' + cells.join("") + "</Row>";
    const gridRow = (item: SummaryRow) => xmlRow([
      xmlCell("GridNumber", item.number), xmlCell(item.emphasis ? "GridBold" : "Grid", item.label, 1),
      xmlCell("Grid", item.prefix || ""),
      item.number === "7." ? xmlCell("GridRight", summaryInputs.lowestContractor)
        : typeof item.value === "number" ? xmlNumberCell(item.value, item.suffix === "%") : xmlCell("GridRight", item.value),
    ], 32);
    const dataRows: string[] = [
      xmlRow([xmlCell("Title", "Justification Statement (Civil work)", 4)], 32),
      xmlRow([xmlCell("Blank"), xmlCell("Blank"), xmlCell("Blank"), xmlCell("Blank"), xmlCell("Blank")], 10),
      xmlRow([xmlCell("TopLabel", "N.I.T. No.:-", 1), xmlCell("TopValue", summaryInputs.nitNumber, 2)]),
      xmlRow([xmlCell("TopLabel", "Name of Work :-", 1), xmlCell("TopValue", fullWorkName || "—", 2)]),
      xmlRow([xmlCell("Section", "With Respect to Lowest Tender", 4)]),
    ];
    rows.slice(0, 5).forEach(item => dataRows.push(gridRow(item)));
    dataRows.push(xmlRow([xmlCell("Formula", "                  Pro-rata calculation: " + formatMoney(estimatedPutToTender) + " × " + formatMoney(correspondingJustifiedAmount) + " ÷ " + formatMoney(estimatedCostConsidered) + " = Rs. " + formatMoney(proRataJustifiedAmount), 4)], 32));
    rows.slice(5).forEach(item => dataRows.push(gridRow(item)));
    dataRows.push(xmlRow([xmlCell("Blank", "", 4)], 18));
    for (let i = 0; i < 4; i++) dataRows.push(xmlRow([xmlCell("Blank"), xmlCell("Blank"), xmlCell("Blank"), xmlCell("Blank"), xmlCell("Blank")], 18));
    dataRows.push(xmlRow([xmlCell("Blank", "", 4)], 18));
    dataRows.push(xmlRow([xmlCell("Signature", projectDetails.leftAETitle || "Assistant Engineer", 1), xmlCell("Signature", projectDetails.rightAETitle || "Assistant Engineer", 2)]));
    dataRows.push(xmlRow([xmlCell("Signature", projectDetails.leftAEOffice || "", 1), xmlCell("Signature", projectDetails.rightAEOffice || "", 2)]));
    dataRows.push(xmlRow([xmlCell("Signature", "", 4)]));
    dataRows.push(xmlRow([xmlCell("Signature", "", 4)]));
    dataRows.push(xmlRow([xmlCell("SignatureBold", projectDetails.eeTitle || "Executive Engineer", 4)]));
    dataRows.push(xmlRow([xmlCell("Signature", projectDetails.eeOffice || "", 4)]));
    const styles = '<Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Book Antiqua" ss:Size="11"/><Interior ss:Color="#C6E4C8" ss:Pattern="Solid"/><Borders/></Style><Style ss:ID="Blank" ss:Parent="Default"><Borders/></Style><Style ss:ID="Title" ss:Parent="Default"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Book Antiqua" ss:Size="14" ss:Bold="1"/><Borders/></Style><Style ss:ID="TopLabel" ss:Parent="Default"><Font ss:FontName="Book Antiqua" ss:Bold="1"/><Borders/></Style><Style ss:ID="TopValue" ss:Parent="Default"><Borders/></Style><Style ss:ID="Section" ss:Parent="Default"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Book Antiqua" ss:Bold="1"/><Borders/></Style><Style ss:ID="Grid" ss:Parent="Default"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style><Style ss:ID="GridBold" ss:Parent="Grid"><Font ss:FontName="Book Antiqua" ss:Bold="1"/></Style><Style ss:ID="GridNumber" ss:Parent="Grid"><Alignment ss:Horizontal="Center"/></Style><Style ss:ID="GridRight" ss:Parent="Grid"><Alignment ss:Horizontal="Right"/></Style><Style ss:ID="Amount" ss:Parent="Grid"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="#,##,##0"/></Style><Style ss:ID="Percent" ss:Parent="Grid"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="0.00&quot;%&quot;"/></Style><Style ss:ID="Formula" ss:Parent="Default"><Alignment ss:Horizontal="Left"/><Font ss:FontName="Book Antiqua" ss:Bold="1"/><Borders/></Style><Style ss:ID="Sign" ss:Parent="Default"><Alignment ss:Horizontal="Center"/><Borders/></Style><Style ss:ID="SignRight" ss:Parent="Sign"><Alignment ss:Horizontal="Right"/></Style><Style ss:ID="SignCenter" ss:Parent="Sign"><Alignment ss:Horizontal="Center"/></Style><Style ss:ID="SignCenterBold" ss:Parent="SignCenter"><Font ss:FontName="Book Antiqua" ss:Bold="1"/></Style></Styles>';
    const excelAmountFormat = currencyFormat === "Exact Value" ? "0" : currencyFormat === "Standard (Millions)" ? "#,##0" : "#,##,##0";
    const currencyStyles = styles.replace('ss:Format="#,##,##0"', 'ss:Format="' + excelAmountFormat + '"');
    const worksheetOptions = '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Header/><Footer/></PageSetup><Print><ValidPrinterInfo/><PaperSizeIndex>9</PaperSizeIndex><HorizontalResolution>600</HorizontalResolution></Print><Zoom>85</Zoom><Selected/><TopRowVisible>0</TopRowVisible><LeftColumnVisible>0</LeftColumnVisible><ShowPageBreakZoom/><PageBreakZoom>85</PageBreakZoom><Panes><Pane><Number>3</Number><ActiveRow>10</ActiveRow><ActiveCol>0</ActiveCol><RangeSelection>R11C1:R11C5</RangeSelection></Pane></Panes><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions>';
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>' + currencyStyles.replace(/^<Styles>|<\/Styles>$/g, "") + '</Styles><Names><NamedRange ss:Name="_xlnm.Print_Area" ss:RefersTo="=Justification!R1C1:R28C5"/></Names><Worksheet ss:Name="Justification"><Table><Column ss:Width="44"/><Column ss:Width="35"/><Column ss:Width="272"/><Column ss:Width="24"/><Column ss:Width="225"/>' + dataRows.join("") + '</Table>' + worksheetOptions + '</Worksheet></Workbook>';
    saveAs(new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" }), "Justification_Front_Sheet_" + (projectId || "Estimate") + ".xls");
  };

  const exportToExcel = async () => {
    const rowsXml: string[] = [];
    const merges: string[] = [];
    const col = (n: number) => String.fromCharCode(64 + n);
    const cellRef = (r: number, c: number) => `${col(c)}${r}`;
    const cell = (r: number, c: number, value: unknown, style = 0, numeric = false) => {
      if (value === "" || value === null || value === undefined) return `<c r="${cellRef(r, c)}" s="${style}"/>`;
      return numeric
        ? `<c r="${cellRef(r, c)}" s="${style}"><v>${Number(value) || 0}</v></c>`
        : `<c r="${cellRef(r, c)}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    };
    const merged = (r: number, c1: number, c2: number, value: unknown, style = 0) => {
      if (c2 > c1) merges.push(`<mergeCell ref="${cellRef(r, c1)}:${cellRef(r, c2)}"/>`);
      return cell(r, c1, value, style);
    };
    const borderedMergedLabel = (r: number, value: string, bold: boolean) => {
      merges.push(`<mergeCell ref="B${r}:C${r}"/>`);
      return cell(r, 2, value, bold ? 13 : 12) + cell(r, 3, "", 14);
    };
    const row = (r: number, h: number, cells: string[]) => rowsXml.push(`<row r="${r}" ht="${h}" customHeight="1">${cells.join("")}</row>`);
    const wrappedHeight = (value: unknown, width: number, minimum: number) => {
      const text = String(value ?? "");
      const lineCount = text.split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil(line.length / Math.max(1, width * 0.9))), 0);
      return Math.max(minimum, Math.ceil(lineCount * 15 + 8));
    };
    const makeSummaryRow = (r: number, item: SummaryRow) => {
      const emphasized = item.emphasis ? 5 : 4;
      const value = item.number === "7." ? summaryInputs.lowestContractor : item.value;
      const numeric = typeof value === "number";
      const percentage = numeric && item.suffix === "%";
      const height = Math.max(wrappedHeight(item.label, 35 + 26.0909, 30), typeof value === "string" ? wrappedHeight(value, 22.5727, 30) : 30);
      row(r, height, [
        cell(r, 1, item.number, 6), borderedMergedLabel(r, item.label, Boolean(item.emphasis)),
        cell(r, 4, item.prefix || "", emphasized),
        cell(r, 5, percentage ? Number(value) / 100 : value, percentage ? 8 : numeric ? 7 : 6, numeric),
      ]);
    };

    // Header rows preserve the 29-row print layout, with aspect-fit logos in the outer columns.
    const officeTitle = String(projectDetails.eeTitle || "Executive Engineer & Senior Manager (C)-I,").replace(/^Office of the\s+/i, "").trim();
    const officeName = String(projectDetails.eeOffice || "GCD, CPWD, Goa.").trim();
    row(1, 23, [cell(1, 1, ""), merged(1, 2, 4, "GOVERNMENT OF INDIA", 1)]);
    row(2, 23, [cell(2, 1, ""), merged(2, 2, 4, "CENTRAL PUBLIC WORKS DEPARTMENT", 1)]);
    row(3, 23, [cell(3, 1, ""), merged(3, 2, 4, "Office of the " + officeTitle, 11)]);
    row(4, 23, [cell(4, 1, ""), merged(4, 2, 4, officeName, 11)]);
    row(5, 22, [merged(5, 1, 3, "STATE : " + String(projectDetails.state || "GOA"), 2), merged(5, 4, 5, "DIVISION : " + String(projectDetails.division || "GCD"), 3)]);
    row(6, 37, [merged(6, 1, 3, "BRANCH : " + String(projectDetails.branch || "B&R"), 2), merged(6, 4, 5, "SUB DIVISION : " + String(projectDetails.subDivision || "Kolhapur Sub Division"), 3)]);
    row(7, 34, [merged(7, 1, 5, "Justification Statement (Civil work)", 1)]);
    row(8, 8, [1, 2, 3, 4, 5].map(c => cell(8, c, "")));
    row(9, 26, [merged(9, 1, 2, "N.I.T. No.:-", 2), merged(9, 3, 5, summaryInputs.nitNumber, 2)]);
    row(10, wrappedHeight(fullWorkName || "—", 26.0909 + 5.0273 + 22.5727, 30), [merged(10, 1, 2, "Name of Work :-", 2), merged(10, 3, 5, fullWorkName || "—", 2)]);
    row(11, 26, [merged(11, 1, 5, "With Respect to Lowest Tender", 2)]);
    rows.slice(0, 5).forEach((item, i) => makeSummaryRow(12 + i, item));
    row(17, 28, [merged(17, 1, 5, "            Pro-rata calculation: " + formatMoney(estimatedPutToTender) + " × " + formatMoney(correspondingJustifiedAmount) + " ÷ " + formatMoney(estimatedCostConsidered) + " = Rs. " + formatMoney(proRataJustifiedAmount), 9)]);
    rows.slice(5).forEach((item, i) => makeSummaryRow(18 + i, item));
    row(23, 7, [merged(23, 1, 5, "", 10)]);
    row(24, 27, [merged(24, 1, 5, "", 10)]);
    const leftAssistantSignatory = String(projectDetails.leftAETitle || "Assistant Engineer") + "\n" + String(projectDetails.leftAEOffice || "CPWD, Kolhapur.");
    const rightAssistantSignatory = String(projectDetails.rightAETitle || "Assistant Engineer") + "\n" + String(projectDetails.rightAEOffice || "GCD, CPWD, Goa.");
    row(25, Math.max(wrappedHeight(leftAssistantSignatory, 12.0818 + 35, 28), wrappedHeight(rightAssistantSignatory, 26.0909 + 5.0273 + 22.5727, 28)), [merged(25, 1, 2, leftAssistantSignatory, 10), merged(25, 3, 5, rightAssistantSignatory, 10)]);
    row(26, 15, [merged(26, 1, 5, "", 10)]);
    row(27, 18, [merged(27, 1, 5, "", 10)]);
    row(28, 24, [merged(28, 1, 5, String(projectDetails.eeTitle || "Executive Engineer & Senior Manager (C)-I,"), 11)]);
    row(29, 24, [merged(29, 1, 5, officeName, 10)]);

    let cpwdLogo: Uint8Array;
    let goiLogo: Uint8Array;
    try {
      [cpwdLogo, goiLogo] = await Promise.all(["/logos/cpwd-logo.png", "/logos/goi-emblem.png"].map(async path => {
        const response = await fetch(path);
        if (!response.ok) throw new Error("Could not load the default export logo: " + path);
        return new Uint8Array(await response.arrayBuffer());
      }));
    } catch (error) {
      console.warn("Logo assets unavailable; falling back to the text-only legacy workbook export.", error);
      exportToExcelLegacy();
      return;
    }
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="${currencyFormat === "Exact Value" ? "0" : currencyFormat === "Standard (Millions)" ? "#,##0" : "#,##,##0"}"/><numFmt numFmtId="165" formatCode="0.00%"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Book Antiqua"/></font><font><b/><sz val="11"/><name val="Book Antiqua"/></font><font><b/><u/><sz val="16"/><name val="Book Antiqua"/></font><font><b/><sz val="12"/><name val="Book Antiqua"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC6E4C8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="4"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border><border><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="15"><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr/><sheetViews><sheetView view="pageBreakPreview" showGridLines="0" zoomScale="130" zoomScaleNormal="100"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="14.5"/><cols><col min="1" max="1" width="12.0818181818182" customWidth="1"/><col min="2" max="2" width="35" customWidth="1"/><col min="3" max="3" width="26.0909090909091" customWidth="1"/><col min="4" max="4" width="5.02727272727273" customWidth="1"/><col min="5" max="5" width="22.5727272727273" customWidth="1"/></cols><sheetData>${rowsXml.join("")}</sheetData><mergeCells count="${merges.length}">${merges.join("")}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.75" right="0.75" top="0.9" bottom="0.9" header="0.2" footer="0.2"/><pageSetup paperSize="9" scale="83" orientation="portrait" horizontalDpi="600"/><drawing r:id="rId1"/></worksheet>`;
    const cpwdExtent = fitPngWithinBox(cpwdLogo, 853440, 1050000);
    const goiExtent = fitPngWithinBox(goiLogo, 628650, 1050000);
    const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>59690</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>91440</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(cpwdExtent.width)}" cy="${Math.round(cpwdExtent.height)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="CPWD Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor><xdr:oneCellAnchor editAs="oneCell"><xdr:from><xdr:col>4</xdr:col><xdr:colOff>852805</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>114300</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(goiExtent.width)}" cy="${Math.round(goiExtent.height)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Government of India Emblem"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Justification" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Justification'!$A$1:$E$29</definedName></definedNames><calcPr calcId="191029"/></workbook>`;
    const files: Array<{ name: string; data: string | Uint8Array }> = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: styles },
      { name: "xl/worksheets/sheet1.xml", data: worksheet },
      { name: "xl/worksheets/_rels/sheet1.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>` },
      { name: "xl/drawings/drawing1.xml", data: drawing },
      { name: "xl/drawings/_rels/drawing1.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/cpwd-logo.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/goi-emblem.png"/></Relationships>` },
      { name: "xl/media/cpwd-logo.png", data: cpwdLogo }, { name: "xl/media/goi-emblem.png", data: goiLogo },
    ];
    saveAs(createStoredZip(files), "Justification_Front_Sheet_" + (projectId || "Estimate") + ".xlsx");
  };

  useEffect(() => {
    exportWordRef.current = () => void exportToWord();
    exportExcelRef.current = () => {
      void exportJustfnFrontSheetToExcel({
        estimateData: { estimateRows: baseEstimateRows as any[], rates, marketRates: baseMarketRates, projectDetails },
        statementRows: estimateRows as any[],
        justifiedRates: marketRates,
        baseMarketRates,
        summaryInputs,
      }, projectId);
    };
    exportPdfRef.current = () => {
      const printWindow = openEstimatePdfWindow();
      if (!printWindow) { alert("Allow pop-ups to export the PDF."); return; }
      void exportJustfnFrontSheetToPdf({
        estimateData: { estimateRows: baseEstimateRows as any[], rates, marketRates: baseMarketRates, projectDetails },
        statementRows: estimateRows as any[],
        justifiedRates: marketRates,
        baseMarketRates,
        summaryInputs,
      }, projectId, printWindow).catch(error => {
        printWindow.close();
        console.error("Could not export the Justification Front Sheet PDF:", error);
        alert(error instanceof Error ? error.message : "Could not export the Justification Front Sheet PDF.");
      });
    };
  }, [baseEstimateRows, rates, baseMarketRates, projectDetails, estimateRows, marketRates, summaryInputs, projectId]);

  useEffect(() => registerPageTools("justsummary", { exportActions: [
    ...(onExportMasterJustfn ? [{ id: "export-master-justfn", label: "Export Master Justfn", onClick: onExportMasterJustfn, className: "bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow" }] : []),
    { id: "export-justification-pdf", label: "Export PDF", onClick: () => exportPdfRef.current(), className: "bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow" },
  ], searchContainerRef: findContainerRef }), [registerPageTools, onExportMasterJustfn]);

  const cellClass = isDark
    ? "border border-slate-700 px-3 py-2 align-middle text-slate-100 print:border-black print:text-black"
    : "border border-black px-3 py-2 align-middle text-black";
  const editableClass = cellClass + (isDark ? " bg-slate-800 print:bg-white" : " bg-olive-light print:bg-white");
  const inputClass = "w-full border-0 bg-transparent px-2 py-1 outline-none focus:ring-1 " + (isDark ? "text-slate-100 focus:bg-slate-700 focus:ring-blue-500 print:text-black" : "text-black focus:bg-amber-50 focus:ring-amber-500");
  const textInput = (key: keyof JustificationSummaryInputs, label: string, value: string, className = inputClass) =>
    <input aria-label={label} className={className} value={value} onChange={event => updateInput(key, event.target.value)} />;

  return (
    <div ref={findContainerRef} className={"flex-1 overflow-y-auto p-5 " + (isDark ? "bg-slate-950 text-slate-100" : "bg-gray-100 text-gray-900")}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-3 print:hidden">
        <h1 className="text-lg font-extrabold uppercase tracking-wider text-blue-400">Justification Front Sheet / Summary</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {deviationSummary && <span className="mr-2 text-sm font-bold text-slate-200">{deviationSummary}</span>}
          <button type="button" onClick={() => exportWordRef.current()} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-blue-500">Export Word Doc</button>
          <button type="button" onClick={() => exportExcelRef.current()} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500">Export Excel</button>
          <button type="button" onClick={() => exportPdfRef.current()} className="rounded bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-rose-500">Export PDF</button>
        </div>
      </header>
      <div className={"mx-auto max-w-5xl border p-5 shadow-xl print:max-w-none print:border-0 print:bg-white print:p-0 print:text-black print:shadow-none " + (isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-400 bg-olive-card text-black")}>
        <table className={"w-full border-collapse text-sm " + (isDark ? "text-slate-100 print:text-black" : "text-black")}>
          <colgroup><col className="w-1/4"/><col className="w-3/4"/></colgroup>
          <thead><tr><th colSpan={2} className={cellClass + " py-3 text-center text-lg font-bold " + (isDark ? "bg-slate-800" : "bg-olive-card")}>Justification Statement (Civil work)</th></tr></thead>
          <tbody>
            <tr><th className={cellClass + " text-left font-bold"}>N.I.T. No.:-</th><td className={editableClass}>{textInput("nitNumber", "N.I.T. Number", summaryInputs.nitNumber)}</td></tr>
            <tr><th className={cellClass + " text-left align-top font-bold"}>Name of Work :-</th><td className={cellClass + " whitespace-pre-line text-justify"}>{fullWorkName || "—"}</td></tr>
          </tbody>
        </table>
        <table className={"w-full border-collapse text-sm " + (isDark ? "text-slate-100 print:text-black" : "text-black")}>
          <colgroup><col className="w-[7%]"/><col className="w-[57%]"/><col className="w-[9%]"/><col className="w-[27%]"/></colgroup>
          <tbody>
            <tr><th colSpan={4} className={cellClass + " text-center font-bold " + (isDark ? "bg-slate-800" : "bg-gray-100")}>With Respect to Lowest Tender</th></tr>
            {rows.slice(0, 5).map(row => <tr data-find-row key={row.number} className={row.emphasis ? "font-bold" : ""}>
              <td className={cellClass + " text-right"}>{row.number}</td><td className={cellClass}>{row.label}</td>
              <td className={cellClass + " text-right"}>{row.prefix || ""}</td><td className={cellClass + " text-right font-mono"}>{displayValue(row)}</td>
            </tr>)}
            <tr><td colSpan={4} className={cellClass + " pl-[7%] text-left font-semibold"}>Pro-rata calculation: {formatMoney(estimatedPutToTender)} × {formatMoney(correspondingJustifiedAmount)} ÷ {formatMoney(estimatedCostConsidered)} = Rs. {formatMoney(proRataJustifiedAmount)}</td></tr>
            {rows.slice(5, 6).map(row => <tr data-find-row key={row.number} className={row.emphasis ? "font-bold" : ""}><td className={cellClass + " text-right"}>{row.number}</td><td className={cellClass + (row.emphasis ? " font-bold" : "")}>{row.label}</td><td className={cellClass + " text-right"}>{row.prefix || ""}</td><td className={cellClass + " text-right font-mono" + (row.emphasis ? " font-bold" : "")}>{displayValue(row)}</td></tr>)}
            {rows.slice(6).map(row => <tr data-find-row key={row.number} className={row.emphasis ? "font-bold" : ""}>
              <td className={cellClass + " text-right"}>{row.number}</td><td className={cellClass}>{row.label}</td>
              <td className={cellClass + " text-right"}>{row.prefix || ""}</td><td className={(row.number === "7." ? editableClass : cellClass) + " text-right font-mono"}>
                {row.number === "7." ? textInput("lowestContractor", "First lowest contractor name", summaryInputs.lowestContractor, inputClass + " text-left")
                  : row.number === "8." ? <input aria-label="First lowest contractor tendered amount" className={inputClass + " text-right font-mono"} inputMode="numeric" value={tenderAmountFocused ? summaryInputs.contractorTenderedAmount : formatMoney(tenderedAmount)} onFocus={() => setTenderAmountFocused(true)} onBlur={() => setTenderAmountFocused(false)} onChange={event => updateInput("contractorTenderedAmount", event.target.value.replace(/\D/g, ""))} />
                  : displayValue(row)}
              </td>
            </tr>)}
          </tbody>
        </table>
        <div className="mt-16 grid grid-cols-2 gap-8 text-center text-sm font-semibold sm:px-6">
          <div className="pt-3">{String(projectDetails.leftAETitle || "Assistant Engineer")}<br/>{String(projectDetails.leftAEOffice || "")}</div>
          <div className="pt-3">{String(projectDetails.rightAETitle || "Assistant Engineer")}<br/>{String(projectDetails.rightAEOffice || "")}</div>
          <div className="col-span-2 min-h-6" aria-hidden="true"></div>
          <div className="col-span-2 min-h-6" aria-hidden="true"></div>
          <div className="col-span-2 pt-5">{String(projectDetails.eeTitle || "Executive Engineer")}<br/>{String(projectDetails.eeOffice || "")}</div>
        </div>
      </div>
    </div>
  );
}
