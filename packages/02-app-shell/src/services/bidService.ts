import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAndRecordOutboundMessage, ensureInboundReplyToken } from "./correspondenceService";
import type { EmailSendStatus } from "./email/EmailService";

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
  /** P5.2 Phase C — the submission's full immutable revision history
   *  (schema/026's bid_submission_revisions), oldest first. Empty for a
   *  submission that was staff-recorded (recordBidSubmission) rather
   *  than submitted by the vendor's own session — an honestly-empty
   *  history, not a fetch failure, since a staff-recorded submission
   *  never went through submit_bid_revision(). Populated by
   *  getBidPackageDetail() below in one batched follow-up query, never
   *  per-row (no N+1). */
  revisions: BidSubmissionRevisionRow[];
}

/** P5.2 Phase C — one immutable, permanent row per vendor submit/revise
 *  action (schema/026's bid_submission_revisions). Never mutated after
 *  insert — see schema/026's own header comment for the full
 *  versioning-pattern reasoning (bid_submissions itself keeps its
 *  existing mutable-current-row shape; this is the real history,
 *  living alongside it as a separate child table). */
export interface BidSubmissionRevisionRow {
  id: string;
  bidSubmissionId: string;
  revisionNumber: number;
  amountCents: number;
  notes: string | null;
  submittedBy: string | null;
  submittedAt: string;
}

function mapBidSubmissionRevision(row: any): BidSubmissionRevisionRow {
  return {
    id: row.id,
    bidSubmissionId: row.bid_submission_id,
    revisionNumber: row.revision_number,
    amountCents: row.amount_cents,
    notes: row.notes,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
  };
}

/** Reads bid_submission_revisions for a single submission, oldest
 *  first. Relies entirely on RLS (bid_submission_revisions_staff_read/
 *  vendor_read, schema/026) to decide what the calling session can ever
 *  see — a staff session sees every revision for its own org's
 *  packages, a vendor session sees only its OWN submission's revisions
 *  (empty, never another vendor's, for anything else). Used directly by
 *  the vendor-facing "my submission history" view and indirectly (via
 *  getBidPackageDetail below) by the staff workspace. */
export async function listBidSubmissionRevisions(supabase: SupabaseClient, bidSubmissionId: string): Promise<BidSubmissionRevisionRow[]> {
  const { data, error } = await supabase
    .from("bid_submission_revisions")
    .select("*")
    .eq("bid_submission_id", bidSubmissionId)
    .order("revision_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapBidSubmissionRevision);
}

/** P5.2 Phase C — the one real vendor-facing write for a bid amount.
 *  Wraps submit_bid_revision() (schema/026): inserts a new, permanent
 *  bid_submission_revisions row AND updates bid_submissions' current
 *  amount_cents/notes/status/submitted_at, atomically, in one RPC call.
 *  amountCents MUST be a whole number of cents (CLAUDE.md's own
 *  non-negotiable) — validated here for a fast, friendly error, and
 *  independently re-validated inside the RPC itself (the real
 *  boundary, not this check). All the "is this even allowed" business
 *  rules (own submission only, package still accepting bids, submission
 *  not already closed out) are enforced by schema/026's triggers, not
 *  re-implemented here — see that migration's own doc comments for why
 *  that's the single source of truth. */
export async function submitVendorBid(
  supabase: SupabaseClient,
  bidSubmissionId: string,
  amountCents: number,
  notes?: string
): Promise<{ revisionId?: string; error?: string }> {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return { error: "Bid amount must be a whole number of cents, zero or greater." };
  }
  const { data, error } = await supabase.rpc("submit_bid_revision", {
    p_bid_submission_id: bidSubmissionId,
    p_amount_cents: amountCents,
    p_notes: notes ?? null,
  });
  if (error) return { error: error.message };
  return { revisionId: data as string };
}

/** P5.2 Phase C — the vendor-facing "which of my own bid_submissions
 *  rows exists for this package" read, backing the /vendor/bids/[id]
 *  submission form. Relies entirely on bid_submissions_vendor_read
 *  (schema/015 — `is_vendor_member(vendor_id)`) to scope this to the
 *  calling vendor session's own row(s) only: a vendor never invited to
 *  this package gets an empty array back here, not an error. Returns at
 *  most one row for the ordinary case (one vendor company per package);
 *  if the calling profile is somehow a member of more than one vendor
 *  company invited to the SAME package (not a case this codebase's
 *  invite flow ever produces today), the first row is used — an
 *  explicit, documented judgment call, not a silent one. */
export async function getVendorOwnBidSubmission(supabase: SupabaseClient, bidPackageId: string): Promise<BidSubmissionRow | null> {
  const { data, error } = await supabase
    .from("bid_submissions")
    .select("id, bid_package_id, vendor_id, status, amount_cents, notes, submitted_at, vendors(name)")
    .eq("bid_package_id", bidPackageId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as any;
  return {
    id: row.id,
    bidPackageId: row.bid_package_id,
    vendorId: row.vendor_id,
    vendorName: row.vendors?.name ?? "Unknown vendor",
    status: row.status,
    amountCents: row.amount_cents,
    notes: row.notes,
    submittedAt: row.submitted_at,
    revisions: [],
  };
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
  /** P5.2 Phase A's magic-link token, still generated and returned on
   *  EVERY successful invite (Phase D never removes it — see this
   *  function's own header comment) but only ever DISPLAYED by the UI
   *  as a manual copy/paste fallback when `emailStatus` is anything
   *  other than 'sent'. */
  accessToken?: string;
  /** P5.2 Phase D — the exact address the invitation was (or would be)
   *  sent to, resolved server-side from the vendor's own canonical
   *  bidding email (vendors.email) — surfaced so staff can see who
   *  actually receives it, per the owner's explicit requirement. */
  recipientEmail?: string;
  /** The real, honest outcome of the EmailService.send() attempt —
   *  'sent' only when a configured provider actually accepted it,
   *  'pending_provider_configuration' when no provider is configured at
   *  all (RESEND_API_KEY absent), 'failed' for a real provider error.
   *  Never silently coerced to a success. */
  emailStatus?: EmailSendStatus;
  emailError?: string;
}

/** Writes the real bid_submissions invite row (unchanged from P5), then
 *  additionally issues a bid_vendor_access_invitations row (schema/022)
 *  so the invited vendor has a real, working first-access magic link,
 *  and (P5.2 Phase D) sends a real invitation email through EmailService
 *  containing that same link — closing the gap where "Invite" was a
 *  manual copy/paste-only affordance. Does NOT create/maintain any
 *  project_members row: schema/022 chose the self-sufficient RLS fix
 *  (bid_packages_vendor_read now derives access transitively from
 *  vendor_members + bid_submissions alone), so there is no second write
 *  path to keep in sync here, ever.
 *
 * `baseUrl` (e.g. `https://portal.stonecolumn.com` or, in dev,
 * `http://127.0.0.1:5173`) is supplied by the caller (the Server Action,
 * which resolves it from the real inbound request's own host header via
 * next/headers) — this package deliberately carries no apps/web/Next.js
 * dependency of its own (matching every other service file here), so it
 * cannot resolve its own origin.
 *
 * The magic-link token is ALWAYS still generated and returned, even
 * once real email is configured and used — per the owner's explicit
 * instruction, removing it entirely would leave zero way to test
 * invitations locally without sending a real email. The UI (not this
 * function) is what decides whether to ever actually show it: only when
 * emailStatus is not 'sent'.
 *
 * A failure recording the invitation email itself (sendAndRecord's own
 * database write) is surfaced as a `warning`, never a top-level `error`
 * — the vendor genuinely WAS invited (bid_submissions/bid_vendor_access_
 * invitations both already committed) by that point; only the
 * correspondence record of the notification failed, which staff can see
 * and retry via the ordinary compose-a-message flow.
 */
export async function inviteVendor(supabase: SupabaseClient, bidPackageId: string, vendorId: string, baseUrl: string): Promise<InviteVendorResult> {
  const { error } = await supabase.from("bid_submissions").insert({ bid_package_id: bidPackageId, vendor_id: vendorId });
  if (error) return { error: error.message };

  const { data: vendorRow, error: vendorError } = await supabase
    .from("vendors")
    .select("email, name, org_id")
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

  const accessToken = invitationRow.token as string;

  const { data: userRes } = await supabase.auth.getUser();
  const staffProfileId = userRes.user?.id;
  if (!staffProfileId) return { error: "Not authenticated." };

  const { data: pkgRow } = await supabase.from("bid_packages").select("title").eq("id", bidPackageId).maybeSingle();
  const tokenResult = await ensureInboundReplyToken(supabase, bidPackageId, vendorId);
  const replyToToken = "token" in tokenResult ? tokenResult.token : undefined;

  const accessLink = `${baseUrl}/vendor/invite/${accessToken}`;
  const packageTitle = pkgRow?.title ?? "a Stone Column project";
  const subject = `You're invited to bid: ${packageTitle}`;
  const body = [
    `${vendorRow.name ?? "Hello"},`,
    "",
    `You have been invited to submit a bid for "${packageTitle}".`,
    "",
    `Access your bid package here: ${accessLink}`,
    "",
    "If you have any questions, reply directly to this email.",
    "",
    "— Stone Column Custom Homes",
  ].join("\n");

  // The EMAILED copy above carries the real one-time link. The copy we
  // persist to the thread must not: that token is a bearer credential
  // valid until the invitation expires, and entity_messages rows are
  // rendered in the vendor's own Messages panel and survive in every
  // export, screenshot, and backup of the thread. Storing it there put
  // a working credential in far more places than the inbox it was
  // addressed to. The thread keeps an honest record that the invitation
  // was sent, and says plainly why the link is absent.
  const storedBody = [
    `${vendorRow.name ?? "Hello"},`,
    "",
    `You have been invited to submit a bid for "${packageTitle}".`,
    "",
    "The one-time access link was sent by email and is deliberately omitted from this thread for security — an invitation link is a credential, so it is never stored here.",
    "",
    "If you have any questions, reply directly to this email.",
    "",
    "— Stone Column Custom Homes",
  ].join("\n");

  const sendResult = await sendAndRecordOutboundMessage(supabase, {
    bidPackageId,
    vendorId,
    to: vendorRow.email,
    subject,
    body,
    storedBody,
    createdBy: staffProfileId,
    replyToToken,
  });

  if (sendResult.error) {
    return {
      warning: `Vendor invited, but recording the invitation notification failed: ${sendResult.error}`,
      accessToken,
      recipientEmail: vendorRow.email,
    };
  }

  return {
    accessToken,
    recipientEmail: vendorRow.email,
    emailStatus: sendResult.emailStatus,
    emailError: sendResult.emailError,
  };
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

  // P5.2 Phase C: one batched follow-up query for every submission's
  // full revision history — never N+1 (one query per submission row).
  // Grouped in JS by bid_submission_id; a submission with zero
  // vendor-authored revisions (e.g. staff-recorded via
  // recordBidSubmission, which never calls submit_bid_revision())
  // simply gets an empty array, not a fetch failure.
  const submissionIds = (subRows ?? []).map((row: any) => row.id as string);
  const revisionsBySubmissionId = new Map<string, BidSubmissionRevisionRow[]>();
  if (submissionIds.length > 0) {
    const { data: revisionRows, error: revisionError } = await supabase
      .from("bid_submission_revisions")
      .select("*")
      .in("bid_submission_id", submissionIds)
      .order("revision_number", { ascending: true });
    if (revisionError) throw revisionError;
    for (const row of revisionRows ?? []) {
      const mapped = mapBidSubmissionRevision(row);
      const existing = revisionsBySubmissionId.get(mapped.bidSubmissionId) ?? [];
      existing.push(mapped);
      revisionsBySubmissionId.set(mapped.bidSubmissionId, existing);
    }
  }

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
      revisions: revisionsBySubmissionId.get(row.id) ?? [],
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
  /** P5.2 Phase D — surfaced so the invite UI can show exactly which
   *  address an invitation will be sent to BEFORE staff clicks Invite,
   *  per the owner's explicit "show exactly who will receive it before
   *  sending" requirement. Null when the vendor has no bidding email on
   *  file (inviteVendor's own existing warning path already handles
   *  that case at invite time). */
  email: string | null;
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
    .select("id, name, email")
    .eq("org_id", orgId)
    .eq("is_archived", false)
    .is("merged_into_vendor_id", null)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, name: row.name, email: row.email ?? null }));
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

export interface VendorMemberRow {
  id: string;
  vendorId: string;
  profileId: string;
  email: string | null;
  isPrimary: boolean;
  revokedAt: string | null;
}

/** Final-review addition (post-Phase-E): revokeVendorMember/
 *  reactivateVendorMember above were fully built, RLS-gated, and
 *  live-checkpoint-tested (scripts/db/live-p5.2-phase-a/e-checkpoint.mjs)
 *  but no staff-facing screen could show WHICH profiles to revoke — this
 *  is the read side that makes that screen possible. Lists every
 *  vendor_members row (active AND revoked — the UI needs to render both
 *  a Revoke and a Reactivate action) for one vendor company, so staff
 *  can pick the exact membership to act on. Uses the same disambiguated
 *  FK-qualified embed as correspondenceService.ts's
 *  verifySenderMatchesVendor (vendor_members carries two FKs into
 *  profiles — profile_id and revoked_by — so an unqualified
 *  `profiles(email)` embed is ambiguous to PostgREST). Gated by the same
 *  `vendor_members_staff_full_access` RLS policy (schema/015) every
 *  other staff read/write of this table already relies on — no new
 *  policy needed. */
export async function listVendorMembersForVendor(supabase: SupabaseClient, vendorId: string): Promise<VendorMemberRow[]> {
  const { data, error } = await supabase
    .from("vendor_members")
    .select("id, vendor_id, profile_id, is_primary, revoked_at, profiles!vendor_members_profile_id_fkey(email)")
    .eq("vendor_id", vendorId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    vendorId: row.vendor_id,
    profileId: row.profile_id,
    email: row.profiles?.email ?? null,
    isPrimary: row.is_primary,
    revokedAt: row.revoked_at,
  }));
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

/** P5.2 Phase C — wires the previously-dormant bid_questions_vendor_
 *  insert policy (schema/015, tightened by schema/026) for real use.
 *  Two columns deliberately override their own DB defaults, both
 *  required by schema/026's WITH CHECK / the pre-existing
 *  bid_questions_recorded_by_self trigger:
 *  - recorded_by's column default is `auth.uid()` UNCONDITIONALLY (it
 *    predates the vendor-submitted case) — explicitly nulling it here
 *    is what keeps a vendor-submitted row from tripping "recorded_by
 *    must be null for vendor_submitted rows."
 *  - visible_to_all_vendors defaults to true — explicitly forcing
 *    false here is what schema/026's WITH CHECK now requires: a
 *    vendor's own question is private (visible only to that vendor and
 *    staff) until a staff member deliberately broadens it, never
 *    auto-broadcast to competing vendors. */
export async function askVendorBidQuestion(supabase: SupabaseClient, bidPackageId: string, vendorId: string, questionText: string) {
  if (!questionText.trim()) return { error: "Question text is required." };
  const { error } = await supabase.from("bid_questions").insert({
    bid_package_id: bidPackageId,
    vendor_id: vendorId,
    source: "vendor_submitted",
    recorded_by: null,
    question_text: questionText.trim(),
    visible_to_all_vendors: false,
  });
  if (error) return { error: error.message };
  return {};
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

// ---------------------------------------------------------------------
// P5.2 Phase C — addendum acknowledgment tracking (schema/026's new
// bid_addendum_acknowledgments). Both list functions resolve the
// package's own addendum ids FIRST (via the already-proven
// listBidAddenda/listVendorVisibleBidAddenda) and query
// bid_addendum_acknowledgments with `.in(...)` against that — never a
// PostgREST embed through bid_addenda, matching this file's own
// established "separate query per relationship, never an ambiguous
// embed" convention (see listBidQuestions' own doc comment). RLS
// (bid_addendum_acknowledgments_staff_read/vendor_read, schema/026)
// does the actual isolation work in every case below; these are typed,
// honest reads on top of it.
// ---------------------------------------------------------------------

export interface BidAddendumAcknowledgmentRow {
  id: string;
  bidAddendumId: string;
  vendorId: string;
  vendorName: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string;
}

function mapBidAddendumAcknowledgment(row: any): BidAddendumAcknowledgmentRow {
  return {
    id: row.id,
    bidAddendumId: row.bid_addendum_id,
    vendorId: row.vendor_id,
    vendorName: row.vendors?.name ?? "Unknown vendor",
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
  };
}

/** A vendor may insert/read only their OWN acknowledgment rows
 *  (schema/026's bid_addendum_acknowledgments_vendor_insert/vendor_read,
 *  both gated through is_vendor_member() and, for insert, a real EXISTS
 *  against bid_submissions proving this vendor is actually invited to
 *  the package the addendum belongs to) — never on behalf of another
 *  vendor, never for a package this vendor isn't invited to. Acking the
 *  same addendum twice is rejected by a real unique constraint, not
 *  merely a UI affordance; the vendor-facing screen is expected to
 *  check getVendorBidAddendumAcknowledgments() first and only show the
 *  "Acknowledge" action for addenda not yet acknowledged. */
export async function acknowledgeBidAddendum(supabase: SupabaseClient, bidAddendumId: string, vendorId: string) {
  const { error } = await supabase.from("bid_addendum_acknowledgments").insert({ bid_addendum_id: bidAddendumId, vendor_id: vendorId });
  if (error) return { error: error.message };
  return {};
}

/** Staff-side — every invited vendor's acknowledgment status for every
 *  addendum on this package (bid_addendum_acknowledgments_staff_read,
 *  schema/026 — financial-staff-only, matching this domain's own
 *  already-corrected pricing/correspondence tables). Deliberately
 *  returns only rows that EXIST (a vendor who hasn't acknowledged yet
 *  simply has no row) — the caller (BidPackageWorkspace) cross-
 *  references this against the invited-vendor list to render "not yet
 *  acknowledged" for whoever's missing, rather than this function
 *  inventing placeholder rows for something that hasn't happened. */
export async function listBidAddendumAcknowledgments(supabase: SupabaseClient, bidPackageId: string): Promise<BidAddendumAcknowledgmentRow[]> {
  const addenda = await listBidAddenda(supabase, bidPackageId);
  if (addenda.length === 0) return [];
  const { data, error } = await supabase
    .from("bid_addendum_acknowledgments")
    .select("id, bid_addendum_id, vendor_id, acknowledged_by, acknowledged_at, vendors(name)")
    .in(
      "bid_addendum_id",
      addenda.map((a) => a.id)
    )
    .order("acknowledged_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapBidAddendumAcknowledgment);
}

/** Vendor-side — this vendor's OWN acknowledgment status across every
 *  addendum on the package it's viewing, backing the "Acknowledge" /
 *  "Acknowledged on <date>" toggle per addendum on
 *  /vendor/bids/[bidPackageId]. RLS scopes the query to this vendor's
 *  own rows regardless of which vendor_id values happen to be present
 *  among the package's addenda (there is only ever one vendor session's
 *  worth of rows a vendor can read at all), so no explicit vendorId
 *  filter is needed here — matching listVendorVisibleBidQuestions'/
 *  listVendorVisibleBidAddenda's own "RLS is the only real gate" shape. */
export async function getVendorBidAddendumAcknowledgments(supabase: SupabaseClient, bidPackageId: string): Promise<BidAddendumAcknowledgmentRow[]> {
  const addenda = await listVendorVisibleBidAddenda(supabase, bidPackageId);
  if (addenda.length === 0) return [];
  const { data, error } = await supabase
    .from("bid_addendum_acknowledgments")
    .select("id, bid_addendum_id, vendor_id, acknowledged_by, acknowledged_at")
    .in(
      "bid_addendum_id",
      addenda.map((a) => a.id)
    );
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    bidAddendumId: row.bid_addendum_id,
    vendorId: row.vendor_id,
    vendorName: "",
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
  }));
}
