"use client";

import React from "react";
import FindInPage from "./FindInPage";
import { usePageTools } from "./PageToolsContext";

const pages = [
  { id: "itemsforjustification", label: "Items for Justfn", icon: "📋" },
  { id: "radsr", label: "Rate Analysis (DSR)", icon: "📊" },
  { id: "ratelist", label: "Rate List", icon: "💰" },
  { id: "ramarket", label: "Rate Analysis (Market)", icon: "📈" },
  { id: "juststatement", label: "Justification Statement", icon: "📝" },
  { id: "justsummary", label: "Justification Front Sheet / Summary", icon: "📄" },
];

export default function JustificationSubNav({
  activeTab,
  setActiveTab,
  onExportMasterJustfn,
  onExportMasterJustfnPdf,
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onExportMasterJustfn: () => void;
  onExportMasterJustfnPdf: () => void;
}) {
  const { toolsByPage } = usePageTools();
  const pageTools = toolsByPage[activeTab];

  return (
    <nav className="sticky top-0 z-[90] flex w-full min-w-0 shrink-0 flex-col items-stretch gap-2 border-b border-slate-700 bg-slate-900 px-3 py-2 shadow-md">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {pages.map(page => (
          <button
            key={page.id}
            type="button"
            onClick={() => setActiveTab(page.id)}
            aria-current={activeTab === page.id ? "page" : undefined}
            className={`rounded-t-lg px-5 py-3 text-base font-bold transition-colors ${
              activeTab === page.id
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
            }`}
          >
            <span aria-hidden="true" className="mr-2">{page.icon}</span>
            {page.label}
          </button>
        ))}
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2">
        {pageTools?.searchContainerRef && (
          <FindInPage key={activeTab} containerRef={pageTools.searchContainerRef} className="max-w-full" />
        )}
        <button type="button" onClick={onExportMasterJustfn} className="shrink-0 rounded bg-violet-600 px-3 py-2 text-xs font-bold text-white shadow hover:bg-violet-500">Export Master Justfn</button>
        <button type="button" onClick={onExportMasterJustfnPdf} className="shrink-0 rounded bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow hover:bg-rose-500">Export Master Justfn to PDF</button>
      </div>
    </nav>
  );
}
