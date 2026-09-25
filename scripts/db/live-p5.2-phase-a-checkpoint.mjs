#!/usr/bin/env node
// Checkpoint for P5.2 Phase A (vendor bid-access RLS fix + first-access
// magic link). Proves schema/022_vendor_bid_access_phase_a.sql end-to-end
// against the real hosted dev project, using the exact same service
// functions the app's own Server Actions call (bidService.ts's
// inviteVendor/revokeVendorMember/reactivateVendorMember/
// getVendorVisibleBidPackage) plus the new accept_vendor_bid_invitation()
// RPC directly (there is no admin-side "accept" call — that's the
// vendor's own first-access action, exercised here via two REAL Supabase
// Auth accounts, never the service-role client for anything a real user
// flow does).
//
// Staff side: signs in as the established p3-preview-admin@example.com
// test account (per this engagement's own standing pattern), rather than
// bootstrapping a brand-new org — this is a shared, persistent staff
// test identity already used by prior packages' live checkpoints.
// Vendor side: creates two DISTINCT, clearly-named real Supabase Auth
// accounts ("P5.2-PHASEA-TEST Vendor A" / "...Vendor B"), deleted in
// cleanup() below.
//
// IMPORTANT — as of 2026-09-10, this script could NOT be run to
// completion from the Claude Code sandbox this was written in: every
// query that requires the project's actual Postgres database (PostgREST
// table reads even via curl with no supabase-js involved, and raw
// Postgres-wire-protocol connections on both the direct db host and
// both pooler ports) timed out, while the Supabase Management API
// (project status, HTTPS to the edge gateway's static routes) responded
// normally and reported the project as ACTIVE_HEALTHY. This points to
// the hosted project's database itself being temporarily unreachable
// from Supabase's own data-plane services, not a sandbox network
// restriction (confirmed via curl AND node fetch, both hanging
// identically). See docs/milestones/P5.2-phase-a... (or the PR/report
// this shipped with) for the full diagnostic trail. Re-run this once
// the project's database is confirmed reachable again (`supabase
// projects list` alone does not prove this — a real `select` against a
// real table must actually return before this script has any chance of
// passing).
//
// Usage: node scripts/db/live-p5.2-phase-a-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from apps/web/.env.local if present).

try {
  process.loadEnvFile("apps/web/.env.local");
} catch {
  // fine if it doesn't exist -- env vars may already be exported
}

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  inviteVendor,
  revokeVendorMember,
  reactivateVendorMember,
  getVendorVisibleBidPackage,
} = require("../../packages/02-app-shell/src/services/bidService.ts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
const STAFF_PASSWORD = process.env.STAFF_PREVIEW_PASSWORD;
if (!STAFF_PASSWORD) {
  console.error("STAFF_PREVIEW_PASSWORD is not set. Add it to apps/web/.env.local (gitignored) — the shared preview password must never be written into a tracked file again. See docs/milestones/P5.2-DRAFT-pending-owner-review.md.");
  process.exit(1);
}

const VENDOR_A_EMAIL = `p522-phasea-test-vendor-a-${stamp}@example.com`;
const VENDOR_B_EMAIL = `p522-phasea-test-vendor-b-${stamp}@example.com`;
const VENDOR_PASSWORD = "P522PhaseA-Test-Password-123!";

async function main() {
  // ---- Staff setup: real sign-in as the established staff test account ----
  const staff = freshClient();
  const { data: staffSignIn, error: staffSignInErr } = await staff.auth.signInWithPassword({ email: STAFF_EMAIL, password: STAFF_PASSWORD });
  record("Staff sign-in (p3-preview-admin)", !staffSignInErr && !!staffSignIn.user, staffSignInErr?.message);
  if (staffSignInErr) throw new Error("Cannot continue without a real staff session.");

  const { data: staffProfile, error: staffProfileErr } = await staff.from("profiles").select("org_id").eq("id", staffSignIn.user.id).single();
  record("Resolved staff org_id", !staffProfileErr && !!staffProfile?.org_id, staffProfileErr?.message);
  const orgId = staffProfile.org_id;

  const { data: project, error: projectErr } = await staff
    .from("projects")
    .insert({
      org_id: orgId,
      name: `P5.2-PHASEA-TEST Project ${stamp}`,
      project_number: `P522PA-${stamp}`,
      pricing_model: "cost_plus_percentage",
    })
    .select("id")
    .single();
  record("Real project created (staff session)", !projectErr && !!project, projectErr?.message);
  if (projectErr) throw new Error("Cannot continue without a project.");
  createdProjectIds.push(project.id);

  const { error: templateErr } = await staff.rpc("apply_standard_cost_code_template", { p_project_id: project.id });
  record("apply_standard_cost_code_template()", !templateErr, templateErr?.message);

  const { data: costCodes, error: costCodesErr } = await staff
    .from("cost_codes")
    .select("id, code")
    .eq("project_id", project.id)
    .order("code", { ascending: true })
    .limit(1);
  record("A real cost code exists on the project", !costCodesErr && (costCodes?.length ?? 0) === 1, costCodesErr?.message);
  const costCode = costCodes?.[0];

  // ---- Two distinct vendor companies, two bid packages in the SAME project ----
  const { data: vendorA, error: vendorAErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASEA-TEST Vendor A ${stamp}`, email: VENDOR_A_EMAIL })
    .select("id")
    .single();
  record("Vendor A created", !vendorAErr && !!vendorA, vendorAErr?.message);
  if (vendorA) createdVendorIds.push(vendorA.id);

  const { data: vendorB, error: vendorBErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASEA-TEST Vendor B ${stamp}`, email: VENDOR_B_EMAIL })
    .select("id")
    .single();
  record("Vendor B created", !vendorBErr && !!vendorB, vendorBErr?.message);
  if (vendorB) createdVendorIds.push(vendorB.id);

  const { data: package1, error: package1Err } = await staff
    .from("bid_packages")
    .insert({ project_id: project.id, cost_code_id: costCode.id, title: `P5.2-PHASEA-TEST Package 1 ${stamp}`, status: "published" })
    .select("id")
    .single();
  record("Bid package 1 created (published)", !package1Err && !!package1, package1Err?.message);

  const { data: package2, error: package2Err } = await staff
    .from("bid_packages")
    .insert({ project_id: project.id, cost_code_id: costCode.id, title: `P5.2-PHASEA-TEST Package 2 ${stamp}`, status: "published" })
    .select("id")
    .single();
  record("Bid package 2 created (published)", !package2Err && !!package2, package2Err?.message);

  // ---- Invite Vendor A to Package 1 only, Vendor B to Package 2 only —
  // the exact real inviteVendor() Server Action code path (bid_submissions
  // insert + bid_vendor_access_invitations token issuance). ----
  const inviteA = await inviteVendor(staff, package1.id, vendorA.id);
  record("inviteVendor(package1, vendorA) returns a real access token", !inviteA.error && !!inviteA.accessToken, inviteA.error);

  const inviteB = await inviteVendor(staff, package2.id, vendorB.id);
  record("inviteVendor(package2, vendorB) returns a real access token", !inviteB.error && !!inviteB.accessToken, inviteB.error);

  // ---- Vendor A: real Supabase Auth sign-up + accept_vendor_bid_invitation() ----
  const vendorAClient = freshClient();
  const { data: vendorASignUp, error: vendorASignUpErr } = await vendorAClient.auth.signUp({ email: VENDOR_A_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor A real Supabase Auth sign-up", !vendorASignUpErr && !!vendorASignUp.user, vendorASignUpErr?.message);
  if (vendorASignUp?.user) createdUserIds.push(vendorASignUp.user.id);

  const { data: acceptAResult, error: acceptAErr } = await vendorAClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteA.accessToken,
    p_full_name: "P5.2-PHASEA-TEST Vendor A Contact",
  });
  const acceptARow = Array.isArray(acceptAResult) ? acceptAResult[0] : acceptAResult;
  record("Vendor A accept_vendor_bid_invitation() succeeds and returns package1's id", !acceptAErr && acceptARow?.bid_package_id === package1.id, acceptAErr?.message ?? JSON.stringify(acceptARow));

  // ---- Vendor B: real Supabase Auth sign-up + accept_vendor_bid_invitation() ----
  const vendorBClient = freshClient();
  const { data: vendorBSignUp, error: vendorBSignUpErr } = await vendorBClient.auth.signUp({ email: VENDOR_B_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor B real Supabase Auth sign-up", !vendorBSignUpErr && !!vendorBSignUp.user, vendorBSignUpErr?.message);
  if (vendorBSignUp?.user) createdUserIds.push(vendorBSignUp.user.id);

  const { data: acceptBResult, error: acceptBErr } = await vendorBClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteB.accessToken,
    p_full_name: "P5.2-PHASEA-TEST Vendor B Contact",
  });
  const acceptBRow = Array.isArray(acceptBResult) ? acceptBResult[0] : acceptBResult;
  record("Vendor B accept_vendor_bid_invitation() succeeds and returns package2's id", !acceptBErr && acceptBRow?.bid_package_id === package2.id, acceptBErr?.message ?? JSON.stringify(acceptBRow));

  // ---- The real isolation proof: exactly the required scenarios ----
  const pkg1AsA = await getVendorVisibleBidPackage(vendorAClient, package1.id);
  record("Vendor A's real session CAN read Package 1 (invited)", pkg1AsA?.id === package1.id, JSON.stringify(pkg1AsA));

  const pkg2AsA = await getVendorVisibleBidPackage(vendorAClient, package2.id);
  record("Vendor A's real session gets a clean null for Package 2 (NOT invited, same project)", pkg2AsA === null, JSON.stringify(pkg2AsA));

  const pkg2AsB = await getVendorVisibleBidPackage(vendorBClient, package2.id);
  record("Vendor B's real session CAN read Package 2 (invited)", pkg2AsB?.id === package2.id, JSON.stringify(pkg2AsB));

  const pkg1AsB = await getVendorVisibleBidPackage(vendorBClient, package1.id);
  record("Vendor B's real session gets a clean null for Package 1 (NOT invited)", pkg1AsB === null, JSON.stringify(pkg1AsB));

  // Cross-vendor data isolation beyond just bid_packages: Vendor B must
  // never see Vendor A's own bid_submissions row.
  const { data: crossSubmissions, error: crossSubmissionsErr } = await vendorBClient
    .from("bid_submissions")
    .select("id")
    .eq("bid_package_id", package1.id);
  record("Vendor B's session sees zero bid_submissions rows on Vendor A's package", !crossSubmissionsErr && (crossSubmissions?.length ?? -1) === 0, crossSubmissionsErr?.message ?? JSON.stringify(crossSubmissions));

  // ---- Revoke Vendor A's vendor_members row (staff session, real
  // revokeVendorMember() Server Action code path) — access must be lost
  // immediately, then restored on reactivation. ----
  const revokeResult = await revokeVendorMember(staff, vendorA.id, vendorASignUp.user.id);
  record("revokeVendorMember(vendorA) succeeds", !revokeResult.error, revokeResult.error);

  const pkg1AsARevoked = await getVendorVisibleBidPackage(vendorAClient, package1.id);
  record("Revoked Vendor A immediately loses access to Package 1", pkg1AsARevoked === null, JSON.stringify(pkg1AsARevoked));

  const reactivateResult = await reactivateVendorMember(staff, vendorA.id, vendorASignUp.user.id);
  record("reactivateVendorMember(vendorA) succeeds", !reactivateResult.error, reactivateResult.error);

  const pkg1AsAReactivated = await getVendorVisibleBidPackage(vendorAClient, package1.id);
  record("Reactivated Vendor A regains access to Package 1", pkg1AsAReactivated?.id === package1.id, JSON.stringify(pkg1AsAReactivated));
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable P5.2 Phase A checkpoint data) ---");
  for (const projectId of createdProjectIds) {
    const { error: deleteErr } = await admin.from("projects").delete().eq("id", projectId);
    if (deleteErr) console.warn(`  project ${projectId} could not be deleted (${deleteErr.message}) — left in place, clearly named P5.2-PHASEA-TEST.`);
  }
  for (const vendorId of createdVendorIds) {
    const { error: deleteErr } = await admin.from("vendors").delete().eq("id", vendorId);
    if (deleteErr) console.warn(`  vendor ${vendorId} could not be deleted (${deleteErr.message}) — left in place, clearly named P5.2-PHASEA-TEST.`);
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
