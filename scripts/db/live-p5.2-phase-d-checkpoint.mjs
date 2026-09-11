// Checkpoint for P5.2 Phase D (bid package correspondence, real email
// invitations, inbound-email routing). Proves schema/028 end-to-end
// against the real hosted dev project, using the exact same service
// functions the app's own Server Actions/pages call — matching Phase
// A/B/C's own established checkpoint pattern exactly.
//
// PART 1 (this script): staff/vendor setup, real inviteVendor() email
// attempt (honestly reports 'pending_provider_configuration' since
// RESEND_API_KEY is not configured), staff<->vendor correspondence via
// sendStaffMessage/sendVendorMessage, and the CORE cross-vendor
// isolation proof (two vendors invited to the SAME package, neither can
// read the other's thread) via listEntityMessages.
//
// PART 2: a directly simulated, correctly-Svix-signed POST to the real
// running local dev server's /api/webhooks/resend route (started
// separately with RESEND_WEBHOOK_SECRET set), proving: a valid inbound
// reply routes into the right thread; a redelivered (same svix-id)
// webhook is a no-op, not a duplicate; a spoofed signature is
// quarantined; an unmatched token is quarantined; a sender-mismatch is
// quarantined. This is a SIMULATED request (Resend cannot reach local
// dev) — never claimed as a real end-to-end provider delivery.
//
// Usage: npx tsx scripts/db/live-p5.2-phase-d-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from apps/web/.env.local), and a
// dev server already running at DEV_SERVER_URL (default
// http://127.0.0.1:5173) with RESEND_WEBHOOK_SECRET set to the SAME
// value as WEBHOOK_TEST_SECRET below.

try {
  process.loadEnvFile("apps/web/.env.local");
} catch {
  // fine if it doesn't exist -- env vars may already be exported
}

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.join(__dirname, "..", "..", "apps", "web"));
const { inviteVendor, publishBidPackage } = require("../../packages/02-app-shell/src/services/bidService.ts");
const { sendStaffMessage, sendVendorMessage, listEntityMessages } = require("../../packages/02-app-shell/src/services/correspondenceService.ts");
const { signSvixPayloadForTesting } = require("../../packages/02-app-shell/src/services/email/svixSignature.ts");
const { buildReplyToAddress } = require("../../packages/02-app-shell/src/services/email/constants.ts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEV_SERVER_URL = process.env.DEV_SERVER_URL || "http://127.0.0.1:5173";
const WEBHOOK_TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

if (!url || !anonKey || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must all be set.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const stamp = Date.now();
const results = [];
const createdUserIds = [];
const createdProjectIds = [];
const createdVendorIds = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}

function freshClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const STAFF_EMAIL = "p3-preview-admin@example.com";
const STAFF_PASSWORD = "REDACTED-ROTATED-CREDENTIAL";

const VENDOR_A_EMAIL = `p522-phased-test-vendor-a-${stamp}@example.com`;
const VENDOR_B_EMAIL = `p522-phased-test-vendor-b-${stamp}@example.com`;
const VENDOR_PASSWORD = "P522PhaseD-Test-Password-123!";

async function main() {
  // ---- Setup: staff, one project, one bid package, TWO vendors
  // invited to the SAME package (the "harder" isolation scenario). ----
  const staff = freshClient();
  const { data: staffSignIn, error: staffSignInErr } = await staff.auth.signInWithPassword({ email: STAFF_EMAIL, password: STAFF_PASSWORD });
  record("Staff sign-in (p3-preview-admin)", !staffSignInErr && !!staffSignIn.user, staffSignInErr?.message);
  if (staffSignInErr) throw new Error("Cannot continue without a real staff session.");

  const { data: staffProfile } = await staff.from("profiles").select("org_id").eq("id", staffSignIn.user.id).single();
  const orgId = staffProfile.org_id;

  const { data: project, error: projectErr } = await staff
    .from("projects")
    .insert({ org_id: orgId, name: `P5.2-PHASED-TEST Project ${stamp}`, project_number: `P522PD-${stamp}`, pricing_model: "cost_plus_percentage" })
    .select("id")
    .single();
  record("Real project created", !projectErr && !!project, projectErr?.message);
  createdProjectIds.push(project.id);

  const { error: templateErr } = await staff.rpc("apply_standard_cost_code_template", { p_project_id: project.id });
  record("apply_standard_cost_code_template()", !templateErr, templateErr?.message);
  const { data: costCodes, error: costCodesErr } = await staff.from("cost_codes").select("id").eq("project_id", project.id).limit(1);
  record("At least one cost code exists", !costCodesErr && costCodes?.length > 0, costCodesErr?.message);
  const costCodeId = costCodes[0].id;

  const { data: pkg, error: pkgErr } = await staff
    .from("bid_packages")
    .insert({ project_id: project.id, cost_code_id: costCodeId, title: `P5.2-PHASED-TEST Package ${stamp}`, status: "draft" })
    .select("id")
    .single();
  record("Bid package created", !pkgErr && !!pkg, pkgErr?.message);
  const publish = await publishBidPackage(staff, pkg.id);
  record("Bid package published", !publish.error, publish.error);

  const { data: vendorA, error: vendorAErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASED-TEST Vendor A ${stamp}`, email: VENDOR_A_EMAIL })
    .select("id")
    .single();
  record("Vendor A created", !vendorAErr && !!vendorA, vendorAErr?.message);
  if (vendorA) createdVendorIds.push(vendorA.id);

  const { data: vendorB, error: vendorBErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASED-TEST Vendor B ${stamp}`, email: VENDOR_B_EMAIL })
    .select("id")
    .single();
  record("Vendor B created", !vendorBErr && !!vendorB, vendorBErr?.message);
  if (vendorB) createdVendorIds.push(vendorB.id);

  // ---- Real inviteVendor(): honest not-configured email outcome ----
  const inviteA = await inviteVendor(staff, pkg.id, vendorA.id, DEV_SERVER_URL);
  record(
    "inviteVendor(vendorA) succeeds, resolves the real recipient email, and honestly reports 'pending_provider_configuration'",
    !inviteA.error && inviteA.recipientEmail === VENDOR_A_EMAIL && inviteA.emailStatus === "pending_provider_configuration",
    JSON.stringify(inviteA)
  );

  const inviteB = await inviteVendor(staff, pkg.id, vendorB.id, DEV_SERVER_URL);
  record("inviteVendor(vendorB) — SAME package as vendor A — also succeeds honestly", !inviteB.error && inviteB.emailStatus === "pending_provider_configuration", JSON.stringify(inviteB));

  // A real entity_messages row (the invitation) should exist for each vendor, with the honest status.
  const { data: inviteMsgs } = await admin.from("entity_messages").select("vendor_id, delivery_status").eq("bid_package_id", pkg.id);
  record(
    "Two real entity_messages rows exist (one invitation per vendor), both delivery_status='pending_provider_configuration'",
    inviteMsgs?.length === 2 && inviteMsgs.every((m) => m.delivery_status === "pending_provider_configuration"),
    JSON.stringify(inviteMsgs)
  );

  // ---- Vendor sign-up + accept invitation for both vendors ----
  const vendorAClient = freshClient();
  const { data: vendorASignUp, error: vendorASignUpErr } = await vendorAClient.auth.signUp({ email: VENDOR_A_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor A real Supabase Auth sign-up", !vendorASignUpErr && !!vendorASignUp.user, vendorASignUpErr?.message);
  if (vendorASignUp?.user) createdUserIds.push(vendorASignUp.user.id);
  const { error: acceptAErr } = await vendorAClient.rpc("accept_vendor_bid_invitation", { p_token: inviteA.accessToken, p_full_name: "P5.2-PHASED-TEST Vendor A Contact" });
  record("Vendor A accepts invitation", !acceptAErr, acceptAErr?.message);

  const vendorBClient = freshClient();
  const { data: vendorBSignUp, error: vendorBSignUpErr } = await vendorBClient.auth.signUp({ email: VENDOR_B_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor B real Supabase Auth sign-up", !vendorBSignUpErr && !!vendorBSignUp.user, vendorBSignUpErr?.message);
  if (vendorBSignUp?.user) createdUserIds.push(vendorBSignUp.user.id);
  const { error: acceptBErr } = await vendorBClient.rpc("accept_vendor_bid_invitation", { p_token: inviteB.accessToken, p_full_name: "P5.2-PHASED-TEST Vendor B Contact" });
  record("Vendor B accepts invitation", !acceptBErr, acceptBErr?.message);

  // ---- Staff composes a message to vendor A only ----
  const staffMsgToA = await sendStaffMessage(staff, { bidPackageId: pkg.id, vendorId: vendorA.id, subject: "Question about your bid", body: "Can you clarify the lead time?", staffProfileId: staffSignIn.user.id });
  record("sendStaffMessage(vendor A) succeeds, honest pending_provider_configuration status", !staffMsgToA.error && staffMsgToA.emailStatus === "pending_provider_configuration", JSON.stringify(staffMsgToA));

  // ---- Vendor A replies via the portal ----
  const vendorAReply = await sendVendorMessage(vendorAClient, { bidPackageId: pkg.id, vendorId: vendorA.id, body: "Two weeks from award." });
  record("Vendor A can send a portal reply on its own thread", !vendorAReply.error, vendorAReply.error);

  // ---- THE CORE ISOLATION PROOF ----
  const vendorAThread = await listEntityMessages(vendorAClient, pkg.id, vendorA.id);
  record("Vendor A sees its own thread (invitation + staff question + its own reply)", vendorAThread.length >= 3, `length=${vendorAThread.length}`);

  const vendorBSeesOwnThread = await listEntityMessages(vendorBClient, pkg.id, vendorB.id);
  record("Vendor B sees its own thread (just its invitation)", vendorBSeesOwnThread.length === 1, `length=${vendorBSeesOwnThread.length}`);

  const vendorBTriesToReadVendorAsThread = await listEntityMessages(vendorBClient, pkg.id, vendorA.id);
  record(
    "CORE FIX: Vendor B, invited to the SAME package as Vendor A, gets ZERO rows when querying Vendor A's thread",
    vendorBTriesToReadVendorAsThread.length === 0,
    `length=${vendorBTriesToReadVendorAsThread.length}`
  );

  const staffSeesFullVendorAThread = await listEntityMessages(staff, pkg.id, vendorA.id);
  record("Staff sees vendor A's full thread", staffSeesFullVendorAThread.length >= 3, `length=${staffSeesFullVendorAThread.length}`);

  // =====================================================================
  // PART 2 — simulated Svix-signed inbound webhook POSTs against the
  // real running dev server.
  // =====================================================================
  console.log("\n--- Part 2: simulated inbound webhook POSTs ---");

  const { data: tokenRow, error: tokenErr } = await admin.from("inbound_reply_tokens").select("token").eq("bid_package_id", pkg.id).eq("vendor_id", vendorA.id).maybeSingle();
  record("A real inbound_reply_token exists for (package, vendor A) after sendStaffMessage", !tokenErr && !!tokenRow?.token, tokenErr?.message);
  const replyAddress = buildReplyToAddress(tokenRow.token);

  async function postWebhook(body, headersOverride) {
    const svixId = headersOverride?.svixId ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const svixTimestamp = headersOverride?.svixTimestamp ?? String(Math.floor(Date.now() / 1000));
    const bodyStr = JSON.stringify(body);
    const svixSignature = headersOverride?.svixSignature ?? signSvixPayloadForTesting(svixId, svixTimestamp, bodyStr, WEBHOOK_TEST_SECRET);
    const response = await fetch(`${DEV_SERVER_URL}/api/webhooks/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": svixSignature },
      body: bodyStr,
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json, svixId };
  }

  // Case 1: a genuinely valid inbound reply.
  const validEvent = { type: "email.received", data: { from: VENDOR_A_EMAIL, to: [replyAddress], subject: "Re: Question about your bid", text: "Confirmed, two weeks." } };
  const validResult = await postWebhook(validEvent);
  record("Valid signed inbound webhook returns 200 status=routed", validResult.status === 200 && validResult.json.status === "routed", JSON.stringify(validResult));

  const { data: routedMsg } = await admin.from("entity_messages").select("id, body, direction").eq("provider_message_id", validResult.svixId).maybeSingle();
  record("The routed message is a real entity_messages row with direction='inbound' and the right body", routedMsg?.direction === "inbound" && routedMsg?.body === "Confirmed, two weeks.", JSON.stringify(routedMsg));

  // Case 2: redelivery of the SAME svix-id — must be a no-op, not a duplicate row.
  const duplicateResult = await postWebhook(validEvent, { svixId: validResult.svixId });
  record("Redelivering the SAME svix-id returns 200 status=duplicate", duplicateResult.status === 200 && duplicateResult.json.status === "duplicate", JSON.stringify(duplicateResult));
  const { data: countAfterDuplicate } = await admin.from("entity_messages").select("id").eq("provider_message_id", validResult.svixId);
  record("No duplicate row was created — still exactly one entity_messages row for this provider_message_id", countAfterDuplicate?.length === 1, `count=${countAfterDuplicate?.length}`);

  // Case 3: spoofed signature.
  const spoofedResult = await postWebhook(validEvent, { svixSignature: "v1,not-a-real-signature-at-all==" });
  record("Spoofed signature returns 200 status=quarantined reason=signature_invalid", spoofedResult.status === 200 && spoofedResult.json.reason === "signature_invalid", JSON.stringify(spoofedResult));

  // Case 4: unmatched token — a real hex-shaped token (matches the
  // reply-address regex, so it IS routed to token resolution) that
  // simply doesn't exist in inbound_reply_tokens.
  const unmatchedEvent = {
    type: "email.received",
    data: { from: VENDOR_A_EMAIL, to: ["reply+aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@notify.stonecolumn.com"], subject: "x", text: "y" },
  };
  const unmatchedResult = await postWebhook(unmatchedEvent);
  record("Unmatched token returns 200 status=quarantined reason=unmatched_token", unmatchedResult.status === 200 && unmatchedResult.json.reason === "unmatched_token", JSON.stringify(unmatchedResult));

  // Case 5: sender mismatch (right token, wrong FROM address).
  const spoofedSenderEvent = { type: "email.received", data: { from: "attacker@example.com", to: [replyAddress], subject: "x", text: "y" } };
  const senderMismatchResult = await postWebhook(spoofedSenderEvent);
  record("Sender mismatch returns 200 status=quarantined reason=sender_mismatch", senderMismatchResult.status === 200 && senderMismatchResult.json.reason === "sender_mismatch", JSON.stringify(senderMismatchResult));

  const { data: quarantineRows } = await admin.from("quarantined_inbound_messages").select("reason").eq("bid_package_id", pkg.id);
  record(
    "Quarantine rows exist for unmatched_token/revoked_vendor/sender_mismatch cases actually attributable to this package (sender_mismatch here)",
    (quarantineRows ?? []).some((r) => r.reason === "sender_mismatch"),
    JSON.stringify(quarantineRows)
  );

  // Case 6: revoked vendor.
  await admin.from("vendor_members").update({ revoked_at: new Date().toISOString() }).eq("vendor_id", vendorA.id);
  const revokedEvent = { type: "email.received", data: { from: VENDOR_A_EMAIL, to: [replyAddress], subject: "x", text: "y" } };
  const revokedResult = await postWebhook(revokedEvent);
  record("A revoked vendor's reply token no longer resolves — returns 200 status=quarantined reason=revoked_vendor", revokedResult.status === 200 && revokedResult.json.reason === "revoked_vendor", JSON.stringify(revokedResult));
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable P5.2 Phase D checkpoint data) ---");
  for (const projectId of createdProjectIds) {
    const { error } = await admin.from("projects").delete().eq("id", projectId);
    if (error) console.warn(`  project ${projectId} could not be deleted (${error.message}) — left in place, clearly named P5.2-PHASED-TEST.`);
  }
  for (const vendorId of createdVendorIds) {
    const { error } = await admin.from("vendors").delete().eq("id", vendorId);
    if (error) console.warn(`  vendor ${vendorId} could not be deleted (${error.message}) — left in place, clearly named P5.2-PHASED-TEST.`);
  }
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`  cleanup warning: could not delete user ${id}: ${error.message}`);
  }
  console.log("cleanup done (see warnings above for any residue left by design, not by failure).");
}

main()
  .catch((err) => {
    console.error("\nCheckpoint script stopped early:", err.message);
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) {
      console.log("Failed checks:", failed.map((f) => f.name).join("; "));
      process.exit(1);
    }
  });
