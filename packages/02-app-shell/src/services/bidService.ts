import type { SupabaseClient } from "@supabase/supabase-js";

export interface BidPackageRow {
  id: string;
  projectId: string;
  costCodeId: string;
  title: string;
  scopeDescription: string | null;
  dueAt: string | null;
  status: "draft" | "published" | "awarded" | "cancelled";
  createdAt: string;
}

/** P5.2 Phase B (Part B) — bid package assembly fields. All nullable,
 *  direct columns on bid_packages (schema/024) — kept as a SEPARATE
 *  interface (not folded into BidPackageRow) since BidPackageRow is
 *  also used for the list view, where these fields are never rendered;
 *  BidPackageDetail below extends both. stoneColumnContactName is
 *  resolved via a SEPARATE query (see getBidPackageDetail/
 *  getVendorVisibleBidPackage), never a PostgREST embed — bid_packages
 *  already carries a SECOND profiles FK (created_by), so relying on an
 *  embed's default relationship resolution here would be exactly the
 *  same ambiguity listBidQuestions' own doc comment already explains
 *  for recorded_by/answered_by. */
export interface BidPackageAssemblyFields {
  inclusions: string | null;
  exclusions: string | null;
  alternates: string | null;
  allowances: string | null;
  pricingBreakdownInstructions: string | null;
  scheduleExpectations: string | null;
  bidInstructions: string | null;
  stoneColumnContactId: string | null;
}

function mapBidPackage(row: any): BidPackageRow {
  return {
    id: row.id,
    projectId: row.project_id,
    costCodeId: row.cost_code_id,
    title: row.title,
    scopeDescription: row.scope_description,
    dueAt: row.due_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapBidPackageAssemblyFields(row: any): BidPackageAssemblyFields {
  return {
    inclusions: row.inclusions ?? null,
    exclusions: row.exclusions ?? null,
    alternates: row.alternates ?? null,
    allowances: row.allowances ?? null,
    pricingBreakdownInstructions: row.pricing_breakdown_instructions ?? null,
    scheduleExpectations: row.schedule_expectations ?? null,
    bidInstructions: row.bid_instructions ?? null,
    stoneColumnContactId: row.stone_column_contact_id ?? null,
  };
}

export async function listBidPackages(supabase: SupabaseClient, projectId: string): Promise<BidPackageRow[]> {
  const { data, error } = await supabase.from("bid_packages").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapBidPackage);
}

export async function createBidPackage(
  supabase: SupabaseClient,
  projectId: string,
  costCodeId: string,
  title: string,
  scopeDescription?: string,
  dueAt?: string
) {
  if (!title.trim()) return { error: "Title is required." };
  const { data, error } = await supabase
    .from("bid_packages")
    .insert({ project_id: projectId, cost_code_id: costCodeId, title: title.trim(), scope_description: scopeDescription ?? null, due_at: dueAt ?? null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

export async function publishBidPackage(supabase: SupabaseClient, bidPackageId: string) {
  const { error } = await supabase.from("bid_packages").update({ status: "published" }).eq("id", bidPackageId).eq("status", "draft");
  if (error) return { error: error.message };
  return {};
}

export interface BidSubmissionRow {
  id: string;
  bidPackageId: string;
  vendorId: string;
  vendorName: string;
  status: "invited" | "submitted" | "awarded" | "declined" | "withdrawn";
  amountCents: number | null;
  notes: string | null;
  submittedAt: string | null;
}

export interface BidPackageDetail extends BidPackageRow, BidPackageAssemblyFields {
  submissions: BidSubmissionRow[];
  /** Resolved from profiles.full_name for stoneColumnContactId — see
   *  BidPackageAssemblyFields' own doc comment for why this is a
   *  separate lookup, never an embed. Null when no contact is set, or
   *  when the profile lookup finds no match. */
  stoneColumnContactName: string | null;
}

export interface InviteVendorResult {
  error?: string;
  warning?: string;
  /** P5.2 Phase A's temporary testing affordance: a real, working
   *  magic-link token, returned directly so staff can copy/paste it
   *  into a message by hand. There is no email infrastructure in this
   *  codebase yet (Phase D adds real delivery via bid_invitation_emails/
   *  EmailService and this field goes away in favor of a real "sent"
   *  status) -- this is an honest stand-in, not the final invitation UX. */
  accessToken?: string;
}

/** Writes the real bid_submissions invite row (unchanged from P5), then
 *  additionally issues a bid_vendor_access_invitations row (schema/022)
 *  so the invited vendor has a real, working first-access magic link —
 *  closing the gap where "Invite" previously told the vendor nothing.
 *  Does NOT create/maintain any project_members row: schema/022 chose
 *  the self-sufficient RLS fix (bid_packages_vendor_read now derives
 *  access transitively from vendor_members + bid_submissions alone), so
 *  there is no second write path to keep in sync here, ever. */
export async function inviteVendor(supabase: SupabaseClient, bidPackageId: string, vendorId: string): Promise<InviteVendorResult> {
  const { error } = await supabase.from("bid_submissions").insert({ bid_package_id: bidPackageId, vendor_id: vendorId });
  if (error) return { error: error.message };

  const { data: vendorRow, error: vendorError } = await supabase
    .from("vendors")
    .select("email, org_id")
    .eq("id", vendorId)
    .maybeSingle();
  if (vendorError) return { error: vendorError.message };
  if (!vendorRow?.email) {
    return { warning: "Vendor invited, but has no bidding email on file — no access link was generated. Add one from the vendor directory, then invite again." };
  }

  const { data: invitationRow, error: invitationError } = await supabase
    .from("bid_vendor_access_invitations")
    .insert({ bid_package_id: bidPackageId, vendor_id: vendorId, org_id: vendorRow.org_id, email: vendorRow.email })
    .select("token")
    .single();
  if (invitationError) return { error: invitationError.message };

  return { accessToken: invitationRow.token as string };
}

export async function getBidPackageDetail(supabase: SupabaseClient, bidPackageId: string): Promise<BidPackageDetail | null> {
  const { data: pkgRow, error: pkgError } = await supabase.from("bid_packages").select("*").eq("id", bidPackageId).maybeSingle();
  if (pkgError) throw pkgError;
  if (!pkgRow) return null;

  const { data: subRows, error: subError } = await supabase
    .from("bid_submissions")
    .select("id, bid_package_id, vendor_id, status, amount_cents, notes, submitted_at, vendors(name)")
    .eq("bid_package_id", bidPackageId);
  if (subError) throw subError;

  let stoneColumnContactName: string | null = null;
  if (pkgRow.stone_column_contact_id) {
    const { data: contactRow, error: contactError } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", pkgRow.stone_column_contact_id)
      .maybeSingle();
    if (contactError) throw contactError;
    stoneColumnContactName = contactRow?.full_name ?? null;
  }

  return {
    ...mapBidPackage(pkgRow),
    ...mapBidPackageAssemblyFields(pkgRow),
    stoneColumnContactName,
    submissions: (subRows ?? []).map((row: any) => ({
      id: row.id,
      bidPackageId: row.bid_package_id,
      vendorId: row.vendor_id,
      vendorName: row.vendors?.name ?? "Unknown vendor",
      status: row.status,
      amountCents: row.amount_cents,
      notes: row.notes,
      submittedAt: row.submitted_at,
    })),
  };
}

/** P5.2 Phase B (Part B) — staff-only edit of the assembly-field
 *  "Package Details" section. Deliberately a SEPARATE function from
 *  createBidPackage (never folded into it) — these fields are filled in
 *  progressively on an existing package, never required at creation,
 *  matching this codebase's established "simple creation, progressive
 *  detail" pattern (e.g. P5.1's vendor creation vs. its own detail
 *  screen). Every field is optional/independently updatable — passing
 *  `undefined` for a field leaves it unchanged; passing an explicit
 *  empty string clears it to null (the same "empty string means clear"
 *  convention this file's own askBidQuestion/issueBidAddendum use for
 *  optional text). */
export async function updateBidPackageAssemblyDetails(
  supabase: SupabaseClient,
  bidPackageId: string,
  fields: Partial<{
    inclusions: string;
    exclusions: string;
    alternates: string;
    allowances: string;
    pricingBreakdownInstructions: string;
    scheduleExpectations: string;
    bidInstructions: string;
    stoneColumnContactId: string;
  }>
) {
  const patch: Record<string, unknown> = {};
  if ("inclusions" in fields) patch.inclusions = fields.inclusions?.trim() || null;
  if ("exclusions" in fields) patch.exclusions = fields.exclusions?.trim() || null;
  if ("alternates" in fields) patch.alternates = fields.alternates?.trim() || null;
  if ("allowances" in fields) patch.allowances = fields.allowances?.trim() || null;
  if ("pricingBreakdownInstructions" in fields) patch.pricing_breakdown_instructions = fields.pricingBreakdownInstructions?.trim() || null;
  if ("scheduleExpectations" in fields) patch.schedule_expectations = fields.scheduleExpectations?.trim() || null;
  if ("bidInstructions" in fields) patch.bid_instructions = fields.bidInstructions?.trim() || null;
  if ("stoneColumnContactId" in fields) patch.stone_column_contact_id = fields.stoneColumnContactId || null;

  if (Object.keys(patch).length === 0) return {};

  const { error } = await supabase.from("bid_packages").update(patch).eq("id", bidPackageId);
  if (error) return { error: error.message };
  return {};
}

export interface StaffProfileRow {
  id: string;
  fullName: string;
}

/** Backs the "Package Details" section's Stone Column contact picker
 *  (P5.2 Phase B, Part B) — the only place in this file a staff picker
 *  is needed today. Deliberately minimal (id + fullName only, no
 *  staff_function/role split) since the only use is "name a real staff
 *  member," not any staff_function-conditional behavior. */
export async function listOrgStaffProfiles(supabase: SupabaseClient, orgId: string): Promise<StaffProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .in("role", ["admin", "staff"])
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, fullName: row.full_name }));
}

export interface VendorRow {
  id: string;
  name: string;
}

/** The ONE real vendors list every selector-style screen (Bids,
 *  Material Orders) reads from — see vendorService.ts's own doc
 *  comment. P5.1 addition: also excludes merged-away vendors
 *  explicitly (`merged_into_vendor_id is null`), not just archived
 *  ones. In practice a merged vendor is always archived too (schema/020's
 *  `vendors_merged_implies_archived` CHECK constraint guarantees this),
 *  so `is_archived = false` alone already excludes every merged-away
 *  row today — this second filter is defense in depth against that
 *  invariant ever being the only thing keeping a merged vendor out of a
 *  brand-new bid/order, not a fix for an observed gap. */
export async function listVendors(supabase: SupabaseClient, orgId: string): Promise<VendorRow[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("is_archived", false)
    .is("merged_into_vendor_id", null)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, name: row.name }));
}

/** revoked_by is deliberately NOT a parameter — the DB trigger
 *  (enforce_vendor_member_identity_and_revocation) requires it to equal
 *  the acting session's own auth.uid() and rejects anything else, so
 *  passing it here would only ever fail; the plain update relies on the
 *  RLS-scoped client's own session to supply the correct value via the
 *  trigger, exactly like recorded_by's DB-boundary enforcement above. */
export async function revokeVendorMember(supabase: SupabaseClient, vendorId: string, profileId: string) {
  const { error } = await supabase
    .from("vendor_members")
    .update({ revoked_at: new Date().toISOString(), revoked_by: (await supabase.auth.getUser()).data.user?.id })
    .eq("vendor_id", vendorId)
    .eq("profile_id", profileId);
  if (error) return { error: error.message };
  return {};
}

export async function reactivateVendorMember(supabase: SupabaseClient, vendorId: string, profileId: string) {
  const { error } = await supabase
    .from("vendor_members")
    .update({ revoked_at: null })
    .eq("vendor_id", vendorId)
    .eq("profile_id", profileId);
  if (error) return { error: error.message };
  return {};
}

export async function recordBidSubmission(supabase: SupabaseClient, bidSubmissionId: string, amountCents: number, notes?: string) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return { error: "Amount must be a whole number of cents, zero or greater." };
  }
  const { error } = await supabase
    .from("bid_submissions")
    .update({ status: "submitted", amount_cents: amountCents, notes: notes ?? null, submitted_at: new Date().toISOString() })
    .eq("id", bidSubmissionId)
    .eq("status", "invited");
  if (error) return { error: error.message };
  return {};
}

export async function awardBid(supabase: SupabaseClient, bidSubmissionId: string) {
  const { data, error } = await supabase.rpc("award_bid", { p_bid_submission_id: bidSubmissionId });
  if (error) return { error: error.message };
  return { committedCostId: data as string };
}

export interface BidQuestionRow {
  id: string;
  bidPackageId: string;
  vendorId: string | null;
  source: "staff_recorded" | "vendor_submitted";
  recordedBy: string | null;
  /** Resolved from profiles.full_name for recordedBy — kept as a
   *  separate field (never folded into questionText) so the UI can
   *  render "Recorded by [staff name]" as its own attribution line and
   *  can never mistake a staff_recorded entry for something the vendor
   *  typed (Decision 8). Null when recordedBy is null (e.g. a future
   *  vendor_submitted row, dormant until P11) or when the profile
   *  lookup finds no match. */
  recordedByName: string | null;
  questionText: string;
  askedAt: string;
  answerText: string | null;
  answeredAt: string | null;
}

/** source is always 'staff_recorded' here (P5 has no vendor session to
 *  submit directly) and recorded_by is intentionally OMITTED from the
 *  insert payload — the column's own `default auth.uid()` populates it
 *  from the actual authenticated session, never a value this function
 *  could be tricked into passing on someone else's behalf. */
export async function askBidQuestion(supabase: SupabaseClient, bidPackageId: string, vendorId: string, questionText: string) {
  if (!questionText.trim()) return { error: "Question text is required." };
  const { error } = await supabase
    .from("bid_questions")
    .insert({ bid_package_id: bidPackageId, vendor_id: vendorId, question_text: questionText.trim(), source: "staff_recorded" });
  if (error) return { error: error.message };
  return {};
}

export async function answerBidQuestion(supabase: SupabaseClient, bidQuestionId: string, answerText: string) {
  if (!answerText.trim()) return { error: "Answer text is required." };
  const { error } = await supabase
    .from("bid_questions")
    .update({ answer_text: answerText.trim(), answered_at: new Date().toISOString() })
    .eq("id", bidQuestionId);
  if (error) return { error: error.message };
  return {};
}

/** recordedByName is resolved with a SEPARATE query against `profiles`
 *  (never a PostgREST embed) deliberately: bid_questions carries two
 *  distinct FKs into profiles (recorded_by, answered_by), and relying
 *  on an embed's default relationship resolution there is ambiguous —
 *  an explicit two-step lookup is unambiguous and easy to verify. */
export async function listBidQuestions(supabase: SupabaseClient, bidPackageId: string): Promise<BidQuestionRow[]> {
  const { data, error } = await supabase.from("bid_questions").select("*").eq("bid_package_id", bidPackageId).order("asked_at", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];

  const recorderIds = Array.from(new Set(rows.map((row: any) => row.recorded_by).filter((id: string | null): id is string => !!id)));
  const namesById = new Map<string, string>();
  if (recorderIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase.from("profiles").select("id, full_name").in("id", recorderIds);
    if (profileError) throw profileError;
    for (const p of profileRows ?? []) namesById.set(p.id, p.full_name as string);
  }

  return rows.map((row: any) => ({
    id: row.id,
    bidPackageId: row.bid_package_id,
    vendorId: row.vendor_id,
    source: row.source,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by ? namesById.get(row.recorded_by) ?? null : null,
    questionText: row.question_text,
    askedAt: row.asked_at,
    answerText: row.answer_text,
    answeredAt: row.answered_at,
  }));
}

export async function issueBidAddendum(supabase: SupabaseClient, bidPackageId: string, title: string, bodyText: string, revisedDueAt?: string) {
  if (!title.trim() || !bodyText.trim()) return { error: "Title and body are required." };
  const { error } = await supabase
    .from("bid_addenda")
    .insert({ bid_package_id: bidPackageId, title: title.trim(), body_text: bodyText.trim(), revised_due_at: revisedDueAt ?? null });
  if (error) return { error: error.message };
  if (revisedDueAt) {
    const { error: dueDateError } = await supabase.from("bid_packages").update({ due_at: revisedDueAt }).eq("id", bidPackageId);
    if (dueDateError) return { error: dueDateError.message };
  }
  return {};
}

export interface BidAddendumRow {
  id: string;
  bidPackageId: string;
  title: string;
  bodyText: string;
  revisedDueAt: string | null;
  issuedBy: string | null;
  issuedAt: string;
}

/** Task 4/5 never exposed a read path for bid_addenda (only the insert,
 *  issueBidAddendum, above) — added here in Task 6 because the
 *  /admin/bids screen's addenda log (Mutations table: "New entry in
 *  the addenda list") has nothing to render without it. Same shape as
 *  every other list* function in this file. */
export async function listBidAddenda(supabase: SupabaseClient, bidPackageId: string): Promise<BidAddendumRow[]> {
  const { data, error } = await supabase
    .from("bid_addenda")
    .select("*")
    .eq("bid_package_id", bidPackageId)
    .order("issued_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    bidPackageId: row.bid_package_id,
    title: row.title,
    bodyText: row.body_text,
    revisedDueAt: row.revised_due_at,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
  }));
}

export interface VendorBidPackageView extends BidPackageAssemblyFields {
  id: string;
  title: string;
  scopeDescription: string | null;
  dueAt: string | null;
  status: BidPackageRow["status"];
  /** Resolved from cost_codes.code (schema/022's new cost_codes_vendor_read
   *  policy) — this codebase's own established convention of never
   *  showing a raw UUID to any user, applied to the vendor-facing
   *  screen for the first time. */
  costCodeCode: string;
  /** Resolved from profiles.full_name via schema/024's new
   *  profiles_vendor_read_bid_package_contact policy — the FIRST vendor
   *  read access this codebase grants into `profiles` at all, narrowly
   *  scoped to exactly the one staff profile designated as THIS
   *  package's own contact. Null when no contact is designated. */
  stoneColumnContactName: string | null;
}

/** P5.2 Phase A's one real vendor-facing read. Deliberately relies
 *  entirely on RLS (bid_packages_vendor_read/cost_codes_vendor_read,
 *  schema/022) to decide what this call can ever see — a vendor session
 *  querying a package it isn't invited to gets zero rows back here, not
 *  a thrown error, so the caller (the /vendor/bids/[id] Server
 *  Component) can render a clean "not found," never a crash and never
 *  another vendor's data. */
export async function getVendorVisibleBidPackage(supabase: SupabaseClient, bidPackageId: string): Promise<VendorBidPackageView | null> {
  const { data: pkg, error } = await supabase
    .from("bid_packages")
    .select(
      "id, title, scope_description, due_at, status, cost_code_id, inclusions, exclusions, alternates, allowances, pricing_breakdown_instructions, schedule_expectations, bid_instructions, stone_column_contact_id"
    )
    .eq("id", bidPackageId)
    .maybeSingle();
  if (error) throw error;
  if (!pkg) return null;

  const { data: costCode, error: costCodeError } = await supabase
    .from("cost_codes")
    .select("code")
    .eq("id", pkg.cost_code_id)
    .maybeSingle();
  if (costCodeError) throw costCodeError;

  let stoneColumnContactName: string | null = null;
  if (pkg.stone_column_contact_id) {
    const { data: contactRow, error: contactError } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", pkg.stone_column_contact_id)
      .maybeSingle();
    if (contactError) throw contactError;
    stoneColumnContactName = contactRow?.full_name ?? null;
  }

  return {
    id: pkg.id,
    title: pkg.title,
    scopeDescription: pkg.scope_description,
    dueAt: pkg.due_at,
    status: pkg.status,
    costCodeCode: costCode?.code ?? "Unknown cost code",
    ...mapBidPackageAssemblyFields(pkg),
    stoneColumnContactName,
  };
}

// ---------------------------------------------------------------------
// P5.2 Phase B (Part C) — vendor-visible, read-only correspondence.
// Both functions rely entirely on the ALREADY-PROVEN vendor RLS
// (bid_questions_vendor_read/bid_addenda_vendor_read, corrected by
// schema/022) to decide what a vendor session can ever see — same
// "RLS is the only real gate, this is just a typed, honest read" shape
// as getVendorVisibleBidPackage() itself. Deliberately do NOT resolve
// recordedByName/issuedBy to a staff display name (unlike
// listBidQuestions' staff-facing version): a vendor session cannot
// generally read an arbitrary staff profile (profiles' own RLS,
// schema/001), and this phase has no product requirement for a vendor
// to see WHICH staff member wrote something — only the content and
// timing, read-only, per this phase's explicit scope boundary (no
// ability to ask/answer/acknowledge yet).
// ---------------------------------------------------------------------

export interface VendorVisibleBidQuestionRow {
  id: string;
  questionText: string;
  askedAt: string;
  answerText: string | null;
  answeredAt: string | null;
}

export async function listVendorVisibleBidQuestions(supabase: SupabaseClient, bidPackageId: string): Promise<VendorVisibleBidQuestionRow[]> {
  const { data, error } = await supabase
    .from("bid_questions")
    .select("id, question_text, asked_at, answer_text, answered_at")
    .eq("bid_package_id", bidPackageId)
    .order("asked_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    questionText: row.question_text,
    askedAt: row.asked_at,
    answerText: row.answer_text,
    answeredAt: row.answered_at,
  }));
}

export interface VendorVisibleBidAddendumRow {
  id: string;
  title: string;
  bodyText: string;
  revisedDueAt: string | null;
  issuedAt: string;
}

export async function listVendorVisibleBidAddenda(supabase: SupabaseClient, bidPackageId: string): Promise<VendorVisibleBidAddendumRow[]> {
  const { data, error } = await supabase
    .from("bid_addenda")
    .select("id, title, body_text, revised_due_at, issued_at")
    .eq("bid_package_id", bidPackageId)
    .order("issued_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    bodyText: row.body_text,
    revisedDueAt: row.revised_due_at,
    issuedAt: row.issued_at,
  }));
}

// ---------------------------------------------------------------------
// P5.2 Phase B (Part C) — bid package documents. Reuses the existing
// `documents` metadata table (schema/010, extended by schema/025 with
// version/superseded_by_id) and the new `bid_package_documents` join —
// never a parallel file-storage concept. storage_key/getDownloadUrl
// itself stay entirely inside apps/web's StorageAdapter (this package
// has no apps/web-layout dependency, matching every other service file
// here) — recordBidPackageDocumentUpload takes an already-uploaded
// storageKey, exactly like vendorService.ts's recordVendorDocumentUpload
// does for vendor_documents.
// ---------------------------------------------------------------------

export type BidPackageDocumentCategory = "plans" | "specifications" | "scope" | "photos" | "addenda" | "reference" | "other";

export interface BidPackageDocumentRow {
  /** bid_package_documents.id — the join row, i.e. what a caller acts
   *  on (download, and in a later phase, unlink/replace). */
  id: string;
  bidPackageId: string;
  documentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  category: BidPackageDocumentCategory;
  internalOnly: boolean;
  createdAt: string;
  createdBy: string | null;
}

function mapBidPackageDocument(row: any): BidPackageDocumentRow {
  return {
    id: row.id,
    bidPackageId: row.bid_package_id,
    documentId: row.document_id,
    fileName: row.documents?.file_name ?? "Unknown file",
    mimeType: row.documents?.mime_type ?? "application/octet-stream",
    sizeBytes: row.documents?.size_bytes ?? 0,
    version: row.documents?.version ?? 1,
    category: row.category,
    internalOnly: row.internal_only,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

const BID_PACKAGE_DOCUMENT_SELECT = "id, bid_package_id, document_id, internal_only, category, created_at, created_by, documents(file_name, mime_type, size_bytes, version)";

/** Staff-side list — every linked document, internal-only included
 *  (bid_package_documents_staff_full_access, schema/025). */
export async function listBidPackageDocuments(supabase: SupabaseClient, bidPackageId: string): Promise<BidPackageDocumentRow[]> {
  const { data, error } = await supabase
    .from("bid_package_documents")
    .select(BID_PACKAGE_DOCUMENT_SELECT)
    .eq("bid_package_id", bidPackageId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapBidPackageDocument);
}

/** Vendor-side list — relies on RLS (bid_package_documents_vendor_read
 *  AND documents_vendor_read_via_bid_package, both schema/025) to do
 *  the real work, exactly like getVendorVisibleBidPackage(); the
 *  explicit `.eq("internal_only", false)` below is defense in depth
 *  (this codebase's established double-check pattern — see e.g. the
 *  vendor-upload Route Handler's own explicit w9-role check alongside
 *  RLS), not the actual security boundary. */
export async function listVendorVisibleBidPackageDocuments(supabase: SupabaseClient, bidPackageId: string): Promise<BidPackageDocumentRow[]> {
  const { data, error } = await supabase
    .from("bid_package_documents")
    .select(BID_PACKAGE_DOCUMENT_SELECT)
    .eq("bid_package_id", bidPackageId)
    .eq("internal_only", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapBidPackageDocument);
}

/** Records a real file upload (the caller has already written the
 *  bytes via StorageAdapter.upload() before calling this — matching
 *  recordVendorDocumentUpload's own division of labor). If
 *  `replacesId` (an existing bid_package_documents.id) is given, this
 *  creates a NEW documents row at the next version, marks the CURRENT
 *  document superseded, and links the new version via a BRAND-NEW
 *  bid_package_documents row — the existing row named by `replacesId`
 *  is never touched. This is deliberate, not an oversight: schema/025's
 *  own integrity trigger makes bid_package_documents.document_id
 *  immutable after insert specifically so an already-published
 *  package's document links can never be silently repointed — "replace"
 *  is really "link a new version alongside the old one," and the old
 *  link remains exactly as it was for as long as it exists. */
export async function uploadBidPackageDocument(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    bidPackageId: string;
    storageKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    category: BidPackageDocumentCategory;
    internalOnly: boolean;
    uploadedBy: string;
    replacesId?: string;
  }
): Promise<{ id?: string; error?: string }> {
  let version = 1;
  let priorDocumentId: string | null = null;

  if (params.replacesId) {
    const { data: priorLink, error: priorLinkError } = await supabase
      .from("bid_package_documents")
      .select("document_id, documents(version)")
      .eq("id", params.replacesId)
      .maybeSingle();
    if (priorLinkError) return { error: priorLinkError.message };
    if (!priorLink) return { error: "The document you're replacing could not be found." };
    priorDocumentId = priorLink.document_id as string;
    version = ((priorLink as any).documents?.version ?? 1) + 1;
  }

  const { data: newDocument, error: documentError } = await supabase
    .from("documents")
    .insert({
      project_id: params.projectId,
      uploaded_by: params.uploadedBy,
      file_name: params.fileName,
      mime_type: params.mimeType,
      size_bytes: params.sizeBytes,
      storage_key: params.storageKey,
      version,
    })
    .select("id")
    .single();
  if (documentError) return { error: documentError.message };

  if (priorDocumentId) {
    const { error: supersedeError } = await supabase.from("documents").update({ superseded_by_id: newDocument.id }).eq("id", priorDocumentId);
    if (supersedeError) return { error: supersedeError.message };
  }

  const { data: newLink, error: linkError } = await supabase
    .from("bid_package_documents")
    .insert({
      bid_package_id: params.bidPackageId,
      document_id: newDocument.id,
      internal_only: params.internalOnly,
      category: params.category,
    })
    .select("id")
    .single();
  if (linkError) return { error: linkError.message };

  return { id: newLink.id as string };
}
