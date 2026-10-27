import React, { useState, useRef, useEffect, useMemo } from "react";

const HighlightText = ({ text, query, highlightClass }: { text: string, query: string, highlightClass: string }) => {
  if (!query || typeof text !== 'string') return <>{text}</>;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
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

const cleanCode = (c: any) => c?.toString().trim() || "";
const isExternalRateItem = (item: any) => item?.isExternalAR === true || Number(item?.is_external_ar) === 1;

const sortCodes = (a: string, b: string) => {
  const regex = /(\d+)|([a-zA-Z]+)/g;
  const pA = Array.from(a.matchAll(regex)).map((m: any) => m[0]);
  const pB = Array.from(b.matchAll(regex)).map((m: any) => m[0]);
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

export default function DatabaseExplorer({ 
  rates, search, setSearch, addToMeasurement, addAllToMeasurement, handleViewAR, theme,
  checkedItems, setCheckedItems, estimateRows, onOpenCreateModal, onEditNSR, onDeleteNSR, customRateCodes = [], selectedSHTarget
}: any) {
  
  const safeRates = useMemo(() => {
    const parsed = (rates || []).map((r: any) => ({ ...r, code: cleanCode(r.code) }));
    return parsed.sort((a: any, b: any) => sortCodes(a.code, b.code));
  }, [rates]);

  const [selectedSH, setSelectedSH] = useState(selectedSHTarget || "SH 2: EARTH WORK");

  useEffect(() => {
    if (selectedSHTarget) setSelectedSH(selectedSHTarget);
  }, [selectedSHTarget]);
  const [fullWrap, setFullWrap] = useState(true);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  
  const [mainSearchInput, setMainSearchInput] = useState("");
  const [mainSearchQuery, setMainSearchQuery] = useState("");
  const [mainMatchIdx, setMainMatchIdx] = useState(-1);

  const [glimpseSearchInput, setGlimpseSearchInput] = useState("");
  const [glimpseSearchQuery, setGlimpseSearchQuery] = useState("");
  const [glimpseMatchIdx, setGlimpseMatchIdx] = useState(-1);

  const [isListening, setIsListening] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [heardCodes, setHeardCodes] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);

  const [bulkInput, setBulkInput] = useState("");
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<any | null>(null);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});

  const boqTrack = useMemo(() => {
    const track: Record<string, boolean> = {};
    (estimateRows || []).forEach((r: any) => { track[cleanCode(r.itemCode)] = true; });
    return track;
  }, [estimateRows]);

  const subheads = [
    "SH 1: CARRIAGE OF MATERIALS", "SH 2: EARTH WORK", "SH 3: MORTARS", "SH 4: CONCRETE WORK",
    "SH 5: REINFORCED CEMENT CONCRETE", "SH 6: BRICK WORK", "SH 7: STONE WORK", "SH 8: MARBLE AND GRANITE WORK",
    "SH 9: WOOD AND P.V.C. WORK", "SH 10: STEEL WORK", "SH 11: FLOORING", "SH 12: ROOFING", "SH 13: FINISHING",
    "SH 14: REPAIRS TO BUILDINGS", "SH 15: DISMANTLING AND DEMOLITION", "SH 16: ROAD WORK", "SH 17: SANITARY INSTALLATIONS",
    "SH 18: WATER SUPPLY", "SH 19: DRAINAGE", "SH 20: PILE WORK", "SH 21: ALUMINIUM WORK", "SH 22: WATER PROOFING",
    "SH 23: STRUCTURAL STEEL & METAL WORKS", "SH 24: BUILDING MAINTENANCE", "SH 25: ROAD & PAVEMENT REPAIRS",
    "SH 26: WATER SUPPLY & SANITARY FITTINGS", "SH 49: SPECIAL ARs / Sub ARs (NOT IN DSR)", 
    "SH 50: MODIFIED DSR ITEMS (mDSR)", "SH 51: NON-SCHEDULE ITEMS (NS)"
  ];

  const filteredRates = safeRates.filter((r: any) => {
    const safeCode = cleanCode(r.code);
    const matchesSearch = safeCode.toLowerCase().includes(mainSearchQuery.toLowerCase()) || r.description?.toLowerCase().includes(mainSearchQuery.toLowerCase());
    
    const shNum = selectedSH.split(":")[0].replace("SH ", "").trim();
    
    let matchesSH = false;
    if (selectedSH === "ALL") {
      matchesSH = true;
    } else if (shNum === "50") {
      matchesSH = safeCode.startsWith("50") || safeCode.toLowerCase().startsWith("mdsr") || safeCode.toLowerCase().startsWith("m-");
    } else if (shNum === "51") {
      matchesSH = safeCode.startsWith("51") || safeCode.toLowerCase().startsWith("nsr") || safeCode.toLowerCase().startsWith("ns-");
    } else if (shNum === "49") {
      matchesSH = safeCode === "49" || safeCode.startsWith("49.") || safeCode.toLowerCase().startsWith("ar-");
    } else {
      matchesSH = safeCode === shNum || safeCode.startsWith(shNum + ".");
    }
    
    return matchesSearch && (matchesSH || mainSearchQuery.length > 0);
  });

  const validEntriesCount = filteredRates.filter((r: any) => isExternalRateItem(r) || (r.rate && Number(r.rate) > 0)).length;

  const handleCheckboxToggle = (code: string) => {
    const safeC = cleanCode(code);
    setCheckedItems((prev: string[]) => prev.includes(safeC) ? prev.filter(c => c !== safeC) : [safeC, ...prev]);
  };

  const handleAddCheckedItems = () => {
    const itemsToAdd = safeRates.filter((r: any) => checkedItems.includes(cleanCode(r.code)) && !boqTrack[cleanCode(r.code)] && (isExternalRateItem(r) || Number(r.rate) > 0));
    addAllToMeasurement(itemsToAdd);
    
    setCheckedItems((prev: string[]) => prev.filter(c => {
      const r = safeRates.find((x: any) => cleanCode(x.code) === c);
      if (!r || !r.rate || Number(r.rate) === 0) return false;
      return !itemsToAdd.some((add: any) => cleanCode(add.code) === c);
    }));
  };

  const handleAddAllToBOQ = () => {
    const itemsToAdd = safeRates.filter((r: any) => checkedItems.includes(cleanCode(r.code)) && !boqTrack[cleanCode(r.code)] && (isExternalRateItem(r) || Number(r.rate) > 0));
    addAllToMeasurement(itemsToAdd);
  };

  const handleClearGlimpse = () => {
    setCheckedItems([]);
  };

  const handleBulkPaste = () => {
    const codes = bulkInput.match(/\b\d+[a-zA-Z]*(?:\.\d+[a-zA-Z]*)+\b/gi) || [];
    const validCodes = codes.map(c => {
      const match = safeRates.find((r: any) => cleanCode(r.code).toLowerCase() === c.toLowerCase());
      return (match && (isExternalRateItem(match) || Number(match.rate) > 0)) ? cleanCode(match.code) : null;
    }).filter(Boolean) as string[];
    
    if (validCodes.length > 0) {
      const toAdd = validCodes.filter(c => !checkedItems.includes(c));
      setCheckedItems((prev: string[]) => [...toAdd, ...prev]);
    }
    setBulkInput("");
  };

  const handleScrollToMatch = (selector: string, direction: 'next' | 'prev', currentIndex: number, setIdx: (i: number) => void) => {
    const marks = document.querySelectorAll(selector);
    if (marks.length === 0) return;
    
    let nextIdx = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIdx >= marks.length) nextIdx = 0;
    if (nextIdx < 0) nextIdx = marks.length - 1;
    
    marks.forEach(m => { m.classList.remove('bg-orange-500', 'text-white'); m.classList.add('bg-yellow-500', 'text-black'); });
    
    const target = marks[nextIdx];
    if (target) {
      target.classList.remove('bg-yellow-500', 'text-black');
      target.classList.add('bg-orange-500', 'text-white');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setIdx(nextIdx);
  };

  useEffect(() => { setMainMatchIdx(-1); }, [mainSearchQuery]);
  useEffect(() => { setGlimpseMatchIdx(-1); }, [glimpseSearchQuery]);

  useEffect(() => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollTop = scrollPositions.current[selectedSH] || 0;
    }
  }, [selectedSH]);

  const handleTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
    scrollPositions.current[selectedSH] = e.currentTarget.scrollTop;
  };

  useEffect(() => {
    if (!voiceText) return;
    let cleanedVoice = voiceText.replace(/\s*\.\s*/g, '.').replace(/(\d)\s+([a-zA-Z])(?=[\s\.,]|$)/g, '$1$2');
    
    let list: string[] = [];
    const selectMatches = cleanedVoice.match(/select\s+items?\s+([a-zA-Z\d\.\s,and]+)/gi);
    if (selectMatches) {
      selectMatches.forEach(phrase => {
        const codes = phrase.match(/\b\d+[a-zA-Z]*(?:\.\d+[a-zA-Z]*)*\b/gi) || [];
        list.push(...codes);
      });
    }

    list = list.map(c => {
      const match = safeRates.find((r: any) => cleanCode(r.code).toLowerCase() === c.toLowerCase());
      return (match && (isExternalRateItem(match) || Number(match.rate) > 0)) ? cleanCode(match.code) : null;
    }).filter(Boolean) as string[];
    
    setHeardCodes(list);
  }, [voiceText, safeRates]);

  const startVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Voice search is not supported in this browser.");
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript + " ";
      setVoiceText(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setVoiceText("");
    setHeardCodes([]);
    setIsListening(true);
    recognition.start();
  };

  const stopVoice = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
    if (heardCodes.length > 0) {
      const toAdd = heardCodes.filter(c => !checkedItems.includes(c));
      setCheckedItems((prev: string[]) => [...toAdd, ...prev]);
    }
    setVoiceText("");
  };

  const baseGlimpseItems = useMemo(() => {
    const checkedList = checkedItems.map((code: string) => safeRates.find((r:any) => cleanCode(r.code) === code)).filter(Boolean);
    const boqList = Object.keys(boqTrack).map(code => safeRates.find((r:any) => cleanCode(r.code) === code)).filter(Boolean);
    return [...checkedList.filter((item: any) => !boqTrack[cleanCode(item.code)]), ...boqList];
  }, [checkedItems, boqTrack, safeRates]);

  const searchedGlimpseItems = glimpseSearchQuery 
    ? baseGlimpseItems.filter((item: any) => cleanCode(item.code).toLowerCase().includes(glimpseSearchQuery.toLowerCase()))
    : baseGlimpseItems;

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-950 text-slate-100 font-sans text-sm relative">
      
      {isListening && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8">
          <div className="bg-slate-900 border border-purple-500 rounded-2xl p-8 max-w-3xl w-full shadow-2xl flex flex-col items-center">
            <div className="text-purple-500 text-5xl animate-pulse mb-4">🎙️</div>
            <h2 className="text-xl font-bold text-white mb-2">System is hearing...</h2>
            <div className="w-full bg-slate-950 border border-slate-700 rounded-lg p-4 mb-6 shadow-inner">
              <h3 className="font-bold text-blue-400 mb-3 border-b border-slate-800 pb-2">Heard Items List</h3>
              {heardCodes.length === 0 ? (
                <div className="text-slate-500 italic text-center py-4">Dictate item codes (e.g., "4.5.1A", "15.60")...</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-400">
                    <tr><th className="py-2 w-16 text-center">Sl. No.</th><th className="py-2">Item No.</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {heardCodes.map((code, idx) => (
                      <tr key={idx}>
                        <td className="py-2 text-center font-bold text-slate-300">{idx + 1}</td>
                        <td className="py-2 font-mono text-amber-400">{code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <button onClick={stopVoice} className="bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold py-2.5 px-12 rounded shadow-lg transition-colors">Stop & Select Items</button>
          </div>
        </div>
      )}

      {isSidebarHidden && (
        <div 
          onClick={() => setIsSidebarHidden(false)} 
          className="w-10 border-r border-slate-800 bg-slate-900 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-800 transition-colors z-10 shadow-lg"
        >
          <span className="text-slate-400 text-xs font-bold tracking-widest uppercase" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            ▶ Show Subheads
          </span>
        </div>
      )}

      {!isSidebarHidden && (
        <div className="w-72 border-r border-slate-800 bg-slate-900 flex flex-col shrink-0 z-10">
          <div className="p-3 border-b border-slate-800 flex justify-between items-center font-bold text-blue-400">
            <button onClick={() => setIsSidebarHidden(true)} className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-400 hover:text-white transition-colors shadow">◀ Hide</button>
            <span>SUBHEADS</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
            {subheads.map((sh, idx) => (
              <div key={idx} onClick={() => setSelectedSH(sh)} className={`p-3 cursor-pointer font-bold transition-colors truncate ${selectedSH === sh ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'}`}>
                {sh}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="w-72 border-r border-slate-800 bg-slate-900/60 p-3 flex flex-col shrink-0 z-10">
        <div className="text-amber-400 font-bold mb-2 flex justify-between items-center">
          <span>GLIMPSE</span>
          <button onClick={startVoice} className="text-[10px] px-2 py-1 rounded text-white bg-purple-600 hover:bg-purple-500 flex items-center gap-1 shadow">
            🎙️ Voice
          </button>
        </div>

        <div className="flex bg-slate-950 border border-slate-700 rounded items-center overflow-hidden mb-3">
          <input type="text" placeholder="Bulk Paste (e.g. 4.1.2, 5.22A)" className="bg-transparent pl-2 pr-2 py-1.5 focus:outline-none w-full text-white text-[11px]" value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} />
          <button onClick={handleBulkPaste} className="bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-white font-bold text-[11px] border-l border-slate-700">Add</button>
        </div>

        <div className="flex gap-2 mb-3 pt-2 border-t border-slate-700/50">
          <button onClick={handleAddAllToBOQ} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 rounded text-[11px] shadow transition-colors">
            + Add All to BOQ
          </button>
          <button onClick={handleClearGlimpse} className="bg-rose-700 hover:bg-rose-600 text-white font-bold py-1.5 px-3 rounded text-[11px] shadow transition-colors">
            🗑️ Clear All
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {searchedGlimpseItems.length === 0 ? (
             <div className="text-center text-slate-500 py-10 italic">No items selected.</div>
          ) : searchedGlimpseItems.map((item: any, i: number) => {
            const safeCode = cleanCode(item.code);
            const isInBoq = boqTrack[safeCode];
            return (
              <div key={i} className={`border border-slate-700 p-2 rounded relative shadow flex items-center justify-between transition-colors ${isInBoq ? 'bg-slate-900/50 opacity-60' : 'bg-slate-800 hover:bg-slate-700'}`}>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-amber-400 font-mono text-sm pl-2">
                    <HighlightText text={safeCode} query={glimpseSearchQuery} highlightClass="glimpse-highlight" />
                  </span>
                </div>
                
                <div className="flex items-center gap-1.5 pr-1">
                  {isInBoq ? (
                    <span className="bg-emerald-900/50 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold shadow-inner">
                      In BOQ
                    </span>
                  ) : (
                    <>
                      <button onClick={() => addToMeasurement(item)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded font-bold transition-colors shadow-sm text-[10px]">
                        + BOQ
                      </button>
                      <button onClick={() => handleCheckboxToggle(safeCode)} className="text-slate-400 hover:text-rose-400 font-bold px-1.5 py-0.5 rounded transition-colors text-[10px]" title="Remove from Glimpse">
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 z-10">
        <div className="p-3 border-b border-slate-800 flex flex-wrap justify-between items-center gap-3 bg-slate-900">
          <div className="font-bold text-blue-400 text-sm">
            {selectedSH} ({validEntriesCount} items)
          </div>

          <div className="flex items-center gap-2 text-sm">
            {(selectedSH.includes("SH 50") || selectedSH.includes("SH 51")) && onOpenCreateModal && (
              <button 
                onClick={onOpenCreateModal}
                className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded font-bold shadow transition-colors flex items-center gap-1 text-xs"
              >
                + Create Custom Item
              </button>
            )}
            <button onClick={handleAddCheckedItems} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded font-bold shadow">
              + Add Selected Items
            </button>
            <div className="flex bg-slate-950 border border-slate-700 rounded items-center overflow-hidden">
              <div className="relative flex items-center">
                <input type="text" placeholder="Search code or description..." className="bg-transparent pl-3 pr-8 py-1.5 focus:outline-none w-56 text-white text-xs" value={mainSearchInput} onChange={(e) => setMainSearchInput(e.target.value)} />
                {mainSearchInput && (
                  <button onClick={() => { setMainSearchInput(""); setMainSearchQuery(""); setMainMatchIdx(-1); }} className="absolute right-2 text-slate-400 hover:text-white text-base leading-none p-1">✕</button>
                )}
              </div>
              <button onClick={() => setMainSearchQuery(mainSearchInput)} className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-white font-bold text-xs border-l border-slate-700">Search</button>
              {mainSearchQuery && (
                <div className="flex items-center bg-slate-800 border-l border-slate-700 text-xs h-full">
                   <button onClick={() => handleScrollToMatch('.main-highlight', 'prev', mainMatchIdx, setMainMatchIdx)} className="px-2 py-1.5 hover:bg-slate-700 text-slate-300 border-r border-slate-700">↑</button>
                   <button onClick={() => handleScrollToMatch('.main-highlight', 'next', mainMatchIdx, setMainMatchIdx)} className="px-2 py-1.5 hover:bg-slate-700 text-slate-300">↓</button>
                </div>
              )}
            </div>
            <button className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded font-bold shadow ml-1">Export CSV</button>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 ml-2">
              <input type="checkbox" checked={fullWrap} onChange={(e) => setFullWrap(e.target.checked)} className="rounded bg-slate-800 border-slate-700 accent-blue-600" />
              <span>Full Multi-line Wrap</span>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-auto" ref={tableContainerRef} onScroll={handleTableScroll}>
          <table className="w-full text-left">
            <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 sticky top-0 shadow z-20 text-sm">
              <tr>
                <th className="p-3 w-32 pl-6">Item No.</th>
                <th className="p-3">Description</th>
                <th className="p-3 w-16 text-center">Unit</th>
                <th className="p-3 w-24 text-right">Rate (₹)</th>
                <th className="p-3 w-24 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredRates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-16 text-slate-500 italic">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <span className="text-4xl">📂</span>
                      <span className="text-slate-400 font-medium">No items found in {selectedSH}.</span>
                      {(selectedSH.includes("SH 50") || selectedSH.includes("SH 51")) && onOpenCreateModal ? (
                        <button 
                          onClick={onOpenCreateModal}
                          className="mt-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded font-bold text-xs shadow transition-colors"
                        >
                          + Create Custom Item
                        </button>
                      ) : (
                        <span className="text-xs text-slate-600">Try searching or selecting another subhead.</span>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRates.map((item: any, idx: number) => {
                  const safeCode = cleanCode(item.code);
                  const isExternalAR = isExternalRateItem(item);
                  const isParent = !isExternalAR && (!item.rate || Number(item.rate) === 0);
                  const isInBoq = boqTrack[safeCode];
                  const isSelected = checkedItems.includes(safeCode);

                  return (
                    <tr key={idx} className={`transition-colors ${isParent ? 'bg-slate-900/90 font-bold text-amber-400' : isInBoq ? 'bg-slate-950 opacity-50 pointer-events-none' : 'hover:bg-slate-900/50 text-base'}`}>
                      
                      <td className="p-3 font-mono text-blue-400 font-bold text-base pl-6 relative">
                        {!isParent ? (
                           <span onClick={() => !isInBoq && handleCheckboxToggle(safeCode)} className={`flex items-center gap-2 ${isInBoq ? 'cursor-not-allowed' : 'cursor-pointer hover:underline underline-offset-4'}`} title={isInBoq ? "Already in BOQ" : "Click to toggle selection"}>
                             <HighlightText text={safeCode} query={mainSearchQuery} highlightClass="main-highlight" />
                             {isSelected && !isInBoq && <span className="text-[10px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded border border-blue-800">Selected</span>}
                             {isInBoq && <span className="text-[10px] bg-emerald-900/50 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800">In BOQ</span>}
                              {isExternalAR && <span className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded border border-violet-700" title="External rate analysis; entered rate is used directly">Ext. RA</span>}
                           </span>
                        ) : (
                           <>
                             <HighlightText text={safeCode} query={mainSearchQuery} highlightClass="main-highlight" />
                             {isExternalAR && <span className="ml-2 text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded border border-violet-700" title="External rate analysis; entered rate is used directly">Ext. RA</span>}
                           </>
                        )}
                      </td>
                      
                      <td className={`p-3 text-slate-200 text-justify text-base leading-relaxed ${fullWrap ? '' : 'truncate max-w-xl'}`}>
                        <HighlightText text={item.description || ""} query={mainSearchQuery} highlightClass="main-highlight" />
                      </td>
                      <td className="p-3 text-center text-slate-400 text-sm">{item.unit ?? ""}</td>
                      <td className="p-3 text-right font-mono text-green-400 font-bold text-base">{item.rate === null || item.rate === undefined || item.rate === "" ? "" : Number(item.rate).toFixed(2)}</td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {!isParent && !isExternalAR && (
                            <button onClick={() => handleViewAR(item)} className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold shadow transition-colors pointer-events-auto">View AR</button>
                          )}
                          {!isParent && customRateCodes.includes(safeCode) && (
                            <>
                              <button onClick={() => onEditNSR && onEditNSR(item)} className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold shadow transition-colors pointer-events-auto">Edit</button>
                              <button onClick={() => setDeleteConfirmItem(item)} className="px-2 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold shadow transition-colors pointer-events-auto">✕</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {deleteConfirmItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6 text-center">
            <h3 className="text-lg font-bold text-white mb-2">Delete Custom Item?</h3>
            <p className="text-slate-400 mb-6">Are you sure you want to delete item <span className="font-mono text-amber-400">{deleteConfirmItem.code}</span>?</p>
            <div className="flex justify-center gap-4">
              <button autoFocus onClick={() => setDeleteConfirmItem(null)} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-bold transition-colors outline-none focus:ring-2 focus:ring-blue-500 focus:bg-slate-600">No, Cancel</button>
              <button onClick={() => { if(onDeleteNSR) onDeleteNSR(deleteConfirmItem); setDeleteConfirmItem(null); }} className="px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold transition-colors">Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
