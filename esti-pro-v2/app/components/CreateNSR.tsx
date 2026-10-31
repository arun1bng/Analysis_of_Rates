import React, { useState, useEffect, useRef } from "react";

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

const DEFAULT_CUSTOM_CHARGES = [
  { id: "water", name: "Water charges", rate: "1" },
  { id: "cpoh", name: "CPOH", rate: "15" },
  { id: "cess", name: "Cess", rate: "1" },
  { id: "gst", name: "GST", rate: "18" },
];
const CUSTOM_CHARGES_STORAGE_KEY = "esti-pro-nsr-custom-charges-v1";

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

export default function CreateNSR({ onAddNSR, onClose, rates = [], initialData = null }: any) {
  const [itemFamily, setItemFamily] = useState(initialData ? initialData.code.split('.')[0] : "51");
  const [itemCode, setItemCode] = useState(initialData ? initialData.code : "");
  const [parentItem, setParentItem] = useState("Top-level item");
  const [copySource, setCopySource] = useState("");
  const [description, setDescription] = useState(initialData ? initialData.description : "");
  const [unit, setUnit] = useState(initialData ? initialData.unit : "cum");
  const [baseQty, setBaseQty] = useState<number>(1);
  const [calcMethod, setCalcMethod] = useState("Conventional DSR");
  const [isExternalAR, setIsExternalAR] = useState(Boolean(initialData?.isExternalAR ?? initialData?.is_external_ar));
  const [externalRate, setExternalRate] = useState(String(initialData?.rate ?? ""));
  const [customCharges, setCustomCharges] = useState<any[]>(DEFAULT_CUSTOM_CHARGES);
  const [customChargesDraft, setCustomChargesDraft] = useState<any[]>(DEFAULT_CUSTOM_CHARGES);
  const [excludeAMarkedItems, setExcludeAMarkedItems] = useState(true);
  const [excludeAMarkedDraft, setExcludeAMarkedDraft] = useState(true);
  const [isCustomChargesOpen, setIsCustomChargesOpen] = useState(false);
  const previousCalcMethod = useRef("Conventional DSR");
  const [isParentHeading, setIsParentHeading] = useState(initialData ? (!initialData.unit && Number(initialData.rate) === 0) : false);
  
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

  const availableParents = rates
    .filter((r: any) => r.code && r.code.startsWith(`${itemFamily}.`) && (!r.rate || Number(r.rate) === 0))
    .sort((a: any, b: any) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }));

  useEffect(() => {
    if (initialData) return;
    
    if (parentItem === "Top-level item" || parentItem === "Item having (AR)") {
      const familyRates = rates.filter((r: any) => r.code && r.code.startsWith(`${itemFamily}.`));
      let maxNum = 0;
      familyRates.forEach((r: any) => {
        const parts = r.code.split('.');
        if (parts.length === 2) {
          const num = parseInt(parts[1], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      });
      setItemCode(`${itemFamily}.${maxNum + 1}`);
    } else {
      const parentPartsLen = parentItem.split('.').length;
      const childRates = rates.filter((r: any) => r.code && r.code.startsWith(`${parentItem}.`));
      let maxNum = 0;
      childRates.forEach((r: any) => {
        const parts = r.code.split('.');
        if (parts.length === parentPartsLen + 1) {
          const num = parseInt(parts[parentPartsLen], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      });
      setItemCode(`${parentItem}.${maxNum + 1}`);
    }
  }, [itemFamily, parentItem, rates, initialData]);

  const insertNRows = () => {
    const newRows = Array.from({ length: Math.max(1, numRowsToAdd) }).map((_, i) => ({
      id: Date.now() + i, isNote: false, row_type: "CR", code: "", description: "", unit: "", quantity: "", rate: "", amount: 0, mark: ""
    }));
    setRows([...rows, ...newRows]);
  };

  const insertRowBelow = (index: number) => {
    const newRow = { id: Date.now(), isNote: false, row_type: "CR", code: "", description: "", unit: "", quantity: "", rate: "", amount: 0, mark: "" };
    const newRows = [...rows];
    newRows.splice(index + 1, 0, newRow);
    setRows(newRows);
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
    const isNumber = target.type === 'number';
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

  const loadSourceAnalysis = async () => {
    if (!copySource) return;
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
            quantity: r.quantity ?? "",
            rate: r.rate ?? "",
            amount: r.amount ?? 0,
            amount_override: r.amount_override ?? false,
            mark: extractedMark
          };
        });
        
        setRows(recalculateSpecialRows(mappedRows));
      } else {
        alert(`No rate analysis is saved for item ${copySource}.`);
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      alert(`Failed to load the source rate analysis: ${message}`);
    }
  };

  const totalAmount = rows.filter(r => getAnalysisRowType(r) !== "NCR").reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const aAmount = rows.filter(r => getSingleLetterMark(r.mark) === "A" && getAnalysisRowType(r) !== "NCR").reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const suffix = aAmount > 0 ? "-A" : "";
  // Match the rate-analysis components: financial overheads apply only to the
  // non-A portion when the A-exclusion option is enabled.
  const overheadBase = Math.max(0, totalAmount - (excludeAMarkedItems ? aAmount : 0));
  const hasOverheadBase = overheadBase > 0;
  
  let finalTotalAmt = 0;
  let w = totalAmount, wc = 0, x = 0, gst = 0, y = 0, cpoh = 0, z = 0, cess = 0;
  let customChargeResults: any[] = [];
  
  if (calcMethod === "Conventional DSR" && w > 0) {
    wc = (w - aAmount) * 0.01;
    x = w + wc;
    gst = (x - aAmount) * 0.2127;
    y = x + gst;
    cpoh = (y - aAmount) * 0.15;
    z = y + cpoh;
    cess = (z - aAmount) * 0.01;
    finalTotalAmt = z + cess;
  } else if (calcMethod === "Modified DSR" && w > 0) {
    wc = (w - aAmount) * 0.01;
    x = w + wc;
    cpoh = (x - aAmount) * 0.15;
    y = x + cpoh;
    cess = (y - aAmount) * 0.01;
    z = y + cess;
    gst = (z - aAmount) * 0.18;
    finalTotalAmt = z + gst;
  } else if (calcMethod === "Custom charges" && w > 0) {
    let runningTotal = w;
    customChargeResults = customCharges.map(charge => {
      const rate = Number(charge.rate) || 0;
      const base = Math.max(0, runningTotal - (excludeAMarkedItems ? aAmount : 0));
      const amount = base * rate / 100;
      runningTotal += amount;
      return { ...charge, rate, amount, totalAfter: runningTotal };
    });
    finalTotalAmt = runningTotal;
  }

  const calculatedRateNum = baseQty > 0 ? (finalTotalAmt / baseQty) : 0;
  const roundedSayRate = (Math.round(calculatedRateNum * 20) / 20).toFixed(2);

  const handleSubmit = async () => {
    const normalizedItemCode = String(itemCode || "").trim();
    if (!/^(50|51)(?:\.\d+[A-Za-z]?)+$/.test(normalizedItemCode)) {
      alert("Enter a valid SH 50 or SH 51 item code, for example 51.501.");
      return;
    }
    const duplicateCode = rates.some((rate: any) =>
      String(rate.code || "").trim().toLowerCase() === normalizedItemCode.toLowerCase() &&
      String(rate.code || "").trim().toLowerCase() !== String(initialData?.code || "").trim().toLowerCase()
    );
    if (duplicateCode) {
      alert("That item code already exists in the current rate list. Please choose another code, for example 51.501.");
      return;
    }
    if (isExternalAR && (!description.trim() || !unit.trim() || externalRate.trim() === "" || !Number.isFinite(Number(externalRate)) || Number(externalRate) < 0)) {
      alert("For an External AR item, enter a description, unit, and a valid non-negative final rate.");
      return;
    }

    const savedRows = [...rows];
    let currentId = Date.now();
    
    const addCalcRow = (desc: string, amt: string, mark: string = "", isHeader = false) => {
       savedRows.push({
         id: currentId++, isNote: true, code: "", description: desc,
         unit: "", quantity: "", rate: "", amount: isHeader ? 0 : amt, mark, row_type: "CALC_SNAPSHOT"
       });
    };

    if (!isParentHeading && !isExternalAR) {
      if (calcMethod === "Conventional DSR" && w > 0) {
        if (hasOverheadBase) {
          addCalcRow(`TOTAL "W"`, w.toFixed(2), "W");
          addCalcRow(`Add 1% Water charges on "W${suffix}"`, wc.toFixed(2));
          addCalcRow(`TOTAL "X"`, x.toFixed(2), "X");
          addCalcRow(`Add GST on "X${suffix}" (multiplying factor 0.2127)`, gst.toFixed(2));
          addCalcRow(`TOTAL "Y"`, y.toFixed(2), "Y");
          addCalcRow(`Add 15% CPOH on "Y${suffix}"`, cpoh.toFixed(2));
          addCalcRow(`TOTAL "Z"`, z.toFixed(2), "Z");
          addCalcRow(`Add Cess @ 1% on "Z${suffix}"`, cess.toFixed(2));
        }
        addCalcRow(`Cost of ${Number(baseQty).toFixed(2)} ${unit}`, finalTotalAmt.toFixed(2));
        addCalcRow(`Cost of 1.00 ${unit}`, calculatedRateNum.toFixed(2));
        addCalcRow(`SAY`, roundedSayRate);
      } else if (calcMethod === "Custom charges" && w > 0) {
        if (hasOverheadBase) {
          addCalcRow("TOTAL W", w.toFixed(2), "W");
          customChargeResults.forEach(charge => addCalcRow("Add " + charge.name + " @ " + charge.rate + "%", charge.amount.toFixed(2)));
        }
        addCalcRow("Cost of " + Number(baseQty).toFixed(2) + " " + unit, finalTotalAmt.toFixed(2));
        addCalcRow("Cost of 1.00 " + unit, calculatedRateNum.toFixed(2));
        addCalcRow("SAY", roundedSayRate);
      } else if (calcMethod === "Modified DSR" && w > 0) {
        if (hasOverheadBase) {
          addCalcRow(`TOTAL "W"`, w.toFixed(2), "W");
          addCalcRow(`Add 1% Water charges on "W${suffix}"`, wc.toFixed(2));
          addCalcRow(`TOTAL "X"`, x.toFixed(2), "X");
          addCalcRow(`Add 15% CPOH on "X${suffix}"`, cpoh.toFixed(2));
          addCalcRow(`TOTAL "Y"`, y.toFixed(2), "Y");
          addCalcRow(`Add Cess @ 1% on "Y${suffix}"`, cess.toFixed(2));
          addCalcRow(`TOTAL "Z"`, z.toFixed(2), "Z");
          addCalcRow(`Add GST @ 18% on "Z${suffix}"`, gst.toFixed(2));
        }
        addCalcRow(`Cost of ${Number(baseQty).toFixed(2)} ${unit}`, finalTotalAmt.toFixed(2));
        addCalcRow(`Cost of 1.00 ${unit}`, calculatedRateNum.toFixed(2));
        addCalcRow(`SAY`, roundedSayRate);
      }
    }

    try {
      await onAddNSR({
        code: normalizedItemCode,
        description,
        unit: isParentHeading ? "" : unit,
        rate: isExternalAR ? Number(externalRate) : isParentHeading ? 0 : Number(roundedSayRate),
        analysisRows: isParentHeading || isExternalAR ? [] : savedRows,
        isExternalAR,
      });
    } catch (error) {
      console.error("Failed to save NSR item:", error);
      alert("The NSR item could not be saved. Please try again.");
    }
  };

  return (
    <div className="flex flex-col bg-white text-slate-900 w-full h-full max-h-[90vh] rounded-xl overflow-hidden font-sans">
      <div className="flex justify-between items-center p-5 border-b border-gray-200">
         <div>
            <h2 className="text-xl font-bold text-amber-500">{initialData ? "Edit Custom Item" : "Create NSR item"}</h2>
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
              <label htmlFor="nsr-item-code">Item code:</label>
              <input id="nsr-item-code" type="text" value={itemCode} disabled={!!initialData} onChange={e => setItemCode(e.target.value)} className="w-36 rounded border border-gray-300 px-2 py-1 font-mono text-sm font-bold disabled:bg-gray-100 disabled:text-gray-500" placeholder="51.501" title={initialData ? "Item codes stay fixed when editing saved items." : "You may change this suggested code if you need another number."} />
              {!initialData && <span className="text-xs font-normal text-gray-500">Suggested number; change if needed</span>}
            </div>
         </div>
         <button onClick={onClose} className="font-bold flex items-center gap-1 hover:text-rose-600 transition-colors">✕ Close</button>
      </div>
      
      <div className="p-6 overflow-y-auto flex-1 space-y-6">
         <div className="flex flex-wrap md:flex-nowrap gap-6 w-full">
            <div className="flex flex-col gap-1 w-full md:w-64 shrink-0">
               <label className="text-xs font-bold text-gray-700">Item family</label>
               <select disabled={!!initialData} value={itemFamily} onChange={e => setItemFamily(e.target.value)} className="p-2 border border-gray-300 rounded outline-none font-semibold focus:border-blue-500 disabled:opacity-50">
                  <option value="51">NSR - SH 51</option>
                  <option value="50">mDSR - SH 50</option>
               </select>
            </div>
            <div className="flex flex-col gap-1 w-full md:w-64 shrink-0">
               <label className="text-xs font-bold text-gray-700">Parent item</label>
               <select value={parentItem} onChange={e => setParentItem(e.target.value)} className="p-2 border border-gray-300 rounded outline-none font-semibold focus:border-blue-500">
                  <option value="Top-level item">Top-level item</option>
                  <option value="Item having (AR)">Item having (AR)</option>
                  {availableParents.map((p: any, index: number) => (
                    <option key={`${p.code}-${p.category || ""}-${index}`} value={p.code}>{p.code}</option>
                  ))}
               </select>
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
               <label className="text-xs font-bold text-gray-700">Copy rate analysis from</label>
               <div className="flex gap-2 w-full">
                  <input list="rate-codes" type="text" placeholder="Code..." value={copySource} onChange={e => handleCopySourceSelect(e.target.value)} className="p-2 border border-gray-300 rounded flex-1 min-w-0 outline-none focus:border-blue-500 font-semibold" />
                  <datalist id="rate-codes">
                    {rates.map((r: any, index: number) => (
                      <option key={`${r.code}-${r.category || ""}-${index}`} value={r.code}>{r.description?.substring(0, 40)}...</option>
                    ))}
                  </datalist>
                  <button onClick={loadSourceAnalysis} type="button" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-bold whitespace-nowrap shadow shrink-0">Load source analysis</button>
               </div>
            </div>
         </div>

         <div className="flex gap-6 w-full items-stretch">
            <div className="flex flex-col gap-1 flex-1 min-w-0">
               <label className="text-xs font-bold text-gray-700">Item description</label>
               <textarea ref={mainDescRef} value={description} onChange={e => setDescription(e.target.value)} className="p-2 border border-gray-300 rounded outline-none font-semibold focus:border-blue-500 text-sm resize-none overflow-hidden" placeholder="Description..." style={{ minHeight: '60px' }} />
            </div>
            
             {!isParentHeading && (
               <div className="flex flex-col gap-4 shrink-0 w-32">
                  <div className="flex flex-col gap-1">
                     <label className="text-xs font-bold text-gray-700 truncate">Unit</label>
                     <input type="text" value={unit} onChange={e => setUnit(e.target.value)} className="p-2 border border-gray-300 rounded outline-none font-semibold focus:border-blue-500 text-sm" />
                  </div>
                  <div className="flex flex-col gap-1">
                      <label className="text-xs font-bold text-gray-700 truncate">{isExternalAR ? "Final Rate (₹)" : "Base Qty"}</label>
                      {isExternalAR
                        ? <input type="text" inputMode="decimal" value={externalRate} onChange={e => setExternalRate(e.target.value)} className="p-2 border border-gray-300 rounded outline-none font-semibold focus:border-blue-500 text-sm text-right" placeholder="0.00" />
                        : <input type="number" value={baseQty} onChange={e => setBaseQty(Number(e.target.value))} className="p-2 border border-gray-300 rounded outline-none font-semibold focus:border-blue-500 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />}
                  </div>
               </div>
            )}
         </div>

         <div className="flex items-center gap-4 border-b border-gray-200 pb-4">
             {!isParentHeading && !isExternalAR && (
               <div className="flex flex-col gap-1 w-64">
                  <label className="text-xs font-bold text-gray-700">Calculation method</label>
                  <select value={calcMethod} onChange={e => changeCalculationMethod(e.target.value)} className="p-2 border border-gray-300 rounded outline-none font-semibold focus:border-blue-500 text-sm">
                     <option>Conventional DSR</option>
                     <option>Modified DSR</option>
                     <option>Custom charges</option>
                  </select>
               </div>
            )}
             <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isExternalAR} onChange={e => { const checked = e.target.checked; setIsExternalAR(checked); if (checked) { setIsParentHeading(false); setExternalRate(previous => previous.trim() ? previous : roundedSayRate); } }} className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
                <span className="text-sm font-bold text-violet-900">External AR (rate analysis prepared outside this software)</span>
             </label>
            <label className={`flex items-center gap-2 cursor-pointer ${isParentHeading ? 'mt-1' : 'mt-4'}`}>
                <input type="checkbox" checked={isParentHeading} disabled={isExternalAR} onChange={e => setIsParentHeading(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50" />
               <span className="text-sm font-bold text-gray-800">Parent heading only</span>
            </label>
         </div>

          {isExternalAR && <div className="rounded border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">This item uses the manually entered final rate. No internal rate analysis rows will be saved or required.</div>}

          {!isParentHeading && !isExternalAR && (
            <div className="mt-2">
               <div className="flex justify-between items-end mb-2">
                  <h3 className="font-bold uppercase text-gray-900 text-sm">RATE ANALYSIS ROWS</h3>
                  <div className="flex items-center gap-2 bg-gray-100 p-1 rounded border border-gray-300">
                     <span className="text-xs font-bold text-gray-600 pl-2">Add</span>
                     <input type="number" min="1" value={numRowsToAdd} onChange={e => setNumRowsToAdd(Number(e.target.value))} className="w-12 p-1 text-xs border border-gray-300 rounded text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                     <span className="text-xs font-bold text-gray-600">rows</span>
                     <button onClick={insertNRows} type="button" className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-bold shadow transition-colors ml-1">+</button>
                  </div>
               </div>
               
               <div className="rounded overflow-x-auto shadow-sm pb-1">
                  <table className="w-full text-left text-sm min-w-[900px] border-collapse bg-white">
                     <thead className="bg-gray-100 text-gray-700 font-bold border-b border-gray-300">
                        <tr>
                           <th className="border border-gray-300 p-2 w-10 text-center">SL</th>
                           <th className="border border-gray-300 p-2 w-20 text-center">Type</th>
                           <th className="border border-gray-300 p-2 w-28">Code</th>
                           <th className="border border-gray-300 p-2">Description</th>
                           <th className="border border-gray-300 p-2 w-20">Unit</th>
                           <th className="border border-gray-300 p-2 w-24">Quantity</th>
                           <th className="border border-gray-300 p-2 w-24">Rate</th>
                           <th className="border border-gray-300 p-2 w-28 text-right">Amount</th>
                           <th className="border border-gray-300 p-2 w-20 text-center">Mark</th>
                           <th className="border border-gray-300 p-2 w-16 text-center">Action</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-200">
                        {rows.map((row, idx) => (
                           <tr key={row.id} className="group bg-white hover:bg-gray-50 transition-colors">
                              <td className="border border-gray-300 p-2 font-bold text-gray-900 text-center align-top">{idx + 1}</td>
                              <td className="border border-gray-300 p-0 align-top">
                                 <select value={getAnalysisRowType(row)} onChange={e => updateRow(row.id, "row_type", e.target.value)} className="w-full h-9 px-1 text-xs font-bold bg-white border border-gray-300 rounded outline-none focus:border-blue-500">
                                    <option value="CR">CR</option>
                                    <option value="NCR">NCR</option>
                                    <option value="SCR">SCR</option>
                                 </select>
                              </td>
                              <td className="border border-gray-300 p-0 align-top">
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
                                    className="w-full h-full min-h-[36px] p-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-inset focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 font-semibold" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top">
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
                                    className="w-full h-full min-h-[36px] p-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-inset focus:ring-2 focus:ring-blue-500 font-semibold text-justify resize-none overflow-hidden block leading-tight" 
                                    placeholder={getAnalysisRowType(row) === "NCR" ? "Note text..." : getAnalysisRowType(row) === "SCR" ? "Special calculation description (e.g. 100% of P)" : "Description..."} 
                                    rows={1}
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top">
                                 <input 
                                    id={`matrix-input-${idx}-2`}
                                    type="text" 
                                    value={row.unit} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => updateRow(row.id, 'unit', e.target.value)} 
                                    onKeyDown={e => handleCellKeyDown(e, idx, 2, row.id)}
                                    disabled={getAnalysisRowType(row) !== "CR"} 
                                    className="w-full h-full min-h-[36px] p-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-inset focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 font-semibold" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top">
                                 <input 
                                    id={`matrix-input-${idx}-3`}
                                    type="number" 
                                    value={row.quantity} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => updateRow(row.id, 'quantity', e.target.value)} 
                                    onKeyDown={e => handleCellKeyDown(e, idx, 3, row.id)}
                                    disabled={getAnalysisRowType(row) !== "CR"} 
                                    className="w-full h-full min-h-[36px] p-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-inset focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 font-semibold text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top">
                                 <input 
                                    id={`matrix-input-${idx}-4`}
                                    type="number" 
                                    value={row.rate} 
                                    onFocus={() => setActiveRowId(row.id)} 
                                    onChange={e => updateRow(row.id, 'rate', e.target.value)} 
                                    onKeyDown={e => handleCellKeyDown(e, idx, 4, row.id)}
                                    disabled={getAnalysisRowType(row) !== "CR"} 
                                    className="w-full h-full min-h-[36px] p-2 bg-transparent outline-none focus:bg-blue-50 focus:ring-inset focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 font-semibold text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                 />
                              </td>
                              <td className="border border-gray-300 p-0 align-top">
                                 {getAnalysisRowType(row) === "SCR" ? (
                                    <input type="number" step="0.01" value={row.amount ?? ""} onFocus={() => setActiveRowId(row.id)} onChange={e => updateRow(row.id, "amount", e.target.value)} className="w-full h-full min-h-[36px] p-2 text-right font-bold text-gray-900 font-mono bg-transparent outline-none focus:bg-blue-50 focus:ring-inset focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" aria-label="Special calculation amount" />
                                 ) : getAnalysisRowType(row) === "CR" ? (
                                    <div className="p-2 text-right font-bold text-gray-900 font-mono">{Number(row.amount || 0).toFixed(2)}</div>
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
                        
                        {/* STRICT FINANCIAL ROWS */}
                        {calcMethod === "Conventional DSR" && w > 0 && (
                          <>
                            {hasOverheadBase && <>
                            <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 1}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">TOTAL "W"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{w.toFixed(2)}</td>
                              <td className="border border-gray-300 p-2 text-center font-bold text-emerald-900">W</td><td className="border border-gray-300"></td>
                            </tr>
                            <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 2}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-medium text-right pr-6">Add 1% Water charges on "W{suffix}"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700">{wc.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-100 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 3}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">TOTAL "X"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{x.toFixed(2)}</td>
                              <td className="border border-gray-300 p-2 text-center font-bold text-emerald-900">X</td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 4}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-medium text-right pr-6">Add GST on "X{suffix}" (multiplying factor 0.2127)</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700">{gst.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-100 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 5}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">TOTAL "Y"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{y.toFixed(2)}</td>
                              <td className="border border-gray-300 p-2 text-center font-bold text-emerald-900">Y</td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 6}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-medium text-right pr-6">Add 15% CPOH on "Y{suffix}"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700">{cpoh.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-100 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 7}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">TOTAL "Z"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{z.toFixed(2)}</td>
                              <td className="border border-gray-300 p-2 text-center font-bold text-emerald-900">Z</td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 8}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-medium text-right pr-6">Add Cess @ 1% on "Z{suffix}"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700">{cess.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           </>}
                           <tr className="bg-emerald-100 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 9}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">Cost of {Number(baseQty).toFixed(2)} {unit}</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{finalTotalAmt.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 10}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-bold text-right pr-6">Cost of 1.00 {unit}</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-700">{calculatedRateNum.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-600 text-white pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-200 font-bold">{rows.length + 11}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 font-bold text-right pr-6 tracking-wider">SAY</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-white">{roundedSayRate}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                          </>
                        )}

                        {calcMethod === "Custom charges" && w > 0 && (
                          <>
                            {hasOverheadBase && <>
                            <tr className="bg-emerald-100 pointer-events-none"><td className="border border-gray-300 p-2 text-center">{rows.length + 1}</td><td colSpan={6} className="border border-gray-300 p-2 text-right font-bold">TOTAL "W"</td><td className="border border-gray-300 p-2 text-right font-mono font-bold">{w.toFixed(2)}</td><td className="border border-gray-300">W</td><td className="border border-gray-300"></td></tr>
                            {customChargeResults.map((charge, index) => <React.Fragment key={charge.id}><tr className="bg-emerald-50 pointer-events-none"><td className="border border-gray-300 p-2 text-center">{rows.length + index + 2}</td><td colSpan={6} className="border border-gray-300 p-2 text-right">Add {charge.name} @ {charge.rate}% {excludeAMarkedItems && suffix ? "(excluding A-marked amount)" : "on running total"}</td><td className="border border-gray-300 p-2 text-right font-mono">{charge.amount.toFixed(2)}</td><td className="border border-gray-300"></td><td className="border border-gray-300"></td></tr>{index < customChargeResults.length - 1 && <tr className="bg-emerald-100 pointer-events-none"><td className="border border-gray-300 p-2 text-center">{rows.length + index + 3}</td><td colSpan={6} className="border border-gray-300 p-2 text-right font-bold">TOTAL after {charge.name}</td><td className="border border-gray-300 p-2 text-right font-mono">{charge.totalAfter.toFixed(2)}</td><td className="border border-gray-300">{"C" + (index + 1)}</td><td className="border border-gray-300"></td></tr>}</React.Fragment>)}
                            </>}
                            <tr className="bg-emerald-100 pointer-events-none"><td className="border border-gray-300 p-2 text-center">{rows.length + customChargeResults.length + 2}</td><td colSpan={6} className="border border-gray-300 p-2 text-right font-bold">Cost of {Number(baseQty).toFixed(2)} {unit}</td><td className="border border-gray-300 p-2 text-right font-mono font-bold">{finalTotalAmt.toFixed(2)}</td><td></td><td></td></tr>
                            <tr className="bg-emerald-50 pointer-events-none"><td className="border border-gray-300 p-2 text-center">{rows.length + customChargeResults.length + 3}</td><td colSpan={6} className="border border-gray-300 p-2 text-right">Cost of 1.00 {unit}</td><td className="border border-gray-300 p-2 text-right font-mono">{calculatedRateNum.toFixed(2)}</td><td></td><td></td></tr>
                            <tr className="bg-emerald-600 text-white pointer-events-none"><td className="border border-gray-300 p-2 text-center">{rows.length + customChargeResults.length + 4}</td><td colSpan={6} className="border border-gray-300 p-2 text-right font-bold">SAY</td><td className="border border-gray-300 p-2 text-right font-mono font-bold">{roundedSayRate}</td><td></td><td></td></tr>
                          </>
                        )}

                        {calcMethod === "Modified DSR" && w > 0 && (
                          <>
                            {hasOverheadBase && <>
                            <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 1}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">TOTAL "W"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{w.toFixed(2)}</td>
                              <td className="border border-gray-300 p-2 text-center font-bold text-emerald-900">W</td><td className="border border-gray-300"></td>
                            </tr>
                            <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 2}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-medium text-right pr-6">Add 1% Water charges on "W{suffix}"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700">{wc.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-100 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 3}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">TOTAL "X"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{x.toFixed(2)}</td>
                              <td className="border border-gray-300 p-2 text-center font-bold text-emerald-900">X</td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 4}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-medium text-right pr-6">Add 15% CPOH on "X{suffix}"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700">{cpoh.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-100 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 5}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">TOTAL "Y"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{y.toFixed(2)}</td>
                              <td className="border border-gray-300 p-2 text-center font-bold text-emerald-900">Y</td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 6}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-medium text-right pr-6">Add Cess @ 1% on "Y{suffix}"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700">{cess.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-100 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 7}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">TOTAL "Z"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{z.toFixed(2)}</td>
                              <td className="border border-gray-300 p-2 text-center font-bold text-emerald-900">Z</td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 8}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-medium text-right pr-6">Add GST @ 18% on "Z{suffix}"</td>
                              <td className="border border-gray-300 p-2 text-right font-mono text-emerald-700">{gst.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           </>}
                           <tr className="bg-emerald-100 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 9}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-900 font-bold text-right pr-6">Cost of {Number(baseQty).toFixed(2)} {unit}</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-900">{finalTotalAmt.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-50 pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-500 font-bold">{rows.length + 10}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 text-emerald-800 font-bold text-right pr-6">Cost of 1.00 {unit}</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-emerald-700">{calculatedRateNum.toFixed(2)}</td>
                              <td className="border border-gray-300"></td><td className="border border-gray-300"></td>
                           </tr>
                           <tr className="bg-emerald-600 text-white pointer-events-none">
                              <td className="border border-gray-300 p-2 text-center text-gray-200 font-bold">{rows.length + 11}</td>
                              <td colSpan={6} className="border border-gray-300 p-2 font-bold text-right pr-6 tracking-wider">SAY</td>
                              <td className="border border-gray-300 p-2 text-right font-mono font-bold text-white">{roundedSayRate}</td>
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
      
      <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end items-center gap-4">
         <button onClick={onClose} type="button" className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded shadow transition-colors text-sm">Cancel</button>
         <button onClick={handleSubmit} type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded shadow transition-colors text-sm">{initialData ? "Update NSR" : "Save NSR"}</button>
      </div>
      {isCustomChargesOpen && (
        <div className="fixed inset-0 z-[10050] bg-black/70 flex items-center justify-center p-4" onMouseDown={() => { setIsCustomChargesOpen(false); setCalcMethod(previousCalcMethod.current); }}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white text-slate-900 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="p-5 border-b"><h2 className="text-xl font-bold text-blue-700">Custom charges</h2><p className="mt-1 text-sm text-slate-600">Modified DSR values are prefilled. Edit rates and move charges to change the application order. Each charge applies to the running total.</p></div>
            <div className="p-5 space-y-4">
              <label className="flex gap-3 rounded bg-slate-50 p-3 text-sm"><input type="checkbox" checked={excludeAMarkedDraft} onChange={e => setExcludeAMarkedDraft(e.target.checked)} /><span><b>Exclude A-marked amounts</b><span className="block text-slate-500">Enabled by default to match Modified DSR.</span></span></label>
              <div className="grid grid-cols-[1fr_120px_112px] gap-2 text-xs font-bold uppercase text-slate-500"><span>Charge name</span><span>Rate (%)</span><span>Order</span></div>
              {customChargesDraft.map((charge, index) => <div key={charge.id} className="grid grid-cols-[1fr_120px_112px] gap-2 items-center"><input value={charge.name} onChange={e => setCustomChargesDraft(prev => prev.map((c,i) => i === index ? {...c,name:e.target.value} : c))} className="min-w-0 rounded border px-3 py-2" placeholder="Charge name" /><input type="number" min="0" step="0.01" value={charge.rate} onChange={e => setCustomChargesDraft(prev => prev.map((c,i) => i === index ? {...c,rate:e.target.value} : c))} className="w-full rounded border px-3 py-2 text-right" aria-label={charge.name + " percentage"} /><div className="flex gap-1 justify-end"><button type="button" disabled={!index} onClick={() => setCustomChargesDraft(prev => { const copy=[...prev]; [copy[index-1],copy[index]]=[copy[index],copy[index-1]]; return copy; })} className="rounded bg-slate-200 px-2 py-2 disabled:opacity-40">↑</button><button type="button" disabled={index === customChargesDraft.length-1} onClick={() => setCustomChargesDraft(prev => { const copy=[...prev]; [copy[index+1],copy[index]]=[copy[index],copy[index+1]]; return copy; })} className="rounded bg-slate-200 px-2 py-2 disabled:opacity-40">↓</button><button type="button" onClick={() => setCustomChargesDraft(prev => prev.filter((_,i) => i !== index))} className="rounded bg-rose-100 px-2 py-2 text-rose-700">×</button></div></div>)}
              <button type="button" onClick={() => setCustomChargesDraft(prev => [...prev, {id:"charge-" + Date.now(),name:"Custom charge",rate:"0"}])} className="rounded bg-blue-50 px-4 py-2 font-semibold text-blue-700">+ Add a charge</button>
            </div>
            <div className="flex justify-end gap-3 border-t p-4"><button type="button" onClick={() => {setIsCustomChargesOpen(false);setCalcMethod(previousCalcMethod.current);}} className="rounded bg-slate-200 px-5 py-2 font-bold">Cancel</button><button type="button" onClick={saveCustomCharges} disabled={!customChargesDraft.length} className="rounded bg-emerald-600 px-5 py-2 font-bold text-white disabled:opacity-50">Save and use</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

