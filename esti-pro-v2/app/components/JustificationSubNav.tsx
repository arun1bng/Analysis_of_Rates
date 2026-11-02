"use client";

import React from "react";
import FindInPage from "./FindInPage";
import { usePageTools } from "./PageToolsContext";

const pages = [
  { id: "itemsforjustification", label: "Items for Justification" },
  { id: "radsr", label: "Rate Analysis (DSR)" },
  { id: "ratelist", label: "Rate List" },
  { id: "ramarket", label: "Rate Analysis (Market)" },
  { id: "juststatement", label: "Justification Statement" },
  { id: "justsummary", label: "Justification Front Sheet / Summary" },
];

export default function JustificationSubNav({
  activeTab,
  setActiveTab,
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}) {
  const { toolsByPage } = usePageTools();
  const pageTools = toolsByPage[activeTab];

  return (
    <nav className="sticky top-0 z-[90] flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        {pages.map(page => (
          <button
            key={page.id}
            type="button"
            onClick={() => setActiveTab(page.id)}
            aria-current={activeTab === page.id ? "page" : undefined}
            className={`rounded px-3 py-2 text-sm font-bold transition-colors ${
              activeTab === page.id
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            {page.label}
          </button>
        ))}
      </div>
      {(pageTools?.searchContainerRef || pageTools?.exportActions?.length) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {pageTools.searchContainerRef && (
            <FindInPage key={activeTab} containerRef={pageTools.searchContainerRef} />
          )}
          {pageTools.exportActions?.map(action => (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              className={action.className}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
