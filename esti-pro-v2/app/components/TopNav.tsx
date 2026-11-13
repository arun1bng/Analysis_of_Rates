import React, { useState, useRef, useEffect } from 'react';

export default function TopNav({ activeTab, setActiveTab, onSelectEstimateSubTab, justificationSubTab, onSelectJustificationSubTab, theme, setTheme, onNewEstimate, onSaveEstimate, onSaveAs, onLoadEstimate, projectId, autoSaveState }: any) {
  const [estOpen, setEstOpen] = useState(false);
  const [justOpen, setJustOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const estRef = useRef<HTMLDivElement>(null);
  const justRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: any) => {
      if (estRef.current && !estRef.current.contains(event.target)) setEstOpen(false);
      if (justRef.current && !justRef.current.contains(event.target)) setJustOpen(false);
      if (themeRef.current && !themeRef.current.contains(event.target)) setThemeOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    setEstOpen(false);
    setJustOpen(false);
  };

  const handleEstimateSubTabClick = (subTab: string) => {
    setActiveTab("estimate");
    onSelectEstimateSubTab(subTab);
    setEstOpen(false);
    setJustOpen(false);
  };

  const handleJustificationClick = () => {
    if (justificationSubTab) setActiveTab(justificationSubTab);
    setJustOpen(open => !open);
    setEstOpen(false);
  };

  const handleJustificationSubTabClick = (subTab: string) => {
    if (onSelectJustificationSubTab) onSelectJustificationSubTab(subTab);
    else setActiveTab(subTab);
    setJustOpen(false);
    setEstOpen(false);
  };

  const isEstActive = ["estimate", "measurement", "abstract", "general"].includes(activeTab);
  const isJustActive = ["radsr", "ratelist", "itemsforjustification", "ramarket", "juststatement", "justsummary"].includes(activeTab);

  return (
    <div className="flex flex-col w-full z-[100] relative">
      {/* File Operations Top Bar */}
      <div className="bg-olive-card dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-[11px] font-bold flex gap-4 px-4 py-1.5 border-b border-slate-300 dark:border-slate-700 items-center justify-between shadow-sm">
        <div className="flex gap-4 items-center">
          <button onClick={onNewEstimate} className="hover:text-blue-600 flex items-center gap-1 transition-colors"><span className="text-blue-500">➕</span> New Estimate</button>
          <button onClick={onLoadEstimate} className="hover:text-amber-600 flex items-center gap-1 transition-colors"><span className="text-amber-500">📂</span> Load Estimate</button>
          <button onClick={onSaveAs} className="hover:text-purple-600 flex items-center gap-1 transition-colors"><span className="text-purple-500">🗂</span> Save As</button>
          <button onClick={onSaveEstimate} className="hover:text-emerald-600 flex items-center gap-1 transition-colors"><span className="text-emerald-500">💾</span> Save Estimate</button>
          <div className="relative" ref={themeRef}>
            <button
              type="button"
              onClick={() => setThemeOpen(open => !open)}
              aria-haspopup="menu"
              aria-expanded={themeOpen}
              className="flex items-center gap-1 transition-colors hover:text-purple-600"
            >
              <span className="text-purple-500" aria-hidden="true">🎨</span> Theme Settings ▾
            </button>
            {themeOpen && (
              <div role="menu" aria-label="Theme settings" className="absolute left-0 top-full z-[120] mt-2 w-44 rounded-md border border-slate-300 bg-olive-card py-1 text-slate-800 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                {([
                  ["light", "Light Mode"],
                  ["dark", "Dark Mode"],
                  ["system", "System"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === value}
                    onClick={() => { setTheme(value); setThemeOpen(false); }}
                    className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${theme === value ? "font-bold text-blue-700 dark:text-blue-300" : ""}`}
                  >
                    {label}{theme === value ? " ✓" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-blue-600 italic">eSTI-Pro v2.0.0 | {projectId || "Starting estimate"} | Auto-save: {autoSaveState || "idle"}</span>
          <button className="text-rose-600 hover:text-rose-800 transition-colors flex items-center gap-1"><span className="text-rose-500 font-bold">✕</span> Exit</button>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="bg-olive-light text-slate-800 dark:bg-[#0b0f19] dark:text-slate-100 border-b border-slate-300 dark:border-slate-800 flex items-center px-4 py-2 text-sm select-none">
        <div className="flex w-full flex-wrap items-center gap-2">
          
          <button onClick={() => handleTabClick("home")} className={`px-4 py-1.5 rounded font-bold transition-colors ${activeTab === 'home' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
            Home
          </button>
          
          <button onClick={() => handleTabClick("database")} className={`px-4 py-1.5 rounded font-bold transition-colors ${activeTab === 'database' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
            Select Items
          </button>

          {/* Estimate Dropdown */}
          <div className="relative" ref={estRef}>
            <button 
              onClick={() => { handleTabClick("estimate"); setEstOpen(!estOpen); }}
              onMouseEnter={() => { setEstOpen(true); setJustOpen(false); }}
              className={`px-4 py-1.5 rounded font-bold transition-colors flex items-center gap-1 w-[200px] justify-between ${isEstActive || estOpen ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <span>Estimate</span>
              <span className="font-mono">{estOpen ? "— ▾" : "▾"}</span>
            </button>
            
            {estOpen && (
              <div 
                onMouseLeave={() => setEstOpen(false)}
                className="absolute top-full left-0 mt-1 w-[200px] bg-slate-900 border border-slate-700 rounded shadow-2xl py-1 z-50 flex flex-col"
              >
                <button onClick={() => handleEstimateSubTabClick("measurement")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'estimate' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Measurement Sheet</button>
                <button onClick={() => handleEstimateSubTabClick("abstract")} className="px-4 py-2 text-left text-slate-300 hover:bg-blue-600 hover:text-white">Detailed Abstract</button>
                <button onClick={() => handleEstimateSubTabClick("general")} className="px-4 py-2 text-left text-slate-300 hover:bg-blue-600 hover:text-white">General Abstract</button>
                <button onClick={() => handleEstimateSubTabClick("history")} className="px-4 py-2 text-left text-slate-300 hover:bg-blue-600 hover:text-white">History Sheet</button>
              </div>
            )}
          </div>

          {/* Justification Dropdown */}
          <div className="relative" ref={justRef}>
            <button 
              onClick={handleJustificationClick} 
              onMouseEnter={() => { setJustOpen(true); setEstOpen(false); }}
              className={`px-4 py-1.5 rounded font-bold transition-colors flex items-center gap-1 w-[200px] justify-between ${isJustActive || justOpen ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <span>Justification</span>
              <span className="font-mono">{justOpen ? "— ▾" : "▾"}</span>
            </button>
            
            {justOpen && (
              <div 
                onMouseLeave={() => setJustOpen(false)}
                className="absolute top-full left-0 mt-1 w-[200px] bg-slate-900 border border-slate-700 rounded shadow-2xl py-1 z-50 flex flex-col"
              >
                <button onClick={() => handleJustificationSubTabClick("itemsforjustification")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'itemsforjustification' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Items for Justfn</button>
                <button onClick={() => handleJustificationSubTabClick("radsr")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'radsr' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>RA DSR</button>
                <button onClick={() => handleJustificationSubTabClick("ratelist")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'ratelist' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Rate List</button>
                <button onClick={() => handleJustificationSubTabClick("ramarket")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'ramarket' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>RA Market</button>
                <button onClick={() => handleJustificationSubTabClick("juststatement")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'juststatement' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Justification Statement</button>
                <button onClick={() => handleJustificationSubTabClick("justsummary")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'justsummary' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Justification Summary</button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
