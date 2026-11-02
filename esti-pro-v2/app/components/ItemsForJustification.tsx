"use client";

import React, { useMemo, useState } from "react";
import { buildHierarchicalRows } from "../utils/dsrHierarchy";

type EstimateRow = {
  itemCode?: string;
  isSubtotal?: boolean;
  isSubhead?: boolean;
  type?: string;
  quantity?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  userDescription?: string;
  description?: string;
  unit?: string;
};

type RateItem = {
  code?: string;
  rate?: number | string | null;
  description?: string;
  unit?: string;
};

type Props = {
  estimateRows: EstimateRow[];
  rates: RateItem[];
  selectedCodes: string[];
  setSelectedCodes: (codes: string[]) => void;
  percentage: number;
  setPercentage: (percentage: number) => void;
  calculationMethod: string;
  setCalculationMethod: (method: string) => void;
  projectDetails: Record<string, unknown>;
  marketRates: Record<string, number | string | null | undefined>;
  onStartJustification: () => void;
};

export default function ItemsForJustification({
  estimateRows,
  rates,
  selectedCodes,
  setSelectedCodes,
  percentage,
  setPercentage,
  calculationMethod,
  setCalculationMethod,
  projectDetails,
  marketRates,
  onStartJustification,
}: Props) {
  const [sortKey, setSortKey] = useState<"code" | "amount">("amount");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const items = useMemo(() => {
    const itemMap = new Map<string, { code: string; description: string; unit: string; quantity: number; rate: number; amount: number }>();
    const ciRate = Number(projectDetails.costIndex) || 0;
    const factor = Number(projectDetails.gstModificationFactor) || 0.973;
    for (const row of estimateRows) {
      const code = String(row.itemCode || "").trim();
      if (!code || row.isSubtotal || row.isSubhead || String(row.type || "").toLowerCase() === "sh") continue;
      const rateItem = rates.find(rate => String(rate.code || "").trim() === code);
      const quantity = Number(row.quantity) || 0;
      const isNonSchedule = /^(?:NSR|51\.)/i.test(code) || /^(?:NS|NSR)$/i.test(String(row.type || "").trim());
      const rate = Number(isNonSchedule && marketRates[code] !== undefined
        ? marketRates[code]
        : row.rate ?? rateItem?.rate) || 0;
      const amount = isNonSchedule
        ? Math.round(quantity * rate)
        : Math.round(quantity * rate * ((100 + ciRate) / 100) * factor);
      const existing = itemMap.get(code);
      if (existing) {
        existing.quantity += quantity;
        existing.amount += amount;
      } else {
        itemMap.set(code, {
          code,
          description: String(rateItem?.description ?? row.description ?? row.userDescription ?? ""),
          unit: String(row.unit || rateItem?.unit || ""),
          quantity,
          rate,
          amount,
        });
      }
    }
    const hierarchyRows = buildHierarchicalRows(
      [...itemMap.values()].map(item => ({ itemCode: item.code, description: item.description })),
      rates,
    );
    const parentDescriptionsByCode = new Map<string, string>(
      hierarchyRows
        .filter(row => row.rowType === "parent" && row.description)
        .map(row => [row.itemCode, row.description] as [string, string]),
    );
    const hierarchyDescriptionByCode = new Map<string, string[]>(
      hierarchyRows
        .filter(row => row.isItem)
        .map(row => {
          const parentDescriptions = (row.ancestors || [])
            .map((ancestor: { code: string }) => parentDescriptionsByCode.get(ancestor.code))
            .filter((description: string | undefined): description is string => Boolean(description));
          return [row.itemCode, [...parentDescriptions, row.description].filter(Boolean)] as [string, string[]];
        }),
    );
    return [...itemMap.values()].map(item => ({
      ...item,
      descriptionLines: hierarchyDescriptionByCode.get(item.code) ?? [item.description],
    })).sort((a, b) => {
      const comparison = sortKey === "code"
        ? a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
        : a.amount - b.amount;
      return (sortDirection === "asc" ? comparison : -comparison) || a.code.localeCompare(b.code);
    });
  }, [estimateRows, rates, projectDetails, marketRates, sortKey, sortDirection]);

  const totalEstimated = items.reduce((total, item) => total + Math.max(0, item.amount), 0);
  const selectedTotal = items.reduce((total, item) => total + (selectedCodes.includes(item.code) ? item.amount : 0), 0);
  const selectedPercentage = totalEstimated > 0
    ? ((selectedTotal / totalEstimated) * 100).toFixed(2)
    : "0.00";
  const selectedSet = new Set(selectedCodes);

  const applyPercentage = () => {
    const target = totalEstimated * Math.min(100, Math.max(0, percentage)) / 100;
    if (target <= 0) {
      setSelectedCodes([]);
      return;
    }
    let accumulated = 0;
    const nextCodes: string[] = [];
    const itemsByAmountDescending = [...items].sort((a, b) => b.amount - a.amount);
    for (const item of itemsByAmountDescending) {
      if (item.amount <= 0) continue;
      nextCodes.push(item.code);
      accumulated += item.amount;
      if (accumulated >= target) break;
    }
    setSelectedCodes(nextCodes);
  };

  const toggleItem = (code: string) => {
    setSelectedCodes(selectedSet.has(code)
      ? selectedCodes.filter(selectedCode => selectedCode !== code)
      : [...selectedCodes, code]);
  };

  const toggleSort = (key: "code" | "amount") => {
    if (sortKey === key) {
      setSortDirection(direction => direction === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "amount" ? "desc" : "asc");
  };

  const sortIndicator = (key: "code" | "amount") =>
    sortKey !== key ? "↕" : sortDirection === "asc" ? "↑" : "↓";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-[#0b1121] text-slate-100">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-slate-700 pb-4">
        <div>
          <h1 className="text-xl font-bold uppercase tracking-wider text-emerald-400">Items for Justification</h1>
          <p className="mt-1 text-sm text-slate-400">Select the estimate items to include in Market Rate Analysis and the Justification Statement.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-300">
            Percentage of Estimated Amount
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={percentage}
                onChange={event => {
                  const value = Number(event.target.value);
                  setPercentage(Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);
                }}
                aria-label="Percentage of estimated amount"
                className="w-20 rounded border border-slate-600 bg-slate-950 px-2 py-2 text-right text-slate-100"
              />
              <span>%</span>
            </div>
          </label>
          <button type="button" onClick={applyPercentage} disabled={!items.length} className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-500 disabled:opacity-50">
            Apply percentage
          </button>
          <button type="button" onClick={onStartJustification} className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-500">
            Start Justification
          </button>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-300">
            Calculation method
            <select value={calculationMethod} onChange={event => setCalculationMethod(event.target.value)} className="rounded border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100">
              <option>Conventional DSR</option>
              <option>Modified DSR</option>
              <option>Custom charges</option>
            </select>
          </label>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        <span>{selectedCodes.length} selected, Selected amount = ₹{Math.round(selectedTotal).toLocaleString("en-IN")}, %age = ₹{Math.round(selectedTotal).toLocaleString("en-IN")} / ₹{Math.round(totalEstimated).toLocaleString("en-IN")} = {selectedPercentage} %</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setSelectedCodes(items.map(item => item.code))} className="rounded border border-slate-600 px-3 py-1.5 hover:bg-slate-800">Select all</button>
          <button type="button" onClick={() => setSelectedCodes([])} className="rounded border border-slate-600 px-3 py-1.5 hover:bg-slate-800">Clear all</button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-slate-700">
        <table className="w-full min-w-[800px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900 text-slate-300">
            <tr>
              <th className="p-3 text-center">Include</th>
              <th className="p-3 text-left" aria-sort={sortKey === "code" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("code")} className="inline-flex items-center gap-2 font-semibold hover:text-white" aria-label={`Sort by item code ${sortKey === "code" && sortDirection === "asc" ? "descending" : "ascending"}`}>
                  Item Code <span aria-hidden="true">{sortIndicator("code")}</span>
                </button>
              </th>
              <th className="p-3 text-left">Description</th>
              <th className="p-3 text-center">Unit</th>
              <th className="p-3 text-right">Quantity</th>
              <th className="p-3 text-right" aria-sort={sortKey === "amount" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("amount")} className="inline-flex items-center justify-end gap-2 font-semibold hover:text-white" aria-label={`Sort by estimated amount ${sortKey === "amount" && sortDirection === "asc" ? "largest to smallest" : "smallest to largest"}`}>
                  Estimated Amount (₹) <span aria-hidden="true">{sortIndicator("amount")}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.code} className="border-t border-slate-800 hover:bg-slate-800/50">
                <td className="p-3 text-center"><input type="checkbox" checked={selectedSet.has(item.code)} onChange={() => toggleItem(item.code)} aria-label={`Include ${item.code} for justification`} /></td>
                <td className="p-3 font-mono font-semibold text-blue-300">{item.code}</td>
                <td className="p-3 text-justify">
                  {item.descriptionLines.map((description, index) => (
                    <div key={`${item.code}-description-${index}`} className={index === item.descriptionLines.length - 1 ? "font-bold" : ""}>
                      {description}
                    </div>
                  ))}
                </td>
                <td className="p-3 text-center text-slate-400">{item.unit}</td>
                <td className="p-3 text-right font-mono">{item.quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                <td className="p-3 text-right font-mono">₹{Math.round(item.amount).toLocaleString("en-IN")}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">Add estimate items before selecting items for justification.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
