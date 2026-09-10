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

export interface BidPackageDetail extends BidPackageRow {
  submissions: BidSubmissionRow[];
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

  return {
    ...mapBidPackage(pkgRow),
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

export interface VendorBidPackageView {
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
    .select("id, title, scope_description, due_at, status, cost_code_id")
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

  return {
    id: pkg.id,
    title: pkg.title,
    scopeDescription: pkg.scope_description,
    dueAt: pkg.due_at,
    status: pkg.status,
    costCodeCode: costCode?.code ?? "Unknown cost code",
  };
}
