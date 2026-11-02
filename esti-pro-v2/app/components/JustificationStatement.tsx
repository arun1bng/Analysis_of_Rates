import React, { useEffect, useRef } from "react";
import { buildHierarchicalRows, type HierarchicalRow } from "../utils/dsrHierarchy";
import { calculateAbstractTotals } from "../utils/abstractTotals";
import { usePageTools } from "./PageToolsContext";
import { exportTableToExcel } from "../utils/exportTableToExcel";

type Props = {
  estimateRows?: any[];
  baseEstimateRows?: any[];
  rates?: any[];
  theme?: string;
  marketRates?: Record<string, number>;
  baseMarketRates?: Record<string, number | string | null | undefined>;
  projectDetails?: Record<string, any>;
  setJustificationPercentage?: (value: number) => void;
  onNavigateToRate?: (tab: "radsr" | "ramarket", code: string) => void;
};

const roundWhole = (value: number) => Math.round(value);
const formatAmount = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(roundWhole(value));
const isNS = (code: string) => /^(?:NSR|51\.)/i.test(code);

export default function JustificationStatement({
  estimateRows = [], baseEstimateRows = estimateRows, rates = [], theme = "dark", marketRates = {}, baseMarketRates = marketRates, projectDetails = {}, setJustificationPercentage, onNavigateToRate,
}: Props) {
  const { registerPageTools } = usePageTools();
  const findContainerRef = useRef<HTMLDivElement>(null);
  const isDark = theme !== "light";
  const borderClass = isDark ? "border-slate-700/70" : "border-gray-300";
  const headClass = isDark ? "bg-slate-900 text-slate-300" : "bg-slate-100 text-gray-800";
  const containerClass = theme === "custom" ? "bg-indigo-950 text-indigo-100" : isDark ? "bg-slate-900 text-slate-200" : "bg-white text-gray-900";

  // Aggregate repeated BOQ/measurement lines first; the shared helper then inserts SH and parent rows.
  const aggregated = new Map<string, any>();
  estimateRows.filter((row: any) => row?.itemCode && !row.isSubtotal && !row.isSubhead && String(row.type || "").toLowerCase() !== "sh").forEach((row: any) => {
    const code = String(row.itemCode).trim();
    const existing = aggregated.get(code);
    if (existing) existing.quantity += Number(row.quantity) || 0;
    else {
      const base = rates.find((rate: any) => String(rate.code).trim() === code);
      aggregated.set(code, { ...row, itemCode: code, description: base?.description ?? row.description ?? "", unit: row.unit ?? base?.unit ?? "", quantity: Number(row.quantity) || 0, rate: Number(row.rate) || 0 });
    }
  });

  const hierarchy = buildHierarchicalRows([...aggregated.values()], rates);
  let scheduleEstimateTotal = 0;
  let dsrEstimateTotal = 0;
  let nsEstimateTotal = 0;
  let totalJustified = 0;

  const rows = hierarchy.map((row: HierarchicalRow) => {
    if (!row.isItem) return { ...row, estimateRate: 0, justifiedRate: 0, estimateAmount: 0, justifiedAmount: 0 };
    const source = row.sourceRow || row;
    const estimateRate = Number(source.rate ?? source.estimateRate) || 0;
    const quantity = Number(source.quantity) || 0;
    const code = String(row.itemCode);
    const justifiedRate = isNS(code) ? estimateRate : marketRates[code] !== undefined ? Number(marketRates[code]) || 0 : estimateRate;
    const estimateAmount = roundWhole(quantity * estimateRate);
    const justifiedAmount = roundWhole(quantity * justifiedRate);

    if (isNS(code)) nsEstimateTotal += estimateAmount;
    else {
      scheduleEstimateTotal += estimateAmount;
      if (!/^50(?:\.|$)/.test(code)) dsrEstimateTotal += estimateAmount;
    }
    totalJustified += justifiedAmount;
    return { ...row, quantity, unit: source.unit ?? row.unit ?? "", estimateRate, justifiedRate, estimateAmount, justifiedAmount };
  });

  const costIndex = Number(projectDetails.costIndex ?? 15) || 0;
  const factorValue = Number(projectDetails.gstModificationFactor ?? 0.973);
  const multiplier = Number.isFinite(factorValue) ? factorValue : 0.973;
  const costIndexAmount = roundWhole(dsrEstimateTotal * costIndex / 100);
  const scheduleWithCostIndex = scheduleEstimateTotal + costIndexAmount;
  const modifiedScheduleCost = roundWhole(scheduleWithCostIndex * multiplier);
  const totalECPT = modifiedScheduleCost + nsEstimateTotal;
  const baseEstimateTotal = calculateAbstractTotals(baseEstimateRows, projectDetails, baseMarketRates).baseCombined;
  const extrapolatedOverallJustifiedAmount = totalECPT > 0
    ? roundWhole((baseEstimateTotal / totalECPT) * totalJustified)
    : 0;
  const percentage = baseEstimateTotal === 0
    ? 0
    : ((extrapolatedOverallJustifiedAmount - baseEstimateTotal) / baseEstimateTotal) * 100;
  const absPercent = Math.abs(percentage).toFixed(2);
  const verdict = percentage < 0
    ? `Justification is -${absPercent}% below the Estimated Cost`
    : percentage > 0
      ? `Justification is ${absPercent}% above the Estimated Cost`
      : "Justification is at par with the Estimated Cost";

  useEffect(() => { setJustificationPercentage?.(percentage); }, [percentage, setJustificationPercentage]);

  const exportToCSV = () => {
    const headers = ["Sl. No.", "Item Code", "Description of Items", "Unit", "Quantity", "Estimate Rate (₹)", "Estimate Amount (₹)", "Justified Rate (₹)", "Justified Amount (₹)"];
    const data = rows.map((row: any) => [row.serialNo, row.itemCode, row.description, row.isItem ? row.unit : "", row.isItem ? Number(row.quantity).toFixed(2) : "", row.isItem ? Number(row.estimateRate).toFixed(2) : "", row.isItem ? formatAmount(row.estimateAmount) : "", row.isItem ? Number(row.justifiedRate).toFixed(2) : "", row.isItem ? formatAmount(row.justifiedAmount) : ""].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[headers.join(","), ...data].join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Justification_Statement.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const exportToCSVRef = useRef(exportToCSV);
  useEffect(() => {
    exportToCSVRef.current = exportToCSV;
  });

  useEffect(() => registerPageTools("juststatement", {
    searchContainerRef: findContainerRef,
    exportActions: [{
      id: "export-justification-xlsx",
      label: "Export Excel",
      onClick: () => exportTableToExcel(findContainerRef.current, "Justification Statement", "Justification_Statement"),
      className: "bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded text-sm font-bold shadow",
    }, {
      id: "export-justification-csv",
      label: "Export CSV",
      onClick: () => exportToCSVRef.current(),
      className: "bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded text-sm font-bold shadow",
    }],
  }), [registerPageTools]);

  const summaryClass = isDark ? "bg-slate-950/70" : "bg-gray-50";
  const labelClass = `p-3 text-right font-semibold border-r ${borderClass}`;
  const summaryRow = (key: string, label: string, estimate: number | null, justified: number | null, strong = false) => (
    <tr key={key} className={`${summaryClass} ${strong ? "font-bold" : ""}`}>
      <td colSpan={6} className={labelClass}>{label}</td>
      <td className={`p-3 text-right font-mono font-bold border-r ${borderClass}`}>{estimate === null ? "" : `₹${formatAmount(estimate)}`}</td>
      <td className={`p-3 border-r ${borderClass}`} />
      <td className="p-3 text-right font-mono font-bold text-rose-500">{justified === null ? "" : `₹${formatAmount(justified)}`}</td>
    </tr>
  );

  return (
    <div ref={findContainerRef} className={`flex-1 overflow-y-auto px-6 pb-6 pt-0 ${containerClass}`}>
      <h1 className={`border-b ${borderClass} p-3 text-left text-lg font-bold uppercase tracking-widest ${isDark ? "bg-slate-900 text-blue-400" : "bg-slate-100 text-blue-600"}`}>
        Justification Statement
      </h1>
      <div className={`border rounded-lg shadow-sm ${borderClass} ${isDark ? "bg-[#0b1121]" : "bg-white"}`}>
        <table className="w-full text-left text-sm border-collapse">
          <thead className={`sticky top-0 z-10 shadow-md ${headClass}`}>
            <tr className={`border-b-4 ${isDark ? "border-slate-600" : "border-gray-400"}`}>
              <th className={`p-3 text-center w-24 border-r ${borderClass} ${headClass}`}>Sl. No.</th><th className={`p-3 w-32 border-r ${borderClass} ${headClass}`}>Item Code</th><th className={`p-3 border-r ${borderClass} ${headClass}`}>Description of Items</th>
              <th className={`p-3 text-center w-20 border-r ${borderClass} ${headClass}`}>Unit</th><th className={`p-3 text-right w-28 border-r ${borderClass} ${headClass}`}>Quantity</th><th className={`p-3 text-right w-32 border-r ${borderClass} ${headClass}`}>Estimate Rate (₹)</th>
              <th className={`p-3 text-right w-36 border-r ${borderClass} ${headClass}`}>Estimate Amount (₹)</th><th className={`p-3 text-right w-32 border-r ${borderClass} ${headClass}`}>Justified Rate (₹)</th><th className={`p-3 text-right w-36 ${headClass}`}>Justified Amount (₹)</th>
          </tr></thead>
          <tbody className={isDark ? "bg-slate-900" : "bg-white"}>
            {rows.length ? rows.map((row: any) => (
              <tr data-find-row key={row.rowKey} className={`border-b ${borderClass} ${row.isSubhead ? (isDark ? "bg-slate-800 font-bold" : "bg-gray-100 font-bold") : isDark ? "hover:bg-slate-800/60" : "hover:bg-gray-50"}`}>
                <td className={`p-3 text-center align-top font-semibold border-r ${borderClass}`}>{row.serialNo}</td><td className={`p-3 text-center align-top font-mono font-semibold text-blue-400 border-r ${borderClass}`}>{row.itemCode}</td>
                <td className={`p-3 align-top text-justify leading-relaxed border-r ${borderClass} ${row.isItem ? "" : "font-semibold"}`}>{row.description}</td>
                {row.isItem ? <>
                  <td className={`p-3 text-center align-top border-r ${borderClass}`}>{row.unit}</td><td className={`p-3 text-right align-top border-r ${borderClass}`}>{Number(row.quantity).toFixed(2)}</td>
                  <td className={`p-3 text-right align-top border-r ${borderClass}`}><button type="button" onClick={() => onNavigateToRate?.("radsr", String(row.itemCode))} className="text-blue-400 underline decoration-dotted underline-offset-2 hover:text-blue-300">{Number(row.estimateRate).toFixed(2)}</button></td><td className={`p-3 text-right align-top font-semibold border-r ${borderClass}`}>₹{formatAmount(row.estimateAmount)}</td>
                  <td className={`p-3 text-right align-top text-rose-500 border-r ${borderClass}`}><button type="button" onClick={() => onNavigateToRate?.("ramarket", String(row.itemCode))} className="underline decoration-dotted underline-offset-2 hover:text-rose-300">{Number(row.justifiedRate).toFixed(2)}</button></td><td className="p-3 text-right align-top font-bold text-rose-500">₹{formatAmount(row.justifiedAmount)}</td>
                </> : <><td className={`p-3 border-r ${borderClass}`} /><td className={`p-3 border-r ${borderClass}`} /><td className={`p-3 border-r ${borderClass}`} /><td className={`p-3 border-r ${borderClass}`} /><td className={`p-3 border-r ${borderClass}`} /><td className="p-3" /></>}
              </tr>
            )) : <tr><td colSpan={9} className="p-10 text-center opacity-60">No items in BOQ. Add items from the Database Explorer.</td></tr>}
            {rows.length > 0 && <>
              {summaryRow("dsr", "Total of DSR / Schedule items", scheduleEstimateTotal, null, true)}
              {summaryRow("ci", `Add Cost Index @ ${costIndex}% on DSR items`, costIndexAmount, null)}
              {summaryRow("subtotal", `Subtotal of DSR and mDSR items enhanced by Cost Index ${costIndex}%`, scheduleWithCostIndex, null)}
              {summaryRow("multiplier", `Modified estimated cost after applying multiplier factor ${multiplier} on DSR and mDSR items`, modifiedScheduleCost, null)}
              {summaryRow("ns", "Total of Non-Scheduled items", nsEstimateTotal, null)}
              {summaryRow("ecpt", "Estimated Cost put to Tender [ECPT]", totalECPT, null, true)}
              {summaryRow("justified", "Total Justified Amount of all items", null, totalJustified, true)}
              <tr className={summaryClass}><td colSpan={9} className={`p-3 text-right font-semibold border-t ${borderClass}`}>Overall Justified Amount = ( {formatAmount(baseEstimateTotal)} / {formatAmount(totalECPT)} ) X {formatAmount(totalJustified)} = {formatAmount(extrapolatedOverallJustifiedAmount)}</td></tr>
              <tr className={summaryClass}><td colSpan={9} className={`p-3 text-right font-semibold border-t ${borderClass}`}>Justified Percentage = (( {formatAmount(extrapolatedOverallJustifiedAmount)} - {formatAmount(baseEstimateTotal)} ) / {formatAmount(baseEstimateTotal)} ) X 100</td></tr>
              <tr className={isDark ? "bg-slate-900 text-blue-400" : "bg-gray-100 text-blue-700"}><td colSpan={9} className={`p-3 text-right text-lg font-bold border-t-2 ${borderClass}`}>{verdict}</td></tr>
            </>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
