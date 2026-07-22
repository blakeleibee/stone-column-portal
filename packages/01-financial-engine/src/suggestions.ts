import { CategoryFinancials, BudgetSuggestion } from "./types";

/** Pure function: given current category rollups, propose suggestions.
 *  This NEVER writes to forecast_entries or budget_ledger, and it never
 *  mutates its inputs — callers can rely on categories being unchanged
 *  after calling this (see test/edge_cases.ts, "suggestion never
 *  changes official numbers"). The caller (application layer, Package 3
 *  UI) is responsible for persisting each suggestion to
 *  `budget_suggestions` with status='pending', and only a human
 *  accept/edit action ever creates a real forecast_entries row.
 *
 *  CORRECTION (see CORRECTIONS.md item 1): the "completed under budget"
 *  signal previously inferred completion from "no open committed
 *  costs," which fires just as easily for a category that's simply
 *  between commitments as for one that's actually done. It now requires
 *  cat.status to be explicitly 'complete' or 'closed' — a fact only a
 *  human sets — AND still checks for zero open commitments as a sanity
 *  guard (a category marked complete with an open commitment is a data
 *  inconsistency worth surfacing differently, not silently suggesting a
 *  refund on money that may still be owed). */
export function generateBudgetSuggestions(
  categories: CategoryFinancials[],
  nowISO: string = new Date().toISOString()
): BudgetSuggestion[] {
  const suggestions: BudgetSuggestion[] = [];

  for (const cat of categories) {
    const spentBeyondRevised = cat.actualCostCents + cat.committedCostCents - cat.revisedEstimateCents;

    if (spentBeyondRevised > 0) {
      suggestions.push({
        costCodeId: cat.costCodeId,
        suggestedAmountCents: spentBeyondRevised,
        direction: "over",
        reason: `Actual + committed cost (${formatShort(cat.actualCostCents + cat.committedCostCents)}) exceeds the revised estimate (${formatShort(cat.revisedEstimateCents)}).`,
        sourceType: "actual_plus_committed_exceeds_revised",
        evidenceRefs: [cat.costCodeId],
        confidence: cat.committedCostCents === 0 ? "high" : "medium",
        generatedAt: nowISO,
      });
    }

    const isExplicitlyDone = cat.status === "complete" || cat.status === "closed";
    const underBy = cat.revisedEstimateCents - cat.actualCostCents;

    if (isExplicitlyDone && cat.committedCostCents === 0 && underBy > 0) {
      suggestions.push({
        costCodeId: cat.costCodeId,
        suggestedAmountCents: underBy,
        direction: "under",
        reason: `Category is marked ${cat.status} with no open committed costs, and actual cost (${formatShort(cat.actualCostCents)}) is under the revised estimate (${formatShort(cat.revisedEstimateCents)}).`,
        sourceType: "category_complete_under_budget",
        evidenceRefs: [cat.costCodeId],
        // High confidence because completion is an explicit human-set
        // fact now, not inferred — this is the entire point of the fix.
        confidence: "high",
        generatedAt: nowISO,
      });
    }
  }

  return suggestions;
}

function formatShort(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
