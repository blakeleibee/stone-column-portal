#!/usr/bin/env node
// Pre-close-out checkpoint for P4 (Estimating & Budgeting UI + QuickBooks
// Desktop Import): proves the real data layer end-to-end against the
// hosted dev project, calling the exact same service functions the app's
// Server Actions call -- never the service-role client for anything a
// real user flow does (service role is used only for teardown, same
// pattern as scripts/db/seed.mjs and live-auth-checkpoint.mjs).
//
// Scope note (explicit, not overclaimed): this exercises every layer
// EXCEPT the thin HTTP Route Handler wrapper itself
// (apps/web/app/api/imports/parse/route.ts) -- that file's exact
// raw_data-normalization contract was independently verified against
// this same parseQuickBooksCsv() during Task 9's code review. Spinning
// up a real authenticated multipart HTTP request against a running
// `next dev` server was judged not worth the added fragility (replicating
// a real browser session's cookies against Next.js's auth middleware)
// for what would be the same underlying calls this script already makes
// directly. What this script proves for real: real budget entry/editing,
// real cost-code-template application, real mapping-profile creation,
// real CSV parsing/matching (including a non-ISO date row and a
// malformed row), real confirm_import_batch execution (including the
// idempotency guard and the error-row-override edge case), and real
// reconciliation.
//
// Usage: node scripts/db/live-p4-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local if present).

try {
  process.loadEnvFile(".env.local");
} catch {
  // fine if it doesn't exist -- env vars may already be exported
}

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

// Cross-package .ts imports use CJS require() via tsx, not ESM `import` --
// packages/02-app-shell has no "type": "module" in its package.json, so
// tsx transpiles these as CommonJS; Node's ESM/CJS named-export interop
// doesn't reliably detect the named exports through a static `import`
// across this monorepo boundary, but require() resolves them correctly.
const require = createRequire(import.meta.url);
const { enterOriginalBudget, adjustBudget } = require("../../packages/02-app-shell/src/services/budgetService.ts");
const { createMappingProfile } = require("../../packages/02-app-shell/src/services/importMappingService.ts");
const { confirmImportBatch, overrideImportRow, getImportBatchReconciliation, stageImportBatch } = require("../../packages/02-app-shell/src/services/importService.ts");
const { parseQuickBooksCsv } = require("../../packages/02-app-shell/src/imports/parseQuickBooksCsv.ts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must all be set.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const stamp = Date.now();
const results = [];
const createdUserIds = [];
const createdOrgIds = [];
const createdProjectIds = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}

function freshClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  // ---- Setup: real signup, real org, real project, real cost codes ----
  const email = `checkpoint-p4-${stamp}@example.com`;
  const password = "Checkpoint-P4-Password-123!";
  const client = freshClient();

  const { data: signUp, error: signUpErr } = await client.auth.signUp({ email, password });
  record("Real signup", !signUpErr && !!signUp.user, signUpErr?.message);
  if (signUpErr) throw new Error("Cannot continue without a signed-up user.");
  createdUserIds.push(signUp.user.id);

  const { data: orgId, error: bootstrapErr } = await client.rpc("bootstrap_organization", {
    p_org_name: `Checkpoint P4 Org ${stamp}`,
    p_admin_full_name: "Checkpoint P4 Admin",
    p_admin_email: email,
  });
  record("bootstrap_organization()", !bootstrapErr && !!orgId, bootstrapErr?.message);
  if (bootstrapErr) throw new Error("Cannot continue without an org.");
  createdOrgIds.push(orgId);

  const { data: project, error: projectErr } = await client
    .from("projects")
    .insert({
      org_id: orgId,
      name: `Checkpoint P4 Project ${stamp}`,
      project_number: `CP4-${stamp}`,
      pricing_model: "cost_plus_percentage",
    })
    .select("id")
    .single();
  record("Real project created", !projectErr && !!project, projectErr?.message);
  if (projectErr) throw new Error("Cannot continue without a project.");
  createdProjectIds.push(project.id);

  const { error: templateErr } = await client.rpc("apply_standard_cost_code_template", {
    p_project_id: project.id,
  });
  record("apply_standard_cost_code_template()", !templateErr, templateErr?.message);

  const { data: costCodes, error: costCodesErr } = await client
    .from("cost_codes")
    .select("id, code")
    .eq("project_id", project.id)
    .order("code", { ascending: true })
    .limit(3);
  record("Real cost codes fetched", !costCodesErr && (costCodes?.length ?? 0) >= 2, costCodesErr?.message);
  const [costCodeA, costCodeB] = costCodes ?? [];

  // ---- Phase 1: real budget entry and editing ----
  const { error: enterErr } = await enterOriginalBudget(client, project.id, costCodeA.id, 500000, "Initial estimate");
  record("enterOriginalBudget() — real insert", !enterErr, enterErr?.message);

  const { error: secondOriginalErr } = await enterOriginalBudget(client, project.id, costCodeA.id, 100, "should be rejected");
  record("A second original entry for the same cost code is rejected", !!secondOriginalErr);

  const { error: adjustErr } = await adjustBudget(client, project.id, costCodeA.id, 5000, "Field measurement correction");
  record("adjustBudget() — real correction with reason", !adjustErr, adjustErr?.message);

  const { data: ledgerRows } = await client
    .from("budget_ledger")
    .select("entry_type, amount_cents")
    .eq("cost_code_id", costCodeA.id);
  const revisedTotal = (ledgerRows ?? []).reduce((sum, r) => sum + r.amount_cents, 0);
  record("Revised total reflects original + correction", revisedTotal === 505000, `got ${revisedTotal}, expected 505000`);

  // ---- Phase 2: real mapping profile ----
  const { id: mappingProfileId, error: mappingErr } = await createMappingProfile(client, orgId, {
    name: `Checkpoint QB Profile ${stamp}`,
    columnMapping: { item: "Item", vendor: "Name", amount: "Amount", date: "Date", memo: "Memo" },
    strategy: "prefix",
    prefixLength: 4,
  });
  record("createMappingProfile() — real insert", !mappingErr && !!mappingProfileId, mappingErr?.message);

  // ---- Phase 3: real CSV parse — includes a non-ISO date row and a malformed row ----
  const csv = [
    "Item,Name,Memo,Date,Amount",
    `${costCodeA.code},ABC Framing LLC,Rough framing labor,08/15/2026,1250.00`,
    `${costCodeB.code},XYZ Lumber Supply,Framing lumber,08/16/2026,842.50`,
    `${costCodeA.code},ABC Framing LLC,Rough framing labor,08/15/2026,1250.00`,
    "ZZZZ,Unknown Vendor,Unrecognized item,08/17/2026,300.00",
    "9999,Bad Row Vendor,Malformed amount,08/18/2026,not-a-number",
  ].join("\n");

  const parsed = parseQuickBooksCsv(csv, {
    mappingProfile: {
      columnMapping: { item: "Item", vendor: "Name", amount: "Amount", date: "Date", memo: "Memo" },
      costCodeMatchStrategy: "prefix",
      costCodePrefixLength: 4,
      itemOverrides: {},
    },
    projectCostCodes: (costCodes ?? []).map((c) => ({ id: c.id, code: c.code })),
    existingExpenseKeys: new Set(),
  });
  const statusCounts = parsed.reduce((acc, r) => ({ ...acc, [r.matchStatus]: (acc[r.matchStatus] ?? 0) + 1 }), {});
  record(
    "parseQuickBooksCsv() — non-ISO date row parses, duplicate + error detected",
    statusCounts.new === 2 && statusCounts.duplicate === 1 && statusCounts.unmatched === 1 && statusCounts.error === 1,
    JSON.stringify(statusCounts)
  );

  // ---- Phase 4: real import_batches/import_rows (mirroring stageImportBatch()'s normalized shape) ----
  const { data: batch, error: batchErr } = await client
    .from("import_batches")
    .insert({
      project_id: project.id,
      source_filename: "checkpoint.csv",
      status: "ready_for_review",
      mapping_profile_id: mappingProfileId,
      imported_by: signUp.user.id,
    })
    .select("id, imported_by")
    .single();
  record("Real import_batches row created", !batchErr && !!batch, batchErr?.message);
  record(
    "import_batches.imported_by is populated with the acting user's id (final-review fix)",
    batch?.imported_by === signUp.user.id,
    `got ${batch?.imported_by}`
  );

  const rowInserts = parsed.map((row) => ({
    batch_id: batch.id,
    row_number: row.rowNumber,
    raw_data: {
      Item: row.rawData.Item ?? null,
      Name: row.rawData.Name ?? null,
      Memo: row.rawData.Memo ?? null,
      // Date is ALWAYS the pre-parsed, canonical YYYY-MM-DD string (see
      // parseQuickBooksCsv.ts's ParsedImportRow.canonicalDate doc
      // comment) -- never row.rawData.Date, the raw CSV string. Mirrors
      // the Amount treatment below; without this, this hand-built insert
      // would only pass because the hosted session's DateStyle happens
      // to be ISO, MDY -- exactly the dependency the post-closeout date
      // fix exists to eliminate.
      Date: row.canonicalDate,
      // Amount is ALWAYS the pre-parsed, canonical signed-integer-cents
      // value (see parseQuickBooksCsv.ts's ParsedImportRow.amountCents
      // doc comment) -- never row.rawData.Amount, the raw CSV string.
      // This mirrors stageImportBatch()'s exact contract with
      // confirm_import_batch(), fixed during the P4 final-review pass
      // (previously three call sites parsed Amount three incompatible
      // ways; now every writer stores this one canonical value).
      Amount: String(row.amountCents),
      __resolved_cost_code_id: row.resolvedCostCodeId,
    },
    match_status: row.matchStatus,
  }));
  const { data: insertedRows, error: rowsErr } = await client.from("import_rows").insert(rowInserts).select("id, match_status");
  record("Real import_rows created with normalized raw_data", !rowsErr && insertedRows?.length === parsed.length, rowsErr?.message);

  // ---- Phase 5: confirm blocked while unresolved rows remain ----
  const { error: blockedConfirmErr } = await confirmImportBatch(client, batch.id);
  record("confirm_import_batch() rejects while unmatched/error rows remain", !!blockedConfirmErr, blockedConfirmErr?.message);

  // Exclude the unmatched row; override the error row's cost code (edge case:
  // this does NOT fix the underlying malformed amount -- expected to still fail).
  const unmatchedRow = insertedRows.find((r) => r.match_status === "unmatched");
  const errorRow = insertedRows.find((r) => r.match_status === "error");
  await client.from("import_rows").update({ match_status: "excluded" }).eq("id", unmatchedRow.id);

  const { error: overrideErr } = await overrideImportRow(client, errorRow.id, costCodeB.id);
  record("overrideImportRow() on an error row — service call succeeds", !overrideErr, overrideErr?.message);

  const { error: stillBlockedErr } = await confirmImportBatch(client, batch.id);
  record(
    "Known limitation confirmed: overriding an error row's cost code doesn't fix its malformed amount — confirm still fails",
    !!stillBlockedErr,
    stillBlockedErr?.message
  );

  // Exclude the still-bad row so the batch can actually confirm.
  await client.from("import_rows").update({ match_status: "excluded" }).eq("id", errorRow.id);

  const { error: confirmErr } = await confirmImportBatch(client, batch.id);
  record("confirm_import_batch() succeeds once every row is resolved/excluded", !confirmErr, confirmErr?.message);

  const { error: doubleConfirmErr } = await confirmImportBatch(client, batch.id);
  record("Re-confirming an already-confirmed batch is rejected (idempotency guard)", !!doubleConfirmErr, doubleConfirmErr?.message);

  // ---- Phase 6: real reconciliation ----
  const { report, error: reconErr } = await getImportBatchReconciliation(client, batch.id);
  record("getImportBatchReconciliation() — real totals match", !reconErr && report?.matches === true, reconErr ?? JSON.stringify(report));

  // ---- Phase 7: posting a pending expense makes it count in actualCostCents ----
  const { data: pendingExpense } = await client
    .from("expenses")
    .select("id, amount_cents, cost_code_id, created_by")
    .eq("import_batch_id", batch.id)
    .limit(1)
    .single();
  record(
    "confirm_import_batch() populates expenses.created_by with auth.uid() (final-review fix)",
    pendingExpense?.created_by === signUp.user.id,
    `got ${pendingExpense?.created_by}`
  );
  const { error: postErr } = await client
    .from("expenses")
    .update({ financial_status: "posted", posted_by: signUp.user.id, posted_at: new Date().toISOString() })
    .eq("id", pendingExpense.id);
  record("Posting an imported pending expense succeeds", !postErr, postErr?.message);

  // ---- Phase 8: cross-batch, cross-date-format duplicate detection
  // (P4 post-closeout fix) ----
  // Proves the actual bug being fixed end-to-end, against the FULL real
  // pipeline (stageImportBatch() -> real DB reads/writes -> real
  // confirm_import_batch() RPC), not just at the pure-parse layer: stage
  // and confirm one batch with an ISO date (creating a real `expenses`
  // row with a real `transaction_date`), then stage a SEPARATE batch
  // reporting the exact same underlying transaction with its date
  // written in QuickBooks Desktop's own default MM/DD/YYYY export
  // format. Before the fix, stageImportBatch() built its duplicate-
  // detection key from the raw, unnormalized CSV date string compared
  // against Postgres's canonical YYYY-MM-DD `transaction_date`, so these
  // would never match. parseQuickBooksCsv()'s new canonicalDate (same
  // treatment as amountCents) fixes this. A second row in batch B, same
  // vendor/amount but a genuinely different date, is the negative
  // control proving the date component of the key still discriminates.
  const crossFormatVendor = `Cross Format Checkpoint Vendor ${stamp}`;

  const batchACsv = [
    "Item,Name,Memo,Date,Amount",
    `${costCodeA.code},${crossFormatVendor},Cross-format batch A (ISO date),2026-09-01,650.00`,
  ].join("\n");

  const stageA = await stageImportBatch(client, {
    projectId: project.id,
    mappingProfileId,
    fileName: "cross-format-batch-a.csv",
    fileContents: batchACsv,
    importedBy: signUp.user.id,
  });
  record(
    "stageImportBatch() — batch A (ISO date, real pipeline) stages its one row as 'new'",
    !stageA.error && stageA.rowCounts?.new === 1,
    stageA.error ?? JSON.stringify(stageA.rowCounts)
  );

  const { error: confirmAErr } = await confirmImportBatch(client, stageA.batchId);
  record("confirmImportBatch() — batch A confirms successfully, posting a real expense", !confirmAErr, confirmAErr?.message);

  const { data: batchAExpense, error: batchAExpenseErr } = await client
    .from("expenses")
    .select("id, transaction_date, amount_cents")
    .eq("import_batch_id", stageA.batchId)
    .single();
  record(
    "batch A's confirmed expense has a real transaction_date, canonical YYYY-MM-DD as returned by PostgREST",
    !batchAExpenseErr && batchAExpense?.transaction_date === "2026-09-01",
    `got ${JSON.stringify(batchAExpense)}${batchAExpenseErr ? ` / ${batchAExpenseErr.message}` : ""}`
  );

  const batchBCsv = [
    "Item,Name,Memo,Date,Amount",
    `${costCodeA.code},${crossFormatVendor},Cross-format batch B: MM/DD/YYYY row for the SAME date as batch A,09/01/2026,650.00`,
    `${costCodeA.code},${crossFormatVendor},Cross-format batch B negative control: same vendor/amount but a different date,09/02/2026,650.00`,
  ].join("\n");

  const stageB = await stageImportBatch(client, {
    projectId: project.id,
    mappingProfileId,
    fileName: "cross-format-batch-b.csv",
    fileContents: batchBCsv,
    importedBy: signUp.user.id,
  });
  record(
    "stageImportBatch() — batch B (separate batch, real pipeline): the MM/DD/YYYY row for the same underlying date as batch A's real posted expense is flagged 'duplicate'",
    !stageB.error && stageB.rowCounts?.duplicate === 1,
    stageB.error ?? JSON.stringify(stageB.rowCounts)
  );
  record(
    "stageImportBatch() — batch B negative control: same vendor/amount but a genuinely different date is 'new', not flagged a duplicate",
    !stageB.error && stageB.rowCounts?.new === 1,
    stageB.error ?? JSON.stringify(stageB.rowCounts)
  );
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable checkpoint data) ---");
  // A project with any posted expense can never be hard-deleted by this
  // schema's own design (cost_codes_no_delete_if_used,
  // expenses_no_delete_unless_pending, budget_ledger_append_only, and
  // audit_log's non-cascading project_id FK all block it, deliberately --
  // this is the append-only/audit-preservation non-negotiable holding
  // even against a service-role client). Try a real delete first (works
  // for a checkpoint run that never posts an expense); if it's rejected,
  // fall back to walking the project through its valid status chain to
  // 'archived' instead of leaving it silently in 'draft' with a
  // misleading "cleaned up" claim.
  for (const projectId of createdProjectIds) {
    const { error: deleteErr } = await admin.from("projects").delete().eq("id", projectId);
    if (!deleteErr) continue;
    console.warn(`  project ${projectId} could not be deleted (${deleteErr.message}) -- archiving instead.`);
    for (const status of ["active", "closed_out", "archived"]) {
      const { error: statusErr } = await admin.from("projects").update({ status }).eq("id", projectId);
      if (statusErr) {
        console.warn(`  could not advance project ${projectId} to '${status}': ${statusErr.message}`);
        break;
      }
    }
  }
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`  cleanup warning: could not delete user ${id}: ${error.message} (expected if a posted expense's posted_by still references this profile -- see project-archive note above)`);
  }
  for (const orgId of createdOrgIds) {
    const { error } = await admin.from("orgs").delete().eq("id", orgId);
    if (error) console.warn(`  cleanup warning: could not delete org ${orgId}: ${error.message}`);
  }
  console.log("cleanup done (see warnings above for any residue left by design, not by failure).");
}

main()
  .catch((err) => {
    console.error("\nCheckpoint script stopped early:", err.message);
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) {
      console.log("Failed checks:", failed.map((f) => f.name).join("; "));
      process.exit(1);
    }
  });
