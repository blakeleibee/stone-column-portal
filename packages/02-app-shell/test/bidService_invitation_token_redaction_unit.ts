/**
 * Unit-level tests for the P5.2 post-external-review fix: a vendor bid
 * invitation's one-time access TOKEN must never be persisted into the
 * correspondence thread (entity_messages.body).
 *
 * FINDING (independent external review). inviteVendor() composed a
 * single string containing the live access link and used it both as the
 * email text AND as the stored thread message. The token is a bearer
 * credential valid for 14 days, so it sat in plaintext in the database
 * and rendered in the vendor's own Messages panel — widening the set of
 * places a working credential could leak from (screenshots, exports,
 * support tooling, a future thread-sharing feature) far beyond the
 * inbox it was addressed to.
 *
 * The emailed copy must still carry a usable link — that is the whole
 * point of the invitation — so the fix separates the two: the email
 * text keeps the real link, the STORED thread copy is redacted.
 *
 * Same "real function, hand-rolled fake Supabase client, no network, no
 * database" pattern as test/bidService_phaseB_unit.ts.
 *
 * Run with `npx tsx test/bidService_invitation_token_redaction_unit.ts`.
 */
import { strict as assert } from "node:assert";
import { inviteVendor } from "../src/services/bidService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

const TOKEN = "deadbeefcafe0123456789abcdef0123456789abcdef0123";
const VENDOR_EMAIL = "contact@example-vendor.test";

/** Captures whatever inviteVendor() ends up inserting into
 *  entity_messages, which is the row a vendor and staff later read. */
function makeSupabase(captured: { messageRow?: any }) {
  const thenable = (value: any) => ({
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(value).then(onFulfilled, onRejected),
  });

  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "staff-profile-id" } } }),
    },
    from(table: string) {
      if (table === "bid_submissions") {
        return { insert: async () => ({ error: null }) } as any;
      }
      if (table === "vendors") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "vendor-id", name: "Example Vendor", email: VENDOR_EMAIL, org_id: "org-id" },
                error: null,
              }),
            }),
          }),
        } as any;
      }
      if (table === "bid_vendor_access_invitations") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { token: TOKEN }, error: null }),
            }),
          }),
        } as any;
      }
      if (table === "bid_packages") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { title: "Roofing Package" }, error: null }),
            }),
          }),
        } as any;
      }
      if (table === "inbound_reply_tokens") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { token: "reply-token", revoked_at: null }, error: null }),
              }),
            }),
          }),
        } as any;
      }
      if (table === "entity_messages") {
        return {
          insert: (row: any) => {
            captured.messageRow = row;
            return {
              select: () => ({
                single: async () => ({ data: { id: "message-id" }, error: null }),
              }),
            };
          },
        } as any;
      }
      return { select: () => thenable({ data: null, error: null }) } as any;
    },
  } as any;
}

async function testInvitationTokenIsNotPersistedInThread() {
  console.log("--- inviteVendor: invitation token redaction ---");

  const captured: { messageRow?: any } = {};
  const supabase = makeSupabase(captured);

  const result = await inviteVendor(supabase, "bid-package-id", "vendor-id", "https://portal.example.test");

  check("inviteVendor still returns the real access token to the calling staff session", result.accessToken === TOKEN);
  check("inviteVendor still resolves the canonical recipient email", result.recipientEmail === VENDOR_EMAIL);
  check("an entity_messages row was recorded for the invitation", !!captured.messageRow);

  const storedBody: string = captured.messageRow?.body ?? "";

  check("the STORED thread body does not contain the one-time access token", !storedBody.includes(TOKEN));
  check("the STORED thread body does not contain a /vendor/invite/ link", !storedBody.includes("/vendor/invite/"));
  check(
    "the STORED thread body still explains that an invitation was sent, so the thread remains a useful record",
    storedBody.toLowerCase().includes("invit")
  );
  check(
    "the STORED thread body says the link was omitted, rather than silently looking like a broken message",
    /omitted|redact|not shown|security/i.test(storedBody)
  );
}

async function main() {
  await testInvitationTokenIsNotPersistedInThread();
  console.log(`\nbidService_invitation_token_redaction_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
