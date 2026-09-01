#!/usr/bin/env node
// Checkpoint for P5 Task 9 (/admin/procurement screen): proves the real
// data layer end-to-end against the hosted dev project, calling the
// exact same service functions the app's Server Actions call -- never
// the service-role client for anything a real user flow does (service
// role is used only for teardown, same pattern as scripts/db/seed.mjs
// and every other live-p*-checkpoint.mjs in this directory).
//
// This is the REQUIRED cross-task regression check Task 9's own brief
// calls for: commit a real two-cost-code material order through the
// real procurementService functions (the exact ones MaterialOrderWorkspace
// calls via apps/web/app/admin/procurement/actions.ts), then confirm
// CommitmentsTable.tsx's own real groupOpenCommittedCosts() (Task 7)
// collapses the resulting two committed_costs rows into one group keyed
// by the shared material_order id -- closing the loop between Tasks 7
// and 9 against the real database, not just each task's own unit tests.
//
// Also exercises: receiving (partial receive + backordered flag, order
// status recomputing to 'partially_received'), PO issuance (real
// issue_document() snapshot, version 1, via documentIssuanceService --
// the exact function the honest "Issued -- Version N" UI state reads),
// and the post-commit line-item freeze trigger surfacing a legible
// message through addMaterialOrderLineItem's real `{error: error.message}`
// passthrough (Task 9's own required manual-verification bullet).
//
// Usage: node scripts/db/live-p5-task9-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from apps/web/.env.local if present).

try {
  process.loadEnvFile("apps/web/.env.local");
} catch {
  // fine if it doesn't exist -- env vars may already be exported
}

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

// Cross-package .ts/.tsx imports use CJS require() via tsx, not ESM
// `import` -- same documented reason as live-p4-checkpoint.mjs: tsx
// transpiles these as CommonJS and Node's ESM/CJS interop doesn't
// reliably detect named exports through a static `import` across this
// monorepo boundary, but require() resolves them correctly.
// CommitmentsTable.tsx is a "use client" React component file, but the
// only thing pulled from it here is its exported pure function
// groupOpenCommittedCosts -- "use client" is a Next.js build directive,
// inert at plain Node/tsx runtime, and nothing at this module's top
// level calls useRouter() (only the component function body does), so
// importing it here is safe.
const require = createRequire(import.meta.url);
const {
  createMaterialOrder,
  addMaterialOrderLineItem,
  commitMaterialOrder,
  recordReceivedQuantity,
  getMaterialOrderDetail,
} = require("../../packages/02-app-shell/src/services/procurementService.ts");
const { issuePurchaseOrder, getLatestIssuedDocument } = require("../../packages/02-app-shell/src/services/documentIssuanceService.ts");
const { SupabaseFinancialRepository } = require("../../packages/02-app-shell/src/data/supabaseFinancialRepository.ts");
const { groupOpenCommittedCosts } = require("../../packages/02-app-shell/src/components/CommitmentsTable.tsx");

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
  const email = `checkpoint-p5-task9-${stamp}@example.com`;
  const password = "Checkpoint-P5-Task9-Password-123!";
  const client = freshClient();

  const { data: signUp, error: signUpErr } = await client.auth.signUp({ email, password });
  record("Real signup", !signUpErr && !!signUp.user, signUpErr?.message);
  if (signUpErr) throw new Error("Cannot continue without a signed-up user.");
  createdUserIds.push(signUp.user.id);

  const { data: orgId, error: bootstrapErr } = await client.rpc("bootstrap_organization", {
    p_org_name: `Checkpoint P5 Task9 Org ${stamp}`,
    p_admin_full_name: "Checkpoint P5 Task9 Admin",
    p_admin_email: email,
  });
  record("bootstrap_organization()", !bootstrapErr && !!orgId, bootstrapErr?.message);
  if (bootstrapErr) throw new Error("Cannot continue without an org.");
  createdOrgIds.push(orgId);

  const { data: project, error: projectErr } = await client
    .from("projects")
    .insert({
      org_id: orgId,
      name: `Checkpoint P5 Task9 Project ${stamp}`,
      project_number: `CP5T9-${stamp}`,
      pricing_model: "cost_plus_percentage",
    })
    .select("id")
    .single();
  record("Real project created", !projectErr && !!project, projectErr?.message);
  if (projectErr) throw new Error("Cannot continue without a project.");
  createdProjectIds.push(project.id);

  const { error: templateErr } = await client.rpc("apply_standard_cost_code_template", { p_project_id: project.id });
  record("apply_standard_cost_code_template()", !templateErr, templateErr?.message);

  const { data: costCodes, error: costCodesErr } = await client
    .from("cost_codes")
    .select("id, code")
    .eq("project_id", project.id)
    .order("code", { ascending: true })
    .limit(2);
  record("Real cost codes fetched (need 2 distinct codes)", !costCodesErr && (costCodes?.length ?? 0) === 2, costCodesErr?.message);
  const [costCodeA, costCodeB] = costCodes ?? [];

  const { data: vendor, error: vendorErr } = await client
    .from("vendors")
    .insert({ org_id: orgId, name: `Checkpoint P5 Task9 Vendor ${stamp}` })
    .select("id, name")
    .single();
  record("Real vendor created", !vendorErr && !!vendor, vendorErr?.message);

  // ---- Phase 1: real material order creation (Task 9's "Create Order" form) ----
  const { id: orderId, error: createOrderErr } = await createMaterialOrder(client, project.id, costCodeA.id, vendor.id, `PO-CHK-${stamp}`);
  record("createMaterialOrder() — real insert, real default cost code + vendor", !createOrderErr && !!orderId, createOrderErr);

  const detailBeforeLines = await getMaterialOrderDetail(client, orderId);
  record("getMaterialOrderDetail() right after creation — draft, zero line items", detailBeforeLines?.status === "draft" && detailBeforeLines.lineItems.length === 0);

  // ---- Phase 2: two line items, two DIFFERENT cost codes (Decision 2 in the real DB) ----
  const { error: line1Err } = await addMaterialOrderLineItem(client, orderId, project.id, costCodeA.id, "2x4 studs (checkpoint)", 100, "ea", 500);
  record(`addMaterialOrderLineItem() — line 1 on ${costCodeA?.code} (kept at the order default)`, !line1Err, line1Err);

  const { error: line2Err } = await addMaterialOrderLineItem(client, orderId, project.id, costCodeB.id, "1/2in drywall sheets (checkpoint)", 30, "sheet", 1000);
  record(`addMaterialOrderLineItem() — line 2 on ${costCodeB?.code} (explicitly overridden, NOT the order default)`, !line2Err, line2Err);

  // ---- Phase 3: commit -- the RPC returns the {costCodeId, committedCostId}[] mapping directly ----
  const commitResult = await commitMaterialOrder(client, orderId);
  record(
    "commitMaterialOrder() — real RPC call returns exactly 2 rows, one per distinct cost code",
    !commitResult.error && commitResult.committedCosts?.length === 2,
    commitResult.error ?? JSON.stringify(commitResult.committedCosts)
  );
  const committedCostIds = (commitResult.committedCosts ?? []).map((c) => c.committedCostId);

  const detailAfterCommit = await getMaterialOrderDetail(client, orderId);
  record("Order status is 'ordered' immediately after commit_material_order()", detailAfterCommit?.status === "ordered", detailAfterCommit?.status);

  // ---- Phase 4 (THE REQUIRED CROSS-TASK REGRESSION CHECK): Task 7's real
  // groupOpenCommittedCosts() must collapse these 2 real committed_costs
  // rows into ONE group, keyed by their shared sourceId (= this material
  // order's id) -- exactly what /admin/commitments renders as one
  // captioned table for staff. ----
  const repo = new SupabaseFinancialRepository(client);
  const allCommittedCosts = await repo.getCommittedCosts(project.id);
  const thisOrdersCommittedCosts = allCommittedCosts.filter((c) => committedCostIds.includes(c.id));
  record(
    "repo.getCommittedCosts() — the real committed_costs rows for both cost codes are present, with real dollar amounts",
    thisOrdersCommittedCosts.length === 2,
    JSON.stringify(thisOrdersCommittedCosts)
  );
  const amountByCostCode = new Map(thisOrdersCommittedCosts.map((c) => [c.costCodeId, c.amountCents]));
  record(
    `${costCodeA?.code}'s committed amount is exactly 100 * $5.00 = $500.00 (50000 cents), the real server-computed figure`,
    amountByCostCode.get(costCodeA.id) === 50000,
    `got ${amountByCostCode.get(costCodeA.id)}`
  );
  record(
    `${costCodeB?.code}'s committed amount is exactly 30 * $10.00 = $300.00 (30000 cents), the real server-computed figure`,
    amountByCostCode.get(costCodeB.id) === 30000,
    `got ${amountByCostCode.get(costCodeB.id)}`
  );

  const groups = groupOpenCommittedCosts(allCommittedCosts);
  const thisOrdersGroup = groups.find((g) => g.key === orderId);
  record(
    "CommitmentsTable.groupOpenCommittedCosts() (Task 7, real function, real data) collapses both rows into ONE group keyed by the material order's id",
    !!thisOrdersGroup && thisOrdersGroup.rows.length === 2,
    thisOrdersGroup ? `group key=${thisOrdersGroup.key}, rows=${thisOrdersGroup.rows.length}` : "no group found for this order"
  );
  record(
    "/admin/commitments would render this as a multi-row caption ('N cost codes'), exactly like a real committed material order",
    thisOrdersGroup?.rows.length === 2
  );

  // ---- Phase 5: post-commit line-item freeze -- the real trigger's
  // message must surface legibly through the exact service function the
  // UI calls, not a raw Postgres error dump. ----
  const { error: postCommitAddErr } = await addMaterialOrderLineItem(client, orderId, project.id, costCodeA.id, "post-commit attempt (should be rejected)", 1, undefined, 100);
  record("A post-commit addMaterialOrderLineItem() call is rejected", !!postCommitAddErr, postCommitAddErr);
  record(
    "The rejection is the DB trigger's own legible sentence (not a raw error code/dump) -- mentions 'no longer draft' and 'frozen once committed'",
    !!postCommitAddErr && postCommitAddErr.includes("no longer draft") && postCommitAddErr.includes("frozen once committed"),
    postCommitAddErr
  );

  // ---- Phase 6: receiving -- partial receive + backordered flag on one
  // line, order status recomputes to 'partially_received'. ----
  const lineForCostCodeA = detailAfterCommit.lineItems.find((li) => li.costCodeId === costCodeA.id);
  const { error: receiveErr } = await recordReceivedQuantity(client, lineForCostCodeA.id, 40, true);
  record("recordReceivedQuantity() — real partial receive + backordered flag", !receiveErr, receiveErr);

  const detailAfterReceive = await getMaterialOrderDetail(client, orderId);
  const receivedLine = detailAfterReceive.lineItems.find((li) => li.id === lineForCostCodeA.id);
  record("The line's receivedQuantity/backordered were really written", receivedLine?.receivedQuantity === 40 && receivedLine?.backordered === true, JSON.stringify(receivedLine));
  record("Order status recomputed to 'partially_received' (some but not all quantity received)", detailAfterReceive.status === "partially_received", detailAfterReceive.status);

  // ---- Phase 7: PO issuance -- the honest "Issued -- Version N" state's
  // real data source. ----
  const issueResult = await issuePurchaseOrder(client, orderId);
  record("issuePurchaseOrder() — real issue_document() snapshot", !issueResult.error && !!issueResult.issuedDocumentId, issueResult.error);

  const latestDoc = await getLatestIssuedDocument(client, "purchase_order", orderId);
  record("getLatestIssuedDocument() — real version number the UI would show ('Purchase Order issued — Version 1')", latestDoc?.version === 1, JSON.stringify(latestDoc));
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable checkpoint data) ---");
  // Same rationale as live-p4-checkpoint.mjs: a project with financial
  // history this schema treats as append-only/audit-preserved can't
  // always be hard-deleted even by the service-role client. Try a real
  // delete first; if rejected, archive instead of silently leaving it in
  // 'draft' with a misleading "cleaned up" claim.
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
    if (error) console.warn(`  cleanup warning: could not delete user ${id}: ${error.message}`);
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
