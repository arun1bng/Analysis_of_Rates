type EstimateRow = {
  itemCode?: unknown;
  quantity?: number | string | null;
  rate?: number | string | null;
};

type ProjectDetails = {
  costIndex?: unknown;
  gstModificationFactor?: unknown;
};

type AbstractTotals = {
  totalDSR: number;
  ciRate: number;
  ciAmount: number;
  subtotalDSR_CI: number;
  modifiedDSR: number;
  nsrTotal: number;
  baseCombined: number;
};

export function calculateAbstractTotals(
  estimateRows: EstimateRow[],
  projectDetails: ProjectDetails,
  marketRates: Record<string, number | string | null | undefined>,
): AbstractTotals {
  const isNSR = (code: string) => code.startsWith("NSR") || code.startsWith("51.");
  const totalDSR = Math.round(estimateRows
    .filter(row => !isNSR(String(row.itemCode ?? "")))
    .reduce((sum, row) => sum + (Number(row.rate) || 0) * (Number(row.quantity) || 1), 0));

  const ciRate = Number(projectDetails.costIndex) || 0;
  const ciAmount = Math.round(totalDSR * (ciRate / 100));
  const subtotalDSR_CI = totalDSR + ciAmount;
  const modFactor = Number(projectDetails.gstModificationFactor) || 1;
  const modifiedDSR = Math.round(subtotalDSR_CI * modFactor);
  const nsrTotal = Math.round(estimateRows
    .filter(row => isNSR(String(row.itemCode ?? "")))
    .reduce((sum, row) => {
      const code = String(row.itemCode ?? "");
      const rate = marketRates[code] !== undefined ? Number(marketRates[code]) : Number(row.rate) || 0;
      return sum + rate * (Number(row.quantity) || 1);
    }, 0));

  return {
    totalDSR,
    ciRate,
    ciAmount,
    subtotalDSR_CI,
    modifiedDSR,
    nsrTotal,
    baseCombined: modifiedDSR + nsrTotal,
  };
}
