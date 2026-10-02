"use server";

import { headers } from "next/headers";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { getCurrentUser } from "../../../src/server/auth/getCurrentUser";
import { isProjectAccessibleToUser, PROJECT_NOT_ACCESSIBLE_ERROR } from "../../../src/server/project/assertProjectAccess";
import {
  createBidPackage as createBidPackageService,
  publishBidPackage as publishBidPackageService,
  inviteVendor as inviteVendorService,
  revokeVendorMember as revokeVendorMemberService,
  reactivateVendorMember as reactivateVendorMemberService,
  listVendorMembersForVendor as listVendorMembersForVendorService,
  getBidPackageDetail as getBidPackageDetailService,
  listBidQuestions as listBidQuestionsService,
  listBidAddenda as listBidAddendaService,
  updateBidPackageAssemblyDetails as updateBidPackageAssemblyDetailsService,
  listBidPackageDocuments as listBidPackageDocumentsService,
  listBidSubmissionRevisions as listBidSubmissionRevisionsService,
  listBidAddendumAcknowledgments as listBidAddendumAcknowledgmentsService,
  type BidPackageDetail,
  type BidQuestionRow,
  type BidAddendumRow,
  type BidPackageDocumentRow,
  type BidSubmissionRevisionRow,
  type BidAddendumAcknowledgmentRow,
  type VendorMemberRow,
} from "../../../../../packages/02-app-shell/src/services/bidService";
import {
  listEntityMessages as listEntityMessagesService,
  sendStaffMessage as sendStaffMessageService,
  listQuarantinedMessagesForBidPackage,
  discardQuarantinedMessage as discardQuarantinedMessageService,
  promoteQuarantinedMessage as promoteQuarantinedMessageService,
  type EntityMessageRow,
  type QuarantinedInboundMessageRow,
} from "../../../../../packages/02-app-shell/src/services/correspondenceService";
import { createServiceRoleSupabaseClient } from "../../../src/server/supabase/serviceRoleClient";
import { requireRole } from "../../../src/server/auth/require";

/**
 * P5.0 (Project-Context Write-Safety): re-validates `projectId` against
 * the acting user's real accessible-project list before creating a new
 * bid_packages row — this Server Action's only caller passes down
 * whatever project a Server Component page resolved, which (before
 * P5.0) could have been a silently-defaulted "first project" rather
 * than one the user explicitly selected. Never trusts that value alone;
 * see assertProjectAccess.ts's own doc comment for the full reasoning.
 */
export async function createBidPackage(projectId: string, costCodeId: string, title: string, scopeDescription?: string, dueAt?: string) {
  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { error: "Not authenticated." };
  if (!(await isProjectAccessibleToUser(supabase, user.orgId, projectId))) {
    return { error: PROJECT_NOT_ACCESSIBLE_ERROR };
  }
  return createBidPackageService(supabase, projectId, costCodeId, title, scopeDescription, dueAt);
}

export async function publishBidPackage(bidPackageId: string) {
  const supabase = await createServerSupabaseClient();
  return publishBidPackageService(supabase, bidPackageId);
}

/**
 * P5.2 Phase D: resolves the real invitation link's base URL from THIS
 * request's own host header (next/headers) — bidService.ts itself
 * carries no apps/web/Next.js dependency (matching every other service
 * file there), so this is the one place that can know it. Mirrors the
 * exact scheme-guessing already proven necessary in this codebase (see
 * apps/web/app/api/bid-packages/[bidPackageId]/documents/[bidPackageDocumentId]/
 * download/route.ts's own header comment on the "http://localhost"
 * hardcoded-origin bug found elsewhere) — never hardcodes a scheme.
 */
export async function inviteVendor(bidPackageId: string, vendorId: string) {
  const supabase = await createServerSupabaseClient();
  const headersList = await headers();
  const host = headersList.get("host") ?? "127.0.0.1:5173";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;
  return inviteVendorService(supabase, bidPackageId, vendorId, baseUrl);
}

// P5-DESIGN.md originally excluded a screen for these two from P5 scope
// (exported there only so the capability was typechecked/testable, not
// dead code waiting to be written from scratch). Final-review addition
// for P5.2: BidPackageWorkspace's "Vendor Access" panel now calls all
// three of these — the owner's own requested walkthrough step
// ("revoke/reactivate access") needs a real button, not just the
// live-checkpoint scripts that proved the underlying service functions
// correct. No new authorization logic here: RLS's
// vendor_members_staff_full_access policy (schema/015) already scopes
// every one of these three to org staff only, exactly like
// createBidPackage/publishBidPackage/inviteVendor above.
export async function revokeVendorMember(vendorId: string, profileId: string) {
  const supabase = await createServerSupabaseClient();
  return revokeVendorMemberService(supabase, vendorId, profileId);
}

export async function reactivateVendorMember(vendorId: string, profileId: string) {
  const supabase = await createServerSupabaseClient();
  return reactivateVendorMemberService(supabase, vendorId, profileId);
}

export async function listVendorMembers(vendorId: string): Promise<{ members?: VendorMemberRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const members = await listVendorMembersForVendorService(supabase, vendorId);
    return { members };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load vendor access." };
  }
}

// Read-only Server Actions for BidPackageWorkspace's detail-pane fetch
// (Task 6). Both underlying service functions throw on a Supabase
// error rather than returning { error } (see bidService.ts) — that's
// fine for a Server Component's initial data load, but a Server Action
// invoked from a Client Component's event handler needs a normal
// return value to show inline error text (never an unhandled
// rejection/Next.js error boundary), so each is caught here and
// normalized to the same { data } | { error } shape every other
// mutation in this file already returns.
export async function getBidPackageDetail(bidPackageId: string): Promise<{ detail?: BidPackageDetail; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const detail = await getBidPackageDetailService(supabase, bidPackageId);
    if (!detail) return { error: "Bid package not found." };
    return { detail };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load bid package detail." };
  }
}

export async function listBidQuestions(bidPackageId: string): Promise<{ questions?: BidQuestionRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const questions = await listBidQuestionsService(supabase, bidPackageId);
    return { questions };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load bid questions." };
  }
}

// Not named in the brief's two-Server-Action list (getBidPackageDetail,
// listBidQuestions) but required for the same reason bidService.ts's
// listBidAddenda was added — the addenda log has no data source
// without it. Same normalization (throw -> { error }) as the two above.
export async function listBidAddenda(bidPackageId: string): Promise<{ addenda?: BidAddendumRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const addenda = await listBidAddendaService(supabase, bidPackageId);
    return { addenda };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load addenda." };
  }
}

// P5.2 Phase B (Part B) — "Package Details" section.
export async function updateBidPackageAssemblyDetails(
  bidPackageId: string,
  fields: Parameters<typeof updateBidPackageAssemblyDetailsService>[2]
) {
  const supabase = await createServerSupabaseClient();
  return updateBidPackageAssemblyDetailsService(supabase, bidPackageId, fields);
}

// P5.2 Phase B (Part C) — staff-side "Documents" section list (upload
// itself goes through the multipart Route Handler, not a Server
// Action, matching P5.1's vendor-documents upload wiring exactly).
export async function listBidPackageDocuments(bidPackageId: string): Promise<{ documents?: BidPackageDocumentRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const documents = await listBidPackageDocumentsService(supabase, bidPackageId);
    return { documents };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load bid package documents." };
  }
}

// P5.2 Phase C — staff-side reads. getBidPackageDetail (above) already
// includes each submission's full revision history inline
// (BidSubmissionRow.revisions), so listBidSubmissionRevisions is not
// wired into BidPackageWorkspace's own re-fetch cycle today; exported
// here anyway so the capability is typechecked/testable on its own,
// matching this file's own established precedent (revokeVendorMember/
// reactivateVendorMember above).
export async function listBidSubmissionRevisions(bidSubmissionId: string): Promise<{ revisions?: BidSubmissionRevisionRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const revisions = await listBidSubmissionRevisionsService(supabase, bidSubmissionId);
    return { revisions };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load bid submission revisions." };
  }
}

export async function listBidAddendumAcknowledgments(bidPackageId: string): Promise<{ acknowledgments?: BidAddendumAcknowledgmentRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const acknowledgments = await listBidAddendumAcknowledgmentsService(supabase, bidPackageId);
    return { acknowledgments };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load addendum acknowledgments." };
  }
}

// =====================================================================
// P5.2 Phase D — correspondence Server Actions. Every write here still
// runs through the calling staff session's own RLS-scoped client
// (createServerSupabaseClient()) exactly like every other mutation in
// this file — the ONE exception is promoteQuarantinedMessage's inner
// entity_messages insert, which deliberately uses the service-role
// client for that single step only (see correspondenceService.ts's own
// doc comment on why, and serviceRoleClient.ts's doc comment on the
// TARGET-ARCHITECTURE.md §5.2 case this is). requireRole() re-checks
// authorization here specifically because that one step crosses an RLS
// boundary — never assumed from this Server Action merely being
// reachable, per §5.2's own "explicit authorization checked in code
// before the privileged action runs" rule.
// =====================================================================
export async function listEntityMessages(bidPackageId: string, vendorId: string): Promise<{ messages?: EntityMessageRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const messages = await listEntityMessagesService(supabase, bidPackageId, vendorId);
    return { messages };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load messages." };
  }
}

export async function sendStaffMessage(bidPackageId: string, vendorId: string, subject: string | undefined, body: string) {
  const supabase = await createServerSupabaseClient();
  const user = await requireRole(["admin", "staff"]);
  return sendStaffMessageService(supabase, { bidPackageId, vendorId, subject, body, staffProfileId: user.id });
}

export async function listQuarantinedMessages(bidPackageId: string): Promise<{ messages?: QuarantinedInboundMessageRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const messages = await listQuarantinedMessagesForBidPackage(supabase, bidPackageId);
    return { messages };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load quarantined messages." };
  }
}

export async function discardQuarantinedMessage(id: string) {
  await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  return discardQuarantinedMessageService(supabase, id);
}

export async function promoteQuarantinedMessage(id: string) {
  await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  return promoteQuarantinedMessageService(supabase, serviceRoleSupabase, id);
}
