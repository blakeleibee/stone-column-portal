import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailService } from "./email/getEmailService";
import type { EmailSendStatus } from "./email/EmailService";
import { NOTIFICATION_FROM_ADDRESS, buildReplyToAddress } from "./email/constants";

/**
 * P5.2 Phase D — bid package correspondence (entity_messages), real
 * email delivery for outbound notifications, and the inbound-reply-
 * token lifecycle. See schema/028_bid_correspondence_and_inbound_email.sql
 * for the full RLS/ownership-scoping reasoning this service relies on
 * entirely — every function here is a typed, honest read/write on top
 * of that RLS, matching bidService.ts's own established "RLS is the
 * real gate" philosophy throughout this domain.
 */

export interface EntityMessageAttachmentRow {
  id: string;
  documentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface EntityMessageRow {
  id: string;
  bidPackageId: string;
  vendorId: string;
  direction: "outbound" | "inbound";
  sender: string;
  recipient: string;
  subject: string | null;
  body: string;
  sentAt: string | null;
  receivedAt: string | null;
  deliveryStatus: string | null;
  createdBy: string | null;
  createdAt: string;
  attachments: EntityMessageAttachmentRow[];
}

const ENTITY_MESSAGE_SELECT =
  "id, bid_package_id, vendor_id, direction, sender, recipient, subject, body, sent_at, received_at, delivery_status, created_by, created_at";

function mapEntityMessage(row: any): Omit<EntityMessageRow, "attachments"> {
  return {
    id: row.id,
    bidPackageId: row.bid_package_id,
    vendorId: row.vendor_id,
    direction: row.direction,
    sender: row.sender,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    deliveryStatus: row.delivery_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Reads a single vendor's private thread on a bid package, oldest
 * first, with attachments resolved in ONE batched follow-up query
 * (never N+1) — matching getBidPackageDetail()'s own established shape
 * for exactly this reason. Used identically by both sides: staff calls
 * it with a vendorId they picked from the invited-vendors list; a
 * vendor session calls it with its own vendorId, and RLS
 * (entity_messages_vendor_read) restricts what actually comes back to
 * that vendor's own rows regardless of which vendorId value is passed —
 * the same "RLS is the only real gate" posture as
 * getVendorBidAddendumAcknowledgments() etc.
 */
export async function listEntityMessages(supabase: SupabaseClient, bidPackageId: string, vendorId: string): Promise<EntityMessageRow[]> {
  const { data, error } = await supabase
    .from("entity_messages")
    .select(ENTITY_MESSAGE_SELECT)
    .eq("bid_package_id", bidPackageId)
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []).map(mapEntityMessage);
  const ids = rows.map((r) => r.id);
  const attachmentsByMessageId = new Map<string, EntityMessageAttachmentRow[]>();

  if (ids.length > 0) {
    const { data: attachRows, error: attachError } = await supabase
      .from("entity_message_attachments")
      .select("id, entity_message_id, document_id, documents(file_name, mime_type, size_bytes)")
      .in("entity_message_id", ids);
    if (attachError) throw attachError;
    for (const row of attachRows ?? []) {
      const mapped: EntityMessageAttachmentRow = {
        id: row.id,
        documentId: row.document_id,
        fileName: (row as any).documents?.file_name ?? "Unknown file",
        mimeType: (row as any).documents?.mime_type ?? "application/octet-stream",
        sizeBytes: (row as any).documents?.size_bytes ?? 0,
      };
      const list = attachmentsByMessageId.get(row.entity_message_id) ?? [];
      list.push(mapped);
      attachmentsByMessageId.set(row.entity_message_id, list);
    }
  }

  return rows.map((r) => ({ ...r, attachments: attachmentsByMessageId.get(r.id) ?? [] }));
}

/**
 * Get-or-create the one reply token for a (bid_package, vendor) pair
 * (schema/028's own one-per-pair decision). No UI in this phase ever
 * revokes a token, so the only handled outcomes are "already exists and
 * active" and "doesn't exist yet" — an existing REVOKED row (which
 * nothing in this phase's shipped surface can create) is reported as a
 * clear error rather than silently reactivated, since silently
 * reactivating a deliberately-revoked address would defeat the entire
 * point of revoking it.
 */
export async function ensureInboundReplyToken(
  supabase: SupabaseClient,
  bidPackageId: string,
  vendorId: string
): Promise<{ token: string } | { error: string }> {
  const { data: existing, error: existingError } = await supabase
    .from("inbound_reply_tokens")
    .select("token, revoked_at")
    .eq("bid_package_id", bidPackageId)
    .eq("vendor_id", vendorId)
    .maybeSingle();
  if (existingError) return { error: existingError.message };

  if (existing) {
    if (existing.revoked_at) {
      return { error: "This thread's reply address has been revoked. Contact an administrator before sending further outbound messages." };
    }
    return { token: existing.token as string };
  }

  const { data: created, error: createError } = await supabase
    .from("inbound_reply_tokens")
    .insert({ bid_package_id: bidPackageId, vendor_id: vendorId })
    .select("token")
    .single();
  if (createError) return { error: createError.message };
  return { token: created.token as string };
}

export interface SendAndRecordParams {
  bidPackageId: string;
  vendorId: string;
  to: string;
  subject: string;
  body: string;
  /** The staff session's own profile id — entity_messages' provenance
   *  trigger requires this to equal the inserting session's real
   *  auth.uid(), so this must always be the CALLING session's own id,
   *  never a value chosen on someone else's behalf. */
  createdBy: string;
  replyToToken?: string | null;
}

export interface SendAndRecordResult {
  messageId?: string;
  emailStatus: EmailSendStatus;
  emailError?: string;
  error?: string;
}

/**
 * The one real place EmailService.send() and an entity_messages insert
 * happen together — used by BOTH inviteVendor() (bidService.ts) and
 * sendStaffMessage() below, so an invitation email and an ordinary
 * staff-composed message are recorded into the exact same permanent
 * thread with identical honesty guarantees, never two different code
 * paths that could drift. delivery_status/sent_at are set from the
 * EmailService result itself — never assumed — and sent_at is left
 * null unless the provider actually reported 'sent' (CLAUDE.md's "never
 * claim delivery that didn't happen," applied to a timestamp, not just
 * a status string).
 */
export async function sendAndRecordOutboundMessage(supabase: SupabaseClient, params: SendAndRecordParams): Promise<SendAndRecordResult> {
  const emailService = getEmailService();
  const replyTo = params.replyToToken ? buildReplyToAddress(params.replyToToken) : undefined;

  const sendResult = await emailService.send({
    to: params.to,
    from: NOTIFICATION_FROM_ADDRESS,
    subject: params.subject,
    text: params.body,
    replyTo,
  });

  const { data, error } = await supabase
    .from("entity_messages")
    .insert({
      bid_package_id: params.bidPackageId,
      vendor_id: params.vendorId,
      direction: "outbound",
      sender: NOTIFICATION_FROM_ADDRESS,
      recipient: params.to,
      subject: params.subject,
      body: params.body,
      sent_at: sendResult.status === "sent" ? new Date().toISOString() : null,
      delivery_status: sendResult.status,
      provider_message_id: sendResult.providerMessageId,
      created_by: params.createdBy,
    })
    .select("id")
    .single();

  if (error) {
    return { emailStatus: sendResult.status, emailError: sendResult.error, error: error.message };
  }
  return { messageId: data.id as string, emailStatus: sendResult.status, emailError: sendResult.error };
}

/** Staff-composed outbound message on a specific vendor's thread — the
 *  BidPackageWorkspace "compose and send" action. Resolves the vendor's
 *  canonical bidding email itself (never trusts a client-supplied
 *  recipient) and ensures a reply token exists so the vendor's normal
 *  email "Reply" button routes back into this same thread. */
export async function sendStaffMessage(
  supabase: SupabaseClient,
  params: { bidPackageId: string; vendorId: string; subject?: string; body: string; staffProfileId: string }
): Promise<{ messageId?: string; emailStatus?: EmailSendStatus; emailError?: string; recipientEmail?: string; error?: string }> {
  if (!params.body.trim()) return { error: "Message body is required." };

  const { data: vendorRow, error: vendorError } = await supabase.from("vendors").select("email").eq("id", params.vendorId).maybeSingle();
  if (vendorError) return { error: vendorError.message };
  if (!vendorRow?.email) {
    return { error: "This vendor has no bidding email on file — add one from the vendor directory before sending a message." };
  }

  const tokenResult = await ensureInboundReplyToken(supabase, params.bidPackageId, params.vendorId);
  if ("error" in tokenResult) return { error: tokenResult.error };

  const result = await sendAndRecordOutboundMessage(supabase, {
    bidPackageId: params.bidPackageId,
    vendorId: params.vendorId,
    to: vendorRow.email,
    subject: params.subject?.trim() || "Message from Stone Column Custom Homes",
    body: params.body.trim(),
    createdBy: params.staffProfileId,
    replyToToken: tokenResult.token,
  });
  if (result.error) return { error: result.error };
  return { messageId: result.messageId, emailStatus: result.emailStatus, emailError: result.emailError, recipientEmail: vendorRow.email };
}

/** Vendor-composed portal message — always 'inbound' (from Stone
 *  Column's perspective), never routed through EmailService at all:
 *  staff monitors the portal thread directly, so there is no outbound
 *  send to record here, only the permanent record itself. Resolves
 *  `sender` to the calling session's own auth email where available
 *  (an honest, specific attribution) falling back to the vendor
 *  company's own on-file email. */
export async function sendVendorMessage(
  supabase: SupabaseClient,
  params: { bidPackageId: string; vendorId: string; body: string }
): Promise<{ messageId?: string; error?: string }> {
  if (!params.body.trim()) return { error: "Message body is required." };

  let senderEmail: string | null = null;
  const { data: userRes } = await supabase.auth.getUser();
  senderEmail = userRes.user?.email ?? null;
  if (!senderEmail) {
    const { data: vendorRow } = await supabase.from("vendors").select("email").eq("id", params.vendorId).maybeSingle();
    senderEmail = vendorRow?.email ?? "vendor";
  }

  const { data, error } = await supabase
    .from("entity_messages")
    .insert({
      bid_package_id: params.bidPackageId,
      vendor_id: params.vendorId,
      direction: "inbound",
      sender: senderEmail,
      recipient: NOTIFICATION_FROM_ADDRESS,
      body: params.body.trim(),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { messageId: data.id as string };
}

// =====================================================================
// Inbound-webhook support — every function below is designed to be
// called with a SERVICE-ROLE client (apps/web/src/server/supabase/
// serviceRoleClient.ts), since the Route Handler that calls them has no
// user session at all (Resend's webhook call carries no Supabase auth
// context). RLS is bypassed entirely for a service-role client, which
// is the correct, intentional boundary here — see schema/028's own
// comments on entity_messages' provenance trigger, whose auth.uid() IS
// NULL branch is written specifically for this caller.
// =====================================================================

export type ReplyTokenResolution =
  | { kind: "resolved"; bidPackageId: string; vendorId: string }
  | { kind: "unmatched_token" }
  | { kind: "revoked_vendor"; bidPackageId: string; vendorId: string };

/** Step 1 of inbound processing (design doc Section 5, Part E): resolve
 *  the opaque reply token to a (bid_package, vendor) pair, THEN
 *  separately confirm the vendor's membership is still active — a
 *  revoked vendor's token must not resolve to a usable thread even
 *  though the token row itself was never individually revoked (schema/
 *  028's own "access is computed live, no second write path to keep in
 *  sync" philosophy, identical to is_invited_vendor_for_bid_package()). */
export async function resolveInboundReplyToken(supabase: SupabaseClient, token: string): Promise<ReplyTokenResolution> {
  const { data, error } = await supabase
    .from("inbound_reply_tokens")
    .select("bid_package_id, vendor_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at) return { kind: "unmatched_token" };

  const { data: memberRow, error: memberError } = await supabase
    .from("vendor_members")
    .select("id")
    .eq("vendor_id", data.vendor_id)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (memberError) throw memberError;

  if (!memberRow) {
    return { kind: "revoked_vendor", bidPackageId: data.bid_package_id, vendorId: data.vendor_id };
  }
  return { kind: "resolved", bidPackageId: data.bid_package_id, vendorId: data.vendor_id };
}

/** Step 2: the inbound email's FROM address must match SOME real,
 *  on-file, active contact for this specific vendor — either the
 *  vendor company's own canonical bidding email (vendors.email) or any
 *  currently-active vendor_members colleague's own registered portal
 *  email. Matching against ANY active member's email (not vendors.email
 *  alone) is a deliberate widening beyond the design doc's literal
 *  text: a real colleague replying from their own registered address
 *  rather than the company's shared bidding inbox is a normal, expected
 *  case, not a spoofing attempt — this still requires the address to
 *  belong to a REAL, ACTIVE representative of this specific vendor
 *  company, so it does not weaken the actual security property (two
 *  independent facts — token + sender identity — must still agree). */
export async function verifySenderMatchesVendor(supabase: SupabaseClient, vendorId: string, fromEmail: string): Promise<boolean> {
  const normalized = fromEmail.trim().toLowerCase();
  if (!normalized) return false;

  const { data: vendorRow, error: vendorError } = await supabase.from("vendors").select("email").eq("id", vendorId).maybeSingle();
  if (vendorError) throw vendorError;
  if (vendorRow?.email && vendorRow.email.toLowerCase() === normalized) return true;

  // vendor_members carries TWO foreign keys into profiles (profile_id
  // AND revoked_by) — an unqualified `profiles(email)` embed is
  // genuinely ambiguous to PostgREST (it cannot infer which FK to
  // follow) and throws at query time, not merely a style preference.
  // Found live against the real hosted dev project during this
  // feature's own verification (a sender-mismatch webhook case
  // returned a 500 instead of a clean quarantine) — fixed here by
  // naming the FK constraint explicitly, matching this codebase's own
  // established "never rely on an ambiguous embed" convention
  // (bidService.ts's askBidQuestion/listBidQuestions doc comment).
  const { data: memberRows, error: memberError } = await supabase
    .from("vendor_members")
    .select("profiles!vendor_members_profile_id_fkey(email)")
    .eq("vendor_id", vendorId)
    .is("revoked_at", null);
  if (memberError) throw memberError;

  return (memberRows ?? []).some((row: any) => typeof row.profiles?.email === "string" && row.profiles.email.toLowerCase() === normalized);
}

export async function findEntityMessageByProviderMessageId(supabase: SupabaseClient, providerMessageId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase.from("entity_messages").select("id").eq("provider_message_id", providerMessageId).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string } : null;
}

export interface InsertInboundMessageParams {
  bidPackageId: string;
  vendorId: string;
  sender: string;
  recipient: string;
  subject: string | null;
  body: string;
  providerMessageId: string | null;
}

/** The only path that inserts a `direction='inbound'` row on behalf of
 *  a real email (as opposed to a vendor's own portal session) —
 *  intended to run under a SERVICE-ROLE client (webhook ingestion) OR a
 *  staff-RLS client (promoteQuarantinedMessage's own service-role step
 *  — see below). created_by is always null (schema/028's provenance
 *  trigger requires this for both the service-role, no-session case AND
 *  a vendor-authored row; this function never sets it any other way).
 *  A unique_violation on provider_message_id (a redelivered webhook
 *  whose event was already fully processed) is treated as a genuine,
 *  harmless no-op — see the Route Handler's own idempotency comment —
 *  never surfaced as a generic error. */
export async function insertInboundMessage(
  supabase: SupabaseClient,
  params: InsertInboundMessageParams
): Promise<{ id: string; duplicate?: false } | { duplicate: true } | { error: string }> {
  const { data, error } = await supabase
    .from("entity_messages")
    .insert({
      bid_package_id: params.bidPackageId,
      vendor_id: params.vendorId,
      direction: "inbound",
      sender: params.sender,
      recipient: params.recipient,
      subject: params.subject,
      body: params.body,
      received_at: new Date().toISOString(),
      delivery_status: "delivered",
      provider_message_id: params.providerMessageId,
      created_by: null,
    })
    .select("id")
    .single();

  if (error) {
    if ((error as any).code === "23505") {
      return { duplicate: true };
    }
    return { error: error.message };
  }
  return { id: data.id as string };
}

export interface QuarantineParams {
  reason: "unmatched_token" | "revoked_vendor" | "sender_mismatch" | "signature_invalid" | "malformed_payload";
  rawPayload: unknown;
  orgId?: string | null;
  bidPackageId?: string | null;
  vendorId?: string | null;
}

export async function quarantineInboundMessage(supabase: SupabaseClient, params: QuarantineParams): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase
    .from("quarantined_inbound_messages")
    .insert({
      reason: params.reason,
      raw_payload: params.rawPayload as any,
      org_id: params.orgId ?? null,
      bid_package_id: params.bidPackageId ?? null,
      vendor_id: params.vendorId ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

export interface QuarantinedInboundMessageRow {
  id: string;
  reason: string;
  rawPayload: unknown;
  bidPackageId: string | null;
  vendorId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  resolution: "promoted" | "discarded" | null;
  receivedAt: string;
}

function mapQuarantinedMessage(row: any): QuarantinedInboundMessageRow {
  return {
    id: row.id,
    reason: row.reason,
    rawPayload: row.raw_payload,
    bidPackageId: row.bid_package_id,
    vendorId: row.vendor_id,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    resolution: row.resolution,
    receivedAt: row.received_at,
  };
}

/** Staff-facing review queue, scoped to ONE bid package (this phase's
 *  UI is package-scoped, matching BidPackageWorkspace's own shape) —
 *  fully-unattributable rows (bid_package_id null) never surface here;
 *  they would need a future, separate GLOBAL quarantine inbox, out of
 *  this phase's scope. */
export async function listQuarantinedMessagesForBidPackage(supabase: SupabaseClient, bidPackageId: string): Promise<QuarantinedInboundMessageRow[]> {
  const { data, error } = await supabase
    .from("quarantined_inbound_messages")
    .select("*")
    .eq("bid_package_id", bidPackageId)
    .is("resolution", null)
    .order("received_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapQuarantinedMessage);
}

export async function discardQuarantinedMessage(supabase: SupabaseClient, id: string): Promise<{ error?: string }> {
  const { data: userRes } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("quarantined_inbound_messages")
    .update({ resolution: "discarded", reviewed_by: userRes.user?.id, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .is("resolution", null);
  if (error) return { error: error.message };
  return {};
}

/** Promotes a quarantined message into a real thread after a staff
 *  member has manually confirmed it's legitimate (e.g. a vendor really
 *  did email from a new, not-yet-on-file address). Deliberately takes
 *  TWO clients: `staffSupabase` (the calling session's own RLS-scoped
 *  client — authorizes reading/updating the quarantine row itself, and
 *  is the ONLY client with any business reading this table at all) and
 *  `serviceRoleSupabase` (used ONLY for the actual entity_messages
 *  insert) — the promoted row must still look exactly like a real
 *  inbound-email message (`created_by` null), which entity_messages'
 *  own provenance trigger would reject under the STAFF session doing
 *  the promoting (that trigger requires created_by = auth.uid() for any
 *  staff-authenticated insert) — using the service-role client for just
 *  this one insert step is what keeps the promoted row's shape honest
 *  (a message from the vendor, not from the staff member who reviewed
 *  it) without needing a special-cased RLS policy just for this one
 *  rare, staff-mediated path. */
export async function promoteQuarantinedMessage(
  staffSupabase: SupabaseClient,
  serviceRoleSupabase: SupabaseClient,
  id: string
): Promise<{ messageId?: string; error?: string }> {
  const { data: row, error } = await staffSupabase.from("quarantined_inbound_messages").select("*").eq("id", id).maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "Quarantined message not found." };
  if (row.resolution) return { error: `This message was already ${row.resolution}.` };
  if (!row.bid_package_id || !row.vendor_id) {
    return { error: "This message has no resolved bid package/vendor to promote into — discard it instead." };
  }

  const payload = row.raw_payload as any;
  const insertResult = await insertInboundMessage(serviceRoleSupabase, {
    bidPackageId: row.bid_package_id,
    vendorId: row.vendor_id,
    sender: typeof payload?.from === "string" ? payload.from : "unknown",
    recipient: typeof payload?.to === "string" ? payload.to : NOTIFICATION_FROM_ADDRESS,
    subject: typeof payload?.subject === "string" ? payload.subject : null,
    body: typeof payload?.text === "string" ? payload.text : "(original message body was not captured)",
    providerMessageId: null,
  });
  if ("error" in insertResult) return { error: insertResult.error };
  if ("duplicate" in insertResult) return { error: "This message appears to already exist in the thread." };

  const { data: userRes } = await staffSupabase.auth.getUser();
  const { error: updateError } = await staffSupabase
    .from("quarantined_inbound_messages")
    .update({ resolution: "promoted", reviewed_by: userRes.user?.id, reviewed_at: new Date().toISOString(), promoted_message_id: insertResult.id })
    .eq("id", id);
  if (updateError) return { error: updateError.message };
  return { messageId: insertResult.id };
}
