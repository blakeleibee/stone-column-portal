import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Thin wrapper over supersede_committed_cost() (schema/003_status_
 * transitions_and_supersede_rpcs.sql) — same "validation + RPC call +
 * error normalization lives in the service, the Server Action only
 * constructs the request-scoped client and forwards params" split
 * already used by budgetService.enterOriginalBudget/adjustBudget and
 * projectService.changeProjectStatus/setProjectFeeTerms. The Server
 * Action (apps/web/app/admin/commitments/actions.ts) never calls
 * supabase.rpc() directly — CLAUDE.md's AI-ready mandate: business
 * logic lives in a repository (reads) or a plain service function
 * (writes) that a Server Action wraps thinly, so a future AI
 * tool-calling layer can call this exact function under the asking
 * user's own session, not a duplicated/inline code path.
 *
 * Only the two fields a human actually edits from this screen (new
 * amount, new vendor name) are exposed as parameters here. The RPC's
 * trailing p_new_source_type/p_new_source_id both default to null
 * server-side, which coalesces onto the row being superseded's own
 * source_type/source_id — correct for this screen: superseding an open
 * commitment to correct its amount never changes which bid award or
 * material order it traces back to.
 */
export async function supersedeCommittedCost(
  supabase: SupabaseClient,
  oldCommittedCostId: string,
  newAmountCents: number,
  newVendorName?: string
): Promise<{ newCommittedCostId: string } | { error: string }> {
  if (!Number.isInteger(newAmountCents) || newAmountCents < 0) {
    return { error: "Amount must be a whole number of cents, zero or greater." };
  }
  const { data, error } = await supabase.rpc("supersede_committed_cost", {
    p_old_id: oldCommittedCostId,
    p_new_amount_cents: newAmountCents,
    p_new_vendor_name: newVendorName ?? null,
  });
  if (error) return { error: error.message };
  return { newCommittedCostId: data as string };
}
