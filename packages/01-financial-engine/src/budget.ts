import {
  CostCode,
  BudgetLedgerEntry,
  Expense,
  CommittedCost,
  ForecastEntry,
  CategoryFinancials,
} from "./types";
import { addCents, subtractCents } from "./money";

/** Computes the full financial picture for ONE cost code from raw ledger
 *  rows. This is the only function allowed to know the formulas — every
 *  screen (budget table, drill-down, reconciliation, invoice builder)
 *  calls this and displays its output, so numbers can never disagree
 *  with each other across the app. */
export function computeCategoryFinancials(
  costCode: CostCode,
  ledgerEntries: BudgetLedgerEntry[],
  expenses: Expense[],
  committedCosts: CommittedCost[],
  forecastEntries: ForecastEntry[]
): CategoryFinancials {
  const entriesForCode = ledgerEntries.filter((e) => e.costCodeId === costCode.id);

  const originalEstimateCents = addCents(
    ...entriesForCode.filter((e) => e.entryType === "original").map((e) => e.amountCents),
    0
  );

  const approvedChangesCents = addCents(
    ...entriesForCode
      .filter((e) => e.entryType === "approved_change" || e.entryType === "correction")
      .map((e) => e.amountCents),
    0
  );

  const revisedEstimateCents = addCents(originalEstimateCents, approvedChangesCents);

  // CORRECTION (independent review item 3): actual cost now counts ONLY
  // expenses with financialStatus === 'posted'. This replaces the prior
  // "not void" filter, which incorrectly let 'pending' (unreviewed
  // import) rows affect official totals — a pending row is money that
  // MIGHT be real once reviewed, not money that IS real yet. Whether a
  // posted expense is client-visible (publicationStatus) is completely
  // irrelevant here; that's a separate axis handled only in RLS/views.
  const actualCostCents = addCents(
    ...expenses
      .filter((e) => e.costCodeId === costCode.id && e.financialStatus === "posted")
      .map((e) => e.amountCents),
    0
  );

  const committedCostCents = addCents(
    ...committedCosts
      .filter((c) => c.costCodeId === costCode.id && c.status === "open" && !c.supersededAt)
      .map((c) => c.amountCents),
    0
  );

  const activeForecast = forecastEntries.find(
    (f) => f.costCodeId === costCode.id && !f.supersededAt
  );
  const forecastToCompleteCents = activeForecast ? activeForecast.forecastToCompleteCents : 0;

  const projectedFinalCostCents = addCents(
    actualCostCents,
    committedCostCents,
    forecastToCompleteCents
  );

  const suggestedVarianceCents = subtractCents(projectedFinalCostCents, revisedEstimateCents);

  return {
    costCodeId: costCode.id,
    code: costCode.code,
    status: costCode.status,
    originalEstimateCents,
    approvedChangesCents,
    revisedEstimateCents,
    actualCostCents,
    committedCostCents,
    forecastToCompleteCents,
    projectedFinalCostCents,
    suggestedVarianceCents,
    isFeeEligible: costCode.feeEligible,
  };
}

export function computeAllCategoryFinancials(
  costCodes: CostCode[],
  ledgerEntries: BudgetLedgerEntry[],
  expenses: Expense[],
  committedCosts: CommittedCost[],
  forecastEntries: ForecastEntry[]
): CategoryFinancials[] {
  return costCodes
    .filter((c) => !c.isArchived)
    .map((cc) =>
      computeCategoryFinancials(cc, ledgerEntries, expenses, committedCosts, forecastEntries)
    );
}

/** Project-level totals. Deliberately just a sum of category rollups —
 *  never a separately-maintained number — so "does the project total
 *  match its categories" can never fail by construction. */
export function computeProjectTotals(categories: CategoryFinancials[]) {
  return {
    originalEstimateCents: addCents(...categories.map((c) => c.originalEstimateCents), 0),
    approvedChangesCents: addCents(...categories.map((c) => c.approvedChangesCents), 0),
    revisedEstimateCents: addCents(...categories.map((c) => c.revisedEstimateCents), 0),
    actualCostCents: addCents(...categories.map((c) => c.actualCostCents), 0),
    committedCostCents: addCents(...categories.map((c) => c.committedCostCents), 0),
    forecastToCompleteCents: addCents(...categories.map((c) => c.forecastToCompleteCents), 0),
    projectedFinalCostCents: addCents(...categories.map((c) => c.projectedFinalCostCents), 0),
  };
}
