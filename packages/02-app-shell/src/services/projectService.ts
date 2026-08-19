import type { SupabaseClient } from "@supabase/supabase-js";

// Matches schema/001_core_financial.sql's `pricing_model` and `fee_basis`
// enums exactly (see the grep quoted in the P3 Task 3 brief) — kept as
// plain string unions here, same convention as every other enum-backed
// field in this package (no shared generated-types file yet).
export type PricingModel =
  | "cost_plus_percentage"
  | "cost_plus_fixed_fee"
  | "fixed_price"
  | "time_and_materials"
  | "hybrid_custom"
  | "other";

export type FeeBasis = "percentage" | "fixed";

// Matches schema/001's `project_status` enum.
export type ProjectStatus = "draft" | "active" | "on_hold" | "closed_out" | "archived";

export interface ProjectRow {
  id: string;
  orgId: string;
  name: string;
  projectNumber: string;
  address: string | null;
  projectType: string | null;
  status: ProjectStatus;
  pricingModel: PricingModel;
  pricingModelLabel: string | null;
  createdAt: string;
}

// Explicit column list (not `select("*")`) — deliberately excludes
// internal_notes and the raw gmp_amount_cents/deposit_amount_cents
// columns. Nothing that currently calls this service (the project
// switcher, project creation) needs them, and pulling internal_notes
// into a row shape that other code might later pass through to a
// less-trusted context is exactly the kind of accidental leak
// CLAUDE.md's "internal notes never appear in any client-/vendor-facing
// query path" rule warns about — safer to just not select it here.
const PROJECT_COLUMNS =
  "id, org_id, name, project_number, address, project_type, status, pricing_model, pricing_model_label, created_at";

function mapProject(row: any): ProjectRow {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    projectNumber: row.project_number,
    address: row.address,
    projectType: row.project_type,
    status: row.status,
    pricingModel: row.pricing_model,
    pricingModelLabel: row.pricing_model_label,
    createdAt: row.created_at,
  };
}

/**
 * Plain `select` scoped to org_id only — RLS (projects_staff_select,
 * schema/016) is the ONLY access filter. Do not layer any
 * staff_function/assignment logic on top of this in application code;
 * that would duplicate (and could drift from) the policy's
 * is_org_staff_for_project_row() logic. `includeArchived` defaults to
 * false because every known caller (project switcher, "first project"
 * convention this replaces) wants active-ish projects only; archived
 * projects are still reachable by explicitly opting in.
 */
export async function listAccessibleProjects(
  supabase: SupabaseClient,
  orgId: string,
  options: { includeArchived?: boolean } = {}
): Promise<ProjectRow[]> {
  let query = supabase.from("projects").select(PROJECT_COLUMNS).eq("org_id", orgId);
  if (!options.includeArchived) {
    query = query.neq("status", "archived");
  }
  const { data, error } = await query.order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapProject);
}

export interface CreateProjectParams {
  orgId: string;
  name: string;
  projectNumber: string;
  address?: string | null;
  projectType?: string | null;
  pricingModel: PricingModel;
  pricingModelLabel?: string | null;
  feeBasis: FeeBasis;
  // bigint/integer RPC params map to plain `number`, same convention as
  // every other *_cents field in this package (see budgetService.ts;
  // packages/01-financial-engine/src/types.ts's `Cents = number`).
  feeBasisPoints?: number | null;
  feeFixedAmountCents?: number | null;
  initialStaffProfileIds?: string[];
  initialClientProfileIds?: string[];
}

/**
 * Thin wrapper over create_project_with_defaults() (schema/016) — an
 * admin-only RPC (enforced inside the function itself via
 * is_org_admin_for_org()) that creates the project row, seeds
 * project_fee_rules, applies the standard cost-code template, and
 * inserts the initial staff/client assignments in one transaction. This
 * function does not re-implement any of that logic; it only maps camelCase
 * params to the RPC's p_-prefixed positional/named args and normalizes
 * the result to this repo's { id } | { error } convention (see
 * bidService.ts's createBidPackage/awardBid for the same shape).
 */
export async function createProject(
  supabase: SupabaseClient,
  params: CreateProjectParams
): Promise<{ id: string } | { error: string }> {
  if (!params.name.trim()) return { error: "Project name is required." };
  if (!params.projectNumber.trim()) return { error: "Project number is required." };

  const { data, error } = await supabase.rpc("create_project_with_defaults", {
    p_org_id: params.orgId,
    p_name: params.name.trim(),
    p_project_number: params.projectNumber.trim(),
    p_address: params.address ?? null,
    p_project_type: params.projectType ?? null,
    p_pricing_model: params.pricingModel,
    p_pricing_model_label: params.pricingModelLabel ?? null,
    p_fee_basis: params.feeBasis,
    p_fee_basis_points: params.feeBasisPoints ?? null,
    p_fee_fixed_amount_cents: params.feeFixedAmountCents ?? null,
    p_initial_staff_profile_ids: params.initialStaffProfileIds ?? [],
    p_initial_client_profile_ids: params.initialClientProfileIds ?? [],
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/**
 * assigned_by has NO column default (unlike bid_questions.recorded_by,
 * which defaults to auth.uid()) — the DB trigger
 * (enforce_project_staff_assignment_identity_and_revocation, schema/016)
 * requires it to equal the acting session's own auth.uid() on every
 * INSERT unconditionally, so it must be supplied explicitly here, not
 * omitted. Same auth.getUser() pattern as bidService.ts's
 * revokeVendorMember/reactivateVendorMember use for revoked_by.
 *
 * Known quirk (documented in the Task 3 brief, not fixed here): if
 * profileId is a profile the caller's own RLS-scoped session can't see
 * (different org, or otherwise not visible), the org-match trigger's
 * internal RLS-filtered lookup resolves to a NULL profile org and the
 * resulting error message reads "org mismatch (profile org <NULL>...)"
 * rather than a clear "not found" — caught and rethrown here with a
 * clearer message where it's cheap to do so.
 */
export async function assignStaffToProject(supabase: SupabaseClient, projectId: string, profileId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("project_staff_assignments")
    .insert({ project_id: projectId, profile_id: profileId, assigned_by: user?.id });
  if (error) {
    if (/org mismatch/.test(error.message)) {
      return {
        error: "Cannot assign this profile — it isn't visible to you or belongs to a different organization.",
      };
    }
    return { error: error.message };
  }
  return {};
}

/** revoked_by is deliberately passed explicitly (not omitted) — matches
 *  bidService.ts's revokeVendorMember exactly. The DB trigger requires
 *  revoked_by to equal the acting session's own auth.uid() whenever
 *  revoked_at is being set to non-null; there is no column default to
 *  fall back on, so omitting it here would always fail the trigger's
 *  check (NULL is distinct from auth.uid()). */
export async function revokeStaffAssignment(supabase: SupabaseClient, assignmentId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("project_staff_assignments")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user?.id })
    .eq("id", assignmentId);
  if (error) return { error: error.message };
  return {};
}

/** revoked_by is deliberately NOT included — the trigger auto-clears it
 *  when revoked_at is cleared (reactivation), same as
 *  reactivateVendorMember. */
export async function reactivateStaffAssignment(supabase: SupabaseClient, assignmentId: string) {
  const { error } = await supabase
    .from("project_staff_assignments")
    .update({ revoked_at: null })
    .eq("id", assignmentId);
  if (error) return { error: error.message };
  return {};
}
