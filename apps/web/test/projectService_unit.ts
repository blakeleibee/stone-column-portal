/**
 * Unit-level tests for packages/02-app-shell/src/services/projectService.ts,
 * calling the REAL exported functions directly against a hand-rolled fake
 * Supabase client (no real network, no PGlite, no next dev server) — same
 * "real function, fake client" pattern authorization_unit.ts already
 * established in this file for assignStaffToProject/revokeStaffAssignment/
 * reactivateStaffAssignment. Split into its own file (rather than folded
 * into authorization_unit.ts) because this isn't an authorization scenario
 * — it's projectService.ts's own input-validation contract.
 *
 * Fix round 1 (code review, Task D2): createProject()'s pricing-model
 * guard. ProjectListWorkspace.tsx's create form disables 4 of the 6
 * PricingModel options in its <select> (fixed_price/time_and_materials/
 * hybrid_custom/other — project_fee_rules/create_project_with_defaults()
 * can only genuinely represent a cost-plus fee), but that's a UI-layer
 * restriction only. Before this fix round, nothing independently stopped
 * a DIFFERENT caller of createProject() — a different UI, a script, or
 * eventually the P15 AI tool-calling layer this codebase is explicitly
 * built to support (CLAUDE.md's AI-readiness non-negotiable) — from
 * submitting one of those 4 unsupported models straight through to
 * create_project_with_defaults() with a fee_basis attached. These tests
 * prove createProject() now rejects that BEFORE ever calling
 * supabase.rpc(...), for every one of the 4 unsupported models, and that
 * the 2 genuinely fee-supported models still work.
 *
 * Run with `npx tsx test/projectService_unit.ts`.
 */
import { strict as assert } from "node:assert";
import { createProject, type CreateProjectParams, type PricingModel } from "../../../packages/02-app-shell/src/services/projectService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

/**
 * A fake client whose `rpc()` records whether it was ever called and
 * with what payload — the actual thing this fix round proves: an
 * unsupported pricingModel must be rejected BEFORE this is reached, not
 * merely rejected somewhere downstream. Never needs `.from()`/`.auth`
 * since createProject() only ever calls `supabase.rpc(...)`.
 */
function makeFakeRpcClient() {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    async rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      return { data: "new-project-id", error: null };
    },
  };
  return { client, calls };
}

function baseParams(pricingModel: PricingModel): CreateProjectParams {
  return {
    orgId: "org-1",
    name: "Test Project",
    projectNumber: "1001",
    address: null,
    projectType: null,
    pricingModel,
    pricingModelLabel: null,
    feeBasis: "percentage",
    feeBasisPoints: 1500,
    feeFixedAmountCents: null,
    initialStaffProfileIds: [],
    initialClientProfileIds: [],
  };
}

async function main() {
  console.log(
    "--- createProject() rejects every fee-unsupported pricingModel before ever calling the RPC (Fix round 1, Task D2) ---"
  );
  for (const unsupportedModel of ["fixed_price", "time_and_materials", "hybrid_custom", "other"] as const) {
    const { client, calls } = makeFakeRpcClient();
    const result = await createProject(client as never, baseParams(unsupportedModel));
    check(`createProject() rejects pricingModel="${unsupportedModel}" (real function, fake client)`, "error" in result);
    check(
      `createProject() rejecting pricingModel="${unsupportedModel}" names the two supported alternatives in its error`,
      "error" in result && /Cost-Plus \(% Fee\)/.test(result.error) && /Cost-Plus \(Fixed Fee\)/.test(result.error)
    );
    check(
      `createProject() never reaches supabase.rpc(...) for pricingModel="${unsupportedModel}" (the actual gap this fix closes)`,
      calls.length === 0
    );
  }

  console.log(
    "\n--- createProject() still succeeds for the two genuinely fee-supported models (regression guard) ---"
  );
  for (const supportedModel of ["cost_plus_percentage", "cost_plus_fixed_fee"] as const) {
    const { client, calls } = makeFakeRpcClient();
    const result = await createProject(client as never, baseParams(supportedModel));
    check(`createProject() succeeds for pricingModel="${supportedModel}" (real function, fake client)`, "id" in result);
    check(`createProject() calls create_project_with_defaults exactly once for pricingModel="${supportedModel}"`, calls.length === 1);
    check(
      `createProject() forwards pricingModel="${supportedModel}" to the RPC unchanged`,
      calls.length === 1 && (calls[0].args as Record<string, unknown>).p_pricing_model === supportedModel
    );
  }

  console.log(`\nprojectService_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
