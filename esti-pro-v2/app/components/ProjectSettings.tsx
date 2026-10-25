import React, { useState } from "react";

export default function ProjectSettings({ projectDetails, setProjectDetails, setActiveTab, setEstimateSubTab, theme }: any) {

  const EPF_ESI_RATES: Record<string, { epf: string, esi: string }> = {
    "Buildings": { epf: "3.125", esi: "0.8125" },
    "Road works & Pavements in airfields": { epf: "0.625", esi: "0.1625" },
    "External sewerage": { epf: "1.250", esi: "0.325" },
    "External water supply": { epf: "0.625", esi: "0.1625" },
    "Bridge / Flyover works": { epf: "3.125", esi: "0.8125" },
    "Maintenance works engaging only labour component": { epf: "12.500", esi: "3.250" },
    "Other maintenance work": { epf: "8.750", esi: "2.275" },
    "Custom Options": { epf: projectDetails.epf, esi: projectDetails.esi }
  };

  const ORDER_LABELS: Record<string, string> = {
    costIndex: "Cost Index (%)",
    gst: "GST Modification Factor",
    contingency: "Contingency (CPWD/Custom)",
    epfEsi: "EPF & ESI Charges",
    customTax: "Customized Tax / Add-on"
  };

  const handleUpdate = (field: string, value: string) => {
    let updates = { [field]: value };

    if (field === "typeOfWork") {
      const rates = EPF_ESI_RATES[value];
      if (rates && value !== "Custom Options") {
        updates.epf = rates.epf;
        updates.esi = rates.esi;
      }
    }
    setProjectDetails((prev: any) => ({ ...prev, ...updates }));
  };

  const moveOrder = (index: number, direction: number) => {
    const newOrder = [...projectDetails.calcOrder];
    if (index + direction >= 0 && index + direction < newOrder.length) {
      const temp = newOrder[index];
      newOrder[index] = newOrder[index + direction];
      newOrder[index + direction] = temp;
      setProjectDetails((prev: any) => ({ ...prev, calcOrder: newOrder }));
    }
  };

  const handleProceed = () => {
    setActiveTab("database");
  };

  const isCustomEpfEsi = projectDetails.typeOfWork === "Custom Options";

  return (
    <div className="w-full flex justify-center py-10 font-sans text-sm">
      <div className="bg-white text-slate-800 border border-slate-300 rounded-xl shadow-2xl p-8 w-[950px]">

        <h2 className="text-2xl font-bold text-blue-600 mb-6 uppercase tracking-wide border-b border-slate-200 pb-2">Project Details & Settings</h2>

        <div className="grid grid-cols-3 gap-6 mb-6">
          <div className="flex flex-col">
            <label className="font-bold text-slate-700 text-xs mb-1 uppercase">ESTIMATE ID</label>
            <input type="text" value={projectDetails.estimateId} onChange={(e) => handleUpdate('estimateId', e.target.value)} className="border border-slate-300 rounded px-3 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold" />
          </div>
          <div className="flex flex-col">
            <label className="font-bold text-slate-700 text-xs mb-1 uppercase">DSR VERSION</label>
            <input type="text" value={projectDetails.dsrVersion} onChange={(e) => handleUpdate('dsrVersion', e.target.value)} className="border border-slate-300 rounded px-3 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold" />
          </div>
          <div className="flex flex-col">
            <label className="font-bold text-slate-700 text-xs mb-1 uppercase">CURRENCY ROUND-OFF FORMAT</label>
            <select value={projectDetails.currencyFormat} onChange={(e) => handleUpdate('currencyFormat', e.target.value)} className="border border-slate-300 rounded px-3 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold">
              <option>Indian (Lakhs/Crores)</option>
              <option>Standard (Millions)</option>
              <option>Exact Value</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col mb-6">
          <label className="font-bold text-slate-700 text-xs mb-1 uppercase">NAME OF WORK</label>
          <textarea 
            placeholder="Enter comprehensive description of the work..." 
            value={projectDetails.nameOfWork} 
            onChange={(e) => handleUpdate('nameOfWork', e.target.value)} 
            className="border border-slate-300 rounded px-3 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all h-24 font-semibold resize-none"
          />
        </div>

        <div className="flex gap-8 border border-slate-200 rounded-lg p-6 bg-slate-50 mb-8">
          <div className="flex-1">
            <h3 className="font-bold text-slate-800 uppercase tracking-widest border-b border-slate-300 pb-2 mb-4">Financial Parameters</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="flex flex-col">
                <label className="font-bold text-slate-700 text-xs mb-1 uppercase">COST INDEX (%)</label>
                <input type="text" placeholder="Blank for 0" value={projectDetails.costIndex} onChange={(e) => handleUpdate('costIndex', e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold" />
              </div>
              <div className="flex flex-col">
                <label className="font-bold text-slate-700 text-xs mb-1 uppercase">GST MODIFICATION FACTOR</label>
                <input type="text" value={projectDetails.gstModificationFactor} onChange={(e) => handleUpdate('gstModificationFactor', e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="flex flex-col">
                <label className="font-bold text-slate-700 text-xs mb-1 uppercase">CONTINGENCY TYPE</label>
                <select value={projectDetails.contingencyType} onChange={(e) => handleUpdate('contingencyType', e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold">
                  <option>As per CPWD norms</option>
                  <option>Custom (%)</option>
                  <option>Zero (0%)</option>
                </select>
              </div>
              <div className="flex flex-col">
                <label className="font-bold text-slate-700 text-xs mb-1 uppercase">CUSTOM CONTINGENCY (%)</label>
                <input type="text" disabled={projectDetails.contingencyType !== 'Custom (%)'} value={projectDetails.customContingency} onChange={(e) => handleUpdate('customContingency', e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold disabled:bg-slate-200 disabled:text-slate-400" />
              </div>
            </div>

            <div className="flex flex-col mb-4">
              <label className="font-bold text-slate-700 text-xs mb-1 uppercase">CATEGORY OF WORK (FOR EPF & ESI CHARGES)</label>
              <select value={projectDetails.typeOfWork} onChange={(e) => handleUpdate('typeOfWork', e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold">
                {Object.keys(EPF_ESI_RATES).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="flex flex-col">
                <label className="font-bold text-slate-700 text-xs mb-1 uppercase">EPF (%)</label>
                <input type="text" value={projectDetails.epf} onChange={(e) => handleUpdate('epf', e.target.value)} readOnly={!isCustomEpfEsi} className={`border border-slate-300 rounded px-3 py-1.5 outline-none font-bold ${isCustomEpfEsi ? 'focus:border-blue-500 bg-white' : 'bg-slate-200 text-slate-600'}`} />
              </div>
              <div className="flex flex-col">
                <label className="font-bold text-slate-700 text-xs mb-1 uppercase">ESI CHARGES (%)</label>
                <input type="text" value={projectDetails.esi} onChange={(e) => handleUpdate('esi', e.target.value)} readOnly={!isCustomEpfEsi} className={`border border-slate-300 rounded px-3 py-1.5 outline-none font-bold ${isCustomEpfEsi ? 'focus:border-blue-500 bg-white' : 'bg-slate-200 text-slate-600'}`} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="font-bold text-slate-700 text-xs mb-1 uppercase">CUSTOM TAX / ADD-ON NAME</label>
                <input type="text" placeholder="e.g. Labor Cess" value={projectDetails.customTaxName} onChange={(e) => handleUpdate('customTaxName', e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold" />
              </div>
              <div className="flex flex-col">
                <label className="font-bold text-slate-700 text-xs mb-1 uppercase">CUSTOM TAX (%)</label>
                <input type="text" placeholder="Blank for 0" value={projectDetails.customTaxRate} onChange={(e) => handleUpdate('customTaxRate', e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-semibold" />
              </div>
            </div>
          </div>

          <div className="w-72 bg-white border border-blue-200 rounded-lg shadow-inner flex flex-col overflow-hidden">
            <div className="bg-blue-50 border-b border-blue-200 p-3">
              <h3 className="font-bold text-blue-800 text-xs uppercase tracking-widest text-center">Calculation Execution Order</h3>
              <p className="text-[10px] text-blue-600 text-center mt-1 leading-tight">Adjust the sequence in which taxes and modifiers are mathematically applied to the base total.</p>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-auto bg-slate-50">
              {projectDetails.calcOrder.map((stepId: string, idx: number) => (
                <div key={stepId} className="flex justify-between items-center bg-white border border-slate-300 rounded p-2 shadow-sm text-xs font-bold text-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="bg-slate-200 text-slate-600 w-5 h-5 flex items-center justify-center rounded-full text-[10px]">{idx + 1}</span>
                    <span>{ORDER_LABELS[stepId]}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveOrder(idx, -1)} disabled={idx === 0} className="text-slate-400 hover:text-blue-600 disabled:opacity-30 leading-none">▲</button>
                    <button onClick={() => moveOrder(idx, 1)} disabled={idx === projectDetails.calcOrder.length - 1} className="text-slate-400 hover:text-blue-600 disabled:opacity-30 leading-none">▼</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        <div className="flex justify-end">
          <button onClick={handleProceed} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-transform hover:scale-105 active:scale-95 flex items-center gap-2">
            Save & Proceed to Estimate ➔
          </button>
        </div>
      </div>
    </div>
  );
}