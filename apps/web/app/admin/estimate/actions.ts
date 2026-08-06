"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { enterOriginalBudget as enterOriginalBudgetService, adjustBudget as adjustBudgetService } from "../../../../../packages/02-app-shell/src/services/budgetService";

export async function enterOriginalBudget(projectId: string, costCodeId: string, amountCents: number, note?: string) {
  const supabase = await createServerSupabaseClient();
  return enterOriginalBudgetService(supabase, projectId, costCodeId, amountCents, note);
}

export async function adjustBudget(projectId: string, costCodeId: string, deltaCents: number, reason: string) {
  const supabase = await createServerSupabaseClient();
  return adjustBudgetService(supabase, projectId, costCodeId, deltaCents, reason);
}
