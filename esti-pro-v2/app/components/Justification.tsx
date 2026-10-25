import React from "react";

export default function Justification({ projectDetails, setProjectDetails }: any) {
  return (
    <div className="flex-1 flex justify-center items-start p-8 overflow-y-auto">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-8 mt-8">
        <h2 className="text-xl font-bold text-amber-400 mb-6 border-b border-slate-700 pb-2 font-mono uppercase tracking-wider">
          Estimate Report & Justification
        </h2>
        <div className="flex flex-col gap-6">
          
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">1. History & Objective</label>
            <textarea
              value={projectDetails.historyDesc || ""}
              onChange={(e) => setProjectDetails({...projectDetails, historyDesc: e.target.value})}
              className="bg-slate-950 border border-slate-700 rounded p-3 text-sm text-slate-100 focus:border-amber-500 outline-none min-h-[100px] leading-relaxed"
              placeholder="Explain the background, necessity, and objective of this work..."
            />
          </div>
          
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">2. Scope & Design</label>
            <textarea
              value={projectDetails.scopeDesc || ""}
              onChange={(e) => setProjectDetails({...projectDetails, scopeDesc: e.target.value})}
              className="bg-slate-950 border border-slate-700 rounded p-3 text-sm text-slate-100 focus:border-amber-500 outline-none min-h-[100px] leading-relaxed"
              placeholder="Detail the technical scope and specifications of the proposed items..."
            />
          </div>
          
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">3. Basis of Rates</label>
            <textarea
              value={projectDetails.ratesDesc || ""}
              onChange={(e) => setProjectDetails({...projectDetails, ratesDesc: e.target.value})}
              className="bg-slate-950 border border-slate-700 rounded p-3 text-sm text-slate-100 focus:border-amber-500 outline-none min-h-[80px] leading-relaxed"
              placeholder="e.g., Rates are based on DSR 2023 with applicable approved cost index..."
            />
          </div>

        </div>
      </div>
    </div>
  );
}