type EstimateRow = {
  itemCode?: unknown;
  quantity?: number | string | null;
  rate?: number | string | null;
};

type RateItem = {
  code?: unknown;
  rate?: unknown;
  dar_rate?: unknown;
  dsrRate?: unknown;
  dsr_rate?: unknown;
};

export function resolveEstimateRate(row: EstimateRow, rates: RateItem[] = []): number {
  const code = String(row.itemCode ?? "").trim();
  const isNonSchedule = /^(?:NSR|51\.)/i.test(code);
  if (!isNonSchedule) {
    const master = rates.find(rate => String(rate.code ?? "").trim() === code);
    const canonicalRate = Number(master?.rate ?? master?.dar_rate ?? master?.dsrRate ?? master?.dsr_rate);
    if (Number.isFinite(canonicalRate)) return canonicalRate;
  }
  return Number(row.rate) || 0;
}

type ProjectDetails = {
  costIndex?: unknown;
  gstModificationFactor?: unknown;
  estimateSnapshot?: { locked?: boolean; totals?: Partial<AbstractTotals> };
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
  rates: RateItem[] = [],
): AbstractTotals {
  const isNSR = (code: string) => code.startsWith("NSR") || code.startsWith("51.");
  // Abstract rows combine repeated measurement lines by item code, calculate
  // and round each item's amount to whole rupees, then sum those displayed
  // amounts. Use that same basis for every abstract and ECPT calculation.
  const grouped = new Map<string, { row: EstimateRow; quantity: number }>();
  for (const row of estimateRows) {
    const code = String(row.itemCode ?? "").trim();
    if (!code) continue;
    const existing = grouped.get(code);
    if (existing) existing.quantity += Number(row.quantity) || 0;
    else grouped.set(code, { row, quantity: Number(row.quantity) || 0 });
  }
  const itemAmounts = [...grouped.entries()].map(([code, item]) => {
    const quantity = item.quantity || 1;
    const estimateRate = resolveEstimateRate(item.row, rates);
    const activeRate = isNSR(code) && marketRates[code] !== undefined
      ? Number(marketRates[code])
      : estimateRate;
    return { isNSR: isNSR(code), amount: Math.round((Number.isFinite(activeRate) ? activeRate : estimateRate) * quantity) };
  });
  const totalDSR = itemAmounts
    .filter(item => !item.isNSR)
    .reduce((sum, item) => sum + item.amount, 0);

  const ciRate = Number(projectDetails.costIndex) || 0;
  const ciAmount = Math.round(totalDSR * (ciRate / 100));
  const subtotalDSR_CI = totalDSR + ciAmount;
  const modFactor = Number(projectDetails.gstModificationFactor) || 1;
  const modifiedDSR = Math.round(subtotalDSR_CI * modFactor);
  const nsrTotal = itemAmounts
    .filter(item => item.isNSR)
    .reduce((sum, item) => sum + item.amount, 0);

  const calculated: AbstractTotals = {
    totalDSR,
    ciRate,
    ciAmount,
    subtotalDSR_CI,
    modifiedDSR,
    nsrTotal,
    baseCombined: modifiedDSR + nsrTotal,
  };
  // A locked estimate deliberately keeps its approved totals stable until the
  // user refreshes or unlocks the snapshot from the Estimate toolbar.
  if (projectDetails.estimateSnapshot?.locked && projectDetails.estimateSnapshot.totals) {
    return { ...calculated, ...projectDetails.estimateSnapshot.totals };
  }
  return calculated;
}
