/**
 * P5.2 Phase D — EmailService selection-logic and honesty tests.
 * Same "real function, no network, no database" pattern as
 * bidService_phaseB_unit.ts. Run with `npx tsx test/emailService_unit.ts`.
 */
import { strict as assert } from "node:assert";
import { getEmailService } from "../src/services/email/getEmailService";
import { NullEmailService } from "../src/services/email/NullEmailService";
import { ResendEmailService } from "../src/services/email/ResendEmailService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

async function testFactorySelection() {
  console.log("--- getEmailService() selection logic ---");
  const original = process.env.RESEND_API_KEY;
  try {
    delete process.env.RESEND_API_KEY;
    check("absent RESEND_API_KEY selects NullEmailService", getEmailService() instanceof NullEmailService);

    process.env.RESEND_API_KEY = "re_test_key_123";
    check("present RESEND_API_KEY selects ResendEmailService", getEmailService() instanceof ResendEmailService);

    process.env.RESEND_API_KEY = "";
    check("an empty-string RESEND_API_KEY is treated as absent (falsy)", getEmailService() instanceof NullEmailService);
  } finally {
    if (original === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original;
  }
}

async function testNullEmailServiceHonesty() {
  console.log("--- NullEmailService ---");
  const service = new NullEmailService();
  const result = await service.send({ to: "vendor@example.com", from: "notify@notify.stonecolumn.com", subject: "Hi", text: "Body" });
  check("status is exactly 'pending_provider_configuration', never 'sent'/'delivered'", result.status === "pending_provider_configuration");
  check("providerMessageId is null (nothing was actually sent)", result.providerMessageId === null);
}

async function testResendEmailServiceRequestShape() {
  console.log("--- ResendEmailService request/response mapping ---");
  const originalFetch = global.fetch;
  try {
    let capturedUrl: string | undefined;
    let capturedInit: any;
    global.fetch = (async (url: string, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "re_abc123" }),
      } as any;
    }) as any;

    const service = new ResendEmailService("re_fake_key");
    const result = await service.send({
      to: "vendor@example.com",
      from: "notify@notify.stonecolumn.com",
      subject: "You're invited to bid",
      text: "Please review the attached scope.",
      replyTo: "reply+abc123@notify.stonecolumn.com",
    });

    check("posts to the Resend API endpoint", capturedUrl === "https://api.resend.com/emails");
    check("sends the API key as a Bearer token", capturedInit.headers.Authorization === "Bearer re_fake_key");
    const body = JSON.parse(capturedInit.body);
    check("wraps `to` in an array", Array.isArray(body.to) && body.to[0] === "vendor@example.com");
    check("passes reply_to through as snake_case", body.reply_to === "reply+abc123@notify.stonecolumn.com");
    check("a successful response maps to status 'sent' with the real provider id", result.status === "sent" && result.providerMessageId === "re_abc123");
  } finally {
    global.fetch = originalFetch;
  }
}

async function testResendEmailServiceFailureHandling() {
  console.log("--- ResendEmailService failure handling ---");
  const originalFetch = global.fetch;
  try {
    global.fetch = (async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: "Invalid `from` field." }),
    })) as any;

    const service = new ResendEmailService("re_fake_key");
    const result = await service.send({ to: "vendor@example.com", from: "bad", subject: "x", text: "y" });
    check("a non-ok HTTP response maps to status 'failed', never 'sent'", result.status === "failed");
    check("surfaces the provider's own error message", result.error === "Invalid `from` field.");
    check("providerMessageId is null on failure", result.providerMessageId === null);

    global.fetch = (async () => {
      throw new Error("network unreachable");
    }) as any;
    const networkFailure = await service.send({ to: "vendor@example.com", from: "notify@notify.stonecolumn.com", subject: "x", text: "y" });
    check("a thrown network error is caught and mapped to status 'failed', never an unhandled rejection", networkFailure.status === "failed");
    check("surfaces the network error message", networkFailure.error === "network unreachable");
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  await testFactorySelection();
  await testNullEmailServiceHonesty();
  await testResendEmailServiceRequestShape();
  await testResendEmailServiceFailureHandling();
  console.log(`\n${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
