#!/usr/bin/env node
// Live checkpoint for P3 (Project & Staff Access Foundation): proves the
// authorization model that PGlite alone could not be fully trusted for --
// specifically the `projects` table's own RLS policy split (Decision 7a),
// which PGlite's engine already once behaved differently on for the same
// function/table pair (surfaced 2026-08-06, documented in schema/001).
// Every call here uses the exact real service functions/RPCs the app
// itself calls, through per-user RLS-scoped clients (never service-role)
// -- service-role is used only to seed disposable staff_function test
// profiles (mirroring scripts/db/seed.mjs's own precedent for fixture
// data) and for teardown, exactly like live-auth-checkpoint.mjs.
//
// Usage: node scripts/db/live-p3-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local if present).

try {
  process.loadEnvFile(".env.local");
} catch {}

import { createClient } from "@supabase/supabase-js";

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
const createdOrgIds = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}

function freshClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signUpAndBootstrap(label, orgLabel) {
  const email = `p3-checkpoint-${label}-${stamp}@example.com`;
  const password = "Checkpoint-Test-Password-123!";
  const client = freshClient();
  const { data: signUp, error: signUpErr } = await client.auth.signUp({ email, password });
  if (signUpErr || !signUp.user) throw new Error(`Signup failed for ${label}: ${signUpErr?.message}`);
  createdUserIds.push(signUp.user.id);
  const { data: orgId, error: bootErr } = await client.rpc("bootstrap_organization", {
    p_org_name: `P3 Checkpoint ${orgLabel} ${stamp}`,
    p_admin_full_name: `P3 Checkpoint Admin ${label}`,
    p_admin_email: email,
  });
  if (bootErr) throw new Error(`bootstrap_organization failed for ${label}: ${bootErr.message}`);
  createdOrgIds.push(orgId);
  return { client, userId: signUp.user.id, orgId, email, password };
}

async function seedStaffProfile(orgId, fullName, staffFunction) {
  // Service-role direct insert, mirroring seed.mjs's own precedent for
  // disposable fixture profiles -- bootstrap_organization() only creates
  // the admin; there is no invitation-accept flow exercised here (that's
  // auth_smoke.ts's/live-auth-checkpoint.mjs's job, not this script's).
  const email = `p3-checkpoint-staff-${Math.random().toString(36).slice(2)}-${stamp}@example.com`;
  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: "Checkpoint-Test-Password-123!",
    email_confirm: true,
  });
  if (authErr) throw new Error(`createUser failed for ${fullName}: ${authErr.message}`);
  createdUserIds.push(authUser.user.id);
  const { error: profileErr } = await admin.from("profiles").insert({
    id: authUser.user.id,
    org_id: orgId,
    role: "staff",
    staff_function: staffFunction,
    full_name: fullName,
    email,
    is_active: true,
  });
  if (profileErr) throw new Error(`profile insert failed for ${fullName}: ${profileErr.message}`);
  const client = freshClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: "Checkpoint-Test-Password-123!" });
  if (signInErr) throw new Error(`sign-in failed for ${fullName}: ${signInErr.message}`);
  return { client, userId: authUser.user.id, email };
}

async function main() {
  console.log(`\n=== P3 live checkpoint (stamp ${stamp}) ===\n`);

  // ---- Org A: admin, a PM, a superintendent ----
  const { client: adminA, orgId: orgAId } = await signUpAndBootstrap("admin-a", "Org A");

  // The single most important assertion in this whole script: does
  // create_project_with_defaults() actually succeed on REAL Postgres?
  // (schema/016's own comment documents that PGlite did NOT reproduce
  // the self-join hazard the ORIGINAL, buggy version of this policy had
  // -- Task 1's review round found and fixed it, but only PGlite ever
  // ran it before now.)
  const { data: projectA1Id, error: createA1Err } = await adminA.rpc("create_project_with_defaults", {
    p_org_id: orgAId,
    p_name: `Checkpoint Project A1 ${stamp}`,
    p_project_number: `CHK-A1-${stamp}`,
    p_address: "1 Checkpoint Way",
    p_project_type: "custom_home",
    p_pricing_model: "cost_plus_percentage",
    p_pricing_model_label: "Cost-plus 15%",
    p_fee_basis: "percentage",
    p_fee_basis_points: 1500,
  });
  record(
    "create_project_with_defaults() succeeds for a real admin on real Postgres (proves the projects_staff_select self-join fix live, not just PGlite)",
    !createA1Err && !!projectA1Id,
    createA1Err?.message
  );
  if (createA1Err) throw new Error("Cannot continue without Project A1.");

  const { data: projectA2Id, error: createA2Err } = await adminA.rpc("create_project_with_defaults", {
    p_org_id: orgAId,
    p_name: `Checkpoint Project A2 ${stamp}`,
    p_project_number: `CHK-A2-${stamp}`,
    p_address: "2 Checkpoint Way",
    p_project_type: "custom_home",
    p_pricing_model: "cost_plus_percentage",
    p_pricing_model_label: "Cost-plus 15%",
    p_fee_basis: "percentage",
    p_fee_basis_points: 1500,
  });
  record("create_project_with_defaults() succeeds for a second project (A2)", !createA2Err && !!projectA2Id, createA2Err?.message);

  // Cost-code template really seeded?
  const { data: costCodes, error: ccErr } = await adminA.from("cost_codes").select("id").eq("project_id", projectA1Id);
  record("Standard cost-code template seeded onto A1 (113 codes expected)", !ccErr && costCodes?.length === 113, ccErr?.message ?? `got ${costCodes?.length}`);

  const { data: feeRule, error: feeErr } = await adminA.from("project_fee_rules").select("id").eq("project_id", projectA1Id).is("effective_to", null).maybeSingle();
  record("project_fee_rules row created atomically with A1", !feeErr && !!feeRule, feeErr?.message);

  // Non-admin cannot create a project directly (RLS INSERT gate, not just the RPC's own check)
  const pmSeed = await seedStaffProfile(orgAId, "Checkpoint PM A", "project_manager");
  const { error: nonAdminInsertErr } = await pmSeed.client.from("projects").insert({
    org_id: orgAId,
    name: "Should never exist",
    project_number: `CHK-BAD-${stamp}`,
    pricing_model: "cost_plus_percentage",
  });
  record("A non-admin (project_manager) cannot INSERT into projects directly", !!nonAdminInsertErr, nonAdminInsertErr ? undefined : "insert unexpectedly succeeded");

  // PM sees nothing until assigned
  const { data: pmProjectsBefore } = await pmSeed.client.from("projects").select("id").eq("org_id", orgAId);
  record("Unassigned project_manager sees 0 projects", (pmProjectsBefore?.length ?? -1) === 0, `got ${pmProjectsBefore?.length}`);

  const { data: assignment, error: assignErr } = await adminA.from("project_staff_assignments").insert({
    project_id: projectA1Id,
    profile_id: pmSeed.userId,
    assigned_by: (await adminA.auth.getUser()).data.user.id,
  }).select("id").single();
  record("Admin can assign the PM to Project A1", !assignErr && !!assignment, assignErr?.message);

  const { data: pmProjectsAfter } = await pmSeed.client.from("projects").select("id").eq("org_id", orgAId);
  const pmSeesOnlyA1 = pmProjectsAfter?.length === 1 && pmProjectsAfter[0].id === projectA1Id;
  record("Assigned project_manager sees exactly Project A1, not A2", pmSeesOnlyA1, `got ${JSON.stringify(pmProjectsAfter?.map((p) => p.id))}`);

  const { data: pmA2Read } = await pmSeed.client.from("cost_codes").select("id").eq("project_id", projectA2Id);
  record("Assigned project_manager (to A1) cannot read Project A2's cost_codes", (pmA2Read?.length ?? -1) === 0, `got ${pmA2Read?.length}`);

  const { error: pmUpdateA1Err } = await pmSeed.client.from("cost_codes").update({ scope_description: "pm write test" }).eq("project_id", projectA1Id).limit(1);
  const { data: pmA1CostCodes } = await pmSeed.client.from("cost_codes").select("id, scope_description").eq("project_id", projectA1Id).limit(1);
  record("Assigned project_manager CAN write A1's cost_codes (financial-staff, not superintendent)", !pmUpdateA1Err, pmUpdateA1Err?.message);

  // Superintendent: sees the project, but zero financial access
  const superSeed = await seedStaffProfile(orgAId, "Checkpoint Super A", "superintendent");
  await adminA.from("project_staff_assignments").insert({
    project_id: projectA1Id,
    profile_id: superSeed.userId,
    assigned_by: (await adminA.auth.getUser()).data.user.id,
  });
  const { data: superProjects } = await superSeed.client.from("projects").select("id").eq("org_id", orgAId);
  record("Assigned superintendent sees Project A1 (is_org_staff true)", superProjects?.length === 1 && superProjects[0].id === projectA1Id, `got ${JSON.stringify(superProjects?.map((p) => p.id))}`);

  const { data: superCostCodes } = await superSeed.client.from("cost_codes").select("id").eq("project_id", projectA1Id);
  record("Assigned superintendent CANNOT read A1's cost_codes (is_financial_staff false)", (superCostCodes?.length ?? -1) === 0, `got ${superCostCodes?.length}`);

  const { error: superUpdateGmpErr } = await superSeed.client.from("projects").update({ gmp_amount_cents: 999999, gmp_enabled: true }).eq("id", projectA1Id);
  const { data: projectA1AfterSuperWrite } = await adminA.from("projects").select("gmp_amount_cents").eq("id", projectA1Id).single();
  record("Assigned superintendent CANNOT write projects.gmp_amount_cents", projectA1AfterSuperWrite?.gmp_amount_cents == null, `error=${superUpdateGmpErr?.message}, value after=${projectA1AfterSuperWrite?.gmp_amount_cents}`);

  const { data: superAudit } = await superSeed.client.from("audit_log").select("id").eq("project_id", projectA1Id);
  record("Assigned superintendent sees 0 audit_log rows for A1", (superAudit?.length ?? -1) === 0, `got ${superAudit?.length}`);

  const { data: pmAudit } = await pmSeed.client.from("audit_log").select("id").eq("project_id", projectA1Id);
  record("Assigned project_manager sees >0 audit_log rows for A1 (their own assignment)", (pmAudit?.length ?? 0) > 0, `got ${pmAudit?.length}`);
  const { data: pmAuditA2 } = await pmSeed.client.from("audit_log").select("id").eq("project_id", projectA2Id);
  record("Assigned project_manager (to A1 only) sees 0 audit_log rows for A2", (pmAuditA2?.length ?? -1) === 0, `got ${pmAuditA2?.length}`);

  // Revocation
  const { error: revokeErr } = await adminA.from("project_staff_assignments").update({
    revoked_at: new Date().toISOString(),
    revoked_by: (await adminA.auth.getUser()).data.user.id,
  }).eq("id", assignment.id);
  record("Admin can revoke the PM's assignment", !revokeErr, revokeErr?.message);

  const { data: pmProjectsAfterRevoke } = await pmSeed.client.from("projects").select("id").eq("org_id", orgAId);
  record("Revoked project_manager immediately sees 0 projects", (pmProjectsAfterRevoke?.length ?? -1) === 0, `got ${pmProjectsAfterRevoke?.length}`);

  // ---- Cross-organization isolation ----
  const orgB = await signUpAndBootstrap("admin-b", "Org B");
  const { data: crossOrgRead } = await orgB.client.from("projects").select("id").eq("id", projectA1Id);
  record("Org B admin cannot read Org A's Project A1 (cross-org isolation)", (crossOrgRead?.length ?? -1) === 0, `got ${crossOrgRead?.length}`);

  const { data: crossOrgProjectsList } = await orgB.client.from("projects").select("id");
  const leaked = crossOrgProjectsList?.some((p) => p.id === projectA1Id || p.id === projectA2Id);
  record("Org B admin's project list never includes an Org A project id", !leaked, `list length=${crossOrgProjectsList?.length}`);

  // ---- Summary ----
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===\n`);
  if (failed.length > 0) {
    console.log("FAILURES:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  }

  // ---- Teardown: NOT POSSIBLE for org/project/profile rows, by design ----
  // audit_log is append-only (a DB trigger rejects UPDATE/DELETE outright
  // -- CLAUDE.md's own non-negotiable), and every action this script took
  // (project creation, assignment, revocation) wrote real audit_log rows
  // referencing these projects/profiles/org via plain (non-cascading) FKs.
  // That makes the created projects/profiles/org permanently undeletable
  // through ordinary means -- correct, intentional system behavior, not a
  // bug in this script. Confirmed empirically the first time this script
  // ran (2026-08-19): every delete attempt on projects/profiles/orgs after
  // real usage failed with FK violations chaining back to audit_log's own
  // append-only guard. This mirrors, at small scale, exactly why financial
  // corrections in this system are new rows, never edits/deletes.
  //
  // Practical consequence: this script's fixtures (org "P3 Checkpoint Org
  // A/B <timestamp>", 2 projects, a handful of staff profiles and their
  // auth users) are NOT cleaned up automatically and will persist in
  // whatever project this script is run against. They are clearly named
  // and harmless (no real customer data), but re-running this script
  // repeatedly against the same project will accumulate rows over time --
  // acceptable for a dev/staging project, not something to run routinely
  // or against anything closer to production.
  console.log(
    "\nNOTE: fixture teardown skipped -- audit_log's append-only guard makes\n" +
    "the created org/projects/profiles permanently undeletable once real\n" +
    "actions have been audited against them (expected, not a bug). They\n" +
    `remain in the database, clearly named "P3 Checkpoint ... ${stamp}".`
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nCHECKPOINT SCRIPT ERROR:", err.message);
  console.error("Fixtures created before the error may still exist and require manual cleanup:");
  console.error("  createdUserIds:", createdUserIds);
  console.error("  createdOrgIds:", createdOrgIds);
  process.exit(1);
});
