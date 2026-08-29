import type { SupabaseClient } from "@supabase/supabase-js";
import { assertProjectNotArchived } from "./projectService";

// =====================================================================
// P3.1 — Project Intake & Employee Handoff service/repository layer.
// See docs/production-build/P3.1-DESIGN.md §§4-6, 8-9 and schema/018 for
// the tables/enums/RPCs this file wraps. Follows projectService.ts's own
// existing convention exactly: plain exported async functions (no
// class), reads and writes side by side in one file, every query scoped
// through the CALLER's own Supabase client (RLS is the only access
// filter — never a service-role client), errors normalized to this
// repo's `{ id } | { error } }` / `{} | { error } }` shape for writes and
// thrown for reads (matching listAccessibleProjects/listProjectStaffAssignments/
// listProjectMembers in projectService.ts).
// =====================================================================

// Matches schema/018's new enums exactly (see the migration's Step 5/7/4).
export type ContactRole = "primary_homeowner" | "secondary_homeowner" | "other_household" | "professional_contact";
export type ContactMethod = "email" | "phone" | "text";
export type ContactInfoStatus = "not_started" | "requested" | "partial" | "complete";
export type IntakeItemStatus = "unknown" | "requested" | "received" | "not_applicable" | "complete";
export type StaffRequestType =
  | "estimating"
  | "planning"
  | "site_review"
  | "permitting"
  | "scheduling"
  | "vendor_pricing"
  | "other";
export type HandoffPriority = "low" | "normal" | "high" | "urgent";

// ---------------------------------------------------------------------
// project_briefs (schema/018 Step 6) — 1:1 with projects.
// ---------------------------------------------------------------------

export interface ProjectBriefWriteFields {
  summary?: string | null;
  knownScope?: string | null;
  clientGoals?: string | null;
  mustHaves?: string | null;
  wishlistItems?: string | null;
  knownExclusions?: string | null;
  qualityExpectations?: string | null;
  approxSquareFootage?: number | null;
  stories?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  targetBudgetLowCents?: number | null;
  targetBudgetHighCents?: number | null;
  confidenceNote?: string | null;
  leadSource?: string | null;
  internalNotes?: string | null;
  clientFacingNotes?: string | null;
  clientFacingNotesPublished?: boolean;
}

// The full, staff-visible shape. NOTE: getProjectBriefForClient() below
// returns a DIFFERENT, narrower type (ProjectBriefClientSafe) that has
// no internalNotes property at all — see that function's own comment for
// why this split is a hard requirement, not a style choice.
export interface ProjectBriefRow extends ProjectBriefWriteFields {
  projectId: string;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

export type ProjectBriefClientSafeRow = Omit<ProjectBriefRow, "internalNotes">;

/** Removes keys whose value is `undefined` (but keeps explicit `null`s) —
 *  used so a caller submitting only one section of a form doesn't blow
 *  away every other section's already-saved data via upsert(). `null`
 *  means "clear this field," `undefined` means "don't touch it." */
function pickDefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function briefFieldsToRow(fields: ProjectBriefWriteFields) {
  return pickDefined({
    summary: fields.summary,
    known_scope: fields.knownScope,
    client_goals: fields.clientGoals,
    must_haves: fields.mustHaves,
    wishlist_items: fields.wishlistItems,
    known_exclusions: fields.knownExclusions,
    quality_expectations: fields.qualityExpectations,
    approx_square_footage: fields.approxSquareFootage,
    stories: fields.stories,
    bedrooms: fields.bedrooms,
    bathrooms: fields.bathrooms,
    target_budget_low_cents: fields.targetBudgetLowCents,
    target_budget_high_cents: fields.targetBudgetHighCents,
    confidence_note: fields.confidenceNote,
    lead_source: fields.leadSource,
    internal_notes: fields.internalNotes,
    client_facing_notes: fields.clientFacingNotes,
    client_facing_notes_published: fields.clientFacingNotesPublished,
  });
}

function mapBriefRow(row: any): ProjectBriefRow {
  return {
    projectId: row.project_id,
    summary: row.summary,
    knownScope: row.known_scope,
    clientGoals: row.client_goals,
    mustHaves: row.must_haves,
    wishlistItems: row.wishlist_items,
    knownExclusions: row.known_exclusions,
    qualityExpectations: row.quality_expectations,
    approxSquareFootage: row.approx_square_footage,
    stories: row.stories,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    targetBudgetLowCents: row.target_budget_low_cents,
    targetBudgetHighCents: row.target_budget_high_cents,
    confidenceNote: row.confidence_note,
    leadSource: row.lead_source,
    internalNotes: row.internal_notes,
    clientFacingNotes: row.client_facing_notes,
    clientFacingNotesPublished: row.client_facing_notes_published,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/**
 * Insert-or-update the single project_briefs row for this project
 * (project_id is the primary key — schema/018 Step 6). Only the fields
 * actually supplied are written (see pickDefined()); PostgREST's
 * upsert() only SETs the columns present in the payload on conflict, so
 * omitted fields keep whatever value they already had — a caller that
 * only owns one section of the Setup screen (e.g. just square footage)
 * cannot accidentally null out narrative fields it never touched.
 *
 * Guarded by assertProjectNotArchived() (projectService.ts) — same
 * P3-DESIGN.md Decision 9 precedent already applied to
 * assignStaffToProject/revokeStaffAssignment/reactivateStaffAssignment:
 * project_briefs_staff_full's RLS (is_org_staff(project_id)) does not
 * itself check the project's status, so a stale tab pointed at a
 * since-archived project must not be able to mutate its brief either.
 */
export async function upsertProjectBrief(
  supabase: SupabaseClient,
  projectId: string,
  fields: ProjectBriefWriteFields
): Promise<{} | { error: string }> {
  const archivedError = await assertProjectNotArchived(supabase, projectId, "Editing the project brief");
  if (archivedError) return archivedError;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("project_briefs").upsert(
    {
      project_id: projectId,
      ...briefFieldsToRow(fields),
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );
  if (error) return { error: error.message };
  return {};
}

/**
 * Full-column read for a STAFF session. Every column, including
 * internal_notes. Never call this to build a response a client-role
 * session might see — use getProjectBriefForClient() below for that.
 */
export async function getProjectBriefForStaff(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectBriefRow | null> {
  const { data, error } = await supabase
    .from("project_briefs")
    .select(
      "project_id, summary, known_scope, client_goals, must_haves, wishlist_items, known_exclusions, quality_expectations, approx_square_footage, stories, bedrooms, bathrooms, target_budget_low_cents, target_budget_high_cents, confidence_note, lead_source, internal_notes, client_facing_notes, client_facing_notes_published, updated_by, updated_at, created_at"
    )
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapBriefRow(data) : null;
}

/**
 * Client-safe read. HARD REQUIREMENT (P3.1-DESIGN.md §5, flagged by the
 * design's own independent review as something to verify carefully):
 * `internal_notes` must be omitted from the SELECTED COLUMNS entirely,
 * not merely filtered out of the mapped object afterward — the literal
 * string "internal_notes" does not appear anywhere in this function's
 * select list, by construction, so there is no code path in which a raw
 * row containing it ever leaves the database for this function's caller.
 *
 * Also enforces the "status AND explicit visibility flag" non-negotiable
 * (CLAUDE.md) for client_facing_notes: the column is only surfaced when
 * client_facing_notes_published is true; otherwise it comes back null,
 * even though client_facing_notes_published itself is selected (it has
 * to be, to make that decision) — the flag is not internal_notes and is
 * safe to expose either way.
 *
 * NOTE: as of schema/018, project_briefs has NO client-read RLS policy
 * at all yet (P3.1-DESIGN.md §5's own note — that's deliberately a
 * repository-layer concern for this task, not an RLS concern for the
 * schema migration), so a client-role session calling this today gets
 * zero rows regardless of column selection. This function exists so the
 * column-omission contract is already correct the moment a client-read
 * RLS policy is added, without a repository change at that point.
 */
export async function getProjectBriefForClient(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectBriefClientSafeRow | null> {
  const { data, error } = await supabase
    .from("project_briefs")
    .select(
      "project_id, summary, known_scope, client_goals, must_haves, wishlist_items, known_exclusions, quality_expectations, approx_square_footage, stories, bedrooms, bathrooms, target_budget_low_cents, target_budget_high_cents, confidence_note, lead_source, client_facing_notes, client_facing_notes_published, updated_by, updated_at, created_at"
    )
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    projectId: data.project_id,
    summary: data.summary,
    knownScope: data.known_scope,
    clientGoals: data.client_goals,
    mustHaves: data.must_haves,
    wishlistItems: data.wishlist_items,
    knownExclusions: data.known_exclusions,
    qualityExpectations: data.quality_expectations,
    approxSquareFootage: data.approx_square_footage,
    stories: data.stories,
    bedrooms: data.bedrooms,
    bathrooms: data.bathrooms,
    targetBudgetLowCents: data.target_budget_low_cents,
    targetBudgetHighCents: data.target_budget_high_cents,
    confidenceNote: data.confidence_note,
    leadSource: data.lead_source,
    // Gated on the published flag (CLAUDE.md's "status AND explicit
    // visibility flag" non-negotiable — same pattern as
    // documents.is_published_to_client) — the raw column is selected
    // above (it has to be, to make this decision) but only surfaced here
    // when true.
    clientFacingNotes: data.client_facing_notes_published ? data.client_facing_notes : null,
    clientFacingNotesPublished: data.client_facing_notes_published,
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
    createdAt: data.created_at,
  };
}

// ---------------------------------------------------------------------
// project_site_info (schema/018 Step 7) — 1:1 with projects. No
// client-read policy at all (internal working information — P3.1-DESIGN.md
// §6), so there is deliberately only ONE read function here, not a
// staff/client pair — a client session gets zero rows from RLS alone,
// and there is no internal_notes-style column to additionally hide.
// ---------------------------------------------------------------------

export interface ProjectSiteInfoWriteFields {
  fullAddress?: string | null;
  parcelId?: string | null;
  ownershipStatus?: string | null;
  occupiedDuringWork?: boolean | null;
  permittingJurisdiction?: string | null;
  hoaReviewRequired?: boolean | null;
  hoaStatus?: IntakeItemStatus;
  zoningNotes?: string | null;
  surveyStatus?: IntakeItemStatus;
  architecturalPlansStatus?: IntakeItemStatus;
  septicOrSewer?: string | null;
  waterSource?: string | null;
  utilitiesAvailable?: string | null;
  soilEnvironmentalStatus?: IntakeItemStatus;
  soilEnvironmentalNotes?: string | null;
  siteAccessNotes?: string | null;
  financingStatus?: IntakeItemStatus;
  permitStatus?: IntakeItemStatus;
  requiredApprovalsNotes?: string | null;
}

export interface ProjectSiteInfoRow extends ProjectSiteInfoWriteFields {
  projectId: string;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

function siteInfoFieldsToRow(fields: ProjectSiteInfoWriteFields) {
  return pickDefined({
    full_address: fields.fullAddress,
    parcel_id: fields.parcelId,
    ownership_status: fields.ownershipStatus,
    occupied_during_work: fields.occupiedDuringWork,
    permitting_jurisdiction: fields.permittingJurisdiction,
    hoa_review_required: fields.hoaReviewRequired,
    hoa_status: fields.hoaStatus,
    zoning_notes: fields.zoningNotes,
    survey_status: fields.surveyStatus,
    architectural_plans_status: fields.architecturalPlansStatus,
    septic_or_sewer: fields.septicOrSewer,
    water_source: fields.waterSource,
    utilities_available: fields.utilitiesAvailable,
    soil_environmental_status: fields.soilEnvironmentalStatus,
    soil_environmental_notes: fields.soilEnvironmentalNotes,
    site_access_notes: fields.siteAccessNotes,
    financing_status: fields.financingStatus,
    permit_status: fields.permitStatus,
    required_approvals_notes: fields.requiredApprovalsNotes,
  });
}

function mapSiteInfoRow(row: any): ProjectSiteInfoRow {
  return {
    projectId: row.project_id,
    fullAddress: row.full_address,
    parcelId: row.parcel_id,
    ownershipStatus: row.ownership_status,
    occupiedDuringWork: row.occupied_during_work,
    permittingJurisdiction: row.permitting_jurisdiction,
    hoaReviewRequired: row.hoa_review_required,
    hoaStatus: row.hoa_status,
    zoningNotes: row.zoning_notes,
    surveyStatus: row.survey_status,
    architecturalPlansStatus: row.architectural_plans_status,
    septicOrSewer: row.septic_or_sewer,
    waterSource: row.water_source,
    utilitiesAvailable: row.utilities_available,
    soilEnvironmentalStatus: row.soil_environmental_status,
    soilEnvironmentalNotes: row.soil_environmental_notes,
    siteAccessNotes: row.site_access_notes,
    financingStatus: row.financing_status,
    permitStatus: row.permit_status,
    requiredApprovalsNotes: row.required_approvals_notes,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/** Same insert-or-update / partial-write / archived-guard shape as
 *  upsertProjectBrief() above — see that function's comment for the
 *  reasoning, unchanged here. */
export async function upsertProjectSiteInfo(
  supabase: SupabaseClient,
  projectId: string,
  fields: ProjectSiteInfoWriteFields
): Promise<{} | { error: string }> {
  const archivedError = await assertProjectNotArchived(supabase, projectId, "Editing property & site info");
  if (archivedError) return archivedError;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("project_site_info").upsert(
    {
      project_id: projectId,
      ...siteInfoFieldsToRow(fields),
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );
  if (error) return { error: error.message };
  return {};
}

export async function getProjectSiteInfo(supabase: SupabaseClient, projectId: string): Promise<ProjectSiteInfoRow | null> {
  const { data, error } = await supabase
    .from("project_site_info")
    .select(
      "project_id, full_address, parcel_id, ownership_status, occupied_during_work, permitting_jurisdiction, hoa_review_required, hoa_status, zoning_notes, survey_status, architectural_plans_status, septic_or_sewer, water_source, utilities_available, soil_environmental_status, soil_environmental_notes, site_access_notes, financing_status, permit_status, required_approvals_notes, updated_by, updated_at, created_at"
    )
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSiteInfoRow(data) : null;
}

// ---------------------------------------------------------------------
// project_clients (schema/012, extended by schema/018 Step 5).
// ---------------------------------------------------------------------

export interface ProjectContactInput {
  // Present (and truthy) => update that existing row. Absent/null =>
  // insert a new row. One form serves both "add" and "edit" (P3.1-DESIGN.md
  // §4's explicit "one form, two entry points" instruction) by branching
  // on this field, not by having two separate functions.
  id?: string | null;
  fullName: string;
  preferredName?: string | null;
  role?: ContactRole | null;
  email?: string | null;
  phone?: string | null;
  preferredContactMethod?: ContactMethod | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  isPrimary?: boolean;
  isDecisionMaker?: boolean;
  isBillingContact?: boolean;
  infoStatus?: ContactInfoStatus;
}

export interface ProjectContactRow {
  id: string;
  projectId: string;
  fullName: string;
  preferredName: string | null;
  role: ContactRole | null;
  email: string | null;
  phone: string | null;
  preferredContactMethod: ContactMethod | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  isPrimary: boolean;
  isDecisionMaker: boolean;
  isBillingContact: boolean;
  infoStatus: ContactInfoStatus;
  createdBy: string | null;
  createdAt: string;
}

function mapContactRow(row: any): ProjectContactRow {
  return {
    id: row.id,
    projectId: row.project_id,
    fullName: row.full_name,
    preferredName: row.preferred_name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    preferredContactMethod: row.preferred_contact_method,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    isPrimary: row.is_primary,
    isDecisionMaker: row.is_decision_maker,
    isBillingContact: row.is_billing_contact,
    infoStatus: row.info_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const CONTACT_COLUMNS =
  "id, project_id, full_name, preferred_name, role, email, phone, preferred_contact_method, address, city, state, zip, is_primary, is_decision_maker, is_billing_contact, info_status, created_by, created_at";

/**
 * Insert-or-update a single project_clients row (schema/012, extended by
 * schema/018). `is_decision_maker` is informational only (P3.1-DESIGN.md
 * §4 — "confers no approval authority ... not a substitute for the real
 * project_decision_makers model P7 builds"); this function doesn't
 * enforce or interpret it beyond storing the flag.
 *
 * Guarded by assertProjectNotArchived() — same P3-DESIGN.md Decision 9
 * precedent as upsertProjectBrief()/upsertProjectSiteInfo() above;
 * project_clients_staff_full's RLS is also is_org_staff(project_id)-based
 * and does not check project status itself.
 */
export async function upsertProjectContact(
  supabase: SupabaseClient,
  projectId: string,
  contact: ProjectContactInput
): Promise<{ id: string } | { error: string }> {
  if (!contact.fullName.trim()) return { error: "Contact name is required." };

  const archivedError = await assertProjectNotArchived(supabase, projectId, "Editing project contacts");
  if (archivedError) return archivedError;

  const row = pickDefined({
    full_name: contact.fullName.trim(),
    preferred_name: contact.preferredName,
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
    preferred_contact_method: contact.preferredContactMethod,
    address: contact.address,
    city: contact.city,
    state: contact.state,
    zip: contact.zip,
    is_primary: contact.isPrimary,
    is_decision_maker: contact.isDecisionMaker,
    is_billing_contact: contact.isBillingContact,
    info_status: contact.infoStatus,
  });

  if (contact.id) {
    // Scoped by BOTH id and project_id — not strictly required for RLS
    // (project_clients_staff_full already restricts visibility to the
    // caller's own org), but this stops a caller from passing a real
    // contact id that belongs to a DIFFERENT project than the one it
    // claims to be editing from silently succeeding against the wrong
    // project's row.
    const { data, error } = await supabase
      .from("project_clients")
      .update(row)
      .eq("id", contact.id)
      .eq("project_id", projectId)
      .select("id")
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Contact not found for this project." };
    return { id: data.id };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("project_clients")
    .insert({ project_id: projectId, ...row, created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

/**
 * Ordered primary-first (is_primary desc), then oldest-added-first —
 * a stable, predictable order for a list that's usually short (a
 * handful of contacts per project). RLS (project_clients_staff_full /
 * _client_read, schema/012) is the only access filter, same discipline
 * as every other list* function in projectService.ts — a client session
 * calling this legitimately gets its own project's rows back (unlike
 * project_briefs/project_site_info, project_clients already has a real
 * client-read policy), and no column here needs additional hiding for
 * that session (no internal_notes-equivalent column on this table).
 */
export async function listProjectContacts(supabase: SupabaseClient, projectId: string): Promise<ProjectContactRow[]> {
  const { data, error } = await supabase
    .from("project_clients")
    .select(CONTACT_COLUMNS)
    .eq("project_id", projectId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapContactRow);
}

// ---------------------------------------------------------------------
// project_staff_assignments handoff columns (schema/018 Step 4).
// ---------------------------------------------------------------------

export interface StaffAssignmentHandoffFields {
  requestedWork?: StaffRequestType | null;
  priority?: HandoffPriority;
  targetDueDate?: string | null; // date, "YYYY-MM-DD"
  nextAction?: string | null;
  internalInstructions?: string | null;
}

/**
 * Updates only the new handoff columns on an EXISTING project_staff_
 * assignments row — this is not assignStaffToProject() (which creates
 * the row); it edits the handoff note on one already in place. Same
 * project_id-resolution + assertProjectNotArchived() shape as
 * revokeStaffAssignment()/reactivateStaffAssignment() in projectService.ts
 * (this function only receives assignmentId, so project_id has to be
 * looked up before the archived check can run) — deliberately reused
 * here rather than duplicated, since the underlying table, RLS policy
 * (project_staff_assignments_admin_manage, admin-only), and archived-
 * project concern are all identical to those two functions.
 */
export async function updateStaffAssignmentHandoff(
  supabase: SupabaseClient,
  assignmentId: string,
  fields: StaffAssignmentHandoffFields
): Promise<{} | { error: string }> {
  const { data: assignmentRow, error: lookupError } = await supabase
    .from("project_staff_assignments")
    .select("project_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (!assignmentRow) return { error: "Staff assignment not found." };

  const archivedError = await assertProjectNotArchived(supabase, assignmentRow.project_id, "Editing staff handoff notes");
  if (archivedError) return archivedError;

  const row = pickDefined({
    requested_work: fields.requestedWork,
    priority: fields.priority,
    target_due_date: fields.targetDueDate,
    next_action: fields.nextAction,
    internal_instructions: fields.internalInstructions,
  });

  const { error } = await supabase.from("project_staff_assignments").update(row).eq("id", assignmentId);
  if (error) return { error: error.message };
  return {};
}

// ---------------------------------------------------------------------
// "Your assignment" (Overview card, P3.1 design §8, Task 9) — the
// CALLING SESSION's own active project_staff_assignments row.
//
// Relies on schema/019's new project_staff_assignments_self_select RLS
// policy (`profile_id = auth.uid()`), added during this task specifically
// because project_staff_assignments_admin_manage (schema/016) is
// admin-only for SELECT too — without schema/019, a non-admin staff
// session (project_manager/superintendent/accounting/general, the actual
// audience of a handoff note) got zero rows back from any query against
// this table, including one scoped to their own profile_id. See
// schema/019's own header comment for the full finding.
//
// "Active" (not just "exists") is enforced here at the application
// layer, not via RLS — the self-select policy deliberately also allows
// reading a REVOKED row (a caller's own historical record is not a
// security concern), so this function's own `.is("revoked_at", null)`
// filter is what makes "active assignment" the actual contract callers
// get, matching design §8's "for any staff session with an ACTIVE
// assignment" language.
// ---------------------------------------------------------------------

export interface MyStaffAssignmentSummary {
  id: string;
  requestedWork: StaffRequestType | null;
  priority: HandoffPriority;
  targetDueDate: string | null;
  nextAction: string | null;
  internalInstructions: string | null;
  assignedAt: string;
}

export async function getMyActiveAssignmentForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<MyStaffAssignmentSummary | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("project_staff_assignments")
    .select("id, requested_work, priority, target_due_date, next_action, internal_instructions, assigned_at")
    .eq("project_id", projectId)
    .eq("profile_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    requestedWork: data.requested_work,
    priority: data.priority,
    targetDueDate: data.target_due_date,
    nextAction: data.next_action,
    internalInstructions: data.internal_instructions,
    assignedAt: data.assigned_at,
  };
}

// =====================================================================
// Setup checklist — derived status (P3.1-DESIGN.md §9). Every item's
// status is computed here, from real data, at read time — never a
// separately stored flag that can drift out of sync (design §9's own
// framing, matching the existing "no screen computes its own financial
// numbers, everything routes through a real read" discipline applied to
// checklist state instead).
//
// Three kinds of item state, not just three statuses — this is the part
// design §9 and the Task 2 brief both flag as easy to get subtly wrong:
//   - "derived": a real status (not_started/in_progress/complete)
//     computed from this package's own data. 7 of the 11 items are this
//     kind (project identity always "complete"; homeowners, concept &
//     scope, property & site info, staff, permitting, contract & pricing
//     terms are genuinely computed).
//   - "available": a REAL, already-built, clickable feature (P4's
//     estimating screen) that this package does not compute a status
//     for — it has no project_briefs/project_site_info-style
//     completeness signal of its own within this package's scope. This
//     is deliberately NOT the same as "coming_later": the link must
//     render clickable, not inert.
//   - "coming_later": genuinely not a real feature yet (plans &
//     documents, QuickBooks connection, schedule) — no data source
//     exists anywhere, the UI renders these inert (no href/onClick),
//     matching the pattern already used for P3's placeholder items.
// =====================================================================

export type ChecklistDerivedStatus = "not_started" | "in_progress" | "complete";

export type ChecklistItemState =
  | { kind: "derived"; status: ChecklistDerivedStatus }
  | { kind: "available" }
  | { kind: "coming_later" };

export interface ProjectSetupChecklist {
  projectIdentity: ChecklistItemState;
  homeownersDecisionMakers: ChecklistItemState;
  conceptScope: ChecklistItemState;
  propertySiteInfo: ChecklistItemState;
  plansDocuments: ChecklistItemState;
  staffResponsibilities: ChecklistItemState;
  preliminaryEstimating: ChecklistItemState;
  permitting: ChecklistItemState;
  quickbooksConnection: ChecklistItemState;
  contractPricingTerms: ChecklistItemState;
  schedule: ChecklistItemState;
}

function deriveContactsStatus(rows: { infoStatus: ContactInfoStatus }[]): ChecklistDerivedStatus {
  if (rows.length === 0) return "not_started";
  return rows.every((r) => r.infoStatus === "complete") ? "complete" : "in_progress";
}

// Deliberately excludes internal_notes/client_facing_notes(_published)
// from the completeness signal — those are supplementary communication
// fields, not "what does staff know about this project yet" intake
// content, which is what this checklist item is meant to track (design
// §9: "Derived from project_briefs field completeness").
const BRIEF_COMPLETENESS_FIELDS: (keyof ProjectBriefRow)[] = [
  "summary",
  "knownScope",
  "clientGoals",
  "mustHaves",
  "wishlistItems",
  "knownExclusions",
  "qualityExpectations",
  "approxSquareFootage",
  "stories",
  "bedrooms",
  "bathrooms",
  "targetBudgetLowCents",
  "targetBudgetHighCents",
  "confidenceNote",
  "leadSource",
];

function isFieldFilled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function deriveBriefStatus(row: ProjectBriefRow | null): ChecklistDerivedStatus {
  if (!row) return "not_started";
  const filledCount = BRIEF_COMPLETENESS_FIELDS.filter((f) => isFieldFilled(row[f])).length;
  if (filledCount === 0) return "not_started";
  if (filledCount === BRIEF_COMPLETENESS_FIELDS.length) return "complete";
  return "in_progress";
}

// The six intake_item_status-typed "genuine in-progress process" fields
// (design §6) — this is the meaningful completeness signal for site
// info: every process resolved (not left 'unknown') = complete. The
// plain fact columns (parcel id, zoning notes, etc.) are legitimately
// optional free text that may never apply to a given project, so they
// are intentionally NOT required for "complete" here — only used to
// distinguish not_started from in_progress when no process field has
// moved yet either.
const SITE_INFO_STATUS_FIELDS: (keyof ProjectSiteInfoRow)[] = [
  "hoaStatus",
  "surveyStatus",
  "architecturalPlansStatus",
  "soilEnvironmentalStatus",
  "financingStatus",
  "permitStatus",
];
const SITE_INFO_PLAIN_FIELDS: (keyof ProjectSiteInfoRow)[] = [
  "fullAddress",
  "parcelId",
  "ownershipStatus",
  "occupiedDuringWork",
  "permittingJurisdiction",
  "hoaReviewRequired",
  "zoningNotes",
  "septicOrSewer",
  "waterSource",
  "utilitiesAvailable",
  "soilEnvironmentalNotes",
  "siteAccessNotes",
  "requiredApprovalsNotes",
];

function deriveSiteInfoStatus(row: ProjectSiteInfoRow | null): ChecklistDerivedStatus {
  if (!row) return "not_started";
  const anyStatusAdvanced = SITE_INFO_STATUS_FIELDS.some((f) => row[f] !== "unknown");
  const anyPlainFilled = SITE_INFO_PLAIN_FIELDS.some((f) => isFieldFilled(row[f]));
  if (!anyStatusAdvanced && !anyPlainFilled) return "not_started";
  const allStatusResolved = SITE_INFO_STATUS_FIELDS.every((f) => row[f] !== "unknown");
  return allStatusResolved ? "complete" : "in_progress";
}

/**
 * "Permitting" (design §9 row 8) reuses project_site_info's own data —
 * "links into the site-info section's permitting group" — restricted to
 * just the permitting-related subset (permitting_jurisdiction,
 * hoa_review_required, hoa_status, permit_status). required_approvals_notes
 * is deliberately excluded from the completeness check itself (a free
 * notes field that may legitimately stay blank) even though it's part of
 * the same "permitting group" conceptually.
 */
function derivePermittingStatus(row: ProjectSiteInfoRow | null): ChecklistDerivedStatus {
  if (!row) return "not_started";
  const jurisdictionSet = isFieldFilled(row.permittingJurisdiction);
  const hoaReviewSet = row.hoaReviewRequired !== null && row.hoaReviewRequired !== undefined;
  const hoaResolved = row.hoaStatus !== "unknown";
  const permitResolved = row.permitStatus !== "unknown";
  if (!jurisdictionSet && !hoaReviewSet && !hoaResolved && !permitResolved) return "not_started";
  if (jurisdictionSet && hoaReviewSet && hoaResolved && permitResolved) return "complete";
  return "in_progress";
}

function deriveStaffStatus(rows: { revokedAt: string | null }[]): ChecklistDerivedStatus {
  if (rows.length === 0) return "not_started";
  return rows.some((r) => r.revokedAt === null) ? "complete" : "in_progress";
}

function deriveContractPricingStatus(pricingModel: string | null, hasActiveFeeRule: boolean): ChecklistDerivedStatus {
  if (!pricingModel) return "not_started";
  return hasActiveFeeRule ? "complete" : "in_progress";
}

/**
 * Computes all 11 checklist items in one call (design §9's table, row by
 * row) — a Server Component calls this once to render the whole Setup
 * checklist. Runs its underlying reads concurrently (Promise.all); each
 * one is scoped through the caller's own RLS-scoped client.
 *
 * KNOWN RLS-VISIBILITY NUANCE, not a bug in this function:
 * project_fee_rules' SELECT policy (schema/018 Step 10) is
 * is_financial_staff(project_id) — is_org_staff() MINUS superintendents.
 * A superintendent session that can see projects.pricing_model (via
 * projects_staff_select, plain is_org_staff) but cannot see the
 * project_fee_rules row will see "Contract & pricing terms" reported as
 * in_progress even when an admin session would see it as complete. This
 * is the correct behavior for an RLS-scoped read (this function never
 * uses a service-role client, per TARGET-ARCHITECTURE.md §5.2), not
 * something to route around here.
 */
export async function getProjectSetupChecklist(supabase: SupabaseClient, projectId: string): Promise<ProjectSetupChecklist> {
  const [projectResult, feeRuleResult, contactRows, brief, siteInfo, assignmentRows] = await Promise.all([
    supabase.from("projects").select("pricing_model").eq("id", projectId).maybeSingle(),
    supabase.from("project_fee_rules").select("id").eq("project_id", projectId).is("effective_to", null).maybeSingle(),
    listProjectContacts(supabase, projectId),
    getProjectBriefForStaff(supabase, projectId),
    getProjectSiteInfo(supabase, projectId),
    supabase.from("project_staff_assignments").select("id, revoked_at").eq("project_id", projectId),
  ]);

  if (projectResult.error) throw projectResult.error;
  if (feeRuleResult.error) throw feeRuleResult.error;
  if (assignmentRows.error) throw assignmentRows.error;

  const pricingModel: string | null = projectResult.data?.pricing_model ?? null;
  const hasActiveFeeRule = !!feeRuleResult.data;
  const staffAssignments = (assignmentRows.data ?? []).map((r: any) => ({ revokedAt: r.revoked_at }));

  return {
    // Always complete post-creation (design §9 row 1): name/type/number
    // are all set unconditionally by create_project_with_defaults()
    // (schema/018), so there is nothing further to derive — this is a
    // static fact about any project that exists at all, not a query.
    projectIdentity: { kind: "derived", status: "complete" },
    homeownersDecisionMakers: { kind: "derived", status: deriveContactsStatus(contactRows) },
    conceptScope: { kind: "derived", status: deriveBriefStatus(brief) },
    propertySiteInfo: { kind: "derived", status: deriveSiteInfoStatus(siteInfo) },
    plansDocuments: { kind: "coming_later" },
    staffResponsibilities: { kind: "derived", status: deriveStaffStatus(staffAssignments) },
    // P4 (estimating) is already built and live (design §9 row 7) — a
    // real, clickable feature, not "coming later," but this package has
    // no completeness signal of its own to derive a status from.
    preliminaryEstimating: { kind: "available" },
    permitting: { kind: "derived", status: derivePermittingStatus(siteInfo) },
    quickbooksConnection: { kind: "coming_later" },
    contractPricingTerms: { kind: "derived", status: deriveContractPricingStatus(pricingModel, hasActiveFeeRule) },
    schedule: { kind: "coming_later" },
  };
}
