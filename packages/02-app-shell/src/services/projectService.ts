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

// Matches schema/016's `staff_function` enum exactly.
export type StaffFunction = "project_manager" | "superintendent" | "accounting" | "general";

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
 * Application-layer guard for P3-DESIGN.md Decision 9: "Every write
 * Server Action re-checks the project's current status server-side
 * before proceeding (never trusts that the UI hid the edit control) ...
 * so a stale tab pointed at a since-archived project cannot mutate it."
 * This is the actual security boundary for the known gap where
 * /admin/projects/[id]/team's assign/revoke/reactivate controls remain
 * reachable by direct URL for an archived project even though every
 * list-view link to the route is already hidden — RLS on
 * project_staff_assignments (project_staff_assignments_admin_manage,
 * schema/016) is admin-only but does NOT check the parent project's
 * status at all, so this check has to live here, not there.
 *
 * Looks the project's current status up through the caller's own
 * RLS-scoped client — same `select ... eq("id", ...)` pattern every
 * other read in this file already uses, never a service-role client.
 * Deliberately a plain lookup, not layered onto listAccessibleProjects()
 * (which the callers here don't otherwise need) or duplicated inline in
 * all three functions below.
 */
export async function assertProjectNotArchived(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ error: string } | null> {
  const { data, error } = await supabase.from("projects").select("status").eq("id", projectId).maybeSingle();
  if (error) return { error: error.message };
  if (data?.status === "archived") {
    return { error: "This project is archived. Team management isn't available for archived projects." };
  }
  return null;
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
  const archivedError = await assertProjectNotArchived(supabase, projectId);
  if (archivedError) return archivedError;

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
 *  check (NULL is distinct from auth.uid()).
 *
 *  This function only receives assignmentId, not project_id — the
 *  archived-project guard above needs the latter, so an explicit
 *  lookup step resolves project_id from the assignment row first
 *  (visible here, not hidden inside a clever join/RPC). */
export async function revokeStaffAssignment(supabase: SupabaseClient, assignmentId: string) {
  const { data: assignmentRow, error: lookupError } = await supabase
    .from("project_staff_assignments")
    .select("project_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (!assignmentRow) return { error: "Staff assignment not found." };

  const archivedError = await assertProjectNotArchived(supabase, assignmentRow.project_id);
  if (archivedError) return archivedError;

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
 *  reactivateVendorMember.
 *
 *  Same project_id-resolution step as revokeStaffAssignment above, for
 *  the same reason: this function only receives assignmentId, and the
 *  archived-project guard needs to know which project it belongs to. */
export async function reactivateStaffAssignment(supabase: SupabaseClient, assignmentId: string) {
  const { data: assignmentRow, error: lookupError } = await supabase
    .from("project_staff_assignments")
    .select("project_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (!assignmentRow) return { error: "Staff assignment not found." };

  const archivedError = await assertProjectNotArchived(supabase, assignmentRow.project_id);
  if (archivedError) return archivedError;

  const { error } = await supabase
    .from("project_staff_assignments")
    .update({ revoked_at: null })
    .eq("id", assignmentId);
  if (error) return { error: error.message };
  return {};
}

export interface ProjectStaffAssignmentRow {
  id: string;
  projectId: string;
  profileId: string;
  profileName: string;
  staffFunction: StaffFunction | null;
  assignedAt: string;
  assignedBy: string | null;
  assignedByName: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedByName: string | null;
}

/**
 * `project_staff_assignments`' own RLS (project_staff_assignments_admin_manage,
 * schema/016) is `for all` — SELECT included — and admin-only. A
 * non-admin caller (including an org-wide accounting/general staff
 * member, and including a project_manager/superintendent who IS
 * assigned to this exact project) gets zero rows back, not a partial or
 * self-scoped view. Callers must not treat an empty result from this
 * function as "no staff assigned" without first checking the caller's
 * own role — see ProjectTeamWorkspace.tsx / the Task 6 team page, which
 * only call this for an admin session and render an explicit
 * "admin-only" restricted state otherwise, rather than a misleading
 * empty list.
 *
 * Three distinct profile FKs (profile_id, assigned_by, revoked_by) are
 * resolved with ONE batched `profiles` lookup, not a PostgREST embed —
 * same reasoning as listBidQuestions (bidService.ts): an embed can't
 * disambiguate which of several FKs into the same table it should
 * follow, so this codebase's established pattern is a separate,
 * explicit id-batch query instead.
 */
export async function listProjectStaffAssignments(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectStaffAssignmentRow[]> {
  const { data, error } = await supabase
    .from("project_staff_assignments")
    .select("id, project_id, profile_id, assigned_at, assigned_by, revoked_at, revoked_by")
    .eq("project_id", projectId)
    .order("assigned_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

  const profileIds = Array.from(
    new Set(
      rows
        .flatMap((row: any) => [row.profile_id, row.assigned_by, row.revoked_by])
        .filter((id: string | null): id is string => !!id)
    )
  );
  const profilesById = new Map<string, { fullName: string; staffFunction: StaffFunction | null }>();
  if (profileIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, staff_function")
      .in("id", profileIds);
    if (profileError) throw profileError;
    for (const p of profileRows ?? []) {
      profilesById.set(p.id, { fullName: p.full_name, staffFunction: p.staff_function ?? null });
    }
  }

  return rows.map((row: any) => ({
    id: row.id,
    projectId: row.project_id,
    profileId: row.profile_id,
    profileName: profilesById.get(row.profile_id)?.fullName ?? "Unknown",
    staffFunction: profilesById.get(row.profile_id)?.staffFunction ?? null,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
    assignedByName: row.assigned_by ? profilesById.get(row.assigned_by)?.fullName ?? null : null,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revokedByName: row.revoked_by ? profilesById.get(row.revoked_by)?.fullName ?? null : null,
  }));
}

export interface ProjectMemberRow {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  memberRole: "client" | "vendor";
  isPrimary: boolean;
  addedAt: string;
}

/**
 * `project_members` (schema/001) holds client/vendor membership only
 * (`project_members_client_or_vendor_only` CHECK — staff access is
 * entirely through project_staff_assignments/is_org_staff, never this
 * table). RLS: project_members_staff_manage lets any is_org_staff()
 * caller (admin, org-wide accounting/general, or an assigned
 * project_manager/superintendent) read every row for a project they can
 * see; project_members_self_read additionally lets a client/vendor read
 * their own row. No caller of this function today is a client/vendor
 * session, but the function itself doesn't assume otherwise — RLS is
 * still the only filter, same discipline as listAccessibleProjects.
 */
export async function listProjectMembers(supabase: SupabaseClient, projectId: string): Promise<ProjectMemberRow[]> {
  const { data, error } = await supabase
    .from("project_members")
    .select("id, project_id, user_id, member_role, is_primary, added_at")
    .eq("project_id", projectId)
    .order("added_at", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];

  const userIds = Array.from(new Set(rows.map((row: any) => row.user_id).filter((id: string | null): id is string => !!id)));
  const namesById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
    if (profileError) throw profileError;
    for (const p of profileRows ?? []) namesById.set(p.id, p.full_name as string);
  }

  return rows.map((row: any) => ({
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    userName: namesById.get(row.user_id) ?? "Unknown",
    memberRole: row.member_role,
    isPrimary: row.is_primary,
    addedAt: row.added_at,
  }));
}
