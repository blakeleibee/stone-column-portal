#!/usr/bin/env node
// P5.2 POST-EXTERNAL-REVIEW live evidence script.
//
// Answers the two things the external review said the previous evidence
// did not actually show:
//
//   1. What a REVOKED vendor's own authenticated session gets back when
//      it queries submissions, documents, and messages DIRECTLY. The
//      earlier database evidence was collected after reactivation, so it
//      proved isolation between vendors but never proved the revoked
//      state at the data layer.
//
//   2. That migration 030 holds live: revoking a contact invalidates
//      EVERY outstanding invitation for them, so a second, never-used
//      invitation can no longer undo the revocation.
//
// EVERY query goes through q(), which treats a PostgREST error as a hard
// FAILURE rather than silently yielding "zero rows". That distinction
// matters: a mistyped column returns {data:null}, and a naive `?? []`
// turns that into a passing "no data leaked" assertion for entirely the
// wrong reason. That exact mistake was made once during this package's
// review and is deliberately designed out here.
//
// Prints no password or token material.
//
// Usage: npx tsx scripts/db/live-p5.2-postreview-revoked-access-evidence.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, STAFF_PREVIEW_PASSWORD (apps/web/.env.local).
// No dev server required.

try {
  process.loadEnvFile("apps/web/.env.local");
} catch {
  // fine if it doesn't exist -- env vars may already be exported
}

import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same as the other live checkpoint scripts: run from apps/web so
// LocalFilesystemStorageAdapter resolves its storage root correctly.
process.chdir(path.join(__dirname, "..", "..", "apps", "web"));

const { createClient } = require("@supabase/supabase-js");
const {
  inviteVendor,
  publishBidPackage,
  submitVendorBid,
  revokeVendorMember,
} = require("../../packages/02-app-shell/src/services/bidService.ts");
const { sendStaffMessage } = require("../../packages/02-app-shell/src/services/correspondenceService.ts");
const { LocalFilesystemStorageAdapter } = require("../../apps/web/src/server/storage/LocalFilesystemStorageAdapter.ts");
const { uploadBidPackageDocument } = require("../../packages/02-app-shell/src/services/bidService.ts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STAFF_EMAIL = "p3-preview-admin@example.com";
const STAFF_PASSWORD = process.env.STAFF_PREVIEW_PASSWORD;
const DEV_SERVER_URL = "http://127.0.0.1:5173"; // only used to build a link string

if (!url || !anonKey || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must all be set.");
  process.exit(1);
}
if (!STAFF_PASSWORD) {
  console.error("STAFF_PREVIEW_PASSWORD is not set. Add it to apps/web/.env.local (gitignored).");
  process.exit(1);
}
if (process.env.RESEND_API_KEY) {
  console.error("RESEND_API_KEY is set — refusing to run (this script must never risk a real email send).");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const stamp = Date.now();
const PREFIX = "P5.2-POSTREVIEW";
// Generated per run and never printed — nothing reusable ends up in any log.
const VENDOR_PASSWORD = "Pw-" + crypto.randomBytes(24).toString("base64url");
const VENDOR_EMAIL = `p522-postreview-vendor-${stamp}@example.com`;

const results = [];
let queryErrors = 0;
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}
async function q(label, builder) {
  const { data, error } = await builder;
  if (error) {
    queryErrors++;
    record(`QUERY ERROR (${label}) — any assertion relying on this is void`, false, `${error.code}: ${error.message}`);
    return null;
  }
  return data ?? [];
}
const fresh = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const staff = fresh();
  const { data: staffSignIn, error: staffErr } = await staff.auth.signInWithPassword({ email: STAFF_EMAIL, password: STAFF_PASSWORD });
  record("Staff sign-in with the ROTATED preview credential", !staffErr && !!staffSignIn?.user, staffErr?.message);
  if (staffErr) throw new Error("cannot continue without a staff session");

  const { data: profile } = await staff.from("profiles").select("org_id").eq("id", staffSignIn.user.id).single();
  const orgId = profile.org_id;

  const { data: project } = await staff
    .from("projects")
    .insert({ org_id: orgId, name: `${PREFIX} Project ${stamp}`, project_number: `P522PR-${stamp}`, pricing_model: "cost_plus_percentage" })
    .select("id")
    .single();
  await staff.rpc("apply_standard_cost_code_template", { p_project_id: project.id });
  const { data: costCodes } = await staff.from("cost_codes").select("id").eq("project_id", project.id).limit(1);

  // TWO packages. inviteVendor() creates the bid_submissions row, which
  // is unique per (package, vendor), so the same contact cannot hold two
  // outstanding invitations to the SAME package. The realistic shape of
  // the hole the external review described is therefore a contact
  // invited to two DIFFERENT packages: vendor_members (and so
  // revocation) is per vendor COMPANY, spanning every package, while
  // each package's invitation token is issued and expires separately.
  // Accept package A, get revoked, and package B's untouched invitation
  // is still sitting in the inbox.
  async function makePackage(label) {
    const { data: row } = await staff
      .from("bid_packages")
      .insert({
        project_id: project.id,
        cost_code_id: costCodes[0].id,
        title: `${PREFIX} Package ${label} ${stamp}`,
        scope_description: `Post-review evidence scope (${label}).`,
        status: "draft",
      })
      .select("id")
      .single();
    await publishBidPackage(staff, row.id);
    return row;
  }
  const pkg = await makePackage("A");
  const pkgB = await makePackage("B");

  // One vendor-visible document, so the revoked-state document query has
  // something real to fail to see.
  const adapter = new LocalFilesystemStorageAdapter();
  const key = `bid-package-documents/${pkg.id}/plans/${stamp}-plans.txt`;
  const bytes = Buffer.from(`${PREFIX} plan set ${stamp}`);
  await adapter.upload(key, bytes, "text/plain");
  await uploadBidPackageDocument(staff, {
    projectId: project.id,
    bidPackageId: pkg.id,
    storageKey: key,
    fileName: "Plan Set.txt",
    mimeType: "text/plain",
    sizeBytes: bytes.length,
    category: "plans",
    internalOnly: false,
    uploadedBy: staffSignIn.user.id,
  });

  const { data: vendor } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `${PREFIX} Vendor ${stamp}`, email: VENDOR_EMAIL })
    .select("id")
    .single();

  // TWO invitations to the SAME contact, on two different packages —
  // the exact shape of the hole the external review found. Only the
  // first is ever accepted; the second stays unused throughout.
  const inviteOne = await inviteVendor(staff, pkg.id, vendor.id, DEV_SERVER_URL);
  const inviteTwo = await inviteVendor(staff, pkgB.id, vendor.id, DEV_SERVER_URL);
  const bothTokensReal =
    typeof inviteOne.accessToken === "string" &&
    inviteOne.accessToken.length > 16 &&
    typeof inviteTwo.accessToken === "string" &&
    inviteTwo.accessToken.length > 16 &&
    inviteOne.accessToken !== inviteTwo.accessToken;
  record(
    "Two separate invitations issued to the same contact (packages A and B), each with its own real token",
    bothTokensReal,
    `oneOk=${typeof inviteOne.accessToken === "string"} twoOk=${typeof inviteTwo.accessToken === "string"} errors=${inviteOne.error ?? "-"}/${inviteTwo.error ?? "-"} (tokens not shown)`
  );
  // Without two genuine tokens every assertion below is meaningless — a
  // missing token makes the accept RPC fail on its SIGNATURE, which
  // would look exactly like the exploit being blocked. Refuse to
  // continue rather than report a vacuous pass.
  if (!bothTokensReal) throw new Error("cannot produce valid evidence without two real invitation tokens");

  // The stored thread copy must not carry either token (the redaction fix).
  const invitationMessages = await q(
    "invitation entity_messages",
    admin.from("entity_messages").select("id, body").in("bid_package_id", [pkg.id, pkgB.id])
  );
  const anyTokenStored = (invitationMessages ?? []).some(
    (m) => (m.body ?? "").includes(inviteOne.accessToken) || (m.body ?? "").includes(inviteTwo.accessToken)
  );
  record(
    "REDACTION: neither invitation token was persisted into the correspondence thread",
    invitationMessages !== null && !anyTokenStored,
    `messages=${invitationMessages?.length} tokenPresent=${anyTokenStored}`
  );

  // Vendor signs up and accepts invitation #1.
  const vendorClient = fresh();
  const { error: signUpErr } = await vendorClient.auth.signUp({ email: VENDOR_EMAIL, password: VENDOR_PASSWORD });
  if (signUpErr) throw new Error("vendor signUp failed: " + signUpErr.message);
  const { error: acceptErr } = await vendorClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteOne.accessToken,
    p_full_name: "Post Review Contact",
  });
  record("Vendor accepts invitation #1 and gains access", !acceptErr, acceptErr?.message);

  await submitVendorBid(vendorClient, pkg.id, 4200000, "Post-review evidence bid.");
  await sendStaffMessage(staff, {
    bidPackageId: pkg.id,
    vendorId: vendor.id,
    subject: "Post-review evidence",
    body: "POSTREVIEW-THREAD-MARKER: staff message to this vendor.",
    staffProfileId: staffSignIn.user.id,
  });

  // Baseline WHILE STILL ACTIVE — proves the queries below genuinely work
  // and would return rows if RLS allowed it. Without this, "0 rows after
  // revocation" proves nothing.
  const activeSubs = await q("active submissions", vendorClient.from("bid_submissions").select("id, amount_cents").eq("bid_package_id", pkg.id));
  const activeDocs = await q("active documents", vendorClient.from("bid_package_documents").select("id").eq("bid_package_id", pkg.id));
  const activeMsgs = await q("active messages", vendorClient.from("entity_messages").select("id").eq("bid_package_id", pkg.id));
  const activePkg = await q("active package", vendorClient.from("bid_packages").select("id").eq("id", pkg.id));
  record(
    "BASELINE (still active): the vendor's own session genuinely returns their submission, document, messages, and package",
    activeSubs?.length === 1 && activeDocs?.length === 1 && (activeMsgs?.length ?? 0) >= 1 && activePkg?.length === 1,
    `submissions=${activeSubs?.length} documents=${activeDocs?.length} messages=${activeMsgs?.length} package=${activePkg?.length}`
  );

  // ---------------- REVOKE ----------------
  const { data: member } = await admin.from("vendor_members").select("profile_id").eq("vendor_id", vendor.id).single();
  const revokeResult = await revokeVendorMember(staff, vendor.id, member.profile_id);
  record("Staff revokes the vendor contact", !revokeResult.error, revokeResult.error);

  // ---- THE EVIDENCE THE REVIEW ASKED FOR: queries WHILE REVOKED ----
  const revokedSubs = await q("revoked submissions", vendorClient.from("bid_submissions").select("id, amount_cents").eq("bid_package_id", pkg.id));
  record(
    "REVOKED STATE: the vendor's own session returns ZERO submissions — including their own previously-visible bid",
    revokedSubs !== null && revokedSubs.length === 0,
    `rows=${revokedSubs?.length}`
  );

  const revokedDocs = await q("revoked documents", vendorClient.from("bid_package_documents").select("id").eq("bid_package_id", pkg.id));
  record(
    "REVOKED STATE: the vendor's own session returns ZERO bid package documents",
    revokedDocs !== null && revokedDocs.length === 0,
    `rows=${revokedDocs?.length}`
  );

  const revokedMsgs = await q("revoked messages", vendorClient.from("entity_messages").select("id, body").eq("bid_package_id", pkg.id));
  record(
    "REVOKED STATE: the vendor's own session returns ZERO correspondence messages",
    revokedMsgs !== null && revokedMsgs.length === 0,
    `rows=${revokedMsgs?.length}`
  );

  const revokedPkg = await q("revoked package", vendorClient.from("bid_packages").select("id").eq("id", pkg.id));
  record(
    "REVOKED STATE: the vendor's own session can no longer read the bid package itself",
    revokedPkg !== null && revokedPkg.length === 0,
    `rows=${revokedPkg?.length}`
  );

  // ---- MIGRATION 030 LIVE ----
  const invitationRows = await q(
    "invitations after revocation",
    admin.from("bid_vendor_access_invitations").select("id, accepted_at, revoked_at").eq("vendor_id", vendor.id)
  );
  const unaccepted = (invitationRows ?? []).filter((i) => !i.accepted_at);
  record(
    "MIGRATION 030: revoking the contact revoked every UNACCEPTED outstanding invitation",
    invitationRows !== null && unaccepted.length > 0 && unaccepted.every((i) => i.revoked_at !== null),
    `unaccepted=${unaccepted.length} allRevoked=${unaccepted.every((i) => i.revoked_at !== null)}`
  );

  // A rejection only counts as evidence if it came from the function's
  // own authorization logic. A malformed call fails on the PostgREST
  // signature lookup and looks identical from the outside — that false
  // positive is what this guard exists to catch.
  function isRealAuthorizationRejection(err) {
    if (!err) return false;
    if (/Could not find the function|schema cache/i.test(err.message ?? "")) return false;
    return /revoked|invalid|expired|invitation/i.test(err.message ?? "");
  }

  // The exploit: the revoked contact opens the never-used invitation #2.
  const { error: replayUnusedErr } = await vendorClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteTwo.accessToken,
    p_full_name: null,
  });
  record(
    "MIGRATION 030 EXPLOIT BLOCKED: the revoked contact accepting their still-UNUSED second invitation is rejected by the function's own authorization logic",
    isRealAuthorizationRejection(replayUnusedErr),
    replayUnusedErr ? `rejected: ${replayUnusedErr.message}` : "NO ERROR — the exploit succeeded"
  );

  // The original schema/029 case must still hold.
  const { error: replayUsedErr } = await vendorClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteOne.accessToken,
    p_full_name: null,
  });
  record(
    "SCHEMA 029 REGRESSION: replaying the already-accepted invitation is still rejected",
    isRealAuthorizationRejection(replayUsedErr),
    replayUsedErr ? `rejected: ${replayUsedErr.message}` : "NO ERROR — the exploit succeeded"
  );

  const memberAfter = await q("membership after attempts", admin.from("vendor_members").select("revoked_at").eq("vendor_id", vendor.id));
  record(
    "After BOTH acceptance attempts the membership is still revoked — neither token reactivated anything",
    memberAfter !== null && memberAfter.every((m) => m.revoked_at !== null),
    JSON.stringify(memberAfter)
  );

  const stillRevokedSubs = await q("post-attempt submissions", vendorClient.from("bid_submissions").select("id").eq("bid_package_id", pkg.id));
  record(
    "End-to-end: after both attempts the vendor session still reads ZERO submissions",
    stillRevokedSubs !== null && stillRevokedSubs.length === 0,
    `rows=${stillRevokedSubs?.length}`
  );

  // Staff retain everything.
  const staffSubs = await q("staff submissions", staff.from("bid_submissions").select("id").eq("bid_package_id", pkg.id));
  record(
    "Staff retain full visibility of the revoked contact's submission",
    staffSubs !== null && staffSubs.length === 1,
    `rows=${staffSubs?.length}`
  );

  // Financial backbone untouched throughout.
  const bl = await q("budget_ledger", admin.from("budget_ledger").select("id").eq("project_id", project.id));
  record("budget_ledger remains empty for this project throughout", bl !== null && bl.length === 0, `rows=${bl?.length}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${queryErrors} query errors.`);
  if (failed.length) {
    console.log("FAILURES:");
    failed.forEach((f) => console.log(` - ${f.name}${f.detail ? ` :: ${f.detail}` : ""}`));
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("EVIDENCE SCRIPT ERROR:", e.message);
  process.exit(1);
});
