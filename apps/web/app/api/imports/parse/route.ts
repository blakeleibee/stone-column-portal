import { NextResponse } from "next/server";
import { canManageProject } from "../../../../src/server/auth/can";
import { createServerSupabaseClient } from "../../../../src/server/supabase/serverClient";
import { parseQuickBooksCsv, type MatchContext, type ParsedImportRow } from "../../../../src/server/imports/parseQuickBooksCsv";

/**
 * POST /api/imports/parse — multipart form fields `file`, `projectId`,
 * `mappingProfileId`. Stages a QuickBooks Desktop job-cost CSV export
 * into a pending-review `import_batches`/`import_rows` pair by calling
 * the pure parseQuickBooksCsv (Task 8) with real, RLS-scoped project
 * data. Writes nothing to `expenses` -- that only happens on later
 * confirmation (Task 10's `confirm_import_batch` RPC).
 *
 * Hard contract with Task 10: `import_rows.raw_data` is NOT the CSV
 * row's own columns verbatim (those keys are whatever the source
 * file's headers happened to be, per the mapping profile's
 * `column_mapping`). It is always a normalized object with exactly
 * these six keys -- Item, Name, Memo, Date, Amount (the RAW string
 * values from the source columns the mapping profile points at, not
 * anything this route computes/sanitizes), and
 * __resolved_cost_code_id. confirm_import_batch reads
 * raw_data->>'Name' / 'Date' / 'Memo' / 'Amount' /
 * '__resolved_cost_code_id' verbatim, so this shape must never drift.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed multipart form body." }, { status: 400 });
  }

  const file = formData.get("file");
  const projectId = formData.get("projectId");
  const mappingProfileId = formData.get("mappingProfileId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing or invalid 'file' field." }, { status: 400 });
  }
  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "Missing or invalid 'projectId' field." }, { status: 400 });
  }
  if (typeof mappingProfileId !== "string" || !mappingProfileId) {
    return NextResponse.json({ error: "Missing or invalid 'mappingProfileId' field." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Staff/admin-only, project-scoped -- same check writes to this
  // project's financial data already require elsewhere. Returns 404
  // (not 403) so this route never confirms a project's existence to a
  // caller who can't see it.
  const allowed = await canManageProject(projectId, supabase);
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: mappingProfileRow, error: mappingProfileError } = await supabase
    .from("import_mapping_profiles")
    .select("id, column_mapping, cost_code_match_strategy, cost_code_prefix_length, item_overrides")
    .eq("id", mappingProfileId)
    .maybeSingle();

  if (mappingProfileError) {
    return NextResponse.json({ error: mappingProfileError.message }, { status: 500 });
  }
  if (!mappingProfileRow) {
    return NextResponse.json({ error: "Mapping profile not found." }, { status: 404 });
  }

  const { data: costCodeRows, error: costCodeError } = await supabase
    .from("cost_codes")
    .select("id, code")
    .eq("project_id", projectId);

  if (costCodeError) {
    return NextResponse.json({ error: costCodeError.message }, { status: 500 });
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
    return NextResponse.json({ error: expenseError.message }, { status: 500 });
  }

  const existingExpenseKeys = new Set(
    (expenseRows ?? []).map((e) => `${e.vendor_name}|${e.transaction_date}|${e.amount_cents}|${e.cost_code_id}`)
  );

  let fileContents: string;
  try {
    fileContents = await file.text();
  } catch {
    return NextResponse.json({ error: "Could not read uploaded file contents." }, { status: 400 });
  }

  const columnMapping = (mappingProfileRow.column_mapping ?? {}) as Record<string, string>;

  const matchContext: MatchContext = {
    mappingProfile: {
      columnMapping,
      costCodeMatchStrategy: mappingProfileRow.cost_code_match_strategy,
      costCodePrefixLength: mappingProfileRow.cost_code_prefix_length,
      itemOverrides: (mappingProfileRow.item_overrides ?? {}) as Record<string, string>,
    },
    projectCostCodes: costCodeRows ?? [],
    existingExpenseKeys,
  };

  let parsedRows: ParsedImportRow[];
  try {
    parsedRows = parseQuickBooksCsv(fileContents, matchContext);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not parse the uploaded file: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      project_id: projectId,
      source_filename: file.name,
      status: "ready_for_review",
      mapping_profile_id: mappingProfileId,
      row_count: parsedRows.length,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return NextResponse.json({ error: batchError?.message ?? "Could not create import batch." }, { status: 500 });
  }

  // Normalize every row to the fixed Item/Name/Memo/Date/Amount +
  // __resolved_cost_code_id shape Task 10 depends on -- pulling the RAW
  // string value out of row.rawData via the mapping profile's own
  // column_mapping, never row.rawData's own (arbitrary) header keys.
  const importRowsToInsert = parsedRows.map((row) => {
    const normalized = {
      Item: row.rawData[columnMapping.item] ?? null,
      Name: row.rawData[columnMapping.vendor] ?? null,
      Memo: row.rawData[columnMapping.memo] ?? null,
      Date: row.rawData[columnMapping.date] ?? null,
      Amount: row.rawData[columnMapping.amount] ?? null,
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
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
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

  return NextResponse.json({ batchId: batch.id as string, rowCounts });
}
