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

// Matches schema/018 Step 3's `project_phase` enum exactly (design §5).
export type ProjectPhase = "lead" | "feasibility" | "preconstruction" | "pricing" | "contract_pending" | "ready_to_start";

// Matches schema/018 Step 4's `staff_request_type`/`handoff_priority` enums
// exactly (P3.1 design §8). Duplicated (not imported) from
// projectIntakeService.ts's identical definitions to avoid a circular
// module dependency (projectIntakeService.ts already imports from this
// file) — same "no shared generated-types file yet" convention already
// used for every other enum-backed type in both files.
export type StaffRequestType =
  | "estimating"
  | "planning"
  | "site_review"
  | "permitting"
  | "scheduling"
  | "vendor_pricing"
  | "other";
export type HandoffPriority = "low" | "normal" | "high" | "urgent";

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
  // project_number is server-generated (generate_project_number(),
  // schema/018 — SC-YYYY-### per-org-per-year atomic counter) as of
  // P3.1; the RPC no longer accepts a caller-supplied number at all, so
  // there is no field for it here. See P3.1-DESIGN.md §1.
  address?: string | null;
  projectType?: string | null;
  // Optional as of P3.1 (design §2/§3): a project can be created with
  // pricing entirely undetermined (pricing_model stays NULL, "to be
  // decided later") — the progressive-creation workflow only requires
  // identity/assignment fields up front. When a pricingModel IS
  // supplied, it must still be one of the two fee-supported values (see
  // FEE_SUPPORTED_PRICING_MODELS below) and feeBasis becomes meaningful
  // alongside it; setProjectFeeTerms() below is the new way to fill
  // pricing in later.
  pricingModel?: PricingModel | null;
  pricingModelLabel?: string | null;
  feeBasis?: FeeBasis | null;
  // bigint/integer RPC params map to plain `number`, same convention as
  // every other *_cents field in this package (see budgetService.ts;
  // packages/01-financial-engine/src/types.ts's `Cents = number`).
  feeBasisPoints?: number | null;
  feeFixedAmountCents?: number | null;
  initialStaffProfileIds?: string[];
  initialClientProfileIds?: string[];
}

// project_fee_rules (schema/001) / create_project_with_defaults() (schema/016)
// can only genuinely represent a cost-plus builder fee — a
// percentage-of-cost or a flat dollar amount on top of cost. The other
// four PricingModel values (fixed_price, time_and_materials,
// hybrid_custom, other) have no real fee model backing them yet.
// ProjectListWorkspace.tsx's create form only ever sends one of these
// two through its own <select> (the other four are disabled there —
// P3 owner-preview round 2, Task D2), but that's a UI-layer restriction
// only — nothing here, in the RPC, or in a table CHECK constraint
// independently stops a DIFFERENT caller of this exported function
// (another UI, a script, or — per CLAUDE.md's AI-readiness
// non-negotiable — a future AI tool-calling layer calling this exact
// function) from submitting an unsupported pricingModel with a
// fee_basis attached to it. This function is the one seam every caller
// funnels through, so the guard belongs here, not only in the form.
const FEE_SUPPORTED_PRICING_MODELS: readonly PricingModel[] = ["cost_plus_percentage", "cost_plus_fixed_fee"];

/**
 * Thin wrapper over create_project_with_defaults() (schema/016, revised
 * by schema/018 for P3.1) — an admin-only RPC (enforced inside the
 * function itself via is_org_admin_for_org()) that creates the project
 * row (generating its project_number internally via
 * generate_project_number(), schema/018), conditionally seeds
 * project_fee_rules (only when a fee-supported pricingModel AND feeBasis
 * are both supplied — otherwise the project is created with pricing
 * left undetermined), applies the standard cost-code template, and
 * inserts the initial staff/client assignments, all in one transaction.
 * This function does not re-implement any of that logic; it only maps
 * camelCase params to the RPC's p_-prefixed named args and normalizes
 * the result to this repo's { id } | { error } convention (see
 * bidService.ts's createBidPackage/awardBid for the same shape).
 */
export async function createProject(
  supabase: SupabaseClient,
  params: CreateProjectParams
): Promise<{ id: string } | { error: string }> {
  if (!params.name.trim()) return { error: "Project name is required." };
  // Only applied when a pricingModel is actually supplied (P3.1 design
  // §2/§3) — no pricing model at all is now a valid, non-erroring call
  // (the project is created with pricing_model left NULL, "to be
  // determined"; setProjectFeeTerms() below fills it in later).
  if (params.pricingModel && !FEE_SUPPORTED_PRICING_MODELS.includes(params.pricingModel)) {
    return {
      error: "This pricing model isn't fully supported yet — choose Cost-Plus (% Fee) or Cost-Plus (Fixed Fee), or leave pricing undetermined for now.",
    };
  }

  const { data, error } = await supabase.rpc("create_project_with_defaults", {
    p_org_id: params.orgId,
    p_name: params.name.trim(),
    p_address: params.address ?? null,
    p_project_type: params.projectType ?? null,
    p_pricing_model: params.pricingModel ?? null,
    p_pricing_model_label: params.pricingModelLabel ?? null,
    p_fee_basis: params.feeBasis ?? null,
    p_fee_basis_points: params.feeBasisPoints ?? null,
    p_fee_fixed_amount_cents: params.feeFixedAmountCents ?? null,
    p_initial_staff_profile_ids: params.initialStaffProfileIds ?? [],
    p_initial_client_profile_ids: params.initialClientProfileIds ?? [],
  });
  if (error) {
    // project_number is server-generated as of P3.1 (generate_project_
    // number(), schema/018) — the RPC no longer takes a caller-supplied
    // number, so a projects_number_unique_per_org collision can no
    // longer come from user input at all; it would only ever come from
    // the astronomically-unlikely case of a freshly generated number
    // colliding with a pre-existing legacy one (P3.1-DESIGN.md §1). That
    // is a rare, real bug if it ever happens, not a user-correctable
    // mistake — so, unlike the pre-P3.1 version of this function, the
    // error is no longer rewritten into a friendly "pick a different
    // number" message; it surfaces honestly.
    return { error: error.message };
  }
  return { id: data as string };
}

/**
 * Thin wrapper over set_project_fee_terms() (schema/018, P3.1 §2) — the
 * new capability that makes deferring pricing at creation (above)
 * meaningful. Admin-only, enforced inside the RPC itself via
 * is_org_admin_for_org() (same pattern as createProject()/
 * changeProjectStatus() below), and atomically supersedes the current
 * project_fee_rules row (if any) while updating projects.pricing_model/
 * pricing_model_label together — this function does not re-implement any
 * of that; it only maps params and normalizes the RPC's error, same
 * convention as changeProjectStatus()'s own `/Only an org admin/` rewrite.
 */
export async function setProjectFeeTerms(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    pricingModel: PricingModel;
    feeBasis: FeeBasis;
    feeBasisPoints?: number | null;
    feeFixedAmountCents?: number | null;
    pricingModelLabel?: string | null;
  }
): Promise<{ error: string } | {}> {
  const { error } = await supabase.rpc("set_project_fee_terms", {
    p_project_id: params.projectId,
    p_pricing_model: params.pricingModel,
    p_fee_basis: params.feeBasis,
    p_fee_basis_points: params.feeBasisPoints ?? null,
    p_fee_fixed_amount_cents: params.feeFixedAmountCents ?? null,
    p_pricing_model_label: params.pricingModelLabel ?? null,
  });
  if (error) {
    if (/Only an org admin/.test(error.message)) {
      return { error: "Only an org admin can set a project's pricing/fee terms." };
    }
    // Mirrors the RPC's own FEE_SUPPORTED_PRICING_MODELS-equivalent
    // server-side check (schema/018 Step 9) — set_project_fee_terms()
    // always inserts a project_fee_rules row (unlike createProject()'s
    // conditional insert), so it rejects an unsupported pricing model
    // outright rather than silently skipping.
    if (/only supports cost_plus_percentage or cost_plus_fixed_fee/.test(error.message)) {
      return {
        error: "This pricing model isn't fully supported yet — choose Cost-Plus (% Fee) or Cost-Plus (Fixed Fee).",
      };
    }
    return { error: error.message };
  }
  return {};
}

export interface ProjectFeeTermsRow {
  pricingModel: PricingModel | null;
  pricingModelLabel: string | null;
  feeBasis: FeeBasis | null;
  feeBasisPoints: number | null;
  feeFixedAmountCents: number | null;
}

/**
 * Repository read backing the new Contract & Pricing Terms screen
 * (P3.1 Task 8) — reads `projects.pricing_model`/`pricing_model_label`
 * and the current, non-superseded `project_fee_rules` row (if any) for
 * a project, side by side. Not part of Task 2's original read list (that
 * task scoped project_briefs/project_site_info/contacts/checklist reads
 * only); added here because it belongs next to setProjectFeeTerms()
 * above — same two tables, same "the label and the terms it describes
 * are read together" framing as that function's own write side.
 *
 * Both `pricingModel` and the fee-rule fields can legitimately be null
 * at once (P3.1 design §2/§3 — pricing left "to be determined"), and
 * `pricingModel` can be non-null while the fee-rule fields are still
 * null for a caller whose RLS session can see `projects` but not
 * `project_fee_rules` — see getProjectSetupChecklist's own "KNOWN
 * RLS-VISIBILITY NUANCE" comment (projectIntakeService.ts):
 * `project_fee_rules`' SELECT policy (schema/018 Step 10) is
 * `is_financial_staff(project_id)`, a strict subset of the
 * `is_org_staff(project_id)` policy that governs `projects` itself, so a
 * superintendent session can legitimately see a set `pricingModel` here
 * with every fee-rule field coming back null. That is the correct,
 * RLS-scoped result for this function to return — not a bug to route
 * around with a service-role client.
 */
export async function getProjectFeeTerms(supabase: SupabaseClient, projectId: string): Promise<ProjectFeeTermsRow> {
  const [projectResult, feeRuleResult] = await Promise.all([
    supabase.from("projects").select("pricing_model, pricing_model_label").eq("id", projectId).maybeSingle(),
    supabase
      .from("project_fee_rules")
      .select("fee_basis, fee_basis_points, fee_fixed_amount_cents")
      .eq("project_id", projectId)
      .is("effective_to", null)
      .maybeSingle(),
  ]);
  if (projectResult.error) throw projectResult.error;
  if (feeRuleResult.error) throw feeRuleResult.error;

  return {
    pricingModel: projectResult.data?.pricing_model ?? null,
    pricingModelLabel: projectResult.data?.pricing_model_label ?? null,
    feeBasis: feeRuleResult.data?.fee_basis ?? null,
    feeBasisPoints: feeRuleResult.data?.fee_basis_points ?? null,
    feeFixedAmountCents: feeRuleResult.data?.fee_fixed_amount_cents ?? null,
  };
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
 * every call site below.
 *
 * `action` is a short, caller-supplied description of what was being
 * attempted (e.g. "Team management", "Editing the project brief") and is
 * REQUIRED, not defaulted — this function is now reused across several
 * unrelated write paths (team assignment here, and project_briefs/
 * project_site_info/project_clients/staff-handoff writes in
 * projectIntakeService.ts as of P3.1), so there is no single generic
 * wording that reads correctly everywhere. (Fix round: an earlier
 * version hardcoded "Team management isn't available..." here, which
 * every non-team call site inherited verbatim and incorrectly — a staff
 * member blocked from editing a project's brief saw a message about
 * "team management.")
 */
export async function assertProjectNotArchived(
  supabase: SupabaseClient,
  projectId: string,
  action: string
): Promise<{ error: string } | null> {
  const { data, error } = await supabase.from("projects").select("status").eq("id", projectId).maybeSingle();
  if (error) return { error: error.message };
  // Fail closed: maybeSingle() returns { data: null, error: null } both
  // when the row genuinely doesn't exist AND when RLS filters it out —
  // a missing row must reject, not fall through to "not archived, so
  // allow it". (Not exploitable today, since the write policy's
  // admin-only check and the read policy's unconditional
  // visibility-for-admins mean anyone who could pass the write check
  // can always see the row here too — but this function's own job is
  // to be the security boundary, so it doesn't get to assume that
  // invariant holds forever.)
  if (!data) return { error: "Project not found or not accessible." };
  if (data.status === "archived") {
    return { error: `This project is archived. ${action} isn't available for archived projects.` };
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
  const archivedError = await assertProjectNotArchived(supabase, projectId, "Team management");
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

  const archivedError = await assertProjectNotArchived(supabase, assignmentRow.project_id, "Team management");
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

  const archivedError = await assertProjectNotArchived(supabase, assignmentRow.project_id, "Team management");
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
  // Handoff fields (schema/018 Step 4, P3.1 design §8) — admin-editable
  // via updateStaffAssignmentHandoff() (projectIntakeService.ts). Included
  // here (not just on a separate narrower type) so ProjectTeamWorkspace.tsx
  // can render/edit them inline per row from this same list, matching how
  // the rest of this row's fields already arrive from one query.
  requestedWork: StaffRequestType | null;
  priority: HandoffPriority;
  targetDueDate: string | null;
  nextAction: string | null;
  internalInstructions: string | null;
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
    .select(
      "id, project_id, profile_id, assigned_at, assigned_by, revoked_at, revoked_by, requested_work, priority, target_due_date, next_action, internal_instructions"
    )
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
    requestedWork: row.requested_work ?? null,
    priority: row.priority,
    targetDueDate: row.target_due_date ?? null,
    nextAction: row.next_action ?? null,
    internalInstructions: row.internal_instructions ?? null,
  }));
}

/**
 * Thin wrapper over change_project_status() (schema/017 —
 * P3 owner-preview round 2, Task D1). The RPC is admin-only (enforced
 * inside the function itself via is_org_admin_for_org() on the
 * project's own org, same pattern as create_project_with_defaults())
 * and delegates every transition-validity decision to
 * enforce_project_status_transition() (schema/008, widened by
 * schema/017) — this function does not duplicate that logic, it only
 * normalizes the RPC's raw error into this repo's { error: string }
 * convention, same as createProject/assignStaffToProject above.
 *
 * Deliberately does NOT call assertProjectNotArchived() first — unlike
 * assignStaffToProject/revokeStaffAssignment/reactivateStaffAssignment,
 * an archived project is exactly one of the valid states this function
 * needs to transition INTO and OUT OF (active -> archived,
 * archived -> active, archived -> closed_out), so "reject when the
 * project is currently archived" would break this function's own
 * purpose. The trigger's transition matrix is the only gate.
 */
export async function changeProjectStatus(
  supabase: SupabaseClient,
  projectId: string,
  newStatus: ProjectStatus
): Promise<{ error: string } | {}> {
  const { error } = await supabase.rpc("change_project_status", {
    p_project_id: projectId,
    p_new_status: newStatus,
  });
  if (error) {
    // MAINTENANCE NOTE (Minor finding, FIX ROUND 1 review): both regexes
    // match against raw `raise exception` text — the first from
    // enforce_project_status_transition()'s transition-validity check
    // (the actual source of most rejections post-FIX-ROUND-1, since
    // that trigger now runs on every write path, not just this RPC's),
    // the second from either that same trigger's admin check or this
    // RPC's own friendly pre-check (both raise the identical string,
    // by design). Brittle: if schema/017's wording ever changes, these
    // silently stop matching and the caller falls through to the raw
    // Postgres error instead. Keep these two strings in sync with
    // schema/017_project_status_reversible_lifecycle.sql's actual
    // `raise exception` text if either is ever reworded.
    if (/Invalid project status transition/.test(error.message)) {
      return { error: `That status change isn't allowed from the project's current status.` };
    }
    if (/Only an org admin/.test(error.message)) {
      return { error: "Only an org admin can change a project's status." };
    }
    return { error: error.message };
  }
  return {};
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

// =====================================================================
// projects.phase / start_date / target_completion_date (P3.1 Task 5 gap
// closure). P3.1-DESIGN.md §5 says the Concept & Scope screen's "phase"
// and "desired start/completion timing" fields are NOT new columns on
// project_briefs — they reuse projects.phase (schema/018 Step 3's new
// project_phase enum) and projects.start_date/target_completion_date
// directly. Neither projectService.ts nor projectIntakeService.ts had
// any function touching these three columns before this addition (Task
// 2's brief scoped the intake service to project_briefs/project_site_info/
// project_clients/staff-handoff only; the design doc's own §5 prose
// promised the reuse but nothing in the service layer ever implemented
// the write path for it) — confirmed by grep, not assumed. Kept here in
// projectService.ts, not projectIntakeService.ts, because `projects`
// itself (not an intake table) is this file's existing domain, and
// assertProjectNotArchived()/the RLS reality below are already this
// file's own concerns.
//
// RLS reality (schema/017's projects_staff_update, unchanged by this
// addition): USING is_financial_staff(id) — any non-superintendent
// staff, not admin-only, same population that can already edit
// gmp_amount_cents/pricing_model directly on this table. A plain column
// UPDATE (not an RPC) is used here, matching this table's own existing
// write pattern (changeProjectStatus() is the one exception, and only
// because status transitions have dedicated trigger-enforced validity
// logic that phase/dates do not).
// =====================================================================

export interface ProjectPhaseAndTimingRow {
  phase: ProjectPhase | null;
  startDate: string | null; // date, "YYYY-MM-DD"
  targetCompletionDate: string | null; // date, "YYYY-MM-DD"
}

export interface ProjectPhaseAndTimingWriteFields {
  phase?: ProjectPhase | null;
  startDate?: string | null;
  targetCompletionDate?: string | null;
}

/** Narrow, dedicated read — deliberately not folded into ProjectRow/
 *  PROJECT_COLUMNS above (used by listAccessibleProjects, which backs
 *  the project switcher and list screens across the whole app); adding
 *  these three columns there would widen every existing caller's
 *  payload for a need only this one form has. Same "read exactly what
 *  the screen needs" discipline as team/page.tsx's own dedicated
 *  profiles query. */
export async function getProjectPhaseAndTiming(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectPhaseAndTimingRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("phase, start_date, target_completion_date")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    phase: data.phase,
    startDate: data.start_date,
    targetCompletionDate: data.target_completion_date,
  };
}

/**
 * Partial write (only the supplied fields are included in the UPDATE
 * payload — `undefined` means "don't touch," explicit `null` means
 * "clear this field," same convention as projectIntakeService.ts's
 * pickDefined()/upsertProjectBrief()). Guarded by
 * assertProjectNotArchived() — same P3-DESIGN.md Decision 9 precedent as
 * every other project-scoped write in this file and in
 * projectIntakeService.ts; projects_staff_update's RLS does not itself
 * check status.
 */
export async function updateProjectPhaseAndTiming(
  supabase: SupabaseClient,
  projectId: string,
  fields: ProjectPhaseAndTimingWriteFields
): Promise<{} | { error: string }> {
  const archivedError = await assertProjectNotArchived(supabase, projectId, "Editing project phase and timing");
  if (archivedError) return archivedError;

  const row: Record<string, unknown> = {};
  if (fields.phase !== undefined) row.phase = fields.phase;
  if (fields.startDate !== undefined) row.start_date = fields.startDate;
  if (fields.targetCompletionDate !== undefined) row.target_completion_date = fields.targetCompletionDate;

  if (Object.keys(row).length === 0) return {};

  const { error } = await supabase.from("projects").update(row).eq("id", projectId);
  if (error) return { error: error.message };
  return {};
}
