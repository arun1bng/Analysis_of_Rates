import React, { useState, useEffect } from "react";

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

export default function MeasurementSheet({ estimateRows, setEstimateRows, rates, theme = "dark", checkedItems, setCheckedItems }: any) {
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(-1);

  const [multiRowCounts, setMultiRowCounts] = useState<Record<string, number>>({});
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [selectedItemsForDelete, setSelectedItemsForDelete] = useState<Set<string>>(new Set());
  
  const [dragAction, setDragAction] = useState<'select' | 'deselect' | null>(null);
  const [pendingRound, setPendingRound] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<{type: 'item' | 'sh' | 'row' | 'selected' | 'selectedItems', code?: string, name?: string, id?: string} | null>(null);

  useEffect(() => {
    const stopDrag = () => setDragAction(null);
    window.addEventListener('mouseup', stopDrag);
    return () => window.removeEventListener('mouseup', stopDrag);
  }, []);

  const parseVal = (val: any) => {
    if (val === "" || val === null || val === undefined || val === "." || val === "-") return 1;
    const num = parseFloat(val);
    return isNaN(num) ? 1 : num;
  };

  const handleNumInput = (id: string, field: string, value: string) => {
    if (value !== "" && !/^-?\d*\.?\d*$/.test(value)) {
      alert("Please provide a valid number.");
      return;
    }
    
    setEstimateRows((prev: any[]) => prev.map(row => {
      if (row.id === id) {
        const updated = { ...row, [field]: value };
        const nos = parseVal(updated.nos);
        const num1 = parseVal(updated.num1);
        const num2 = parseVal(updated.num2);
        const l = parseVal(updated.length);
        const b = parseVal(updated.breadth);
        const h = parseVal(updated.height);
        const coeff = parseVal(updated.coefficient);
        
        const rawQty = (updated.nos === "0" ? 0 : nos) * num1 * num2 * l * b * h * coeff;
        updated.quantity = Math.round(rawQty * 100) / 100;
        updated.amount = updated.quantity * (updated.rate || 0);
        return updated;
      }
      return row;
    }));
  };

  const updateRow = (id: string, field: string, value: string) => {
    setEstimateRows((prev: any[]) => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const removeRow = (id: string) => {
    setEstimateRows((prev: any[]) => prev.filter(row => row.id !== id));
    setSelectedRowIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const executeDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'item') {
      setEstimateRows((prev: any[]) => prev.filter(row => row.itemCode?.toString() !== deleteTarget.code));
    } else if (deleteTarget.type === 'sh') {
      setEstimateRows((prev: any[]) => prev.filter(row => getSHName(row.itemCode?.toString()) !== deleteTarget.name));
    } else if (deleteTarget.type === 'row') {
      removeRow(deleteTarget.id!);
    } else if (deleteTarget.type === 'selected') {
      setEstimateRows((prev: any[]) => prev.filter(row => !selectedRowIds.has(row.id)));
      setSelectedRowIds(new Set());
    } else if (deleteTarget.type === 'selectedItems') {
      setEstimateRows((prev: any[]) => prev.filter(row => !selectedItemsForDelete.has(row.itemCode?.toString())));
      setSelectedItemsForDelete(new Set());
    }
    setDeleteTarget(null);
  };

  const addSingleRow = (itemCode: string, baseItem: any) => {
    setEstimateRows((prev: any[]) => [...prev, {
      id: crypto.randomUUID(), itemCode, userDescription: "", unit: baseItem.unit, rate: baseItem.rate,
      nos: 1, num1: 1, num2: 1, length: "", breadth: "", height: "", coefficient: "", quantity: 1, amount: baseItem.rate
    }]);
  };

  const addMultipleRows = (itemCode: string, baseItem: any, count: number) => {
    const newRows = Array.from({ length: count || 1 }).map(() => ({
      id: crypto.randomUUID(), itemCode, userDescription: "", unit: baseItem.unit, rate: baseItem.rate,
      nos: 1, num1: 1, num2: 1, length: "", breadth: "", height: "", coefficient: "", quantity: 1, amount: baseItem.rate
    }));
    setEstimateRows((prev: any[]) => [...prev, ...newRows]);
  };

  const getNextUp = (base: number, current: number) => {
    const tiers = Array.from(new Set([
      0, base,
      Math.floor(base * 10) / 10, Math.floor(base), Math.floor(base / 10) * 10,
      Math.ceil(base * 10) / 10, Math.ceil(base), Math.ceil(base / 10) * 10,
      Math.floor(current / 10) * 10 - 10, Math.floor(current / 10) * 10, Math.floor(current / 10) * 10 + 10, Math.floor(current / 10) * 10 + 20
    ])).filter(t => t >= 0).sort((a, b) => a - b);
    const target = tiers.find(t => t > current + 0.001);
    return target !== undefined ? target : current + 10;
  };

  const getNextDown = (base: number, current: number) => {
    const tiers = Array.from(new Set([
      0, base,
      Math.floor(base * 10) / 10, Math.floor(base), Math.floor(base / 10) * 10,
      Math.ceil(base * 10) / 10, Math.ceil(base), Math.ceil(base / 10) * 10,
      Math.floor(current / 10) * 10 - 10, Math.floor(current / 10) * 10, Math.floor(current / 10) * 10 + 10
    ])).filter(t => t >= 0).sort((a, b) => a - b);
    const target = [...tiers].reverse().find(t => t < current - 0.001);
    return target !== undefined ? target : Math.max(0, current - 10);
  };

  const handleRoundStage = (itemCode: string, currentBaseQty: number, direction: 'up' | 'down') => {
    const currentVal = pendingRound[itemCode] !== undefined ? pendingRound[itemCode] : currentBaseQty;
    const target = direction === 'up' ? getNextUp(currentBaseQty, currentVal) : getNextDown(currentBaseQty, currentVal);
    setPendingRound(prev => ({ ...prev, [itemCode]: target }));
  };

  const applyRoundOff = (itemCode: string, baseItem: any) => {
    if (pendingRound[itemCode] === undefined) return;
    const rows = estimateRows.filter((r: any) => r.itemCode?.toString() === itemCode);
    const roundRow = rows.find((r: any) => r.userDescription === "Rounded off");
    const otherRows = rows.filter((r: any) => r.userDescription !== "Rounded off");
    
    const baseTotal = otherRows.reduce((sum: number, r: any) => sum + (Number(r.quantity) || 0), 0);
    const targetTotal = pendingRound[itemCode];
    let diff = targetTotal - baseTotal;
    diff = Math.round(diff * 100) / 100;

    if (Math.abs(diff) < 0.0001) {
        if (roundRow) removeRow(roundRow.id);
    } else {
        if (roundRow) {
            updateRow(roundRow.id, 'nos', diff.toString());
            handleNumInput(roundRow.id, 'nos', diff.toString());
        } else {
            setEstimateRows((prev: any[]) => [...prev, {
                id: crypto.randomUUID(), itemCode, userDescription: "Rounded off", unit: baseItem.unit, rate: baseItem.rate,
                nos: diff.toString(), num1: "", num2: "", length: "", breadth: "", height: "", coefficient: "", 
                quantity: diff, amount: baseItem.rate * diff
            }]);
        }
    }
    setPendingRound(prev => { const next = { ...prev }; delete next[itemCode]; return next; });
  };

  const cancelRoundOff = (itemCode: string) => {
    setPendingRound(prev => { const next = { ...prev }; delete next[itemCode]; return next; });
  };

  const handleCopyRowsToItem = (targetItemCode: string, targetBaseItem: any) => {
    const rowsToCopy = estimateRows.filter((r: any) => selectedRowIds.has(r.id));
    if (rowsToCopy.length === 0) return;
    const newRows = rowsToCopy.map((r: any) => ({
      ...r, id: crypto.randomUUID(), itemCode: targetItemCode, unit: targetBaseItem.unit,
      rate: targetBaseItem.rate, amount: r.quantity * (targetBaseItem.rate || 0),
      userDescription: r.userDescription === "Rounded off" ? "Copied row" : r.userDescription
    }));
    setEstimateRows((prev: any[]) => [...prev, ...newRows]);
    setSelectedRowIds(new Set()); 
  };

  const handleRowMouseDown = (rowId: string, itemCode: string) => {
    const isSelected = selectedRowIds.has(rowId);
    const action = isSelected ? 'deselect' : 'select';
    setDragAction(action);

    let newSel = new Set(selectedRowIds);
    if (newSel.size > 0 && action === 'select') {
      const sampleId = Array.from(newSel)[0];
      const sampleRow = estimateRows.find((r: any) => r.id === sampleId);
      if (sampleRow && sampleRow.itemCode?.toString() !== itemCode) newSel.clear();
    }

    if (action === 'select') newSel.add(rowId);
    else newSel.delete(rowId);

    setSelectedRowIds(newSel);
  };

  const handleRowMouseEnter = (rowId: string, itemCode: string) => {
    if (dragAction) {
      let newSel = new Set(selectedRowIds);
      if (dragAction === 'select') {
        const sampleId = Array.from(newSel)[0];
        const sampleRow = estimateRows.find((r: any) => r.id === sampleId);
        if (sampleRow && sampleRow.itemCode?.toString() !== itemCode) return; 
        newSel.add(rowId);
      } else {
        newSel.delete(rowId);
      }
      setSelectedRowIds(newSel);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, rowId: string, colName: string, rowIndex: number) => {
    const cols = ['userDescription', 'nos', 'num1', 'num2', 'length', 'breadth', 'height', 'coefficient'];
    const colIndex = cols.indexOf(colName);
    if (colIndex === -1) return;

    let nextRowIndex = rowIndex;
    let nextColIndex = colIndex;
    const target = e.target as HTMLInputElement;

    if (e.key === 'ArrowUp') {
      nextRowIndex = Math.max(0, rowIndex - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      nextRowIndex = Math.min(estimateRows.length - 1, rowIndex + 1);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && target.selectionStart === 0) {
      nextColIndex = Math.max(0, colIndex - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && target.selectionStart === target.value.length) {
      nextColIndex = Math.min(cols.length - 1, colIndex + 1);
      e.preventDefault();
    } else {
      return; 
    }

    if (nextRowIndex !== rowIndex || nextColIndex !== colIndex) {
      const nextRow = estimateRows[nextRowIndex];
      if (nextRow) {
         const nextId = `cell-${nextRow.id}-${cols[nextColIndex]}`;
         const el = document.getElementById(nextId);
         if (el) el.focus();
      }
    }
  };

  const handleScrollToMatch = (direction: 'next' | 'prev') => {
    const marks = document.querySelectorAll('.msmt-highlight');
    if (marks.length === 0) return;
    let nextIdx = direction === 'next' ? matchIdx + 1 : matchIdx - 1;
    if (nextIdx >= marks.length) nextIdx = 0;
    if (nextIdx < 0) nextIdx = marks.length - 1;
    marks.forEach(m => { m.classList.remove('bg-orange-500', 'text-white'); m.classList.add('bg-yellow-500', 'text-black'); });
    const target = marks[nextIdx];
    if (target) {
      target.classList.remove('bg-yellow-500', 'text-black');
      target.classList.add('bg-orange-500', 'text-white');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setMatchIdx(nextIdx);
  };

  // Upgraded Ancestor fetcher that accurately honors nested numerical arrays
  const getAncestors = (code: string) => {
    if (!code || !rates) return [];
    const parts = code.toString().split('.');
    const ancestors = [];
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
        current += (i === 0 ? parts[i] : "." + parts[i]);
        // Strict .toString() coercion ensures 8.1 isn't lost due to float mismatches
        const match = rates.find((r: any) => r.code?.toString() === current);
        if (match) ancestors.push({ code: match.code.toString(), description: match.description });
    }
    return ancestors;
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

  const getSHName = (code: string) => {
    const prefix = code?.toString().split('.')[0] || "1";
    return SH_NAMES[prefix] || `SH ${prefix}: GENERAL WORK`;
  };

  const extractSHNum = (shName: string) => {
    const match = shName.match(/SH (\d+)/);
    return match ? parseInt(match[1]) : 999;
  };

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

  const groupedBySH: Record<string, Record<string, any[]>> = {};
  const flatRowIds: string[] = []; 
  estimateRows.forEach((row: any) => {
    const sh = getSHName(row.itemCode?.toString());
    const safeCode = row.itemCode?.toString();
    if (!groupedBySH[sh]) groupedBySH[sh] = {};
    if (!groupedBySH[sh][safeCode]) groupedBySH[sh][safeCode] = [];
    groupedBySH[sh][safeCode].push(row);
    flatRowIds.push(row.id);
  });

  const sortedSHNames = Object.keys(groupedBySH).sort((a, b) => extractSHNum(a) - extractSHNum(b));

  const activeSelectionCode = selectedRowIds.size > 0 
    ? estimateRows.find((r: any) => r.id === Array.from(selectedRowIds)[0])?.itemCode 
    : "";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans text-xs relative">
      
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[300]">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg shadow-2xl max-w-sm w-full text-center">
            <h3 className="text-lg font-bold text-white mb-4">
              Are you sure you want to delete {deleteTarget.type === 'sh' ? `Subhead: ${deleteTarget.name}` : deleteTarget.type === 'item' ? `Item ${deleteTarget.code}` : deleteTarget.type === 'selectedItems' ? `${selectedItemsForDelete.size} selected items` : deleteTarget.type === 'selected' ? `${selectedRowIds.size} selected rows` : 'this row'}?
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

      <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900 shadow-md z-10 shrink-0">
        <h2 className="text-lg font-bold text-blue-400 uppercase tracking-widest">Measurement Sheet</h2>
        <div className="flex gap-2 items-center">
          {selectedRowIds.size > 0 && (
            <span className="text-amber-500 font-bold mr-4 bg-amber-900/30 px-3 py-1 rounded border border-amber-800 shadow-inner">
              {selectedRowIds.size} rows selected in Item {activeSelectionCode}
            </span>
          )}
          
          <div className="flex bg-slate-950 border border-slate-700 rounded items-center overflow-hidden">
            <div className="relative flex items-center">
              <input type="text" placeholder="Search code or description..." className="bg-transparent pl-3 pr-7 py-1.5 focus:outline-none w-56 text-white text-sm" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
              {searchInput && (
                <button onClick={() => { setSearchInput(""); setSearchQuery(""); setMatchIdx(-1); }} className="absolute right-1 text-slate-400 hover:text-white text-[10px] p-1">✕</button>
              )}
            </div>
            <button onClick={() => setSearchQuery(searchInput)} className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-white font-bold text-sm border-l border-slate-700">Search</button>
          </div>
          <button className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded font-bold shadow flex items-center gap-1 ml-2 text-sm">📊 Meas. Excel</button>
          <button className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded font-bold shadow flex items-center gap-1 text-sm">📄 Meas. PDF</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#0b1121] select-none">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-900/95 text-slate-300 sticky top-0 shadow-lg z-20 text-base border-b border-slate-700">
            <tr>
              <th className="p-1 w-20 text-center border-r border-slate-700/50 font-bold align-middle">
                 {(selectedRowIds.size > 0 || selectedItemsForDelete.size > 0) ? (
                    <div className="flex flex-col gap-1 px-1">
                      <button onClick={() => setDeleteTarget({type: selectedRowIds.size > 0 ? 'selected' : 'selectedItems'})} className="bg-rose-700 hover:bg-rose-600 text-white rounded py-1 text-[9px] uppercase font-bold shadow">Delete</button>
                      <button onClick={() => { setSelectedRowIds(new Set()); setSelectedItemsForDelete(new Set()); }} className="bg-slate-700 hover:bg-slate-600 text-white rounded py-1 text-[9px] uppercase font-bold shadow">Deselect</button>
                    </div>
                 ) : "Action"}
              </th>
              <th className="p-3 w-20 text-center border-r border-slate-700/50 font-bold">Sl. No.</th>
              <th className="p-3 w-24 text-center border-r border-slate-700/50 font-bold">Item Code</th>
              <th className="p-3 border-r border-slate-700/50 font-bold">Description of Item</th>
              <th className="p-2 w-12 text-center border-r border-slate-700/50 text-sm font-bold">Nos.</th>
              <th className="p-2 w-12 text-center border-r border-slate-700/50 text-sm font-bold">Num1</th>
              <th className="p-2 w-12 text-center border-r border-slate-700/50 text-sm font-bold">Num2</th>
              <th className="p-2 w-16 text-center border-r border-slate-700/50 text-sm font-bold">Length</th>
              <th className="p-2 w-16 text-center border-r border-slate-700/50 text-sm font-bold">Breadth</th>
              <th className="p-2 w-16 text-center border-r border-slate-700/50 text-sm font-bold">Height</th>
              <th className="p-2 w-16 text-center border-r border-slate-700/50 text-sm font-bold">Co-eff</th>
              <th className="p-2 w-24 text-right border-r border-slate-700/50 text-sm font-bold">Quantity</th>
              <th className="p-2 w-12 text-center"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {sortedSHNames.length === 0 ? (
              <tr><td colSpan={13} className="p-10 text-center text-slate-500 italic text-lg">No items in Measurement Sheet.</td></tr>
            ) : (
              sortedSHNames.map((shName, shIdx) => {
                const itemsObj = groupedBySH[shName];
                const shIndex = shIdx + 1; 
                
                let counters = [0, 0, 0, 0, 0, 0];
                let currentPath: string[] = [];
                const uniqueCodes = Object.keys(itemsObj).sort(sortCodes);

                return (
                  <React.Fragment key={shName}>
                    <tr className="bg-slate-900 border-t-2 border-slate-700 group">
                      <td className="p-1 align-middle border-r border-slate-700/50">
                        <div className="flex flex-col items-center justify-center w-full opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setDeleteTarget({type: 'sh', code: '', name: shName})} className="bg-rose-700 hover:bg-rose-600 text-white w-full px-1 py-1 rounded shadow font-bold text-[9px]">🗑️ Delete</button>
                        </div>
                      </td>
                      <td className="p-3 text-center font-bold text-amber-500 text-base border-r border-slate-700/50">{shIndex}</td>
                      <td className="p-3 text-center font-mono font-bold text-blue-400 text-base border-r border-slate-700/50">{extractSHNum(shName)}</td>
                      <td colSpan={10} className="p-3 font-bold uppercase tracking-widest text-slate-300 text-base">{shName}</td>
                    </tr>

                    {uniqueCodes.map((itemCode) => {
                      const rows = itemsObj[itemCode];
                      const baseItem = rates?.find((r: any) => r.code?.toString() === itemCode) || rows[0];
                      const isParentNode = !baseItem || !baseItem.rate || Number(baseItem.rate) === 0;
                      
                      const roundRow = rows.find((r: any) => r.userDescription === "Rounded off");
                      const otherRows = rows.filter((r: any) => r.userDescription !== "Rounded off");
                      const currentBaseQty = otherRows.reduce((sum: number, r: any) => sum + (Number(r.quantity) || 0), 0);
                      const displayQty = currentBaseQty + (roundRow ? (Number(roundRow.quantity) || 0) : 0);

                      const multiCount = multiRowCounts[itemCode] || 2;
                      
                      const ancestors = getAncestors(itemCode);
                      let divergeIdx = 0;
                      while (divergeIdx < ancestors.length && divergeIdx < currentPath.length && ancestors[divergeIdx].code === currentPath[divergeIdx]) {
                          divergeIdx++;
                      }
                      
                      const newAncestors = ancestors.slice(divergeIdx);
                      const rowsToRender: any[] = [];

                      newAncestors.forEach((anc, i) => {
                          const depth = divergeIdx + i;
                          counters[depth]++;
                          for (let j = depth + 1; j < counters.length; j++) counters[j] = 0;
                          const sl = `${shIndex}` + counters.slice(0, depth + 1).map(c => `.${c}`).join('');

                          rowsToRender.push(
                              <tr className="bg-slate-900/50 border-b border-slate-800" key={`anc-${anc.code}`}>
                                  <td className="p-1 align-top border-r border-slate-700/50"></td>
                                  <td className="p-3 text-center font-bold text-amber-400 text-base border-r border-slate-700/50 align-top">{sl}</td>
                                  <td className="p-3 text-center font-mono text-blue-400 text-base border-r border-slate-700/50 align-top">
                                    <HighlightText text={anc.code} query={searchQuery} highlightClass="msmt-highlight" />
                                  </td>
                                  <td className="p-3 text-slate-300 leading-relaxed text-justify text-base border-r border-slate-700/50 align-top break-words max-w-xl">
                                      <HighlightText text={anc.description || ""} query={searchQuery} highlightClass="msmt-highlight" />
                                  </td>
                                  <td className="p-3 border-r border-slate-700/50"></td><td className="p-3 border-r border-slate-700/50"></td><td className="p-3 border-r border-slate-700/50"></td><td className="p-3 border-r border-slate-700/50"></td><td className="p-3 border-r border-slate-700/50"></td><td className="p-3 border-r border-slate-700/50"></td><td className="p-3 border-r border-slate-700/50"></td><td className="p-3 border-r border-slate-700/50"></td><td className="p-3"></td>
                              </tr>
                          );
                      });

                      currentPath = [...ancestors.map(a => a.code), itemCode];
                      const leafDepth = ancestors.length;
                      counters[leafDepth]++;
                      for (let j = leafDepth + 1; j < counters.length; j++) counters[j] = 0;
                      const slLeaf = `${shIndex}` + counters.slice(0, leafDepth + 1).map(c => `.${c}`).join('');

                      const isItemSelected = selectedItemsForDelete.has(itemCode);
                      
                      const itemActionButtons = !isParentNode ? (
                        <div className="flex flex-col items-center justify-center w-full gap-1 pt-1 group">
                          <input type="checkbox" checked={isItemSelected} onChange={() => toggleItemSelect(itemCode)} className="h-3.5 w-3.5 cursor-pointer accent-rose-500 rounded bg-slate-900 border-slate-700" title="Select Item to Delete" />
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity w-full px-1">
                             <button onClick={() => setDeleteTarget({type: 'item', code: itemCode})} className="bg-rose-700 hover:bg-rose-600 text-white w-full px-1 py-0.5 rounded shadow font-bold text-[9px]">🗑️ Del</button>
                          </div>
                        </div>
                      ) : null;

                      const sortedRows = [...otherRows, ...(roundRow ? [roundRow] : [])];

                      rowsToRender.push(
                        <tr className="bg-[#0b1121] border-b-2 border-slate-800 group" key={`leaf-${itemCode}`}>
                          <td className="p-1 align-top border-r border-slate-700/50">{itemActionButtons}</td>
                          <td className="p-3 text-center font-bold text-amber-400 text-base border-r border-slate-700/50 align-top">{slLeaf}</td>
                          <td className="p-3 text-center font-mono font-bold text-blue-400 text-base border-r border-slate-700/50 align-top">
                            <HighlightText text={itemCode} query={searchQuery} highlightClass="msmt-highlight" />
                          </td>
                          <td className="p-3 text-slate-200 leading-relaxed text-justify text-base border-r border-slate-700/50 align-top break-words max-w-xl">
                            <HighlightText text={baseItem.description || ""} query={searchQuery} highlightClass="msmt-highlight" />
                          </td>
                          <td colSpan={9} className="p-2 align-bottom border-r border-slate-700/50">
                            <div className="flex items-center justify-end gap-2 w-full h-full">
                              
                              {!isParentNode && (
                                <div className="flex items-center bg-slate-900 border border-slate-700 rounded px-2 py-0.5 shadow-inner mr-2 gap-2">
                                  <span className="text-slate-400 font-bold text-xs">Round off:</span>
                                  <div className="flex flex-row border-r border-slate-700 pr-2 mr-1 gap-1.5 items-center">
                                    <button onClick={() => handleRoundStage(itemCode, currentBaseQty, 'up')} className="text-slate-400 hover:text-emerald-400 leading-none text-base font-bold">▲</button>
                                    <button onClick={() => handleRoundStage(itemCode, currentBaseQty, 'down')} className="text-slate-400 hover:text-rose-400 leading-none text-base font-bold">▼</button>
                                  </div>
                                  
                                  {pendingRound[itemCode] !== undefined ? (
                                    <div className="flex items-center gap-1">
                                      <span className="text-emerald-400 font-bold text-base bg-slate-950 px-2 rounded-sm shadow-inner mr-1 font-mono">{pendingRound[itemCode].toFixed(2)}</span>
                                      <button onClick={() => applyRoundOff(itemCode, baseItem)} className="bg-emerald-600 hover:bg-emerald-500 text-white rounded px-2 py-0.5 text-[10px] font-bold shadow">✓ Apply</button>
                                      <button onClick={() => cancelRoundOff(itemCode)} className="bg-rose-600 hover:bg-rose-500 text-white rounded px-2 py-0.5 text-[10px] font-bold shadow">✕</button>
                                    </div>
                                  ) : (
                                    <span className="text-amber-400 font-bold text-base whitespace-nowrap ml-1">Total Qty: {Number(displayQty).toFixed(2)} {baseItem.unit}</span>
                                  )}
                                </div>
                              )}
                              
                              <button 
                                onClick={() => handleCopyRowsToItem(itemCode, baseItem)} 
                                disabled={selectedRowIds.size === 0}
                                className={`${selectedRowIds.size > 0 ? 'bg-emerald-700 hover:bg-emerald-600 text-white cursor-pointer' : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'} px-3 py-1.5 rounded shadow font-bold text-[10px] text-center leading-tight transition-colors border border-transparent ${selectedRowIds.size > 0 ? 'border-emerald-500' : ''}`}
                              >
                                📋 Paste selected rows here
                              </button>
                              
                              <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded border border-slate-700 h-full">
                                <span className="text-slate-400 text-[9px] whitespace-nowrap">Add rows:</span>
                                <input type="text" value={multiCount} onChange={(e) => setMultiRowCounts(prev => ({...prev, [itemCode]: parseInt(e.target.value) || 2}))} className="w-8 bg-slate-950 border border-slate-700 text-center text-white rounded outline-none py-1 font-mono text-xs" />
                                <button onClick={() => addMultipleRows(itemCode, baseItem, multiCount)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded shadow font-bold text-[10px] whitespace-nowrap">+ Add</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );

                      sortedRows.forEach((row: any, rIndex: number) => {
                        const isRoundedRow = row.userDescription === "Rounded off";
                        const isSelected = selectedRowIds.has(row.id);
                        
                        const globalRowIndex = estimateRows.findIndex((r: any) => r.id === row.id);

                        rowsToRender.push(
                          <tr 
                            key={row.id} 
                            onMouseDown={() => !isRoundedRow && handleRowMouseDown(row.id, itemCode)}
                            onMouseEnter={() => !isRoundedRow && handleRowMouseEnter(row.id, itemCode)}
                            className={`transition-colors border-b border-slate-800/50 group ${isRoundedRow ? '' : 'cursor-pointer'} ${isSelected ? 'bg-blue-900/40 hover:bg-blue-800/50' : 'hover:bg-slate-900/60'}`}
                          >
                            <td colSpan={2} className="p-0 border-r border-slate-800"></td>
                            <td className="p-1 border-r border-slate-800 text-center align-middle relative">
                              {!isRoundedRow && (
                                <input type="checkbox" checked={isSelected} readOnly className="pointer-events-none rounded bg-slate-900 border-slate-700 accent-blue-500 h-5 w-5 absolute top-2 left-[40%]" />
                              )}
                            </td>
                            <td className="p-1 border-r border-slate-800 relative">
                              {isRoundedRow ? (
                                <div className="w-full bg-slate-900/50 text-slate-400 pl-4 pr-2 py-1 text-base font-bold italic">{row.userDescription}</div>
                              ) : (
                                <input 
                                  id={`cell-${row.id}-userDescription`}
                                  type="text" 
                                  placeholder="Description of item..." 
                                  value={row.userDescription || ""} 
                                  onChange={(e) => updateRow(row.id, 'userDescription', e.target.value)} 
                                  onKeyDown={(e) => handleKeyDown(e, row.id, 'userDescription', globalRowIndex)}
                                  className="w-full bg-transparent outline-none text-slate-300 placeholder-slate-600 pl-4 pr-2 py-1 text-base relative z-10" 
                                />
                              )}
                            </td>
                            
                            <td className="p-1 border-r border-slate-800"><input id={`cell-${row.id}-nos`} type="text" value={row.nos} onChange={(e) => handleNumInput(row.id, 'nos', e.target.value)} onKeyDown={(e) => handleKeyDown(e, row.id, 'nos', globalRowIndex)} className={`w-full border border-transparent focus:border-blue-500 text-center text-white outline-none rounded py-1 font-mono text-sm ${isRoundedRow ? 'bg-slate-800 text-slate-400' : 'bg-slate-900/50 focus:bg-slate-900'}`} /></td>
                            <td className="p-1 border-r border-slate-800"><input id={`cell-${row.id}-num1`} type="text" value={isRoundedRow ? "" : row.num1} onChange={(e) => handleNumInput(row.id, 'num1', e.target.value)} onKeyDown={(e) => handleKeyDown(e, row.id, 'num1', globalRowIndex)} className={`w-full border border-transparent focus:border-blue-500 text-center text-white outline-none rounded py-1 font-mono text-sm ${isRoundedRow ? 'bg-slate-800 text-slate-400' : 'bg-slate-900/50 focus:bg-slate-900'}`} readOnly={isRoundedRow} /></td>
                            <td className="p-1 border-r border-slate-800"><input id={`cell-${row.id}-num2`} type="text" value={isRoundedRow ? "" : row.num2} onChange={(e) => handleNumInput(row.id, 'num2', e.target.value)} onKeyDown={(e) => handleKeyDown(e, row.id, 'num2', globalRowIndex)} className={`w-full border border-transparent focus:border-blue-500 text-center text-white outline-none rounded py-1 font-mono text-sm ${isRoundedRow ? 'bg-slate-800 text-slate-400' : 'bg-slate-900/50 focus:bg-slate-900'}`} readOnly={isRoundedRow} /></td>
                            
                            <td className="p-1 border-r border-slate-800"><input id={`cell-${row.id}-length`} type="text" value={isRoundedRow ? "" : row.length} onChange={(e) => handleNumInput(row.id, 'length', e.target.value)} onKeyDown={(e) => handleKeyDown(e, row.id, 'length', globalRowIndex)} className={`w-full border border-transparent focus:border-blue-500 text-center text-white outline-none rounded py-1 font-mono text-sm ${isRoundedRow ? 'bg-slate-800 text-slate-400' : 'bg-slate-900/50 focus:bg-slate-900'}`} readOnly={isRoundedRow} /></td>
                            <td className="p-1 border-r border-slate-800"><input id={`cell-${row.id}-breadth`} type="text" value={isRoundedRow ? "" : row.breadth} onChange={(e) => handleNumInput(row.id, 'breadth', e.target.value)} onKeyDown={(e) => handleKeyDown(e, row.id, 'breadth', globalRowIndex)} className={`w-full border border-transparent focus:border-blue-500 text-center text-white outline-none rounded py-1 font-mono text-sm ${isRoundedRow ? 'bg-slate-800 text-slate-400' : 'bg-slate-900/50 focus:bg-slate-900'}`} readOnly={isRoundedRow} /></td>
                            <td className="p-1 border-r border-slate-800"><input id={`cell-${row.id}-height`} type="text" value={isRoundedRow ? "" : row.height} onChange={(e) => handleNumInput(row.id, 'height', e.target.value)} onKeyDown={(e) => handleKeyDown(e, row.id, 'height', globalRowIndex)} className={`w-full border border-transparent focus:border-blue-500 text-center text-white outline-none rounded py-1 font-mono text-sm ${isRoundedRow ? 'bg-slate-800 text-slate-400' : 'bg-slate-900/50 focus:bg-slate-900'}`} readOnly={isRoundedRow} /></td>
                            <td className="p-1 border-r border-slate-800"><input id={`cell-${row.id}-coefficient`} type="text" value={isRoundedRow ? "" : row.coefficient} onChange={(e) => handleNumInput(row.id, 'coefficient', e.target.value)} onKeyDown={(e) => handleKeyDown(e, row.id, 'coefficient', globalRowIndex)} className={`w-full border border-transparent focus:border-blue-500 text-center text-white outline-none rounded py-1 font-mono text-sm ${isRoundedRow ? 'bg-slate-800 text-slate-400' : 'bg-slate-900/50 focus:bg-slate-900'}`} readOnly={isRoundedRow} /></td>
                            
                            <td className="p-2 text-right font-bold text-white border-r border-slate-800 bg-slate-900/20 text-base">{Number(row.quantity).toFixed(2)}</td>
                            <td className="p-1 text-center">
                              <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {!isRoundedRow && (
                                  <button onClick={(e) => { e.stopPropagation(); addSingleRow(row.itemCode, baseItem); }} className="text-blue-400 hover:text-white bg-blue-900/50 hover:bg-blue-600 px-1.5 py-0.5 rounded shadow border border-blue-800" title="Add Row">➕</button>
                                )}
                                <button onClick={(e) => { e.stopPropagation(); setDeleteTarget({type: 'row', id: row.id, code: ''}); }} className="text-rose-500 hover:text-white bg-rose-950 hover:bg-rose-600 px-1.5 py-0.5 rounded shadow border border-rose-800" title="Delete Row">❌</button>
                              </div>
                            </td>
                          </tr>
                        );
                      });

                      return <React.Fragment key={itemCode}>{rowsToRender}</React.Fragment>;
                    })}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
