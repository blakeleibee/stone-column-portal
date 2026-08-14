"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  recordBidSubmission as recordBidSubmissionService,
  awardBid as awardBidService,
  askBidQuestion as askBidQuestionService,
  answerBidQuestion as answerBidQuestionService,
  issueBidAddendum as issueBidAddendumService,
} from "../../../../../packages/02-app-shell/src/services/bidService";

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
