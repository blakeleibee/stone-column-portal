"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { getCurrentUser } from "../../../src/server/auth/getCurrentUser";
import { isProjectAccessibleToUser, PROJECT_NOT_ACCESSIBLE_ERROR } from "../../../src/server/project/assertProjectAccess";
import {
  createBidPackage as createBidPackageService,
  publishBidPackage as publishBidPackageService,
  inviteVendor as inviteVendorService,
  revokeVendorMember as revokeVendorMemberService,
  reactivateVendorMember as reactivateVendorMemberService,
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
} from "../../../../../packages/02-app-shell/src/services/bidService";

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

export async function inviteVendor(bidPackageId: string, vendorId: string) {
  const supabase = await createServerSupabaseClient();
  return inviteVendorService(supabase, bidPackageId, vendorId);
}

// No screen in P5 calls these two yet (P5-DESIGN.md's own exclusion
// note) — exported now so the capability is typechecked and testable,
// not dead code waiting to be written from scratch later.
export async function revokeVendorMember(vendorId: string, profileId: string) {
  const supabase = await createServerSupabaseClient();
  return revokeVendorMemberService(supabase, vendorId, profileId);
}

export async function reactivateVendorMember(vendorId: string, profileId: string) {
  const supabase = await createServerSupabaseClient();
  return reactivateVendorMemberService(supabase, vendorId, profileId);
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
