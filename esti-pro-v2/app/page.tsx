"use client";
import React, { useEffect, useState } from "react";
import TopNav from "./components/TopNav";
import ProjectSettings from "./components/ProjectSettings";
import DatabaseExplorer from "./components/DatabaseExplorer";
import MeasurementSheet from "./components/MeasurementSheet";
import Abstract from "./components/Abstract";
import GeneralAbstract from "./components/GeneralAbstract";
import CreateNSR from "./components/CreateNSR";
import Justification from "./components/Justification";
import RateAnalysisDSR from "./components/RateAnalysisDSR";
import RateList from "./components/RateList";
import RateAnalysisMarket from "./components/RateAnalysisMarket";
import JustificationStatement from "./components/JustificationStatement";
import JustificationSummary from "./components/JustificationSummary";

const DEFAULT_PROJECT_DETAILS = { 
  estimateId: "EST-2026-001", 
  dsrVersion: "DSR 2023", 
  currencyFormat: "Indian (Lakhs/Crores)",
  nameOfWork: "", 
  gstModificationFactor: "0.973",
  costIndex: "15", 
  contingencyType: "As per CPWD norms", 
  customContingency: "0",
  typeOfWork: "Buildings",
  epf: "3.125",
  esi: "0.8125",
  customTaxName: "",
  customTaxRate: "",
  calcOrder: ['costIndex', 'gst', 'contingency', 'epfEsi', 'customTax']
};

export default function App() {
  const [activeTab, setActiveTab] = useState("home"); 
  const [estimateSubTab, setEstimateSubTab] = useState("measurement"); 
  
  const [theme, setTheme] = useState("dark"); 
  const [projectDetails, setProjectDetails] = useState(DEFAULT_PROJECT_DETAILS);
  const [estimateRows, setEstimateRows] = useState<any[]>([]);
  
  const [marketRates, setMarketRates] = useState<Record<string, number>>({});
  const [rates, setRates] = useState<any[]>([]);
  const [dbCheckedItems, setDbCheckedItems] = useState<string[]>([]);
  
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [analysisData, setAnalysisData] = useState<any[]>([]);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [arHistory, setArHistory] = useState<any[]>([]);

  // THIS IS THE FIX FOR THE ERROR: Defining the modal states
  const [nsrItems, setNsrItems] = useState<any[]>([]);
  const [isNsrModalOpen, setIsNsrModalOpen] = useState(false);
  const [editingNsrItem, setEditingNsrItem] = useState<any | null>(null);

 useEffect(() => {
    // Load standard DSR rates
    fetch("/api/basic-rates").then(res => res.json()).then(setRates).catch(console.error);
    
    // Load previously saved NSR/mDSR items from the separate database
    fetch("/api/custom-rates")
      .then(res => res.json())
      .then(savedCustomItems => {
        if (Array.isArray(savedCustomItems)) {
          setNsrItems(savedCustomItems);
        }
      })
      .catch(console.error);
  }, []);

  const addToMeasurement = (item: any) => {
    setEstimateRows(prev => [...prev, {
      id: crypto.randomUUID(), slNo: prev.length + 1, itemCode: item.code, userDescription: "",
      unit: item.unit || "cum", rate: item.rate || 0,
      nos: 1, num1: 1, num2: 1, length: "", breadth: "", height: "", coefficient: "", quantity: 1, amount: item.rate || 0
    }]);
  };

  const addAllToMeasurement = (itemsToAdd: any[]) => {
    const validItems = itemsToAdd.filter(item => item.rate && item.rate > 0);
    const newRows = validItems.map((item, idx) => ({
      id: crypto.randomUUID(), slNo: estimateRows.length + idx + 1, itemCode: item.code, userDescription: "",
      unit: item.unit || "cum", rate: item.rate || 0,
      nos: 1, num1: 1, num2: 1, length: "", breadth: "", height: "", coefficient: "", quantity: 1, amount: item.rate || 0
    }));
    setEstimateRows(prev => [...prev, ...newRows]);
  };

  const formatDescription = (desc: string, code: string) => {
    if (desc && code && desc.includes(code)) {
      const parts = desc.split(code);
      if (parts.length > 1) return parts.pop()?.trim().replace(/^[:\-\s]+/, '') || desc;
    }
    return desc;
  };

  const getParentDescription = (code: string) => {
    if (!code) return "";
    const parentCode = code.split('.').slice(0, -1).join('.');
    const parentItem = rates.find((r: any) => r.code === parentCode);
    return parentItem ? parentItem.description : "";
  };

    const handleViewAR = (item: any, isBack = false) => {
    if (!item) { setSelectedItem(null); setArHistory([]); return; }
    if (!isBack && selectedItem && selectedItem.code !== item.code) {
      setArHistory(prev => [...prev, selectedItem]);
    }
    setSelectedItem(item);
    
    // Check if it's a Custom Item in memory first
    const customItem = nsrItems.find(i => i.code === item.code);
    if (customItem) {
      setAnalysisData(customItem.analysisRows || []);
      return;
    }

    setLoadingAnalysis(true);
    fetch(`/api/rate-analysis?code=${item.code}`)
      .then(res => res.json())
      .then(data => { setAnalysisData(Array.isArray(data) ? data : []); setLoadingAnalysis(false); })
      .catch(() => setLoadingAnalysis(false));
  };

  const handleBackAR = () => {
    const prevItems = [...arHistory];
    const prevItem = prevItems.pop();
    setArHistory(prevItems);
    if (prevItem) {
      setSelectedItem(prevItem);
      setLoadingAnalysis(true);
      fetch(`/api/rate-analysis?code=${prevItem.code}`)
        .then(res => res.json())
        .then(data => { setAnalysisData(Array.isArray(data) ? data : []); setLoadingAnalysis(false); })
        .catch(() => setLoadingAnalysis(false));
    }
  };

  const closeARModal = () => {
    setSelectedItem(null);
    setArHistory([]);
  };

  const renderEstimateBundle = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex bg-slate-900 border-b border-slate-800 px-4 pt-2 gap-2 shrink-0">
        <button onClick={() => setEstimateSubTab("measurement")} className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${estimateSubTab === 'measurement' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>📖 Measurement Sheet</button>
        <button onClick={() => setEstimateSubTab("abstract")} className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${estimateSubTab === 'abstract' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>📑 Detailed Abstract</button>
        <button onClick={() => setEstimateSubTab("general")} className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${estimateSubTab === 'general' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>💰 General Abstract</button>
      </div>
      
      {estimateSubTab === "measurement" && <MeasurementSheet estimateRows={estimateRows} setEstimateRows={setEstimateRows} rates={rates} theme={theme} checkedItems={dbCheckedItems} setCheckedItems={setDbCheckedItems} />}
      {estimateSubTab === "abstract" && <Abstract estimateRows={estimateRows} setEstimateRows={setEstimateRows} rates={rates} projectDetails={projectDetails} marketRates={marketRates} theme={theme} />}
      {estimateSubTab === "general" && <GeneralAbstract estimateRows={estimateRows} rates={rates} projectDetails={projectDetails} marketRates={marketRates} theme={theme} />}
    </div>
  );

  return (
    <div className="flex flex-col h-screen font-sans overflow-hidden bg-slate-950 text-slate-100 relative">
      <TopNav activeTab={activeTab} setActiveTab={setActiveTab} theme={theme} setTheme={setTheme} />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-hidden relative flex">
          
          {activeTab === "home" && <div className="flex-1 overflow-auto bg-slate-100 dark:bg-[#0b1121]"><ProjectSettings projectDetails={projectDetails} setProjectDetails={setProjectDetails} theme={theme} setActiveTab={setActiveTab} setEstimateSubTab={setEstimateSubTab} /></div>}
          
          {activeTab === "database" && (
            <DatabaseExplorer 
              rates={[...rates, ...nsrItems]} 
              addToMeasurement={addToMeasurement} 
              addAllToMeasurement={addAllToMeasurement} 
              handleViewAR={handleViewAR}
              theme={theme} 
              checkedItems={dbCheckedItems} 
              setCheckedItems={setDbCheckedItems} 
              estimateRows={estimateRows}
              onOpenCreateModal={() => setIsNsrModalOpen(true)}
              onEditNSR={(item: any) => {
                setEditingNsrItem(item);
                setIsNsrModalOpen(true);
              }}
              onDeleteNSR={async (itemToDelete: any) => {
                // 1. Instantly remove from the UI
                setNsrItems(prev => prev.filter(item => item.code !== itemToDelete.code));
                
                // 2. Permanently delete from the database
                try {
                  await fetch('/api/custom-rates', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: itemToDelete.code })
                  });
                } catch (error) {
                  console.error("Failed to delete custom item from database.", error);
                }
              }}
            />
          )}

          {activeTab === "estimate" && renderEstimateBundle()}
          
          {activeTab === "nsr" && <div className="flex-1 p-8 overflow-y-auto"><CreateNSR onAddNSR={(newItem: any) => { setNsrItems(prev => [newItem, ...prev]); addToMeasurement(newItem); setActiveTab("estimate"); setEstimateSubTab("measurement"); }} theme={theme} /></div>}
          {activeTab === "justification" && <Justification projectDetails={projectDetails} setProjectDetails={setProjectDetails} />}
          {activeTab === "radsr" && <RateAnalysisDSR estimateRows={estimateRows} theme={theme} />}
          
          {activeTab === "ratelist" && <RateList theme={theme} marketRates={marketRates} setMarketRates={setMarketRates} />}
          {activeTab === "ramarket" && <RateAnalysisMarket estimateRows={estimateRows} theme={theme} marketRates={marketRates} />}
          {activeTab === "juststatement" && <JustificationStatement estimateRows={estimateRows} theme={theme} marketRates={marketRates} />}
          {activeTab === "justsummary" && <JustificationSummary estimateRows={estimateRows} theme={theme} marketRates={marketRates} />}
          
        </main>
      </div>

      {/* VIEW AR MODAL (Remains untouched) */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[200] p-6" onMouseDown={closeARModal}>
          <div className="bg-[#0b0f19] border border-slate-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden" onMouseDown={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
              <div className="flex items-center gap-4">
                {arHistory.length > 0 && (
                  <button onClick={handleBackAR} className="text-slate-400 hover:text-white font-bold px-3 py-1 bg-slate-800 hover:bg-slate-700 transition-colors rounded shadow flex items-center gap-1">
                    ⬅ Back
                  </button>
                )}
                <h3 className="font-bold text-blue-400 font-mono text-base">Item Code: <span className="text-blue-500">{selectedItem.code} AR</span></h3>
              </div>
              <button onClick={closeARModal} className="text-slate-400 hover:text-white font-bold px-3 py-1 bg-slate-800 hover:bg-rose-900/50 transition-colors rounded shadow">Close ✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 font-mono text-sm space-y-4">
              <div className="text-slate-300 text-base leading-relaxed text-justify mb-4 break-words whitespace-normal">
                {getParentDescription(selectedItem.code) && (
                  <span>{getParentDescription(selectedItem.code)}<br/><br/></span>
                )}
                <span className="font-bold text-slate-100">{selectedItem.code} {formatDescription(selectedItem.description, selectedItem.code)}</span>
              </div>
              
              <div className="border border-slate-800 rounded p-4 bg-slate-950/80 shadow-inner">
                {loadingAnalysis ? (
                  <div className="text-center text-slate-500 py-10 animate-pulse text-base">Loading Rate Analysis from database...</div>
                ) : analysisData.length > 0 ? (
                 <table className="w-full table-fixed text-left text-sm border-collapse">
                    <colgroup>
                      <col className="w-28" />
                      <col />
                      <col className="w-20" />
                      <col className="w-24" />
                      <col className="w-24" />
                      <col className="w-28" />
                    </colgroup>
                    <tbody className="divide-y divide-slate-800/40">
                      {analysisData.map((row: any, i: number) => {
                        const isNCR = row.row_type === 'NCR';
                        const hasAmtNum = row.amount !== null && row.amount !== undefined && row.amount !== '';
                        const hasAmtStr = row.amount_str && row.amount_str.trim() !== '';
                        const hasAmt = hasAmtNum || hasAmtStr;
                        const descText = row.description || "";
                        const dUp = descText.toUpperCase();

                        if (isNCR && !hasAmt) {
                          const isBoldHeader = ["MATERIAL", "LABOUR", "MACHINERY"].includes(dUp) || dUp.startsWith("DETAILS OF COST");
                          return (
                            <tr key={i} className="border-b border-slate-800/50 bg-transparent">
                              <td className="p-3"></td>
                              <td className={`p-3 text-slate-200 text-justify break-words whitespace-normal align-top ${isBoldHeader ? 'font-bold uppercase tracking-wider' : ''}`}>
                                {descText}
                              </td>
                              <td></td>
                              <td></td>
                              <td></td>
                              <td></td>
                            </tr>
                          );
                        } else {
                          const code = row.component_code || "";
                          const unit = row.unit || "";
                          
                          // Confirmed Unit Rate Calculation Logic Using Database Column F (quantity)
                          const qtyNum = Number(row.quantity);
                          const amtNum = Number(row.amount);
                          const qty = (row.quantity !== null && row.quantity !== undefined && row.quantity !== '') ? qtyNum.toFixed(3) : "";
                          const rate = (row.rate !== null && row.rate !== undefined && row.rate !== '') 
                            ? (Number(row.rate) === 0 ? "0.00" : Number(row.rate).toFixed(2)) 
                            : (qtyNum > 0 && amtNum > 0 ? (amtNum / qtyNum).toFixed(2) : "");
                          
                          let amt = "";
                          if (hasAmtStr && row.amount_str.includes('%')) amt = row.amount_str;
                          else if (hasAmtNum) amt = amtNum.toFixed(2);

                          const isSubClickable = code && rates.some((r: any) => r.code === code);

                          return (
                            <tr key={i} className="hover:bg-slate-900/60 border-b border-slate-800/50 transition-colors">
                              <td className="p-3 w-28 font-mono text-amber-500 font-bold align-top">
                                {isSubClickable ? (
                                  <button onClick={() => handleViewAR(rates.find((r: any) => r.code === code))} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 flex items-center gap-1" title="View Sub-AR">
                                    <span>🔍</span> {code}
                                  </button>
                                ) : (
                                  code
                                )}
                              </td>
                              <td className="p-3 text-slate-300 text-justify break-words whitespace-normal w-[420px] align-top">{descText}</td>
                              <td className="p-3 text-center text-slate-400 w-20 align-top">{unit}</td>
                              <td className="p-3 text-right font-mono text-slate-200 w-24 align-top">{qty}</td>
                              <td className="p-3 text-right font-mono text-slate-200 w-24 align-top">{rate}</td>
                              <td className="p-3 text-right font-mono text-green-400 font-bold w-28 align-top">{amt}</td>
                            </tr>
                          );
                        }
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center text-slate-500 py-10 text-base italic">No breakdown found for this item code in database.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* NEW: CREATE NSR/mDSR MODAL POPUP FIX */}
      {isNsrModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 lg:p-10" onMouseDown={() => setIsNsrModalOpen(false)}>
          <div className="w-full max-w-6xl max-h-[95vh] flex flex-col rounded-xl overflow-hidden shadow-2xl" onMouseDown={e => e.stopPropagation()}>
            <CreateNSR 
              theme={theme} 
              onClose={() => setIsNsrModalOpen(false)}
              onAddNSR={(newItem: any) => {
                setNsrItems(prev => [newItem, ...prev]); // Saves to custom rates array
                addToMeasurement(newItem);               // Adds to BOQ/Measurement Sheet
                setIsNsrModalOpen(false);                // Closes popup
                setActiveTab("estimate");                // Jumps to Measurement view
                setEstimateSubTab("measurement");
              }} 
            />
          </div>
        </div>
      )}
      {/* PASTE THIS DIRECTLY ABOVE THE FINAL </div> IN page.tsx */}
      {isNsrModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <CreateNSR 
            onClose={() => setIsNsrModalOpen(false)}
            onAddNSR={(newItem: any) => {
              setNsrItems((prev: any[]) => [newItem, ...prev]);
              addToMeasurement(newItem);
              setIsNsrModalOpen(false);
              setActiveTab("estimate"); 
              setEstimateSubTab("measurement");
            }} 
          />
        </div>
      )}
     {/* WIDER MODAL POPUP FOR CREATE / EDIT */}
      {isNsrModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 lg:p-10" onMouseDown={() => { setIsNsrModalOpen(false); setEditingNsrItem(null); }}>
          <div className="w-full max-w-7xl max-h-[95vh] flex flex-col rounded-xl overflow-hidden shadow-2xl" onMouseDown={e => e.stopPropagation()}>
            <CreateNSR 
              rates={[...rates, ...nsrItems]} 
              initialData={editingNsrItem}
              // ...rest of props
              onClose={() => { setIsNsrModalOpen(false); setEditingNsrItem(null); }}
              onAddNSR={async (newItem: any) => {
                if (editingNsrItem) {
                  setNsrItems(prev => prev.map(i => i.code === newItem.code ? newItem : i));
                } else {
                  setNsrItems(prev => [newItem, ...prev]);
                }
                setIsNsrModalOpen(false);
                setEditingNsrItem(null);
                
                try {
                  await fetch('/api/custom-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newItem) });
                } catch (e) { console.error("Database save failed"); }
              }} 
            />
          </div>
        </div>
      )}
    </div>
  );
}