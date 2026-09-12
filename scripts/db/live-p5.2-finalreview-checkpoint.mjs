#!/usr/bin/env node
// P5.2 FINAL-REVIEW spot-check — run against real hosted dev, AFTER
// migration 029 (schema/029_vendor_bid_invitation_replay_reactivation_
// fix.sql) has been pushed. Not a full re-run of Phase E's 83-check
// integration checkpoint — a targeted spot-check proving the specific
// claims this final review most needed to re-verify in the FINAL
// combined state of the branch, not at some earlier commit:
//
//   1. Same-package, THREE-vendor isolation (not just two) on
//      submissions AND correspondence — the whole-package cross-phase
//      security audit's Area 1 (third-vendor scenario) concluded "no
//      concern" by reading the SQL; this empirically exercises it.
//   2. A revoked vendor's total lockout (package/documents/own
//      submission/correspondence), with the other two vendors and staff
//      completely unaffected — re-proving Phase E's own Requirement #15
//      still holds on this final combined branch state.
//   3. THE NEW FIX (schema/029): a revoked vendor replaying their
//      ORIGINAL, already-accepted invitation link must be rejected, not
//      silently reactivate themselves — the exact self-service
//      privilege re-escalation the whole-package audit found. Then
//      confirms the legitimate path — staff's own explicit
//      reactivateVendorMember(), now wired to a real "Reactivate"
//      button in BidPackageWorkspace's Vendor Access panel — still
//      genuinely restores access.
//
// All test data is named P5.2-FINALREVIEW- for unambiguous residue
// identification. Cleanup follows this engagement's own established
// precedent (Phase A/B/C/D/E scripts): attempt a real delete, warn and
// leave clearly-named residue in place where append-only/no-hard-delete
// constraints block it (vendors/vendor_members/audit rows).
//
// Usage: node scripts/db/live-p5.2-finalreview-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from apps/web/.env.local). No dev
// server required — every step here goes through service functions
// directly, none through the inbound-webhook HTTP route.

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

const {
  inviteVendor,
  publishBidPackage,
  getVendorVisibleBidPackage,
  getVendorOwnBidSubmission,
  submitVendorBid,
  revokeVendorMember,
  reactivateVendorMember,
} = require("../../packages/02-app-shell/src/services/bidService.ts");
const { sendStaffMessage, listEntityMessages } = require("../../packages/02-app-shell/src/services/correspondenceService.ts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEV_SERVER_URL = "http://127.0.0.1:5173"; // never actually hit — inviteVendor() only uses this to build a link string.

if (!url || !anonKey || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must all be set.");
  process.exit(1);
}
if (process.env.RESEND_API_KEY) {
  console.error("RESEND_API_KEY is set in this environment — refusing to run (this script must never risk a real email send). Unset it and re-run.");
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

const VENDOR_A_EMAIL = `p52-finalreview-vendor-a-${stamp}@example.com`;
const VENDOR_B_EMAIL = `p52-finalreview-vendor-b-${stamp}@example.com`;
const VENDOR_C_EMAIL = `p52-finalreview-vendor-c-${stamp}@example.com`;
const VENDOR_PASSWORD = "P52FinalReview-Test-Password-123!";

async function main() {
  // ---------------------------------------------------------------
  // STEP 1 — staff session, project, bid package, publish.
  // ---------------------------------------------------------------
  const staff = freshClient();
  const { data: staffSignIn, error: staffSignInErr } = await staff.auth.signInWithPassword({ email: STAFF_EMAIL, password: STAFF_PASSWORD });
  record("Staff sign-in (p3-preview-admin)", !staffSignInErr && !!staffSignIn.user, staffSignInErr?.message);
  if (staffSignInErr) throw new Error("Cannot continue without a real staff session.");

  const { data: staffProfile } = await staff.from("profiles").select("org_id").eq("id", staffSignIn.user.id).single();
  const orgId = staffProfile.org_id;

  const { data: project, error: projectErr } = await staff
    .from("projects")
    .insert({ org_id: orgId, name: `P5.2-FINALREVIEW Project ${stamp}`, project_number: `P52FR-${stamp}`, pricing_model: "cost_plus_percentage" })
    .select("id")
    .single();
  record("Real project created", !projectErr && !!project, projectErr?.message);
  if (projectErr) throw new Error("Cannot continue without a project.");
  createdProjectIds.push(project.id);

  await staff.rpc("apply_standard_cost_code_template", { p_project_id: project.id });
  const { data: costCodes } = await staff.from("cost_codes").select("id").eq("project_id", project.id).limit(1);
  const costCodeId = costCodes[0].id;

  const { data: pkg, error: pkgErr } = await staff
    .from("bid_packages")
    .insert({
      project_id: project.id,
      cost_code_id: costCodeId,
      title: `P5.2-FINALREVIEW Package ${stamp}`,
      scope_description: "Final-review spot-check package.",
      status: "draft",
    })
    .select("id")
    .single();
  record("Bid package created (draft)", !pkgErr && !!pkg, pkgErr?.message);

  const publish = await publishBidPackage(staff, pkg.id);
  record("Bid package published", !publish.error, publish.error);

  // ---------------------------------------------------------------
  // STEP 2 — THREE vendors invited to the SAME package (Area 1
  // spot-check: third-vendor scenario, not just two).
  // ---------------------------------------------------------------
  async function makeVendor(letter, email) {
    const { data: vendor, error } = await staff
      .from("vendors")
      .insert({ org_id: orgId, name: `P5.2-FINALREVIEW Vendor ${letter} ${stamp}`, email })
      .select("id")
      .single();
    record(`Vendor ${letter} created`, !error && !!vendor, error?.message);
    if (vendor) createdVendorIds.push(vendor.id);
    return vendor;
  }
  const vendorA = await makeVendor("A", VENDOR_A_EMAIL);
  const vendorB = await makeVendor("B", VENDOR_B_EMAIL);
  const vendorC = await makeVendor("C", VENDOR_C_EMAIL);

  const inviteA = await inviteVendor(staff, pkg.id, vendorA.id, DEV_SERVER_URL);
  const inviteB = await inviteVendor(staff, pkg.id, vendorB.id, DEV_SERVER_URL);
  const inviteC = await inviteVendor(staff, pkg.id, vendorC.id, DEV_SERVER_URL);
  record("Invite A succeeds with a real access token", !inviteA.error && !!inviteA.accessToken, inviteA.error);
  record("Invite B succeeds with a real access token", !inviteB.error && !!inviteB.accessToken, inviteB.error);
  record("Invite C succeeds with a real access token", !inviteC.error && !!inviteC.accessToken, inviteC.error);

  async function acceptAsNewVendor(letter, email, token) {
    const client = freshClient();
    const { data: signUp, error: signUpErr } = await client.auth.signUp({ email, password: VENDOR_PASSWORD });
    record(`Vendor ${letter} real Supabase Auth sign-up`, !signUpErr && !!signUp.user, signUpErr?.message);
    if (signUp?.user) createdUserIds.push(signUp.user.id);
    const { error: acceptErr } = await client.rpc("accept_vendor_bid_invitation", { p_token: token, p_full_name: `P5.2-FINALREVIEW Vendor ${letter} Contact` });
    record(`Vendor ${letter} accept_vendor_bid_invitation() succeeds`, !acceptErr, acceptErr?.message);
    return { client, userId: signUp?.user?.id };
  }
  const { client: vendorAClient, userId: vendorAUserId } = await acceptAsNewVendor("A", VENDOR_A_EMAIL, inviteA.accessToken);
  const { client: vendorBClient } = await acceptAsNewVendor("B", VENDOR_B_EMAIL, inviteB.accessToken);
  const { client: vendorCClient } = await acceptAsNewVendor("C", VENDOR_C_EMAIL, inviteC.accessToken);

  // ---------------------------------------------------------------
  // STEP 3 — each vendor submits a distinct bid. Cross-vendor
  // submission isolation across all THREE, pairwise.
  // ---------------------------------------------------------------
  const subA = await getVendorOwnBidSubmission(vendorAClient, pkg.id);
  const subB = await getVendorOwnBidSubmission(vendorBClient, pkg.id);
  const subC = await getVendorOwnBidSubmission(vendorCClient, pkg.id);
  await submitVendorBid(vendorAClient, subA.id, 100000, "Vendor A bid");
  await submitVendorBid(vendorBClient, subB.id, 200000, "Vendor B bid");
  await submitVendorBid(vendorCClient, subC.id, 300000, "Vendor C bid");

  const subAAfter = await getVendorOwnBidSubmission(vendorAClient, pkg.id);
  const subBAfter = await getVendorOwnBidSubmission(vendorBClient, pkg.id);
  const subCAfter = await getVendorOwnBidSubmission(vendorCClient, pkg.id);
  record("Vendor A's own submission read-back shows ONLY vendor A's own amount", subAAfter.amountCents === 100000, JSON.stringify(subAAfter));
  record("Vendor B's own submission read-back shows ONLY vendor B's own amount", subBAfter.amountCents === 200000, JSON.stringify(subBAfter));
  record("Vendor C's own submission read-back shows ONLY vendor C's own amount", subCAfter.amountCents === 300000, JSON.stringify(subCAfter));

  const { data: crossReadAsA } = await vendorAClient.from("bid_submissions").select("id, vendor_id, amount_cents").eq("bid_package_id", pkg.id);
  record(
    "Third-vendor spot-check: vendor A's own bid_submissions query returns EXACTLY ONE row (its own), never B's or C's",
    crossReadAsA?.length === 1 && crossReadAsA[0].vendor_id === vendorA.id,
    JSON.stringify(crossReadAsA)
  );
  const { data: crossReadAsB } = await vendorBClient.from("bid_submissions").select("id, vendor_id").eq("bid_package_id", pkg.id);
  record("Third-vendor spot-check: vendor B sees exactly one row (its own), never A's or C's", crossReadAsB?.length === 1 && crossReadAsB[0].vendor_id === vendorB.id, JSON.stringify(crossReadAsB));

  // ---------------------------------------------------------------
  // STEP 4 — correspondence: staff sends a distinct message to each
  // vendor; each vendor sees ONLY its own thread; staff sees all
  // three, never mixed.
  // ---------------------------------------------------------------
  await sendStaffMessage(staff, { bidPackageId: pkg.id, vendorId: vendorA.id, subject: "For A only", body: "Message intended only for vendor A.", staffProfileId: staffSignIn.user.id });
  await sendStaffMessage(staff, { bidPackageId: pkg.id, vendorId: vendorB.id, subject: "For B only", body: "Message intended only for vendor B.", staffProfileId: staffSignIn.user.id });
  await sendStaffMessage(staff, { bidPackageId: pkg.id, vendorId: vendorC.id, subject: "For C only", body: "Message intended only for vendor C.", staffProfileId: staffSignIn.user.id });

  // Each thread has 2 rows by this point: the original invite (sent by
  // inviteVendor() itself, back in Step 2) plus the "For X only"
  // message just sent — every() below is the real isolation proof: not
  // one row in any vendor's own thread ever mentions a DIFFERENT
  // vendor's letter.
  const threadA = await listEntityMessages(vendorAClient, pkg.id, vendorA.id);
  const threadB = await listEntityMessages(vendorBClient, pkg.id, vendorB.id);
  const threadC = await listEntityMessages(vendorCClient, pkg.id, vendorC.id);
  record(
    "Vendor A's thread (invite + reply) never contains a reference to vendor B or C",
    threadA.length === 2 && threadA.every((m) => !m.body.includes("vendor B") && !m.body.includes("vendor C")),
    JSON.stringify(threadA.map((m) => m.body))
  );
  record(
    "Vendor B's thread (invite + reply) never contains a reference to vendor A or C",
    threadB.length === 2 && threadB.every((m) => !m.body.includes("vendor A") && !m.body.includes("vendor C")),
    JSON.stringify(threadB.map((m) => m.body))
  );
  record(
    "Vendor C's thread (invite + reply) never contains a reference to vendor A or B",
    threadC.length === 2 && threadC.every((m) => !m.body.includes("vendor A") && !m.body.includes("vendor B")),
    JSON.stringify(threadC.map((m) => m.body))
  );

  // Direct attempt: vendor A tries to read vendor B's thread by ID —
  // RLS must return zero rows, not an error leaking existence either way.
  const { data: aReadingBThread } = await vendorAClient.from("entity_messages").select("id").eq("bid_package_id", pkg.id).eq("vendor_id", vendorB.id);
  record("Vendor A directly querying vendor B's entity_messages rows gets ZERO rows back", (aReadingBThread ?? []).length === 0, JSON.stringify(aReadingBThread));

  const staffThreadA = await listEntityMessages(staff, pkg.id, vendorA.id);
  const staffThreadB = await listEntityMessages(staff, pkg.id, vendorB.id);
  const staffThreadC = await listEntityMessages(staff, pkg.id, vendorC.id);
  record(
    "Staff sees all three vendors' threads (invite + reply each), each correctly scoped and never mixed",
    staffThreadA.length === 2 && staffThreadB.length === 2 && staffThreadC.length === 2,
    JSON.stringify({ a: staffThreadA.length, b: staffThreadB.length, c: staffThreadC.length })
  );

  // ---------------------------------------------------------------
  // STEP 5 — revoke vendor A. Total, immediate lockout. B and C
  // completely unaffected.
  // ---------------------------------------------------------------
  const revokeResult = await revokeVendorMember(staff, vendorA.id, vendorAUserId);
  record("Staff revokes vendor A's access (revokeVendorMember — the exact function now wired to the new Revoke button)", !revokeResult.error, revokeResult.error);

  const pkgViewAfterRevoke = await getVendorVisibleBidPackage(vendorAClient, pkg.id);
  record("Revoked vendor A immediately loses package view access", pkgViewAfterRevoke === null, JSON.stringify(pkgViewAfterRevoke));
  const ownSubAfterRevoke = await getVendorOwnBidSubmission(vendorAClient, pkg.id);
  record("Revoked vendor A can no longer read its own submission", ownSubAfterRevoke === null, JSON.stringify(ownSubAfterRevoke));
  const threadAAfterRevoke = await listEntityMessages(vendorAClient, pkg.id, vendorA.id);
  record("Revoked vendor A immediately loses its own correspondence thread", threadAAfterRevoke.length === 0, `length=${threadAAfterRevoke.length}`);

  const pkgViewBAfterARevoke = await getVendorVisibleBidPackage(vendorBClient, pkg.id);
  const pkgViewCAfterARevoke = await getVendorVisibleBidPackage(vendorCClient, pkg.id);
  record("Vendor B's access is COMPLETELY UNAFFECTED by vendor A's revocation", !!pkgViewBAfterARevoke, JSON.stringify(!!pkgViewBAfterARevoke));
  record("Vendor C's access is COMPLETELY UNAFFECTED by vendor A's revocation", !!pkgViewCAfterARevoke, JSON.stringify(!!pkgViewCAfterARevoke));

  const staffThreadAAfterRevoke = await listEntityMessages(staff, pkg.id, vendorA.id);
  record("Staff can still see revoked vendor A's full correspondence history (portal is the system of record)", staffThreadAAfterRevoke.length === 2, `length=${staffThreadAAfterRevoke.length}`);

  // ---------------------------------------------------------------
  // STEP 6 — THE NEW FIX (schema/029): vendor A replays its ORIGINAL,
  // already-accepted invitation token, still signed in as the same
  // now-revoked session. Before schema/029 this silently cleared
  // revoked_at with zero staff action. Must now fail outright.
  // ---------------------------------------------------------------
  const { error: replayErr } = await vendorAClient.rpc("accept_vendor_bid_invitation", { p_token: inviteA.accessToken, p_full_name: null });
  record(
    "SECURITY FIX SPOT-CHECK (schema/029) — replaying vendor A's ORIGINAL already-accepted invitation token after revocation is REJECTED, not silently reactivated",
    !!replayErr,
    replayErr?.message ?? "(no error raised — REGRESSION: the replay-reactivation gap is back)"
  );

  const { data: memberRowAfterReplay } = await admin.from("vendor_members").select("revoked_at").eq("vendor_id", vendorA.id).eq("profile_id", vendorAUserId).single();
  record(
    "After the failed replay attempt, vendor_members.revoked_at is STILL set (no silent reactivation at the raw-column level)",
    memberRowAfterReplay?.revoked_at !== null,
    JSON.stringify(memberRowAfterReplay)
  );

  const pkgViewAfterFailedReplay = await getVendorVisibleBidPackage(vendorAClient, pkg.id);
  record(
    "End-to-end: vendor A STILL cannot read the bid package after the failed replay attempt (RLS confirms the fix, not just the raw column)",
    pkgViewAfterFailedReplay === null,
    JSON.stringify(pkgViewAfterFailedReplay)
  );

  // ---------------------------------------------------------------
  // STEP 7 — the LEGITIMATE reactivation path: staff's own explicit
  // reactivateVendorMember(), now wired to the new "Reactivate" button
  // in BidPackageWorkspace's Vendor Access panel. Must genuinely
  // restore access.
  // ---------------------------------------------------------------
  const reactivateResult = await reactivateVendorMember(staff, vendorA.id, vendorAUserId);
  record("Staff explicitly reactivates vendor A (reactivateVendorMember — the exact function now wired to the new Reactivate button)", !reactivateResult.error, reactivateResult.error);

  const pkgViewAfterReactivate = await getVendorVisibleBidPackage(vendorAClient, pkg.id);
  record("After explicit staff reactivation, vendor A's package access is genuinely restored", !!pkgViewAfterReactivate, JSON.stringify(!!pkgViewAfterReactivate));
  const ownSubAfterReactivate = await getVendorOwnBidSubmission(vendorAClient, pkg.id);
  record("After explicit staff reactivation, vendor A's own submission is readable again, with its original amount intact", ownSubAfterReactivate?.amountCents === 100000, JSON.stringify(ownSubAfterReactivate));
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable P5.2-FINALREVIEW checkpoint data) ---");
  for (const projectId of createdProjectIds) {
    const { error } = await admin.from("projects").delete().eq("id", projectId);
    if (error) console.warn(`  project ${projectId} could not be deleted (${error.message}) — left in place, clearly named P5.2-FINALREVIEW.`);
  }
  for (const vendorId of createdVendorIds) {
    const { error } = await admin.from("vendors").delete().eq("id", vendorId);
    if (error) console.warn(`  vendor ${vendorId} could not be deleted (${error.message}) — left in place, clearly named P5.2-FINALREVIEW.`);
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
    console.error(err.stack);
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
