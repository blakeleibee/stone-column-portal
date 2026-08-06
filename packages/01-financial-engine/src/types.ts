// Stone Column Portal — Financial Engine types
// RULE: all money is an integer number of cents. Never a float dollar amount.
// RULE: all rates (fee %, retainage %) are integer basis points over a
// fixed 10,000 denominator. Never a JS float like 0.15. See money.ts.
// This file has no I/O — it only describes shapes the engine operates on.
// Real app wires these to the `schema/001_core_financial.sql` tables.

export type Cents = number; // always an integer; enforced by assertInt() in money.ts
export type BasisPoints = number; // integer, e.g. 1500 = 15.00%; enforced by assertBasisPoints() in money.ts
export type ISODate = string;
export type ID = string;

export type CostCodeStatus = "not_started" | "active" | "substantially_complete" | "complete" | "closed";

export interface CostCode {
  id: ID;
  projectId: ID;
  code: string;
  feeEligible: boolean;
  status: CostCodeStatus;
  isArchived: boolean;
  /** FK to divisions(id, project_id) — nullable: ad hoc cost codes that
   *  never went through apply_standard_cost_code_template() (schema/012)
   *  have no division. */
  divisionId: string | null;
  /** Workbook "Activity" label (schema/012 cost_codes.activity_name).
   *  Nullable for the same reason as divisionId — not every cost code
   *  originates from the standard template. */
  activityName: string | null;
  /** Free-text scope description (schema/012 cost_codes.scope_description).
   *  Nullable — no template column populates this; staff-entered only. */
  scopeDescription: string | null;
  /** schema/012 cost_codes.include_in_estimate — independent of feeEligible
   *  and billable (see 012's own header comment on the workbook's 7082/9999
   *  rows). Not null, defaults true at the DB. */
  includeInEstimate: boolean;
  /** schema/012 cost_codes.billable — independent of feeEligible and
   *  includeInEstimate. Not null, defaults true at the DB. */
  billable: boolean;
}

export type BudgetEntryType = "original" | "approved_change" | "correction";

export interface BudgetLedgerEntry {
  id: ID;
  costCodeId: ID;
  entryType: BudgetEntryType;
  amountCents: Cents; // may be negative (credit / correction)
  sourceType: string;
  sourceId?: ID;
  reversesEntryId?: ID | null; // set when this row corrects/reverses an earlier one
  isAdjustment?: boolean;      // true = intentionally exceeds original magnitude (see reconciliation.ts)
  note?: string;
  createdAt: ISODate;
}

/** CORRECTION (independent review item 3): financial_status and
 *  publication_status are separate axes. financial_status is the only
 *  one that affects any official total (actual cost, fee, forecast,
 *  reconciliation). publication_status affects ONLY what a client can
 *  see, and can move around freely (once posted) without ever touching
 *  financial truth. There is no valid combination where a non-'posted'
 *  expense is financially real or a non-'posted' expense is client-
 *  visible — see the CHECK constraints in the SQL schema, mirrored here
 *  by construction (the engine simply never looks at anything but
 *  financialStatus for money math). */
export type ExpenseFinancialStatus = "pending" | "posted" | "void";
export type ExpensePublicationStatus = "internal" | "ready" | "published" | "withdrawn";

export interface Expense {
  id: ID;
  projectId: ID;
  costCodeId: ID;
  vendorName: string;
  transactionDate: ISODate;
  descriptionInternal?: string;
  descriptionClient?: string;
  amountCents: Cents;
  financialStatus: ExpenseFinancialStatus;
  publicationStatus: ExpensePublicationStatus;
  feeEligibleOverride?: boolean | null; // null/undefined = inherit cost code setting
  correctsExpenseId?: ID | null; // set when this expense exists to correct an earlier (voided) one
}

export interface CommittedCost {
  id: ID;
  projectId: ID;
  costCodeId: ID;
  amountCents: Cents;
  status: "open" | "fulfilled" | "cancelled";
  supersededAt?: ISODate | null;   // set when partially invoiced / replaced by a new row
  supersededById?: ID | null;
}

export interface ForecastEntry {
  id: ID;
  projectId: ID;
  costCodeId: ID;
  forecastToCompleteCents: Cents;
  method: "manual" | "accepted_suggestion";
  supersededAt?: ISODate | null; // null/undefined = currently active
}

export type FeeBasis = "percentage" | "fixed";

export interface FeeRule {
  id: ID;
  projectId: ID;
  feeBasis: FeeBasis;
  /** Integer basis points, e.g. 1500 = 15.00%. NEVER a float like 0.15 —
   *  see multiplyCentsByBasisPoints() in money.ts, which does the whole
   *  calculation in BigInt precisely so this never gets converted
   *  through a JS float at any point. Only meaningful when
   *  feeBasis === 'percentage'. */
  feeBasisPoints?: BasisPoints;
  feeFixedAmountCents?: Cents; // only meaningful when feeBasis === 'fixed'
  contingencyFeeEligible: boolean;
  allowanceFeeEligible: boolean;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate | null;
}

/** fee_ledger row. Reversals are new rows with reversesEntryId set and
 *  an offsetting (typically negative) feeAmountCents — never an edit to
 *  the original row. */
export interface FeeLedgerEntry {
  id: ID;
  projectId: ID;
  sourceType: "expense_accrual" | "invoice_issued" | "reversal_adjustment";
  sourceId: ID;
  feeAmountCents: Cents;
  reversesEntryId?: ID | null;
  isAdjustment?: boolean;
}

/** Per-cost-code rollup. This is the ONLY place these numbers should be
 *  computed — UI never re-derives them independently, so the app can't
 *  drift into showing two different numbers for the same thing. */
export interface CategoryFinancials {
  costCodeId: ID;
  code: string;
  status: CostCodeStatus;
  originalEstimateCents: Cents;
  approvedChangesCents: Cents;
  revisedEstimateCents: Cents;      // original + approvedChanges
  actualCostCents: Cents;           // posted, non-void expenses only
  committedCostCents: Cents;        // open, non-superseded committed_costs
  forecastToCompleteCents: Cents;   // active forecast_entries row, or 0 if none set
  projectedFinalCostCents: Cents;   // actual + committed + forecastToComplete
  suggestedVarianceCents: Cents;    // projectedFinal - revised (signed: negative = under budget)
  isFeeEligible: boolean;
}

export type SuggestionDirection = "over" | "under";
export type SuggestionConfidence = "low" | "medium" | "high";

export interface BudgetSuggestion {
  costCodeId: ID;
  suggestedAmountCents: Cents;
  direction: SuggestionDirection;
  reason: string;
  sourceType:
    | "actual_plus_committed_exceeds_revised"
    | "category_complete_under_budget"
    | "manual_forecast_present";
  evidenceRefs: ID[];
  confidence: SuggestionConfidence;
  generatedAt: ISODate;
  // status/resolution fields are NOT part of the pure engine output —
  // they live only once persisted to budget_suggestions, and are set by
  // a human action (accept/edit/dismiss), never by this module.
}

export interface ReconciliationIssue {
  scope: string;      // e.g. "cost_code:Site Work" or "project_total"
  message: string;
  expectedCents: Cents;
  actualCents: Cents;
}

export interface ReconciliationReport {
  ok: boolean;
  issues: ReconciliationIssue[];
}
