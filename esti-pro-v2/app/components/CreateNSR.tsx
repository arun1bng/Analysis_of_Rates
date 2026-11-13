import React, { useState, useEffect, useRef } from "react";
import { exportSingleRANSItemToExcel } from "../utils/exportSingleRANSItemToExcel";
import { exportSingleRANSItemToPdf } from "../utils/exportSingleRANSItemToPdf";

const SH_NAMES: Record<string, string> = {
  "1": "Carriage of Materials", "2": "Earth Work", "3": "Mortars", "4": "Concrete Work",
  "5": "Reinforced Cement Concrete", "6": "Brick Work", "7": "Stone Work", "8": "Marble and Granite Work",
  "9": "Wood and P.V.C. Work", "10": "Steel Work", "11": "Flooring", "12": "Roofing",
  "13": "Finishing", "14": "Repairs to Buildings", "15": "Dismantling and Demolition",
  "16": "Road Work", "17": "Sanitary Installations", "18": "Water Supply", "19": "Drainage",
  "20": "Pile Work", "21": "Aluminium Work", "22": "Water Proofing",
  "23": "Structural Steel & Metal Works", "24": "Building Maintenance",
  "25": "Road & Pavement Repairs", "26": "Water Supply & Sanitary Fittings",
  "49": "Special ARs", "50": "mDSR", "51": "NSR"
};

const getAnalysisRowType = (row: any) => {
  if (row?.row_type === "SCR") return "SCR";
  if (row?.row_type === "NCR") return "NCR";
  if (row?.row_type === "CR") return "CR";
  return row?.isNote ? "NCR" : "CR";
};

const getSingleLetterMark = (...values: any[]) => {
  for (const value of values) {
    const mark = String(value ?? "").trim().toUpperCase();
    if (/^[A-Z]$/.test(mark)) return mark;
  }
  return "";
};

const getSpecialCalculationRule = (description: string) => {
  const match = String(description || "").match(/(\d+(?:\.\d+)?)\s*%\s*(?:of|on)\s*["'“‘]?([A-Za-z])\b/i);
  return match ? { percent: Number(match[1]), mark: match[2].toUpperCase() } : null;
};

const savedSetting = (item: any, ...keys: string[]) => {
  for (const key of keys) {
    const value = item?.[key] ?? item?.nsrSettings?.[key] ?? item?.settings?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const findConventionalGstMultiplier = (rows: any[], explicit?: unknown): number | undefined => {
  const explicitNumber = Number(explicit);
  if (explicit !== undefined && explicit !== null && explicit !== "" && Number.isFinite(explicitNumber) && explicitNumber > 0) return explicitNumber;
  for (const row of rows || []) {
    const direct = Number(row?.gstMultiplier ?? row?.gst_multiplier ?? row?.gstFactor ?? row?.gst_factor);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const description = String(row?.description || "");
    if (!/\bGST\b/i.test(description)) continue;
    const factor = description.match(/multiplying\s+factor\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (factor) return Number(factor[1]);
    const percent = description.match(/@\s*(\d+(?:\.\d+)?)\s*%/);
    if (percent) return Number(percent[1]) / 100;
  }
  return undefined;
};

const getSavedBaseQuantity = (item: any) => {
  const direct = Number(savedSetting(item, "baseQty", "baseQuantity", "base_qty", "base_quantity"));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const rows = Array.isArray(item?.analysisRows) ? item.analysisRows : [];
  for (const row of rows) {
    const description = String(row?.description ?? "");
    const match = description.match(/^(?:cost|details\s+of\s+cost)\s+(?:of|for)\s+([\d.]+)/i);
    const quantity = match ? Number(match[1]) : NaN;
    if (Number.isFinite(quantity) && quantity > 0 && Math.abs(quantity - 1) > 1e-9) return quantity;
  }
  return 1;
};

/** Find the next primary item number under a family, excluding nested sub-items. */
function getNextItemCode(existingCodes: unknown[], subheadPrefix: string) {
  const prefix = String(subheadPrefix || "51").trim();
  let maxNum = 0;

  existingCodes.forEach((entry: any) => {
    const code = String(typeof entry === "string" || typeof entry === "number"
      ? entry
      : entry?.itemCode ?? entry?.item_code ?? entry?.code ?? "").trim();
    if (!code.startsWith(`${prefix}.`)) return;

    const parts = code.split(".");
    // A primary item has exactly two segments (51.16). Descendants such as
    // 51.15.1 must not affect the next primary code.
    if (parts.length !== 2) return;

    const segmentNum = Number.parseInt(parts[1], 10);
    if (Number.isInteger(segmentNum) && segmentNum > maxNum) maxNum = segmentNum;
  });

  return `${prefix}.${maxNum + 1}`;
}

function getExistingCode(entry: unknown) {
  if (typeof entry === "string" || typeof entry === "number") return String(entry).trim().toLowerCase();
  if (!entry || typeof entry !== "object") return "";
  const record = entry as Record<string, unknown>;
  return String(record.itemCode ?? record.item_code ?? record.code ?? "").trim().toLowerCase();
}

function formatAtLeastTwoDecimals(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return raw;
  const [coefficient, exponentText] = raw.toLowerCase().split("e");
  const fractionDigits = coefficient.includes(".") ? coefficient.split(".")[1].length : 0;
  const exponent = Number(exponentText || 0);
  const decimalPlaces = Math.min(10, Math.max(2, fractionDigits - exponent));
  return numeric.toFixed(decimalPlaces);
}

function formatIndianAmount(value: unknown) {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(numeric) ? numeric : 0);
}

const DEFAULT_CUSTOM_CHARGES = [
  { id: "water", name: "Water charges", rate: "1" },
  { id: "cpoh", name: "CPOH", rate: "15" },
  { id: "cess", name: "Cess", rate: "1" },
  { id: "gst", name: "GST", rate: "18" },
];
const CUSTOM_CHARGES_STORAGE_KEY = "esti-pro-nsr-custom-charges-v1";
const CLC_SKILL_BY_BASE_RATE: Record<string, string> = {
  "736.00": "unskilled", "816.00": "semiSkilled", "857.00": "skilledAverage",
  "897.00": "skilled", "973.00": "highlySkilled",
};
const CLC_PERIODS = (() => {
  const periods: Array<{ value: string; label: string }> = [];
  let year = 2023;
  let month = 4;
  while (year < 2026 || (year === 2026 && month <= 10)) {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    if (year === 2026 && month === 10) { periods.push({ value, label: "w.e.f. October 2026 to March 2027" }); break; }
    const startMonth = month === 4 ? "April" : "October";
    const endMonth = month === 4 ? "September" : "March";
    periods.push({ value, label: `w.e.f. ${startMonth} ${year} to ${endMonth} ${month === 4 ? year : year + 1}` });
    if (month === 4) month = 10;
    else { month = 4; year++; }
  }
  return periods;
})();

const recalculateSpecialRows = (rows: any[], forceRowId?: number) => {
  const totalsByMark = new Map<string, number>();
  rows.forEach(row => {
    if (getAnalysisRowType(row) !== "CR") return;
    const mark = getSingleLetterMark(row.mark);
    if (mark) totalsByMark.set(mark, (totalsByMark.get(mark) || 0) + (Number(row.amount) || 0));
  });

  return rows.map(row => {
    if (getAnalysisRowType(row) !== "SCR") return row;
    const rule = getSpecialCalculationRule(row.description);
    if (!rule || (row.amount_override && row.id !== forceRowId)) return row;
    const baseAmount = totalsByMark.get(rule.mark) || 0;
    return { ...row, amount: (baseAmount * rule.percent) / 100, amount_override: false };
  });
};

export default function CreateNSR({ onAddNSR, onClose, rates = [], initialData = null, existingItemCodes = [], projectDetails = {} }: any) {
  const [itemFamily, setItemFamily] = useState(initialData ? initialData.code.split('.')[0] : "51");
  const [itemCode, setItemCode] = useState(() => initialData?.code || getNextItemCode([...rates, ...existingItemCodes], "51"));
  const [itemCodeEdited, setItemCodeEdited] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [sourceConfigurationLocked, setSourceConfigurationLocked] = useState(false);
  const [parentItem, setParentItem] = useState("Top-level item");
  const [copySource, setCopySource] = useState(() => String(savedSetting(initialData, "sourceItemCode", "source_item_code") || ""));
  const [description, setDescription] = useState(initialData ? initialData.description : "");
  const [unit, setUnit] = useState(initialData ? initialData.unit : "cum");
  const [baseQty, setBaseQty] = useState<number>(() => getSavedBaseQuantity(initialData));
  const [calcMethod, setCalcMethod] = useState(() => String(savedSetting(initialData, "calcMethod", "calculationMethod", "calculation_method") || "Conventional DSR"));
  const [clcPeriod, setClcPeriod] = useState(() => String(savedSetting(initialData, "clcPeriod", "clc_period") || "2026-10"));
  const [clcArea, setClcArea] = useState(() => String(savedSetting(initialData, "clcArea", "clc_area") || "B"));
  const [configurationLocked, setConfigurationLocked] = useState(() => Boolean(initialData && Array.isArray(initialData.analysisRows) && initialData.analysisRows.some((row: any) => row.row_type !== "CALC_SNAPSHOT" && getAnalysisRowType(row) === "CR")));
  const [applyingConfiguration, setApplyingConfiguration] = useState(false);
  const [conventionalGstMultiplier, setConventionalGstMultiplier] = useState<number | undefined>(() => findConventionalGstMultiplier(
    Array.isArray(initialData?.analysisRows) ? initialData.analysisRows : [],
    savedSetting(initialData, "conventionalGstMultiplier", "gstMultiplier", "gst_multiplier"),
  ));
  const [applyingClc, setApplyingClc] = useState(false);
  const [isExternalAR, setIsExternalAR] = useState(Boolean(initialData?.isExternalAR ?? initialData?.is_external_ar));
  const [externalRate, setExternalRate] = useState(String(initialData?.rate ?? ""));
  const [customCharges, setCustomCharges] = useState<any[]>(DEFAULT_CUSTOM_CHARGES);
  const [customChargesDraft, setCustomChargesDraft] = useState<any[]>(DEFAULT_CUSTOM_CHARGES);
  const [excludeAMarkedItems, setExcludeAMarkedItems] = useState(() => savedSetting(initialData, "excludeAMarkedItems", "exclude_a_marked_items") !== false);
  const [excludeAMarkedDraft, setExcludeAMarkedDraft] = useState(() => savedSetting(initialData, "excludeAMarkedItems", "exclude_a_marked_items") !== false);
  const [isCustomChargesOpen, setIsCustomChargesOpen] = useState(false);
  const previousCalcMethod = useRef("Conventional DSR");
  const [isParentHeading, setIsParentHeading] = useState(initialData ? Boolean(savedSetting(initialData, "isParentHeading", "is_parent_heading") ?? (!initialData.unit && Number(initialData.rate) === 0)) : false);
  
  const [numRowsToAdd, setNumRowsToAdd] = useState<number>(1);
  const [activeRowId, setActiveRowId] = useState<number | null>(null);

  const [rows, setRows] = useState<any[]>(() => {
    const initialRows = initialData?.analysisRows
      ? initialData.analysisRows.filter((r: any) => r.row_type !== "CALC_SNAPSHOT")
      : [{ id: 1, isNote: true, row_type: "NCR", code: "", description: "Details of cost for 1 cum", unit: "", quantity: "", rate: "", amount: 0, mark: "" }];
    return recalculateSpecialRows(initialRows.map((row: any) => {
      const row_type = getAnalysisRowType(row);
      return { ...row, row_type, isNote: row_type === "NCR" };
    }));
  });

  const mainDescRef = useRef<HTMLTextAreaElement>(null);
  const textareaRefs = useRef<{ [key: number]: HTMLTextAreaElement | null }>({});

  const adjustTextareaHeight = (element: HTMLTextAreaElement | null) => {
    if (element) {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }
  };

  useEffect(() => {
    Object.values(textareaRefs.current).forEach(adjustTextareaHeight);
  }, [rows]);

  useEffect(() => {
    adjustTextareaHeight(mainDescRef.current);
  }, [description]);



  useEffect(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_CHARGES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.charges) && parsed.charges.length) setCustomCharges(parsed.charges);
        if (typeof parsed.excludeAMarkedItems === "boolean") setExcludeAMarkedItems(parsed.excludeAMarkedItems);
      }
    } catch (error) { console.warn("Could not load saved custom charges.", error); }
  }, []);

  // A modal can be reused for different items. Rehydrate every editable field
  // whenever the selected item changes instead of keeping the previous draft.
  useEffect(() => {
    if (!initialData) {
      setConfigurationLocked(false);
      setConventionalGstMultiplier(undefined);
      setSourceConfigurationLocked(false);
      setCopySource("");
      setIsDuplicate(false);
      return;
    }
    setSourceConfigurationLocked(false);
    setCopySource("");
    setIsDuplicate(false);
    setItemFamily(String(initialData.code || "51").split(".")[0]);
    setItemCode(String(initialData.code || ""));
    setDescription(String(initialData.description || ""));
    setUnit(String(initialData.unit || ""));
    setBaseQty(getSavedBaseQuantity(initialData));
    const savedCalcMethod = String(savedSetting(initialData, "calcMethod", "calculationMethod", "calculation_method") || "Conventional DSR");
    setCalcMethod(savedCalcMethod);
    previousCalcMethod.current = savedCalcMethod;
    setClcPeriod(String(savedSetting(initialData, "clcPeriod", "clc_period") || "2026-10"));
    setClcArea(String(savedSetting(initialData, "clcArea", "clc_area") || "B"));
    setConfigurationLocked(Boolean(Array.isArray(initialData.analysisRows) && initialData.analysisRows.some((row: any) => row.row_type !== "CALC_SNAPSHOT" && getAnalysisRowType(row) === "CR")));
    setConventionalGstMultiplier(findConventionalGstMultiplier(
      Array.isArray(initialData.analysisRows) ? initialData.analysisRows : [],
      savedSetting(initialData, "conventionalGstMultiplier", "gstMultiplier", "gst_multiplier"),
    ));
    const savedExternal = Boolean(initialData.isExternalAR ?? Number(initialData.is_external_ar) === 1);
    setIsExternalAR(savedExternal);
    setExternalRate(String(initialData.rate ?? ""));
    const parent = Boolean(savedSetting(initialData, "isParentHeading", "is_parent_heading") ?? (!initialData.unit && Number(initialData.rate) === 0));
    setIsParentHeading(parent);
    if (parent) {
      setUnit("");
      setBaseQty(0);
    }
    const savedExcludeA = savedSetting(initialData, "excludeAMarkedItems", "exclude_a_marked_items");
    const excludeA = typeof savedExcludeA === "boolean" ? savedExcludeA : true;
    setExcludeAMarkedItems(excludeA);
    setExcludeAMarkedDraft(excludeA);
    const savedCharges = savedSetting(initialData, "customCharges", "custom_charges");
    if (Array.isArray(savedCharges) && savedCharges.length) {
      const charges = savedCharges.map((charge: any, index: number) => ({
        id: String(charge.id || `charge-${index + 1}`),
        name: String(charge.name || `Charge ${index + 1}`),
        rate: String(charge.rate ?? "0"),
      }));
      setCustomCharges(charges);
      setCustomChargesDraft(charges.map(charge => ({ ...charge })));
    } else {
      // The modal may be reused for a different item; avoid carrying a prior
      // item's custom schedule into an item that has no saved custom charges.
      const defaults = DEFAULT_CUSTOM_CHARGES.map(charge => ({ ...charge }));
      setCustomCharges(defaults);
      setCustomChargesDraft(defaults.map(charge => ({ ...charge })));
    }
    const initialRows = Array.isArray(initialData.analysisRows)
      ? initialData.analysisRows.filter((row: any) => row.row_type !== "CALC_SNAPSHOT")
      : [];
    setRows(recalculateSpecialRows(initialRows.map((row: any) => {
      const row_type = getAnalysisRowType(row);
      return { ...row, row_type, isNote: row_type === "NCR" };
    })));
  }, [initialData]);

  // Resolve the conventional DAR GST multiplier from the selected item's saved
  // analysis, or dynamically from the database for a new item without a source.
  useEffect(() => {
    let cancelled = false;
    const itemCode = String(initialData?.code || "").trim();
    const query = itemCode ? `&code=${encodeURIComponent(itemCode)}` : "";
    fetch(`/api/rate-analysis?gstMultiplier=1${query}`)
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        const factor = Number(data?.multiplier);
        if (!cancelled && Number.isFinite(factor) && factor > 0) setConventionalGstMultiplier(previous => previous ?? factor);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [initialData?.code]);

  const changeCalculationMethod = (method: string) => {
    if (method === "Custom charges") {
      if (calcMethod !== method) previousCalcMethod.current = calcMethod;
      setCustomChargesDraft(customCharges.map(charge => ({ ...charge })));
      setExcludeAMarkedDraft(excludeAMarkedItems);
      setIsCustomChargesOpen(true);
    } else setCalcMethod(method);
  };

  const saveCustomCharges = () => {
    if (!customChargesDraft.length) return;
    const charges = customChargesDraft.map((charge, index) => ({
      id: String(charge.id || ("charge-" + Date.now() + "-" + index)),
      name: String(charge.name || ("Charge " + (index + 1))).trim(),
      rate: String(Math.max(0, Number(charge.rate) || 0)),
    }));
    try { localStorage.setItem(CUSTOM_CHARGES_STORAGE_KEY, JSON.stringify({ charges, excludeAMarkedItems: excludeAMarkedDraft })); }
    catch (error) { console.error("Could not save custom charges.", error); alert("Custom charges could not be saved in this browser."); return; }
    setCustomCharges(charges);
    setExcludeAMarkedItems(excludeAMarkedDraft);
    setCalcMethod("Custom charges");
    setIsCustomChargesOpen(false);
  };

  const applyClcRates = async (): Promise<boolean> => {
    setApplyingClc(true);
    try {
      const response = await fetch(`/api/clc-rates?period=${encodeURIComponent(clcPeriod)}&area=${encodeURIComponent(clcArea)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "CLC rates could not be loaded.");
      const wages = data.wages || {};
      setRows(previousRows => recalculateSpecialRows(previousRows.map(row => {
        if (getAnalysisRowType(row) !== "CR") return row;
        const rawCode = String(row.code ?? row.component_code ?? "").trim();
        if (!/^\d+$/.test(rawCode)) return row;
        const codeNumber = Number(rawCode);
        if (codeNumber < 100 || codeNumber > 221) return row;
        const rateItem = rates.find((candidate: any) => {
          const candidateCode = String(candidate.code ?? candidate.itemCode ?? "").trim();
          return candidateCode === rawCode || (/^\d+$/.test(candidateCode) && Number(candidateCode) === codeNumber);
        });
        if (!rateItem || String(row.unit || rateItem.unit || "").trim().toLowerCase() === "sqm" || [162, 163, 166].includes(codeNumber)) return row;
        const baseRate = Number(rateItem.rate ?? rateItem.dsrRate ?? rateItem.dsr_rate);
        const skillKey = CLC_SKILL_BY_BASE_RATE[Number.isFinite(baseRate) ? baseRate.toFixed(2) : ""];
        const wage = skillKey ? Number(wages[skillKey]) : NaN;
        if (!Number.isFinite(wage) || wage < 0) return row;
        const quantity = Number(row.quantity) || 0;
        return { ...row, rate: String(wage), amount: quantity * wage };
      })));
      alert(`CLC rates applied for ${data.periodLabel || clcPeriod}, ${clcArea} Area. Eligible labour rows were recalculated; all other analysis rows were preserved.`);
      return true;
    } catch (error) {
      alert(error instanceof Error ? error.message : "CLC rates could not be loaded.");
      return false;
    } finally {
      setApplyingClc(false);
    }
  };

  const applyConfiguration = async () => {
    setApplyingConfiguration(true);
    try {
      const clcApplied = await applyClcRates();
      if (clcApplied) setConfigurationLocked(true);
    } finally {
      setApplyingConfiguration(false);
    }
  };

  const availableParents = rates
    .filter((r: any) => r.code && r.code.startsWith(`${itemFamily}.`) && (!r.rate || Number(r.rate) === 0))
    .sort((a: any, b: any) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }));

  useEffect(() => {
    if (initialData) return;
    if (itemCodeEdited) return;

    const knownCodes = [...rates, ...existingItemCodes];
    if (parentItem === "Top-level item" || parentItem === "Item having (AR)") {
      setItemCode(getNextItemCode(knownCodes, itemFamily));
      setIsDuplicate(false);
    } else {
      const parentPartsLen = parentItem.split('.').length;
      const childCodes = knownCodes.map((entry: any) => String(typeof entry === "string" ? entry : entry?.itemCode ?? entry?.item_code ?? entry?.code ?? "").trim());
      let maxNum = 0;
      childCodes.forEach((code: string) => {
        if (!code.startsWith(`${parentItem}.`)) return;
        const parts = code.split('.');
        if (parts.length === parentPartsLen + 1) {
          const num = parseInt(parts[parentPartsLen], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      });
      setItemCode(`${parentItem}.${maxNum + 1}`);
      setIsDuplicate(false);
    }
  }, [itemFamily, parentItem, rates, existingItemCodes, initialData, itemCodeEdited]);

  const insertNRows = () => {
    const newRows = Array.from({ length: Math.max(1, numRowsToAdd) }).map((_, i) => ({
      id: Date.now() + i, isNote: false, row_type: "CR", code: "", description: "", unit: "", quantity: "", rate: "", amount: 0, mark: ""
    }));
    setRows([...rows, ...newRows]);
    setConfigurationLocked(true);
  };

  const insertRowBelow = (index: number) => {
    const newRow = { id: Date.now(), isNote: false, row_type: "CR", code: "", description: "", unit: "", quantity: "", rate: "", amount: 0, mark: "" };
    const newRows = [...rows];
    newRows.splice(index + 1, 0, newRow);
    setRows(newRows);
    setConfigurationLocked(true);
  };

  // Dedicated DB Lookup function that strictly runs on Blur or Enter key
  const lookupCode = (id: number, val: string) => {
    if (!val) return;
    
    const match = rates.find((r: any) => {
      const dbCode = String(r.code).trim();
      const inputCode = String(val).trim();
      // Direct string match
      if (dbCode.toLowerCase() === inputCode.toLowerCase()) return true;
      // Integer comparison for zero-padded basic rates (e.g., matches "0111" to "111")
      if (/^\d+$/.test(dbCode) && /^\d+$/.test(inputCode)) {
         return parseInt(dbCode, 10) === parseInt(inputCode, 10);
      }
      return false;
    });
    
    if (match) {
      const shKey = val.split('.')[0];
      const shName = SH_NAMES[shKey] || shKey;
      
      const isRefItem = val.includes(".");
      const isSH3 = val.startsWith("3.");
      
      const defaultMark = (isRefItem && !isSH3) ? "A" : ""; 
      
      // Load raw descriptions for 4-digit materials/labour, formatted descriptions for DSR items
      const finalDesc = isRefItem ? `Rate as per item no. ${val} of SH : ${shName}` : (match.description || match.item_description || "");
      const finalMark = isRefItem ? (match.mark || match.reference_mark || match.remark || defaultMark) : "";

      setRows(prevRows => prevRows.map(r => {
        if (r.id === id) {
           return {
             ...r,
             description: finalDesc,
             rate: match.rate || "",
             unit: match.unit || "",
             quantity: "", 
             amount: 0,
             mark: finalMark 
           };
        }
        return r;
      }));
    }
  };

  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, rIndex: number, cIndex: number, rowId: number) => {
    // Advanced Matrix Navigation: Enter key performs lookups and jumps to next logical cell
    if (e.key === 'Enter') {
        e.preventDefault();
        if (cIndex === 0) {
            lookupCode(rowId, rows[rIndex].code);
            // Jump from Code to Quantity cell instantly after lookup
            setTimeout(() => document.getElementById(`matrix-input-${rIndex}-3`)?.focus(), 50);
        } else if (cIndex === 3) {
            document.getElementById(`matrix-input-${rIndex}-4`)?.focus(); // Jump Qty -> Rate
        } else if (cIndex === 4) {
            document.getElementById(`matrix-input-${rIndex + 1}-0`)?.focus(); // Jump Rate -> Next Row Code
        }
        return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    const isNumber = target.type === 'number' || (target as HTMLInputElement).inputMode === "decimal";
    const { selectionStart, selectionEnd, value } = target as HTMLInputElement;

    let nextR = rIndex;
    let nextC = cIndex;

    if (e.key === 'ArrowUp') {
        nextR = rIndex - 1;
    } else if (e.key === 'ArrowDown') {
        nextR = rIndex + 1;
    } else if (e.key === 'ArrowLeft') {
        if (isNumber || (selectionStart === 0 && selectionEnd === 0)) nextC = cIndex - 1;
        else return;
    } else if (e.key === 'ArrowRight') {
        if (isNumber || (selectionStart === value.length && selectionEnd === value.length)) nextC = cIndex + 1;
        else return;
    }

    if (nextR !== rIndex || nextC !== cIndex) {
        if (nextR >= 0 && nextR < rows.length && nextC >= 0 && nextC <= 5) {
            e.preventDefault();
            const nextId = `matrix-input-${nextR}-${nextC}`;
            const nextEl = document.getElementById(nextId);
            if (nextEl) {
                nextEl.focus();
            }
        }
    }
  };

  const updateRow = (id: number, field: string, value: any) => {
    if ((field === "row_type" && value === "CR") || rows.some(row => row.id === id && getAnalysisRowType(row) === "CR")) setConfigurationLocked(true);
    setRows(prevRows => {
      const updatedRows = prevRows.map(row => {
        if (row.id !== id) return row;
        const updated = { ...row, [field]: value };
        const row_type = field === "row_type"
          ? value
          : field === "isNote"
            ? (value ? "NCR" : "CR")
            : getAnalysisRowType(updated);
        updated.row_type = row_type;
        updated.isNote = row_type === "NCR";
        if (field === "amount" && row_type === "SCR") updated.amount_override = true;
        if ((field === "description" || field === "row_type" || field === "isNote") && row_type === "SCR") updated.amount_override = false;
        if (row_type === "CR" && (field === "quantity" || field === "rate")) {
          updated.amount = (Number(updated.quantity) || 0) * (Number(updated.rate) || 0);
        }
        return updated;
      });
      const forceRowId = ["description", "row_type", "isNote"].includes(field) ? id : undefined;
      return recalculateSpecialRows(updatedRows, forceRowId);
    });
  };

  const deleteRow = (id: number) => setRows(prevRows => recalculateSpecialRows(prevRows.filter(row => row.id !== id)));

  const handleCopySourceSelect = (val: string) => {
    setCopySource(val);
    const sourceItem = [...rates].reverse().find((r: any) => String(r.code).trim().toLowerCase() === String(val).trim().toLowerCase());
    if (sourceItem) {
      let desc = sourceItem.description || "";
      const exactCodeIndex = desc.indexOf(val);
      if (exactCodeIndex > 0) {
         desc = desc.substring(exactCodeIndex).trim();
      }
      setDescription(desc);
      if (!isParentHeading) setUnit(sourceItem.unit || "cum");
    }
  };

  const loadSourceAnalysis = async (): Promise<any[] | null> => {
    if (!copySource.trim()) return rows;
    try {
      const sourceCode = String(copySource).trim().toLowerCase();
      const sourceItem = [...rates].reverse().find((item: any) => String(item.code || "").trim().toLowerCase() === sourceCode);
      let data: any[] = [];

      // Custom NSR/mDSR analyses are saved with their item; DSR analyses use the API.
      if (Array.isArray(sourceItem?.analysisRows) && sourceItem.analysisRows.length > 0) {
        data = sourceItem.analysisRows;
      } else {
        const response = await fetch("/api/rate-analysis?code=" + encodeURIComponent(String(copySource).trim()));
        const responseData = await response.json();
        if (!response.ok) {
          const apiMessage = responseData && typeof responseData.error === "string" ? responseData.error : `Request failed (${response.status})`;
          throw new Error(apiMessage);
        }
        data = Array.isArray(responseData) ? responseData : [];
      }

      if (data.length > 0) {
        const importedGstMultiplier = findConventionalGstMultiplier(data, sourceItem?.conventionalGstMultiplier ?? sourceItem?.gstMultiplier);
        if (importedGstMultiplier !== undefined) setConventionalGstMultiplier(importedGstMultiplier);
        let extractedBaseQty = 1;
        const reversedData = [...data].reverse();
        
        const costRow = reversedData.find((r: any) => {
          const desc = (r.description || "").trim().toLowerCase();
          return desc.startsWith("cost of") && !desc.includes("cost of 1.") && !desc.includes("cost of 1 ");
        });
        
        if (costRow) {
           if (costRow.quantity && !isNaN(Number(costRow.quantity))) {
               extractedBaseQty = Number(costRow.quantity);
           } else {
               const qtyMatch = costRow.description.match(/cost (?:of|for) ([\d.]+)/i);
               if (qtyMatch && qtyMatch[1]) extractedBaseQty = parseFloat(qtyMatch[1]);
           }
        } else {
           const detailsRow = data.find((r: any) => {
             const desc = (r.description || "").trim().toLowerCase();
             return desc.startsWith("details of cost for");
           });
           if (detailsRow) {
               const qtyMatch = detailsRow.description.match(/details of cost for ([\d.]+)/i);
               if (qtyMatch && qtyMatch[1]) extractedBaseQty = parseFloat(qtyMatch[1]);
           }
        }
        setBaseQty(extractedBaseQty);

        // Keep summary snapshots available for base-quantity extraction, but do not copy them as component rows.
        const analysisRows = data.filter((row: any) => row.row_type !== "CALC_SNAPSHOT");

        let cutoffIndex = analysisRows.findIndex((r: any, idx: number) => {
          const desc = (r.description || "").trim().toLowerCase();
          const mark = (r.mark || r.reference_mark || r.remark || "").toUpperCase();
          
          if (mark === "W") return true;

          if (desc === "total" || desc === "total:" || desc === "total :") {
             if (idx + 1 < analysisRows.length) {
                const nextDesc = (analysisRows[idx+1].description || "").trim().toLowerCase();
                if (nextDesc.includes("water charge") || nextDesc.includes("cpoh") || nextDesc.includes("gst")) return true;
             }
          }

          if (desc.includes("water charge") || desc.includes("cpoh") || desc.includes("c.p. & o.h") || desc.includes("contractor")) return true;

          return false;
        });
        
        const filteredData = cutoffIndex !== -1 ? analysisRows.slice(0, cutoffIndex) : analysisRows;

        const mappedRows = filteredData.map((r: any, idx: number) => {
          const itemCodeVal = r.code || r.component_code || "";
          const description = r.description || "";
          const isSpecialCalculation = r.row_type === "SCR" || (!itemCodeVal && !!getSpecialCalculationRule(description));
          const isNoteRow = !isSpecialCalculation && (typeof r.isNote === "boolean"
            ? r.isNote
            : r.row_type === "NCR" && (!r.amount || Number(r.amount) === 0));
          const row_type = isSpecialCalculation ? "SCR" : isNoteRow ? "NCR" : "CR";
          let extractedMark = r.mark || r.calc_mark || r.remarks || r.remark || r.reference_mark || r.ref || "";

          if (!extractedMark && itemCodeVal && itemCodeVal.includes(".")) {
             if (!itemCodeVal.startsWith("3.")) {
                 extractedMark = "A";
             }
          }

          return {
            id: Date.now() + idx,
            isNote: row_type === "NCR",
            row_type,
            code: itemCodeVal,
            description,
            unit: r.unit ?? "",
            quantity: formatAtLeastTwoDecimals(r.quantity ?? ""),
            rate: formatAtLeastTwoDecimals(r.rate ?? ""),
            amount: r.amount ?? 0,
            amount_override: r.amount_override ?? false,
            mark: extractedMark
          };
        });
        
        return recalculateSpecialRows(mappedRows);
      } else {
        alert(`No rate analysis is saved for item ${copySource}.`);
        return null;
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      alert(`Failed to load the source rate analysis: ${message}`);
      return null;
    }
  };

  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  // Excel's CPWD AR template totals the displayed 2-decimal component amounts.
  // Use the same values in the modal so A-mark exclusions and exported formula
  // caches reconcile exactly with the on-screen calculation.
  const totalAmount = roundMoney(rows.filter(r => getAnalysisRowType(r) !== "NCR")
    .reduce((sum, r) => sum + roundMoney(Number(r.amount) || 0), 0));
  const aAmount = roundMoney(rows.filter(r => getSingleLetterMark(r.mark) === "A" && getAnalysisRowType(r) !== "NCR")
    .reduce((sum, r) => sum + roundMoney(Number(r.amount) || 0), 0));
  const excludedAAmount = excludeAMarkedItems ? aAmount : 0;
  const suffix = excludeAMarkedItems && aAmount > 0 ? "-A" : "";
  // Match the rate-analysis components: financial overheads apply only to the
  // non-A portion when the A-exclusion option is enabled.
  const overheadBase = roundMoney(Math.max(0, totalAmount - excludedAAmount));
  const hasOverheadBase = overheadBase > 0;
  
  let finalTotalAmt = 0;
  let w = totalAmount, wc = 0, x = 0, gst = 0, y = 0, cpoh = 0, z = 0, cess = 0;
  let customChargeResults: any[] = [];
  const gstMultiplier = conventionalGstMultiplier ?? findConventionalGstMultiplier(rows);
  
  if (calcMethod === "Conventional DSR" && w > 0) {
    wc = roundMoney(overheadBase * 0.01);
    x = roundMoney(w + wc);
    gst = roundMoney(Math.max(0, x - excludedAAmount) * (gstMultiplier ?? 0));
    y = roundMoney(x + gst);
    cpoh = roundMoney(Math.max(0, y - excludedAAmount) * 0.15);
    z = roundMoney(y + cpoh);
    cess = roundMoney(Math.max(0, z - excludedAAmount) * 0.01);
    finalTotalAmt = roundMoney(z + cess);
  } else if (calcMethod === "Modified DSR" && w > 0) {
    wc = roundMoney(overheadBase * 0.01);
    x = roundMoney(w + wc);
    cpoh = roundMoney(Math.max(0, x - excludedAAmount) * 0.15);
    y = roundMoney(x + cpoh);
    cess = roundMoney(Math.max(0, y - excludedAAmount) * 0.01);
    z = roundMoney(y + cess);
    gst = roundMoney(Math.max(0, z - excludedAAmount) * 0.18);
    finalTotalAmt = roundMoney(z + gst);
  } else if (calcMethod === "Custom charges" && w > 0) {
    let runningTotal = w;
    customChargeResults = customCharges.map(charge => {
      const rate = Number(charge.rate) || 0;
      const base = Math.max(0, runningTotal - excludedAAmount);
      const amount = roundMoney(base * rate / 100);
      runningTotal = roundMoney(runningTotal + amount);
      return { ...charge, rate, amount, totalAfter: runningTotal };
    });
    finalTotalAmt = runningTotal;
  }

  type FinancialDisplayRow = {
    kind: "total" | "charge";
    label: string;
    amount: number;
    mark?: string;
    percentage?: number;
    dependentMark?: string;
    excludeAMarkedItems?: boolean;
  };
  const financialDisplayRows: FinancialDisplayRow[] = [];
  if (w > 0 && hasOverheadBase) {
        financialDisplayRows.push({ kind: "total", label: 'TOTAL "W"', amount: w, mark: "W" });
    if (calcMethod === "Custom charges") {
      let priorMark = "W";
      const nextMarks = ["X", "Y", "Z"];
      customChargeResults.forEach((charge, index) => {
        const chargeName = String(charge.name || "Charge").trim();
        const normalizedName = chargeName.toLowerCase();
        const displayName = normalizedName.includes("water") ? "Water charges"
          : normalizedName.includes("cpoh") || normalizedName.includes("contractor") ? "CPOH"
            : normalizedName.includes("cess") ? "Cess"
              : normalizedName.includes("gst") ? "GST" : chargeName;
        financialDisplayRows.push({
          kind: "charge",
          label: `Add ${displayName} @ ${charge.rate}% on (${priorMark}${suffix})`,
          amount: charge.amount,
          percentage: Number(charge.rate) || 0,
          dependentMark: priorMark,
          excludeAMarkedItems,
        });
        const nextMark = nextMarks[index];
        if (nextMark) {
          financialDisplayRows.push({ kind: "total", label: `TOTAL "${nextMark}"`, amount: charge.totalAfter, mark: nextMark });
          priorMark = nextMark;
        }
      });
    } else {
      financialDisplayRows.push({ kind: "charge", label: calcMethod === "Conventional DSR"
        ? `Add 1% Water charges on "W${suffix}"`
        : `Add Water charges @ 1% on "W${suffix}"`, amount: wc, percentage: 1, dependentMark: "W", excludeAMarkedItems });
      financialDisplayRows.push({ kind: "total", label: 'TOTAL "X"', amount: x, mark: "X" });
      if (calcMethod === "Conventional DSR") {
        if (gstMultiplier !== undefined) financialDisplayRows.push({ kind: "charge", label: `Add GST on "X${suffix}" (multiplying factor ${gstMultiplier})`, amount: gst, percentage: gstMultiplier * 100, dependentMark: "X", excludeAMarkedItems });
        financialDisplayRows.push({ kind: "total", label: 'TOTAL "Y"', amount: y, mark: "Y" });
        financialDisplayRows.push({ kind: "charge", label: `Add CPOH @ 15% on "Y${suffix}"`, amount: cpoh, percentage: 15, dependentMark: "Y", excludeAMarkedItems });
        financialDisplayRows.push({ kind: "total", label: 'TOTAL "Z"', amount: z, mark: "Z" });
        financialDisplayRows.push({ kind: "charge", label: `Add Cess @ 1% on "Z${suffix}"`, amount: cess, percentage: 1, dependentMark: "Z", excludeAMarkedItems });
      } else {
        financialDisplayRows.push({ kind: "charge", label: `Add CPOH @ 15% on "X${suffix}"`, amount: cpoh, percentage: 15, dependentMark: "X", excludeAMarkedItems });
        financialDisplayRows.push({ kind: "total", label: 'TOTAL "Y"', amount: y, mark: "Y" });
        financialDisplayRows.push({ kind: "charge", label: `Add Cess @ 1% on "Y${suffix}"`, amount: cess, percentage: 1, dependentMark: "Y", excludeAMarkedItems });
        financialDisplayRows.push({ kind: "total", label: 'TOTAL "Z"', amount: z, mark: "Z" });
        financialDisplayRows.push({ kind: "charge", label: `Add GST @ 18% on "Z${suffix}"`, amount: gst, percentage: 18, dependentMark: "Z", excludeAMarkedItems });
      }
    }
  }

  const calculatedRateNum = baseQty > 0 ? roundMoney(finalTotalAmt / baseQty) : 0;
  const roundedSayRate = (Math.round(calculatedRateNum * 20) / 20).toFixed(2);

  const getExportRows = () => {
    const exportRows = rows.filter((row: any) => row.row_type !== "CALC_SNAPSHOT").map((row: any) => ({ ...row }));
    if (!isParentHeading && !isExternalAR && w > 0) {
      financialDisplayRows.forEach(row => exportRows.push({
        row_type: "CALC_SNAPSHOT",
        type: row.kind === "total" ? "TOTAL" : "CALC",
        isTotal: row.kind === "total",
        code: "",
        description: row.label,
        unit: "",
        quantity: null,
        rate: null,
        amount: row.amount,
        mark: row.mark || "",
        percentage: row.percentage,
        dependentMark: row.dependentMark,
        excludeAMarkedItems: row.excludeAMarkedItems,
      }));
      exportRows.push(
        { row_type: "CALC_SNAPSHOT", type: "TOTAL", isTotal: true, description: `Cost of ${Number(baseQty).toFixed(2)} ${unit}`, amount: finalTotalAmt, unit: "", quantity: null, rate: null, mark: "" },
        { row_type: "CALC_SNAPSHOT", type: "UNIT_RATE", isUnitRate: true, baseQty: Number(baseQty) || 1, description: `Cost of 1.00 ${unit}`, amount: calculatedRateNum, unit: "", quantity: null, rate: null, mark: "" },
        { row_type: "CALC_SNAPSHOT", type: "SAY", isSayRow: true, description: "SAY", amount: Number(roundedSayRate), unit: "", quantity: null, rate: null, mark: "" },
      );
    }

    return exportRows;
  };

  const getExportData = () => ({
    itemNo: itemCode,
    itemCode,
    description,
    unit: isParentHeading ? "" : unit,
    baseQty,
    analysisRows: getExportRows(),
  });

  const handleExportExcel = async () => {
    try {
      await exportSingleRANSItemToExcel({ ...getExportData(), projectDetails }, sourceConfigurationLocked ? copySource : "");
    } catch (error) {
      console.error("Could not export the NSR rate analysis:", error);
      alert(error instanceof Error ? error.message : "Could not export the NSR rate analysis.");
    }
  };

  const handleExportPdf = () => {
    try {
      exportSingleRANSItemToPdf(getExportData(), sourceConfigurationLocked ? copySource : "", projectDetails);
    } catch (error) {
      console.error("Could not export the NSR rate analysis PDF:", error);
      alert(error instanceof Error ? error.message : "Could not export the NSR rate analysis PDF.");
    }
  };

  const handleSubmit = async () => {
    const normalizedItemCode = String(itemCode || "").trim();
    if (!/^(50|51)(?:\.\d+[A-Za-z]?)+$/.test(normalizedItemCode)) {
      alert("Enter a valid SH 50 or SH 51 item code, for example 51.501.");
      return;
    }
    const candidateCode = normalizedItemCode.toLowerCase();
    const editingCode = String(initialData?.code || "").trim().toLowerCase();
    const duplicateCode = [...rates, ...existingItemCodes].some((entry: any) => {
      const existingCode = getExistingCode(entry);
      return existingCode === candidateCode && existingCode !== editingCode;
    });
    if (duplicateCode) {
      setIsDuplicate(true);
      alert("This item number is already stored. Please choose another number.");
      return;
    }
    setIsDuplicate(false);
    if (isExternalAR && (!description.trim() || !unit.trim() || externalRate.trim() === "" || !Number.isFinite(Number(externalRate)) || Number(externalRate) < 0)) {
      alert("For an External AR item, enter a description, unit, and a valid non-negative final rate.");
      return;
    }

    const savedRows = [...rows];
    let currentId = Date.now();
    
    const addCalcRow = (
      desc: string,
      amt: string,
      mark: string = "",
      isHeader = false,
      formulaMetadata: Record<string, unknown> = {},
    ) => {
       savedRows.push({
         id: currentId++, isNote: true, code: "", description: desc,
         unit: "", quantity: "", rate: "", amount: isHeader ? 0 : amt, mark, row_type: "CALC_SNAPSHOT", ...formulaMetadata
       });
    };

    if (!isParentHeading && !isExternalAR && w > 0) {
      financialDisplayRows.forEach(row => addCalcRow(row.label, row.amount.toFixed(2), row.mark || "", false, {
        type: row.kind === "total" ? "TOTAL" : "CALC",
        isTotal: row.kind === "total",
        percentage: row.percentage,
        dependentMark: row.dependentMark,
        excludeAMarkedItems: row.excludeAMarkedItems,
      }));
      addCalcRow(`Cost of ${Number(baseQty).toFixed(2)} ${unit}`, finalTotalAmt.toFixed(2), "", false, { type: "TOTAL", isTotal: true });
      addCalcRow(`Cost of 1.00 ${unit}`, calculatedRateNum.toFixed(2), "", false, { type: "UNIT_RATE", isUnitRate: true, baseQty: Number(baseQty) || 1 });
      addCalcRow("SAY", roundedSayRate, "", false, { type: "SAY", isSayRow: true });
    }
    const persistedBaseQty = !isParentHeading && !isExternalAR && Number.isFinite(Number(baseQty)) && Number(baseQty) > 0
      ? Number(baseQty)
      : null;
    const persistedSourceItemCode = sourceConfigurationLocked && copySource.trim() ? copySource.trim() : null;
    try {
      await onAddNSR({
        code: normalizedItemCode,
        description,
        unit: isParentHeading ? "" : unit,
        rate: isExternalAR ? Number(externalRate) : isParentHeading ? 0 : Number(roundedSayRate),
        analysisRows: isParentHeading || isExternalAR ? [] : savedRows,
        isExternalAR,
        isParentHeading,
        baseQty: persistedBaseQty,
        sourceItemCode: persistedSourceItemCode,
        calcMethod,
        clcPeriod,
        clcArea,
        conventionalGstMultiplier: gstMultiplier,
        customCharges: customCharges.map(charge => ({ ...charge })),
        excludeAMarkedItems,
        nsrSettings: {
          isParentHeading,
          baseQty: persistedBaseQty,
          sourceItemCode: persistedSourceItemCode,
          calcMethod,
          clcPeriod,
          clcArea,
          conventionalGstMultiplier: gstMultiplier,
          customCharges: customCharges.map(charge => ({ ...charge })),
          excludeAMarkedItems,
        },
      });
    } catch (error) {
      console.error("Failed to save NSR item:", error);
      alert("The NSR item could not be saved. Please try again.");
    }
  };

  const validateSuggestedItemCode = () => {
    const candidate = String(itemCode || "").trim().toLowerCase();
    const editingCode = String(initialData?.code || "").trim().toLowerCase();
    const duplicates = candidate.length > 0 && [...rates, ...existingItemCodes].some((entry: any) => {
      const code = getExistingCode(entry);
      return code === candidate && code !== editingCode;
    });
    setIsDuplicate(duplicates);
    return !duplicates;
  };

  const handleSourceConfiguration = async () => {
    if (sourceConfigurationLocked) {
      setSourceConfigurationLocked(false);
      return;
    }
    if (!copySource.trim()) return;
    setApplyingConfiguration(true);
    try {
      const sourceRows = await loadSourceAnalysis();
      if (!sourceRows) return;
      setRows(sourceRows);
      setSourceConfigurationLocked(true);
    } finally {
      setApplyingConfiguration(false);
    }
  };

  const toggleParentHeading = (checked: boolean) => {
    setIsParentHeading(checked);
    if (checked) {
      setUnit("");
      setBaseQty(0);
    } else {
      setUnit((current: string) => current || "cum");
      setBaseQty(current => current > 0 ? current : 1);
    }
  };

  return (
    <div data-theme-panel="create-nsr" className="flex flex-col bg-olive-card text-slate-900 dark:bg-slate-900 dark:text-slate-100 w-full h-full max-h-[90vh] rounded-xl overflow-hidden font-sans">
      <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-slate-700">
         <div>
            <h2 className="text-xl font-bold text-amber-500 dark:text-amber-300">{initialData ? "Edit Custom Item" : "Create NSR item"}</h2>
         </div>
         <button onClick={onClose} className="font-bold flex items-center gap-1 hover:text-rose-600 transition-colors">✕ Close</button>
      </div>
      
      <div className="p-6 overflow-y-auto flex-1 space-y-6">
         <section className="flex flex-wrap items-center gap-5 rounded border border-slate-300 bg-olive-light p-3 dark:border-slate-700 dark:bg-slate-800">
            <label className="flex flex-col gap-1 text-sm font-bold text-gray-800 dark:text-slate-200">Item Code
               <input type="text" value={itemCode} disabled={!!initialData} onChange={e => { setItemCode(e.target.value); setItemCodeEdited(true); setIsDuplicate(false); }} onBlur={validateSuggestedItemCode} aria-invalid={isDuplicate} aria-describedby={isDuplicate ? "item-code-warning" : undefined} className={`w-36 rounded border bg-olive-card px-2 py-2 font-mono text-sm font-bold text-gray-800 outline-none focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 ${isDuplicate ? "border-red-500 focus:ring-red-100" : "border-gray-300 focus:border-blue-500 focus:ring-blue-100"} disabled:bg-gray-100 dark:disabled:bg-slate-800`} placeholder="51.1" title={initialData ? "Item codes stay fixed when editing saved items." : "Accept the suggested sequential item number or enter another unused number."} />
               {isDuplicate && <span id="item-code-warning" className="max-w-64 text-xs font-semibold text-red-600">This item number is already stored. Please choose another number.</span>}
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
               <input type="checkbox" checked={isExternalAR} onChange={e => { const checked = e.target.checked; setIsExternalAR(checked); if (checked) { setIsParentHeading(false); setExternalRate(previous => previous.trim() ? previous : roundedSayRate); } }} className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
               <span className="text-sm font-bold text-violet-900 dark:text-violet-300">External rate analysis (prepared outside software)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
               <input type="checkbox" checked={isParentHeading} disabled={isExternalAR} onChange={e => toggleParentHeading(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50" />
               <span className="text-sm font-bold text-gray-800 dark:text-slate-200">Parent heading only</span>
            </label>
         </section>

         <div className="flex flex-wrap md:flex-nowrap gap-6 w-full">
            <div className="flex flex-col gap-1 w-full md:w-64 shrink-0">
               <label className="text-xs font-bold text-gray-700 dark:text-slate-300">Item family</label>
               <select disabled={!!initialData} value={itemFamily} onChange={e => { setItemCodeEdited(false); setItemFamily(e.target.value); }} className="p-2 border border-gray-300 dark:border-slate-600 rounded bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 outline-none font-semibold focus:border-blue-500 disabled:opacity-50">
                  <option value="51">NSR - SH 51</option>
                  <option value="50">mDSR - SH 50</option>
               </select>
            </div>
            <div className="flex flex-col gap-1 w-full md:w-64 shrink-0">
               <label className="text-xs font-bold text-gray-700 dark:text-slate-300">Parent item</label>
               <select value={parentItem} onChange={e => { setItemCodeEdited(false); setParentItem(e.target.value); }} className="p-2 border border-gray-300 dark:border-slate-600 rounded bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 outline-none font-semibold focus:border-blue-500">
                  <option value="Top-level item">Top-level item</option>
                  <option value="Item having (AR)">Item having (AR)</option>
                  {availableParents.map((p: any, index: number) => (
                    <option key={`${p.code}-${p.category || ""}-${index}`} value={p.code}>{p.code}</option>
                  ))}
               </select>
            </div>
         </div>

         <section className="grid grid-cols-1 gap-3 rounded border border-sky-200 bg-sky-50 p-4 dark:border-slate-700 dark:bg-slate-800 md:grid-cols-[minmax(240px,1fr)_auto] md:items-end">
            <label className="flex min-w-0 flex-col gap-1 text-xs font-bold text-gray-700 dark:text-slate-300">Optional Source Item Code
               <input list="rate-codes" type="text" placeholder="Optional source item code" value={copySource} disabled={sourceConfigurationLocked} onChange={e => handleCopySourceSelect(e.target.value)} className="min-w-0 rounded border border-gray-300 bg-olive-card p-2 text-sm font-semibold outline-none focus:border-sky-600 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 disabled:bg-gray-100 dark:disabled:bg-slate-700" />
               <datalist id="rate-codes">{rates.map((r: any, index: number) => <option key={`${r.code}-${r.category || ""}-${index}`} value={r.code}>{r.description?.substring(0, 40)}...</option>)}</datalist>
            </label>
            <button type="button" onClick={handleSourceConfiguration} disabled={!sourceConfigurationLocked && (!copySource.trim() || applyingConfiguration)} className={`whitespace-nowrap rounded px-4 py-2 text-sm font-bold text-white shadow ${sourceConfigurationLocked ? "bg-amber-600 hover:bg-amber-700" : "bg-sky-700 hover:bg-sky-800"} disabled:cursor-not-allowed disabled:opacity-50`}>
               {sourceConfigurationLocked ? "Modify this configuration" : applyingConfiguration ? "Loading…" : "Load Source Analysis"}
            </button>
            {sourceConfigurationLocked && <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 md:col-span-2">Source analysis loaded and locked.</p>}
         </section>

         <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)]">
            <section className="flex min-h-full gap-4 rounded border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
               <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label className="text-xs font-bold text-gray-700 dark:text-slate-300">Item Description</label>
                  <textarea ref={mainDescRef} value={description} onChange={e => setDescription(e.target.value)} className="min-h-[80px] resize-none overflow-hidden rounded border border-gray-300 bg-white p-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" placeholder="Description..." />
               </div>
               <div className="grid w-56 shrink-0 grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs font-bold text-gray-700 dark:text-slate-300">Unit
                     <select value={unit} disabled={isParentHeading} onChange={e => setUnit(e.target.value)} className="rounded border border-gray-300 bg-olive-card p-2 text-sm font-semibold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 disabled:bg-gray-100">
                        <option value="cum">cum</option><option value="sqm">sqm</option><option value="rm">rm</option><option value="kg">kg</option><option value="each">each</option>
                     </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-bold text-gray-700 dark:text-slate-300">{isExternalAR ? "Final Rate (₹)" : "Base Qty"}
                     {isExternalAR
                       ? <input type="number" inputMode="decimal" value={externalRate} onChange={e => setExternalRate(e.target.value)} className="rounded border border-gray-300 bg-white p-2 text-right text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" placeholder="0.00" />
                       : <input type="number" value={baseQty || ""} disabled={isParentHeading} onChange={e => setBaseQty(Number(e.target.value))} className="rounded border border-gray-300 bg-white p-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 disabled:bg-gray-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />}
                  </label>
               </div>
            </section>

            <section className="flex flex-col gap-3 rounded border border-indigo-200 bg-indigo-50 p-4 dark:border-slate-700 dark:bg-slate-800">
               <h3 className="text-sm font-extrabold text-indigo-950 dark:text-indigo-200">Rate Logic Configuration</h3>
               {configurationLocked ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                     <span className="font-semibold">{calcMethod} | CLC: {CLC_PERIODS.find(option => option.value === clcPeriod)?.label.replace(/^w\.e\.f\.\s*/i, "") || clcPeriod} | {clcArea} Area</span>
                     <button type="button" onClick={() => {
                        const confirmed = window.confirm("⚠️ Warning: Modifying these settings will recalculate base rates and overheads for all rows below. Proceed?");
                        if (confirmed) setConfigurationLocked(false);
                     }} className="whitespace-nowrap rounded bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow hover:bg-amber-700">✏️ Edit Configuration</button>
                  </div>
               ) : (
                  <>
                     <label className="flex flex-col gap-1 text-xs font-bold text-gray-700 dark:text-slate-300">Calculation Method
                        <select value={calcMethod} disabled={isExternalAR || isParentHeading} onChange={e => changeCalculationMethod(e.target.value)} className="rounded border border-gray-300 bg-olive-card p-2 text-sm font-semibold outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 disabled:bg-gray-100">
                           <option>Conventional DSR</option><option>Modified DSR</option><option>Custom charges</option>
                        </select>
                     </label>
                     <label className="flex flex-col gap-1 text-xs font-bold text-gray-700 dark:text-slate-300">CLC Period
                        <select value={clcPeriod} disabled={isExternalAR || isParentHeading} onChange={e => setClcPeriod(e.target.value)} className="rounded border border-gray-300 bg-olive-card p-2 text-sm font-semibold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 disabled:bg-gray-100">
                           {[...CLC_PERIODS].reverse().map(option => <option key={option.value} value={option.value}>{option.label.replace(/^w\.e\.f\.\s*/i, "")}</option>)}
                        </select>
                     </label>
                     <label className="flex flex-col gap-1 text-xs font-bold text-gray-700 dark:text-slate-300">Area
                        <select value={clcArea} disabled={isExternalAR || isParentHeading} onChange={e => setClcArea(e.target.value)} className="rounded border border-gray-300 bg-olive-card p-2 text-sm font-semibold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 disabled:bg-gray-100">
                           <option value="A">A Area</option><option value="B">B Area</option><option value="C">C Area</option>
                        </select>
                     </label>
                     <button type="button" onClick={applyConfiguration} disabled={isExternalAR || isParentHeading || applyingConfiguration || applyingClc} className="mt-auto rounded bg-indigo-700 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50">
                        {applyingConfiguration ? "Applying…" : "Apply Configuration"}
                     </button>
                  </>
               )}
            </section>
         </div>

          {isExternalAR && <div className="rounded border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200">This item uses the manually entered final rate. No internal rate analysis rows will be saved or required.</div>}

          {!isParentHeading && !isExternalAR && (
            <div className="mt-2">
               <div className="flex justify-between items-end mb-2">
                  <h3 className="font-bold uppercase text-slate-800 dark:text-slate-100 text-sm">RATE ANALYSIS ROWS</h3>
                  <div className="flex items-center gap-2 rounded border border-gray-300 bg-gray-100 p-1 dark:border-slate-700 dark:bg-slate-800">
                     <span className="pl-2 text-xs font-bold text-gray-600 dark:text-slate-300">Add</span>
                     <input type="number" min="1" value={numRowsToAdd} onChange={e => setNumRowsToAdd(Number(e.target.value))} className="w-12 rounded border border-gray-300 bg-white p-1 text-center text-xs text-slate-900 outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                     <span className="text-xs font-bold text-gray-600 dark:text-slate-300">rows</span>
                     <button onClick={insertNRows} type="button" className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-bold shadow transition-colors ml-1">+</button>
                  </div>
               </div>
               
               <div className="rounded overflow-x-auto shadow-sm pb-1">
                  <table className="w-full min-w-[900px] border-collapse bg-olive-card text-left text-sm dark:bg-slate-900">
                     <thead className="border-b border-gray-300 bg-gray-100 font-bold text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        <tr>
                           <th className="w-10 border border-gray-300 p-2 text-center dark:border-slate-700">SL</th>
                           <th className="w-20 border border-gray-300 p-2 text-center dark:border-slate-700">Type</th>
                           <th className="w-28 border border-gray-300 p-2 dark:border-slate-700">Code</th>
                           <th className="border border-gray-300 p-2 dark:border-slate-700">Description</th>
                           <th className="w-20 border border-gray-300 p-2 dark:border-slate-700">Unit</th>
                           <th className="w-24 border border-gray-300 p-2 dark:border-slate-700">Quantity</th>
                           <th className="w-24 border border-gray-300 p-2 dark:border-slate-700">Rate</th>
                           <th className="w-28 border border-gray-300 p-2 text-right dark:border-slate-700">Amount</th>
                           <th className="w-20 border border-gray-300 p-2 text-center dark:border-slate-700">Mark</th>
                           <th className="w-16 border border-gray-300 p-2 text-center dark:border-slate-700">Action</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                        {rows.map((row, idx) => (
                           <tr key={row.id} className="group bg-olive-card transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800">
                              <td className="border border-gray-300 p-2 text-center align-top font-bold text-gray-900 dark:border-slate-700 dark:text-slate-200">{idx + 1}</td>
                              <td className="border border-gray-300 p-0 align-top dark:border-slate-700">
                                 <select value={getAnalysisRowType(row)} onChange={e => updateRow(row.id, "row_type", e.target.value)} className="w-full h-9 px-1 text-xs font-bold bg-olive-card border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 rounded outline-none focus:border-blue-500">
                                    <option value="CR">CR</option>
                                    <option value="NCR">NCR</option>
                                    <option value="SCR">SCR</option>
                                 </select>
                              </td>
                              <td className="border border-gray-300 p-0 align-top dark:border-slate-700">
                                 <input 
                                    id={`matrix-input-${idx}-0`}
                                    type="text" 
                                    value={row.code} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => updateRow(row.id, 'code', e.target.value)} 
                                    onKeyDown={e => handleCellKeyDown(e, idx, 0, row.id)}
                                    onBlur={() => lookupCode(row.id, row.code)} // Safely fire if they click away instead of pressing Enter
                                    disabled={getAnalysisRowType(row) !== "CR"} 
                                    placeholder={getAnalysisRowType(row) === "NCR" ? "Note" : "Code"} 
                                    className="h-full min-h-[36px] w-full bg-transparent p-2 font-semibold text-slate-900 outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 dark:text-slate-100 dark:focus:bg-blue-950/50 dark:disabled:bg-slate-800 dark:disabled:text-slate-500" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top dark:border-slate-700">
                                 <textarea 
                                    id={`matrix-input-${idx}-1`}
                                    ref={(el) => { textareaRefs.current[row.id] = el; }}
                                    value={row.description} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => {
                                      updateRow(row.id, 'description', e.target.value);
                                      adjustTextareaHeight(e.target);
                                    }} 
                                    onKeyDown={e => handleCellKeyDown(e, idx, 1, row.id)}
                                    className="block h-full min-h-[36px] w-full resize-none overflow-hidden bg-transparent p-2 text-justify font-semibold leading-tight text-slate-900 outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:text-slate-100 dark:focus:bg-blue-950/50" 
                                    placeholder={getAnalysisRowType(row) === "NCR" ? "Note text..." : getAnalysisRowType(row) === "SCR" ? "Special calculation description (e.g. 100% of P)" : "Description..."} 
                                    rows={1}
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top dark:border-slate-700">
                                 <input 
                                    id={`matrix-input-${idx}-2`}
                                    type="text" 
                                    value={row.unit} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => updateRow(row.id, 'unit', e.target.value)} 
                                    onKeyDown={e => handleCellKeyDown(e, idx, 2, row.id)}
                                    disabled={getAnalysisRowType(row) !== "CR"} 
                                    className="h-full min-h-[36px] w-full bg-transparent p-2 font-semibold text-slate-900 outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 dark:text-slate-100 dark:focus:bg-blue-950/50 dark:disabled:bg-slate-800 dark:disabled:text-slate-500" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top dark:border-slate-700">
                                 <input 
                                    id={`matrix-input-${idx}-3`}
                                    type="text"
                                    inputMode="decimal"
                                    value={row.quantity} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => updateRow(row.id, 'quantity', e.target.value)} 
                                    onBlur={e => updateRow(row.id, 'quantity', formatAtLeastTwoDecimals(e.target.value))}
                                    onKeyDown={e => handleCellKeyDown(e, idx, 3, row.id)}
                                    disabled={getAnalysisRowType(row) !== "CR"} 
                                    className="h-full min-h-[36px] w-full bg-transparent p-2 text-right font-semibold text-slate-900 outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 dark:text-slate-100 dark:focus:bg-blue-950/50 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top dark:border-slate-700">
                                 <input 
                                    id={`matrix-input-${idx}-4`}
                                    type="text"
                                    inputMode="decimal"
                                    value={row.rate} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => updateRow(row.id, 'rate', e.target.value)} 
                                    onBlur={e => updateRow(row.id, 'rate', formatAtLeastTwoDecimals(e.target.value))}
                                    onKeyDown={e => handleCellKeyDown(e, idx, 4, row.id)}
                                    disabled={getAnalysisRowType(row) !== "CR"} 
                                    className="h-full min-h-[36px] w-full bg-transparent p-2 text-right font-semibold text-slate-900 outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 dark:text-slate-100 dark:focus:bg-blue-950/50 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top">
                                 {getAnalysisRowType(row) === "SCR" ? (
                                    <input type="text" inputMode="decimal" value={activeRowId === row.id ? row.amount ?? "" : formatIndianAmount(row.amount)} onFocus={() => setActiveRowId(row.id)} onBlur={() => setActiveRowId(null)} onChange={e => updateRow(row.id, "amount", e.target.value)} className="w-full h-full min-h-[36px] p-2 text-right font-bold text-slate-800 dark:text-slate-100 font-mono bg-transparent outline-none focus:bg-blue-50 focus:ring-inset focus:ring-2 focus:ring-blue-500" aria-label="Special calculation amount" />
                                 ) : getAnalysisRowType(row) === "CR" ? (
                                    <div className="p-2 text-right font-bold text-slate-800 dark:text-slate-100 font-mono">{formatIndianAmount(row.amount)}</div>
                                 ) : null}
                              </td>
                              <td className="border border-gray-300 p-0 align-top">
                                 <input 
                                    id={`matrix-input-${idx}-5`}
                                    type="text" 
                                    value={row.mark} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => updateRow(row.id, 'mark', e.target.value)} 
                                    onKeyDown={e => handleCellKeyDown(e, idx, 5, row.id)}
                                    className="w-full h-full min-h-[36px] p-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-inset focus:ring-2 focus:ring-blue-500 font-semibold text-center uppercase" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top text-center relative w-16">
                                 <div className="flex justify-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                                    <button onClick={() => insertRowBelow(idx)} type="button" className="bg-emerald-500 hover:bg-emerald-600 text-white w-6 h-6 rounded flex items-center justify-center text-sm shadow" title="Add row below">+</button>
                                    <button onClick={() => deleteRow(row.id)} type="button" className="bg-rose-500 hover:bg-rose-600 text-white w-6 h-6 rounded flex items-center justify-center text-xs shadow" title="Delete row">✕</button>
                                 </div>
                              </td>
                           </tr>
                        ))}
                        
                        {financialDisplayRows.map((financialRow, index) => (
                          <tr key={`financial-${index}`} className={`pointer-events-none ${financialRow.kind === "total" ? "bg-emerald-100 dark:bg-emerald-950/70" : "bg-emerald-50 dark:bg-emerald-950/40"}`}>
                            <td className="border border-gray-300 p-2 text-center text-gray-500 dark:border-slate-700 dark:text-slate-400">{rows.length + index + 1}</td>
                            <td colSpan={6} className={`border border-gray-300 p-2 pr-6 text-right dark:border-slate-700 ${financialRow.kind === "total" ? "font-bold text-emerald-900 dark:text-emerald-200" : "text-emerald-800 dark:text-emerald-300"}`}>{financialRow.label}</td>
                            <td className={`border border-gray-300 p-2 text-right font-mono dark:border-slate-700 ${financialRow.kind === "total" ? "font-bold text-emerald-900 dark:text-emerald-200" : "text-emerald-700 dark:text-emerald-300"}`}>{formatIndianAmount(financialRow.amount)}</td>
                            <td className="border border-gray-300 p-2 text-center font-bold dark:border-slate-700">{financialRow.mark || ""}</td>
                            <td className="border border-gray-300 dark:border-slate-700"></td>
                          </tr>
                        ))}
                        {w > 0 && (
                          <>
                            <tr className="pointer-events-none bg-emerald-100 dark:bg-emerald-950/70">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + financialDisplayRows.length + 1}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 pr-6 text-right font-bold text-emerald-900 dark:border-slate-700 dark:text-emerald-200">Cost of {Number(baseQty).toFixed(2)} {unit}</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900 dark:border-slate-700 dark:text-emerald-200">{formatIndianAmount(finalTotalAmt)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                            </tr>
                            <tr className="pointer-events-none bg-emerald-50 dark:bg-emerald-950/40">
                              <td className="border border-gray-300 p-2 text-center text-gray-500">{rows.length + financialDisplayRows.length + 2}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 pr-6 text-right font-bold text-emerald-800 dark:border-slate-700 dark:text-emerald-300">Cost of 1.00 {unit}</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700 dark:border-slate-700 dark:text-emerald-300">{formatIndianAmount(calculatedRateNum)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                            </tr>
                            <tr className="bg-emerald-600 text-white pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-200 font-bold">{rows.length + financialDisplayRows.length + 3}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 font-bold text-right pr-6 tracking-wider">SAY</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-white">{formatIndianAmount(roundedSayRate)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                            </tr>
                          </>
                        )}
                    </tbody>
                  </table>
               </div>
            </div>
         )}
      </div>
      
      <div className="flex items-center justify-end gap-4 border-t border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-950">
         <button onClick={onClose} type="button" className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded shadow transition-colors text-sm">Cancel</button>
         <button onClick={() => void handleExportExcel()} type="button" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded shadow transition-colors text-sm">Export to Excel</button>
         <button onClick={handleExportPdf} type="button" className="bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 px-6 rounded shadow transition-colors text-sm">Export to PDF</button>
         <button onClick={handleSubmit} type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded shadow transition-colors text-sm">{initialData ? "Update NSR" : "Save NSR"}</button>
      </div>
      {isCustomChargesOpen && (
        <div className="fixed inset-0 z-[10050] bg-black/70 flex items-center justify-center p-4" onMouseDown={() => { setIsCustomChargesOpen(false); setCalcMethod(previousCalcMethod.current); }}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-olive-card text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100" onMouseDown={event => event.stopPropagation()}>
            <div className="border-b border-slate-200 p-5 dark:border-slate-700"><h2 className="text-xl font-bold text-blue-700 dark:text-blue-300">Custom charges</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Modified DSR values are prefilled. Edit rates and move charges to change the application order. Each charge applies to the running total.</p></div>
            <div className="p-5 space-y-4">
              <label className="flex gap-3 rounded bg-slate-50 p-3 text-sm"><input type="checkbox" checked={excludeAMarkedDraft} onChange={e => setExcludeAMarkedDraft(e.target.checked)} /><span><b>Exclude A-marked amounts</b><span className="block text-slate-500">Enabled by default to match Modified DSR.</span></span></label>
              <div className="grid grid-cols-[1fr_120px_112px] gap-2 text-xs font-bold uppercase text-slate-500"><span>Charge name</span><span>Rate (%)</span><span>Order</span></div>
              {customChargesDraft.map((charge, index) => <div key={charge.id} className="grid grid-cols-[1fr_120px_112px] gap-2 items-center"><input value={charge.name} onChange={e => setCustomChargesDraft(prev => prev.map((c,i) => i === index ? {...c,name:e.target.value} : c))} className="min-w-0 rounded border px-3 py-2" placeholder="Charge name" /><input type="number" min="0" step="0.01" value={charge.rate} onChange={e => setCustomChargesDraft(prev => prev.map((c,i) => i === index ? {...c,rate:e.target.value} : c))} className="w-full rounded border px-3 py-2 text-right" aria-label={charge.name + " percentage"} /><div className="flex gap-1 justify-end"><button type="button" disabled={!index} onClick={() => setCustomChargesDraft(prev => { const copy=[...prev]; [copy[index-1],copy[index]]=[copy[index],copy[index-1]]; return copy; })} className="rounded bg-slate-200 px-2 py-2 disabled:opacity-40">↑</button><button type="button" disabled={index === customChargesDraft.length-1} onClick={() => setCustomChargesDraft(prev => { const copy=[...prev]; [copy[index+1],copy[index]]=[copy[index],copy[index+1]]; return copy; })} className="rounded bg-slate-200 px-2 py-2 disabled:opacity-40">↓</button><button type="button" onClick={() => setCustomChargesDraft(prev => prev.filter((_,i) => i !== index))} className="rounded bg-rose-100 px-2 py-2 text-rose-700">×</button></div></div>)}
              <button type="button" onClick={() => setCustomChargesDraft(prev => [...prev, {id:"charge-" + Date.now(),name:"Custom charge",rate:"0"}])} className="rounded bg-blue-50 px-4 py-2 font-semibold text-blue-700">+ Add a charge</button>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 p-4 dark:border-slate-700"><button type="button" onClick={() => {setIsCustomChargesOpen(false);setCalcMethod(previousCalcMethod.current);}} className="rounded bg-slate-200 px-5 py-2 font-bold text-slate-800 dark:bg-slate-700 dark:text-slate-100">Cancel</button><button type="button" onClick={saveCustomCharges} disabled={!customChargesDraft.length} className="rounded bg-emerald-600 px-5 py-2 font-bold text-white disabled:opacity-50">Save and use</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

