import type {
  CategoryFinancials,
  ReconciliationReport,
  BudgetSuggestion,
} from "../../../01-financial-engine/src/types";
import type { ProjectMeta, ClientSafeInvoice } from "../data/financialRepository";

/** A suggestion plus a stable, deterministic key for React lists — the
 *  pure engine output (`BudgetSuggestion`) has no persisted id (Package
 *  3 is what actually writes these to `budget_suggestions` and gives
 *  them a real UUID); this key is derived from fields that are already
 *  unique per suggestion within one `generateBudgetSuggestions()` call
 *  (at most one 'over' and one 'under' per category), so it's stable
 *  across re-renders without being a fabricated random value. Once a
 *  suggestion is persisted (Package 3+), screens should use its real
 *  database id instead — see the comment on SuggestionViewItem.key. */
export interface SuggestionViewItem {
  suggestion: BudgetSuggestion;
  /** Stable for the lifetime of one generated batch. NOT a database id
   *  — swap this for the real `budget_suggestions.id` once suggestions
   *  are persisted (Package 3). */
  key: string;
}

export function suggestionKey(s: BudgetSuggestion): string {
  return `${s.costCodeId}:${s.sourceType}:${s.direction}`;
}

/** Internal, full-detail view model — Stone Column staff/admin only.
 *  Every field here is something an internal user is allowed to see;
 *  this type is never handed to a client-facing screen. */
export interface AdminFinancialsViewModel {
  projectMeta: ProjectMeta;
  categories: CategoryFinancials[];
  totals: {
    originalEstimateCents: number;
    approvedChangesCents: number;
    revisedEstimateCents: number;
    actualCostCents: number;
    committedCostCents: number;
    forecastToCompleteCents: number;
    projectedFinalCostCents: number;
  };
  feeSummary: {
    feeEligibleBasisCents: number;
    feeAccruedCents: number;
    feeInvoicedCents: number;
    feeUnbilledCents: number;
  };
  reconciliation: ReconciliationReport;
  suggestions: SuggestionViewItem[];
}

/** Client-facing view model. Deliberately narrower than the admin one
 *  — no internal category status/fee-eligibility, no committed costs,
 *  no raw forecasts, no suggestions, no reconciliation detail, no
 *  internal notes. See docs/PACKAGE_02_NOTES.md item 2 for exactly
 *  which fields the master spec says a client may see and why
 *  "Projected Final" is intentionally omitted for now (there is no
 *  client-safe forecast source yet in the data model). */
export interface ClientBudgetViewModel {
  projectMeta: ProjectMeta;
  budgetLines: Array<{
    costCodeId: string;
    code: string;
    originalEstimateCents: number;
    approvedChangesCents: number;
    revisedEstimateCents: number;
    /** Sum of this category's published+posted expenses only — computed
     *  from client-safe expense rows, never from the internal
     *  category rollup (which includes non-published data). */
    publishedActualCostCents: number;
  }>;
  totals: {
    originalEstimateCents: number;
    approvedChangesCents: number;
    revisedEstimateCents: number;
    publishedActualCostCents: number;
    // Deliberately NO projectedFinalCostCents — see file header comment.
  };
  invoices: ClientSafeInvoice[];
  /** Sum of invoices.totalCents / paidCents / (total - paid). Empty
   *  invoices array today (Package 4 doesn't exist yet) means these
   *  are all 0 — that's correct, not a bug, until invoicing exists. */
  invoiceSummary: {
    totalInvoicedCents: number;
    totalPaidCents: number;
    balanceCents: number;
  };
  showVendorNames: boolean;
  showSupportingInvoices: boolean;
}
