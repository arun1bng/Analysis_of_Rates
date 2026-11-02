"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

export type PageExportAction = {
  id: string;
  label: string;
  onClick: () => void;
  className: string;
};

export type PageTools = {
  searchContainerRef?: { current: HTMLElement | null };
  exportActions?: PageExportAction[];
};

type PageToolsContextValue = {
  toolsByPage: Record<string, PageTools>;
  registerPageTools: (pageKey: string, tools: PageTools) => () => void;
};

const PageToolsContext = createContext<PageToolsContextValue | null>(null);

export function PageToolsProvider({ children }: { children: React.ReactNode }) {
  const [toolsByPage, setToolsByPage] = useState<Record<string, PageTools>>({});

  const registerPageTools = useCallback((pageKey: string, tools: PageTools) => {
    setToolsByPage(current => ({ ...current, [pageKey]: tools }));
    return () => {
      setToolsByPage(current => {
        if (current[pageKey] !== tools) return current;
        const next = { ...current };
        delete next[pageKey];
        return next;
      });
    };
  }, []);

  return (
    <PageToolsContext.Provider value={{ toolsByPage, registerPageTools }}>
      {children}
    </PageToolsContext.Provider>
  );
}

export function usePageTools() {
  const context = useContext(PageToolsContext);
  if (!context) throw new Error("usePageTools must be used within PageToolsProvider.");
  return context;
}
