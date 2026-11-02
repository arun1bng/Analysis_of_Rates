export type HistoryEstimateSummary = {
  estimateId: string;
  nameOfWork: string;
  subHeads: string;
  probableCost: number;
  baseEstimateTotal: number;
  contingencyRate: number;
  contingencyAmount: number;
  epfRate: number;
  epfAmount: number;
  esiRate: number;
  esiAmount: number;
  departmentalChargesName: string;
  departmentalChargesRate: number;
  departmentalChargesAmount: number;
  dsrYear: string;
  costIndex: number;
  marketRatesProvision: string;
  timeLimitMonths: number | null;
};

type EstimateSession = {
  projectDetails?: Record<string, unknown>;
  estimateRows?: Array<Record<string, unknown>>;
  marketRates?: Record<string, unknown>;
};

export function calculateHistoryEstimateSummary(session: EstimateSession): HistoryEstimateSummary {
  const projectDetails = session.projectDetails ?? {};
  const rows = Array.isArray(session.estimateRows) ? session.estimateRows : [];
  const marketRates = session.marketRates ?? {};
  const isNonSchedule = (code: string) => code.startsWith("NSR") || code.startsWith("51.");
  const quantity = (row: Record<string, unknown>) => Number(row.quantity) || 1;
  const rate = (row: Record<string, unknown>) => Number(row.rate) || 0;
  const totalSchedule = Math.round(rows
    .filter(row => !isNonSchedule(String(row.itemCode ?? "")))
    .reduce((sum, row) => sum + rate(row) * quantity(row), 0));
  const costIndex = Number(projectDetails.costIndex) || 0;
  const costIndexAmount = Math.round(totalSchedule * costIndex / 100);
  const modificationFactor = Number(projectDetails.gstModificationFactor) || 1;
  const modifiedSchedule = Math.round((totalSchedule + costIndexAmount) * modificationFactor);
  const nonSchedule = Math.round(rows
    .filter(row => isNonSchedule(String(row.itemCode ?? "")))
    .reduce((sum, row) => {
      const code = String(row.itemCode ?? "");
      const itemRate = marketRates[code] !== undefined ? Number(marketRates[code]) || 0 : rate(row);
      return sum + itemRate * quantity(row);
    }, 0));
  const baseEstimateTotal = modifiedSchedule + nonSchedule;
  const epfRate = Number(projectDetails.epf) || 0;
  const esiRate = Number(projectDetails.esi) || 0;
  const epfAmount = Math.round(baseEstimateTotal * epfRate / 100);
  const esiAmount = Math.round(baseEstimateTotal * esiRate / 100);

  let contingencyRate = 0;
  let contingencyAmount = 0;
  if (projectDetails.contingencyType === "Custom (%)") {
    contingencyRate = Number(projectDetails.customContingency) || 0;
    contingencyAmount = Math.round(baseEstimateTotal * contingencyRate / 100);
  } else if (projectDetails.contingencyType !== "Zero (0%)") {
    contingencyRate = baseEstimateTotal <= 10000000 ? 5 : 3;
    contingencyAmount = baseEstimateTotal <= 10000000
      ? Math.round(baseEstimateTotal * 0.05)
      : Math.max(500000, Math.round(baseEstimateTotal * 0.03));
  }

  const departmentalChargesName = String(projectDetails.customTaxName ?? "");
  const departmentalChargesRate = Number(projectDetails.customTaxRate) || 0;
  const departmentalChargesAmount = departmentalChargesName && departmentalChargesRate > 0
    ? Math.round(baseEstimateTotal * departmentalChargesRate / 100)
    : 0;
  const totalBeforeRounding = baseEstimateTotal + epfAmount + esiAmount + contingencyAmount + departmentalChargesAmount;
  const probableCost = Math.round(totalBeforeRounding / 100) * 100;
  const numberOfMarketRates = Object.keys(marketRates).length;
  const timeLimitValue = projectDetails.timeLimitMonths;
  const timeLimitMonths = timeLimitValue === "" || timeLimitValue === null || timeLimitValue === undefined
    ? null
    : Number.isInteger(Number(timeLimitValue)) && Number(timeLimitValue) >= 0
      ? Number(timeLimitValue)
      : null;

  return {
    estimateId: String(projectDetails.estimateId ?? ""),
    nameOfWork: String(projectDetails.nameOfWork ?? ""),
    subHeads: String(projectDetails.scopeDesc ?? ""),
    probableCost,
    baseEstimateTotal,
    contingencyRate,
    contingencyAmount,
    epfRate,
    epfAmount,
    esiRate,
    esiAmount,
    departmentalChargesName,
    departmentalChargesRate,
    departmentalChargesAmount,
    dsrYear: String(projectDetails.dsrVersion ?? ""),
    costIndex,
    marketRatesProvision: String(projectDetails.ratesDesc ?? "") ||
      (numberOfMarketRates ? `${numberOfMarketRates} project market rate(s) provided` : "As per applicable DSR rates"),
    timeLimitMonths,
  };
}
