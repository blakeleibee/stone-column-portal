import { CategoryFinancials, ReconciliationReport, ReconciliationIssue } from "./types";
import { computeProjectTotals } from "./budget";

/** Compares each category's numbers against the project-level rollup.
 *  Because computeProjectTotals() derives totals BY SUMMING categories,
 *  this can only ever fail if the caller passes in a stale/mismatched
 *  project total from somewhere else (e.g. an old cached value) — which
 *  is exactly the class of bug this check exists to catch. */
export function reconcileProject(
  categories: CategoryFinancials[],
  externalProjectTotalActualCents?: number
): ReconciliationReport {
  const issues: ReconciliationIssue[] = [];
  const totals = computeProjectTotals(categories);

  if (
    externalProjectTotalActualCents !== undefined &&
    externalProjectTotalActualCents !== totals.actualCostCents
  ) {
    issues.push({
      scope: "project_total_actual",
      message:
        "Externally-supplied project actual cost does not match the sum of category actual costs.",
      expectedCents: totals.actualCostCents,
      actualCents: externalProjectTotalActualCents,
    });
  }

  // Sanity checks per category: revised should equal original + changes,
  // projected final should equal actual + committed + forecast. These
  // are guaranteed by computeCategoryFinancials()'s own math, but are
  // re-verified here in case data ever gets constructed by hand (e.g.
  // a manual DB fix) instead of through the engine.
  for (const cat of categories) {
    const expectedRevised = cat.originalEstimateCents + cat.approvedChangesCents;
    if (expectedRevised !== cat.revisedEstimateCents) {
      issues.push({
        scope: `cost_code:${cat.code}`,
        message: "Revised estimate does not equal original + approved changes.",
        expectedCents: expectedRevised,
        actualCents: cat.revisedEstimateCents,
      });
    }

    const expectedProjected =
      cat.actualCostCents + cat.committedCostCents + cat.forecastToCompleteCents;
    if (expectedProjected !== cat.projectedFinalCostCents) {
      issues.push({
        scope: `cost_code:${cat.code}`,
        message: "Projected final cost does not equal actual + committed + forecast.",
        expectedCents: expectedProjected,
        actualCents: cat.projectedFinalCostCents,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Batch-level check for a confirmed QuickBooks import: compares the
 *  total the source file reported against the total actually landed in
 *  expenses once confirm_import_batch() has run. A pure function with no
 *  side effects — the caller is responsible for computing both totals
 *  (e.g. summing raw_data->>'Amount' vs. summing the resulting expenses'
 *  amount_cents) and deciding what to do with a mismatch. */
export function reconcileImportBatch(importedTotalCents: number, resultingExpensesTotalCents: number) {
  return {
    matches: importedTotalCents === resultingExpensesTotalCents,
    differenceCents: resultingExpensesTotalCents - importedTotalCents,
  };
}
