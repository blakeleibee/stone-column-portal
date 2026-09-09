"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { supersedeCommittedCost as supersedeCommittedCostService } from "../../../../../packages/02-app-shell/src/services/committedCostService";

/**
 * Thin wrapper, same shape as estimate/costCodeActions.ts and
 * projects/statusAction.ts — all the real logic (the
 * supersede_committed_cost() RPC call, amount validation, and error
 * normalization) lives in committedCostService.supersedeCommittedCost;
 * this only constructs the request-scoped Supabase client and forwards
 * params/return value unchanged.
 */
export async function supersedeCommittedCost(oldCommittedCostId: string, newAmountCents: number, newVendorName?: string) {
  const supabase = await createServerSupabaseClient();
  return supersedeCommittedCostService(supabase, oldCommittedCostId, newAmountCents, newVendorName);
}
