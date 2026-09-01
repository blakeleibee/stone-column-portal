"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  recordBidSubmission as recordBidSubmissionService,
  awardBid as awardBidService,
  askBidQuestion as askBidQuestionService,
  answerBidQuestion as answerBidQuestionService,
  issueBidAddendum as issueBidAddendumService,
} from "../../../../../packages/02-app-shell/src/services/bidService";
import { issueSubcontract as issueSubcontractService } from "../../../../../packages/02-app-shell/src/services/documentIssuanceService";

export async function recordBidSubmission(bidSubmissionId: string, amountCents: number, notes?: string) {
  const supabase = await createServerSupabaseClient();
  return recordBidSubmissionService(supabase, bidSubmissionId, amountCents, notes);
}

export async function awardBid(bidSubmissionId: string) {
  const supabase = await createServerSupabaseClient();
  return awardBidService(supabase, bidSubmissionId);
}

export async function askBidQuestion(bidPackageId: string, vendorId: string, questionText: string) {
  const supabase = await createServerSupabaseClient();
  return askBidQuestionService(supabase, bidPackageId, vendorId, questionText);
}

export async function answerBidQuestion(bidQuestionId: string, answerText: string) {
  const supabase = await createServerSupabaseClient();
  return answerBidQuestionService(supabase, bidQuestionId, answerText);
}

export async function issueBidAddendum(bidPackageId: string, title: string, bodyText: string, revisedDueAt?: string) {
  const supabase = await createServerSupabaseClient();
  return issueBidAddendumService(supabase, bidPackageId, title, bodyText, revisedDueAt);
}

// Belongs here rather than in apps/web/app/admin/procurement/actions.ts
// (Task 8's own plan text) — issuing a subcontract is a bid-package
// action, not a material-order/procurement one, even though the
// underlying service function lives in documentIssuanceService.ts
// alongside issuePurchaseOrder.
export async function issueSubcontract(bidPackageId: string, documentNumber?: string) {
  const supabase = await createServerSupabaseClient();
  return issueSubcontractService(supabase, bidPackageId, documentNumber);
}
