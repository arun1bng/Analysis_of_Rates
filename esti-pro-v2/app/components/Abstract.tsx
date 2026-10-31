import { buildHierarchicalRows } from "../utils/dsrHierarchy";
import React, { useState } from "react";

const HighlightText = ({ text, query, highlightClass }: { text: string, query: string, highlightClass: string }) => {
  if (!query || typeof text !== 'string') return <>{text}</>;
  const parts = text.split(new RegExp(`(${query})`, 'gi'));
  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className={`${highlightClass} bg-yellow-500 text-black rounded-sm`}>{part}</mark>
        ) : part
      )}
    </>
  );
};

const formatAmt = (val: number, formatStr: string) => {
  const num = Math.round(val);
  if (formatStr === "Standard (Millions)") return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num);
  if (formatStr === "Exact Value") return num.toString();
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num);
};

export default function Abstract({ estimateRows = [], setEstimateRows, rates = [], projectDetails, marketRates = {}, theme = "dark" }: any) {
  const [searchInput, setSearchInput] = useState("");
  const [selectedItemsForDelete, setSelectedItemsForDelete] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{type: 'item' | 'sh' | 'selectedItems', code?: string, name?: string} | null>(null);
  
  const currentFormat = projectDetails?.currencyFormat || "Indian (Lakhs/Crores)";

  const executeDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'item') {
      setEstimateRows((prev: any[]) => prev.filter(row => row.itemCode?.toString() !== deleteTarget.code));
    } else if (deleteTarget.type === 'sh') {
      setEstimateRows((prev: any[]) => prev.filter(row => getSHName(row.itemCode?.toString()) !== deleteTarget.name));
    } else if (deleteTarget.type === 'selectedItems') {
      setEstimateRows((prev: any[]) => prev.filter(row => !selectedItemsForDelete.has(row.itemCode?.toString())));
      setSelectedItemsForDelete(new Set());
    }
    setDeleteTarget(null);
  };

  const toggleItemSelect = (code: string) => {
    const newSet = new Set(selectedItemsForDelete);
    if (newSet.has(code)) newSet.delete(code);
    else newSet.add(code);
    setSelectedItemsForDelete(newSet);
  };

  const SH_NAMES: Record<string, string> = {
    "1": "SH 1: CARRIAGE OF MATERIALS", "2": "SH 2: EARTH WORK", "3": "SH 3: MORTARS", "4": "SH 4: CONCRETE WORK",
    "5": "SH 5: REINFORCED CEMENT CONCRETE", "6": "SH 6: BRICK WORK", "7": "SH 7: STONE WORK", "8": "SH 8: MARBLE AND GRANITE WORK",
    "9": "SH 9: WOOD AND P.V.C. WORK", "10": "SH 10: STEEL WORK", "11": "SH 11: FLOORING", "12": "SH 12: ROOFING", "13": "SH 13: FINISHING",
    "14": "SH 14: REPAIRS TO BUILDINGS", "15": "SH 15: DISMANTLING AND DEMOLITION", "16": "SH 16: ROAD WORK", "17": "SH 17: SANITARY INSTALLATIONS",
    "18": "SH 18: WATER SUPPLY", "19": "SH 19: DRAINAGE", "20": "SH 20: PILE WORK", "21": "SH 21: ALUMINIUM WORK", "22": "SH 22: WATER PROOFING",
    "23": "SH 23: STRUCTURAL STEEL & METAL WORKS", "24": "SH 24: BUILDING MAINTENANCE", "25": "SH 25: ROAD & PAVEMENT REPAIRS",
    "26": "SH 26: WATER SUPPLY & SANITARY FITTINGS", "49": "SH 49: SPECIAL ARs / Sub ARs (NOT IN DSR)", 
    "50": "SH 50: MODIFIED DSR ITEMS (mDSR)", "51": "SH 51: NON-SCHEDULE ITEMS (NS)"
  };

  const extractSHNum = (shName: string) => {
    const match = shName.match(/SH (\d+)/);
    return match ? parseInt(match[1]) : 999;
  };

  const getSHName = (code: string) => {
    const prefix = code?.toString().split('.')[0] || "1";
    return SH_NAMES[prefix] || `SH ${prefix}: GENERAL WORK`;
  };

  // Upgraded Ancestor fetcher that accurately honors nested numerical arrays
  const sortCodes = (a: string, b: string) => {
    const regex = /(\d+)|([a-zA-Z]+)/g;
    const pA = Array.from(a.matchAll(regex)).map(m => m[0]);
    const pB = Array.from(b.matchAll(regex)).map(m => m[0]);
    for(let i=0; i<Math.max(pA.length, pB.length); i++) {
        if (pA[i] === undefined) return -1;
        if (pB[i] === undefined) return 1;
        const numA = parseInt(pA[i], 10);
        const numB = parseInt(pB[i], 10);
        if (!isNaN(numA) && !isNaN(numB)) {
            if (numA !== numB) return numA - numB;
        } else {
            if (pA[i] !== pB[i]) return pA[i].localeCompare(pB[i]);
        }
    }
    return 0;
  };

  const aggregatedItems: Record<string, any> = {};
  estimateRows.forEach((row: any) => {
    const safeCode = row.itemCode?.toString();
    if (!aggregatedItems[safeCode]) {
      aggregatedItems[safeCode] = {
        itemCode: safeCode,
        description: rates.find((r: any) => r.code?.toString() === safeCode)?.description ?? row.description ?? "",
        unit: row.unit,
        rate: row.rate,
        quantity: 0
      };
    }
    aggregatedItems[safeCode].quantity += (Number(row.quantity) || 0);
  });

  const displayList = Object.values(aggregatedItems);
  const itemsToDisplay = searchInput ? displayList.filter((row: any) => {
     return row.itemCode?.toLowerCase().includes(searchInput.toLowerCase()) || row.description.toLowerCase().includes(searchInput.toLowerCase());
  }) : displayList;

  const hierarchyRows = buildHierarchicalRows(itemsToDisplay, rates);
  const hierarchyItemByCode = new Map(hierarchyRows.filter((row) => row.isItem).map((row) => [row.itemCode, row]));

  const groupedItems: Record<string, any[]> = {};
  itemsToDisplay.forEach((row: any) => {
    const shTitle = getSHName(row.itemCode);
    if (!groupedItems[shTitle]) groupedItems[shTitle] = [];
    groupedItems[shTitle].push(row);
  });

  const sortedSHNames = Object.keys(groupedItems).sort((a, b) => extractSHNum(a) - extractSHNum(b));
  const isNSR = (code: string) => code?.startsWith("NSR") || code?.startsWith("51.");
  
  const totalDSR = Math.round(estimateRows.filter((row: any) => !isNSR(row.itemCode?.toString())).reduce((sum: number, row: any) => sum + (Number(row.rate) || 0) * (Number(row.quantity) || 1), 0));
  
  const ciRate = Number(projectDetails.costIndex) || 0;
  const ciAmount = Math.round(totalDSR * (ciRate / 100));
  const subtotalDSR_CI = totalDSR + ciAmount;

  const modFactor = Number(projectDetails.gstModificationFactor) || 1;
  const modifiedDSR = Math.round(subtotalDSR_CI * modFactor);

  const nsrTotal = Math.round(estimateRows.filter((row: any) => isNSR(row.itemCode?.toString())).reduce((sum: number, row: any) => {
     const safeCode = row.itemCode?.toString();
     const marketRate = marketRates[safeCode] !== undefined ? Number(marketRates[safeCode]) : (Number(row.rate) || 0);
     return sum + (marketRate * (Number(row.quantity) || 1));
  }, 0));

  const baseCombined = modifiedDSR + nsrTotal;

  const epfRate = (Number(projectDetails.epf) || 0) / 100;
  const esiRate = (Number(projectDetails.esi) || 0) / 100;
  const epfAmount = Math.round(baseCombined * epfRate);
  const esiAmount = Math.round(baseCombined * esiRate);

  let contingencyAmount = 0;
  let contLabel = "";
  if (projectDetails.contingencyType === 'Custom (%)') {
     const custRate = Number(projectDetails.customContingency) || 0;
     contingencyAmount = Math.round(baseCombined * (custRate / 100));
     contLabel = `Add Contingency @ ${custRate}%:`;
  } else if (projectDetails.contingencyType === 'Zero (0%)') {
     contingencyAmount = 0;
  } else {
     if (baseCombined <= 10000000) {
       contingencyAmount = Math.round(baseCombined * 0.05);
       contLabel = `Add Contingency @ 5%:`;
     } else {
       contingencyAmount = Math.max(500000, Math.round(baseCombined * 0.03));
       contLabel = `Add Contingency @ 3% (>1Cr):`;
     }
  }

  let customTaxAmount = 0;
  if (projectDetails.customTaxName && Number(projectDetails.customTaxRate) > 0) {
      customTaxAmount = Math.round(baseCombined * (Number(projectDetails.customTaxRate) / 100));
  }

  const preGrandTotal = baseCombined + epfAmount + esiAmount + contingencyAmount + customTaxAmount;
  const grandTotalRounded = Math.round(preGrandTotal / 100) * 100;
  
  // Safe floating point formatting exactly as B = 1.14A
  const ciDecString = parseFloat((ciRate / 100).toFixed(4)).toString();
  const ciMultiplierString = parseFloat((1 + (ciRate / 100)).toFixed(4)).toString();

  let refFinalStr = "E + F + G";
  if (contingencyAmount > 0) refFinalStr += " + H";
  if (customTaxAmount > 0) refFinalStr += " + I";

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 font-sans text-xs bg-[#0b1121] text-slate-100 relative">
      
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[300]">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg shadow-2xl max-w-sm w-full text-center">
            <h3 className="text-lg font-bold text-white mb-4">
              Are you sure you want to delete {deleteTarget.type === 'sh' ? `Subhead: ${deleteTarget.name}` : deleteTarget.type === 'selectedItems' ? `${selectedItemsForDelete.size} selected items` : `Item ${deleteTarget.code}`}?
            </h3>
            <div className="flex justify-center gap-4 mt-6">
              <button autoFocus onClick={() => setDeleteTarget(null)} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded shadow transition-colors">
                No
              </button>
              <button onClick={executeDelete} className="px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded shadow transition-colors">
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6 pb-2 border-b border-slate-800 shrink-0">
        <div className="text-lg font-bold text-blue-400 tracking-widest uppercase">
          DETAILED ABSTRACT STATEMENT
        </div>
        
        <div className="flex gap-4 items-center">
          <div className="relative flex items-center">
            <input type="text" placeholder="Search abstract..." className="bg-slate-950 border border-slate-700 rounded pl-3 pr-8 py-1.5 focus:border-blue-500 outline-none w-64 text-white text-sm" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            {searchInput && (
              <button onClick={() => setSearchInput("")} className="absolute right-2 text-slate-400 hover:text-white text-base leading-none p-1">✕</button>
            )}
          </div>
          <button className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded font-bold shadow flex items-center gap-1 text-sm">📊 Abs. Excel</button>
          <button className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded font-bold shadow flex items-center gap-1 text-sm">📄 Abs. PDF</button>
        </div>
      </div>

      <div className="border border-slate-800 rounded-lg overflow-auto shadow-2xl bg-[#0b1121] flex-1">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 sticky top-0 z-10 text-base">
            <tr>
              <th className="p-1 w-20 text-center border-r border-slate-700/50 font-bold align-middle">
                 {selectedItemsForDelete.size > 0 ? (
                    <div className="flex flex-col gap-1 px-1">
                      <button onClick={() => setDeleteTarget({type: 'selectedItems'})} className="bg-rose-700 hover:bg-rose-600 text-white rounded py-1 text-[9px] uppercase font-bold shadow">Delete</button>
                      <button onClick={() => setSelectedItemsForDelete(new Set())} className="bg-slate-700 hover:bg-slate-600 text-white rounded py-1 text-[9px] uppercase font-bold shadow">Deselect</button>
                    </div>
                 ) : "Action"}
              </th>
              <th className="p-3 w-20 text-center border-r border-slate-700/50 font-bold">Sl. No.</th>
              <th className="p-3 w-28 text-center border-r border-slate-700/50 font-bold">Item Code</th>
              <th className="p-3 border-r border-slate-700/50 font-bold">Description of Item</th>
              <th className="p-3 w-20 text-center border-r border-slate-700/50 font-bold">Unit</th>
              <th className="p-3 w-24 text-right border-r border-slate-700/50 font-bold">Quantity</th>
              <th className="p-3 w-28 text-right border-r border-slate-700/50 font-bold">Rate (₹)</th>
              <th className="p-3 w-32 text-right border-r border-slate-700/50 font-bold">Amount (₹)</th>
              <th className="p-3 w-16 text-center font-bold">Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {sortedSHNames.length === 0 ? (
              <tr><td colSpan={9} className="p-10 text-center text-slate-500 italic text-lg">Measurement Sheet is empty.</td></tr>
            ) : sortedSHNames.map((shTitle, shIdx) => {
              const items = groupedItems[shTitle];
              const sectionCode = String(items[0]?.itemCode || "").split(".")[0];
              const sectionRows = hierarchyRows.filter((row) => row.sectionCode === sectionCode);
              const sectionHeader = sectionRows.find((row) => row.isSubhead);
              const shIndex = Number(sectionHeader?.serialNo || shIdx + 1);
              
              const shTotal = items.reduce((sum, item) => {
                const mRate = marketRates[item.itemCode] !== undefined ? Number(marketRates[item.itemCode]) : (Number(item.rate) || 0);
                return sum + (mRate * (Number(item.quantity) || 1));
              }, 0);

              let counters = [0, 0, 0, 0, 0, 0];
              let currentPath: string[] = [];
              const uniqueCodes = Object.keys(items.reduce((acc: any, cur: any) => { acc[cur.itemCode] = cur; return acc; }, {})).filter((code) => hierarchyItemByCode.has(code)).sort(sortCodes);

              return (
                <React.Fragment key={shTitle}>
                  <tr className="bg-slate-900 border-b border-slate-800 group">
                    <td className="p-1 align-middle border-r border-slate-700/50">
                      <div className="flex flex-col items-center justify-center w-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setDeleteTarget({type: 'sh', code: '', name: shTitle})} className="bg-rose-700 hover:bg-rose-600 text-white w-full px-1 py-1 rounded shadow font-bold text-[9px]">🗑️ Delete</button>
                      </div>
                    </td>
                    <td className="p-3 text-center font-bold text-amber-500 text-base border-r border-slate-700/50">{shIndex}</td>
                    <td className="p-3 text-center font-mono font-bold text-blue-400 text-base border-r border-slate-700/50">{extractSHNum(shTitle)}</td>
                    <td colSpan={6} className="p-3 font-bold uppercase tracking-widest text-slate-300 text-base">{sectionHeader?.description || shTitle}</td>
                  </tr>

                  {uniqueCodes.map((itemCode) => {
                    const item = items.find(i => i.itemCode === itemCode);
                    const baseItemDesc = hierarchyItemByCode.get(itemCode)?.description ?? rates.find((r: any) => r.code?.toString() === itemCode)?.description ?? item.description ?? "";
                    const mRate = marketRates[itemCode] !== undefined ? Number(marketRates[itemCode]) : (Number(item.rate) || 0);
                    const itemAmount = Math.round(mRate * (Number(item.quantity) || 1));
                    
                    const ancestors = sectionRows
                      .filter((row) => row.isParent && !row.isSubhead && itemCode.startsWith(`${row.itemCode}.`))
                      .map((row) => ({ code: row.itemCode, description: row.description, serialNo: row.serialNo }));
                    let divergeIdx = 0;
                    while (divergeIdx < ancestors.length && divergeIdx < currentPath.length && ancestors[divergeIdx].code === currentPath[divergeIdx]) {
                        divergeIdx++;
                    }
                    
                    const newAncestors = ancestors.slice(divergeIdx);
                    const rowsToRender: any[] = [];

                    newAncestors.forEach((anc, i) => {
                        const sl = anc.serialNo;

                        rowsToRender.push(
                            <tr className="bg-slate-900/50 border-b border-slate-800" key={`anc-${anc.code}`}>
                                <td className="p-1 align-top border-r border-slate-700/50"></td>
                                <td className="p-3 text-center font-bold text-amber-400 text-base border-r border-slate-700/50 align-top">{sl}</td>
                                <td className="p-3 text-center font-mono text-blue-400 text-base border-r border-slate-700/50 align-top"><HighlightText text={anc.code} query={searchInput} highlightClass="abs-highlight" /></td>
                                <td className="p-3 text-slate-300 leading-relaxed text-justify text-base border-r border-slate-700/50 align-top break-words max-w-xl">
                                    <HighlightText text={anc.description || ""} query={searchInput} highlightClass="abs-highlight" />
                                </td>
                                <td className="p-3 border-r border-slate-700/50"></td>
                                <td className="p-3 border-r border-slate-700/50"></td>
                                <td className="p-3 border-r border-slate-700/50"></td>
                                <td className="p-3 border-r border-slate-700/50"></td>
                                <td className="p-3"></td>
                            </tr>
                        );
                    });

                    currentPath = [...ancestors.map(a => a.code), itemCode];
                    const slLeaf = hierarchyItemByCode.get(itemCode)?.serialNo || `${shIndex}`;

                    const isItemSelected = selectedItemsForDelete.has(itemCode);
                    const baseItem = rates?.find((r: any) => r.code?.toString() === itemCode) || item;
                    const isParentNode = !baseItem || !baseItem.rate || Number(baseItem.rate) === 0;
                    
                    const itemActionButtons = !isParentNode ? (
                      <div className="flex flex-col items-center justify-center w-full gap-1 pt-1 group">
                        <input type="checkbox" checked={isItemSelected} onChange={() => toggleItemSelect(itemCode)} className="h-3.5 w-3.5 cursor-pointer accent-rose-500 rounded bg-slate-900 border-slate-700" title="Select Item for Deletion" />
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity w-full px-1">
                           <button onClick={() => setDeleteTarget({type: 'item', code: itemCode})} className="bg-rose-700 hover:bg-rose-600 text-white w-full px-1 py-0.5 rounded shadow font-bold text-[9px]">🗑️ Del</button>
                        </div>
                      </div>
                    ) : null;

                    rowsToRender.push(
                      <tr className="hover:bg-slate-900/40 transition-colors border-b border-slate-800/50 group" key={`leaf-${itemCode}`}>
                        <td className="p-1 align-top border-r border-slate-700/50">{itemActionButtons}</td>
                        <td className="p-3 text-center font-bold text-amber-400 text-base border-r border-slate-700/50 align-top">{slLeaf}</td>
                        <td className="p-3 text-center font-mono font-bold text-blue-400 text-base border-r border-slate-700/50 align-top">
                          <HighlightText text={itemCode} query={searchInput} highlightClass="abs-highlight" />
                        </td>
                        <td className="p-3 text-slate-200 leading-relaxed text-justify text-base border-r border-slate-700/50 align-top break-words max-w-xl">
                          <HighlightText text={baseItemDesc} query={searchInput} highlightClass="abs-highlight" />
                        </td>
                        <td className="p-3 text-center text-slate-400 text-base border-r border-slate-700/50 align-top">{item.unit ?? ""}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-200 text-base border-r border-slate-700/50 align-top">{item.quantity ? Number(item.quantity).toFixed(2) : "1.00"}</td>
                        <td className="p-3 text-right font-mono text-slate-400 text-base border-r border-slate-700/50 align-top">{(Number(item.rate) || 0).toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-green-400 font-bold text-base border-r border-slate-700/50 align-top">₹{formatAmt(itemAmount, currentFormat)}</td>
                        <td className="p-3"></td>
                      </tr>
                    );

                    return <React.Fragment key={itemCode}>{rowsToRender}</React.Fragment>;
                  })}

                  <tr className="bg-slate-900 border-t-2 border-slate-800">
                    <td colSpan={7} className="p-3 text-right font-bold text-slate-400 uppercase tracking-widest text-sm border-r border-slate-700/50">
                      SUBTOTAL FOR {shTitle}:
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-green-400 text-base border-r border-slate-700/50">
                      ₹{formatAmt(Math.round(shTotal), currentFormat)}
                    </td>
                    <td className="p-3"></td>
                  </tr>
                </React.Fragment>
              );
            })}
            
            {estimateRows.length > 0 && (
              <>
                <tr className="bg-slate-900/60 border-t-4 border-slate-800"><td colSpan={9} className="p-1 border-r border-slate-700/50"></td></tr>
                
                <tr className="hover:bg-slate-900/50">
                  <td colSpan={7} className="p-3 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Total of DSR / Schedule Items:</td>
                  <td className="p-3 text-right text-blue-400 font-bold text-lg font-mono border-r border-slate-700/50">₹{formatAmt(totalDSR, currentFormat)}</td>
                  <td className="p-3 text-center font-bold text-slate-400">A</td>
                </tr>
                {ciRate > 0 && (
                  <tr className="hover:bg-slate-900/50">
                    <td colSpan={7} className="p-3 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Add Cost Index @ {ciRate}% on DSR Items:</td>
                    <td className="p-3 text-right text-blue-400 font-bold text-lg font-mono border-r border-slate-700/50">₹{formatAmt(ciAmount, currentFormat)}</td>
                    <td className="p-3 text-center font-bold text-slate-400">{ciDecString}A</td>
                  </tr>
                )}
                {ciRate > 0 && (
                  <tr className="hover:bg-slate-900/50">
                    <td colSpan={7} className="p-3 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Subtotal of DSR and MDSR items enhanced by CI @ {ciRate}%:</td>
                    <td className="p-3 text-right text-blue-400 font-bold text-lg font-mono border-r border-slate-700/50">₹{formatAmt(subtotalDSR_CI, currentFormat)}</td>
                    <td className="p-3 text-center font-bold text-slate-400">B = {ciMultiplierString}A</td>
                  </tr>
                )}
                <tr className="hover:bg-slate-900/30">
                  <td colSpan={7} className="p-3 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Modified estimated cost after applying multiplying factor ({modFactor}) on DSR and mDSR items:</td>
                  <td className="p-3 text-right text-slate-200 font-bold text-lg font-mono border-r border-slate-700/50">₹{formatAmt(modifiedDSR, currentFormat)}</td>
                  <td className="p-3 text-center font-bold text-slate-400">C = {modFactor}B</td>
                </tr>
                <tr className="hover:bg-slate-900/30">
                  <td colSpan={7} className="p-3 text-right font-bold text-slate-300 border-r border-slate-700/50 text-base">Total of Non-Schedule (NS) Items:</td>
                  <td className="p-3 text-right text-slate-300 font-bold text-lg font-mono border-r border-slate-700/50">₹{formatAmt(nsrTotal, currentFormat)}</td>
                  <td className="p-3 text-center font-bold text-slate-400">D</td>
                </tr>
                <tr className="bg-slate-900 font-bold border-y border-slate-800">
                  <td colSpan={7} className="p-3 text-right text-amber-300 uppercase tracking-wider border-r border-slate-700/50 text-base">Base Estimate Total (Schedule + Non-Schedule):</td>
                  <td className="p-3 text-right text-amber-400 text-lg font-mono border-r border-slate-700/50">₹{formatAmt(baseCombined, currentFormat)}</td>
                  <td className="p-3 text-center font-bold text-slate-400">E = C + D</td>
                </tr>

                <tr className="hover:bg-slate-900/30">
                  <td colSpan={7} className="p-3 text-right text-slate-400 font-bold border-r border-slate-700/50 text-base">Add EPF @ {projectDetails.epf}%:</td>
                  <td className="p-3 text-right text-slate-200 font-mono text-lg border-r border-slate-700/50">₹{formatAmt(epfAmount, currentFormat)}</td>
                  <td className="p-3 text-center font-bold text-slate-400">F</td>
                </tr>
                <tr className="hover:bg-slate-900/30">
                  <td colSpan={7} className="p-3 text-right text-slate-400 font-bold border-r border-slate-700/50 text-base">Add ESI @ {projectDetails.esi}%:</td>
                  <td className="p-3 text-right text-slate-200 font-mono text-lg border-r border-slate-700/50">₹{formatAmt(esiAmount, currentFormat)}</td>
                  <td className="p-3 text-center font-bold text-slate-400">G</td>
                </tr>
                {contingencyAmount > 0 && (
                  <tr className="hover:bg-slate-900/30">
                    <td colSpan={7} className="p-3 text-right text-slate-400 font-bold border-r border-slate-700/50 text-base">{contLabel}</td>
                    <td className="p-3 text-right text-slate-200 font-mono text-lg border-r border-slate-700/50">₹{formatAmt(contingencyAmount, currentFormat)}</td>
                    <td className="p-3 text-center font-bold text-slate-400">H</td>
                  </tr>
                )}
                {customTaxAmount > 0 && (
                  <tr className="hover:bg-slate-900/30">
                    <td colSpan={7} className="p-3 text-right text-slate-400 font-bold border-r border-slate-700/50 text-base">Add {projectDetails.customTaxName} @ {projectDetails.customTaxRate}%:</td>
                    <td className="p-3 text-right text-slate-200 font-mono text-lg border-r border-slate-700/50">₹{formatAmt(customTaxAmount, currentFormat)}</td>
                    <td className="p-3 text-center font-bold text-slate-400">I</td>
                  </tr>
                )}
                
                <tr className="bg-slate-950 border-t-4 border-emerald-800">
                  <td colSpan={7} className="p-4 text-right font-bold text-emerald-400 uppercase tracking-widest text-base border-r border-slate-700/50">GRAND TOTAL:</td>
                  <td className="p-4 text-right text-emerald-400 text-xl font-bold font-mono border-r border-slate-700/50">₹{formatAmt(preGrandTotal, currentFormat)}</td>
                  <td className="p-4 text-center font-bold text-emerald-600">{refFinalStr}</td>
                </tr>
                <tr className="bg-slate-950">
                  <td colSpan={7} className="p-4 text-right font-bold text-emerald-500 uppercase tracking-widest text-base border-r border-slate-700/50">SAY:</td>
                  <td className="p-4 text-right text-emerald-500 text-2xl font-bold font-mono border-r border-slate-700/50">₹{formatAmt(grandTotalRounded, currentFormat)}</td>
                  <td className="p-4 text-center font-bold text-emerald-600"></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
