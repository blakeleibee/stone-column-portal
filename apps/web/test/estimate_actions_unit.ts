/**
 * Unit-level tests for budget service functions (budgetService.ts).
 * Uses a hand-rolled fake Supabase client (no real network, no database)
 * so these run in milliseconds and cover the explicitly-required validation
 * branches directly against the service functions themselves.
 *
 * Each check calls the REAL exported function from
 * packages/02-app-shell/src/services/budgetService (enterOriginalBudget,
 * adjustBudget), passing the fake Supabase client through. Invalid inputs
 * are validated and reject before reaching the database layer; valid inputs
 * prove the stub gets called.
 */
import { strict as assert } from "node:assert";
import { enterOriginalBudget, adjustBudget } from "../../../packages/02-app-shell/src/services/budgetService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

// Minimal fake Supabase client: just enough shape to prove validation
// branches short-circuit before .from() is called, and one case where
// valid input does call through to the stub.
function makeFakeSupabaseClient(opts: { allowInsert?: boolean } = {}) {
  return {
    from(table: string) {
      if (!opts.allowInsert) {
        throw new Error(`FAILED: .from('${table}') was called; validation should have rejected this input`);
      }
      return {
        async insert() {
          return { error: null };
        },
      };
    },
  };
}

async function main() {
  console.log("--- enterOriginalBudget validation tests ---");

  {
    const client = makeFakeSupabaseClient({ allowInsert: false });
    const result = await enterOriginalBudget(client as never, "proj-1", "code-1", -1);
    check("enterOriginalBudget rejects negative amount", result.error === "Amount must be a whole number of cents, zero or greater.");
  }

  {
    const client = makeFakeSupabaseClient({ allowInsert: false });
    const result = await enterOriginalBudget(client as never, "proj-1", "code-1", 1.5);
    check("enterOriginalBudget rejects non-integer amount", result.error === "Amount must be a whole number of cents, zero or greater.");
  }

  {
    const client = makeFakeSupabaseClient({ allowInsert: true });
    const result = await enterOriginalBudget(client as never, "proj-1", "code-1", 0);
    check("enterOriginalBudget accepts zero amount", result.error === undefined && Object.keys(result).length === 0);
  }

  {
    const client = makeFakeSupabaseClient({ allowInsert: true });
    const result = await enterOriginalBudget(client as never, "proj-1", "code-1", 10000, "Sample note");
    check("enterOriginalBudget accepts valid positive amount with note", result.error === undefined && Object.keys(result).length === 0);
  }

  console.log("\n--- adjustBudget validation tests ---");

  {
    const client = makeFakeSupabaseClient({ allowInsert: false });
    const result = await adjustBudget(client as never, "proj-1", "code-1", 0, "Zero delta");
    check("adjustBudget rejects zero delta", result.error === "Adjustment must be a non-zero whole number of cents.");
  }

  {
    const client = makeFakeSupabaseClient({ allowInsert: false });
    const result = await adjustBudget(client as never, "proj-1", "code-1", 1.5, "Non-integer delta");
    check("adjustBudget rejects non-integer delta", result.error === "Adjustment must be a non-zero whole number of cents.");
  }

  {
    const client = makeFakeSupabaseClient({ allowInsert: false });
    const result = await adjustBudget(client as never, "proj-1", "code-1", 500, "");
    check("adjustBudget rejects empty reason", result.error === "A reason is required for every budget adjustment.");
  }

  {
    const client = makeFakeSupabaseClient({ allowInsert: false });
    const result = await adjustBudget(client as never, "proj-1", "code-1", 500, "   ");
    check("adjustBudget rejects whitespace-only reason", result.error === "A reason is required for every budget adjustment.");
  }

  {
    const client = makeFakeSupabaseClient({ allowInsert: true });
    const result = await adjustBudget(client as never, "proj-1", "code-1", 500, "Client requested increase");
    check("adjustBudget accepts valid positive delta with reason", result.error === undefined && Object.keys(result).length === 0);
  }

  {
    const client = makeFakeSupabaseClient({ allowInsert: true });
    const result = await adjustBudget(client as never, "proj-1", "code-1", -250, "Over budget, reduce scope");
    check("adjustBudget accepts valid negative delta with reason", result.error === undefined && Object.keys(result).length === 0);
  }

  console.log(`\nestimate_actions_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
