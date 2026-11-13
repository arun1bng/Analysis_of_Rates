import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePageTools } from "./PageToolsContext";
import { exportRateListSingleSheetToExcel, exportRateListSingleSheetToPdf } from "../utils/exportJustfnToExcel";
import { openEstimatePdfWindow } from "../utils/exportTableToExcel";

type RateRow = { code: string; description: string; unit: string; dsrRate: number; carriage: boolean; sl: number };
type RateGroup = { id: string; title: string; items: RateRow[] };

const GROUP_TITLES: Record<string, string> = {
  materials: "Materials",
  labour: "Labour",
  machinery: "Hire charges of plants and machinery",
  carriage: "Carriage of materials",
};
const GROUP_ORDER = ["materials", "labour", "machinery", "carriage"];
const CLC_SKILL_BY_BASE_RATE: Record<string, string> = {
  "736.00": "unskilled",
  "816.00": "semiSkilled",
  "857.00": "skilledAverage",
  "897.00": "skilled",
  "973.00": "highlySkilled",
};
const CLC_PERIODS = (() => {
  const periods: Array<{ value: string; label: string }> = [];
  let year = 2023;
  let month = 4;
  while (year < 2026 || (year === 2026 && month <= 10)) {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    if (year === 2026 && month === 10) {
      periods.push({ value, label: "w.e.f. October 2026" });
      break;
    }
    const endMonth = month === 4 ? "September" : "March";
    const endYear = month === 4 ? year : year + 1;
    const startMonth = month === 4 ? "April" : "October";
    periods.push({ value, label: `w.e.f. ${startMonth} ${year} to ${endMonth} ${endYear}` });
    if (month === 4) month = 10;
    else { month = 4; year++; }
  }
  return periods;
})();

function categoryForCode(code: string) {
  if (!/^\d+$/.test(code)) return null;
  const value = Number(code);
  if (value >= 222 && value <= 9999 && !(value >= 2200 && value <= 2358)) return "materials";
  if (value >= 100 && value <= 221) return "labour";
  if (value >= 1 && value <= 99) return "machinery";
  if (value >= 2200 && value <= 2358) return "carriage";
  return null;
}

function normalizeBasicCode(code: string) {
  const normalized = code.trim().replace(/\*+$/, "");
  return /^\d+$/.test(normalized) ? String(Number(normalized)) : normalized;
}

function lookupCodeValue<T>(values: Record<string, T> | undefined, code: string): T | undefined {
  if (!values) return undefined;
  if (Object.prototype.hasOwnProperty.call(values, code)) {
    const exact = values[code];
    if (exact !== null && exact !== undefined && String(exact).trim() !== "") return exact;
  }
  const normalized = normalizeBasicCode(code);
  return Object.entries(values).find(([key, value]) =>
    normalizeBasicCode(key) === normalized && value !== null && value !== undefined && String(value).trim() !== "",
  )?.[1];
}

function isNSCode(code: string) {
  const normalized = code.trim().toLowerCase();
  return /^51(?:\.|$)/.test(normalized) || normalized.startsWith("nsr") || normalized.startsWith("ns-");
}

function isSubAnalysis(row: Record<string, any>) {
  const marker = row.is_sub_ar ?? row.isSubAR;
  if (marker === true || marker === 1 || marker === "1" || String(marker).toLowerCase() === "true") return true;
  const code = String(row.component_code ?? row.code ?? "").trim();
  return /^\d+(?:\.\d+)+$/.test(code) && row.row_type !== "NCR" && row.row_type !== "SCR";
}

function rateAnalysisCode(row: Record<string, any>) {
  return String(row.component_code ?? row.code ?? "").trim();
}

function sortRateCodes(a: string, b: string) {
  return Number(a) - Number(b) || a.localeCompare(b);
}

export default function RateList({ theme = "dark", marketRates, setMarketRates, estimateRows = [], selectedCodes = [], rates = [], projectId = "", onSaveRates, analysisSnapshot = {}, nsrItems = [], projectDetails = {}, setProjectDetails }: any) {
  const { registerPageTools } = usePageTools();
  const findContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => registerPageTools("ratelist", { searchContainerRef: findContainerRef }), [registerPageTools]);
  const [analysisRowsByCode, setAnalysisRowsByCode] = useState<Record<string, Record<string, any>[]>>({});
  const [loading, setLoading] = useState(false);
  const [savingRates, setSavingRates] = useState(false);
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ sl: 92, code: 128, description: 520, unit: 100, dsr: 150, market: 180 });
  const [period, setPeriod] = useState(String(projectDetails?.clcPeriod || "2026-10"));
  const [area, setArea] = useState(String(projectDetails?.clcArea || "B"));
  useEffect(() => {
    if (projectDetails?.clcPeriod) setPeriod(String(projectDetails.clcPeriod));
    if (projectDetails?.clcArea) setArea(String(projectDetails.clcArea));
  }, [projectDetails?.clcPeriod, projectDetails?.clcArea]);
  const editableRateCodeSet = useMemo(() => {
    const editableCodes = new Set((selectedCodes as string[])
      .map(normalizeBasicCode)
      .filter(code => Boolean(categoryForCode(code))));
    const visited = new Set<string>();
    const queue = (selectedCodes as string[]).map(code => String(code).trim()).filter(Boolean);
    while (queue.length) {
      const parentCode = queue.shift()!;
      if (visited.has(parentCode)) continue;
      visited.add(parentCode);
      for (const row of analysisRowsByCode[parentCode] || analysisRowsByCode[normalizeBasicCode(parentCode)] || []) {
        const code = normalizeBasicCode(rateAnalysisCode(row));
        if (!code) continue;
        if (categoryForCode(code)) editableCodes.add(code);
        if (isSubAnalysis(row) && !visited.has(code)) queue.push(code);
      }
    }
    return editableCodes;
  }, [selectedCodes, analysisRowsByCode]);

  const rateByCode = useMemo(() => new Map<string, any>(rates.map((item: any) => [normalizeBasicCode(String(item.code || "")), item])), [rates]);
  const rateGroups = useMemo(() => {
    const rowsByGroup: Record<string, Map<string, RateRow>> = Object.fromEntries(GROUP_ORDER.map(id => [id, new Map<string, RateRow>()]));
    for (const rows of Object.values(analysisRowsByCode)) {
      for (const row of rows) {
        if (["NCR", "SCR", "CALC_SNAPSHOT"].includes(String(row.row_type || "").toUpperCase())) continue;
        const rawCode = rateAnalysisCode(row);
        const code = normalizeBasicCode(rawCode);
        if (!code) continue;
        const group = categoryForCode(code);
        if (!group || !editableRateCodeSet.has(code)) continue;
        const basicItem = rateByCode.get(code);
        const parsedDsrRate = Number(row.rate);
        const parsedBasicRate = Number(basicItem?.rate);
        // Rate List's DSR column must stay tied to the master basic-rate row.
        // Analysis rows may already contain a market-adjusted rate.
        const dsrRate = Number.isFinite(parsedBasicRate)
          ? parsedBasicRate
          : Number.isFinite(parsedDsrRate) ? parsedDsrRate : 0;
        const current: RateRow = {
          code: String(basicItem?.code ?? rawCode).trim(),
          description: String(basicItem?.description ?? row.description ?? "").trim(),
          unit: String(basicItem?.unit ?? row.unit ?? "").trim(),
          dsrRate,
          carriage: group === "carriage",
          sl: 0,
        };
        const previous = rowsByGroup[group].get(code);
        if (!previous || (!previous.dsrRate && current.dsrRate)) rowsByGroup[group].set(code, current);
      }
    }
    return GROUP_ORDER.map(id => ({
      id,
      title: GROUP_TITLES[id],
      items: [...rowsByGroup[id].values()]
        .sort((a, b) => sortRateCodes(a.code, b.code))
        .map((item, index) => ({ ...item, sl: index + 1 })),
    })) as RateGroup[];
  }, [analysisRowsByCode, rateByCode, editableRateCodeSet]);
  const visibleGroups = rateGroups;

  useEffect(() => {
    let cancelled = false;
    const loadAnalyses = async () => {
      setLoading(true);
      const queue: string[] = [...new Set<string>((selectedCodes as string[]).map(code => String(code).trim()).filter(Boolean))];
      const visited = new Set<string>();
      const result: Record<string, Record<string, any>[]> = {};
      let depth = 0;
      while (queue.length && depth < 8) {
        const batch = queue.splice(0, queue.length).filter(code => !visited.has(code));
        if (!batch.length) break;
        batch.forEach(code => visited.add(code));
        const fetched = await Promise.all(batch.map(async code => {
          try {
            const snapshot = analysisSnapshot[code] ?? Object.entries(analysisSnapshot).find(([key]) => normalizeBasicCode(key) === normalizeBasicCode(code))?.[1];
            if (Array.isArray(snapshot)) return [code, snapshot as Record<string, any>[]] as const;
            if (Array.isArray((snapshot as any)?.rows)) return [code, (snapshot as any).rows as Record<string, any>[]] as const;
            const customItem = (nsrItems as any[]).find(item => String(item.code || "").trim() === code);
            if (Array.isArray(customItem?.analysisRows)) return [code, customItem.analysisRows as Record<string, any>[]] as const;
            const response = await fetch(`/api/rate-analysis?code=${encodeURIComponent(code)}`);
            const data = await response.json();
            return [code, response.ok && Array.isArray(data) ? data as Record<string, any>[] : []] as const;
          } catch (error) {
            console.error(`Failed to load Rate List inputs for ${code}`, error);
            return [code, [] as Record<string, any>[]] as const;
          }
        }));
        for (const [code, rows] of fetched) {
          result[code] = rows;
          result[normalizeBasicCode(code)] = rows;
          for (const row of rows) {
            if (!isSubAnalysis(row)) continue;
            const childCode = rateAnalysisCode(row);
            if (childCode && !visited.has(childCode)) queue.push(childCode);
          }
        }
        depth++;
      }
      if (!cancelled) { setAnalysisRowsByCode(result); setLoading(false); }
    };
    if (selectedCodes.length > 0) loadAnalyses();
    else { setAnalysisRowsByCode({}); setLoading(false); }
    return () => { cancelled = true; };
  }, [selectedCodes, analysisSnapshot, nsrItems]);

  const handleRateChange = (code: string, value: string, defaultValue: number) => {
    setDraftRates(previous => ({ ...previous, [code]: value }));
    if (value.trim() === "") {
      setMarketRates((previous: Record<string, number>) => {
        const next = { ...previous };
        delete next[code];
        return next;
      });
      return;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) setMarketRates((previous: Record<string, number>) => ({ ...previous, [code]: parsed }));
    else if (value === ".") setMarketRates((previous: Record<string, number>) => ({ ...previous, [code]: defaultValue }));
  };

  const startColumnResize = (key: string, event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[key];
    const onMove = (moveEvent: PointerEvent) => setColumnWidths(previous => ({ ...previous, [key]: Math.max(72, startWidth + moveEvent.clientX - startX) }));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  };

  const applyCLC = async () => {
    try {
      const response = await fetch(`/api/clc-rates?period=${encodeURIComponent(period)}&area=${encodeURIComponent(area)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "CLC rates could not be loaded.");
      const wages = data.wages || {};
      const labourItems = rateGroups.find(group => group.id === "labour")?.items || [];
      const updates: Record<string, number> = {};
      let skipped = 0;
      for (const item of labourItems) {
        if (!editableRateCodeSet.has(normalizeBasicCode(item.code))) continue;
        if (item.unit.trim().toLowerCase() === "sqm" || ["0162", "0163", "0166"].includes(item.code)) { skipped++; continue; }
        const skillKey = CLC_SKILL_BY_BASE_RATE[item.dsrRate.toFixed(2)];
        const wage = skillKey ? Number(wages[skillKey]) : NaN;
        if (Number.isFinite(wage) && wage >= 0) updates[item.code] = wage;
        else skipped++;
      }
      setMarketRates((previous: Record<string, number>) => ({ ...previous, ...updates }));
      setDraftRates(previous => ({ ...previous, ...Object.fromEntries(Object.entries(updates).map(([code, wage]) => [code, String(wage)])) }));
      const periodLabel = String(data.periodLabel || CLC_PERIODS.find(option => option.value === period)?.label || period);
      setProjectDetails?.((previous: Record<string, any>) => ({
        ...previous,
        clcPeriod: period,
        clcPeriodLabel: periodLabel,
        clcArea: area,
      }));
      const applied = Object.keys(updates).length;
      alert(`CLC import complete for ${data.periodLabel || period}, ${area} Area. ${applied} labour rates applied; ${skipped} items left unchanged.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "CLC rates could not be loaded.");
    }
  };

  const saveProjectRates = async () => {
    for (const [code, value] of Object.entries(draftRates)) {
      if (!editableRateCodeSet.has(normalizeBasicCode(code)) && categoryForCode(normalizeBasicCode(code)) !== "carriage") continue;
      const raw = String(value).trim();
      if (!raw || raw === ".") continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        alert(`Enter a valid non-negative market rate for item ${code} before saving.`);
        return;
      }
    }

    const ratesToSave: Record<string, number> = {};
    for (const group of rateGroups) {
      for (const item of group.items) {
        if (!editableRateCodeSet.has(normalizeBasicCode(item.code)) && !item.carriage) continue;
        const defaultRate = item.dsrRate;
        const currentMarketRate = lookupCodeValue(marketRates, item.code);
        const rawRate = currentMarketRate !== undefined ? Number(currentMarketRate) : item.carriage ? 0 : defaultRate;
        if (!Number.isFinite(rawRate) || rawRate < 0) {
          alert(`Enter a valid non-negative market rate for item ${item.code} before saving.`);
          return;
        }
        ratesToSave[item.code] = rawRate;
      }
    }

    if (!projectId || typeof onSaveRates !== "function") {
      alert("An active project is required before market rates can be saved.");
      return;
    }

    setSavingRates(true);
    try {
      await onSaveRates(ratesToSave);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not save market rates to this project.");
    } finally { setSavingRates(false); }
  };

  const exportExcel = async () => {
    try {
      await exportRateListSingleSheetToExcel({
        estimateData: { estimateRows, rates, marketRates, projectDetails },
        statementRows: estimateRows,
        justifiedRates: {},
        baseMarketRates: marketRates,
        rateListMarketRates: marketRates,
        summaryInputs: { nitNumber: "", lowestContractor: "", contractorTenderedAmount: "" },
        analysisSnapshot,
      }, String(projectDetails?.estimateId || "Estimate"));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not export the Rate List workbook.");
    }
  };

  const exportPdf = async () => {
    const printWindow = openEstimatePdfWindow();
    if (!printWindow) { alert("Allow pop-ups to export the PDF."); return; }
    try {
      await exportRateListSingleSheetToPdf({
        estimateData: { estimateRows, rates, marketRates, projectDetails },
        statementRows: estimateRows,
        justifiedRates: {},
        baseMarketRates: marketRates,
        rateListMarketRates: marketRates,
        summaryInputs: { nitNumber: "", lowestContractor: "", contractorTenderedAmount: "" },
        analysisSnapshot,
      }, String(projectDetails?.estimateId || "Estimate"), printWindow);
    } catch (error) {
      printWindow.close();
      alert(error instanceof Error ? error.message : "Could not export the Rate List PDF.");
    }
  };

  const dark = theme !== "light";
  const card = dark ? "bg-slate-900 border-slate-700" : "bg-olive-card border-slate-200";
  const inputClass = dark ? "bg-slate-950 border-slate-600 text-slate-100 focus:border-blue-500" : "bg-olive-card border-slate-300 text-slate-900 focus:border-blue-500";
  const visibleItems = visibleGroups.flatMap(group => group.items);

  useEffect(() => {
    const carriageCodes = rateGroups.flatMap(group => group.id === "carriage" ? group.items.map(item => item.code) : []);
    if (!carriageCodes.length) return;
    setMarketRates((previous: Record<string, number>) => {
      let changed = false;
      const next = { ...previous };
      for (const code of carriageCodes) {
        if (Number(next[code]) !== 0) {
          next[code] = 0;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
    setDraftRates(previous => {
      let changed = false;
      const next = { ...previous };
      for (const code of carriageCodes) {
        if (next[code] !== "0") {
          next[code] = "0";
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [rateGroups, setMarketRates]);

  return (
    <div ref={findContainerRef} className={`flex-1 min-h-0 flex flex-col p-6 ${dark ? "bg-[#0b1121] text-slate-100" : "bg-slate-50 text-slate-900"}`}>
      <div className="shrink-0 flex flex-wrap justify-between items-center gap-4 mb-4 pb-4 border-b border-slate-700">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold text-emerald-400 uppercase tracking-wider">Rate List</h2>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <span>CLC period</span>
            <select value={period} onChange={event => setPeriod(event.target.value)} className={`border rounded px-3 py-2 text-base ${inputClass}`}>
              {CLC_PERIODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <span>Area</span>
            <select value={area} onChange={event => setArea(event.target.value)} className={`border rounded px-3 py-2 text-base ${inputClass}`}>
              <option value="A">A Area</option><option value="B">B Area</option><option value="C">C Area</option>
            </select>
          </label>
          <button onClick={applyCLC} disabled={loading} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-bold shadow">Apply CLC Rates</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveProjectRates} disabled={savingRates || loading || !projectId || (!editableRateCodeSet.size && !rateGroups.some(group => group.id === "carriage"))} className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50" title={`Save market rates to project ${projectId || "(no active project)"}`}>
            {savingRates ? "Saving…" : "Save Rates"}
          </button>
          <button type="button" onClick={() => void exportExcel()} disabled={loading || !estimateRows.length} className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">Export to Excel</button>
          <button type="button" onClick={() => void exportPdf()} disabled={loading || !estimateRows.length} className="rounded bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50">Export to PDF</button>
        </div>
      </div>

      {loading ? <div className="flex-1 grid place-items-center text-slate-400 text-lg">Loading rate analysis items…</div> : estimateRows.length === 0 ? <div className={`flex-1 grid place-items-center rounded-lg border p-8 text-center text-base ${card}`}>Add DSR or mDSR items to the Measurement Sheet to build the Rate List.</div> : (
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-slate-700 shadow-sm">
          <table className="w-full min-w-[1000px] table-fixed border-collapse text-base">
            <colgroup><col style={{ width: columnWidths.sl }} /><col style={{ width: columnWidths.code }} /><col style={{ width: columnWidths.description }} /><col style={{ width: columnWidths.unit }} /><col style={{ width: columnWidths.dsr }} /><col style={{ width: columnWidths.market }} /></colgroup>
            <thead className={`sticky top-0 z-20 ${dark ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-800"}`}><tr>
              {([["sl", "Sl. No."], ["code", "Code"], ["description", "Description"], ["unit", "Unit"], ["dsr", "DSR Rate (₹)"], ["market", "Market Rate (₹)"]] as const).map(([key, label]) => <th key={key} className="relative border-b border-slate-600 p-3 text-left"><div className="flex items-center justify-between gap-2">{label}<span onPointerDown={event => startColumnResize(key, event)} className="h-6 w-2 shrink-0 cursor-col-resize touch-none border-r-2 border-slate-500 hover:border-blue-400" title="Drag to resize column" /></div></th>)}
            </tr></thead>
            <tbody>
              {visibleGroups.map(group => <React.Fragment key={group.id}>
                <tr className={dark ? "bg-slate-900 text-amber-300" : "bg-slate-200 text-amber-800"}><td colSpan={6} className="sticky left-0 border-y border-slate-700 px-4 py-2 text-base font-bold">{group.title}</td></tr>
                {group.items.length ? group.items.map(item => {
                  const defaultRate = item.dsrRate;
                  const savedMarketRate = lookupCodeValue(marketRates, item.code);
                  const marketRate = savedMarketRate !== undefined ? savedMarketRate : item.carriage ? 0 : defaultRate;
                  const isSelected = editableRateCodeSet.has(normalizeBasicCode(item.code));
                  return <tr data-find-row key={item.code} className={`${dark ? "border-b border-slate-800 hover:bg-slate-800/70" : "border-b border-slate-200 hover:bg-slate-100"} ${isSelected ? "" : "bg-slate-950/30 opacity-50 grayscale"}`}>
                    <td className="p-3 text-center font-bold">{item.sl}</td><td className="p-3 font-mono font-bold text-blue-400">{item.code}</td><td className="p-3 leading-relaxed">{item.description}</td><td className="p-3 text-center text-slate-400">{item.unit}</td><td className="p-3 text-right font-mono font-bold">{item.dsrRate.toFixed(2)}</td>
                    <td className="p-2"><input type="text" inputMode="decimal" value={draftRates[item.code] ?? String(marketRate)} onChange={event => handleRateChange(item.code, event.target.value, defaultRate)} disabled={!isSelected && !item.carriage} aria-label={`Market rate for ${item.code}`} title={item.carriage ? "Carriage rates start at zero and can be edited." : undefined} className={`w-full border rounded px-3 py-2 text-right font-mono font-bold outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 ${inputClass}`} /></td>
                  </tr>;
                }) : <tr><td colSpan={6} className="p-5 text-center text-slate-500 italic">No analysed items in this group.</td></tr>}
              </React.Fragment>)}
              {visibleItems.length === 0 && <tr><td colSpan={6} className="p-5 text-center text-slate-500 italic">No analysed items available.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
