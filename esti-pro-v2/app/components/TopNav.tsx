import React, { useState, useRef, useEffect } from 'react';

export default function TopNav({ activeTab, setActiveTab, theme, setTheme }: any) {
  const [estOpen, setEstOpen] = useState(false);
  const [justOpen, setJustOpen] = useState(false);
  const estRef = useRef<HTMLDivElement>(null);
  const justRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: any) => {
      if (estRef.current && !estRef.current.contains(event.target)) setEstOpen(false);
      if (justRef.current && !justRef.current.contains(event.target)) setJustOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    setEstOpen(false);
    setJustOpen(false);
  };

  const isEstActive = ["estimate", "measurement", "abstract", "general"].includes(activeTab);
  const isJustActive = ["radsr", "ratelist", "ramarket", "juststatement", "justsummary"].includes(activeTab);

  return (
    <div className="flex flex-col w-full z-[100] relative">
      {/* File Operations Top Bar */}
      <div className="bg-slate-50 dark:bg-slate-100 text-slate-800 text-[11px] font-bold flex gap-4 px-4 py-1.5 border-b border-slate-300 items-center justify-between shadow-sm">
        <div className="flex gap-4 items-center">
          <button className="hover:text-blue-600 flex items-center gap-1 transition-colors"><span className="text-blue-500">➕</span> New Estimate</button>
          <button className="hover:text-amber-600 flex items-center gap-1 transition-colors"><span className="text-amber-500">📂</span> Load Estimate</button>
          <button className="hover:text-emerald-600 flex items-center gap-1 transition-colors"><span className="text-emerald-500">💾</span> Save Estimate</button>
          <button className="hover:text-purple-600 flex items-center gap-1 transition-colors"><span className="text-purple-500">🎨</span> Theme Settings ▾</button>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-blue-600 italic">eSTI-Pro v2.0.0 | Unsaved Project</span>
          <button className="text-rose-600 hover:text-rose-800 transition-colors flex items-center gap-1"><span className="text-rose-500 font-bold">✕</span> Exit</button>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="bg-[#0b0f19] border-b border-slate-800 flex items-center px-4 py-2 text-sm select-none">
        <div className="flex gap-2 w-full items-center">
          
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
                <button onClick={() => handleTabClick("estimate")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'estimate' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Measurement Sheet</button>
                <button onClick={() => handleTabClick("estimate")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white text-slate-300`}>Detailed Abstract</button>
                <button onClick={() => handleTabClick("estimate")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white text-slate-300`}>General Abstract</button>
              </div>
            )}
          </div>

          {/* Justification Dropdown */}
          <div className="relative" ref={justRef}>
            <button 
              onClick={() => setJustOpen(!justOpen)} 
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
                <button onClick={() => handleTabClick("radsr")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'radsr' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>RA DSR</button>
                <button onClick={() => handleTabClick("ratelist")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'ratelist' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Rate List</button>
                <button onClick={() => handleTabClick("ramarket")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'ramarket' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>RA Market</button>
                <button onClick={() => handleTabClick("juststatement")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'juststatement' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Justification Statement</button>
                <button onClick={() => handleTabClick("justsummary")} className={`px-4 py-2 text-left hover:bg-blue-600 hover:text-white ${activeTab === 'justsummary' ? 'text-blue-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}>Justification Summary</button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}