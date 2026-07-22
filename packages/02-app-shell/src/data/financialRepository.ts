import type {
  CostCode,
  BudgetLedgerEntry,
  Expense,
  CommittedCost,
  ForecastEntry,
  FeeRule,
  FeeLedgerEntry,
} from "../../../01-financial-engine/src/types";

export interface ProjectMeta {
  id: string;
  name: string;
  projectNumber: string;
  address?: string;
  phase?: string;
  clientNames?: string;
  pricingLabel?: string;
}

/** Client-safe row shapes — deliberately NARROWER than the internal
 *  engine types above. These mirror `client_budget_view` /
 *  `client_expense_view` in schema/001_core_financial.sql field-for-
 *  field. A real SupabaseFinancialRepository queries those VIEWS
 *  directly, never the raw tables — so there is no "fetch everything,
 *  then hide fields in the UI" step anywhere in the client path. */
export interface ClientSafeBudgetLine {
  costCodeId: string;
  code: string;
  originalEstimateCents: number;
  approvedChangesCents: number;
  revisedEstimateCents: number;
}

export interface ClientSafeExpense {
  id: string;
  projectId: string;
  costCodeId: string;
  transactionDate: string;
  descriptionClient?: string;
  amountCents: number;
  /** Only present if the project's settings allow showing vendor names
   *  to the client — see ProjectClientVisibilitySettings below. */
  vendorName?: string;
}

/** Package 4 doesn't exist yet — these are typed and wired now so the
 *  client screen's shape is stable, but every real implementation
 *  (including the fixture one) returns an empty array until invoices
 *  exist. Modeling them now, empty, is better than the client screen
 *  silently having no concept of "invoices" at all and needing a
 *  breaking type change later. */
export interface ClientSafeInvoice {
  id: string;
  drawNumber: number;
  issueDate: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: "draft" | "issued" | "partially_paid" | "paid" | "void" | "overdue";
}

/** Per-project settings controlling what a client sees — these live on
 *  the `projects` row in the real schema (client visibility defaults,
 *  spec section 1). Modeled narrowly here to just the flags this
 *  package's screens need. */
export interface ProjectClientVisibilitySettings {
  showVendorNamesToClient: boolean;
  showSupportingInvoicesToClient: boolean;
}

/**
 * The ONLY way any screen obtains financial data. `AdminFinancialsScreen`/`ClientBudgetAndInvoicesScreen`-
 * family components never import a fixture or talk to Supabase
 * directly — they receive a repository (or, more commonly, an
 * already-built view model — see viewmodels/buildFinancialsViewModel.ts)
 * and the repository decides where the bytes actually come from.
 */
export interface FinancialRepository {
  getProjectMeta(projectId: string): Promise<ProjectMeta>;
  getClientVisibilitySettings(projectId: string): Promise<ProjectClientVisibilitySettings>;

  // ---- Internal (admin/staff-only) data — full engine inputs ----
  getCostCodes(projectId: string): Promise<CostCode[]>;
  getBudgetLedger(projectId: string): Promise<BudgetLedgerEntry[]>;
  getExpenses(projectId: string): Promise<Expense[]>;
  getCommittedCosts(projectId: string): Promise<CommittedCost[]>;
  getForecastEntries(projectId: string): Promise<ForecastEntry[]>;
  getFeeRule(projectId: string): Promise<FeeRule>;
  getFeeLedgerEntries(projectId: string): Promise<FeeLedgerEntry[]>;

  /** Independently-sourced control total for reconciliation — e.g. a
   *  raw SUM(amount_cents) query against posted expenses, run
   *  SEPARATELY from whatever grouping/rollup path the engine's
   *  category functions use. Must never be implemented by calling the
   *  engine's own rollup functions and handing back their result —
   *  that would recreate the exact "comparing a number to itself"
   *  problem this method exists to avoid. See buildAdminFinancialsViewModel. */
  getIndependentPostedActualCostCents(projectId: string): Promise<number>;

  // ---- Client-safe data — narrower shapes, narrower rows ----
  getClientSafeBudgetLines(projectId: string): Promise<ClientSafeBudgetLine[]>;
  getClientSafePublishedExpenses(projectId: string): Promise<ClientSafeExpense[]>;
  getClientSafeInvoices(projectId: string): Promise<ClientSafeInvoice[]>;
}
