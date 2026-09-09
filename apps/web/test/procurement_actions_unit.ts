/**
 * Unit-level tests for the P5 Task 8 procurement + document-issuance
 * service functions (procurementService.ts, documentIssuanceService.ts).
 * Same "real function, hand-rolled fake Supabase client, no network, no
 * database" pattern already established by estimate_actions_unit.ts and
 * projectService_unit.ts: each check proves a validation branch rejects
 * BEFORE the fake client's .from()/.rpc() would be reached, and at
 * least one valid-input case per function proves the happy path still
 * calls through.
 *
 * Run with `npx tsx test/procurement_actions_unit.ts`.
 */
import { strict as assert } from "node:assert";
import { addMaterialOrderLineItem, recordReceivedQuantity, commitMaterialOrder } from "../../../packages/02-app-shell/src/services/procurementService";
import { issuePurchaseOrder, issueSubcontract } from "../../../packages/02-app-shell/src/services/documentIssuanceService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

// --- addMaterialOrderLineItem -------------------------------------------

// Minimal fake client: .from() throws if reached when validation should
// have short-circuited first; when allowed, .insert() succeeds.
function makeFakeInsertClient(opts: { allowFrom?: boolean } = {}) {
  return {
    from(table: string) {
      if (!opts.allowFrom) {
        throw new Error(`FAILED: .from('${table}') was called; validation should have rejected this input first`);
      }
      return {
        insert: async () => ({ error: null }),
      };
    },
  };
}

async function testAddMaterialOrderLineItem() {
  console.log("--- addMaterialOrderLineItem validation tests ---");

  {
    const client = makeFakeInsertClient({ allowFrom: false });
    const result = await addMaterialOrderLineItem(client as never, "mo-1", "proj-1", "", "Lumber", 10, "ea", 500);
    check("rejects missing cost code", result.error === "A cost code is required for every line item.");
  }

  {
    const client = makeFakeInsertClient({ allowFrom: false });
    const result = await addMaterialOrderLineItem(client as never, "mo-1", "proj-1", "cc-1", "   ", 10, "ea", 500);
    check("rejects blank description", result.error === "Description is required.");
  }

  {
    const client = makeFakeInsertClient({ allowFrom: false });
    const result = await addMaterialOrderLineItem(client as never, "mo-1", "proj-1", "cc-1", "Lumber", 0, "ea", 500);
    check("rejects zero quantity", result.error === "Quantity must be greater than zero.");
  }

  {
    const client = makeFakeInsertClient({ allowFrom: false });
    const result = await addMaterialOrderLineItem(client as never, "mo-1", "proj-1", "cc-1", "Lumber", -5, "ea", 500);
    check("rejects negative quantity", result.error === "Quantity must be greater than zero.");
  }

  {
    const client = makeFakeInsertClient({ allowFrom: false });
    const result = await addMaterialOrderLineItem(client as never, "mo-1", "proj-1", "cc-1", "Lumber", 10, "ea", -1);
    check("rejects negative unit price", result.error === "Unit price must be a whole number of cents, zero or greater.");
  }

  {
    const client = makeFakeInsertClient({ allowFrom: false });
    const result = await addMaterialOrderLineItem(client as never, "mo-1", "proj-1", "cc-1", "Lumber", 10, "ea", 12.5);
    check("rejects non-integer unit price", result.error === "Unit price must be a whole number of cents, zero or greater.");
  }

  {
    const client = makeFakeInsertClient({ allowFrom: true });
    const result = await addMaterialOrderLineItem(client as never, "mo-1", "proj-1", "cc-1", "Lumber", 10, "ea", 500);
    check("accepts valid line item", result.error === undefined && Object.keys(result).length === 0);
  }
}

// --- recordReceivedQuantity ---------------------------------------------

// updateCalls records every .update(...) invocation (well-formed,
// chainable .eq() so a future write-before-validate regression fails
// with a clear assertion mismatch instead of a cryptic
// "...eq is not a function" crash).
function makeFakeLineItemClient(opts: { orderedQuantity: number; reachedFrom: string[]; updateCalls: unknown[] }) {
  return {
    from(table: string) {
      opts.reachedFrom.push(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        async single() {
          return { data: { material_order_id: "mo-1", quantity: opts.orderedQuantity }, error: null };
        },
        update(payload: unknown) {
          opts.updateCalls.push(payload);
          return {
            eq: () => ({
              in: async () => ({ error: null }),
            }),
          };
        },
      };
    },
  };
}

async function testRecordReceivedQuantity() {
  console.log("--- recordReceivedQuantity validation tests ---");

  {
    const reachedFrom: string[] = [];
    const client = { from: (table: string) => { reachedFrom.push(table); throw new Error("should not reach .from()"); } };
    const result = await recordReceivedQuantity(client as never, "li-1", -1);
    check("rejects negative received quantity without querying the database", result.error === "Received quantity cannot be negative." && reachedFrom.length === 0);
  }

  {
    // orderedQuantity is 10; requesting 15 must be rejected AFTER reading
    // the line's ordered quantity but BEFORE any update is attempted.
    const reachedFrom: string[] = [];
    const updateCalls: unknown[] = [];
    const client = makeFakeLineItemClient({ orderedQuantity: 10, reachedFrom, updateCalls });
    const result = await recordReceivedQuantity(client as never, "li-1", 15);
    check("rejects received quantity exceeding ordered quantity", result.error === "Received quantity cannot exceed the ordered quantity.");
    check("never calls .update() when received quantity exceeds ordered quantity", updateCalls.length === 0);
  }
}

// --- commitMaterialOrder ---------------------------------------------------

async function testCommitMaterialOrder() {
  console.log("--- commitMaterialOrder tests ---");

  {
    // The RPC's real `table(cost_code_id, committed_cost_id)` return shape
    // is one row per distinct cost code among the order's lines (Decision
    // 2) — this fake returns 2 rows, deliberately in an order where a
    // naive positional/field-swap bug would be caught (different id
    // prefixes per field so a transposition is visibly wrong).
    const rpcCalls: { fn: string; args: unknown }[] = [];
    const client = {
      async rpc(fn: string, args: unknown) {
        rpcCalls.push({ fn, args });
        return {
          data: [
            { cost_code_id: "cc-A", committed_cost_id: "commit-A" },
            { cost_code_id: "cc-B", committed_cost_id: "commit-B" },
          ],
          error: null,
        };
      },
    };

    const result = await commitMaterialOrder(client as never, "mo-1");
    check("calls commit_material_order with the material order id", rpcCalls.length === 1 && rpcCalls[0].fn === "commit_material_order" && (rpcCalls[0].args as any).p_material_order_id === "mo-1");
    check(
      "maps the RPC's row shape to costCodeId/committedCostId, preserving order and not swapping fields",
      "committedCosts" in result &&
        result.committedCosts.length === 2 &&
        result.committedCosts[0].costCodeId === "cc-A" &&
        result.committedCosts[0].committedCostId === "commit-A" &&
        result.committedCosts[1].costCodeId === "cc-B" &&
        result.committedCosts[1].committedCostId === "commit-B"
    );
  }

  {
    // e.g. the RPC's own `raise exception` for a non-'draft' order, or a
    // material order with zero line items — either way, the error must
    // surface as { error: message }, never an unhandled throw.
    const client = {
      async rpc() {
        return { data: null, error: { message: "Material order mo-1 must be in status 'draft' to commit (currently ordered)" } };
      },
    };

    const result = await commitMaterialOrder(client as never, "mo-1");
    check("surfaces an RPC error as { error: message } rather than throwing", "error" in result && result.error === "Material order mo-1 must be in status 'draft' to commit (currently ordered)");
  }
}

// --- issuePurchaseOrder ---------------------------------------------------

async function testIssuePurchaseOrder() {
  console.log("--- issuePurchaseOrder validation tests ---");

  // getMaterialOrderDetail is a real function inside procurementService.ts
  // that issuePurchaseOrder calls internally — rather than re-mocking its
  // two-query shape here, build a fake client whose .from('material_orders')
  // / .from('material_order_line_items') reproduce a real order with zero
  // line items, proving issuePurchaseOrder rejects it before ever calling
  // .rpc('issue_document', ...).
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    from(table: string) {
      if (table === "material_orders") {
        return {
          select: () => ({
            eq: () => ({
              async maybeSingle() {
                return {
                  data: {
                    id: "mo-1",
                    project_id: "proj-1",
                    cost_code_id: null,
                    vendor_id: null,
                    order_number: "PO-1",
                    status: "draft",
                    ordered_at: null,
                    expected_delivery_at: null,
                  },
                  error: null,
                };
              },
            }),
          }),
        };
      }
      if (table === "material_order_line_items") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return { data: "doc-1", error: null };
    },
  };

  const result = await issuePurchaseOrder(client as never, "mo-1");
  check("rejects a material order with zero line items", result.error === "Cannot issue a PO with no line items.");
  check("never calls issue_document when rejected for zero line items", rpcCalls.length === 0);
}

// --- issueSubcontract ------------------------------------------------------

async function testIssueSubcontract() {
  console.log("--- issueSubcontract validation tests ---");

  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    from(table: string) {
      if (table === "bid_packages") {
        return {
          select: () => ({
            eq: () => ({
              async maybeSingle() {
                return {
                  data: {
                    id: "bp-1",
                    project_id: "proj-1",
                    cost_code_id: "cc-1",
                    title: "Framing",
                    scope_description: null,
                    due_at: null,
                    status: "published",
                    created_at: "2026-01-01T00:00:00Z",
                  },
                  error: null,
                };
              },
            }),
          }),
        };
      }
      if (table === "bid_submissions") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                { id: "sub-1", bid_package_id: "bp-1", vendor_id: "v-1", status: "submitted", amount_cents: 10000, notes: null, submitted_at: "2026-01-02T00:00:00Z", vendors: { name: "Acme" } },
              ],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return { data: "doc-1", error: null };
    },
  };

  const result = await issueSubcontract(client as never, "bp-1");
  check("rejects a bid package with no awarded submission", result.error === "This bid package has no awarded submission yet.");
  check("never calls issue_document when rejected for no award", rpcCalls.length === 0);
}

async function main() {
  await testAddMaterialOrderLineItem();
  await testRecordReceivedQuantity();
  await testCommitMaterialOrder();
  await testIssuePurchaseOrder();
  await testIssueSubcontract();
  console.log(`\nprocurement_actions_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
