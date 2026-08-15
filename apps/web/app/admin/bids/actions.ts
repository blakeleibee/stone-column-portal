"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  createBidPackage as createBidPackageService,
  publishBidPackage as publishBidPackageService,
  inviteVendor as inviteVendorService,
  revokeVendorMember as revokeVendorMemberService,
  reactivateVendorMember as reactivateVendorMemberService,
  getBidPackageDetail as getBidPackageDetailService,
  listBidQuestions as listBidQuestionsService,
  listBidAddenda as listBidAddendaService,
  type BidPackageDetail,
  type BidQuestionRow,
  type BidAddendumRow,
} from "../../../../../packages/02-app-shell/src/services/bidService";

export async function createBidPackage(projectId: string, costCodeId: string, title: string, scopeDescription?: string, dueAt?: string) {
  const supabase = await createServerSupabaseClient();
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
