import React, { useEffect, useMemo, useState } from "react";

type AnalysisRow = Record<string, any>;

function getRowCode(row: AnalysisRow) {
  return String(row.component_code ?? row.code ?? "").trim();
}

function getRowMark(row: AnalysisRow) {
  return String(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref ?? "").trim();
}

function isExternalRateItem(item: AnalysisRow | undefined) {
  return item?.isExternalAR === true || Number(item?.is_external_ar) === 1;
}

function isSubAnalysisReference(row: AnalysisRow) {
  const marker = row.is_sub_ar ?? row.isSubAR;
  const explicitlyMarked = marker === true || marker === 1 || marker === "1" || String(marker).toLowerCase() === "true";
  // Saved custom analyses retain the code and mark, while older records may not have is_sub_ar.
  const codeLooksLikeItem = /^\d+(?:\.\d+)+$/.test(getRowCode(row));
  return explicitlyMarked || (codeLooksLikeItem && row.row_type !== "NCR" && row.row_type !== "SCR");
}

function itemFamily(code: unknown) {
  const match = /^(\d+)(?:\.|$)/.exec(String(code || "").trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function analysisContext(code: unknown): "dsr" | "mdsr" | "ns" | "other" {
  const family = itemFamily(code);
  if (family >= 1 && family <= 26) return "dsr";
  if (family === 50) return "mdsr";
  if (family === 51) return "ns";
  return "other";
}

function compareCodes(a: string, b: string) {
  const partsA = a.match(/\d+|[a-zA-Z]+/g) || [];
  const partsB = b.match(/\d+|[a-zA-Z]+/g) || [];
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    if (partsA[i] === undefined) return -1;
    if (partsB[i] === undefined) return 1;
    const numberA = Number(partsA[i]);
    const numberB = Number(partsB[i]);
    if (Number.isFinite(numberA) && Number.isFinite(numberB)) {
      if (numberA !== numberB) return numberA - numberB;
    } else if (partsA[i] !== partsB[i]) {
      return partsA[i].localeCompare(partsB[i]);
    }
  }
  return 0;
}

export function getSerialNumbers(items: AnalysisRow[], rates: AnalysisRow[]) {
  const groups = new Map<string, Set<string>>();
  for (const item of items) {
    const code = String(item.itemCode || "").trim();
    if (!code) continue;
    const group = code.split(".")[0];
    if (!groups.has(group)) groups.set(group, new Set());
    groups.get(group)!.add(code);
  }

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b));
  const serialByCode = new Map<string, string>();
  sortedGroups.forEach(([, codeSet], groupIndex) => {
    const shIndex = groupIndex + 1;
    const counters = Array.from({ length: 16 }, () => 0);
    let currentPath: string[] = [];
    const codes = [...codeSet].sort(compareCodes);

    for (const code of codes) {
      const parts = code.split(".");
      const ancestors: string[] = [];
      let parentCode = "";
      for (const part of parts.slice(0, -1)) {
        parentCode = parentCode ? `${parentCode}.${part}` : part;
        if (rates.some((rate: AnalysisRow) => String(rate.code || "").trim() === parentCode)) ancestors.push(parentCode);
      }

      let divergeIndex = 0;
      while (divergeIndex < ancestors.length && divergeIndex < currentPath.length && ancestors[divergeIndex] === currentPath[divergeIndex]) divergeIndex++;
      const newAncestors = ancestors.slice(divergeIndex);
      newAncestors.forEach((_, offset) => {
        const depth = divergeIndex + offset;
        counters[depth]++;
        for (let i = depth + 1; i < counters.length; i++) counters[i] = 0;
      });
      currentPath = [...ancestors, code];
      const leafDepth = ancestors.length;
      counters[leafDepth]++;
      for (let i = leafDepth + 1; i < counters.length; i++) counters[i] = 0;
      serialByCode.set(code, `${shIndex}${counters.slice(0, leafDepth + 1).map(value => `.${value}`).join("")}`);
    }
  });
  return serialByCode;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateMarketAnalysis(
  code: string,
  analyses: Record<string, AnalysisRow[]>,
  marketRates: Record<string, number>,
  rates: AnalysisRow[],
  cache: Map<string, { rows: AnalysisRow[]; unitRate: number }>,
  activeCodes = new Set<string>()
): { rows: AnalysisRow[]; unitRate: number } {
  if (cache.has(code)) return cache.get(code)!;
  const sourceRows = analyses[code] || [];
  if (activeCodes.has(code)) return { rows: sourceRows, unitRate: 0 };
  const nextActive = new Set(activeCodes).add(code);
  const adjustedRows: AnalysisRow[] = sourceRows.map((row: AnalysisRow): AnalysisRow => {
    if (String(row.row_type || "").toUpperCase() !== "CR") return { ...row };
    const componentCode = getRowCode(row);
    if (!componentCode) return { ...row };
    let marketRate: number | undefined;
    if (/^\d+\*?$/.test(componentCode)) {
      const normalizedCode = componentCode.replace(/\*+$/, "");
      const rateItem = rates.find(item => String(item.code || "").trim().replace(/\*+$/, "") === normalizedCode);
      const basicRate = rateItem ? Number(rateItem.rate) : NaN;
      const codeNumber = Number(normalizedCode);
      const carriageDefault = codeNumber >= 2200 && codeNumber <= 2358 ? 0 : undefined;
      marketRate = marketRates[componentCode] ?? marketRates[normalizedCode] ?? carriageDefault ?? (Number.isFinite(basicRate) ? basicRate : undefined);
    } else if (analyses[componentCode]) {
      marketRate = calculateMarketAnalysis(componentCode, analyses, marketRates, rates, cache, nextActive).unitRate;
    }
    if (marketRate === undefined || !Number.isFinite(marketRate)) return { ...row };
    const quantity = Number(row.quantity);
    return {
      ...row,
      rate: marketRate,
      amount: Number.isFinite(quantity) ? money(quantity * marketRate) : row.amount,
    };
  });

  let baseQuantity = 1;
  const details = adjustedRows.find(row => /^DETAILS\s+OF\s+COST\s+(?:FOR|OF)\s+([\d.]+)/i.test(String(row.description || "")));
  const detailsMatch = details && /DETAILS\s+OF\s+COST\s+(?:FOR|OF)\s+([\d.]+)/i.exec(String(details.description));
  if (detailsMatch && Number(detailsMatch[1]) > 0) baseQuantity = Number(detailsMatch[1]);

  const totalsByMark = new Map<string, number>();
  let runningTotal = 0;
  let unitRate: number | undefined;
  const recalculatedRows = adjustedRows.map(row => {
    const rowType = String(row.row_type || "").toUpperCase();
    if (rowType === "CR") {
      const amount = Number(row.amount);
      if (Number.isFinite(amount)) runningTotal += amount;
      const mark = getRowMark(row).toUpperCase();
      if (mark) totalsByMark.set(mark, (totalsByMark.get(mark) || 0) + (Number.isFinite(amount) ? amount : 0));
      return row;
    }

    const description = String(row.description || "").trim();
    const upper = description.toUpperCase();
    const mark = getRowMark(row).toUpperCase();
    if (/^TOTAL\b/.test(upper)) {
      const amount = money(runningTotal);
      if (mark) totalsByMark.set(mark, amount);
      return { ...row, amount };
    }

    if (/^(?:ADD|LESS|DEDUCT)\b/.test(upper)) {
      const reference = /["“']\s*([A-Z])(?:\s*-\s*([A-Z]))?\s*["”']/i.exec(description);
      let base = reference ? (totalsByMark.get(reference[1].toUpperCase()) ?? runningTotal) : runningTotal;
      if (reference?.[2]) base -= totalsByMark.get(reference[2].toUpperCase()) || 0;
      const factorMatch = /multiplying\s+factor\s+([\d.]+)/i.exec(description);
      const percentMatch = /([\d.]+)\s*%/.exec(description);
      const factor = factorMatch ? Number(factorMatch[1]) : percentMatch ? Number(percentMatch[1]) / 100 : NaN;
      if (!Number.isFinite(factor)) return row;
      const charge = money(Math.max(0, base) * factor);
      runningTotal += /^(?:LESS|DEDUCT)\b/.test(upper) ? -charge : charge;
      return { ...row, amount: charge };
    }

    const costOne = /^COST\s+(?:OF|FOR)\s+1(?:\.0+)?\b/i.test(description);
    if (costOne) {
      unitRate = runningTotal / baseQuantity;
      return { ...row, amount: money(unitRate) };
    }
    if (/^SAY\b/i.test(description)) {
      const sayRate = unitRate ?? runningTotal / baseQuantity;
      unitRate = Math.round(sayRate * 20) / 20;
      return { ...row, amount: money(unitRate) };
    }
    if (/^COST\s+(?:OF|FOR)\s+/i.test(description)) {
      const quantityMatch = /^COST\s+(?:OF|FOR)\s+([\d.]+)/i.exec(description);
      if (!quantityMatch || Number(quantityMatch[1]) === baseQuantity) return { ...row, amount: money(runningTotal) };
    }
    return row;
  });
  const result = { rows: recalculatedRows, unitRate: unitRate ?? money(runningTotal / baseQuantity) };
  cache.set(code, result);
  return result;
}

function AnalysisTable({ rows, marketRates, rates, analyses, useMarketRates = false }: { rows: AnalysisRow[]; marketRates: Record<string, number>; rates: AnalysisRow[]; analyses: Record<string, AnalysisRow[]>; useMarketRates?: boolean }) {
  if (!rows.length) {
    return <div className="p-6 text-center text-slate-400 italic">No calculation breakdown available.</div>;
  }

  const displayRows = useMarketRates
    ? calculateMarketAnalysis("__display__", { __display__: rows, ...analyses }, marketRates, rates, new Map()).rows
    : rows;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-left border-collapse text-base">
        <thead className="bg-slate-900 text-slate-300 border-b border-slate-700">
          <tr>
            <th className="p-3 w-28">Code</th>
            <th className="p-3">Description</th>
            <th className="p-3 w-20 text-center">Unit</th>
            <th className="p-3 w-24 text-right">Qty</th>
            <th className="p-3 w-28 text-right">Rate (₹)</th>
            <th className="p-3 w-28 text-right">Amount (₹)</th>
            <th className="p-3 w-20 text-center">Mark</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {displayRows.map((row, index) => {
            const type = String(row.row_type || "").toUpperCase();
            const isNote = type === "NCR";
            const code = getRowCode(row);
            const mark = getRowMark(row);
            const description = String(row.description || "").replace(/\\n/g, "\n").replace(/\r\n?/g, "\n");
            const upperDescription = description.trim().toUpperCase();
            const hasAmount = row.amount !== null && row.amount !== undefined && row.amount !== "";
            const hasAmountString = typeof row.amount_str === "string" && row.amount_str.trim() !== "";
            const amountNumber = Number(row.amount);
            const noteHasZeroAmount = isNote && ((hasAmount && Number.isFinite(amountNumber) && amountNumber === 0) || (hasAmountString && Number(String(row.amount_str).replace("%", "")) === 0));
            const amountText = hasAmountString && row.amount_str.includes("%")
              ? row.amount_str
              : hasAmount && !noteHasZeroAmount && Number.isFinite(amountNumber) ? amountNumber.toFixed(2) : "";
            const isHeader = ["MATERIAL", "LABOUR", "MACHINERY"].includes(upperDescription) || upperDescription.startsWith("DETAILS OF COST");
            const isTotal = /^TOTAL\b/.test(upperDescription) || /^(COST OF|COST FOR|SAY\b)/.test(upperDescription);

            return (
              <tr key={`${row.component_sequence ?? row.id ?? index}-${code}-${index}`} className={`${isHeader ? "bg-slate-900/60 font-bold" : "hover:bg-slate-900/50"} ${isTotal ? "text-emerald-200 font-bold" : ""}`}>
                <td className="p-3 align-top font-mono text-amber-400 font-semibold">{code}</td>
                <td className={`p-3 align-top text-slate-200 whitespace-pre-line ${isHeader ? "uppercase tracking-wide" : ""}`}>{description}</td>
                <td className="p-3 align-top text-center text-slate-300">{row.unit || ""}</td>
                <td className="p-3 align-top text-right font-mono">{row.quantity !== null && row.quantity !== undefined && row.quantity !== "" ? Number(row.quantity).toFixed(3) : ""}</td>
                <td className="p-3 align-top text-right font-mono">{row.rate !== null && row.rate !== undefined && row.rate !== "" ? Number(row.rate).toFixed(2) : ""}</td>
                <td className="p-3 align-top text-right font-mono text-emerald-400 font-semibold">{amountText}</td>
                <td className="p-3 align-top text-center font-mono text-blue-300">{mark}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RateAnalysisDSR({ estimateRows = [], rates = [], marketRates = {}, analysisSnapshot = {} }: any) {
  const [analyses, setAnalyses] = useState<Record<string, AnalysisRow[]>>({});
  const [loading, setLoading] = useState(false);

  const orderedItems = useMemo(() => {
    const uniqueByCode = new Map<string, AnalysisRow>();
    for (const item of estimateRows as AnalysisRow[]) {
      const code = String(item.itemCode || "").trim();
      if (code && !uniqueByCode.has(code)) uniqueByCode.set(code, item);
    }
    return [...uniqueByCode.values()].sort((a: AnalysisRow, b: AnalysisRow) => {
    const contextA = analysisContext(a.itemCode);
    const contextB = analysisContext(b.itemCode);
    const sectionRank = (context: string) => context === "dsr" ? 0 : context === "mdsr" ? 1 : context === "ns" ? 2 : 3;
    const rankDifference = sectionRank(contextA) - sectionRank(contextB);
    if (rankDifference) return rankDifference;
    const familyDifference = itemFamily(a.itemCode) - itemFamily(b.itemCode);
    if (familyDifference) return familyDifference;
    return compareCodes(String(a.itemCode || ""), String(b.itemCode || ""));
    });
  }, [estimateRows]);
  const serialNumbers = useMemo(() => getSerialNumbers(estimateRows, rates), [estimateRows, rates]);
  const mainCodes = useMemo(() => new Set(orderedItems.map((item: AnalysisRow) => String(item.itemCode || "").trim())), [orderedItems]);
  const orderedWithPositions = useMemo(() => orderedItems.map((item: AnalysisRow, index: number) => ({ item, index })), [orderedItems]);
  const dsrItems = orderedWithPositions.filter(({ item }) => analysisContext(item.itemCode) === "dsr");
  const modifiedAndNSItems = orderedWithPositions.filter(({ item }) => ["mdsr", "ns"].includes(analysisContext(item.itemCode)));
  const otherMainItems = orderedWithPositions.filter(({ item }) => analysisContext(item.itemCode) === "other");
  const subAnalysisSections = useMemo(() => {
    const contexts: Array<{ id: "dsr" | "mdsr" | "ns" | "other"; title: string }> = [
      { id: "dsr", title: "DSR Sub A/Rs" },
      { id: "mdsr", title: "mDSR Sub A/Rs (Market Rates)" },
      { id: "ns", title: "NS Sub A/Rs (Market Rates)" },
      { id: "other", title: "Other Sub A/Rs (Market Rates)" },
    ];
    return contexts.map(context => {
      const roots = orderedItems.filter((item: AnalysisRow) => analysisContext(item.itemCode) === context.id);
      const found = new Set<string>();
      const visited = new Set<string>();
      const queue = roots.map((item: AnalysisRow) => String(item.itemCode || "").trim()).filter(Boolean);
      while (queue.length) {
        const parentCode = queue.shift()!;
        if (visited.has(parentCode)) continue;
        visited.add(parentCode);
        for (const row of analyses[parentCode] || []) {
          if (!isSubAnalysisReference(row)) continue;
          const subCode = getRowCode(row);
          if (!subCode || visited.has(subCode)) continue;
          if (!mainCodes.has(subCode)) found.add(subCode);
          queue.push(subCode);
        }
      }
      return { ...context, codes: [...found].sort(compareCodes) };
    });
  }, [orderedItems, analyses, mainCodes]);

  useEffect(() => {
    let cancelled = false;
    const loadAnalyses = async () => {
      setLoading(true);
      const result: Record<string, AnalysisRow[]> = {};
      const externalCodes = new Set(rates.filter((item: AnalysisRow) => isExternalRateItem(item)).map((item: AnalysisRow) => String(item.code || "").trim()));
      const queued: string[] = [...new Set<string>(estimateRows.map((item: AnalysisRow) => String(item.itemCode || "").trim()).filter((code: string) => Boolean(code) && !externalCodes.has(code)))];
      const visited = new Set<string>();
      let depth = 0;

      while (queued.length && depth < 8) {
        const batch = queued.splice(0, queued.length).filter(code => !visited.has(code));
        if (!batch.length) break;
        batch.forEach(code => visited.add(code));
        const fetched = await Promise.all(batch.map(async code => {
          const saved = analysisSnapshot[code];
          if (saved && Array.isArray(saved.rows)) return [code, saved.rows as AnalysisRow[]] as const;
          try {
            const response = await fetch(`/api/rate-analysis?code=${encodeURIComponent(code)}`);
            const data = await response.json();
            return [code, response.ok && Array.isArray(data) ? data as AnalysisRow[] : []] as const;
          } catch (error) {
            console.error(`Failed to fetch AR for ${code}`, error);
            return [code, [] as AnalysisRow[]] as const;
          }
        }));

        for (const [code, rows] of fetched) {
          result[code] = rows;
          for (const row of rows) {
            if (!isSubAnalysisReference(row)) continue;
            const subCode = getRowCode(row);
            if (!subCode || visited.has(subCode) || externalCodes.has(subCode)) continue;
            queued.push(subCode);
          }
        }
        depth++;
      }

      if (!cancelled) {
        setAnalyses(result);
        setLoading(false);
      }
    };

    if (estimateRows.length) loadAnalyses();
    else {
      setAnalyses({});
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [estimateRows, rates, analysisSnapshot]);

  const renderMainItem = ({ item, index }: { item: AnalysisRow; index: number }) => {
    const code = String(item.itemCode || "").trim();
    const description = item.description || "";
    const savedRateItem = rates.find((rate: AnalysisRow) => String(rate.code || "").trim() === code);
    const external = isExternalRateItem(savedRateItem);
    return (
      <section key={`${code}-${item.id ?? index}`} className="border border-slate-800 rounded-xl overflow-hidden bg-[#0b0f19] shadow-xl">
        <header className="bg-slate-900/70 border-b border-slate-800 p-5">
          <h3 className="text-lg text-amber-400 font-bold mb-3">Item {index + 1} [Sl. No. {serialNumbers.get(code) || item.slNo || index + 1}] [DSR No. {code}] {external && <span className="ml-2 rounded border border-violet-700 bg-violet-900/50 px-2 py-1 align-middle text-xs font-bold text-violet-200">Ext. RA</span>}</h3>
          <p className="text-slate-200 text-base leading-relaxed text-justify whitespace-pre-line">{description}</p>
        </header>
        <div className="p-4">{external
          ? <div className="rounded-lg border border-violet-800/70 bg-violet-950/30 p-4 text-violet-100">External rate analysis is maintained outside this software. Final rate: <b>₹{Number(savedRateItem?.rate || item.rate || 0).toFixed(2)}</b> per {savedRateItem?.unit || item.unit || "unit"}. No internal component breakdown is required.</div>
          : <AnalysisTable rows={analyses[code] || []} marketRates={marketRates} rates={rates} analyses={analyses} />}</div>
      </section>
    );
  };

  const renderSubAnalysis = (code: string, contextId: string, contextTitle: string) => {
    const item = rates.find((rate: AnalysisRow) => String(rate.code || "").trim() === code);
    const external = isExternalRateItem(item);
    const useMarketRates = contextId !== "dsr";
    return (
      <section key={`${contextId}:${code}`} className="border border-slate-800 rounded-xl overflow-hidden bg-[#0b0f19] shadow-xl">
        <header className="bg-slate-900/70 border-b border-slate-800 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-blue-300">{contextTitle}</div>
          <h3 className="text-lg text-amber-400 font-bold">Sub-Analysis [DSR No. {code}] {external && <span className="ml-2 rounded border border-violet-700 bg-violet-900/50 px-2 py-1 align-middle text-xs font-bold text-violet-200">Ext. RA</span>}</h3>
          {item?.description && <p className="mt-2 text-slate-200 text-base whitespace-pre-line">{item.description}</p>}
        </header>
        <div className="p-4">{external
          ? <div className="rounded-lg border border-violet-800/70 bg-violet-950/30 p-4 text-violet-100">External rate analysis is maintained outside this software. Final rate: <b>₹{Number(item?.rate || 0).toFixed(2)}</b> per {item?.unit || "unit"}. No internal component breakdown is required.</div>
          : <AnalysisTable rows={analyses[code] || []} marketRates={marketRates} rates={rates} analyses={analyses} useMarketRates={useMarketRates} />}</div>
      </section>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#0b0f19] text-slate-100 font-sans text-base">
      <div className="flex justify-between items-center mb-6 pb-3 border-b border-slate-800">
        <h2 className="text-xl font-bold text-blue-400 uppercase tracking-widest">Rate Analysis (Estimate)</h2>
        <button className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded font-bold shadow">📄 Export RA PDF</button>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-20 text-lg animate-pulse">Fetching Rate Analyses...</div>
      ) : orderedItems.length === 0 ? (
        <div className="text-center text-slate-400 py-20 italic text-lg">No items in Measurement Sheet to analyze.</div>
      ) : (
        <div className="space-y-8 max-w-7xl mx-auto pb-10">
          <section className="space-y-5">
            <h2 className="text-xl font-bold text-blue-300 uppercase tracking-wide">1. DSR Items (SH 1–26)</h2>
            {dsrItems.length ? dsrItems.map(renderMainItem) : <p className="text-slate-500 italic">No DSR items in the Measurement Sheet.</p>}
          </section>

          <section className="space-y-5">
            <h2 className="text-xl font-bold text-blue-300 uppercase tracking-wide">2. DSR Sub A/Rs</h2>
            {subAnalysisSections[0].codes.length
              ? subAnalysisSections[0].codes.map(code => renderSubAnalysis(code, "dsr", "DSR Sub A/R"))
              : <p className="text-slate-500 italic">No DSR sub-analyses are referenced.</p>}
          </section>

          <section className="space-y-5">
            <h2 className="text-xl font-bold text-blue-300 uppercase tracking-wide">3. mDSR and NS Items</h2>
            {modifiedAndNSItems.length ? modifiedAndNSItems.map(renderMainItem) : <p className="text-slate-500 italic">No mDSR or NS items in the Measurement Sheet.</p>}
            {otherMainItems.length > 0 && <div className="space-y-5 pt-3"><h3 className="text-lg font-bold text-slate-400">Other Selected Items</h3>{otherMainItems.map(renderMainItem)}</div>}
          </section>

          <section className="space-y-5">
            <h2 className="text-xl font-bold text-blue-300 uppercase tracking-wide">4. mDSR and NS Sub A/Rs (Market Rates)</h2>
            {subAnalysisSections.slice(1).map(section => section.codes.length > 0 && (
              <div key={section.id} className="space-y-5">
                <h3 className="text-lg font-bold text-violet-300">{section.title}</h3>
                {section.codes.map(code => renderSubAnalysis(code, section.id, section.title))}
              </div>
            ))}
            {subAnalysisSections.slice(1).every(section => section.codes.length === 0) && <p className="text-slate-500 italic">No mDSR or NS sub-analyses are referenced.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
