/**
 * P5.2 Phase D — unit tests for correspondenceService.ts's branching
 * logic: reply-token resolution (valid/revoked/reused/malformed),
 * sender verification, and inbound-message idempotency. Same "real
 * function, hand-rolled fake Supabase client, no network, no database"
 * pattern as bidService_phaseB_unit.ts. Run with
 * `npx tsx test/correspondenceService_unit.ts`.
 */
import { strict as assert } from "node:assert";
import {
  ensureInboundReplyToken,
  resolveInboundReplyToken,
  verifySenderMatchesVendor,
  insertInboundMessage,
  sendStaffMessage,
} from "../src/services/correspondenceService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function makeClient(overrides: Record<string, any>) {
  return {
    from(table: string) {
      if (overrides[table]) return overrides[table];
      throw new Error(`Unexpected table access in test fake: ${table}`);
    },
    auth: { getUser: async () => ({ data: { user: { id: "staff-1", email: "staff@stonecolumn.com" } } }) },
  } as any;
}

// A minimal chainable query-builder fake supporting the handful of
// methods each function under test actually calls, matching
// bidService_phaseB_unit.ts's own makeChain shape.
function chain(result: { data: any; error: any }) {
  const step: any = {
    select: () => step,
    eq: () => step,
    is: () => step,
    limit: () => step,
    order: () => step,
    maybeSingle: async () => result,
    single: async () => result,
    insert: () => step,
    update: () => step,
    then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
  };
  return step;
}

async function testEnsureInboundReplyToken() {
  console.log("--- ensureInboundReplyToken ---");

  {
    const client = makeClient({ inbound_reply_tokens: chain({ data: { token: "existing-token-abc", revoked_at: null }, error: null }) });
    const result = await ensureInboundReplyToken(client, "bp-1", "v-1");
    check("reuses an existing, active token", "token" in result && result.token === "existing-token-abc");
  }

  {
    let insertCalled = false;
    const step: any = {
      select: () => step,
      eq: () => step,
      maybeSingle: async () => ({ data: null, error: null }),
      insert: (payload: any) => {
        insertCalled = true;
        check("creates with the exact bid_package_id/vendor_id pair, no extra fields", Object.keys(payload).length === 2);
        return step;
      },
      single: async () => ({ data: { token: "brand-new-token-xyz" }, error: null }),
    };
    const client = makeClient({ inbound_reply_tokens: step });
    const result = await ensureInboundReplyToken(client, "bp-1", "v-1");
    check("creates a new token when none exists yet", insertCalled && "token" in result && result.token === "brand-new-token-xyz");
  }

  {
    const client = makeClient({ inbound_reply_tokens: chain({ data: { token: "leaked-token", revoked_at: "2026-01-01T00:00:00Z" }, error: null }) });
    const result = await ensureInboundReplyToken(client, "bp-1", "v-1");
    check("a revoked token is reported as an error, never silently reactivated", "error" in result);
  }
}

async function testResolveInboundReplyToken() {
  console.log("--- resolveInboundReplyToken ---");

  {
    const client = makeClient({ inbound_reply_tokens: chain({ data: null, error: null }) });
    const result = await resolveInboundReplyToken(client, "not-a-real-token");
    check("an unmatched token resolves to 'unmatched_token'", result.kind === "unmatched_token");
  }

  {
    const client = makeClient({
      inbound_reply_tokens: chain({ data: { bid_package_id: "bp-1", vendor_id: "v-1", revoked_at: "2026-01-01T00:00:00Z" }, error: null }),
    });
    const result = await resolveInboundReplyToken(client, "revoked-token");
    check("a revoked token row resolves to 'unmatched_token' (never treated as valid)", result.kind === "unmatched_token");
  }

  {
    const client = makeClient({
      inbound_reply_tokens: chain({ data: { bid_package_id: "bp-1", vendor_id: "v-1", revoked_at: null }, error: null }),
      vendor_members: chain({ data: null, error: null }), // no active member found
    });
    const result = await resolveInboundReplyToken(client, "gamma-token");
    check(
      "a valid token whose vendor has since lost all active membership resolves to 'revoked_vendor', not 'resolved'",
      result.kind === "revoked_vendor" && (result as any).bidPackageId === "bp-1"
    );
  }

  {
    const client = makeClient({
      inbound_reply_tokens: chain({ data: { bid_package_id: "bp-1", vendor_id: "v-1", revoked_at: null }, error: null }),
      vendor_members: chain({ data: { id: "vm-1" }, error: null }),
    });
    const result = await resolveInboundReplyToken(client, "gamma-token");
    check("a valid token with an active vendor member resolves fully", result.kind === "resolved" && (result as any).vendorId === "v-1");
  }
}

async function testVerifySenderMatchesVendor() {
  console.log("--- verifySenderMatchesVendor ---");

  {
    const client = makeClient({ vendors: chain({ data: { email: "Bids@GammaRoofing.example" }, error: null }) });
    const matches = await verifySenderMatchesVendor(client, "v-1", "bids@gammaroofing.example");
    check("matches the vendor's own canonical email, case-insensitively", matches === true);
  }

  {
    const client = makeClient({
      vendors: chain({ data: { email: "bids@gammaroofing.example" }, error: null }),
      vendor_members: chain({ data: [{ profiles: { email: "colleague@gammaroofing.example" } }], error: null }),
    });
    const matches = await verifySenderMatchesVendor(client, "v-1", "colleague@gammaroofing.example");
    check("matches an active colleague's own registered email, not just the canonical one", matches === true);
  }

  {
    const client = makeClient({
      vendors: chain({ data: { email: "bids@gammaroofing.example" }, error: null }),
      vendor_members: chain({ data: [{ profiles: { email: "colleague@gammaroofing.example" } }], error: null }),
    });
    const matches = await verifySenderMatchesVendor(client, "v-1", "attacker@example.com");
    check("an address matching neither the vendor nor any active member is rejected", matches === false);
  }
}

async function testInsertInboundMessageIdempotency() {
  console.log("--- insertInboundMessage idempotency ---");

  {
    const step: any = {
      insert: () => step,
      select: () => step,
      single: async () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }),
    };
    const client = makeClient({ entity_messages: step });
    const result = await insertInboundMessage(client, {
      bidPackageId: "bp-1",
      vendorId: "v-1",
      sender: "a@b.com",
      recipient: "c@d.com",
      subject: null,
      body: "hi",
      providerMessageId: "resend-msg-1",
    });
    check("a unique-constraint violation on provider_message_id is reported as a genuine duplicate, not a generic error", "duplicate" in result && result.duplicate === true);
  }

  {
    const step: any = {
      insert: () => step,
      select: () => step,
      single: async () => ({ data: { id: "em-new-1" }, error: null }),
    };
    const client = makeClient({ entity_messages: step });
    const result = await insertInboundMessage(client, {
      bidPackageId: "bp-1",
      vendorId: "v-1",
      sender: "a@b.com",
      recipient: "c@d.com",
      subject: "Re: bid",
      body: "hi",
      providerMessageId: "resend-msg-2",
    });
    check("a genuinely new message inserts successfully", "id" in result && (result as any).id === "em-new-1");
  }
}

async function testSendStaffMessageHonestFailures() {
  console.log("--- sendStaffMessage: honest failure when no email on file ---");
  const client = makeClient({ vendors: chain({ data: { email: null }, error: null }) });
  const result = await sendStaffMessage(client, { bidPackageId: "bp-1", vendorId: "v-1", body: "Hello", staffProfileId: "staff-1" });
  check("refuses to send (and records nothing) when the vendor has no on-file email", !!result.error);
}

async function main() {
  await testEnsureInboundReplyToken();
  await testResolveInboundReplyToken();
  await testVerifySenderMatchesVendor();
  await testInsertInboundMessageIdempotency();
  await testSendStaffMessageHonestFailures();
  console.log(`\n${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
