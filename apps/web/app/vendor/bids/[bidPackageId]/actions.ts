"use server";

/**
 * P5.2 Phase C — Server Actions backing the vendor-facing bid package
 * screen's new interactive surface (submission/revision, ask-a-
 * question, addendum acknowledgment). Every action re-asserts a real
 * vendor-role session via requireRole(["vendor"]) before doing
 * anything — a Server Action is a real, independently callable
 * endpoint, never merely "reachable only from a page that already
 * checked." Every write below still goes through the exact same
 * service function (packages/02-app-shell/src/services/bidService.ts)
 * the rest of this codebase's AI-readiness architecture requires — no
 * inline business logic here, no service-role shortcut.
 *
 * Read functions normalize bidService.ts's "throw on error" shape into
 * a plain { data } | { error } return (never an unhandled rejection
 * from a Client Component's event handler), matching
 * apps/web/app/admin/bids/actions.ts's own established convention.
 */
import { createServerSupabaseClient } from "../../../../src/server/supabase/serverClient";
import { requireRole } from "../../../../src/server/auth/require";
import {
  listVendorVisibleBidPackageDocuments as listVendorVisibleBidPackageDocumentsService,
  listVendorVisibleBidAddenda as listVendorVisibleBidAddendaService,
  listVendorVisibleBidQuestions as listVendorVisibleBidQuestionsService,
  getVendorOwnBidSubmission as getVendorOwnBidSubmissionService,
  listBidSubmissionRevisions as listBidSubmissionRevisionsService,
  getVendorBidAddendumAcknowledgments as getVendorBidAddendumAcknowledgmentsService,
  submitVendorBid as submitVendorBidService,
  askVendorBidQuestion as askVendorBidQuestionService,
  acknowledgeBidAddendum as acknowledgeBidAddendumService,
  type BidPackageDocumentRow,
  type VendorVisibleBidAddendumRow,
  type VendorVisibleBidQuestionRow,
  type BidSubmissionRow,
  type BidSubmissionRevisionRow,
  type BidAddendumAcknowledgmentRow,
} from "../../../../../../packages/02-app-shell/src/services/bidService";

export async function listVendorVisibleBidPackageDocuments(bidPackageId: string): Promise<{ documents?: BidPackageDocumentRow[]; error?: string }> {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  try {
    const documents = await listVendorVisibleBidPackageDocumentsService(supabase, bidPackageId);
    return { documents };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load documents." };
  }
}

export async function listVendorVisibleBidAddenda(bidPackageId: string): Promise<{ addenda?: VendorVisibleBidAddendumRow[]; error?: string }> {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  try {
    const addenda = await listVendorVisibleBidAddendaService(supabase, bidPackageId);
    return { addenda };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load addenda." };
  }
}

export async function listVendorVisibleBidQuestions(bidPackageId: string): Promise<{ questions?: VendorVisibleBidQuestionRow[]; error?: string }> {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  try {
    const questions = await listVendorVisibleBidQuestionsService(supabase, bidPackageId);
    return { questions };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load questions." };
  }
}

export async function getVendorOwnBidSubmission(bidPackageId: string): Promise<{ submission?: BidSubmissionRow | null; error?: string }> {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  try {
    const submission = await getVendorOwnBidSubmissionService(supabase, bidPackageId);
    return { submission };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load your bid submission." };
  }
}

export async function listMyBidSubmissionRevisions(bidSubmissionId: string): Promise<{ revisions?: BidSubmissionRevisionRow[]; error?: string }> {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  try {
    const revisions = await listBidSubmissionRevisionsService(supabase, bidSubmissionId);
    return { revisions };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load your submission history." };
  }
}

export async function getVendorBidAddendumAcknowledgments(bidPackageId: string): Promise<{ acknowledgments?: BidAddendumAcknowledgmentRow[]; error?: string }> {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  try {
    const acknowledgments = await getVendorBidAddendumAcknowledgmentsService(supabase, bidPackageId);
    return { acknowledgments };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load addendum acknowledgments." };
  }
}

export async function submitVendorBid(bidSubmissionId: string, amountCents: number, notes?: string) {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  return submitVendorBidService(supabase, bidSubmissionId, amountCents, notes);
}

export async function askVendorBidQuestion(bidPackageId: string, vendorId: string, questionText: string) {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  return askVendorBidQuestionService(supabase, bidPackageId, vendorId, questionText);
}

export async function acknowledgeBidAddendum(bidAddendumId: string, vendorId: string) {
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();
  return acknowledgeBidAddendumService(supabase, bidAddendumId, vendorId);
}
