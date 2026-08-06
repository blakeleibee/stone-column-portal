import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * QuickBooks import batch mutations (schema/013's import_batches/
 * import_rows). Thin even at this service-function layer: the real
 * business logic — the unresolved-row guard, the new/changed-row-to-
 * expense conversion, the matched_expense_id back-fill — lives in the
 * confirm_import_batch() RPC (security invoker), not here. This module's
 * job is calling the RPC via the caller's client and shaping the error,
 * same DI-seam pattern as budgetService.ts/importMappingService.ts.
 *
 * One service file per domain, not one per screen: Task 11's
 * overrideImportRow()/excludeImportRow() (per-row corrections before a
 * batch is confirmed) belong here too, alongside confirmImportBatch().
 */

export async function confirmImportBatch(
  supabase: SupabaseClient,
  batchId: string
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("confirm_import_batch", { p_batch_id: batchId });
  return error ? { error: error.message } : {};
}
