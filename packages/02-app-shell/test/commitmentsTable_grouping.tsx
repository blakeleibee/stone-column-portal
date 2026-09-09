/**
 * Regression coverage for CommitmentsTable.tsx (P5 Task 7) — the
 * grouping logic that renders several committed_costs rows sharing one
 * `sourceId` (a material order that produced multiple cost-code lines)
 * under a single caption, while every other open row stays its own
 * single-row group. Same pattern as this package's other component
 * tests: react-test-renderer, hand-rolled `check()` assertions, no
 * jsdom.
 *
 * Two layers, matching estimateTable_field_sync.tsx's own precedent:
 *   1. Pure-function tests against `groupOpenCommittedCosts` directly
 *      (no rendering involved) — the fastest, most direct coverage of
 *      the actual grouping decision.
 *   2. A react-test-renderer mount test proving the rendered output:
 *      a multi-row material-order group shows a `<caption>` naming the
 *      group, a lone unrelated row does not.
 *
 * Run with `npx tsx test/commitmentsTable_grouping.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CommitmentsTable, groupOpenCommittedCosts } from "../src/components/CommitmentsTable";
import type { CommittedCost, CostCode } from "../../01-financial-engine/src/types";

// CommitmentsTable calls useRouter() (router.refresh() after a
// successful supersede) -- same "wrap in a real AppRouterContext.Provider,
// imported from Next's own shared-runtime module" precedent as
// projectListWorkspace_pricingModel.tsx, since useRouter() throws
// immediately ("invariant expected app router to be mounted") with no
// provider present.
function mockRouter(): AppRouterInstance {
  return {
    back() {},
    forward() {},
    refresh() {},
    push() {},
    replace() {},
    prefetch() {},
  };
}

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function committedCost(overrides: Partial<CommittedCost> & Pick<CommittedCost, "id" | "costCodeId">): CommittedCost {
  return {
    projectId: "proj_1",
    amountCents: 100_000,
    status: "open",
    ...overrides,
  };
}

async function main() {
  console.log("--- groupOpenCommittedCosts: pure grouping logic ---");
  {
    const rows: CommittedCost[] = [
      committedCost({ id: "c1", costCodeId: "cc_framing", sourceType: "material_order", sourceId: "order_1" }),
      committedCost({ id: "c2", costCodeId: "cc_lumber", sourceType: "material_order", sourceId: "order_1" }),
    ];
    const groups = groupOpenCommittedCosts(rows);
    check("two rows sharing a material_order sourceId collapse into one group", groups.length === 1);
    check("the group's key is the shared sourceId", groups[0].key === "order_1");
    check("the group contains both rows, in original order", groups[0].rows.map((r) => r.id).join(",") === "c1,c2");
  }

  {
    // A single unrelated row (no sourceId shared with anything else)
    // must render as its own group, not get swept into someone else's.
    const rows: CommittedCost[] = [
      committedCost({ id: "c1", costCodeId: "cc_framing", sourceType: "material_order", sourceId: "order_1" }),
      committedCost({ id: "c2", costCodeId: "cc_lumber", sourceType: "material_order", sourceId: "order_1" }),
      committedCost({ id: "c3", costCodeId: "cc_roofing", sourceType: "bid_award", sourceId: "bid_9" }),
    ];
    const groups = groupOpenCommittedCosts(rows);
    check("a two-row material-order group plus one unrelated row yields two groups", groups.length === 2);
    const soloGroup = groups.find((g) => g.rows[0].id === "c3")!;
    check("the unrelated row is its own single-row group", soloGroup.rows.length === 1);
    check("a non-material_order row's group key is its own id, not its sourceId", soloGroup.key === "c3");
  }

  {
    // Two DIFFERENT bid-award rows that happen to share the same
    // sourceId must NOT be grouped together — grouping only applies to
    // sourceType === "material_order" (CommittedCost.sourceId's own doc
    // comment: "NOT unique — a material order may back several rows
    // sharing one sourceId" is scoped to material orders specifically).
    const rows: CommittedCost[] = [
      committedCost({ id: "c1", costCodeId: "cc_a", sourceType: "bid_award", sourceId: "shared" }),
      committedCost({ id: "c2", costCodeId: "cc_b", sourceType: "bid_award", sourceId: "shared" }),
    ];
    const groups = groupOpenCommittedCosts(rows);
    check("two bid_award rows sharing a sourceId still render as two separate groups", groups.length === 2);
  }

  {
    // Non-open rows (fulfilled/cancelled/superseded) never appear —
    // this screen only ever shows what's still open to act on.
    const rows: CommittedCost[] = [
      committedCost({ id: "c1", costCodeId: "cc_a", status: "open" }),
      committedCost({ id: "c2", costCodeId: "cc_b", status: "fulfilled" }),
      committedCost({ id: "c3", costCodeId: "cc_c", status: "cancelled" }),
    ];
    const groups = groupOpenCommittedCosts(rows);
    check("only the open row is grouped", groups.length === 1 && groups[0].rows[0].id === "c1");
  }

  {
    // A material_order row with no sourceId at all falls back to its
    // own id (can't group on an absent key).
    const rows: CommittedCost[] = [committedCost({ id: "c1", costCodeId: "cc_a", sourceType: "material_order" })];
    const groups = groupOpenCommittedCosts(rows);
    check("a material_order row with no sourceId groups under its own id", groups[0].key === "c1");
  }

  console.log("\n--- Rendered output: caption present only for a multi-row group ---");
  {
    const costCodes: CostCode[] = [
      { id: "cc_framing", projectId: "proj_1", code: "06-100 Framing", feeEligible: true, status: "active", isArchived: false, divisionId: null, activityName: null, scopeDescription: null, includeInEstimate: true, billable: true },
      { id: "cc_lumber", projectId: "proj_1", code: "06-200 Lumber", feeEligible: true, status: "active", isArchived: false, divisionId: null, activityName: null, scopeDescription: null, includeInEstimate: true, billable: true },
      { id: "cc_roofing", projectId: "proj_1", code: "07-100 Roofing", feeEligible: true, status: "active", isArchived: false, divisionId: null, activityName: null, scopeDescription: null, includeInEstimate: true, billable: true },
    ];
    const rows: CommittedCost[] = [
      committedCost({ id: "c1", costCodeId: "cc_framing", sourceType: "material_order", sourceId: "order_1", vendorName: "ABC Lumber" }),
      committedCost({ id: "c2", costCodeId: "cc_lumber", sourceType: "material_order", sourceId: "order_1", vendorName: "ABC Lumber" }),
      committedCost({ id: "c3", costCodeId: "cc_roofing", sourceType: "bid_award", sourceId: "bid_9", vendorName: "Roof Co" }),
    ];

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppRouterContext.Provider value={mockRouter()}>
          <CommitmentsTable
            committedCosts={rows}
            costCodes={costCodes}
            supersedeCommittedCost={async () => ({ newCommittedCostId: "new_1" })}
          />
        </AppRouterContext.Provider>
      );
    });

    const captions = renderer.root.findAllByType("caption");
    check("exactly one caption renders (for the two-row material-order group only)", captions.length === 1);
    const captionText = captions[0].children.join("");
    check("the caption names the group's row count", captionText.includes("2 cost codes"));
    check("the caption includes the (truncated) shared sourceId", captionText.includes("order_1".slice(0, 8)));

    const tables = renderer.root.findAllByType("table");
    check("two <table> groups render (one per group)", tables.length === 2);
  }

  console.log(`\ncommitmentsTable_grouping.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
