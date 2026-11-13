import React, { useEffect, useMemo, useRef, useState } from "react";
import { getSerialNumbers } from "./RateAnalysisDSR";
import { usePageTools } from "./PageToolsContext";
import { exportRateAnalysisWorkbook } from "../utils/exportJustfnToExcel";
import { openEstimatePdfWindow } from "../utils/exportTableToExcel";

const CUSTOM_CHARGES_STORAGE_KEY = "esti-pro-nsr-custom-charges-v1";
const DEFAULT_CHARGES = [
  { id: "water", name: "Water charges", rate: "1" },
  { id: "cpoh", name: "CPOH", rate: "15" },
  { id: "cess", name: "Cess", rate: "1" },
  { id: "gst", name: "GST", rate: "18" },
];
const isNonScheduleItem = (value: unknown) => /^(?:NSR|51(?:\.|$))/i.test(String(value || "").trim());
const isNSItem = (code: string) => isNonScheduleItem(code);
const singleLetterMark = (value: unknown) => /^[A-Z]$/i.test(String(value ?? "").trim()) ? String(value).trim().toUpperCase() : "";
const normalizedCode = (value: unknown) => {
  const code = String(value ?? "").trim().replace(/\*+$/, "").trim();
  return /^\d+$/.test(code) ? String(Number(code)) : code;
};
const analysisComponentCode = (row: any) => String(
  row?.sub_analysis_code ?? row?.subAnalysisCode ?? row?.component_code ?? row?.code ?? "",
).trim();
const getConventionalGstMultiplier = (rows: any[], fallback?: number): number | undefined => {
  for (const row of rows || []) {
    const description = String(row?.description || "");
    if (!/\bGST\b/i.test(description)) continue;
    const factor = description.match(/multiplying\s+factor\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (factor) return Number(factor[1]);
    const percentage = description.match(/@\s*(\d+(?:\.\d+)?)\s*%/);
    if (percentage) return Number(percentage[1]) / 100;
    const direct = Number(row?.gstMultiplier ?? row?.gst_multiplier ?? row?.gstFactor ?? row?.gst_factor);
    if (Number.isFinite(direct) && direct > 0) return direct;
  }
  return Number.isFinite(fallback) && Number(fallback) > 0 ? Number(fallback) : undefined;
};
const codeFamily = (value: unknown) => Number(/^([0-9]+)/.exec(String(value || "").trim())?.[1] || Number.MAX_SAFE_INTEGER);
const DSR_SUBHEAD_NAMES: Record<string, string> = {
  "1": "Carriage of materials", "2": "Earth work", "3": "Mortars", "4": "Concrete work",
  "5": "Reinforced cement concrete", "6": "Brick work", "7": "Stone work", "8": "Marble and granite work",
  "9": "Wood and P.V.C. work", "10": "Steel work", "11": "Flooring", "12": "Roofing",
  "13": "Finishing", "14": "Repairs to buildings", "15": "Dismantling and demolition",
  "16": "Road work", "17": "Sanitary installations", "18": "Water supply", "19": "Drainage",
  "20": "Pile work", "21": "Aluminium work", "22": "Water proofing",
  "23": "Structural steel & metal works", "24": "Building maintenance", "25": "Road & pavement repairs",
  "26": "Water supply & sanitary fittings",
};
function getDSRReferenceDescription(codeValue: unknown, ratesByCode: Map<string, any>, rates: any[]) {
  const code = String(codeValue ?? "").trim();
  if (!/^\d+(?:\.\d+)+$/.test(code)) return null;
  const family = code.split(".")[0];
  const familyNumber = Number(family);
  if (familyNumber < 1 || familyNumber > 26) return null;

  const exactSubhead = rates.find(rate => String(rate.code ?? "").trim() === family);
  const indexedSubhead = ratesByCode.get(family);
  const candidateDescription = String((exactSubhead ?? indexedSubhead)?.description ?? (exactSubhead ?? indexedSubhead)?.item_description ?? "").trim();
  // A normalized key like "3" can belong to Basic Rate 0003 (diesel roller).
  // Only accept a subhead-looking label; otherwise use the authoritative SH map.
  const rawName = /^(?:SH\s*\d+\s*[:.-]?|\d+\s*[:.-])\s*/i.test(candidateDescription)
    ? candidateDescription
    : "";
  const cleanedName = rawName
    .replace(/^SH\s*\d*\s*[:.-]?\s*/i, "")
    .replace(new RegExp(`^${family}\\s*[:.-]?\\s*`), "")
    .trim();
  const subheadName = cleanedName
    ? cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1).toLowerCase()
    : DSR_SUBHEAD_NAMES[family] || family;

  return `Rate as per item no. ${code} of SH: ${subheadName}`;
}
function compareItemCodes(left: string, right: string) {
  const a = left.match(/\d+|[a-z]+/gi) || [];
  const b = right.match(/\d+|[a-z]+/gi) || [];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    const numberA = Number(a[index]);
    const numberB = Number(b[index]);
    if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) return numberA - numberB;
    if (a[index] !== b[index]) return a[index].localeCompare(b[index]);
  }
  return 0;
}
function isExistingFinancialRow(row: any) {
  const type = String(row.row_type || "").toUpperCase();
  if (["CALC", "CALC_SNAPSHOT"].includes(type)) return true;
  const description = String(row.description || "").trim();
  return /^(?:TOTAL(?:\s+["'“‘]?[WXYZ]["'”’]?)?|ADD\s+\d+(?:\.\d+)?\s*%\s+(?:WATER|CPOH|CESS)|ADD\s+(?:GST|CESS)\b|COST\s+(?:OF|FOR)\s+\d|SAY\b|TOTAL\s+MARKET\s+RATE\b)/i.test(description);
}

function getAnalysisBaseQuantity(rows: any[]) {
  const firstRowDescription = String(rows.find(row => /DETAILS\s+OF\s+COST\b/i.test(String(row.description || "")))?.description || "");
  const headerMatch = firstRowDescription.match(/DETAILS\s+OF\s+COST\s+(?:FOR|OF)\s+([\d.]+)/i);
  let baseQuantity = headerMatch ? Number.parseFloat(headerMatch[1]) : 1;

  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) baseQuantity = 1;
  if (baseQuantity === 1) {
    for (const row of rows) {
      const description = String(row.description || "");
      const costRowMatch = description.match(/Cost\s+of\s+([\d.]+)\s+[a-zA-Z]+/i);
      if (!costRowMatch) continue;
      const parsedQuantity = Number.parseFloat(costRowMatch[1]);
      if (Number.isFinite(parsedQuantity) && parsedQuantity > 0 && parsedQuantity !== 1) {
        baseQuantity = parsedQuantity;
        break;
      }
    }
  }

  return baseQuantity;
}

function calculateAnalysis(rows: any[], method: string, charges: any[], excludeA: boolean, unit = "unit", exemptOverheads = false, baseQty = getAnalysisBaseQuantity(rows), gstMultiplierFallback?: number) {
  const details = rows
    .filter(row => String(row.row_type || "").toUpperCase() !== "CALC_SNAPSHOT")
    .map(row => {
      const normalized = { ...row };
      const rowType = String(row.row_type || "").toUpperCase();
      const isComponent = rowType === "CR" || rowType === "SCR";
      if (isComponent && row.quantity !== null && row.quantity !== undefined && row.quantity !== "") {
        const quantity = Number(row.quantity);
        if (Number.isFinite(quantity)) normalized.quantity = quantity / baseQty;
      }
      if (isComponent && row.amount !== null && row.amount !== undefined && row.amount !== "") {
        const amount = Number(row.amount);
        if (Number.isFinite(amount)) normalized.amount = amount / baseQty;
      }
      return normalized;
    });
  const byMark = new Map<string, number>();
  for (const row of details) {
    if (String(row.row_type || "").toUpperCase() !== "CR") continue;
    const mark = singleLetterMark(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref);
    if (mark) byMark.set(mark, (byMark.get(mark) || 0) + (Number(row.amount) || 0));
  }
  for (const row of details) {
    if (String(row.row_type || "").toUpperCase() !== "SCR" || row.amount_override) continue;
    const match = String(row.description || "").match(/(\d+(?:\.\d+)?)\s*%\s*(?:of|on)\s*["'“‘]?([A-Za-z])\b/i);
    if (match) row.amount = (byMark.get(match[2].toUpperCase()) || 0) * Number(match[1]) / 100;
  }
  const amount = details.filter(row => String(row.row_type || "").toUpperCase() !== "NCR")
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const markedA = details.filter(row => singleLetterMark(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref) === "A" && String(row.row_type || "").toUpperCase() !== "NCR")
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const base = (value: number, skipA = true) => Math.max(0, value - (skipA ? markedA : 0));
  const financial: any[] = [];
  const add = (description: string, value: number, mark = "") => financial.push({ row_type: "CALC", description, amount: value, mark });
  const hasAMarkedRows = markedA > 0;
  const suffix = hasAMarkedRows ? "-A" : "";
  let total = amount;
  let w = amount, x = 0, y = 0, z = 0;
  const pushCostAndSayRows = () => {
    const rate = total;
    add(`Cost of ${baseQty.toFixed(2)} ${unit}`, total * baseQty);
    add(`Cost of 1.00 ${unit}`, rate);
    const finalSayRate = Math.round(rate * 20) / 20;
    add("Say (Market Rate)", finalSayRate);
    return finalSayRate;
  };
  let finalSayRate = 0;
  if (amount > 0 && exemptOverheads) {
    add('TOTAL "W"', w, "W");
    const rate = total;
    add(`Cost of 1.00 ${unit}`, rate);
    finalSayRate = Math.round(rate * 20) / 20;
    add("Say (Market Rate)", finalSayRate);
  } else if (amount > 0 && method === "Conventional DSR" && base(w) > 0) {
    add('TOTAL "W"', w, "W");
    const water = base(w) * 0.01; add(`Add 1% Water charges on "W${suffix}"`, water); x = w + water; total = x;
    add('TOTAL "X"', x, "X");
    const gstMultiplier = getConventionalGstMultiplier(rows, gstMultiplierFallback);
    if (gstMultiplier !== undefined) {
      const gst = base(x) * gstMultiplier;
      add(`Add GST on "X${suffix}" (multiplying factor ${gstMultiplier})`, gst);
      y = x + gst;
      total = y;
    } else {
      y = x;
      total = y;
    }
    add('TOTAL "Y"', y, "Y");
    const cpoh = base(y) * 0.15; add(`Add 15% CPOH on "Y${suffix}"`, cpoh); z = y + cpoh; total = z;
    add('TOTAL "Z"', z, "Z");
    const cess = base(z) * 0.01; add(`Add Cess @ 1% on "Z${suffix}"`, cess); total = z + cess;
  } else if (amount > 0 && method === "Modified DSR" && base(w) > 0) {
    add('TOTAL "W"', w, "W");
    const water = base(w) * 0.01; add(`Add 1% Water charges on "W${suffix}"`, water); x = w + water; total = x;
    add('TOTAL "X"', x, "X");
    const cpoh = base(x) * 0.15; add(`Add 15% CPOH on "X${suffix}"`, cpoh); y = x + cpoh; total = y;
    add('TOTAL "Y"', y, "Y");
    const cess = base(y) * 0.01; add(`Add Cess @ 1% on "Y${suffix}"`, cess); z = y + cess; total = z;
    add('TOTAL "Z"', z, "Z");
    const gst = base(z) * 0.18; add(`Add GST @ 18% on "Z${suffix}"`, gst); total = z + gst;
  } else if (amount > 0 && method === "Custom charges") {
    add('TOTAL "W"', w, "W");
    for (let index = 0; index < charges.length; index++) {
      const charge = charges[index];
      const pct = Number(charge.rate) || 0;
      const chargeBase = Math.max(0, total - (excludeA ? markedA : 0));
      if (excludeA && chargeBase <= 0) continue;
      const value = chargeBase * pct / 100;
      total += value;
      const chargeName = String(charge.name || "Charge").trim();
      const chargeLabel = /^CPOH$/i.test(chargeName)
        ? `Add CPOH @ ${pct}% on "W${suffix}"`
        : `Add ${chargeName} @ ${pct}%`;
      add(chargeLabel, value);
      const milestone = ["X", "Y", "Z"][index];
      add(milestone ? `TOTAL "${milestone}"` : "TOTAL", total, milestone || "");
    }
  }
  if (amount > 0) {
    if (!exemptOverheads) finalSayRate = pushCostAndSayRows();
    return { rows: [...details, ...financial], total, finalSayRate };
  }
  return { rows: details, total: 0, finalSayRate: 0 };
}

export default function RateAnalysisMarket({
  estimateRows,
  marketRates,
  rates = [],
  theme = "dark",
  projectId = "",
  projectDetails = {},
  customItems = [],
  analysisSnapshot = {},
  setJustifiedRates,
  calculationMethod,
  setCalculationMethod,
  selectedCodes = [],
  focusCode = "",
  isActive = true,
  onFocusHandled,
}: any) {
  const { registerPageTools } = usePageTools();
  const findContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => registerPageTools("ramarket", {
    searchContainerRef: findContainerRef,
  }), [registerPageTools]);
  const [analyses, setAnalyses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [activeAnalysisSheet, setActiveAnalysisSheet] = useState("dsr-mdsr");
  const [internalMethod, setInternalMethod] = useState("Conventional DSR");
  const [charges, setCharges] = useState<any[]>(DEFAULT_CHARGES);
  const [chargesDraft, setChargesDraft] = useState<any[]>(DEFAULT_CHARGES);
  const [excludeA, setExcludeA] = useState(true);
  const [excludeADraft, setExcludeADraft] = useState(true);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [previousMethod, setPreviousMethod] = useState("Conventional DSR");
  const method = calculationMethod ?? internalMethod;
  const conventionalGstMultiplier = useMemo(
    () => getConventionalGstMultiplier(Object.values(analyses).flat()),
    [analyses],
  );
  const updateMethod = (nextMethod: string) => {
    if (setCalculationMethod) setCalculationMethod(nextMethod);
    else setInternalMethod(nextMethod);
    localStorage.setItem(`esti-pro-market-method-${String(projectId || "default")}`, nextMethod);
  };

  const customByCode = useMemo(() => new Map(customItems.map((item: any) => [String(item.code), item])), [customItems]);
  const basicRatesByCode = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of rates as any[]) {
      const key = normalizedCode(item.code);
      if (!map.has(key)) map.set(key, item);
    }
    return map;
  }, [rates]);
  const findRateItemByCode = (code: string) => (rates as any[]).find(item => String(item.code ?? "").trim() === String(code).trim())
    ?? basicRatesByCode.get(normalizedCode(code));
  const marketRateFor = (code: string): number | undefined => {
    const normalized = normalizedCode(code);
    const candidates = [
      Object.prototype.hasOwnProperty.call(marketRates, code) ? marketRates[code] : undefined,
      ...Object.entries(marketRates as Record<string, unknown>)
        .filter(([key]) => normalizedCode(key) === normalized)
        .map(([, value]) => value),
    ];
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null || String(candidate).trim() === "") continue;
      const value = Number(candidate);
      if (Number.isFinite(value)) return value;
    }

    // An absent/blank market override means “use the DSR basic rate”. An
    // explicit zero remains an intentional user-entered override.
    const basicRateItem = findRateItemByCode(code);
    const basicRate = Number(basicRateItem?.rate ?? basicRateItem?.dsrRate ?? basicRateItem?.dsr_rate);
    return Number.isFinite(basicRate) ? basicRate : undefined;
  };
  const serialNumbers = useMemo(() => getSerialNumbers(estimateRows || [], rates || []), [estimateRows, rates]);
  const uniqueItems = useMemo(() => {
    const uniqueByCode = new Map<string, any>();
    for (const item of estimateRows as any[]) {
      const code = String(item.itemCode || "").trim();
      if (code && !uniqueByCode.has(code)) uniqueByCode.set(code, item);
    }
    return [...uniqueByCode.values()].sort((left, right) => {
      const familyLeft = codeFamily(left.itemCode);
      const familyRight = codeFamily(right.itemCode);
      const rank = (item: any, family: number) => family >= 1 && family <= 26 ? 0 : isNonScheduleItem(item.itemCode) ? 2 : 1;
      return rank(left, familyLeft) - rank(right, familyRight)
        || familyLeft - familyRight
        || compareItemCodes(String(left.itemCode), String(right.itemCode));
    });
  }, [estimateRows]);
  const mainItemCodes = useMemo(() => new Set(uniqueItems.map((item: any) => String(item.itemCode || "").trim())), [uniqueItems]);
  const analysisCards = useMemo(() => {
    const selectedCodeSet = new Set((selectedCodes as string[]).map(code => String(code).trim()));
    const selectedItems = uniqueItems.filter((item: any) => selectedCodeSet.has(String(item.itemCode || "").trim()));
    const unselectedItems = uniqueItems.filter((item: any) => !selectedCodeSet.has(String(item.itemCode || "").trim()));
    const findRateItem = (code: string) => findRateItemByCode(code) || { code, description: "", unit: "" };
    const buildGroupCards = (items: any[]) => {
      const sortCodes = (left: any, right: any) => compareItemCodes(String(left.itemCode), String(right.itemCode));
      const dsrItems = items.filter(item => codeFamily(item.itemCode) >= 1 && codeFamily(item.itemCode) <= 26).sort(sortCodes);
      const nsItems = items.filter(item => isNonScheduleItem(item.itemCode)).sort(sortCodes);
      const drItems = items.filter(item => !dsrItems.includes(item) && !nsItems.includes(item)).sort(sortCodes);
      const beforeNS = new Set<string>();
      const nsSubAnalyses = new Set<string>();
      const visited = new Set<string>();
      const queue = [...dsrItems, ...drItems, ...nsItems].map(item => ({
        code: String(item.itemCode),
        isNS: isNonScheduleItem(item.itemCode),
      }));
      while (queue.length) {
        const parent = queue.shift()!;
        const visitKey = `${parent.isNS ? "ns" : "schedule"}:${parent.code}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);
        for (const row of analyses[parent.code] || []) {
          const type = String(row.row_type || "").toUpperCase();
          if (type === "NCR" || type === "SCR") continue;
          const child = analysisComponentCode(row);
          const explicit = row.is_sub_ar === true || row.is_sub_ar === 1 || row.is_sub_ar === "1" || String(row.isSubAR || "").toLowerCase() === "true";
          if (!/^\d+(?:\.\d+)+$/.test(child)) continue;
          if (!mainItemCodes.has(child)) {
            if (parent.isNS || isNonScheduleItem(child)) nsSubAnalyses.add(child);
            else beforeNS.add(child);
          }
          if (explicit || analyses[child]) {
            queue.push({ code: child, isNS: parent.isNS || isNonScheduleItem(child) });
          }
        }
      }

      const itemEntries = (entries: any[], keepMarketRates: boolean) => entries.map((item: any) => ({
        item,
        code: String(item.itemCode),
        isSubAnalysis: false,
        keepMarketRates,
      }));
      const subEntries = (codes: Set<string>, keepMarketRates: boolean) => [...codes]
        .sort(compareItemCodes)
        .map(code => ({ item: findRateItem(code), code, isSubAnalysis: true, keepMarketRates }));
      return {
        dsrMdsr: [
          { heading: "DSR and mDSR Items" },
          ...itemEntries([...dsrItems, ...drItems], true),
        ],
        subDsr: [
          { heading: "Sub ARs (DSR and mDSR)" },
          ...subEntries(beforeNS, true),
        ],
        ns: [
          { heading: "NS Items" },
          ...itemEntries(nsItems, false),
        ],
        subNs: [
          { heading: "Sub ARs (NS)" },
          ...subEntries(nsSubAnalyses, false),
        ],
      };
    };
    return {
      selected: buildGroupCards(selectedItems),
      unselected: buildGroupCards(unselectedItems),
      hasSelected: selectedItems.length > 0,
      hasUnselected: unselectedItems.length > 0,
    };
  }, [uniqueItems, selectedCodes, analyses, rates, mainItemCodes]);

  const analysisSheets = [
    { id: "dsr-mdsr", label: "RA of DSR & mDSR", key: "dsrMdsr" },
    { id: "sub-dsr-mdsr", label: "Sub ARs of DSR & mDSR", key: "subDsr" },
    { id: "ns", label: "RA of NS Items", key: "ns" },
    { id: "sub-ns", label: "Sub ARs of NS Items", key: "subNs" },
  ] as const;
  const activeSheet = analysisSheets.find(sheet => sheet.id === activeAnalysisSheet) || analysisSheets[0];

  useEffect(() => {
    const methodKey = `esti-pro-market-method-${String(projectId || "default")}`;
    if (!setCalculationMethod) setInternalMethod(localStorage.getItem(methodKey) || "Conventional DSR");
    try {
      const saved = localStorage.getItem(CUSTOM_CHARGES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.charges) && parsed.charges.length) setCharges(parsed.charges);
        if (typeof parsed.excludeAMarkedItems === "boolean") setExcludeA(parsed.excludeAMarkedItems);
      }
    } catch (error) { console.warn("Could not load saved custom charges", error); }
  }, [projectId, setCalculationMethod]);

  useEffect(() => {
    let cancelled = false;
    const fetchAnalyses = async () => {
      setLoading(true);
          const queue: string[] = [...new Set<string>(estimateRows.map((r: any) => String(r.itemCode || "").trim()).filter((code: string) => Boolean(code)))];
      const visited = new Set<string>();
      const newAnalyses: Record<string, any> = {};
      let depth = 0;
      while (queue.length && depth < 8) {
        const batch = queue.splice(0).filter(code => !visited.has(code));
        if (!batch.length) break;
        batch.forEach(code => visited.add(code));
        await Promise.all(batch.map(async code => {
          const savedAnalysis = analysisSnapshot[code];
          if (savedAnalysis && Array.isArray(savedAnalysis.rows)) { newAnalyses[code] = savedAnalysis.rows; return; }
          const custom: any = customByCode.get(code);
          if (custom) { newAnalyses[code] = Array.isArray(custom.analysisRows) ? custom.analysisRows : []; return; }
          try {
            const res = await fetch(`/api/rate-analysis?code=${encodeURIComponent(code)}`);
            const data = await res.json();
            newAnalyses[code] = res.ok && Array.isArray(data) ? data : [];
          } catch { newAnalyses[code] = []; }
        }));
        for (const code of batch) {
          for (const row of newAnalyses[code] || []) {
            const isExplicitSub = row.is_sub_ar === true || row.is_sub_ar === 1 || row.is_sub_ar === "1" || String(row.is_sub_ar ?? row.isSubAR ?? "").toLowerCase() === "true";
            if (String(row.row_type || "").toUpperCase() === "NCR" || String(row.row_type || "").toUpperCase() === "SCR") continue;
            const childCode = analysisComponentCode(row);
            if ((isExplicitSub || /^\d+(?:\.\d+)+$/.test(childCode)) && /^\d+(?:\.\d+)+$/.test(childCode) && !visited.has(childCode)) queue.push(childCode);
          }
        }
        depth++;
      }
      if (!cancelled) { setAnalyses(newAnalyses); setLoading(false); }
    };

    if (estimateRows.length > 0) fetchAnalyses();
    else { setAnalyses({}); setLoading(false); }
    return () => { cancelled = true; };
  }, [estimateRows, customByCode, analysisSnapshot]);

  const selectMethod = (next: string) => {
    if (next === "Custom charges") {
      setPreviousMethod(method);
      setChargesDraft(charges.map(charge => ({ ...charge })));
      setExcludeADraft(excludeA);
      setCustomModalOpen(true);
      return;
    }
    updateMethod(next);
  };

  const appliedPeriod = String(projectDetails?.clcPeriodLabel || (() => {
    const match = String(projectDetails?.clcPeriod || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return "Not recorded";
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month === 4) return `April ${year} to September ${year}`;
    if (month === 10) return `October ${year} to March ${year + 1}`;
    return String(projectDetails.clcPeriod);
  })()).replace(/^w\.e\.f\.\s*/i, "");
  const appliedArea = String(projectDetails?.clcArea || "Not recorded");

  const saveCustomCharges = () => {
    const clean = chargesDraft.map((charge, index) => ({ id: String(charge.id || `charge-${index}`), name: String(charge.name || `Charge ${index + 1}`).trim(), rate: String(Math.max(0, Number(charge.rate) || 0)) }));
    try { localStorage.setItem(CUSTOM_CHARGES_STORAGE_KEY, JSON.stringify({ charges: clean, excludeAMarkedItems: excludeADraft })); }
    catch { alert("Custom charge settings could not be saved in this browser."); return; }
    setCharges(clean); setExcludeA(excludeADraft); updateMethod("Custom charges");
    localStorage.setItem(`esti-pro-market-method-${String(projectId || "default")}`, "Custom charges");
    setCustomModalOpen(false);
  };

  const resolveScheduleRate = (code: string, ancestors = new Set<string>()): number | null => {
    const directRate = marketRateFor(code);
    if (!code || ancestors.has(code) || isNSItem(code)) return directRate === undefined ? null : directRate;
    const sourceRows = analyses[code] || [];
    if (!sourceRows.length) return directRate === undefined ? null : directRate;
    const nextAncestors = new Set(ancestors).add(code);
    const adjusted = sourceRows.filter((row: any) => !isExistingFinancialRow(row)).map((row: any) => {
      if (String(row.row_type || "").toUpperCase() !== "CR") return row;
      const childCode = analysisComponentCode(row);
      const nested = /^\d+(?:\.\d+)+$/.test(childCode) ? resolveScheduleRate(childCode, nextAncestors) : null;
      const rate = nested ?? marketRateFor(childCode) ?? 0;
      const quantity = Number(row.quantity);
      return { ...row, rate, amount: row.quantity !== "" && row.quantity != null && Number.isFinite(quantity) ? quantity * rate : row.amount };
    });
    const result = calculateAnalysis(adjusted, method, charges, excludeA, findRateItemByCode(code)?.unit || "unit", codeFamily(code) === 3, getAnalysisBaseQuantity(sourceRows), getConventionalGstMultiplier(sourceRows, conventionalGstMultiplier));
    return result.total;
  };

  const localFinalRates = useMemo(() => {
    const computed: Record<string, number> = {};
    for (const item of uniqueItems) {
      const code = String(item.itemCode || "").trim();
      if (!code) continue;
      const itemData: any = customByCode.get(code) ?? findRateItemByCode(code);
      const sourceRows = analyses[code] || [];
      if (isNSItem(code)) {
        computed[code] = Number(item.rate) || 0;
        continue;
      }
      if (itemData?.isExternalAR || Number(itemData?.is_external_ar) === 1) {
        computed[code] = Number(itemData.rate ?? item.rate) || 0;
        continue;
      }
      const adjustedRows = sourceRows.filter((row: any) => !isExistingFinancialRow(row)).map((row: any) => {
        const componentCode = analysisComponentCode(row);
        if (String(row.row_type || "").toUpperCase() !== "CR" || !componentCode) return row;
        const nestedRate = /^\d+(?:\.\d+)+$/.test(componentCode) ? resolveScheduleRate(componentCode, new Set([code])) : null;
        const rate = nestedRate ?? marketRateFor(componentCode) ?? 0;
        const quantity = Number(row.quantity);
        return { ...row, rate, amount: row.quantity !== "" && row.quantity != null && Number.isFinite(quantity) ? quantity * rate : row.amount };
      });
      const result = calculateAnalysis(adjustedRows, method, charges, excludeA, itemData?.unit || item.unit || "unit", codeFamily(code) === 3, getAnalysisBaseQuantity(sourceRows), getConventionalGstMultiplier(sourceRows, conventionalGstMultiplier));
      computed[code] = sourceRows.length ? result.finalSayRate : marketRateFor(code) ?? 0;
    }
    return computed;
  }, [uniqueItems, analyses, customByCode, basicRatesByCode, marketRates, method, charges, excludeA, conventionalGstMultiplier]);

  const prevRatesRef = useRef("");
  useEffect(() => {
    const currentString = JSON.stringify(localFinalRates);
    if (currentString !== prevRatesRef.current) {
      prevRatesRef.current = currentString;
      setJustifiedRates?.(localFinalRates);
    }
  }, [localFinalRates, setJustifiedRates]);

  useEffect(() => {
    if (!focusCode || !isActive || loading) return;
    const targetId = `market-rate-${String(focusCode).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    onFocusHandled?.();
  }, [focusCode, isActive, loading, analyses, onFocusHandled]);

  return (
    <div ref={findContainerRef} className="w-full h-full flex flex-col overflow-y-auto p-6 bg-olive-light text-slate-800 dark:bg-[#0b0f19] dark:text-slate-100 font-sans text-base">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-base font-bold text-amber-500 uppercase tracking-widest">Rate Analysis (Market)</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-slate-300 sm:text-sm">
            <span><span className="font-semibold text-slate-100">Applied labour period:</span> {appliedPeriod}</span>
            <span><span className="font-semibold text-slate-100">City area:</span> {appliedArea} Area</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {analysisSheets.map(sheet => <button key={sheet.id} type="button" onClick={() => setActiveAnalysisSheet(sheet.id)} className={`rounded px-4 py-2 text-sm font-bold transition-colors ${activeAnalysisSheet === sheet.id ? "bg-blue-600 text-white" : "border border-slate-700 text-slate-300 hover:bg-slate-800"}`}>{sheet.label}</button>)}
          <button
            type="button"
            disabled={loading || uniqueItems.length === 0}
            onClick={() => void exportRateAnalysisWorkbook({
              estimateData: { estimateRows, rates, marketRates, projectDetails },
              statementRows: estimateRows,
              justifiedRates: {},
              baseMarketRates: marketRates,
              rateListMarketRates: marketRates,
              summaryInputs: { nitNumber: "", lowestContractor: "", contractorTenderedAmount: "" },
              analysisSnapshot: analyses,
              calculationMethod: method,
              customCharges: charges,
              excludeAMarkedItems: excludeA,
            }, "market").catch(error => {
              console.error("Could not export market rate analyses:", error);
              alert(error instanceof Error ? error.message : "Could not export market rate analyses.");
            })}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >📊 Export RA Market</button>
          <button
            type="button"
            disabled={loading || uniqueItems.length === 0}
            onClick={() => {
              const printWindow = openEstimatePdfWindow();
              if (!printWindow) { alert("Allow pop-ups to export the PDF."); return; }
              void exportRateAnalysisWorkbook({
                estimateData: { estimateRows, rates, marketRates, projectDetails },
                statementRows: estimateRows,
                justifiedRates: {},
                baseMarketRates: marketRates,
                rateListMarketRates: marketRates,
                summaryInputs: { nitNumber: "", lowestContractor: "", contractorTenderedAmount: "" },
                analysisSnapshot: analyses,
                calculationMethod: method,
                customCharges: charges,
                excludeAMarkedItems: excludeA,
              }, "market", "pdf", printWindow).catch(error => {
                printWindow.close();
                console.error("Could not export market rate analyses to PDF:", error);
                alert(error instanceof Error ? error.message : "Could not export market rate analyses to PDF.");
              });
            }}
            className="rounded bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          >📄 Export RA Market PDF</button>
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <span>Calculation method</span>
            <select aria-label="Calculation method" value={method} onChange={event => selectMethod(event.target.value)} className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100">
              <option>Conventional DSR</option><option>Modified DSR</option><option>Custom charges</option>
            </select>
          </label>
          {method === "Custom charges" && <button type="button" onClick={() => selectMethod("Custom charges")} className="rounded border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800">Configure charges</button>}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-500 py-20 text-base animate-pulse">Calculating Market Rates...</div>
      ) : uniqueItems.length === 0 ? (
        <div className="text-center text-slate-500 py-20 italic text-base">No items on the Measurement Sheet to analyze.</div>
      ) : (
        <div className="space-y-8 max-w-7xl mx-auto pb-10">
          {(() => {
          const renderCards = (cards: any[]) => cards.map((entry: any, idx: number) => {
            if (entry.heading) return <h2 key={`heading-${entry.heading}`} className="text-xl font-bold text-blue-300 uppercase tracking-wide">{entry.heading}</h2>;
            const item = entry.item;
            const codeForItem = String(entry.code || "");
            const itemData: any = customByCode.get(codeForItem) ?? findRateItemByCode(codeForItem);
            const isNS = !entry.keepMarketRates;
            const sourceRows = analyses[codeForItem] || [];
            const external = Boolean(itemData?.isExternalAR || Number(itemData?.is_external_ar) === 1);
            const adjustedRows = isNS ? sourceRows : sourceRows.filter((row: any) => !isExistingFinancialRow(row)).map((row: any) => {
              const componentCode = analysisComponentCode(row);
              if (String(row.row_type || "").toUpperCase() !== "CR" || !componentCode) return row;
              const nestedRate = /^\d+(?:\.\d+)+$/.test(componentCode) ? resolveScheduleRate(componentCode, new Set([codeForItem])) : null;
              const directRate = marketRateFor(componentCode);
              const rate = nestedRate ?? directRate ?? 0;
              const quantity = Number(row.quantity);
              return { ...row, rate, amount: row.quantity !== "" && row.quantity != null && Number.isFinite(quantity) ? rate * quantity : row.amount };
            });
            const itemUnit = String(itemData?.unit || item.unit || "unit");
            const result = isNS ? { rows: sourceRows, total: Number(itemData?.rate ?? item.rate ?? 0) } : calculateAnalysis(adjustedRows, method, charges, excludeA, itemUnit, codeFamily(codeForItem) === 3, getAnalysisBaseQuantity(sourceRows), getConventionalGstMultiplier(sourceRows, conventionalGstMultiplier));
            const breakdown = external ? [] : result.rows;
            const serialNo = serialNumbers.get(codeForItem) || item.slNo || idx + 1;
            const mainIndex = uniqueItems.findIndex((main: any) => String(main.itemCode) === codeForItem) + 1;
            const headerDescription = itemData?.description ?? item.description ?? "";
            
            return (
              <div id={`market-rate-${codeForItem.replace(/[^a-zA-Z0-9_-]/g, "-")}`} data-export-title={entry.isSubAnalysis ? `Sub-Analysis [DSR No. ${codeForItem}]` : `Item ${mainIndex} [Sl. No. ${serialNo}] [DSR No. ${codeForItem}]`} data-export-description={String(headerDescription ?? "")} data-export-context={entry.nonScheduleContext ? "ns" : "schedule"} key={`${entry.isSubAnalysis ? "sub" : "main"}-${idx}-${codeForItem}`} className="border border-slate-800 rounded-xl overflow-hidden bg-[#0b0f19] shadow-xl mb-5 text-base">
                <div data-find-row className="bg-slate-900/60 border-b border-slate-800 p-4">
                  {entry.isSubAnalysis && <div className="mb-2 text-xs font-bold uppercase tracking-wider text-blue-300">Sub-Analysis</div>}
                  <div className="text-lg text-amber-400 font-bold mb-2">{entry.isSubAnalysis ? `Sub-Analysis [DSR No. ${codeForItem}]` : `Item ${mainIndex} [Sl. No. ${serialNo}] [DSR No. ${codeForItem}]`} {external && <span className="ml-2 rounded border border-violet-700 bg-violet-900/50 px-2 py-1 align-middle text-xs font-bold text-violet-200">Ext. RA</span>}</div>
                  {headerDescription && <div className="text-slate-200 text-base leading-relaxed text-justify whitespace-pre-line">{headerDescription}</div>}
                </div>

                <div className="overflow-x-auto p-4">
                  <table className="w-full min-w-[850px] text-left border-collapse text-base">
                    <thead className="bg-slate-900 text-slate-400 border-b border-slate-700">
                      <tr>
                        <th className="bg-slate-900 p-3 w-28">Code</th>
                        <th className="bg-slate-900 p-3">Description</th>
                        <th className="bg-slate-900 p-3 w-20 text-center">Unit</th>
                        <th className="bg-slate-900 p-3 w-24 text-right">Qty</th>
                        <th className="bg-slate-900 p-3 w-28 text-right text-rose-400">Market Rate (₹)</th>
                        <th className="bg-slate-900 p-3 w-28 text-right">Amount (₹)</th>
                        <th className="bg-slate-900 p-3 w-20 text-center">Mark</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {external ? <tr data-find-row><td colSpan={5} className="p-3 text-violet-200">External analysis — detailed rate analysis is maintained outside the software.</td><td className="p-3 text-right font-mono font-bold text-green-400">{Number(itemData?.rate ?? item.rate ?? 0).toFixed(2)}</td><td className="p-3 text-center">Ext. RA</td></tr> : breakdown.length > 0 ? breakdown.map((row: any, i: number) => {
                        const isNCR = String(row.row_type || "").toUpperCase() === "NCR";
                        const hasAmtNum = row.amount !== null && row.amount !== undefined && row.amount !== '';
                        const hasAmtStr = row.amount_str && row.amount_str.trim() !== '';
                        const hasAmt = hasAmtNum || hasAmtStr;
                        const rawDescription = row.description || "";
                        const descText = isNS && /^SAY\b/i.test(String(rawDescription).trim()) ? "Say (Market Rate)" : rawDescription;
                        const dUp = descText.toUpperCase();

                        if (isNCR && !hasAmt) {
                          const isBoldHeader = ["MATERIAL", "LABOUR", "MACHINERY"].includes(dUp) || dUp.startsWith("DETAILS OF COST");
                          return (
                            <tr data-find-row key={i} className="border-b border-slate-800/50 bg-transparent">
                              <td className="p-3"></td>
                              <td className={`p-3 text-slate-200 whitespace-pre-line ${isBoldHeader ? 'font-bold uppercase tracking-wider' : ''}`}>
                                {descText}
                              </td>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                              <td className="p-3"></td>
                            </tr>
                          );
                        } else {
                          const code = analysisComponentCode(row);
                          const basicRate = findRateItemByCode(code);
                          const componentDescription = String(basicRate?.description ?? descText);
                          const componentType = String(row.row_type || "").trim().toUpperCase();
                          const isStandardDSRComponent = componentType === "CR"
                            || (!componentType && /^\d+(?:\.\d+)+$/.test(String(code).trim()));
                          const displayDescription = isStandardDSRComponent
                            ? getDSRReferenceDescription(code, basicRatesByCode, rates) || componentDescription
                            : componentDescription;
                          const mark = String(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref ?? "").trim();
                          const unit = row.unit || "";
                          const qty = (row.quantity !== null && row.quantity !== undefined && row.quantity !== '') ? Number(row.quantity).toFixed(3) : "";
                          
                          let rate = (row.rate !== null && row.rate !== undefined && row.rate !== '') ? (Number(row.rate) === 0 ? "0.00" : Number(row.rate).toFixed(2)) : "";
                          let amt = "";
                          if (hasAmtStr && row.amount_str.includes('%')) {
                            amt = row.amount_str;
                          } else if (hasAmtNum && !(isNCR && Number(row.amount) === 0)) {
                            amt = Number(row.amount).toFixed(2);
                          }

                          // Override logic for market rate
                          if (isNCR && hasAmt) {
                            return (
                              <tr data-find-row key={i} className="hover:bg-slate-900/60 border-b border-slate-800/50 transition-colors">
                                <td className="p-3"></td>
                                <td className="p-3 text-slate-300 whitespace-pre-line text-justify">{descText}</td>
                                <td className="p-3"></td>
                                <td className="p-3"></td>
                                <td className="p-3"></td>
                                <td className="p-3 text-right font-mono text-green-400 font-bold">{amt}</td>
                                <td className="p-3 text-center font-mono text-blue-300">{mark}</td>
                              </tr>
                            );
                          }

                          return (
                            <tr data-find-row key={i} className="hover:bg-slate-900/60 border-b border-slate-800/50 transition-colors">
                              <td className="p-3 font-mono text-amber-500 font-bold">{code}</td>
                              <td className="p-3 text-slate-300 whitespace-pre-line text-justify">{displayDescription}</td>
                              <td className="p-3 text-center text-slate-400">{unit}</td>
                              <td className="p-3 text-right font-mono text-slate-200">{qty}</td>
                              <td className="p-3 text-right font-mono text-rose-400 font-bold">{rate}</td>
                              <td className="p-3 text-right font-mono text-green-400 font-bold">{amt}</td>
                              <td className="p-3 text-center font-mono text-blue-300">{mark}</td>
                            </tr>
                          );
                        }
                      }) : <tr><td colSpan={7} className="p-6 text-center opacity-60 text-base italic">{isNS ? "This NS item has no analysis saved in the active project database." : "No calculation breakdown available in database."}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          });
          return (
            <>
              {analysisCards.hasSelected && analysisCards.selected[activeSheet.key].length > 1
                ? renderCards(analysisCards.selected[activeSheet.key])
                : <p className="text-slate-500 italic">No items are selected for justification.</p>}
              <details className="rounded-lg border border-slate-700 bg-slate-900/40">
                <summary className="cursor-pointer px-4 py-3 font-bold text-slate-300">Items not selected for justification</summary>
                <div className="space-y-5 p-4 text-slate-400 opacity-70">
                  {analysisCards.hasUnselected && analysisCards.unselected[activeSheet.key].length > 1
                    ? renderCards(analysisCards.unselected[activeSheet.key])
                    : <p className="italic">No unselected items.</p>}
                </div>
              </details>
            </>
          );
          })()}
        </div>
      )}
      {customModalOpen && <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => { setCustomModalOpen(false); updateMethod(previousMethod); }}><div className="w-full max-w-3xl rounded-xl bg-olive-card text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100" onMouseDown={event => event.stopPropagation()}><div className="border-b border-slate-200 p-5 dark:border-slate-700"><h3 className="text-xl font-bold text-blue-700 dark:text-blue-300">Custom charges</h3><p className="text-sm text-slate-600 dark:text-slate-300">Set charge percentages and arrange their application order.</p></div><div className="space-y-3 p-5"><label className="flex gap-2 text-sm"><input type="checkbox" checked={excludeADraft} onChange={event => setExcludeADraft(event.target.checked)} />Exclude A-marked amounts from charge bases</label><div className="grid grid-cols-[1fr_120px_112px] gap-2 text-xs font-bold uppercase text-slate-500"><span>Charge name</span><span>Rate (%)</span><span>Order</span></div>{chargesDraft.map((charge, index) => <div key={charge.id} className="grid grid-cols-[1fr_120px_112px] items-center gap-2"><input value={charge.name} onChange={event => setChargesDraft(previous => previous.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} className="rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"/><input type="number" min="0" step="0.01" value={charge.rate} onChange={event => setChargesDraft(previous => previous.map((entry, i) => i === index ? { ...entry, rate: event.target.value } : entry))} className="rounded border border-slate-300 bg-white px-3 py-2 text-right text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"/><div className="flex justify-end gap-1"><button type="button" disabled={!index} onClick={() => setChargesDraft(previous => { const copy = [...previous]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })} className="rounded bg-slate-200 px-2 py-1 disabled:opacity-40">↑</button><button type="button" disabled={index === chargesDraft.length - 1} onClick={() => setChargesDraft(previous => { const copy = [...previous]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; return copy; })} className="rounded bg-slate-200 px-2 py-1 disabled:opacity-40">↓</button><button type="button" onClick={() => setChargesDraft(previous => previous.filter((_, i) => i !== index))} className="rounded bg-rose-100 px-2 py-1 text-rose-700">×</button></div></div>)}<button type="button" onClick={() => setChargesDraft(previous => [...previous, { id: `charge-${Date.now()}`, name: "Custom charge", rate: "0" }])} className="rounded bg-blue-50 px-4 py-2 font-semibold text-blue-700">+ Add a charge</button></div><div className="flex justify-end gap-3 border-t border-slate-200 p-4 dark:border-slate-700"><button onClick={() => { setCustomModalOpen(false); updateMethod(previousMethod); }} className="rounded bg-slate-200 px-5 py-2 font-bold">Cancel</button><button onClick={saveCustomCharges} disabled={!chargesDraft.length} className="rounded bg-emerald-600 px-5 py-2 font-bold text-white disabled:opacity-50">Save and use</button></div></div></div>}
    </div>
  );
}
