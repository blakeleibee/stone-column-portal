/**
 * Unit-level tests for P5.2 Phase C's new bidService.ts functions:
 * vendor bid submission/revision (submitVendorBid, getVendorOwnBidSubmission,
 * listBidSubmissionRevisions), vendor-submitted questions
 * (askVendorBidQuestion), and addendum acknowledgment tracking
 * (acknowledgeBidAddendum, listBidAddendumAcknowledgments,
 * getVendorBidAddendumAcknowledgments). Same "real function, hand-rolled
 * fake Supabase client, no network, no database" pattern as
 * bidService_phaseB_unit.ts — the real DB-level enforcement (schema/026's
 * triggers/RLS) is proven separately by tests/sql/package_p5_2_phase_c_tests.sql;
 * this file proves the service layer's own request-shaping and error
 * handling in isolation.
 *
 * Run with `npx tsx test/bidService_phaseC_unit.ts`.
 */
import { strict as assert } from "node:assert";
import {
  submitVendorBid,
  getVendorOwnBidSubmission,
  listBidSubmissionRevisions,
  askVendorBidQuestion,
  acknowledgeBidAddendum,
  listBidAddendumAcknowledgments,
  getVendorBidAddendumAcknowledgments,
} from "../src/services/bidService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function makeChain(resolve: () => { data: any; error: any }): any {
  const step: any = {
    select: () => step,
    eq: () => step,
    in: () => step,
    order: () => step,
    limit: () => step,
    is: () => step,
    maybeSingle: async () => resolve(),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return step;
}

// --- submitVendorBid --------------------------------------------------

async function testSubmitVendorBid() {
  console.log("--- submitVendorBid ---");

  {
    const client = { rpc: async () => { throw new Error("rpc should not be called"); } };
    const result = await submitVendorBid(client as any, "sub-1", -100);
    check("rejects a negative amount before calling the RPC", result.error === "Bid amount must be a whole number of cents, zero or greater.");
  }

  {
    const client = { rpc: async () => { throw new Error("rpc should not be called"); } };
    const result = await submitVendorBid(client as any, "sub-1", 100.5);
    check("rejects a non-integer amount before calling the RPC", result.error === "Bid amount must be a whole number of cents, zero or greater.");
  }

  {
    const rpcCalls: { fn: string; args: any }[] = [];
    const client = {
      rpc: async (fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        return { data: "rev-1", error: null };
      },
    };
    const result = await submitVendorBid(client as any, "sub-1", 420000, "  base bid  ");
    check("calls submit_bid_revision with the exact submission id/amount/notes", rpcCalls.length === 1 && rpcCalls[0].fn === "submit_bid_revision");
    check(
      "passes p_bid_submission_id/p_amount_cents/p_notes as named RPC args",
      rpcCalls[0].args.p_bid_submission_id === "sub-1" && rpcCalls[0].args.p_amount_cents === 420000 && rpcCalls[0].args.p_notes === "  base bid  "
    );
    check("returns the RPC's revision id, not a re-derived value", result.revisionId === "rev-1");
  }

  {
    const client = { rpc: async () => ({ data: null, error: { message: "This bid package is no longer accepting submissions (status: cancelled)" } }) };
    const result = await submitVendorBid(client as any, "sub-1", 100);
    check("surfaces an RPC error as { error: message } rather than throwing", result.error === "This bid package is no longer accepting submissions (status: cancelled)");
  }
}

// --- getVendorOwnBidSubmission -----------------------------------------

async function testGetVendorOwnBidSubmission() {
  console.log("--- getVendorOwnBidSubmission ---");

  {
    const client = {
      from: () =>
        makeChain(() => ({
          data: {
            id: "sub-1",
            bid_package_id: "bp-1",
            vendor_id: "v-1",
            status: "invited",
            amount_cents: null,
            notes: null,
            submitted_at: null,
            vendors: { name: "Acme Roofing" },
          },
          error: null,
        })),
    };
    const result = await getVendorOwnBidSubmission(client as any, "bp-1");
    check("maps a found row to the correct BidSubmissionRow shape", !!result && result.id === "sub-1" && result.vendorName === "Acme Roofing" && result.status === "invited");
    check("a freshly-fetched own-submission has an empty revisions array (populated separately)", !!result && result.revisions.length === 0);
  }

  {
    const client = { from: () => makeChain(() => ({ data: null, error: null })) };
    const result = await getVendorOwnBidSubmission(client as any, "bp-1");
    check("returns null (not a throw) when RLS/the query finds no row — never invited, or a different package", result === null);
  }

  {
    const client = { from: () => makeChain(() => ({ data: null, error: { message: "boom" } })) };
    await assert.rejects(() => getVendorOwnBidSubmission(client as any, "bp-1"));
    check("propagates a real query error rather than swallowing it", true);
  }
}

// --- listBidSubmissionRevisions -----------------------------------------

async function testListBidSubmissionRevisions() {
  console.log("--- listBidSubmissionRevisions ---");

  const client = {
    from: () =>
      makeChain(() => ({
        data: [
          { id: "rev-2", bid_submission_id: "sub-1", revision_number: 2, amount_cents: 398500, notes: "revised", submitted_by: "u-1", submitted_at: "2026-02-01T00:00:00Z" },
          { id: "rev-1", bid_submission_id: "sub-1", revision_number: 1, amount_cents: 420000, notes: null, submitted_by: "u-1", submitted_at: "2026-01-01T00:00:00Z" },
        ],
        error: null,
      })),
  };
  const revisions = await listBidSubmissionRevisions(client as any, "sub-1");
  check("maps every revision row to camelCase", revisions.length === 2 && revisions[0].revisionNumber === 2 && revisions[1].amountCents === 420000);
}

// --- askVendorBidQuestion -----------------------------------------------

async function testAskVendorBidQuestion() {
  console.log("--- askVendorBidQuestion ---");

  {
    const client = { from: () => { throw new Error("should not query for blank text"); } };
    const result = await askVendorBidQuestion(client as any, "bp-1", "v-1", "   ");
    check("rejects blank question text before any write", result.error === "Question text is required.");
  }

  {
    const inserts: any[] = [];
    const client = {
      from: (table: string) => ({
        insert: (payload: any) => {
          inserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
      }),
    };
    const result = await askVendorBidQuestion(client as any, "bp-1", "v-1", "Which sheet governs?");
    check("no error on a successful insert", !result.error);
    check("inserts into bid_questions", inserts.length === 1 && inserts[0].table === "bid_questions");
    check(
      "the insert payload forces source='vendor_submitted', recorded_by=null, visible_to_all_vendors=false — the exact two overrides schema/026 requires",
      inserts[0].payload.source === "vendor_submitted" && inserts[0].payload.recorded_by === null && inserts[0].payload.visible_to_all_vendors === false
    );
    check("the payload carries the real bid_package_id/vendor_id/trimmed question_text", inserts[0].payload.bid_package_id === "bp-1" && inserts[0].payload.vendor_id === "v-1" && inserts[0].payload.question_text === "Which sheet governs?");
  }

  {
    const client = { from: () => ({ insert: async () => ({ error: { message: "not invited to this package" } }) }) };
    const result = await askVendorBidQuestion(client as any, "bp-1", "v-1", "Anything?");
    check("propagates a real database error as { error }", result.error === "not invited to this package");
  }
}

// --- acknowledgeBidAddendum ----------------------------------------------

async function testAcknowledgeBidAddendum() {
  console.log("--- acknowledgeBidAddendum ---");

  {
    const inserts: any[] = [];
    const client = {
      from: (table: string) => ({
        insert: (payload: any) => {
          inserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
      }),
    };
    const result = await acknowledgeBidAddendum(client as any, "addendum-1", "v-1");
    check("no error on a successful acknowledgment insert", !result.error);
    check("inserts into bid_addendum_acknowledgments with exactly bid_addendum_id/vendor_id (acknowledged_by/acknowledged_at are DB defaults)", inserts.length === 1 && inserts[0].table === "bid_addendum_acknowledgments" && inserts[0].payload.bid_addendum_id === "addendum-1" && inserts[0].payload.vendor_id === "v-1");
  }

  {
    const client = { from: () => ({ insert: async () => ({ error: { message: "duplicate key value violates unique constraint" } }) }) };
    const result = await acknowledgeBidAddendum(client as any, "addendum-1", "v-1");
    check("a duplicate acknowledgment surfaces as { error }, not a thrown exception", result.error === "duplicate key value violates unique constraint");
  }
}

// --- listBidAddendumAcknowledgments / getVendorBidAddendumAcknowledgments ---

async function testListAndGetAcknowledgments() {
  console.log("--- listBidAddendumAcknowledgments / getVendorBidAddendumAcknowledgments ---");

  {
    // No addenda on the package at all -> short-circuits to [] without
    // ever querying bid_addendum_acknowledgments.
    const client = {
      from: (table: string) => {
        if (table === "bid_addenda") return makeChain(() => ({ data: [], error: null }));
        throw new Error(`unexpected table ${table}`);
      },
    };
    const staffResult = await listBidAddendumAcknowledgments(client as any, "bp-1");
    check("staff-side: an addenda-less package returns [] without querying acknowledgments", Array.isArray(staffResult) && staffResult.length === 0);
  }

  {
    const client = {
      from: (table: string) => {
        if (table === "bid_addenda") return makeChain(() => ({ data: [{ id: "addendum-1", bid_package_id: "bp-1", title: "T", body_text: "B", revised_due_at: null, issued_by: "u-1", issued_at: "2026-01-01T00:00:00Z" }], error: null }));
        if (table === "bid_addendum_acknowledgments") {
          return makeChain(() => ({
            data: [{ id: "ack-1", bid_addendum_id: "addendum-1", vendor_id: "v-1", acknowledged_by: "u-2", acknowledged_at: "2026-01-02T00:00:00Z", vendors: { name: "Gamma Roofing" } }],
            error: null,
          }));
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const staffResult = await listBidAddendumAcknowledgments(client as any, "bp-1");
    check("staff-side: resolves the addendum's own acknowledgment rows with vendor name", staffResult.length === 1 && staffResult[0].vendorName === "Gamma Roofing" && staffResult[0].bidAddendumId === "addendum-1");
  }

  {
    const client = {
      from: (table: string) => {
        if (table === "bid_addenda") return makeChain(() => ({ data: [{ id: "addendum-1", title: "T", body_text: "B", revised_due_at: null, issued_at: "2026-01-01T00:00:00Z" }], error: null }));
        if (table === "bid_addendum_acknowledgments") {
          return makeChain(() => ({
            data: [{ id: "ack-1", bid_addendum_id: "addendum-1", vendor_id: "v-1", acknowledged_by: "u-2", acknowledged_at: "2026-01-02T00:00:00Z" }],
            error: null,
          }));
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const vendorResult = await getVendorBidAddendumAcknowledgments(client as any, "bp-1");
    check("vendor-side: RLS-scoped read maps the same shape (relies on RLS, not an explicit vendorId filter)", vendorResult.length === 1 && vendorResult[0].id === "ack-1" && vendorResult[0].acknowledgedAt === "2026-01-02T00:00:00Z");
  }
}

async function main() {
  await testSubmitVendorBid();
  await testGetVendorOwnBidSubmission();
  await testListBidSubmissionRevisions();
  await testAskVendorBidQuestion();
  await testAcknowledgeBidAddendum();
  await testListAndGetAcknowledgments();
  console.log(`\nbidService_phaseC_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
