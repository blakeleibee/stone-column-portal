import {
  FinancialRepository,
  ProjectMeta,
  ProjectClientVisibilitySettings,
  ClientSafeBudgetLine,
  ClientSafeExpense,
  ClientSafeInvoice,
} from "./financialRepository";
import * as hawksRidge from "../../../01-financial-engine/fixtures/hawksRidge";
import { computeAllCategoryFinancials } from "../../../01-financial-engine/src";

/**
 * Supplies Hawks Ridge sample data for previews and tests ONLY.
 * `AdminFinancialsScreen`/`ClientBudgetAndInvoicesScreen`-family production components never import this
 * file or `fixtures/hawksRidge` directly — they take a
 * `FinancialRepository` as a parameter, and the preview/test harness is
 * what decides to hand them THIS implementation. Grep-ability matters
 * here: `grep -r "fixtures/hawksRidge" src/` should return nothing
 * outside this one file (see test/render_smoke.tsx, which asserts
 * exactly that against the screen files).
 */
export class FixtureFinancialRepository implements FinancialRepository {
  async getProjectMeta(_projectId: string): Promise<ProjectMeta> {
    return { ...hawksRidge.projectMeta };
  }

  async getClientVisibilitySettings(_projectId: string): Promise<ProjectClientVisibilitySettings> {
    return { showVendorNamesToClient: true, showSupportingInvoicesToClient: false };
  }

  async getCostCodes() {
    return hawksRidge.costCodes;
  }
  async getBudgetLedger() {
    return hawksRidge.budgetLedger;
  }
  async getExpenses() {
    return hawksRidge.expenses;
  }
  async getCommittedCosts() {
    return hawksRidge.committedCosts;
  }
  async getForecastEntries() {
    return hawksRidge.forecastEntries;
  }
  async getFeeRule() {
    return hawksRidge.feeRule;
  }
  async getFeeLedgerEntries() {
    return hawksRidge.feeLedgerEntries;
  }

  /** INDEPENDENT of the engine's category-rollup path: sums the raw
   *  expense array directly here, not via computeAllCategoryFinancials
   *  or computeProjectTotals. In a real repository this would be a
   *  standalone `SELECT SUM(amount_cents) FROM expenses WHERE
   *  financial_status = 'posted'` query — genuinely a different code
   *  path than whatever grouping logic the engine uses, which is the
   *  whole point (see docs/PACKAGE_02_NOTES.md item 3). */
  async getIndependentPostedActualCostCents(): Promise<number> {
    return hawksRidge.expenses
      .filter((e) => e.financialStatus === "posted")
      .reduce((sum, e) => sum + e.amountCents, 0);
  }

  async getClientSafeBudgetLines(): Promise<ClientSafeBudgetLine[]> {
    // Mirrors client_budget_view's grouping (original vs. approved-change
    // ledger entries per cost code) — computed here from the same raw
    // ledger a real client_budget_view query would read, but exposing
    // only the client-safe columns, matching the view's column list.
    const categories = computeAllCategoryFinancials(
      hawksRidge.costCodes,
      hawksRidge.budgetLedger,
      [],
      [],
      []
    );
    return categories.map((c) => ({
      costCodeId: c.costCodeId,
      code: c.code,
      originalEstimateCents: c.originalEstimateCents,
      approvedChangesCents: c.approvedChangesCents,
      revisedEstimateCents: c.revisedEstimateCents,
    }));
  }

  async getClientSafePublishedExpenses(): Promise<ClientSafeExpense[]> {
    return hawksRidge.expenses
      .filter((e) => e.financialStatus === "posted" && e.publicationStatus === "published")
      .map((e) => ({
        id: e.id,
        projectId: e.projectId,
        costCodeId: e.costCodeId,
        transactionDate: e.transactionDate,
        descriptionClient: e.descriptionClient,
        amountCents: e.amountCents,
        vendorName: e.vendorName,
      }));
  }

  async getClientSafeInvoices(): Promise<ClientSafeInvoice[]> {
    // No invoices/draws table exists yet (Package 4) — every
    // implementation of this method returns empty until then. Typed
    // and wired now so the client screen's shape doesn't need a
    // breaking change later.
    return [];
  }
}
