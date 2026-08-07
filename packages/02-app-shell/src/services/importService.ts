import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileImportBatch } from "../../../01-financial-engine/src/reconciliation";
import { parseQuickBooksCsv, type ParsedImportRow } from "../imports/parseQuickBooksCsv";

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
 * `stageImportBatch()` (added in the P4 final-review fix wave) joins
 * them for the same reason — it's the one remaining import_batches/
 * import_rows mutation that still lived inline in a Route Handler
 * instead of as a callable service function.
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
  /**
   * A signed integer number of cents, stored as a string (jsonb has no
   * native distinction that matters here) — e.g. "123456" for $1,234.56,
   * "-50000" for a QuickBooks parenthesized-negative credit of $500.00.
   * NOT the raw CSV dollar string. This is `stageImportBatch()`'s hard
   * contract with `confirm_import_batch()`/`getImportBatchReconciliation()`:
   * `parseQuickBooksCsv()` is the ONE place Amount is ever parsed from a
   * source file's own formatting (currency symbols, thousands
   * separators, parenthesized negatives); every downstream reader casts
   * this value directly to an integer, never re-parses a decimal string.
   * (Final-review fix: previously this field held the raw CSV string,
   * which three different call sites — this file, the Route Handler, and
   * confirm_import_batch() — each parsed differently, with two of the
   * three unable to handle "$1,234.56" or "(500.00)" at all.)
   */
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
 *  - importedTotalCents: sum of raw_data.Amount — ALREADY a signed
 *    integer number of cents (see ImportRowRawData.Amount's doc comment;
 *    stageImportBatch() is the only place a source file's own Amount
 *    formatting is ever parsed), exactly the value confirm_import_batch()
 *    casts straight to amount_cents with no further parsing — over every
 *    row that actually got converted into an expense (matched_expense_id
 *    is set — i.e. was 'new'/'changed' at confirm time, not
 *    'excluded'/'duplicate'/still-unresolved).
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
    const amountCents = Number(row.rawData.Amount);
    return sum + (Number.isFinite(amountCents) ? amountCents : 0);
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

export interface StageImportBatchParams {
  projectId: string;
  mappingProfileId: string;
  /** The uploaded file's own name (`import_batches.source_filename`) —
   *  display metadata only, never parsed. */
  fileName: string;
  /** The uploaded file's full text contents, already read by the
   *  caller (a Route Handler reads `File#text()`; a future AI
   *  tool-calling adapter would supply this the same way). */
  fileContents: string;
  /** The acting user's id (`profiles.id`), attributed to
   *  `import_batches.imported_by`. The caller resolves this from its
   *  own authentication step — this function performs no
   *  authentication/authorization of its own beyond what RLS already
   *  enforces on every query/insert below, same as every other function
   *  in this file. */
  importedBy: string;
}

export interface StageImportBatchResult {
  batchId?: string;
  rowCounts?: Record<ParsedImportRow["matchStatus"], number>;
  error?: string;
}

/**
 * Stages a QuickBooks Desktop job-cost CSV export into a pending-review
 * `import_batches`/`import_rows` pair: loads the mapping profile and
 * this project's (non-archived) cost codes, builds the
 * existing-expense duplicate-detection key set, calls the pure
 * `parseQuickBooksCsv()`, normalizes every row's `raw_data` into the
 * fixed six-key shape `confirm_import_batch()` depends on, and inserts
 * the batch + rows. Writes nothing to `expenses` — that only happens on
 * later confirmation (`confirmImportBatch()`/`confirm_import_batch()`).
 *
 * Extracted from the `/api/imports/parse` Route Handler (P4 final-review
 * fix) — this was the one mutation path in the whole P4 package that
 * still had its business logic living directly in a Route Handler
 * instead of a callable service function, per
 * docs/production-build/AI-ASSISTANT-ARCHITECTURE.md's DI-seam pattern.
 * The Route Handler now does only three things: parse the multipart
 * request into these plain params, construct the caller's Supabase
 * client, and call this function.
 *
 * Hard contract with `confirm_import_batch()`: `import_rows.raw_data` is
 * NOT the CSV row's own columns verbatim (those keys are whatever the
 * source file's headers happened to be, per the mapping profile's
 * `column_mapping`). It is always a normalized object with exactly
 * these six keys — Item, Name, Memo, Date, Amount (a signed integer
 * number of cents, as a string — see `ImportRowRawData.Amount`'s doc
 * comment; NOT the raw CSV string), and __resolved_cost_code_id.
 * `confirm_import_batch()` reads `raw_data->>'Name'` / `'Date'` /
 * `'Memo'` / `'Amount'` / `'__resolved_cost_code_id'` verbatim, so this
 * shape must never drift.
 *
 * Cost codes are filtered to `is_archived = false` (final-review fix) —
 * matching `FinancialRepository.getCostCodes()`'s own filter — so an
 * item can never auto-resolve to an archived cost code the wizard's
 * override `<select>` (fed from that same repository method) has no
 * matching `<option>` for.
 */
export async function stageImportBatch(
  supabase: SupabaseClient,
  params: StageImportBatchParams
): Promise<StageImportBatchResult> {
  const { projectId, mappingProfileId, fileName, fileContents, importedBy } = params;

  const { data: mappingProfileRow, error: mappingProfileError } = await supabase
    .from("import_mapping_profiles")
    .select("id, column_mapping, cost_code_match_strategy, cost_code_prefix_length, item_overrides")
    .eq("id", mappingProfileId)
    .maybeSingle();

  if (mappingProfileError) {
    return { error: mappingProfileError.message };
  }
  if (!mappingProfileRow) {
    return { error: "Mapping profile not found." };
  }

  const { data: costCodeRows, error: costCodeError } = await supabase
    .from("cost_codes")
    .select("id, code")
    .eq("project_id", projectId)
    .eq("is_archived", false);

  if (costCodeError) {
    return { error: costCodeError.message };
  }

  // Duplicate-context: every non-void expense already posted for this
  // project, keyed EXACTLY the way parseQuickBooksCsv.ts builds its own
  // internal key (vendorValue|dateValue|amountCents|resolvedCostCodeId)
  // so `existingExpenseKeys.has(key)` lines up.
  const { data: expenseRows, error: expenseError } = await supabase
    .from("expenses")
    .select("vendor_name, transaction_date, amount_cents, cost_code_id")
    .eq("project_id", projectId)
    .neq("financial_status", "void");

  if (expenseError) {
    return { error: expenseError.message };
  }

  const existingExpenseKeys = new Set(
    (expenseRows ?? []).map((e) => `${e.vendor_name}|${e.transaction_date}|${e.amount_cents}|${e.cost_code_id}`)
  );

  const columnMapping = (mappingProfileRow.column_mapping ?? {}) as Record<string, string>;

  let parsedRows: ParsedImportRow[];
  try {
    parsedRows = parseQuickBooksCsv(fileContents, {
      mappingProfile: {
        columnMapping,
        costCodeMatchStrategy: mappingProfileRow.cost_code_match_strategy,
        costCodePrefixLength: mappingProfileRow.cost_code_prefix_length,
        itemOverrides: (mappingProfileRow.item_overrides ?? {}) as Record<string, string>,
      },
      projectCostCodes: costCodeRows ?? [],
      existingExpenseKeys,
    });
  } catch (err) {
    return { error: `Could not parse the uploaded file: ${err instanceof Error ? err.message : String(err)}` };
  }

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      project_id: projectId,
      source_filename: fileName,
      status: "ready_for_review",
      mapping_profile_id: mappingProfileId,
      row_count: parsedRows.length,
      imported_by: importedBy,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return { error: batchError?.message ?? "Could not create import batch." };
  }

  // Normalize every row to the fixed Item/Name/Memo/Date/Amount +
  // __resolved_cost_code_id shape confirm_import_batch() depends on —
  // pulling the RAW string value out of row.rawData via the mapping
  // profile's own column_mapping (never row.rawData's own arbitrary
  // header keys), except Amount, which uses parseQuickBooksCsv()'s own
  // already-canonicalized amountCents, never the raw CSV string.
  const importRowsToInsert = parsedRows.map((row) => {
    const normalized = {
      Item: row.rawData[columnMapping.item] ?? null,
      Name: row.rawData[columnMapping.vendor] ?? null,
      Memo: row.rawData[columnMapping.memo] ?? null,
      Date: row.rawData[columnMapping.date] ?? null,
      Amount: String(row.amountCents),
      __resolved_cost_code_id: row.resolvedCostCodeId,
    };

    return {
      batch_id: batch.id,
      row_number: row.rowNumber,
      raw_data: normalized,
      match_status: row.matchStatus,
      error_message: row.errorMessage ?? null,
    };
  });

  const { error: rowsError } = await supabase.from("import_rows").insert(importRowsToInsert);

  if (rowsError) {
    return { error: rowsError.message };
  }

  const rowCounts: Record<ParsedImportRow["matchStatus"], number> = {
    new: 0,
    changed: 0,
    duplicate: 0,
    unmatched: 0,
    error: 0,
  };
  for (const row of parsedRows) {
    rowCounts[row.matchStatus] += 1;
  }

  return { batchId: batch.id as string, rowCounts };
}
