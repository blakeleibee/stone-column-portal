"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { getCurrentUser } from "../../../src/server/auth/getCurrentUser";
import { isProjectAccessibleToUser, PROJECT_NOT_ACCESSIBLE_ERROR } from "../../../src/server/project/assertProjectAccess";
import { enterOriginalBudget as enterOriginalBudgetService, adjustBudget as adjustBudgetService } from "../../../../../packages/02-app-shell/src/services/budgetService";

/**
 * P5.0 (Project-Context Write-Safety): re-validates `projectId` against
 * the acting user's real accessible-project list before inserting a new
 * budget_ledger row — same reasoning as bids/actions.ts's
 * createBidPackage: this is a new-record-creating write reachable from
 * /admin/estimate, one of the pages whose project resolution used to be
 * able to silently default to an unintended project.
 */
export async function enterOriginalBudget(projectId: string, costCodeId: string, amountCents: number, note?: string) {
  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { error: "Not authenticated." };
  if (!(await isProjectAccessibleToUser(supabase, user.orgId, projectId))) {
    return { error: PROJECT_NOT_ACCESSIBLE_ERROR };
  }
  return enterOriginalBudgetService(supabase, projectId, costCodeId, amountCents, note);
}

/** Same validation, same reasoning, for the other budget_ledger-inserting
 *  write this file exposes. */
export async function adjustBudget(projectId: string, costCodeId: string, deltaCents: number, reason: string) {
  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { error: "Not authenticated." };
  if (!(await isProjectAccessibleToUser(supabase, user.orgId, projectId))) {
    return { error: PROJECT_NOT_ACCESSIBLE_ERROR };
  }
  return adjustBudgetService(supabase, projectId, costCodeId, deltaCents, reason);
}
