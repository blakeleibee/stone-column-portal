import {
  computeAllCategoryFinancials,
  computeProjectTotals,
  computeProjectFeeSummary,
  reconcileProject,
  generateBudgetSuggestions,
} from "../../../01-financial-engine/src";
import { FinancialRepository } from "../data/financialRepository";
import { AdminFinancialsViewModel, suggestionKey } from "./types";

/**
 * The ONLY function that calls the full internal engine surface. Takes
 * a repository (never a fixture directly — see FixtureFinancialRepository
 * for the one place that IS the fixture) so the exact same function
 * works whether the data came from Hawks Ridge sample data or a real
 * Supabase project.
 */
export async function buildAdminFinancialsViewModel(
  projectId: string,
  repo: FinancialRepository
): Promise<AdminFinancialsViewModel> {
  const [projectMeta, costCodes, budgetLedger, expenses, committedCosts, forecastEntries, feeRule, feeLedgerEntries, independentControlTotal] =
    await Promise.all([
      repo.getProjectMeta(projectId),
      repo.getCostCodes(projectId),
      repo.getBudgetLedger(projectId),
      repo.getExpenses(projectId),
      repo.getCommittedCosts(projectId),
      repo.getForecastEntries(projectId),
      repo.getFeeRule(projectId),
      repo.getFeeLedgerEntries(projectId),
      repo.getIndependentPostedActualCostCents(projectId),
    ]);

  const categories = computeAllCategoryFinancials(costCodes, budgetLedger, expenses, committedCosts, forecastEntries);
  const totals = computeProjectTotals(categories);
  // `feeRule` is null when this project has no active fee rule yet
  // (pricing left "to be determined" at creation, P3.1 — see
  // financialRepository.ts's getFeeRule doc comment). computeProjectFeeSummary
  // requires a real FeeRule and must not be called with a fabricated one
  // — an absent fee rule surfaces honestly as `feeSummary: null`, never
  // as a computed-looking $0.
  const feeSummary = feeRule ? computeProjectFeeSummary(feeRule, categories, expenses, feeLedgerEntries) : null;

  // CORRECTION (Package 2 review item 3): reconcileProject() must be
  // given a control total that was NOT derived by summing these same
  // `categories` — otherwise the check is comparing a number to
  // itself and can never fail. `independentControlTotal` comes from
  // `getIndependentPostedActualCostCents()`, a repository method whose
  // contract explicitly forbids implementing it by calling the
  // engine's own rollup functions (see financialRepository.ts). For
  // the fixture, this sums the raw expense array directly — a
  // genuinely different code path than the per-category grouping
  // `computeAllCategoryFinancials` uses, so a bug in cost-code
  // assignment (e.g. an expense silently excluded from every category)
  // would actually surface as a mismatch here.
  const reconciliation = reconcileProject(categories, independentControlTotal);

  const suggestions = generateBudgetSuggestions(categories).map((suggestion) => ({
    suggestion,
    key: suggestionKey(suggestion),
  }));

  return { projectMeta, categories, totals, feeSummary, reconciliation, suggestions };
}
