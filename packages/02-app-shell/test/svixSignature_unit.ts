/**
 * P5.2 Phase D — Svix webhook signature verification tests. Computes
 * REAL, correctly-signed payloads itself (this test controls the
 * secret, exactly like a real Resend/Svix project would control its
 * own webhook signing secret) to prove both the accept and reject paths
 * genuinely work — not merely "compiles" — per the owner's explicit
 * instruction to implement this for real even without a live provider.
 * Run with `npx tsx test/svixSignature_unit.ts`.
 */
import { strict as assert } from "node:assert";
import { verifySvixSignature, signSvixPayloadForTesting } from "../src/services/email/svixSignature";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"; // a fake-but-real-shaped test secret, never used for anything real.

function main() {
  console.log("--- verifySvixSignature: valid payload ---");
  {
    const svixId = "msg_test_1";
    const nowSeconds = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(nowSeconds);
    const body = JSON.stringify({ type: "email.received", data: { from: "vendor@example.com" } });
    const svixSignature = signSvixPayloadForTesting(svixId, svixTimestamp, body, SECRET);

    const result = verifySvixSignature({ svixId, svixTimestamp, svixSignature }, body, SECRET);
    check("a genuinely correctly-signed payload is accepted", result.valid === true);
  }

  console.log("--- verifySvixSignature: invalid/tampered payload ---");
  {
    const svixId = "msg_test_2";
    const nowSeconds = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(nowSeconds);
    const originalBody = JSON.stringify({ type: "email.received", data: { from: "vendor@example.com" } });
    const svixSignature = signSvixPayloadForTesting(svixId, svixTimestamp, originalBody, SECRET);

    // The signature was computed over `originalBody` — verifying against
    // a DIFFERENT body (simulating a tampered-in-transit payload) must
    // fail even though the signature header itself is well-formed.
    const tamperedBody = JSON.stringify({ type: "email.received", data: { from: "attacker@example.com" } });
    const result = verifySvixSignature({ svixId, svixTimestamp, svixSignature }, tamperedBody, SECRET);
    check("a tampered body is rejected even with a well-formed signature header", result.valid === false);
  }

  console.log("--- verifySvixSignature: wrong secret ---");
  {
    const svixId = "msg_test_3";
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "email.received" });
    const svixSignature = signSvixPayloadForTesting(svixId, svixTimestamp, body, SECRET);

    const result = verifySvixSignature({ svixId, svixTimestamp, svixSignature }, body, "whsec_aDifferentSecretEntirelyXX==");
    check("a signature computed with the wrong secret is rejected", result.valid === false);
  }

  console.log("--- verifySvixSignature: expired timestamp ---");
  {
    const svixId = "msg_test_4";
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 60); // one hour old
    const body = JSON.stringify({ type: "email.received" });
    const svixSignature = signSvixPayloadForTesting(svixId, staleTimestamp, body, SECRET);

    const result = verifySvixSignature({ svixId, svixTimestamp: staleTimestamp, svixSignature }, body, SECRET);
    check("a correctly-signed but stale (>5 minute) timestamp is rejected", result.valid === false);
    check("the rejection reason names the tolerance window", !!result.reason && /tolerance/i.test(result.reason));
  }

  console.log("--- verifySvixSignature: missing headers ---");
  {
    const result = verifySvixSignature({ svixId: null, svixTimestamp: null, svixSignature: null }, "{}", SECRET);
    check("missing headers are rejected outright, never treated as valid by default", result.valid === false);
  }

  console.log(`\n${checks} checks passed.`);
}

main();
