/**
 * Unit-level tests for P5 Task 11's Action Center condition query
 * functions (actionCenterQueries.ts). Same "real function, hand-rolled
 * fake Supabase client, no network, no database" pattern already
 * established elsewhere in this repo (e.g. apps/web/test/procurement_actions_unit.ts) —
 * this file does not introduce node:test, matching this repo's actual
 * convention rather than the plan's illustrative snippet.
 *
 * Run with `npx tsx test/action_center_queries_unit.ts`.
 */
import { strict as assert } from "node:assert";
import { getOverdueBidPackages, getBackorderedMaterialLineItems } from "../src/services/actionCenterQueries";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

// --- getOverdueBidPackages -----------------------------------------------

function makeOverdueBidPackagesClient(rows: any[]) {
  const calls: any[] = [];
  const client = {
    from(table: string) {
      calls.push({ table });
      const builder: any = {
        select: (cols: string) => {
          calls.push({ select: cols });
          return builder;
        },
        eq: (col: string, val: unknown) => {
          calls.push({ eq: [col, val] });
          return builder;
        },
        lt: (col: string, val: unknown) => {
          calls.push({ lt: [col, val] });
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

async function testGetOverdueBidPackages() {
  console.log("--- getOverdueBidPackages ---");

  {
    const { client, calls } = makeOverdueBidPackagesClient([
      { id: "bp-1", title: "Framing Package", due_at: "2026-01-01T00:00:00Z" },
    ]);
    const result = await getOverdueBidPackages(client as never, "project-1");
    check("queries the bid_packages table", calls.some((c) => c.table === "bid_packages"));
    check("filters to the requested project_id", calls.some((c) => c.eq?.[0] === "project_id" && c.eq?.[1] === "project-1"));
    check("filters to status = published (not draft/awarded/cancelled)", calls.some((c) => c.eq?.[0] === "status" && c.eq?.[1] === "published"));
    check("filters due_at strictly before the current time", calls.some((c) => Array.isArray(c.lt) && c.lt[0] === "due_at"));
    check("maps id/title/due_at to camelCase", result[0].id === "bp-1" && result[0].title === "Framing Package" && result[0].dueAt === "2026-01-01T00:00:00Z");
  }

  {
    const { client } = makeOverdueBidPackagesClient([]);
    const result = await getOverdueBidPackages(client as never, "project-1");
    check("returns an empty array, not null/undefined, when nothing is overdue", Array.isArray(result) && result.length === 0);
  }

  {
    const client = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                lt: () => Promise.resolve({ data: null, error: { message: "boom" } }),
              }),
            }),
          }),
        };
      },
    };
    let threw = false;
    try {
      await getOverdueBidPackages(client as never, "project-1");
    } catch {
      threw = true;
    }
    check("propagates a real query error rather than swallowing it", threw);
  }
}

// --- getBackorderedMaterialLineItems ---------------------------------------

function makeBackorderedClient(rows: any[]) {
  const calls: any[] = [];
  const client = {
    from(table: string) {
      calls.push({ table });
      const builder: any = {
        select: (cols: string) => {
          calls.push({ select: cols });
          return builder;
        },
        eq: (col: string, val: unknown) => {
          calls.push({ eq: [col, val] });
          return builder;
        },
        neq: (col: string, val: unknown) => {
          calls.push({ neq: [col, val] });
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

async function testGetBackorderedMaterialLineItems() {
  console.log("--- getBackorderedMaterialLineItems ---");

  {
    const { client, calls } = makeBackorderedClient([
      { id: "li-1", material_order_id: "mo-1", cost_code_id: "cc-1010", description: "Lumber" },
    ]);
    const result = await getBackorderedMaterialLineItems(client as never, "project-1");
    check("queries the material_order_line_items table", calls.some((c) => c.table === "material_order_line_items"));
    check("filters to backordered = true", calls.some((c) => c.eq?.[0] === "backordered" && c.eq?.[1] === true));
    check("filters to the requested project via the joined material_orders.project_id", calls.some((c) => c.eq?.[0] === "material_orders.project_id" && c.eq?.[1] === "project-1"));
    check("excludes fully-received orders (a backordered flag on a received order is stale)", calls.some((c) => Array.isArray(c.neq) && c.neq[0] === "material_orders.status" && c.neq[1] === "received"));
    check("returns the LINE ITEM's own cost_code_id (Decision 2: line-level allocation is authoritative)", result[0].costCodeId === "cc-1010");
    check("maps material_order_id to materialOrderId", result[0].materialOrderId === "mo-1");
  }

  {
    const { client } = makeBackorderedClient([]);
    const result = await getBackorderedMaterialLineItems(client as never, "project-1");
    check("returns an empty array when nothing is backordered", Array.isArray(result) && result.length === 0);
  }
}

async function main() {
  await testGetOverdueBidPackages();
  await testGetBackorderedMaterialLineItems();
  console.log(`\naction_center_queries_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
