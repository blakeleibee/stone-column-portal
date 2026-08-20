import { FinancialRepository, ProjectMeta, ProjectClientVisibilitySettings } from "./financialRepository";

/**
 * Real implementation, wired to the schema/001-010 tables/views. Every
 * query goes through the CALLER's own Supabase client (their JWT,
 * subject to RLS) -- this class never uses a service-role client, per
 * TARGET-ARCHITECTURE.md §5.2's "ordinary user-originated" rule.
 */
export class SupabaseFinancialRepository implements FinancialRepository {
  constructor(private readonly client: any /* SupabaseClient — typed `any` deliberately: this repo has no generated Supabase database types yet (a future package's job); every query here is still checked against `financialRepository.ts`'s own return types via this class's `implements` clause. */) {}

  async getProjectMeta(projectId: string): Promise<ProjectMeta> {
    const { data, error } = await this.client
      .from("projects")
      .select("id, name, project_number, address, phase, pricing_model_label")
      .eq("id", projectId)
      .single();
    if (error) throw error;
    return {
      id: data.id,
      name: data.name,
      projectNumber: data.project_number,
      address: data.address ?? undefined,
      phase: data.phase ?? "",
      pricingLabel: data.pricing_model_label ?? "",
    };
  }

  async getClientVisibilitySettings(projectId: string): Promise<ProjectClientVisibilitySettings> {
    const { data, error } = await this.client
      .from("projects")
      .select("show_vendor_names_to_client, show_supporting_invoices_to_client")
      .eq("id", projectId)
      .single();
    if (error) throw error;
    return {
      showVendorNamesToClient: data.show_vendor_names_to_client ?? false,
      showSupportingInvoicesToClient: data.show_supporting_invoices_to_client ?? false,
    };
  }

  async getCostCodes(projectId: string) {
    const { data, error } = await this.client
      .from("cost_codes")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_archived", false);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      code: row.code,
      feeEligible: row.fee_eligible,
      status: row.status,
      isArchived: row.is_archived,
      divisionId: row.division_id,
      activityName: row.activity_name,
      scopeDescription: row.scope_description,
      includeInEstimate: row.include_in_estimate,
      billable: row.billable,
    }));
  }

  async getBudgetLedger(projectId: string) {
    const { data, error } = await this.client
      .from("budget_ledger")
      .select("*, cost_codes!inner(project_id)")
      .eq("cost_codes.project_id", projectId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      costCodeId: row.cost_code_id,
      entryType: row.entry_type,
      amountCents: row.amount_cents,
      sourceType: row.source_type,
      createdAt: row.created_at,
    }));
  }

  async getExpenses(projectId: string) {
    const { data, error } = await this.client.from("expenses").select("*").eq("project_id", projectId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      costCodeId: row.cost_code_id,
      vendorName: row.vendor_name,
      transactionDate: row.transaction_date,
      amountCents: row.amount_cents,
      financialStatus: row.financial_status,
      publicationStatus: row.publication_status,
      descriptionClient: row.description_client,
    }));
  }

  async getCommittedCosts(projectId: string) {
    const { data, error } = await this.client.from("committed_costs").select("*").eq("project_id", projectId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      costCodeId: row.cost_code_id,
      amountCents: row.amount_cents,
      status: row.status,
      supersededAt: row.superseded_at,
      supersededById: row.superseded_by_id,
      vendorName: row.vendor_name ?? undefined,
      sourceType: row.source_type ?? undefined,
      sourceId: row.source_id ?? undefined,
    }));
  }

  async getForecastEntries(projectId: string) {
    const { data, error } = await this.client
      .from("forecast_entries")
      .select("*")
      .eq("project_id", projectId)
      .is("superseded_at", null);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      costCodeId: row.cost_code_id,
      forecastToCompleteCents: row.forecast_to_complete_cents,
      method: row.method,
      supersededAt: row.superseded_at,
    }));
  }

  async getFeeRule(projectId: string) {
    const { data, error } = await this.client
      .from("project_fee_rules")
      .select("*")
      .eq("project_id", projectId)
      .is("effective_to", null)
      .single();
    if (error) throw error;
    return {
      id: data.id,
      projectId: data.project_id,
      feeBasis: data.fee_basis,
      feeBasisPoints: data.fee_basis_points,
      feeFixedAmountCents: data.fee_fixed_amount_cents,
      contingencyFeeEligible: data.contingency_fee_eligible,
      allowanceFeeEligible: data.allowance_fee_eligible,
      effectiveFrom: data.effective_from,
    };
  }

  async getFeeLedgerEntries(projectId: string) {
    const { data, error } = await this.client.from("fee_ledger").select("*").eq("project_id", projectId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      feeAmountCents: row.fee_amount_cents,
      reversesEntryId: row.reverses_entry_id,
      isAdjustment: row.is_adjustment,
    }));
  }

  /**
   * A GENUINELY SEPARATE query path from getExpenses() above -- calls
   * a Postgres RPC that aggregates directly in the database, never
   * client-side-summing getExpenses()'s own result. This is the exact
   * "independent control total" contract TARGET-ARCHITECTURE.md §6
   * requires; see the sum_posted_expenses RPC this method calls.
   */
  async getIndependentPostedActualCostCents(projectId: string): Promise<number> {
    const { data, error } = await this.client.rpc("sum_posted_expenses", { p_project_id: projectId });
    if (error) throw error;
    return data ?? 0;
  }

  async getClientSafeBudgetLines(projectId: string) {
    const { data, error } = await this.client.from("client_budget_view").select("*").eq("project_id", projectId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      costCodeId: row.cost_code_id,
      code: row.code,
      originalEstimateCents: row.original_estimate_cents,
      approvedChangesCents: row.approved_changes_cents,
      revisedEstimateCents: row.original_estimate_cents + row.approved_changes_cents,
    }));
  }

  async getClientSafePublishedExpenses(projectId: string) {
    const { data, error } = await this.client.from("client_expense_view").select("*").eq("project_id", projectId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      costCodeId: row.cost_code_id,
      transactionDate: row.transaction_date,
      descriptionClient: row.description_client,
      amountCents: row.amount_cents,
      vendorName: row.vendor_name,
    }));
  }

  async getClientSafeInvoices() {
    // No invoices table/view exists yet (a later package) -- an empty
    // array is the correct, honest answer today, not a stub throw:
    // the interface contract is "invoices this client can see," and
    // there are truthfully none yet, not "this isn't implemented."
    return [];
  }
}
