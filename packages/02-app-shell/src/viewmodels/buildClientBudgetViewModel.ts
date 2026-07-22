import { FinancialRepository } from "../data/financialRepository";
import { ClientBudgetViewModel } from "./types";

/**
 * Builds the CLIENT-facing view model. This function calls ONLY the
 * client-safe repository methods (`getClientSafeBudgetLines`,
 * `getClientSafePublishedExpenses`, `getClientSafeInvoices`) — never
 * `getCostCodes`/`getExpenses`/`getCommittedCosts`/`getForecastEntries`/
 * `getFeeRule` etc., and never any of the internal engine's
 * category/fee/suggestion/reconciliation functions. This is the
 * concrete meaning of "the client screen must consume only client-safe
 * data returned through the client-safe database views/RPCs, not
 * internal fields hidden with CSS after the fact" — there is no
 * internal data in this function's call stack to accidentally leak,
 * because it was never fetched in the first place.
 *
 * "Projected Final" is deliberately NOT part of this view model. The
 * master spec lists it as something a client may see, but Package 1's
 * data model has no client-safe forecast/projection concept yet —
 * `forecast_entries` and `committed_costs` are both internal-only by
 * design (001's RLS has no client policy for either). Fabricating a
 * client-facing "projected final" from committed/forecast data would
 * mean silently smuggling internal figures into a client-safe view
 * model through the back door of a derived number, which is exactly
 * what this refactor exists to prevent. The honest state: this is an
 * open product question for a later package (e.g. a `client_facing_
 * projection_cents` field Stone Column explicitly sets and publishes,
 * or an invoicing-driven concept once Package 4 exists) — not
 * something to solve by quietly reusing internal numbers.
 */
export async function buildClientBudgetViewModel(
  projectId: string,
  repo: FinancialRepository
): Promise<ClientBudgetViewModel> {
  const [projectMeta, visibility, budgetLines, publishedExpenses, invoices] = await Promise.all([
    repo.getProjectMeta(projectId),
    repo.getClientVisibilitySettings(projectId),
    repo.getClientSafeBudgetLines(projectId),
    repo.getClientSafePublishedExpenses(projectId),
    repo.getClientSafeInvoices(projectId),
  ]);

  // Simple presentation-layer aggregation of already-client-safe rows —
  // not a re-derivation of any internal engine formula. Grouping
  // published expenses by cost code to get a per-line actual-cost
  // figure is the client-safe analog of what the engine's
  // computeCategoryFinancials does internally, but operating on a
  // strictly narrower, already-filtered input (client-safe rows only).
  const actualByCode = new Map<string, number>();
  for (const e of publishedExpenses) {
    actualByCode.set(e.costCodeId, (actualByCode.get(e.costCodeId) ?? 0) + e.amountCents);
  }

  const lines = budgetLines.map((line) => ({
    costCodeId: line.costCodeId,
    code: line.code,
    originalEstimateCents: line.originalEstimateCents,
    approvedChangesCents: line.approvedChangesCents,
    revisedEstimateCents: line.revisedEstimateCents,
    publishedActualCostCents: actualByCode.get(line.costCodeId) ?? 0,
  }));

  const totals = lines.reduce(
    (acc, l) => ({
      originalEstimateCents: acc.originalEstimateCents + l.originalEstimateCents,
      approvedChangesCents: acc.approvedChangesCents + l.approvedChangesCents,
      revisedEstimateCents: acc.revisedEstimateCents + l.revisedEstimateCents,
      publishedActualCostCents: acc.publishedActualCostCents + l.publishedActualCostCents,
    }),
    { originalEstimateCents: 0, approvedChangesCents: 0, revisedEstimateCents: 0, publishedActualCostCents: 0 }
  );

  const invoiceSummary = invoices.reduce(
    (acc, inv) => ({
      totalInvoicedCents: acc.totalInvoicedCents + inv.totalCents,
      totalPaidCents: acc.totalPaidCents + inv.paidCents,
      balanceCents: acc.balanceCents + (inv.totalCents - inv.paidCents),
    }),
    { totalInvoicedCents: 0, totalPaidCents: 0, balanceCents: 0 }
  );

  return {
    projectMeta,
    budgetLines: lines,
    totals,
    invoices,
    invoiceSummary,
    showVendorNames: visibility.showVendorNamesToClient,
    showSupportingInvoices: visibility.showSupportingInvoicesToClient,
  };
}
