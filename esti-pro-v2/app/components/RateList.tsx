import React, { useEffect, useMemo, useState } from "react";

type RateRow = { code: string; description: string; unit: string; dsrRate: number; carriage: boolean; sl: number };
type RateGroup = { id: string; title: string; items: RateRow[] };

const GROUP_TITLES: Record<string, string> = {
  "0.1": "0.1 BASIC RATES OF MATERIALS (0222–9999 EXCEPT 2200–2358)",
  "0.2": "0.2 BASIC RATES OF LABOUR (0100–0221)",
  "0.3": "0.3 BASIC RATES OF HIRE CHARGES OF PLANTS AND MACHINERY (0001–0099)",
  "0.4": "0.4 BASIC RATES OF CARRIAGE OF MATERIALS (2200–2358)",
};
const GROUP_ORDER = ["0.1", "0.2", "0.3", "0.4"];
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
  if (value >= 222 && value <= 9999 && !(value >= 2200 && value <= 2358)) return "0.1";
  if (value >= 100 && value <= 221) return "0.2";
  if (value >= 1 && value <= 99) return "0.3";
  if (value >= 2200 && value <= 2358) return "0.4";
  return null;
}

function normalizeBasicCode(code: string) {
  return code.trim().replace(/\*+$/, "");
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

export default function RateList({ theme = "dark", marketRates, setMarketRates, estimateRows = [], rates = [], projectId = "", onSaveRates }: any) {
  const [analysisRowsByCode, setAnalysisRowsByCode] = useState<Record<string, Record<string, any>[]>>({});
  const [loading, setLoading] = useState(false);
  const [savingRates, setSavingRates] = useState(false);
  const [groupFilter, setGroupFilter] = useState("All groups");
  const [searchCode, setSearchCode] = useState("");
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ sl: 92, code: 128, description: 520, unit: 100, dsr: 150, market: 180 });
  const [period, setPeriod] = useState("2026-04");
  const [area, setArea] = useState("A");

  const rateByCode = useMemo(() => new Map<string, any>(rates.map((item: any) => [normalizeBasicCode(String(item.code || "")), item])), [rates]);
  const rateGroups = useMemo(() => {
    const rowsByGroup: Record<string, Map<string, RateRow>> = Object.fromEntries(GROUP_ORDER.map(id => [id, new Map<string, RateRow>()]));
    for (const rows of Object.values(analysisRowsByCode)) {
      for (const row of rows) {
        if (["NCR", "SCR", "CALC_SNAPSHOT"].includes(String(row.row_type || "").toUpperCase())) continue;
        const rawCode = rateAnalysisCode(row);
        const code = normalizeBasicCode(rawCode);
        if (!code || isNSCode(code)) continue;
        const group = categoryForCode(code);
        if (!group) continue;
        const basicItem = rateByCode.get(code);
        if (!basicItem) continue;
        const parsedDsrRate = Number(row.rate);
        const dsrRate = Number.isFinite(parsedDsrRate) && parsedDsrRate > 0 ? parsedDsrRate : Number(basicItem.rate) || 0;
        const current: RateRow = {
          code,
          description: basicItem.description,
          unit: String(basicItem.unit ?? "").trim(),
          dsrRate,
          carriage: group === "0.4",
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
  }, [analysisRowsByCode, rateByCode]);
  const visibleGroups = rateGroups
    .filter(group => groupFilter === "All groups" || group.id === groupFilter)
    .map(group => ({ ...group, items: group.items.filter(item => !searchCode.trim() || item.code.toLowerCase().includes(searchCode.trim().toLowerCase())) }));

  useEffect(() => {
    let cancelled = false;
    const loadAnalyses = async () => {
      setLoading(true);
      const queue: string[] = [...new Set<string>(estimateRows.map((item: any) => String(item.itemCode || "").trim()).filter((code: string) => Boolean(code) && !isNSCode(code)))];
      const visited = new Set<string>();
      const result: Record<string, Record<string, any>[]> = {};
      let depth = 0;
      while (queue.length && depth < 8) {
        const batch = queue.splice(0, queue.length).filter(code => !visited.has(code) && !isNSCode(code));
        if (!batch.length) break;
        batch.forEach(code => visited.add(code));
        const fetched = await Promise.all(batch.map(async code => {
          try {
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
          for (const row of rows) {
            if (!isSubAnalysis(row)) continue;
            const childCode = rateAnalysisCode(row);
            if (childCode && !isNSCode(childCode) && !visited.has(childCode)) queue.push(childCode);
          }
        }
        depth++;
      }
      if (!cancelled) { setAnalysisRowsByCode(result); setLoading(false); }
    };
    loadAnalyses();
    return () => { cancelled = true; };
  }, [estimateRows]);

  const handleRateChange = (code: string, value: string, defaultValue: number) => {
    setDraftRates(previous => ({ ...previous, [code]: value }));
    if (value.trim() === "") {
      setMarketRates((previous: Record<string, number>) => ({ ...previous, [code]: 0 }));
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
      const labourItems = rateGroups.find(group => group.id === "0.2")?.items || [];
      const updates: Record<string, number> = {};
      let skipped = 0;
      for (const item of labourItems) {
        if (item.unit.trim().toLowerCase() === "sqm" || ["0162", "0163", "0166"].includes(item.code)) { skipped++; continue; }
        const skillKey = CLC_SKILL_BY_BASE_RATE[item.dsrRate.toFixed(2)];
        const wage = skillKey ? Number(wages[skillKey]) : NaN;
        if (Number.isFinite(wage) && wage >= 0) updates[item.code] = wage;
        else skipped++;
      }
      setMarketRates((previous: Record<string, number>) => ({ ...previous, ...updates }));
      setDraftRates(previous => ({ ...previous, ...Object.fromEntries(Object.entries(updates).map(([code, wage]) => [code, String(wage)])) }));
      const applied = Object.keys(updates).length;
      alert(`CLC import complete for ${data.periodLabel || period}, ${area} Area. ${applied} labour rates applied; ${skipped} items left unchanged.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "CLC rates could not be loaded.");
    }
  };

  const saveProjectRates = async () => {
    for (const [code, value] of Object.entries(draftRates)) {
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
        const defaultRate = item.carriage ? 0 : item.dsrRate;
        const rawRate = marketRates[item.code] !== undefined ? Number(marketRates[item.code]) : defaultRate;
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

  const dark = theme !== "light";
  const card = dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200";
  const inputClass = dark ? "bg-slate-950 border-slate-600 text-slate-100 focus:border-blue-500" : "bg-white border-slate-300 text-slate-900 focus:border-blue-500";
  const visibleItems = visibleGroups.flatMap(group => group.items.map(item => ({ ...item, groupId: group.id })));

  return (
    <div className={`flex-1 min-h-0 flex flex-col p-6 ${dark ? "bg-[#0b1121] text-slate-100" : "bg-slate-50 text-slate-900"}`}>
      <div className="shrink-0 flex flex-wrap justify-between items-center gap-4 mb-4 pb-4 border-b border-slate-700">
        <h2 className="text-xl font-bold text-emerald-400 uppercase tracking-wider">Rate List</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={groupFilter} onChange={event => setGroupFilter(event.target.value)} className={`border rounded px-3 py-2 text-base outline-none ${inputClass}`} aria-label="Filter rate group">
            <option>All groups</option>{GROUP_ORDER.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <input type="search" value={searchCode} onChange={event => setSearchCode(event.target.value)} placeholder="Search item code..." className={`border rounded px-3 py-2 text-base outline-none w-52 ${inputClass}`} />
          <button onClick={saveProjectRates} disabled={savingRates || loading || !projectId} className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50" title={`Save market rates to project ${projectId || "(no active project)"}`}>
            {savingRates ? "Saving…" : "Save Rates"}
          </button>
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap items-end gap-3 mb-4 rounded-lg border border-blue-900/60 bg-blue-950/30 p-4">
        <div><label className="block text-sm font-semibold mb-1">CLC period</label><select value={period} onChange={event => setPeriod(event.target.value)} className={`border rounded px-3 py-2 text-base ${inputClass}`}>{CLC_PERIODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        <div><label className="block text-sm font-semibold mb-1">Area</label><select value={area} onChange={event => setArea(event.target.value)} className={`border rounded px-3 py-2 text-base ${inputClass}`}><option value="A">A Area</option><option value="B">B Area</option><option value="C">C Area</option></select></div>
        <button onClick={applyCLC} disabled={loading} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-bold shadow">Apply CLC Rates</button>
        <p className="text-sm text-slate-400">Labour is matched by DSR base rate; sqm composite labour stays at DSR rate.</p>
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
                <tr className={dark ? "bg-slate-900 text-amber-300" : "bg-slate-200 text-amber-800"}><td colSpan={6} className="sticky left-0 border-y border-slate-700 px-4 py-2 text-sm font-bold">{group.title}</td></tr>
                {group.items.length ? group.items.map(item => {
                  const defaultRate = item.carriage ? 0 : item.dsrRate;
                  const marketRate = marketRates[item.code] !== undefined ? marketRates[item.code] : defaultRate;
                  return <tr key={item.code} className={dark ? "border-b border-slate-800 hover:bg-slate-800/70" : "border-b border-slate-200 hover:bg-slate-100"}>
                    <td className="p-3 text-center font-bold">{item.sl}</td><td className="p-3 font-mono font-bold text-blue-400">{item.code}</td><td className="p-3 leading-relaxed">{item.description}</td><td className="p-3 text-center text-slate-400">{item.unit}</td><td className="p-3 text-right font-mono font-bold">{item.dsrRate.toFixed(2)}</td>
                    <td className="p-2"><input type="text" inputMode="decimal" value={draftRates[item.code] ?? String(marketRate)} onChange={event => handleRateChange(item.code, event.target.value, defaultRate)} aria-label={`Market rate for ${item.code}`} className={`w-full border rounded px-3 py-2 text-right font-mono font-bold outline-none focus:ring-1 focus:ring-blue-500 ${inputClass}`} /></td>
                  </tr>;
                }) : <tr><td colSpan={6} className="p-5 text-center text-slate-500 italic">No analysed items in this group.</td></tr>}
              </React.Fragment>)}
              {visibleItems.length === 0 && <tr><td colSpan={6} className="p-5 text-center text-slate-500 italic">No items match the current filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
