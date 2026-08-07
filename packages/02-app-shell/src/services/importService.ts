import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileImportBatch } from "../../../01-financial-engine/src/reconciliation";

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
 *
 * Task 11 gap note: the P4 plan never gave the wizard a way to actually
 * list `import_rows` for a batch (needed for the review/override/exclude
 * step) or to compute the two totals `reconcileImportBatch` — the P4
 * task-10 pure engine function in reconciliation.ts — needs as its
 * inputs. Per the task-11 brief's own explicitly-sanctioned menu of
 * fixes ("a new service method + Server Action"), `listImportRows` and
 * `getImportBatchReconciliation` are added here rather than escalating,
 * since they're plain reads/aggregations over data this file's domain
 * (import_rows) already owns, follow the exact same DI-seam shape as
 * every other function here, and introduce no new business logic beyond
 * what reconcileImportBatch() and confirm_import_batch() already define.
 * Both return `{ ..., error? }` (never throw) — unlike
 * importMappingService.ts's listMappingProfiles(), which is only ever
 * called once at initial Server Component render — because these two are
 * invoked live, mid-interaction, from a Client Component that needs a
 * displayable error rather than an uncaught Server Action exception.
 */

export interface ImportRowRawData {
  Item: string | null;
  Name: string | null;
  Memo: string | null;
  Date: string | null;
  Amount: string | null;
  __resolved_cost_code_id: string | null;
}

export type ImportRowMatchStatus = "new" | "changed" | "duplicate" | "unmatched" | "error" | "excluded";

export interface ImportRow {
  id: string;
  batchId: string;
  rowNumber: number;
  rawData: ImportRowRawData;
  matchStatus: ImportRowMatchStatus;
  matchedExpenseId: string | null;
  errorMessage: string | null;
}

export interface ImportBatchReconciliation {
  importedTotalCents: number;
  resultingExpensesTotalCents: number;
  matches: boolean;
  differenceCents: number;
}

export async function confirmImportBatch(
  supabase: SupabaseClient,
  batchId: string
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("confirm_import_batch", { p_batch_id: batchId });
  return error ? { error: error.message } : {};
}

/** Per-row correction before a batch is confirmed: reassigns the cost
 *  code __resolved_cost_code_id inside raw_data (the ONLY key
 *  confirm_import_batch reads to decide which cost code an eventual
 *  expense lands under) and flips match_status to 'changed' so the row
 *  is no longer unresolved. raw_data is jsonb, so a full read-modify-
 *  write round trip is required to patch a single key without
 *  clobbering Item/Name/Memo/Date/Amount — the actual write is still a
 *  single plain, RLS-gated `.update()`. */
export async function overrideImportRow(
  supabase: SupabaseClient,
  rowId: string,
  costCodeId: string
): Promise<{ error?: string }> {
  const { data: existing, error: fetchError } = await supabase
    .from("import_rows")
    .select("raw_data")
    .eq("id", rowId)
    .maybeSingle();

  if (fetchError) {
    return { error: fetchError.message };
  }
  if (!existing) {
    return { error: "Import row not found." };
  }

  const nextRawData = {
    ...(existing.raw_data as Record<string, unknown>),
    __resolved_cost_code_id: costCodeId,
  };

  const { error } = await supabase
    .from("import_rows")
    .update({ raw_data: nextRawData, match_status: "changed" })
    .eq("id", rowId);

  return error ? { error: error.message } : {};
}

/** Per-row correction before a batch is confirmed: marks a row so
 *  confirm_import_batch() skips it entirely (it only converts 'new'/
 *  'changed' rows into expenses) — used for rows the reviewer decides
 *  should never be imported (e.g. a duplicate confirm_import_batch's own
 *  duplicate-detection missed, or a line item that shouldn't exist in
 *  this project at all). */
export async function excludeImportRow(supabase: SupabaseClient, rowId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("import_rows").update({ match_status: "excluded" }).eq("id", rowId);

  return error ? { error: error.message } : {};
}

/** Lists every `import_rows` row for a batch, RLS-scoped through the
 *  caller's own client exactly like every other function in this file —
 *  no privileged bypass. Ordered by row_number so the review UI shows
 *  rows in the same order the source file had them. */
export async function listImportRows(
  supabase: SupabaseClient,
  batchId: string
): Promise<{ rows: ImportRow[]; error?: string }> {
  const { data, error } = await supabase
    .from("import_rows")
    .select("id, batch_id, row_number, raw_data, match_status, matched_expense_id, error_message")
    .eq("batch_id", batchId)
    .order("row_number", { ascending: true });

  if (error) {
    return { rows: [], error: error.message };
  }

  const rows: ImportRow[] = (data ?? []).map((row) => ({
    id: row.id,
    batchId: row.batch_id,
    rowNumber: row.row_number,
    rawData: row.raw_data as ImportRowRawData,
    matchStatus: row.match_status as ImportRowMatchStatus,
    matchedExpenseId: row.matched_expense_id,
    errorMessage: row.error_message,
  }));

  return { rows };
}

/** Post-confirm reconciliation for the wizard's Confirm step. Computes
 *  the two totals reconcileImportBatch() (packages/01-financial-engine,
 *  Task 10) needs as pure-function inputs and returns its verdict:
 *  - importedTotalCents: sum of raw_data.Amount (the source file's own
 *    reported amount, exactly what confirm_import_batch() casts to
 *    amount_cents) over every row that actually got converted into an
 *    expense (matched_expense_id is set — i.e. was 'new'/'changed' at
 *    confirm time, not 'excluded'/'duplicate'/still-unresolved).
 *  - resultingExpensesTotalCents: the real amount_cents sum from the
 *    expenses table for those same matched_expense_id rows — a genuine
 *    re-read of what actually landed, never re-derived from raw_data.
 *  No business logic of its own beyond that aggregation — the actual
 *  match/mismatch comparison is entirely reconcileImportBatch()'s. */
export async function getImportBatchReconciliation(
  supabase: SupabaseClient,
  batchId: string
): Promise<{ report?: ImportBatchReconciliation; error?: string }> {
  const { rows, error: rowsError } = await listImportRows(supabase, batchId);
  if (rowsError) {
    return { error: rowsError };
  }

  const confirmedRows = rows.filter((row) => row.matchedExpenseId);

  const importedTotalCents = confirmedRows.reduce((sum, row) => {
    const amount = Number(row.rawData.Amount);
    return sum + (Number.isFinite(amount) ? Math.round(amount * 100) : 0);
  }, 0);

  let resultingExpensesTotalCents = 0;
  const expenseIds = confirmedRows.map((row) => row.matchedExpenseId as string);
  if (expenseIds.length > 0) {
    const { data: expenseRows, error: expenseError } = await supabase
      .from("expenses")
      .select("amount_cents")
      .in("id", expenseIds);

    if (expenseError) {
      return { error: expenseError.message };
    }
    resultingExpensesTotalCents = (expenseRows ?? []).reduce((sum, e) => sum + (e.amount_cents as number), 0);
  }

  const verdict = reconcileImportBatch(importedTotalCents, resultingExpensesTotalCents);

  return {
    report: {
      importedTotalCents,
      resultingExpensesTotalCents,
      matches: verdict.matches,
      differenceCents: verdict.differenceCents,
    },
  };
}
