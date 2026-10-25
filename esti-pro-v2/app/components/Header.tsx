import React from "react";

export default function Header({ totalAmount }: any) {
  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shrink-0">
      <div className="text-slate-400 text-sm font-mono tracking-wide">Delhi Schedule of Rates (DSR) Estimator</div>
      <div className="flex items-center gap-4">
        <span className="text-slate-300 text-sm font-bold uppercase tracking-wider">Base BOQ Total:</span>
        <span className="text-green-400 bg-green-950/50 px-4 py-1.5 border border-green-800/50 rounded font-bold font-mono shadow-inner">
          ₹{totalAmount.toFixed(2)}
        </span>
      </div>
    </header>
  );
}