import { FinancialRepository } from "./financialRepository";

/**
 * NOT FUNCTIONAL — there is no live Supabase project in this sandbox
 * (no network access to create one, per every other honesty disclosure
 * in this project). This class exists so the REPOSITORY INTERFACE is
 * proven out end-to-end (screens depend on `FinancialRepository`, not
 * on any specific implementation), and so the intended real query shape
 * is documented in one place rather than left to be invented later
 * under time pressure.
 *
 * Every method below is written as a comment describing the actual
 * Supabase call it will make, not a working implementation — throwing
 * clearly rather than silently returning fake data is the point: a
 * screen accidentally wired to this class in a real deployment fails
 * loudly instead of rendering empty/wrong numbers.
 */
export class SupabaseFinancialRepository implements FinancialRepository {
  constructor(private readonly _client: unknown /* SupabaseClient, once wired */) {}

  async getProjectMeta(projectId: string): Promise<never> {
    // supabase.from('projects').select('id,name,project_number,address,phase,pricing_model_label').eq('id', projectId).single()
    throw notImplemented("getProjectMeta", projectId);
  }
  async getClientVisibilitySettings(projectId: string): Promise<never> {
    // supabase.from('projects').select('show_vendor_names_to_client, show_supporting_invoices_to_client').eq('id', projectId).single()
    throw notImplemented("getClientVisibilitySettings", projectId);
  }
  async getCostCodes(projectId: string): Promise<never> {
    // supabase.from('cost_codes').select('*').eq('project_id', projectId).eq('is_archived', false)
    throw notImplemented("getCostCodes", projectId);
  }
  async getBudgetLedger(projectId: string): Promise<never> {
    // supabase.from('budget_ledger').select('*, cost_codes!inner(project_id)').eq('cost_codes.project_id', projectId)
    throw notImplemented("getBudgetLedger", projectId);
  }
  async getExpenses(projectId: string): Promise<never> {
    // supabase.from('expenses').select('*').eq('project_id', projectId)
    // (staff/admin session — RLS's expenses_staff_full_access policy applies)
    throw notImplemented("getExpenses", projectId);
  }
  async getCommittedCosts(projectId: string): Promise<never> {
    // supabase.from('committed_costs').select('*').eq('project_id', projectId)
    throw notImplemented("getCommittedCosts", projectId);
  }
  async getForecastEntries(projectId: string): Promise<never> {
    // supabase.from('forecast_entries').select('*').eq('project_id', projectId)
    throw notImplemented("getForecastEntries", projectId);
  }
  async getFeeRule(projectId: string): Promise<never> {
    // supabase.from('project_fee_rules').select('*').eq('project_id', projectId).is('effective_to', null).single()
    throw notImplemented("getFeeRule", projectId);
  }
  async getFeeLedgerEntries(projectId: string): Promise<never> {
    // supabase.from('fee_ledger').select('*').eq('project_id', projectId)
    throw notImplemented("getFeeLedgerEntries", projectId);
  }
  async getIndependentPostedActualCostCents(projectId: string): Promise<never> {
    // A genuinely SEPARATE query path from getExpenses()/getCostCodes()
    // above — e.g. a Postgres RPC or a raw aggregate query:
    //   supabase.rpc('sum_posted_expenses', { p_project_id: projectId })
    // implemented server-side as:
    //   select coalesce(sum(amount_cents), 0) from expenses
    //     where project_id = p_project_id and financial_status = 'posted'
    // This must NOT be implemented by calling getExpenses() and summing
    // client-side with the same grouping the engine uses — that would
    // silently recreate the "reconciling a number against itself"
    // problem this method exists to solve (see docs/PACKAGE_02_NOTES.md
    // item 3, and reconciliation.ts's own header comment).
    throw notImplemented("getIndependentPostedActualCostCents", projectId);
  }
  async getClientSafeBudgetLines(projectId: string): Promise<never> {
    // supabase.from('client_budget_view').select('*').eq('project_id', projectId)
    // — the VIEW, never the raw budget_ledger/cost_codes tables.
    throw notImplemented("getClientSafeBudgetLines", projectId);
  }
  async getClientSafePublishedExpenses(projectId: string): Promise<never> {
    // supabase.from('client_expense_view').select('*').eq('project_id', projectId)
    throw notImplemented("getClientSafePublishedExpenses", projectId);
  }
  async getClientSafeInvoices(projectId: string): Promise<never> {
    // No invoices table/view exists yet (Package 4). Once it does:
    // supabase.from('client_invoice_view').select('*').eq('project_id', projectId)
    throw notImplemented("getClientSafeInvoices", projectId);
  }
}

function notImplemented(method: string, projectId: string): Error {
  return new Error(
    `SupabaseFinancialRepository.${method}("${projectId}") is not implemented — there is no live Supabase project in this sandbox. See the comment above this method for the intended query.`
  );
}
