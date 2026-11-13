"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AlignmentType, BorderStyle, Document, Footer, HeightRule, ImageRun, PageNumber, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { saveAs } from "file-saver";
import type { HistoryEstimateSummary } from "../utils/historyEstimateSummary";
import type { ProjectDocumentSettings } from "../utils/projectDocumentSettings";
import { DEFAULT_HISTORY_NOTE_TEXT } from "../utils/historySheetDefaults";
import { fitPngWithinBox } from "../utils/pngSizing";

type EstimateType = "PE_CUM_DE" | "DE";
type SubmissionPurpose = "AA_ES" | "CLIENT" | "HIGHER_AUTH" | "TS";

export type HistorySheetData = {
  isDraft: boolean;
  estimateType: EstimateType;
  submissionPurpose: SubmissionPurpose;
  framedBy: string;
  scrutinizedBy: string;
  clientRequisitionRef: string;
  siteInspectionDate: string;
  specifications: string;
  historyNarrative: string;
  designScopeNarrative: string;
  majorHead: string;
  minorHead: string;
  detailedHead: string;
  includeNote: boolean;
  noteText: string;
  goiLogoDataUrl: string;
  cpwdLogoDataUrl: string;
  methodOfExecution: string;
  toolsAndPlant: string;
  landAvailability: string;
};

const DEFAULT_HISTORY_SHEET: HistorySheetData = {
  isDraft: true,
  estimateType: "PE_CUM_DE",
  submissionPurpose: "AA_ES",
  framedBy: "Assistant Engineer Civil, Kolhapur Sub-division, CPWD, Kolhapur",
  scrutinizedBy: "Executive Engineer and Senior Manager (C)-I, CPWD, Bambolim, Goa",
  clientRequisitionRef: "",
  siteInspectionDate: "",
  specifications: "CPWD specification 2019 vol. I & II with up to date correction slip",
  historyNarrative: "",
  designScopeNarrative: "",
  majorHead: "",
  minorHead: "",
  detailedHead: "",
  includeNote: true,
  noteText: DEFAULT_HISTORY_NOTE_TEXT,
  goiLogoDataUrl: "",
  cpwdLogoDataUrl: "",
  methodOfExecution: "By contract after call of tender",
  toolsAndPlant: "To be arranged by the contractor",
  landAvailability: "Available",
};

const formatAmount = (value: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(value))}`;

const ONES_AND_TEENS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const INDIAN_GROUPS = ["", "Thousand", "Lakh", "Crore", "Arab", "Kharab", "Neel", "Padma", "Shankh"];

function numberBelowOneThousandToWords(value: number): string {
  const parts: string[] = [];
  let remainder = value;

  if (remainder >= 100) {
    parts.push(`${ONES_AND_TEENS[Math.floor(remainder / 100)]} Hundred`);
    remainder %= 100;
  }
  if (remainder >= 20) {
    parts.push(TENS[Math.floor(remainder / 10)]);
    remainder %= 10;
  }
  if (remainder > 0) parts.push(ONES_AND_TEENS[remainder]);

  return parts.join(" ");
}

function numberToIndianWords(value: number): string {
  if (!Number.isFinite(value)) return "Zero";

  let remaining = Math.trunc(Math.abs(value));
  if (remaining === 0) return "Zero";

  const parts: string[] = [];
  let groupIndex = 0;
  while (remaining > 0) {
    const divisor = groupIndex === 0 ? 1000 : 100;
    const groupValue = remaining % divisor;
    remaining = Math.floor(remaining / divisor);
    if (groupValue > 0) {
      const groupName = INDIAN_GROUPS[groupIndex] ?? `10 to the power ${groupIndex * 2 + 1}`;
      parts.unshift(`${numberBelowOneThousandToWords(groupValue)}${groupName ? ` ${groupName}` : ""}`);
    }
    groupIndex += 1;
  }

  return `${value < 0 ? "Minus " : ""}${parts.join(" ")}`;
}

function numberToTimeWords(value: number | null): string {
  return value === null ? "Not specified" : numberToIndianWords(value);
}

function joinWithAnd(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const textInputClass = "w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500 print:border-slate-400 print:bg-white print:text-black";
const labelClass = "mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400 print:text-slate-700";
const LOGO_LIBRARY_STORAGE_KEY = "esti-pro-history-logo-library-v1";
type SavedLogo = { name: string; dataUrl: string };

// Keep Word and browser-PDF page geometry in sync with the approved History Sheet.
const HISTORY_PAGE = {
  topTwips: 1134, rightTwips: 850, bottomTwips: 1134, leftTwips: 1417,
  topMm: 20, rightMm: 15, bottomMm: 20, leftMm: 25,
  headRowTwips: 480, headRowCm: 0.85,
} as const;

async function imageRun(dataUrl: string, fallbackUrl: string, width: number, height: number) {
  let bytes: Uint8Array<ArrayBuffer>;
  if (dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  if (!base64) throw new Error("The selected logo image is invalid.");
  const binary = window.atob(base64);
    bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  } else {
    const response = await fetch(fallbackUrl);
    if (!response.ok) throw new Error(`Could not load the default logo: ${fallbackUrl}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const size = fitPngWithinBox(bytes, width, height);
  return new ImageRun({ type: "png", data: bytes, transformation: size });
}

export default function HistorySheet({
  projectId,
  projectDetails,
}: {
  projectId: string;
  projectDetails: ProjectDocumentSettings & { timeLimitMonths?: string };
}) {
  const exportRootRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<HistorySheetData>(DEFAULT_HISTORY_SHEET);
  const [estimateSummary, setEstimateSummary] = useState<HistoryEstimateSummary | null>(null);
  const [hasSavedSheet, setHasSavedSheet] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [logoLibrary, setLogoLibrary] = useState<SavedLogo[]>([]);
  const loading = Boolean(projectId) && loadedProjectId !== projectId;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedLogos = JSON.parse(localStorage.getItem(LOGO_LIBRARY_STORAGE_KEY) || "[]");
        if (Array.isArray(savedLogos)) {
          setLogoLibrary(savedLogos.filter((logo): logo is SavedLogo => Boolean(logo && typeof logo.name === "string" && typeof logo.dataUrl === "string")));
        }
      } catch (loadError) {
        console.warn("Could not load saved History Sheet logos", loadError);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) return () => { cancelled = true; };

    fetch(`/api/history-sheet?projectId=${encodeURIComponent(projectId)}`)
      .then(async response => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Could not load the History Sheet.");
        return result;
      })
      .then(result => {
        if (cancelled) return;
        setError("");
        setNotice("");
        setEstimateSummary(result.estimateSummary ?? null);
        const saved = result.historySheet;
        setHasSavedSheet(Boolean(saved));
        if (saved) {
          const savedHistorySheet = {
            ...saved,
            scrutinizedBy: String(saved.scrutinizedBy || DEFAULT_HISTORY_SHEET.scrutinizedBy).replace(/^Office of the\s+/i, ""),
            noteText: saved.noteText === undefined || saved.noteText === null ? DEFAULT_HISTORY_NOTE_TEXT : String(saved.noteText),
          };
          setForm({
            ...DEFAULT_HISTORY_SHEET,
            ...savedHistorySheet,
            siteInspectionDate: saved.siteInspectionDate || "",
          });
        } else {
          setForm(DEFAULT_HISTORY_SHEET);
        }
        setLoadedProjectId(projectId);
      })
      .catch(loadError => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the History Sheet.");
          setLoadedProjectId(projectId);
        }
      });

    return () => { cancelled = true; };
  }, [projectId]);

  // Notice the trailing comma <K extends keyof HistorySheetData,> which prevents TSX parsing errors
  const updateField = <K extends keyof HistorySheetData,>(field: K, value: HistorySheetData[K]) => {
    setForm(current => ({ ...current, [field]: value }));
    setNotice("");
  };

  const uploadLogo = async (field: "goiLogoDataUrl" | "cpwdLogoDataUrl", file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for the logo.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Logo files must be smaller than 5 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not process that image.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const dataUrl = canvas.toDataURL("image/png");
      updateField(field, dataUrl);
      const nextLibrary = [...logoLibrary.filter(logo => logo.dataUrl !== dataUrl), { name: file.name, dataUrl }];
      setLogoLibrary(nextLibrary);
      try {
        localStorage.setItem(LOGO_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
      } catch {
        setNotice("Logo selected for this estimate; browser storage is full, so it was not added to the reusable logo list.");
      }
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not load that logo image.");
    }
  };

  const save = async () => {
    if (!projectId || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/history-sheet", {
        method: hasSavedSheet ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, historySheet: form }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save the History Sheet.");
      setHasSavedSheet(true);
      if (result.estimateSummary) setEstimateSummary(result.estimateSummary);
      setNotice("History Sheet saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the History Sheet.");
    } finally {
      setSaving(false);
    }
  };

  const exportToWord = async () => {
    const noBorders = {
      top: { style: BorderStyle.NONE, size: 0, color: "auto" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
      left: { style: BorderStyle.NONE, size: 0, color: "auto" },
      right: { style: BorderStyle.NONE, size: 0, color: "auto" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
    };
    const noCellBorders = {
      top: { style: BorderStyle.NONE, size: 0, color: "auto" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
      left: { style: BorderStyle.NONE, size: 0, color: "auto" },
      right: { style: BorderStyle.NONE, size: 0, color: "auto" },
      start: { style: BorderStyle.NONE, size: 0, color: "auto" },
      end: { style: BorderStyle.NONE, size: 0, color: "auto" },
    };
    const headBorders = {
      top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    };

    const typeString = form.estimateType === "PE_CUM_DE" ? "Preliminary Estimate cum Detailed Estimate" : "Detailed Estimate";
    const draftPrefix = form.isDraft ? "Draft " : "";
    const probableCost = estimateSummary?.probableCost ?? 0;
    const surchargeItems = [
      (estimateSummary?.contingencyRate ?? 0) > 0 ? `${estimateSummary?.contingencyRate}% contingencies` : "",
      (estimateSummary?.epfRate ?? 0) > 0 ? `EPF Charges @ ${estimateSummary?.epfRate}%` : "",
      (estimateSummary?.esiRate ?? 0) > 0 ? `ESI Charges @ ${estimateSummary?.esiRate}%` : "",
      (estimateSummary?.departmentalChargesRate ?? 0) > 0
        ? `Departmental Charges at reduced rate of @ ${estimateSummary?.departmentalChargesRate}%`
        : "",
    ].filter(Boolean);
    const surchargeSentence = surchargeItems.length ? ` including ${joinWithAnd(surchargeItems)}` : "";
    const amountWithWords = `${formatAmount(probableCost)}/- (Rupees ${numberToIndianWords(probableCost)} Only)`;
    const timeLimitMonths = estimateSummary?.timeLimitMonths ?? null;
    const officeTitle = String(projectDetails.eeTitle || "Executive Engineer & Senior Manager (C)-I,")
      .replace(/^Office of the\s+/i, "")
      .trim();
    const officeName = String(projectDetails.eeOffice || "").trim();
    const rateLocation = String(projectDetails.subDivision || "")
      .replace(/\bsub[- ]?division\b.*$/i, "")
      .trim();
    const cpwdLogo = await imageRun(form.cpwdLogoDataUrl, "/logos/cpwd-logo.png", 68, 80);
    const goiLogo = await imageRun(form.goiLogoDataUrl, "/logos/goi-emblem.png", 50, 85);
    const narrativeParagraphs = form.historyNarrative.split(/\r?\n/).map(text => new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text, size: 24 })],
      indent: { firstLine: 720 },
      spacing: { after: 120 },
    }));
    const designScopeParagraphs = form.designScopeNarrative.split(/\r?\n/).map(text => new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text, size: 24 })],
      spacing: { after: 120 },
    }));
    const noteParagraphs = form.includeNote ? form.noteText.split(/\r?\n/).map(text => new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text, size: 22 })],
      indent: { firstLine: 720 },
      spacing: { after: 100 },
    })) : [];
    const dsrYear = String(estimateSummary?.dsrYear || "2023").replace(/^D\.?S\.?R\.?\s*[-:]?\s*/i, "").trim();
    const costIndexValue = Number(estimateSummary?.costIndex) || 0;
    const approvedCostIndex = Math.round(100 + costIndexValue);
    const rateDescription = `D.S.R.-${dsrYear}${costIndexValue > 0 ? ` duly enhanced by the approved Cost Index of ${approvedCostIndex}${rateLocation ? ` for ${rateLocation}` : ""}` : ""} & Market rates for Non-scheduled items.`;

    const doc = new Document({
      styles: { default: { document: { run: { font: "Book Antiqua" } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: HISTORY_PAGE.topTwips, right: HISTORY_PAGE.rightTwips, bottom: HISTORY_PAGE.bottomTwips, left: HISTORY_PAGE.leftTwips, header: 425, footer: 425 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun("Page "),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                  new TextRun(" of "),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorders,
            rows: [
              new TableRow({
                children: [
                  new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, borders: noCellBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: cpwdLogo ? [cpwdLogo] : [] })] }),
                  new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, borders: noCellBorders, children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "GOVERNMENT OF INDIA", bold: true, size: 28 })], spacing: { after: 100 } }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "CENTRAL PUBLIC WORKS DEPARTMENT", bold: true, size: 24 })], spacing: { after: 100 } }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Office of the ${officeTitle}`, bold: true, size: 22 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: officeName, bold: true, size: 22 })] }),
                  ] }),
                  new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, borders: noCellBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: goiLogo ? [goiLogo] : [] })] }),
                ],
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorders,
            rows: [
              new TableRow({
                children: [
                  new TableCell({ borders: noCellBorders, children: [new Paragraph({ children: [new TextRun({ text: `STATE : ${projectDetails.state}`, bold: true, size: 22 })] })] }),
                  new TableCell({ borders: noCellBorders, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `DIVISION : ${projectDetails.division}`, bold: true, size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ borders: noCellBorders, children: [new Paragraph({ children: [new TextRun({ text: `BRANCH : ${projectDetails.branch}`, bold: true, size: 22 })] })] }),
                  new TableCell({ borders: noCellBorders, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `SUB DIVISION : ${projectDetails.subDivision}`, bold: true, size: 22 })] })] }),
                ],
              }),
            ],
          }),
          new Paragraph({
            children: [new TextRun({ text: `ESTIMATE NO: ${estimateSummary?.estimateId || projectId}`, bold: true, size: 24 })],
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Name of work: ", bold: true, size: 24 }),
              new TextRun({ text: estimateSummary?.nameOfWork || "—", size: 24 })
            ],
            spacing: { after: 220 }
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "SH: ", bold: true, size: 24 }),
              new TextRun({ text: estimateSummary?.subHeads || "—", size: 24 })
            ],
            spacing: { after: 300 }
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: headBorders,
            rows: [
              new TableRow({ height: { value: HISTORY_PAGE.headRowTwips, rule: HeightRule.ATLEAST }, children: [
                new TableCell({ width: { size: 33, type: WidthType.PERCENTAGE }, borders: headBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Major Head", bold: true, size: 22 })] })] }),
                new TableCell({ width: { size: 34, type: WidthType.PERCENTAGE }, borders: headBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Minor Head", bold: true, size: 22 })] })] }),
                new TableCell({ width: { size: 33, type: WidthType.PERCENTAGE }, borders: headBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Detailed Head", bold: true, size: 22 })] })] }),
              ] }),
              new TableRow({ height: { value: HISTORY_PAGE.headRowTwips, rule: HeightRule.ATLEAST }, children: [
                new TableCell({ width: { size: 33, type: WidthType.PERCENTAGE }, borders: headBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: form.majorHead, size: 22 })] })] }),
                new TableCell({ width: { size: 34, type: WidthType.PERCENTAGE }, borders: headBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: form.minorHead, size: 22 })] })] }),
                new TableCell({ width: { size: 33, type: WidthType.PERCENTAGE }, borders: headBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: form.detailedHead, size: 22 })] })] }),
              ] }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            children: [
              new TextRun({
                text: `This ${draftPrefix}${typeString} has been framed by ${form.framedBy} and further scrutinized in the Office of the ${officeTitle}${officeName ? ` ${officeName}` : ""}, at a probable cost of ${amountWithWords} (Civil work)${surchargeSentence}.`,
                size: 24,
              })
            ],
            indent: { firstLine: 720 },
            spacing: { after: 300 }
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "REPORT", bold: true, underline: {}, size: 24 })],
            spacing: { after: 100 },
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: "History:", bold: true, underline: {}, size: 24 })],
            spacing: { after: 100 }
          }),
          ...narrativeParagraphs,
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: "Design & Scope:", bold: true, underline: {}, size: 24 })],
            spacing: { before: 200, after: 100 }
          }),
          ...designScopeParagraphs,
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: `Specification: `, bold: true, underline: {}, size: 24 }), new TextRun({ text: form.specifications, size: 24 })],
            spacing: { after: 220 }
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({ text: "Cost: ", bold: true, underline: {}, size: 24 }),
              new TextRun({ text: `${amountWithWords} (Civil work)${surchargeSentence}.`, size: 24 }),
            ],
            spacing: { after: 220 }
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: `Rate (Civil): `, bold: true, underline: {}, size: 24 }), new TextRun({ text: rateDescription, size: 24 })],
            spacing: { after: 220 }
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: `Method: `, bold: true, underline: {}, size: 24 }), new TextRun({ text: form.methodOfExecution, size: 24 })],
            spacing: { after: 220 }
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({ text: "Time Limit: ", bold: true, underline: {}, size: 24 }),
              new TextRun({
                text: timeLimitMonths === null
                  ? "Not specified for execution."
                  : `${timeLimitMonths} (${numberToTimeWords(timeLimitMonths)}) months for execution.`,
                size: 24,
              }),
            ],
            spacing: { after: 220 }
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: `Tools & plant: `, bold: true, underline: {}, size: 24 }), new TextRun({ text: form.toolsAndPlant, size: 24 })],
            spacing: { after: 220 }
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: `Land: `, bold: true, underline: {}, size: 24 }), new TextRun({ text: form.landAvailability, size: 24 })],
            spacing: { after: 220 }
          }),
          ...(form.includeNote ? [new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: "Note:", bold: true, underline: {}, size: 24 })],
            spacing: { after: 100 }
          }), ...noteParagraphs] : []),
          new Paragraph({ text: "", spacing: { after: 800 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorders,
            rows: [
              new TableRow({
                children: [
                  new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noCellBorders, children: [new Paragraph({ children: [new TextRun({ text: projectDetails.leftAETitle, bold: true, size: 22 })] })] }),
                  new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noCellBorders, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: projectDetails.rightAETitle, bold: true, size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ borders: noCellBorders, children: [new Paragraph({ children: [new TextRun({ text: projectDetails.leftAEOffice, bold: true, size: 22 })] })] }),
                  new TableCell({ borders: noCellBorders, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: projectDetails.rightAEOffice, bold: true, size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [new TableCell({ columnSpan: 2, borders: noCellBorders, children: [new Paragraph({ text: "", spacing: { after: 180 } })] })],
              }),
              new TableRow({
                children: [new TableCell({ columnSpan: 2, borders: noCellBorders, children: [new Paragraph({ text: "", spacing: { after: 180 } })] })],
              }),
              new TableRow({
                children: [new TableCell({ columnSpan: 2, borders: noCellBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: projectDetails.eeTitle, bold: true, size: 22 })] })] })],
              }),
              new TableRow({
                children: [new TableCell({ columnSpan: 2, borders: noCellBorders, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: projectDetails.eeOffice, bold: true, size: 22 })] })] })],
              }),
            ],
          })
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `History_Sheet_${projectId || 'Draft'}.docx`);
  };

  const exportToPdf = () => {
    const printWindow = window.open("", "_blank", "width=1000,height=800");
    if (!printWindow) throw new Error("The PDF print window was blocked. Allow pop-ups and try again.");
    const escapeHtml = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
    const paragraphs = (value: string) => value.split(/\r?\n/).map(line => `<p>${escapeHtml(line) || "&nbsp;"}</p>`).join("");
    const typeString = form.estimateType === "PE_CUM_DE" ? "Preliminary Estimate cum Detailed Estimate" : "Detailed Estimate";
    const probableCost = estimateSummary?.probableCost ?? 0;
    const surchargeItems = [
      (estimateSummary?.contingencyRate ?? 0) > 0 ? `${estimateSummary?.contingencyRate}% contingencies` : "",
      (estimateSummary?.epfRate ?? 0) > 0 ? `EPF Charges @ ${estimateSummary?.epfRate}%` : "",
      (estimateSummary?.esiRate ?? 0) > 0 ? `ESI Charges @ ${estimateSummary?.esiRate}%` : "",
      (estimateSummary?.departmentalChargesRate ?? 0) > 0 ? `Departmental Charges at reduced rate of @ ${estimateSummary?.departmentalChargesRate}%` : "",
    ].filter(Boolean);
    const surchargeSentence = surchargeItems.length ? ` including ${joinWithAnd(surchargeItems)}` : "";
    const amountWithWords = `${formatAmount(probableCost)}/- (Rupees ${numberToIndianWords(probableCost)} Only)`;
    const officeTitle = String(projectDetails.eeTitle || "Executive Engineer & Senior Manager (C)-I,").replace(/^Office of the\s+/i, "").trim();
    const officeName = String(projectDetails.eeOffice || "").trim();
    const dsrYear = String(estimateSummary?.dsrYear || "2023").replace(/^D\.?S\.?R\.?\s*[-:]?\s*/i, "").trim();
    const costIndexValue = Number(estimateSummary?.costIndex) || 0;
    const approvedCostIndex = Math.round(100 + costIndexValue);
    const rateLocation = String(projectDetails.subDivision || "").replace(/\bsub[- ]?division\b.*$/i, "").trim();
    const rateDescription = `D.S.R.-${dsrYear}${costIndexValue > 0 ? ` duly enhanced by the approved Cost Index of ${approvedCostIndex}${rateLocation ? ` for ${rateLocation}` : ""}` : ""} & Market rates for Non-scheduled items.`;
    const cpwdLogo = escapeHtml(form.cpwdLogoDataUrl || "/logos/cpwd-logo.png");
    const goiLogo = escapeHtml(form.goiLogoDataUrl || "/logos/goi-emblem.png");
    const timeLimit = estimateSummary?.timeLimitMonths == null
      ? "Not specified for execution."
      : `${estimateSummary.timeLimitMonths} (${numberToTimeWords(estimateSummary.timeLimitMonths)}) months for execution.`;
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>History Sheet</title><style>
      @page{size:A4 portrait;margin:${HISTORY_PAGE.topMm}mm ${HISTORY_PAGE.rightMm}mm ${HISTORY_PAGE.bottomMm}mm ${HISTORY_PAGE.leftMm}mm;@bottom-center{content:"Page " counter(page) " of " counter(pages);font:9pt "Book Antiqua",serif}@bottom-right{content:"EST ID: ${escapeHtml(estimateSummary?.estimateId || projectId || "N/A")}";font:9pt "Book Antiqua",serif}}
      *{box-sizing:border-box}body{margin:0;color:#111;font:11pt "Book Antiqua",serif;line-height:1.35}.masthead{display:grid;grid-template-columns:15% 70% 15%;align-items:center;text-align:center;min-height:27mm}.masthead .logo{display:flex;align-items:center;justify-content:center;height:25mm}.masthead img{display:block;max-width:18mm;max-height:23mm;width:auto;height:auto;object-fit:contain}.masthead>div:nth-child(2){text-align:center}.masthead h1,.masthead p{text-align:center;margin-left:0;margin-right:0}.masthead h1{font-size:14pt;margin-top:3px;margin-bottom:3px}.masthead p{margin-top:2px;margin-bottom:2px;font-weight:bold}.office{display:flex;justify-content:space-between;margin-top:14px;font-weight:bold}.meta{margin:12px 0}.meta p{margin:6px 0}.heads{width:100%;table-layout:fixed;border-collapse:collapse;margin:10px 0}.heads th,.heads td{border:1px solid #111;padding:2mm 2mm;height:${HISTORY_PAGE.headRowCm}cm;vertical-align:middle;text-align:center}.heads th{width:33.333%;font-weight:bold}h2{text-align:center;font-size:13pt;margin:16px 0 8px}h3{font-size:11pt;text-decoration:underline;margin:12px 0 5px}p{margin:6px 0;text-align:justify}.indent{text-indent:28px}.signatories{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin-top:34px;font-weight:bold}.signatories .center{grid-column:1/3;text-align:center}.small{font-size:10pt}
      </style></head><body>
      <div class="masthead"><div class="logo"><img src="${cpwdLogo}"></div><div><h1>GOVERNMENT OF INDIA</h1><p>CENTRAL PUBLIC WORKS DEPARTMENT</p><p>Office of the ${escapeHtml(officeTitle)}</p><p>${escapeHtml(officeName)}</p></div><div class="logo"><img src="${goiLogo}"></div></div>
      <div class="office"><span>STATE : ${escapeHtml(projectDetails.state)}</span><span>DIVISION : ${escapeHtml(projectDetails.division)}</span></div><div class="office"><span>BRANCH : ${escapeHtml(projectDetails.branch)}</span><span>SUB DIVISION : ${escapeHtml(projectDetails.subDivision)}</span></div>
      <div class="meta"><p><b>ESTIMATE NO:</b> ${escapeHtml(estimateSummary?.estimateId || projectId)}</p><p><b>Name of work:</b> ${escapeHtml(estimateSummary?.nameOfWork || "—")}</p><p><b>SH:</b> ${escapeHtml(estimateSummary?.subHeads || "—")}</p></div>
      <table class="heads"><tr><th>Major Head</th><th>Minor Head</th><th>Detailed Head</th></tr><tr><td>${escapeHtml(form.majorHead)}</td><td>${escapeHtml(form.minorHead)}</td><td>${escapeHtml(form.detailedHead)}</td></tr></table>
      <p class="indent">This ${form.isDraft ? "Draft " : ""}${escapeHtml(typeString)} has been framed by ${escapeHtml(form.framedBy)} and further scrutinized in the Office of the ${escapeHtml(officeTitle)} ${escapeHtml(officeName)}, at a probable cost of ${escapeHtml(amountWithWords)} (Civil work)${escapeHtml(surchargeSentence)}.</p>
      <h2>REPORT</h2><h3>History:</h3>${paragraphs(form.historyNarrative)}<h3>Design &amp; Scope:</h3>${paragraphs(form.designScopeNarrative)}
      <p><b><u>Specification:</u></b> ${escapeHtml(form.specifications)}</p><p><b><u>Cost:</u></b> ${escapeHtml(amountWithWords)} (Civil work)${escapeHtml(surchargeSentence)}.</p>
      <p><b><u>Rate (Civil):</u></b> ${escapeHtml(rateDescription)}</p><p><b><u>Method:</u></b> ${escapeHtml(form.methodOfExecution)}</p><p><b><u>Time Limit:</u></b> ${escapeHtml(timeLimit)}</p><p><b><u>Tools &amp; plant:</u></b> ${escapeHtml(form.toolsAndPlant)}</p><p><b><u>Land:</u></b> ${escapeHtml(form.landAvailability)}</p>
      ${form.includeNote ? `<h3>Note:</h3>${paragraphs(form.noteText)}` : ""}
      <div class="signatories"><span>${escapeHtml(projectDetails.leftAETitle)}</span><span style="text-align:right">${escapeHtml(projectDetails.rightAETitle)}</span><span>${escapeHtml(projectDetails.leftAEOffice)}</span><span style="text-align:right">${escapeHtml(projectDetails.rightAEOffice)}</span><span class="center">${escapeHtml(projectDetails.eeTitle)}</span><span class="center">${escapeHtml(projectDetails.eeOffice)}</span></div>
      <script>window.addEventListener('load',()=>{window.focus();setTimeout(()=>window.print(),300)});window.addEventListener('afterprint',()=>window.close());</script></body></html>`);
    printWindow.document.close();
  };

  const summaryValue = (amount: number) => formatAmount(amount);

  return (
    <div ref={exportRootRef} className="flex-1 overflow-auto bg-[#0b1121] px-4 py-5 text-slate-100 print:bg-white print:px-0 print:py-0 print:text-black">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-3 print:mb-3 print:border-slate-400">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400 print:text-slate-700">
              Estimate {projectId || "—"}
            </p>
            <h1 className="mt-1 text-xl font-extrabold tracking-wide text-white print:text-black">HISTORY SHEET</h1>
          </div>
          <div className="flex items-center gap-3 print:hidden">
            {notice && <span className="text-sm font-semibold text-emerald-400">{notice}</span>}
            <button type="button" onClick={() => void save()} disabled={loading || saving || !projectId} className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Saving…" : hasSavedSheet ? "Update History Sheet" : "Save History Sheet"}
            </button>
            <button type="button" onClick={exportToWord} className="rounded border border-slate-600 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800">
              Export Word Doc
            </button>
            <button type="button" onClick={exportToPdf} className="rounded bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-500">
              Export to PDF
            </button>
          </div>
        </header>

        {!projectId && <div role="alert" className="mb-4 rounded border border-rose-700 bg-rose-950/60 px-4 py-3 text-sm text-rose-200 print:hidden">Create or load an estimate before opening its History Sheet.</div>}
        {error && !loading && <div role="alert" className="mb-4 rounded border border-rose-700 bg-rose-950/60 px-4 py-3 text-sm text-rose-200 print:hidden">{error}</div>}
        {loading && <p className="mb-4 text-sm text-slate-400 print:hidden">Loading estimate and History Sheet…</p>}

        <section className="mb-5 rounded-lg border border-slate-700 bg-slate-900/70 p-4 print:break-inside-avoid print:border-slate-400 print:bg-white">
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-amber-400 print:text-black">Estimate particulars (read-only)</h2>
          {estimateSummary ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryItem label="Name of Work" value={estimateSummary.nameOfWork || "—"} wide />
              <SummaryItem label="Name of Work & Sub-heads" value={estimateSummary.subHeads || "—"} wide />
              <SummaryItem label="Probable Cost (Total Estimate Amount)" value={summaryValue(estimateSummary.probableCost)} />
              <SummaryItem label="Base Estimate Total" value={summaryValue(estimateSummary.baseEstimateTotal)} />
              {estimateSummary.contingencyRate > 0 && <SummaryItem label={`Contingencies (${estimateSummary.contingencyRate}%)`} value={summaryValue(estimateSummary.contingencyAmount)} />}
              {estimateSummary.epfRate > 0 && <SummaryItem label={`EPF Charges (${estimateSummary.epfRate}%)`} value={summaryValue(estimateSummary.epfAmount)} />}
              {estimateSummary.esiRate > 0 && <SummaryItem label={`ESI Charges (${estimateSummary.esiRate}%)`} value={summaryValue(estimateSummary.esiAmount)} />}
              {estimateSummary.departmentalChargesName && estimateSummary.departmentalChargesRate > 0 && <SummaryItem
                label={`${estimateSummary.departmentalChargesName} (${estimateSummary.departmentalChargesRate}%)`}
                value={summaryValue(estimateSummary.departmentalChargesAmount)}
              />}
            </div>
          ) : (
            <p className="text-sm text-slate-400 print:text-slate-700">Estimate summary is not available yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-900/70 p-4 print:border-slate-400 print:bg-white">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 pb-3 print:border-slate-400">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-blue-300 print:text-black">History Sheet Content</h2>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-200 print:text-black">
              <input type="checkbox" checked={form.isDraft} onChange={event => updateField("isDraft", event.target.checked)} />
              Draft prefix
            </label>
          </div>

          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <fieldset>
              <legend className={labelClass}>Estimate Type</legend>
              <div className="space-y-2">
                {([
                  ["PE_CUM_DE", "Preliminary Estimate cum Detailed Estimate (PE cum DE)"],
                  ["DE", "Detailed Estimate (DE)"],
                ] as const).map(([value, label]) => (
                  <label key={value} className="flex items-start gap-2 text-sm text-slate-200 print:text-black">
                    <input type="radio" name="estimateType" value={value} checked={form.estimateType === value} onChange={() => updateField("estimateType", value)} className="mt-1" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className={labelClass}>Submission Purpose</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["AA_ES", "Submitting for A/A & E/S"],
                  ["CLIENT", "Submitting to Client Department"],
                  ["HIGHER_AUTH", "Submitting to Higher Authority (>1 Cr)"],
                  ["TS", "Put up for TS"],
                ] as const).map(([value, label]) => (
                  <label key={value} className="flex items-start gap-2 text-sm text-slate-200 print:text-black">
                    <input type="radio" name="submissionPurpose" value={value} checked={form.submissionPurpose === value} onChange={() => updateField("submissionPurpose", value)} className="mt-1" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <LogoControl label="Government of India Emblem" value={form.goiLogoDataUrl} defaultSrc="/logos/goi-emblem.png" library={logoLibrary} onUpload={file => void uploadLogo("goiLogoDataUrl", file)} onSelect={value => updateField("goiLogoDataUrl", value)} onClear={() => updateField("goiLogoDataUrl", "")} />
            <LogoControl label="CPWD Logo" value={form.cpwdLogoDataUrl} defaultSrc="/logos/cpwd-logo.png" library={logoLibrary} onUpload={file => void uploadLogo("cpwdLogoDataUrl", file)} onSelect={value => updateField("cpwdLogoDataUrl", value)} onClear={() => updateField("cpwdLogoDataUrl", "")} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Framed By">
              <input className={textInputClass} value={form.framedBy} onChange={event => updateField("framedBy", event.target.value)} />
            </Field>
            <Field label="Client Requisition Reference">
              <input className={textInputClass} value={form.clientRequisitionRef} onChange={event => updateField("clientRequisitionRef", event.target.value)} placeholder="Letter number, email, or MoM reference" />
            </Field>
            <Field label="Site Inspection Date">
              <input type="date" className={textInputClass} value={form.siteInspectionDate} onChange={event => updateField("siteInspectionDate", event.target.value)} />
            </Field>
            <Field label="Specifications">
              <input className={textInputClass} value={form.specifications} onChange={event => updateField("specifications", event.target.value)} />
            </Field>
            <Field label="Method of Execution">
              <input className={textInputClass} value={form.methodOfExecution} onChange={event => updateField("methodOfExecution", event.target.value)} />
            </Field>
            <Field label="Tools & Plant">
              <input className={textInputClass} value={form.toolsAndPlant} onChange={event => updateField("toolsAndPlant", event.target.value)} />
            </Field>
            <Field label="Land Availability">
              <input className={textInputClass} value={form.landAvailability} onChange={event => updateField("landAvailability", event.target.value)} />
            </Field>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Field label="Major Head">
              <input className={textInputClass} value={form.majorHead} onChange={event => updateField("majorHead", event.target.value)} placeholder="Enter Major Head" />
            </Field>
            <Field label="Minor Head">
              <input className={textInputClass} value={form.minorHead} onChange={event => updateField("minorHead", event.target.value)} placeholder="Enter Minor Head" />
            </Field>
            <Field label="Detailed Head" className="lg:col-span-2">
              <input className={textInputClass} value={form.detailedHead} onChange={event => updateField("detailedHead", event.target.value)} placeholder="Enter Detailed Head" />
            </Field>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Field label="History">
              <textarea rows={9} className={`${textInputClass} resize-y`} value={form.historyNarrative} onChange={event => updateField("historyNarrative", event.target.value)} placeholder="Describe the background, previous work, and relevant correspondence." />
            </Field>
            <Field label="Design & Scope">
              <textarea rows={9} className={`${textInputClass} resize-y`} value={form.designScopeNarrative} onChange={event => updateField("designScopeNarrative", event.target.value)} placeholder="Describe the design basis, scope, and provisions in this estimate." />
            </Field>
          </div>

          <section className="mt-5 rounded border border-slate-700 p-4 print:hidden">
            <div className="mb-3 flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <input type="checkbox" checked={form.includeNote} onChange={event => updateField("includeNote", event.target.checked)} />
                Include Note in exported History Sheet
              </label>
              <span className="text-xs text-slate-500">The note is editable and scrollable.</span>
            </div>
            <Field label="Note">
              <textarea
                rows={12}
                disabled={!form.includeNote}
                className={`${textInputClass} max-h-80 min-h-48 overflow-y-auto resize-y disabled:opacity-50`}
                value={form.noteText}
                onChange={event => updateField("noteText", event.target.value)}
                placeholder="Enter the notes to include in the exported document."
              />
            </Field>
          </section>

        </section>
      </div>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={`block ${className}`}><span className={labelClass}>{label}</span>{children}</label>;
}

function LogoControl({ label, value, defaultSrc, library, onUpload, onSelect, onClear }: {
  label: string;
  value: string;
  defaultSrc: string;
  library: SavedLogo[];
  onUpload: (file?: File) => void;
  onSelect: (value: string) => void;
  onClear: () => void;
}) {
  const selectedInLibrary = library.some(logo => logo.dataUrl === value);
  return (
    <div className="rounded border border-slate-700 bg-slate-950/50 p-3 print:hidden">
      <span className={labelClass}>{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept="image/*" onChange={event => { onUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} className="min-w-0 flex-1 text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:font-bold file:text-white" />
        <select aria-label={`Choose saved ${label}`} value={value} onChange={event => onSelect(event.target.value)} className="min-w-40 rounded border border-slate-600 bg-slate-900 px-2 py-2 text-xs text-slate-100">
          <option value="">Use default logo</option>
          {value && !selectedInLibrary && <option value={value}>Current estimate logo</option>}
          {library.map((logo, index) => <option key={`${logo.name}-${index}`} value={logo.dataUrl}>{logo.name}</option>)}
        </select>
        {value && <button type="button" onClick={onClear} className="rounded border border-slate-600 px-2 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800">Clear</button>}
      </div>
      <p className="mt-1 text-xs text-slate-500">{value ? "Custom logo selected." : "Bundled default logo selected."} Upload or choose a saved image to replace it.</p>
      <Image src={value || defaultSrc} alt={`${label} preview`} width={192} height={96} unoptimized className="mt-3 max-h-20 max-w-48 rounded bg-white p-2 object-contain" />
    </div>
  );
}

function SummaryItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded border border-slate-700 bg-slate-950/60 px-3 py-2 print:border-slate-300 print:bg-white ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 print:text-slate-600">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-100 print:text-black">{value}</div>
    </div>
  );
}
