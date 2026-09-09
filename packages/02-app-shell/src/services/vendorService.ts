import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Vendor directory & onboarding service functions (Package P5.1), on
 * top of schema/020_vendor_directory.sql. Same "repository read
 * functions + plain write functions a Server Action wraps thinly"
 * shape as every other service in this package (CLAUDE.md's
 * AI-readiness mandate) — nothing here is called directly from a
 * component or a Server Action's own body beyond a one-line forward.
 *
 * This file is the ONE place vendor-directory business logic lives.
 * `bidService.ts`'s existing `listVendors()` (the one real vendors list
 * every Bids/Material-Orders selector already reads from) is extended
 * in that file, not duplicated here — see its own updated doc comment.
 */

// ---------------------------------------------------------------------
// Vendor core record
// ---------------------------------------------------------------------

export interface VendorDirectoryRow {
  id: string;
  orgId: string;
  name: string;
  legalName: string | null;
  website: string | null;
  trades: string[];
  serviceArea: string | null;
  preferredCommunicationMethod: string | null;
  paymentTerms: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean; // UI concept — the inverse of the DB's is_archived column, never a second stored column
  mergedIntoVendorId: string | null;
  createdAt: string;
}

const VENDOR_DIRECTORY_COLUMNS =
  "id, org_id, name, legal_name, website, trades, service_area, preferred_communication_method, payment_terms, contact_name, email, phone, address, notes, is_archived, merged_into_vendor_id, created_at";

function mapVendor(row: any): VendorDirectoryRow {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    legalName: row.legal_name,
    website: row.website,
    trades: row.trades ?? [],
    serviceArea: row.service_area,
    preferredCommunicationMethod: row.preferred_communication_method,
    paymentTerms: row.payment_terms,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: !row.is_archived,
    mergedIntoVendorId: row.merged_into_vendor_id,
    createdAt: row.created_at,
  };
}

export interface ListVendorDirectoryOptions {
  search?: string;
  trade?: string;
  /** "active" (default) | "inactive" | "all" — "inactive" and "all" both
   *  include merged-away vendors (they're archived, per the merge
   *  design), matching the brief's "all vendors including merged/
   *  archived" admin list-view requirement. */
  status?: "active" | "inactive" | "all";
}

/** The vendor DIRECTORY's own listing — shows everything, with explicit
 *  filters, unlike bidService.ts's listVendors() (selector-style,
 *  always excludes archived/merged-away). Search matches name OR legal
 *  name, case-insensitively, substring. */
export async function listVendorDirectory(
  supabase: SupabaseClient,
  orgId: string,
  options: ListVendorDirectoryOptions = {}
): Promise<VendorDirectoryRow[]> {
  let query = supabase.from("vendors").select(VENDOR_DIRECTORY_COLUMNS).eq("org_id", orgId);

  const status = options.status ?? "active";
  if (status === "active") query = query.eq("is_archived", false);
  if (status === "inactive") query = query.eq("is_archived", true);
  // status === "all": no filter.

  if (options.trade) {
    query = query.contains("trades", [options.trade]);
  }
  if (options.search && options.search.trim()) {
    const term = `%${options.search.trim()}%`;
    query = query.or(`name.ilike.${term},legal_name.ilike.${term}`);
  }

  const { data, error } = await query.order("name");
  if (error) throw error;
  return (data ?? []).map(mapVendor);
}

/** Creation form is deliberately minimal (P5.1 design): name required,
 *  email/phone optional. Everything else (trades, legal name, service
 *  area, etc.) is filled in progressively via updateVendorCoreFields()
 *  on the detail screen, never required at creation. */
export async function createVendor(supabase: SupabaseClient, orgId: string, name: string, email?: string, phone?: string) {
  const trimmedName = name.trim();
  if (!trimmedName) return { error: "Vendor name is required." };

  const { data, error } = await supabase
    .from("vendors")
    .insert({ org_id: orgId, name: trimmedName, email: email?.trim() || null, phone: phone?.trim() || null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

export interface VendorCoreFieldUpdate {
  legalName?: string | null;
  website?: string | null;
  trades?: string[] | null;
  serviceArea?: string | null;
  preferredCommunicationMethod?: string | null;
  paymentTerms?: string | null;
  address?: string | null;
  notes?: string | null;
}

export async function updateVendorCoreFields(supabase: SupabaseClient, vendorId: string, fields: VendorCoreFieldUpdate) {
  const patch: Record<string, unknown> = {};
  if ("legalName" in fields) patch.legal_name = fields.legalName || null;
  if ("website" in fields) patch.website = fields.website || null;
  if ("trades" in fields) patch.trades = fields.trades && fields.trades.length > 0 ? fields.trades : null;
  if ("serviceArea" in fields) patch.service_area = fields.serviceArea || null;
  if ("preferredCommunicationMethod" in fields) patch.preferred_communication_method = fields.preferredCommunicationMethod || null;
  if ("paymentTerms" in fields) patch.payment_terms = fields.paymentTerms || null;
  if ("address" in fields) patch.address = fields.address || null;
  if ("notes" in fields) patch.notes = fields.notes || null;

  if (Object.keys(patch).length === 0) return {};

  const { error } = await supabase.from("vendors").update(patch).eq("id", vendorId);
  if (error) return { error: error.message };
  return {};
}

/** Archive/reactivate — the "active/inactive toggle with confirm" the
 *  detail screen's Overview section calls. Reactivating a vendor that
 *  is currently merged-away is refused: unmergeVendor() is the correct
 *  path for that (reactivating without clearing merged_into_vendor_id
 *  would violate the vendors_merged_implies_archived DB constraint
 *  anyway, but this returns a clear error before ever reaching it). */
export async function setVendorArchived(supabase: SupabaseClient, vendorId: string, archived: boolean) {
  if (!archived) {
    const { data: vendor, error: readError } = await supabase.from("vendors").select("merged_into_vendor_id").eq("id", vendorId).maybeSingle();
    if (readError) return { error: readError.message };
    if (vendor?.merged_into_vendor_id) {
      return { error: "This vendor is merged into another vendor. Use Unmerge to restore it, not the active/inactive toggle." };
    }
  }
  const { error } = await supabase.from("vendors").update({ is_archived: archived }).eq("id", vendorId);
  if (error) return { error: error.message };
  return {};
}

// ---------------------------------------------------------------------
// Duplicate detection — exact-normalized-match only (P5.1 design,
// matching P4's QuickBooks import duplicate-expense precedent). A
// warning object, never a thrown error or a block.
// ---------------------------------------------------------------------

const VENDOR_NAME_SUFFIX_PATTERN = /\b(llc|inc|incorporated|co|corp|corporation)\b/g;

/** Exported for direct unit testing. Lowercase, trim, strip
 *  punctuation, strip common legal-entity suffixes as whole words,
 *  collapse whitespace. */
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(VENDOR_NAME_SUFFIX_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeVendorEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface VendorDuplicateWarning {
  matchedVendorId: string;
  matchedVendorName: string;
  matchType: "name" | "email";
}

/** Never throws/blocks — returns a warning object the UI surfaces as a
 *  dismissible inline notice, per the P5.1 design's explicit
 *  instruction. Checks against every vendor in the org, active or
 *  archived (re-creating a vendor that was previously archived is
 *  still worth warning about). */
export async function checkVendorDuplicate(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  email?: string
): Promise<{ warning?: VendorDuplicateWarning }> {
  const { data, error } = await supabase.from("vendors").select("id, name, email").eq("org_id", orgId);
  if (error) throw error;

  const candidates = (data ?? []) as { id: string; name: string; email: string | null }[];
  const normalizedName = normalizeVendorName(name);
  const normalizedEmail = email ? normalizeVendorEmail(email) : null;

  if (normalizedName) {
    const nameMatch = candidates.find((v) => normalizeVendorName(v.name) === normalizedName);
    if (nameMatch) {
      return { warning: { matchedVendorId: nameMatch.id, matchedVendorName: nameMatch.name, matchType: "name" } };
    }
  }
  if (normalizedEmail) {
    const emailMatch = candidates.find((v) => v.email && normalizeVendorEmail(v.email) === normalizedEmail);
    if (emailMatch) {
      return { warning: { matchedVendorId: emailMatch.id, matchedVendorName: emailMatch.name, matchType: "email" } };
    }
  }
  return {};
}

// ---------------------------------------------------------------------
// Merge / unmerge — never rewrites history (P5.1 design). The database
// (schema/020: vendors_merged_implies_archived CHECK,
// enforce_vendor_merge_no_chain trigger) is the ultimate enforcement;
// the checks here exist to return a clear, specific error BEFORE the
// write is attempted, and are directly unit-testable without a
// database.
// ---------------------------------------------------------------------

export async function mergeVendors(supabase: SupabaseClient, loserVendorId: string, survivorVendorId: string) {
  if (!loserVendorId || !survivorVendorId) return { error: "Both a vendor to merge and a survivor vendor are required." };
  if (loserVendorId === survivorVendorId) return { error: "Cannot merge a vendor into itself." };

  const { data: survivor, error: survivorError } = await supabase
    .from("vendors")
    .select("id, merged_into_vendor_id")
    .eq("id", survivorVendorId)
    .maybeSingle();
  if (survivorError) return { error: survivorError.message };
  if (!survivor) return { error: "Survivor vendor not found." };
  if (survivor.merged_into_vendor_id) {
    return {
      error:
        "The selected survivor is itself already merged into another vendor. Resolve to the ultimate survivor and merge into that vendor directly instead (no merge chains).",
    };
  }

  const { error } = await supabase
    .from("vendors")
    .update({ merged_into_vendor_id: survivorVendorId, is_archived: true })
    .eq("id", loserVendorId);
  if (error) return { error: error.message };
  return {};
}

export async function unmergeVendor(supabase: SupabaseClient, vendorId: string) {
  const { error } = await supabase.from("vendors").update({ merged_into_vendor_id: null, is_archived: false }).eq("id", vendorId);
  if (error) return { error: error.message };
  return {};
}

// ---------------------------------------------------------------------
// Contacts — vendor_contacts is the one real source of truth going
// forward; vendors.contact_name/email/phone become a kept-in-sync
// mirror of whichever row is flagged is_primary_bidding_contact, so
// every existing reader of those columns (bid invites, material-order
// vendor selection) keeps working unchanged (P5.1 design, Section 12).
// ---------------------------------------------------------------------

export interface VendorContactRow {
  id: string;
  vendorId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimaryBiddingContact: boolean;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
}

function mapContact(row: any): VendorContactRow {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    isPrimaryBiddingContact: row.is_primary_bidding_contact,
    notes: row.notes,
    isArchived: row.is_archived,
    createdAt: row.created_at,
  };
}

export async function listVendorContacts(supabase: SupabaseClient, vendorId: string): Promise<VendorContactRow[]> {
  const { data, error } = await supabase
    .from("vendor_contacts")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("is_primary_bidding_contact", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map(mapContact);
}

export interface UpsertVendorContactInput {
  id?: string; // present => update; absent => insert
  vendorId: string;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimaryBiddingContact?: boolean;
  notes?: string | null;
}

/** Judgment call (not stated explicitly by the brief, but implied by
 *  "vendors.contact_name becomes a mirror of WHICHEVER row is flagged
 *  primary" — singular): only one contact per vendor may be flagged
 *  primary at a time. When this call sets isPrimaryBiddingContact=true,
 *  every other contact on the same vendor is unset first (two
 *  sequential writes, same non-transactional multi-step pattern
 *  procurementService.ts's recordReceivedQuantity() already uses in
 *  this codebase), then the mirror columns on `vendors` are updated to
 *  match — never edited independently of this function. */
export async function upsertVendorContact(supabase: SupabaseClient, input: UpsertVendorContactInput) {
  const trimmedName = input.name?.trim();
  if (!trimmedName) return { error: "Contact name is required." };

  if (input.isPrimaryBiddingContact) {
    const { error: clearError } = await supabase
      .from("vendor_contacts")
      .update({ is_primary_bidding_contact: false })
      .eq("vendor_id", input.vendorId)
      .eq("is_primary_bidding_contact", true);
    if (clearError) return { error: clearError.message };
  }

  const payload = {
    vendor_id: input.vendorId,
    name: trimmedName,
    title: input.title || null,
    email: input.email || null,
    phone: input.phone || null,
    is_primary_bidding_contact: !!input.isPrimaryBiddingContact,
    notes: input.notes || null,
  };

  const { data, error } = input.id
    ? await supabase.from("vendor_contacts").update(payload).eq("id", input.id).select("id").single()
    : await supabase.from("vendor_contacts").insert(payload).select("id").single();
  if (error) return { error: error.message };

  if (input.isPrimaryBiddingContact) {
    const { error: mirrorError } = await supabase
      .from("vendors")
      .update({ contact_name: trimmedName, email: input.email || null, phone: input.phone || null })
      .eq("id", input.vendorId);
    if (mirrorError) return { error: mirrorError.message };
  }

  return { id: data.id as string };
}

export async function archiveVendorContact(supabase: SupabaseClient, contactId: string) {
  const { error } = await supabase.from("vendor_contacts").update({ is_archived: true }).eq("id", contactId);
  if (error) return { error: error.message };
  return {};
}

// ---------------------------------------------------------------------
// Compliance documents. Status is a real, explicit, staff-set field —
// never derived purely from storage_key presence.
// ---------------------------------------------------------------------

export type VendorDocumentCategory = "w9" | "certificate_of_insurance" | "license" | "other";
export type VendorDocumentStatus = "missing" | "requested" | "received" | "verified" | "expired" | "not_applicable";

const VENDOR_DOCUMENT_STATUSES: VendorDocumentStatus[] = ["missing", "requested", "received", "verified", "expired", "not_applicable"];

export interface VendorDocumentRow {
  id: string;
  vendorId: string;
  orgId: string;
  category: VendorDocumentCategory;
  status: VendorDocumentStatus;
  expirationDate: string | null;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  version: number;
  supersededById: string | null;
  createdAt: string;
}

function mapDocument(row: any): VendorDocumentRow {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    orgId: row.org_id,
    category: row.category,
    status: row.status,
    expirationDate: row.expiration_date,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    version: row.version,
    supersededById: row.superseded_by_id,
    createdAt: row.created_at,
  };
}

/** Every vendor_documents row this vendor has, current AND superseded
 *  (the detail screen's Compliance section shows the current row per
 *  category; superseded rows remain queryable via supersededById for a
 *  future "view previous version" affordance, matching this codebase's
 *  general never-delete-history posture — not built as a UI in this
 *  package, since the brief doesn't ask for it, but the data supports
 *  it without any further schema work). */
export async function listVendorDocuments(supabase: SupabaseClient, vendorId: string): Promise<VendorDocumentRow[]> {
  const { data, error } = await supabase.from("vendor_documents").select("*").eq("vendor_id", vendorId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapDocument);
}

/** Records a real file upload. If a current (non-superseded) row
 *  already exists for this vendor+category, this creates a new,
 *  incremented-version row and marks the old one superseded — the same
 *  claim-old/insert-new/link shape issue_document() uses for issued
 *  PDFs (schema/015), applied here at the service layer since
 *  vendor_documents has no dedicated RPC. Sets status='received'
 *  (a file exists now) unless the caller explicitly overrides it. */
export async function recordVendorDocumentUpload(
  supabase: SupabaseClient,
  params: {
    vendorId: string;
    orgId: string;
    category: VendorDocumentCategory;
    storageKey: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    uploadedBy: string;
    expirationDate?: string | null;
    status?: VendorDocumentStatus;
  }
) {
  const { data: current, error: currentError } = await supabase
    .from("vendor_documents")
    .select("id, version")
    .eq("vendor_id", params.vendorId)
    .eq("category", params.category)
    .is("superseded_by_id", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (currentError) return { error: currentError.message };

  const nextVersion = current ? current.version + 1 : 1;

  const { data: inserted, error: insertError } = await supabase
    .from("vendor_documents")
    .insert({
      vendor_id: params.vendorId,
      org_id: params.orgId,
      category: params.category,
      status: params.status ?? "received",
      expiration_date: params.expirationDate ?? null,
      storage_key: params.storageKey,
      mime_type: params.mimeType ?? null,
      size_bytes: params.sizeBytes ?? null,
      version: nextVersion,
      uploaded_by: params.uploadedBy,
    })
    .select("id")
    .single();
  if (insertError) return { error: insertError.message };

  if (current) {
    const { error: supersedeError } = await supabase.from("vendor_documents").update({ superseded_by_id: inserted.id }).eq("id", current.id);
    if (supersedeError) return { error: supersedeError.message };
  }

  return { id: inserted.id as string };
}

/** Ensures a row exists for this vendor+category (creating a
 *  status='missing' placeholder if none does yet), then updates its
 *  status/expiration in place — no new version, since no file changed.
 *  Validates the status vocabulary before ever reaching the database
 *  (the DB's own CHECK constraint is the ultimate enforcement; this is
 *  the same "reject before .from() is called" seam every other service
 *  function in this codebase already provides for its own unit tests). */
export async function setVendorDocumentStatus(
  supabase: SupabaseClient,
  params: { vendorId: string; orgId: string; category: VendorDocumentCategory; status: VendorDocumentStatus; expirationDate?: string | null }
) {
  if (!VENDOR_DOCUMENT_STATUSES.includes(params.status)) {
    return { error: `"${params.status}" is not a valid vendor document status. Valid values: ${VENDOR_DOCUMENT_STATUSES.join(", ")}.` };
  }

  const { data: current, error: currentError } = await supabase
    .from("vendor_documents")
    .select("id")
    .eq("vendor_id", params.vendorId)
    .eq("category", params.category)
    .is("superseded_by_id", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (currentError) return { error: currentError.message };

  if (!current) {
    const { error: insertError } = await supabase.from("vendor_documents").insert({
      vendor_id: params.vendorId,
      org_id: params.orgId,
      category: params.category,
      status: params.status,
      expiration_date: params.expirationDate ?? null,
    });
    if (insertError) return { error: insertError.message };
    return {};
  }

  const patch: Record<string, unknown> = { status: params.status };
  if ("expirationDate" in params) patch.expiration_date = params.expirationDate ?? null;
  const { error: updateError } = await supabase.from("vendor_documents").update(patch).eq("id", current.id);
  if (updateError) return { error: updateError.message };
  return {};
}

/** Atomic (from the caller's perspective): fetches the document row
 *  through the CALLER'S OWN RLS-scoped client (so a non-accounting
 *  staff session gets nothing back for a category='w9' row — the same
 *  denial-by-omission shape `canViewDocument()` already uses elsewhere
 *  in this codebase, never confirming existence to an unauthorized
 *  caller), resolves the actual signed URL via the injected
 *  `resolveSignedUrl` callback, and writes the vendor_document_access_log
 *  row in the same call — a caller can never obtain the URL without the
 *  access being logged. `resolveSignedUrl` is injected (rather than
 *  this file importing apps/web's StorageAdapter directly) to keep this
 *  package free of any apps/web-layout dependency, matching every other
 *  service in this file — the Route Handler that calls this constructs
 *  the real adapter and passes a thin closure. */
export async function getW9DownloadUrl(
  supabase: SupabaseClient,
  vendorDocumentId: string,
  accessedByProfileId: string,
  resolveSignedUrl: (storageKey: string) => Promise<string>
): Promise<{ url?: string; error?: string }> {
  const { data: doc, error } = await supabase.from("vendor_documents").select("id, category, storage_key").eq("id", vendorDocumentId).maybeSingle();
  if (error) return { error: error.message };
  if (!doc) return { error: "Document not found." };
  if (doc.category !== "w9") return { error: "getW9DownloadUrl is only for category='w9' documents." };
  if (!doc.storage_key) return { error: "No file has been uploaded for this document yet." };

  const url = await resolveSignedUrl(doc.storage_key);

  const { error: logError } = await supabase
    .from("vendor_document_access_log")
    .insert({ vendor_document_id: vendorDocumentId, accessed_by: accessedByProfileId, action: "downloaded" });
  if (logError) return { error: `A signed URL was generated, but writing the access log failed — the download was NOT returned: ${logError.message}` };

  return { url };
}

// ---------------------------------------------------------------------
// Onboarding status badge — a derived DISPLAY value, never a stored
// rollup column (P5.1 design's explicit instruction). Pure function,
// directly unit-testable.
// ---------------------------------------------------------------------

export type VendorOnboardingStatusTone = "success" | "warning" | "error" | "neutral";

export interface VendorOnboardingStatus {
  label: string;
  tone: VendorOnboardingStatusTone;
}

const EXPIRING_SOON_WINDOW_DAYS = 30;

/** Priority, highest first: W-9 missing/requested > any expired doc >
 *  any doc expiring within 30 days > up to date > no documents at all
 *  yet. `now` is injectable for deterministic unit tests. */
export function summarizeVendorOnboardingStatus(
  documents: Pick<VendorDocumentRow, "category" | "status" | "expirationDate">[],
  now: Date = new Date()
): VendorOnboardingStatus {
  if (documents.length === 0) {
    return { label: "Onboarding not started", tone: "neutral" };
  }

  const w9 = documents.find((d) => d.category === "w9");
  if (!w9 || w9.status === "missing" || w9.status === "requested") {
    return { label: "W-9 missing", tone: "error" };
  }

  const withExpiration = documents.filter((d) => d.expirationDate && d.status !== "not_applicable");
  const isExpired = (d: (typeof withExpiration)[number]) => d.status === "expired" || (d.expirationDate ? new Date(d.expirationDate) < now : false);
  if (withExpiration.some(isExpired)) {
    return { label: "Document expired", tone: "error" };
  }

  const soonThreshold = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const isExpiringSoon = (d: (typeof withExpiration)[number]) => (d.expirationDate ? new Date(d.expirationDate) <= soonThreshold : false);
  if (withExpiration.some(isExpiringSoon)) {
    return { label: "Expiring soon", tone: "warning" };
  }

  return { label: "Up to date", tone: "success" };
}

// ---------------------------------------------------------------------
// Vendor detail + merged-vendor-aware history. No new table — a
// read-only UNION-shaped query across bid_submissions/committed_costs/
// issued_documents/material_orders, resolving both this vendor's own
// vendor_id AND any vendor(s) merged into it, so historical activity is
// visible in one place without ever rewriting a row (P5.1 design).
// ---------------------------------------------------------------------

export interface VendorHistoryEntry {
  sourceType: "bid_submission" | "material_order" | "committed_cost" | "issued_document";
  id: string;
  label: string;
  amountCents: number | null;
  status: string | null;
  occurredAt: string;
  /** Which physical vendor row this entry actually came from — may
   *  differ from the vendor whose history is being viewed when this
   *  entry belongs to a vendor that was later merged INTO it. */
  fromVendorId: string;
}

export interface VendorDetail extends VendorDirectoryRow {
  contacts: VendorContactRow[];
  documents: VendorDocumentRow[];
  onboardingStatus: VendorOnboardingStatus;
  /** Set only when THIS vendor itself is the merge loser. */
  mergedIntoVendorName: string | null;
  history: VendorHistoryEntry[];
}

export async function getVendorDetail(supabase: SupabaseClient, vendorId: string): Promise<VendorDetail | null> {
  const { data: vendorRow, error: vendorError } = await supabase.from("vendors").select(VENDOR_DIRECTORY_COLUMNS).eq("id", vendorId).maybeSingle();
  if (vendorError) throw vendorError;
  if (!vendorRow) return null;

  const [contacts, documents, mergedIntoRow] = await Promise.all([
    listVendorContacts(supabase, vendorId),
    listVendorDocuments(supabase, vendorId),
    vendorRow.merged_into_vendor_id
      ? supabase.from("vendors").select("name").eq("id", vendorRow.merged_into_vendor_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const currentDocuments = documents.filter((d) => !d.supersededById);
  const history = await getVendorHistory(supabase, vendorId);

  return {
    ...mapVendor(vendorRow),
    contacts,
    documents,
    onboardingStatus: summarizeVendorOnboardingStatus(currentDocuments),
    mergedIntoVendorName: mergedIntoRow?.name ?? null,
    history,
  };
}

export async function getVendorHistory(supabase: SupabaseClient, vendorId: string): Promise<VendorHistoryEntry[]> {
  const { data: mergedAwayRows, error: mergedAwayError } = await supabase.from("vendors").select("id").eq("merged_into_vendor_id", vendorId);
  if (mergedAwayError) throw mergedAwayError;
  const vendorIds = [vendorId, ...(mergedAwayRows ?? []).map((r: any) => r.id)];

  const [bidSubsResult, ordersResult] = await Promise.all([
    supabase
      .from("bid_submissions")
      .select("id, bid_package_id, vendor_id, status, amount_cents, submitted_at, created_at, bid_packages(title)")
      .in("vendor_id", vendorIds),
    supabase.from("material_orders").select("id, vendor_id, order_number, status, ordered_at, created_at").in("vendor_id", vendorIds),
  ]);
  if (bidSubsResult.error) throw bidSubsResult.error;
  if (ordersResult.error) throw ordersResult.error;

  const bidSubs = (bidSubsResult.data ?? []) as any[];
  const orders = (ordersResult.data ?? []) as any[];

  const bidPackageIds = Array.from(new Set(bidSubs.map((s) => s.bid_package_id)));
  const orderIds = orders.map((o) => o.id);

  const [committedFromBids, committedFromOrders, subcontracts, purchaseOrders] = await Promise.all([
    bidSubs.length
      ? supabase.from("committed_costs").select("id, source_id, amount_cents, status, created_at").eq("source_type", "bid_submission").in("source_id", bidSubs.map((s) => s.id))
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? supabase.from("committed_costs").select("id, source_id, amount_cents, status, created_at").eq("source_type", "material_order").in("source_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    bidPackageIds.length
      ? supabase.from("issued_documents").select("id, source_id, document_number, version, issued_at").eq("document_type", "subcontract").in("source_id", bidPackageIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? supabase.from("issued_documents").select("id, source_id, document_number, version, issued_at").eq("document_type", "purchase_order").in("source_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (committedFromBids.error) throw committedFromBids.error;
  if (committedFromOrders.error) throw committedFromOrders.error;
  if (subcontracts.error) throw subcontracts.error;
  if (purchaseOrders.error) throw purchaseOrders.error;

  const bidSubById = new Map(bidSubs.map((s) => [s.id, s]));
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const entries: VendorHistoryEntry[] = [];

  for (const sub of bidSubs) {
    entries.push({
      sourceType: "bid_submission",
      id: sub.id,
      label: `Bid: ${sub.bid_packages?.title ?? "Untitled bid package"}`,
      amountCents: sub.amount_cents,
      status: sub.status,
      occurredAt: sub.submitted_at ?? sub.created_at,
      fromVendorId: sub.vendor_id,
    });
  }
  for (const order of orders) {
    entries.push({
      sourceType: "material_order",
      id: order.id,
      label: `Material order: ${order.order_number ?? order.id.slice(0, 8)}`,
      amountCents: null,
      status: order.status,
      occurredAt: order.ordered_at ?? order.created_at,
      fromVendorId: order.vendor_id,
    });
  }
  for (const cc of (committedFromBids.data ?? []) as any[]) {
    const sub = bidSubById.get(cc.source_id);
    entries.push({
      sourceType: "committed_cost",
      id: cc.id,
      label: "Commitment (from awarded bid)",
      amountCents: cc.amount_cents,
      status: cc.status,
      occurredAt: cc.created_at,
      fromVendorId: sub?.vendor_id ?? vendorId,
    });
  }
  for (const cc of (committedFromOrders.data ?? []) as any[]) {
    const order = orderById.get(cc.source_id);
    entries.push({
      sourceType: "committed_cost",
      id: cc.id,
      label: "Commitment (from material order)",
      amountCents: cc.amount_cents,
      status: cc.status,
      occurredAt: cc.created_at,
      fromVendorId: order?.vendor_id ?? vendorId,
    });
  }
  for (const doc of (subcontracts.data ?? []) as any[]) {
    entries.push({
      sourceType: "issued_document",
      id: doc.id,
      label: `Subcontract ${doc.document_number} (v${doc.version})`,
      amountCents: null,
      status: null,
      occurredAt: doc.issued_at,
      fromVendorId: vendorId,
    });
  }
  for (const doc of (purchaseOrders.data ?? []) as any[]) {
    const order = orderById.get(doc.source_id);
    entries.push({
      sourceType: "issued_document",
      id: doc.id,
      label: `Purchase order ${doc.document_number} (v${doc.version})`,
      amountCents: null,
      status: null,
      occurredAt: doc.issued_at,
      fromVendorId: order?.vendor_id ?? vendorId,
    });
  }

  entries.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  return entries;
}
