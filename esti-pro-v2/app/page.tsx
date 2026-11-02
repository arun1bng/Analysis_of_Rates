"use client";
import React, { useEffect, useRef, useState } from "react";
import TopNav from "./components/TopNav";
import JustificationSubNav from "./components/JustificationSubNav";
import ProjectSettings from "./components/ProjectSettings";
import DatabaseExplorer from "./components/DatabaseExplorer";
import MeasurementSheet from "./components/MeasurementSheet";
import Abstract from "./components/Abstract";
import GeneralAbstract from "./components/GeneralAbstract";
import HistorySheet from "./components/HistorySheet";
import CreateNSR from "./components/CreateNSR";
import Justification from "./components/Justification";
import RateAnalysisDSR from "./components/RateAnalysisDSR";
import RateList from "./components/RateList";
import RateAnalysisMarket from "./components/RateAnalysisMarket";
import JustificationStatement from "./components/JustificationStatement";
import JustificationSummary, { type JustificationSummaryInputs } from "./components/JustificationSummary";
import ItemsForJustification from "./components/ItemsForJustification";
import { PageToolsProvider } from "./components/PageToolsContext";
import { DEFAULT_PROJECT_DOCUMENT_SETTINGS } from "./utils/projectDocumentSettings";

const DEFAULT_PROJECT_DETAILS = { 
  estimateId: "EST-2026-001", 
  dsrVersion: "DSR 2023", 
  currencyFormat: "Indian (Lakhs/Crores)",
  nameOfWork: "", 
  historyDesc: "",
  scopeDesc: "",
  ratesDesc: "",
  gstModificationFactor: "0.973",
  costIndex: "15", 
  contingencyType: "As per CPWD norms", 
  customContingency: "0",
  typeOfWork: "Buildings",
  epf: "3.125",
  esi: "0.8125",
  customTaxName: "",
  customTaxRate: "",
  timeLimitMonths: "",
  ...DEFAULT_PROJECT_DOCUMENT_SETTINGS,
  calcOrder: ['costIndex', 'gst', 'contingency', 'epfEsi', 'customTax']
};

function formatHierarchyDescription(description: unknown, itemCode: unknown): React.ReactNode {
  const code = String(itemCode ?? "").trim();
  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let headerDesc = String(description ?? "").trim();
  const prefixRegex = new RegExp(`^${escapedCode}[\\s\\r\\n]+`, "i");
  headerDesc = headerDesc.replace(prefixRegex, "");
  const text = headerDesc.replace(new RegExp(`^\\s*${escapedCode}(?=\\s|[:,-]|$)\\s*[:,-]?\\s*`, "i"), "").trim();
  const codeParts = code.split(".");
  const validHierarchyCodes = new Set(
    codeParts.slice(1).map((_, index) => codeParts.slice(0, index + 2).join("."))
  );
  const codePattern = /(?<!\S)(\d+\.\d+(?:\.\d+)*)(?=\s)/g;
  const parts: Array<{ text: string; isCode: boolean }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(codePattern)) {
    const matchedCode = match[1];
    const matchIndex = match.index ?? 0;
    if (!validHierarchyCodes.has(matchedCode)) continue;
    parts.push({ text: text.slice(lastIndex, matchIndex), isCode: false });
    parts.push({ text: matchedCode, isCode: true });
    lastIndex = matchIndex + matchedCode.length;
  }
  parts.push({ text: text.slice(lastIndex), isCode: false });

  return parts.map((part, index) => (
    <React.Fragment key={index}>
      {part.isCode && <br />}
      {part.text}
    </React.Fragment>
  ));
}

function analysisMark(row: Record<string, any>): string {
  return String(row.calc_mark ?? row.mark ?? row.reference_mark ?? row.ref ?? "").trim();
}

export default function App() {
  const [activeTab, setActiveTab] = useState("home"); 
  const [estimateSubTab, setEstimateSubTab] = useState("measurement"); 
  
  const [theme, setTheme] = useState("dark"); 
  const [projectDetails, setProjectDetails] = useState(DEFAULT_PROJECT_DETAILS);
  const [activeProjectDbId, setActiveProjectDbId] = useState("");
  const [documentSettingsProjectId, setDocumentSettingsProjectId] = useState("");
  const [documentSettingsError, setDocumentSettingsError] = useState("");
  const [documentSettingsRetry, setDocumentSettingsRetry] = useState(0);
  const [sessionReady, setSessionReady] = useState(false);
  const [recoverableSessions, setRecoverableSessions] = useState<any[]>([]);
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const initializationStarted = useRef(false);
  const [estimateRows, setEstimateRows] = useState<any[]>([]);
  const [justificationItemCodes, setJustificationItemCodes] = useState<string[]>([]);
  const [justificationThreshold, setJustificationThreshold] = useState(90);
  const [justificationSummaryInputs, setJustificationSummaryInputs] = useState<JustificationSummaryInputs>({
    nitNumber: "28/EE/GCD/2026-27",
    lowestContractor: "M/s. A. B. Construction",
    contractorTenderedAmount: "2799711",
  });
  const [rateCalculationMethod, setRateCalculationMethod] = useState("Conventional DSR");
  const [pendingRateFocus, setPendingRateFocus] = useState<{ tab: "radsr" | "ramarket"; code: string } | null>(null);
  
  const [marketRates, setMarketRates] = useState<Record<string, number>>({});
  const [justifiedRates, setJustifiedRates] = useState<Record<string, number>>({});
  const [justificationPercentage, setJustificationPercentage] = useState<number | null>(null);
  const [projectCustomItems, setProjectCustomItems] = useState<any[]>([]);
  const [projectRateAnalyses, setProjectRateAnalyses] = useState<Record<string, any>>({});
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
  const [databaseSelectedSH, setDatabaseSelectedSH] = useState("SH 2: EARTH WORK");

  const buildSessionPayload = () => ({
    projectDetails,
    estimateRows,
    marketRates,
    selectedItems: dbCheckedItems,
    customItems: projectCustomItems,
    rateAnalyses: projectRateAnalyses,
    justificationItemCodes,
    justificationThreshold,
    justificationSummaryInputs,
    rateCalculationMethod,
    activeTab,
    estimateSubTab,
  });

  const applySessionPayload = (sessionId: string, session: any) => {
    setActiveProjectDbId(sessionId);
    const projectSettings = session?.projectSettings || {};
    setProjectDetails({
      ...DEFAULT_PROJECT_DETAILS,
      ...(session?.projectDetails || {}),
      ...projectSettings,
      estimateId: session?.projectDetails?.estimateId || sessionId,
    });
    setDocumentSettingsProjectId(session?.projectSettings ? sessionId : "");
    setDocumentSettingsError("");
    setEstimateRows(Array.isArray(session?.estimateRows) ? session.estimateRows : []);
    setMarketRates(session?.marketRates && typeof session.marketRates === "object" ? session.marketRates : {});
    setProjectCustomItems(Array.isArray(session?.customItems) ? session.customItems : []);
    setProjectRateAnalyses(session?.rateAnalyses && typeof session.rateAnalyses === "object" ? session.rateAnalyses : {});
    setJustificationItemCodes(Array.isArray(session?.justificationItemCodes) ? session.justificationItemCodes.map(String) : []);
    setJustificationThreshold(Number.isFinite(Number(session?.justificationThreshold)) ? Number(session.justificationThreshold) : 90);
    setJustificationSummaryInputs({
      nitNumber: String(session?.justificationSummaryInputs?.nitNumber ?? "28/EE/GCD/2026-27"),
      lowestContractor: String(session?.justificationSummaryInputs?.lowestContractor ?? "M/s. A. B. Construction"),
      contractorTenderedAmount: String(session?.justificationSummaryInputs?.contractorTenderedAmount ?? "2799711"),
    });
    setRateCalculationMethod(typeof session?.rateCalculationMethod === "string" ? session.rateCalculationMethod : "Conventional DSR");
    setDbCheckedItems(Array.isArray(session?.selectedItems) ? session.selectedItems.map((item: any) => String(item?.code ?? item)).filter(Boolean) : []);
    setEstimateSubTab(session?.estimateSubTab || "measurement");
    setSessionReady(true);
  };

  const createTemporaryEstimate = async (notifyOnError = true) => {
    if (activeProjectDbId && sessionReady) {
      if (documentSettingsProjectId !== activeProjectDbId) {
        if (notifyOnError) alert("Wait for this estimate's shared document settings to finish loading before creating a new estimate.");
        return "";
      }
      try {
        const flush = await fetch("/api/project-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "autosave", sessionId: activeProjectDbId, session: buildSessionPayload() }) });
        if (!flush.ok) throw new Error("The current estimate could not be autosaved before starting a new one.");
      } catch (error) {
        if (notifyOnError) alert(error instanceof Error ? error.message : "Could not preserve the current estimate.");
        return "";
      }
    }
    setSessionReady(false);
    const initial = {
      projectDetails: DEFAULT_PROJECT_DETAILS,
      estimateRows: [], marketRates: {}, selectedItems: [], customItems: [], rateAnalyses: {}, justificationItemCodes: [], justificationThreshold: 90,
      justificationSummaryInputs: { nitNumber: "28/EE/GCD/2026-27", lowestContractor: "M/s. A. B. Construction", contractorTenderedAmount: "2799711" },
      rateCalculationMethod: "Conventional DSR", activeTab: "home", estimateSubTab: "measurement",
    };
    try {
      const response = await fetch("/api/project-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-temp", session: initial }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not create a temporary estimate file.");
      applySessionPayload(result.sessionId, result.session);
      setActiveTab("home");
      setEstimateSubTab("measurement");
      setShowRecoveryPrompt(false);
      setRecoverableSessions([]);
      return result.sessionId as string;
    } catch (error) {
      console.error("Temporary estimate creation failed:", error);
      if (notifyOnError) alert(error instanceof Error ? error.message : "Could not create a temporary estimate file.");
      else setAutoSaveState("error");
      return "";
    }
  };

  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;
    const initialize = async () => {
      try {
        const response = await fetch("/api/project-sessions?action=recoverable");
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Could not check for recoverable estimates.");
        if (Array.isArray(result.sessions) && result.sessions.length) {
          setRecoverableSessions(result.sessions);
          setShowRecoveryPrompt(true);
          return;
        }
        await createTemporaryEstimate(false);
      } catch (error) {
        console.error("Estimate session initialization failed:", error);
        setAutoSaveState("error");
      }
    };
    void initialize();
  }, []);

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

  // Market rates belong to the active estimate, so switch the in-memory set
  // whenever the project ID changes and restore that project's saved values.
  useEffect(() => {
    const projectId = String(activeProjectDbId || "").trim();
    let cancelled = false;
    if (!projectId) return () => { cancelled = true; };

    fetch(`/api/project-market-rates?projectId=${encodeURIComponent(projectId)}`)
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load this project's market rates.");
        return data;
      })
      .then(data => {
        if (!cancelled && data.projectId === projectId.toUpperCase()) {
          setMarketRates(data.marketRates && typeof data.marketRates === "object" ? data.marketRates : {});
          setProjectCustomItems(Array.isArray(data.customItems) ? data.customItems : []);
        }
      })
      .catch(error => console.error("Project market-rate load error:", error));

    fetch(`/api/project-estimates?projectId=${encodeURIComponent(projectId)}`)
      .then(async response => response.ok ? response.json() : null)
      .then(data => {
        if (!cancelled && data?.estimate?.rateAnalyses) setProjectRateAnalyses(data.estimate.rateAnalyses);
      })
      .catch(error => console.error("Project analysis snapshot load error:", error));

    return () => { cancelled = true; };
  }, [activeProjectDbId]);

  useEffect(() => {
    const projectId = String(activeProjectDbId || "").trim();
    let cancelled = false;
    if (!projectId || documentSettingsProjectId === projectId) return () => { cancelled = true; };

    fetch(`/api/project-sessions?action=settings&sessionId=${encodeURIComponent(projectId)}`)
      .then(async response => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Could not load this project's document settings.");
        return result;
      })
      .then(result => {
        if (cancelled || result.projectId !== projectId) return;
        setProjectDetails(current => ({ ...current, ...result.settings }));
        setDocumentSettingsError("");
        setDocumentSettingsProjectId(projectId);
      })
      .catch(error => {
        if (!cancelled) {
          console.error("Project document settings load error:", error);
          setDocumentSettingsError(error instanceof Error ? error.message : "Could not load this estimate's document settings.");
          setAutoSaveState("error");
        }
      });

    return () => { cancelled = true; };
  }, [activeProjectDbId, documentSettingsProjectId, documentSettingsRetry]);

  useEffect(() => {
    if (!activeProjectDbId || !sessionReady || documentSettingsProjectId !== activeProjectDbId) return;
    const session = buildSessionPayload();
    const timeout = window.setTimeout(async () => {
      setAutoSaveState("saving");
      try {
        const response = await fetch("/api/project-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "autosave", sessionId: activeProjectDbId, session }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Autosave failed.");
        setAutoSaveState("saved");
      } catch (error) {
        console.error("Estimate autosave failed:", error);
        setAutoSaveState("error");
      }
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [activeProjectDbId, sessionReady, documentSettingsProjectId, projectDetails, estimateRows, marketRates, dbCheckedItems, projectCustomItems, projectRateAnalyses, justificationItemCodes, justificationThreshold, justificationSummaryInputs, rateCalculationMethod, activeTab, estimateSubTab]);

  useEffect(() => {
    if (!activeProjectDbId || !sessionReady || documentSettingsProjectId !== activeProjectDbId) return;
    const flushOnExit = () => {
      const body = JSON.stringify({ action: "autosave", sessionId: activeProjectDbId, session: buildSessionPayload() });
      navigator.sendBeacon("/api/project-sessions", new Blob([body], { type: "application/json" }));
    };
    window.addEventListener("pagehide", flushOnExit);
    return () => window.removeEventListener("pagehide", flushOnExit);
  }, [activeProjectDbId, sessionReady, documentSettingsProjectId, projectDetails, estimateRows, marketRates, dbCheckedItems, projectCustomItems, projectRateAnalyses, justificationItemCodes, justificationThreshold, justificationSummaryInputs, rateCalculationMethod, activeTab, estimateSubTab]);

  const persistProjectCustomItem = async (item: any) => {
    const projectId = String(activeProjectDbId || "").trim();
    if (!projectId) return;
    const response = await fetch("/api/project-market-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, customItems: [item] }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not save this item's analysis to the project database.");
    setProjectCustomItems(previous => [item, ...previous.filter(saved => saved.code !== item.code)]);
  };

  const saveProjectMarketRates = async (ratesToSave: Record<string, number>) => {
    const projectId = String(activeProjectDbId || "").trim();
    if (!projectId) throw new Error("Enter an Estimate ID in Project Settings before saving market rates.");
    const projectItemsByCode = new Map<string, any>();
    for (const saved of nsrItems) projectItemsByCode.set(String(saved.code), saved);
    for (const saved of projectCustomItems) projectItemsByCode.set(String(saved.code), saved);
    const referencedProjectItems = [...projectItemsByCode.values()].filter(saved => estimateRows.some((row: any) => String(row.itemCode) === String(saved.code)));

    const response = await fetch("/api/project-market-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, marketRates: ratesToSave, customItems: referencedProjectItems }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not save market rates to this project's database.");

    setMarketRates(ratesToSave);
    setActiveTab("ramarket");
  };

  const collectEstimateRateAnalyses = async () => {
    const customByCode = new Map<string, any>();
    [...nsrItems, ...projectCustomItems].forEach(item => customByCode.set(String(item.code), item));
    const queue = [...new Set(estimateRows.map(row => String(row.itemCode || "").trim()).filter(Boolean))];
    const visited = new Set<string>();
    const snapshots: Record<string, { source: string; rows: any[] }> = {};
    let depth = 0;
    while (queue.length && depth < 10) {
      const batch = queue.splice(0).filter(code => !visited.has(code));
      if (!batch.length) break;
      batch.forEach(code => visited.add(code));
      await Promise.all(batch.map(async code => {
        const custom = customByCode.get(code);
        if (custom) {
          snapshots[code] = { source: /^51(?:\.|$)/.test(code) ? "project-ns" : "project-mdsr", rows: Array.isArray(custom.analysisRows) ? custom.analysisRows : [] };
          return;
        }
        try {
          const response = await fetch(`/api/rate-analysis?code=${encodeURIComponent(code)}`);
          const rows = await response.json();
          snapshots[code] = { source: "master-dsr", rows: response.ok && Array.isArray(rows) ? rows : [] };
        } catch { snapshots[code] = { source: "master-dsr", rows: [] }; }
      }));
      for (const code of batch) {
        for (const row of snapshots[code]?.rows || []) {
          if (String(row.row_type || "").toUpperCase() !== "CR") continue;
          const childCode = String(row.component_code || row.code || "").trim();
          if (/^\d+(?:\.\d+)+$/.test(childCode) && !visited.has(childCode)) queue.push(childCode);
        }
      }
      depth++;
    }
    return snapshots;
  };

  const saveEstimateSnapshot = async (projectIdOverride = activeProjectDbId, detailsOverride = projectDetails, quiet = false) => {
    const projectId = String(projectIdOverride || projectDetails.estimateId || "").trim();
    if (!projectId) { if (!quiet) alert("Enter an Estimate ID in Project Settings before saving."); return false; }
    try {
      const rateAnalyses = await collectEstimateRateAnalyses();
      const itemCodes = [...new Set([...dbCheckedItems, ...estimateRows.map(row => String(row.itemCode || ""))])];
      const selectedItems = itemCodes.map(code => {
        const item = estimateRates.find(rate => String(rate.code) === String(code));
        return item ? { code, description: item.description || "", unit: item.unit || "" } : { code };
      });
      const detailedAbstractRows = estimateRows.map((row, index) => {
        const isNS = String(row.itemCode || "").startsWith("NSR") || /^51\./.test(String(row.itemCode || ""));
        const displayRate = isNS && marketRates[row.itemCode] !== undefined ? Number(marketRates[row.itemCode]) : Number(row.rate) || 0;
        return { rowIndex: index, itemCode: row.itemCode, description: row.userDescription || row.description || "", unit: row.unit || "", quantity: Number(row.quantity) || 0, rate: displayRate, amount: displayRate * (Number(row.quantity) || 0) };
      });
      const aggregate = new Map<string, any>();
      detailedAbstractRows.forEach(row => {
        const code = String(row.itemCode || "");
        const prefix = code.split(".")[0] || "1";
        const shTitle = prefix === "51" ? "SH 51: NON-SCHEDULE ITEMS (NS)" : prefix === "50" ? "SH 50: MODIFIED DSR ITEMS (mDSR)" : `SH ${prefix}`;
        const current = aggregate.get(shTitle) || { itemCode: shTitle, description: shTitle, amount: 0 };
        current.amount += row.amount;
        aggregate.set(shTitle, current);
      });
      const isNSCode = (code: string) => String(code || "").startsWith("NSR") || /^51\./.test(String(code || ""));
      const scheduleTotal = Math.round(estimateRows.filter(row => !isNSCode(row.itemCode)).reduce((sum, row) => sum + (Number(row.rate) || 0) * (Number(row.quantity) || 1), 0));
      const nsTotal = Math.round(estimateRows.filter(row => isNSCode(row.itemCode)).reduce((sum, row) => sum + (marketRates[row.itemCode] !== undefined ? Number(marketRates[row.itemCode]) : (Number(row.rate) || 0)) * (Number(row.quantity) || 1), 0));
      const costIndex = Number(projectDetails.costIndex) || 0;
      const costIndexAmount = Math.round(scheduleTotal * costIndex / 100);
      const modifiedSchedule = Math.round((scheduleTotal + costIndexAmount) * (Number(projectDetails.gstModificationFactor) || 1));
      const baseCombined = modifiedSchedule + nsTotal;
      const epfAmount = Math.round(baseCombined * (Number(projectDetails.epf) || 0) / 100);
      const esiAmount = Math.round(baseCombined * (Number(projectDetails.esi) || 0) / 100);
      let contingencyAmount = 0;
      if (projectDetails.contingencyType === "Custom (%)") contingencyAmount = Math.round(baseCombined * (Number(projectDetails.customContingency) || 0) / 100);
      else if (projectDetails.contingencyType !== "Zero (0%)") contingencyAmount = baseCombined <= 10000000 ? Math.round(baseCombined * 0.05) : Math.max(500000, Math.round(baseCombined * 0.03));
      const taxAmount = projectDetails.customTaxName && Number(projectDetails.customTaxRate) > 0 ? Math.round(baseCombined * Number(projectDetails.customTaxRate) / 100) : 0;
      const grandTotal = Math.round((baseCombined + epfAmount + esiAmount + contingencyAmount + taxAmount) / 100) * 100;
      const generalAbstractRows = [
        ...aggregate.values(),
        { description: "Total of DSR / Schedule Items", amount: scheduleTotal, ref: "A" },
        { description: `Add Cost Index @ ${costIndex}%`, amount: costIndexAmount, ref: `${costIndex / 100}A` },
        { description: "Modified estimated cost for DSR and mDSR items", amount: modifiedSchedule, ref: "B" },
        { description: "Total of Non-Schedule (NS) Items", amount: nsTotal, ref: "D" },
        { description: "Base estimate total", amount: baseCombined, ref: "C + D" },
        { description: `Add EPF @ ${projectDetails.epf}%`, amount: epfAmount },
        { description: `Add ESI @ ${projectDetails.esi}%`, amount: esiAmount },
        { description: `Contingency (${projectDetails.contingencyType})`, amount: contingencyAmount },
        ...(taxAmount ? [{ description: `Add ${projectDetails.customTaxName} @ ${projectDetails.customTaxRate}%`, amount: taxAmount }] : []),
        { description: "Grand Total (rounded)", amount: grandTotal },
      ];
      detailedAbstractRows.push(...generalAbstractRows.slice(aggregate.size).map((row, index) => ({ rowIndex: detailedAbstractRows.length + index, ...row })));
      const projectItemsByCode = new Map<string, any>();
      nsrItems.forEach(item => projectItemsByCode.set(String(item.code), item));
      projectCustomItems.forEach(item => projectItemsByCode.set(String(item.code), item));
      const customItems = [...projectItemsByCode.values()].filter(item => itemCodes.includes(String(item.code)) || Boolean(rateAnalyses[String(item.code)]));
      const estimate = {
        projectDetails: detailsOverride,
        selectedItems,
        estimateRows,
        justificationSummaryInputs,
        marketRates,
        customItems,
        rateAnalyses,
        detailedAbstractRows,
        generalAbstractRows,
        historyRows: String(projectDetails.historyDesc || "").split(/\r?\n/).filter(Boolean).map((description, index) => ({ rowIndex: index, description })),
        justificationRows: estimateRows.map((row, index) => ({ rowIndex: index, itemCode: row.itemCode, description: row.userDescription || row.description || "", unit: row.unit || "", quantity: Number(row.quantity) || 0, dsrRate: Number(row.rate) || 0, marketRate: marketRates[row.itemCode] !== undefined ? Number(marketRates[row.itemCode]) : Number(row.rate) || 0, amount: Number(row.amount) || 0, history: projectDetails.historyDesc || "", scope: projectDetails.scopeDesc || "", rates: projectDetails.ratesDesc || "" })),
      };
      const response = await fetch("/api/project-estimates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, estimate }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save this estimate snapshot.");
      setProjectCustomItems(customItems);
      setProjectRateAnalyses(rateAnalyses);
      if (!quiet) alert(`Estimate saved as immutable project snapshot v${result.version}.\nSHA-256: ${result.sha256}`);
      return true;
    } catch (error) {
      console.error("Estimate save failed:", error);
      if (!quiet) alert(error instanceof Error ? error.message : "Could not save this estimate.");
      return false;
    }
  };

  const handleLoadEstimate = async () => {
    const filePickerWindow = window as Window & {
      showOpenFilePicker?: (options: {
        multiple: boolean;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<FileSystemFileHandle[]>;
    };

    try {
      if (!filePickerWindow.showOpenFilePicker) {
        throw new Error("Your browser does not support opening estimate files with a file picker.");
      }

      const [fileHandle] = await filePickerWindow.showOpenFilePicker({
        multiple: false,
        types: [{ description: "eSTi-Pro Estimate File", accept: { "application/json": [".est"] } }],
      });
      if (!fileHandle.name.toLowerCase().endsWith(".est")) {
        throw new Error("Select an estimate file with the .est extension.");
      }

      const file = await fileHandle.getFile();
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The selected file does not contain a valid estimate.");
      }
      const saved = parsed as Record<string, any>;
      if (!saved.projectDetails || typeof saved.projectDetails !== "object" || !Array.isArray(saved.estimateRows)) {
        throw new Error("The selected file is missing required estimate data.");
      }

      const importedSession = {
        projectDetails: { ...DEFAULT_PROJECT_DETAILS, ...saved.projectDetails },
        estimateRows: saved.estimateRows,
        marketRates: saved.marketRates && typeof saved.marketRates === "object" && !Array.isArray(saved.marketRates) ? saved.marketRates : {},
        selectedItems: Array.isArray(saved.selectedItems) ? saved.selectedItems : [],
        customItems: Array.isArray(saved.customItems) ? saved.customItems : [],
        rateAnalyses: saved.rateAnalyses && typeof saved.rateAnalyses === "object" && !Array.isArray(saved.rateAnalyses) ? saved.rateAnalyses : {},
        justificationItemCodes: Array.isArray(saved.justificationItemCodes) ? saved.justificationItemCodes : [],
        justificationThreshold: Number.isFinite(Number(saved.justificationThreshold)) ? Number(saved.justificationThreshold) : 90,
        justificationSummaryInputs: {
          nitNumber: String(saved.justificationSummaryInputs?.nitNumber ?? "28/EE/GCD/2026-27"),
          lowestContractor: String(saved.justificationSummaryInputs?.lowestContractor ?? "M/s. A. B. Construction"),
          contractorTenderedAmount: String(saved.justificationSummaryInputs?.contractorTenderedAmount ?? "2799711"),
        },
        rateCalculationMethod: typeof saved.rateCalculationMethod === "string" ? saved.rateCalculationMethod : "Conventional DSR",
        activeTab: typeof saved.activeTab === "string" ? saved.activeTab : "home",
        estimateSubTab: typeof saved.estimateSubTab === "string" ? saved.estimateSubTab : "measurement",
      };
      const response = await fetch("/api/project-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-temp", session: importedSession }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not load this estimate file.");

      applySessionPayload(result.sessionId, result.session);
      setProjectDetails(importedSession.projectDetails);
      setNsrItems(Array.isArray(saved.nsrItems) ? saved.nsrItems : []);
      setJustifiedRates(saved.justifiedRates && typeof saved.justifiedRates === "object" && !Array.isArray(saved.justifiedRates) ? saved.justifiedRates : {});
      setActiveTab(importedSession.activeTab);
      setEstimateSubTab(importedSession.estimateSubTab);
      setShowRecoveryPrompt(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Estimate file load failed:", error);
      alert(error instanceof Error ? error.message : "Could not load this estimate file.");
    }
  };

  const recoverTemporaryEstimate = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/project-sessions?sessionId=${encodeURIComponent(sessionId)}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not recover the temporary estimate.");
      applySessionPayload(result.sessionId, result.session);
      setShowRecoveryPrompt(false);
      setActiveTab(result.session.activeTab || "home");
      alert(`Recovered unsaved estimate. Last saved ${result.updatedAt}.`);
    } catch (error) {
      console.error("Temporary estimate recovery failed:", error);
      alert(error instanceof Error ? error.message : "Could not recover this estimate.");
    }
  };

  const handleSaveAs = async (): Promise<boolean> => {
    if (activeProjectDbId && documentSettingsProjectId !== activeProjectDbId) {
      alert("Wait for this estimate's shared document settings to finish loading before saving it.");
      return false;
    }
    const estimateId = String(projectDetails.estimateId || "estimate").trim();
    const safeEstimateId = estimateId.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\.est$/i, "") || "estimate";
    const filename = `${safeEstimateId}.est`;
    const fileContent = JSON.stringify({
      projectDetails,
      estimateRows,
      nsrItems,
      marketRates,
      justifiedRates,
      selectedItems: dbCheckedItems,
      customItems: projectCustomItems,
      rateAnalyses: projectRateAnalyses,
      justificationItemCodes,
      justificationThreshold,
      justificationSummaryInputs,
      rateCalculationMethod,
      activeProjectDbId,
      activeTab,
      estimateSubTab,
    }, null, 2);
    const filePickerWindow = window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<FileSystemFileHandle>;
    };

    try {
      if (!filePickerWindow.showSaveFilePicker) throw new Error("File System Access API is not supported.");
      const fileHandle = await filePickerWindow.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "eSTi-Pro Estimate File", accept: { "application/json": [".est"] } }],
      });
      if (!fileHandle.name.toLowerCase().endsWith(".est")) throw new Error("The selected filename must use the .est extension.");
      const writable = await fileHandle.createWritable();
      await writable.write(fileContent);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      console.error("Estimate file save failed:", error);
      try {
        const blob = new Blob([fileContent], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
      } catch (fallbackError) {
        console.error("Estimate file download fallback failed:", fallbackError);
        return false;
      }
    }
  };

  const handleNewEstimate = async () => {
    const shouldSave = window.confirm("You have an active estimate. Any unsaved changes will be lost. Do you want to save before creating a new estimate?");
    if (shouldSave && !(await handleSaveAs())) return;
    await createTemporaryEstimate();
  };

  const persistNsrItem = async (item: any) => {
    const response = await fetch("/api/custom-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Could not save this NSR item to the NSR database.");
    }
    await persistProjectCustomItem(item);
  };

  const addToMeasurement = (item: any) => {
    setEstimateRows(prev => [...prev, {
      id: crypto.randomUUID(), slNo: prev.length + 1, itemCode: item.code, description: item.description || "", userDescription: "",
      unit: item.unit, rate: item.rate,
      nos: 1, num1: 1, num2: 1, length: "", breadth: "", height: "", coefficient: "", quantity: 1, amount: item.rate
    }]);
  };

  const addAllToMeasurement = (itemsToAdd: any[]) => {
    const validItems = itemsToAdd.filter((item: any) => item.isExternalAR === true || Number(item.is_external_ar) === 1 || Number(item.rate) > 0);
    const newRows = validItems.map((item, idx) => ({
      id: crypto.randomUUID(), slNo: estimateRows.length + idx + 1, itemCode: item.code, description: item.description || "", userDescription: "",
      unit: item.unit, rate: item.rate,
      nos: 1, num1: 1, num2: 1, length: "", breadth: "", height: "", coefficient: "", quantity: 1, amount: item.rate
    }));
    setEstimateRows(prev => [...prev, ...newRows]);
  };

    const handleViewAR = (item: any, isBack = false) => {
    if (!item) { setSelectedItem(null); setArHistory([]); return; }
    if (!isBack && selectedItem && selectedItem.code !== item.code) {
      setArHistory(prev => [...prev, selectedItem]);
    }
    setSelectedItem(item);
    
    // Check if it's a Custom Item in memory first
    const customItem = [...nsrItems, ...projectCustomItems].find(i => i.code === item.code);
    if (customItem) {
      setLoadingAnalysis(false);
      setAnalysisData(customItem.isExternalAR || Number(customItem.is_external_ar) === 1
        ? [{ row_type: "NCR", description: `Ext. RA — detailed analysis is maintained outside this software. Final rate: ₹${Number(customItem.rate || 0).toFixed(2)} per ${customItem.unit || "unit"}.` }]
        : customItem.analysisRows || []);
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

  // Include saved NSR/mDSR records in estimate screens so descriptions and units resolve.
  const customItemsForProject = [...nsrItems.filter(item => !projectCustomItems.some(projectItem => String(projectItem.code) === String(item.code))), ...projectCustomItems];
  const customCodes = new Set(customItemsForProject.map(item => String(item.code || "").trim()));
  const estimateRates = [...rates.filter(item => !customCodes.has(String(item.code || "").trim())), ...customItemsForProject];

  const selectEstimateSubTab = async (subTab: string) => {
    if (subTab === "history" && activeProjectDbId && sessionReady) {
      if (documentSettingsProjectId !== activeProjectDbId) {
        alert("Wait for this estimate's shared document settings to finish loading before opening the History Sheet.");
        return;
      }
      try {
        const response = await fetch("/api/project-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "autosave", sessionId: activeProjectDbId, session: buildSessionPayload() }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Could not sync estimate details before opening the History Sheet.");
      } catch (error) {
        console.error("Could not sync estimate before opening its History Sheet:", error);
        alert(error instanceof Error ? error.message : "Could not sync estimate details before opening the History Sheet.");
        return;
      }
    }
    setEstimateSubTab(subTab);
  };

  const renderEstimateBundle = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex bg-slate-900 border-b border-slate-800 px-4 pt-2 gap-2 shrink-0">
        <button onClick={() => void selectEstimateSubTab("measurement")} className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${estimateSubTab === 'measurement' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>📖 Measurement Sheet</button>
        <button onClick={() => void selectEstimateSubTab("abstract")} className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${estimateSubTab === 'abstract' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>📑 Detailed Abstract</button>
        <button onClick={() => void selectEstimateSubTab("general")} className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${estimateSubTab === 'general' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>💰 General Abstract</button>
        <button onClick={() => void selectEstimateSubTab("history")} className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors ${estimateSubTab === 'history' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>📋 History Sheet</button>
      </div>
      
      {estimateSubTab === "measurement" && <MeasurementSheet estimateRows={estimateRows} setEstimateRows={setEstimateRows} rates={estimateRates} theme={theme} checkedItems={dbCheckedItems} setCheckedItems={setDbCheckedItems} />}
      {estimateSubTab === "abstract" && <Abstract estimateRows={estimateRows} setEstimateRows={setEstimateRows} rates={estimateRates} projectDetails={projectDetails} marketRates={marketRates} theme={theme} />}
      {estimateSubTab === "general" && <GeneralAbstract estimateRows={estimateRows} rates={estimateRates} projectDetails={projectDetails} marketRates={marketRates} theme={theme} />}
      {estimateSubTab === "history" && <HistorySheet projectId={activeProjectDbId} projectDetails={projectDetails} />}
    </div>
  );

  const selectedJustificationCodes = new Set(justificationItemCodes);
  const selectedJustificationRows = estimateRows.filter((row: any) => selectedJustificationCodes.has(String(row.itemCode || "").trim()));
  const startJustification = async () => {
    try {
      if (activeProjectDbId && sessionReady) {
        const response = await fetch("/api/project-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "autosave", sessionId: activeProjectDbId, session: buildSessionPayload() }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Could not save the selected justification items.");
      }
      setActiveTab("juststatement");
    } catch (error) {
      console.error("Could not save justification selection:", error);
      alert(error instanceof Error ? error.message : "Could not save the selected justification items.");
    }
  };
  const navigateToRateAnalysis = (tab: "radsr" | "ramarket", code: string) => {
    setPendingRateFocus({ tab, code });
    setActiveTab(tab);
  };

  return (
    <PageToolsProvider>
    <div className="flex flex-col h-screen font-sans overflow-hidden bg-slate-950 text-slate-100 relative">
      <TopNav activeTab={activeTab} setActiveTab={setActiveTab} onSelectEstimateSubTab={selectEstimateSubTab} theme={theme} setTheme={setTheme} onNewEstimate={() => void handleNewEstimate()} onSaveEstimate={() => void saveEstimateSnapshot()} onSaveAs={() => void handleSaveAs()} onLoadEstimate={() => void handleLoadEstimate()} projectId={activeProjectDbId} autoSaveState={autoSaveState} />
      {["radsr", "ratelist", "itemsforjustification", "ramarket", "juststatement", "justsummary"].includes(activeTab) && (
        <JustificationSubNav activeTab={activeTab} setActiveTab={setActiveTab} />
      )}
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-hidden relative flex">
          
          {activeTab === "home" && <div className="flex-1 overflow-auto bg-slate-100 dark:bg-[#0b1121]">
            {activeProjectDbId && documentSettingsProjectId !== activeProjectDbId
              ? documentSettingsError
                ? <div role="alert" className="m-8 rounded border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
                    <p>{documentSettingsError}</p>
                    <button type="button" onClick={() => { setDocumentSettingsError(""); setDocumentSettingsRetry(value => value + 1); }} className="mt-3 rounded bg-rose-700 px-3 py-1.5 font-bold text-white">Retry</button>
                  </div>
                : <p className="p-8 text-center text-sm text-slate-500">Loading estimate document settings…</p>
              : <ProjectSettings projectDetails={projectDetails} setProjectDetails={setProjectDetails} theme={theme} setActiveTab={setActiveTab} setEstimateSubTab={setEstimateSubTab} />}
          </div>}
          
          {activeTab === "database" && (
            <DatabaseExplorer 
              rates={[...rates, ...customItemsForProject]} 
              customRateCodes={customItemsForProject.map((item: any) => String(item.code || "").trim())}
              selectedSHTarget={databaseSelectedSH}
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
                try {
                  const response = await fetch("/api/custom-rates", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code: itemToDelete.code }),
                  });
                  if (!response.ok) throw new Error("Could not delete this NSR item from the NSR database.");
                  const projectDelete = await fetch("/api/project-market-rates", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId: activeProjectDbId, deleteCustomCodes: [itemToDelete.code] }),
                  });
                  if (!projectDelete.ok) throw new Error("Could not remove this item from the active project database.");
                  setNsrItems(prev => prev.filter(item => item.code !== itemToDelete.code));
                  setProjectCustomItems(prev => prev.filter(item => item.code !== itemToDelete.code));
                } catch (error) {
                  console.error("Failed to delete custom item from database.", error);
                  alert("The NSR item could not be deleted. Please try again.");
                }
              }}
            />
          )}

          {activeTab === "estimate" && renderEstimateBundle()}
          
          {activeTab === "nsr" && <div className="flex-1 p-8 overflow-y-auto"><CreateNSR rates={[...rates, ...customItemsForProject]} onAddNSR={async (newItem: any) => { await persistNsrItem(newItem); setNsrItems(prev => [newItem, ...prev.filter(item => item.code !== newItem.code)]); setDatabaseSelectedSH(newItem.code.startsWith("50") ? "SH 50: MODIFIED DSR ITEMS (mDSR)" : "SH 51: NON-SCHEDULE ITEMS (NS)"); setActiveTab("database"); }} theme={theme} /></div>}
          {activeTab === "justification" && <Justification projectDetails={projectDetails} setProjectDetails={setProjectDetails} />}
          {activeTab === "ratelist" && <RateList theme={theme} projectId={activeProjectDbId} onSaveRates={saveProjectMarketRates} marketRates={marketRates} setMarketRates={setMarketRates} estimateRows={estimateRows} selectedCodes={justificationItemCodes} rates={estimateRates} nsrItems={customItemsForProject} />}
          {activeTab === "itemsforjustification" && <ItemsForJustification
            estimateRows={estimateRows}
            rates={estimateRates}
            selectedCodes={justificationItemCodes}
            setSelectedCodes={setJustificationItemCodes}
            percentage={justificationThreshold}
            setPercentage={setJustificationThreshold}
            calculationMethod={rateCalculationMethod}
            setCalculationMethod={setRateCalculationMethod}
            projectDetails={projectDetails}
            marketRates={marketRates}
            onStartJustification={() => void startJustification()}
          />}
          {activeTab === "radsr" && <RateAnalysisDSR estimateRows={estimateRows} selectedCodes={justificationItemCodes} rates={estimateRates} marketRates={marketRates} analysisSnapshot={projectRateAnalyses} theme={theme} focusCode={pendingRateFocus?.tab === "radsr" ? pendingRateFocus.code : ""} onFocusHandled={() => setPendingRateFocus(null)} />}
          {(activeTab === "ramarket" || activeTab === "juststatement") && <div className={activeTab === "ramarket" ? "flex-1 min-h-0" : "hidden"}>
            <RateAnalysisMarket estimateRows={estimateRows} selectedCodes={justificationItemCodes} rates={estimateRates} theme={theme} marketRates={marketRates} projectId={activeProjectDbId} customItems={projectCustomItems} analysisSnapshot={projectRateAnalyses} setJustifiedRates={setJustifiedRates} calculationMethod={rateCalculationMethod} setCalculationMethod={setRateCalculationMethod} focusCode={pendingRateFocus?.tab === "ramarket" ? pendingRateFocus.code : ""} isActive={activeTab === "ramarket"} onFocusHandled={() => setPendingRateFocus(null)} />
          </div>}
          {activeTab === "juststatement" && <JustificationStatement estimateRows={selectedJustificationRows} baseEstimateRows={estimateRows} rates={estimateRates} theme={theme} marketRates={justifiedRates} baseMarketRates={marketRates} projectDetails={projectDetails} setJustificationPercentage={setJustificationPercentage} onNavigateToRate={navigateToRateAnalysis} />}
          {activeTab === "justsummary" && <JustificationSummary estimateRows={selectedJustificationRows} baseEstimateRows={estimateRows} theme={theme} marketRates={justifiedRates} baseMarketRates={marketRates} projectDetails={projectDetails} justificationPercentage={justificationPercentage} projectId={activeProjectDbId} summaryInputs={justificationSummaryInputs} onSummaryInputsChange={setJustificationSummaryInputs} />}
          
        </main>
      </div>

      {showRecoveryPrompt && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-xl border border-amber-500/40 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <h2 className="text-xl font-bold text-amber-400">Recover Unsaved Estimate</h2>
            <p className="mt-2 text-sm text-slate-300">We found temporary estimate files saved automatically. Choose a session to restore, or start a new estimate. The temporary files are kept until you use Save As.</p>
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {recoverableSessions.map((session: any) => (
                <div key={session.sessionId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
                  <div className="min-w-0"><div className="font-mono text-sm text-blue-300">{session.sessionId}</div><div className="text-xs text-slate-400">{session.nameOfWork || "Untitled estimate"} · {session.measurementCount} measurement rows · saved {session.updatedAt}</div></div>
                  <button onClick={() => void recoverTemporaryEstimate(session.sessionId)} className="shrink-0 rounded bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500">Recover</button>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end"><button onClick={() => void createTemporaryEstimate()} className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-500">Start New Estimate</button></div>
          </div>
        </div>
      )}

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
                <h3 className="font-bold text-blue-400 font-mono text-base">Analysis of rates: Item No. <span className="text-blue-500">{selectedItem.code}</span> {nsrItems.some(item => item.code === selectedItem.code && (item.isExternalAR || Number(item.is_external_ar) === 1)) && <span className="rounded border border-violet-700 bg-violet-900/50 px-2 py-1 text-xs text-violet-200">Ext. RA</span>}</h3>
              </div>
              <button onClick={closeARModal} className="text-slate-400 hover:text-white font-bold px-3 py-1 bg-slate-800 hover:bg-rose-900/50 transition-colors rounded shadow">Close ✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 font-mono text-sm space-y-4">
              <div className="text-slate-300 text-base leading-relaxed text-justify mb-4 break-words whitespace-normal">
                <span className="font-bold text-slate-100">{formatHierarchyDescription(selectedItem.description, selectedItem.code)}</span>
              </div>
              
              <div className="border border-slate-800 rounded p-4 bg-slate-950/80 shadow-inner">
                {loadingAnalysis ? (
                  <div className="text-center text-slate-500 py-10 animate-pulse text-base">Loading Rate Analysis from database...</div>
                ) : analysisData.length > 0 ? (
                 <table className="w-full table-fixed text-left text-sm border-collapse">
                    <colgroup>
                      <col className="w-28" />
                      <col className="w-[50%]" />
                      <col className="w-20" />
                      <col className="w-24" />
                      <col className="w-24" />
                      <col className="w-28" />
                      <col className="w-20" />
                    </colgroup>
                    <thead className="sticky top-0 bg-slate-900 text-slate-400">
                      <tr>
                        <th className="p-3 text-left">Code</th>
                        <th className="w-[50%] p-3 text-left">Description</th>
                        <th className="p-3 text-center">Unit</th>
                        <th className="p-3 text-right">Qty</th>
                        <th className="p-3 text-right">Rate (₹)</th>
                        <th className="p-3 text-right">Amount (₹)</th>
                        <th className="p-3 text-center">Mark</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {analysisData.map((row: any, i: number) => {
                        const isNCR = row.row_type === 'NCR';
                        const hasAmtNum = row.amount !== null && row.amount !== undefined && row.amount !== '';
                        const hasAmtStr = row.amount_str && row.amount_str.trim() !== '';
                        const descText = row.description || "";
                        const dUp = descText.toUpperCase();

                        if (isNCR) {
                          const numericAmount = Number(row.amount);
                          const amountText = hasAmtStr
                            ? row.amount_str
                            : Number.isFinite(numericAmount) && numericAmount !== 0
                              ? numericAmount.toFixed(2)
                              : "";
                          const mark = analysisMark(row);
                          const isHeader = ["MATERIAL", "LABOUR", "MACHINERY"].includes(dUp) || dUp.startsWith("DETAILS OF COST");
                          const isTotal = /^TOTAL\b/.test(dUp);
                          const isFinalCost = /^(COST OF|COST FOR|SAY\b)/.test(dUp);
                          const isCharge = /^(ADD|LESS|DEDUCT)\b/.test(dUp);
                          const isFinancialSummary = Boolean(amountText || mark || isTotal || isFinalCost || isCharge);
                          const rowStyle = isTotal || isFinalCost ? "bg-emerald-950/50 border-b border-slate-800" : isCharge ? "bg-slate-900/40 border-b border-slate-800/50" : "border-b border-slate-800/50 bg-transparent";
                          return (
                            <tr key={i} className={rowStyle}>
                              <td className="p-3 w-28"></td>
                              <td
                                colSpan={isFinancialSummary ? 4 : undefined}
                                className={`p-3 text-justify whitespace-normal break-words align-top ${isHeader ? "font-bold uppercase tracking-wider text-slate-200" : isTotal || isFinalCost ? "font-bold text-emerald-200" : isCharge ? "text-slate-300 pl-6" : "text-slate-300"}`}
                              >
                                {descText}
                              </td>
                              {!isFinancialSummary && <td className="p-3"></td>}
                              {!isFinancialSummary && <td className="p-3"></td>}
                              {!isFinancialSummary && <td className="p-3"></td>}
                              <td className={`p-3 text-right font-mono ${isTotal || isFinalCost ? "font-bold text-emerald-300" : amountText ? "text-green-400" : ""}`}>{amountText}</td>
                              <td className="p-3 text-center font-mono font-bold text-blue-300">{mark}</td>
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
                          const mark = analysisMark(row);

                          const linkedRateItem = rates.find((r: any) => r.code === code);
                          const subAnalysisFlag = row.is_sub_ar ?? row.isSubAR;
                          const isSubAnalysis = subAnalysisFlag === true
                            || subAnalysisFlag === 1
                            || subAnalysisFlag === "1"
                            || String(subAnalysisFlag).toLowerCase() === "true"
                            || (/^\d+(?:\.\d+)+$/.test(String(code).trim()) && row.row_type !== "NCR" && row.row_type !== "SCR");
                          const isSubClickable = Boolean(isSubAnalysis && linkedRateItem);
                           const isExternalSubAR = linkedRateItem?.isExternalAR === true || Number(linkedRateItem?.is_external_ar) === 1;

                          return (
                            <tr key={i} className="hover:bg-slate-900/60 border-b border-slate-800/50 transition-colors">
                              <td className="p-3 w-28 font-mono text-amber-500 font-bold align-top">
                                {isSubClickable && !isExternalSubAR ? (
                                  <button onClick={() => handleViewAR(rates.find((r: any) => r.code === code))} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 flex items-center gap-1" title="View Sub-AR">
                                    <span>🔍</span> {code}
                                  </button>
                                ) : (
                                  <>{code}{isExternalSubAR && <span className="ml-2 rounded border border-violet-700 bg-violet-900/50 px-1.5 py-0.5 text-[10px] font-bold text-violet-200">Ext. RA</span>}</>
                                )}
                              </td>
                              <td className="p-3 min-w-0 w-[420px] text-slate-300 text-justify whitespace-pre-wrap break-words [overflow-wrap:anywhere] align-top">{descText}</td>
                              <td className="p-3 text-center text-slate-400 w-20 align-top">{unit}</td>
                              <td className="p-3 text-right font-mono text-slate-200 w-24 align-top">{qty}</td>
                              <td className="p-3 text-right font-mono text-slate-200 w-24 align-top">{rate}</td>
                              <td className="p-3 text-right font-mono text-green-400 font-bold w-28 align-top">{amt}</td>
                              <td className="p-3 text-center font-mono font-bold text-blue-300 w-20 align-top">{mark}</td>
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
                await persistNsrItem(newItem);
                setNsrItems(prev => [newItem, ...prev.filter(item => item.code !== newItem.code)]);
                setDatabaseSelectedSH(newItem.code.startsWith("50") ? "SH 50: MODIFIED DSR ITEMS (mDSR)" : "SH 51: NON-SCHEDULE ITEMS (NS)");
                setIsNsrModalOpen(false);
                setEditingNsrItem(null);
                setActiveTab("database");
              }} 
            />
          </div>
        </div>
      )}
    </div>
    </PageToolsProvider>
  );
}
