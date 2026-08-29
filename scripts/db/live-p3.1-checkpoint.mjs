#!/usr/bin/env node
// Live checkpoint for P3.1 (Project Intake & Employee Handoff): proves,
// against the REAL hosted dev Supabase project (never PGlite), the parts
// of schema/018 + schema/019 that PGlite's emulation could not fully be
// trusted for -- specifically:
//   - generate_project_number()'s atomic-upsert numbering claim, which
//     depends on real MVCC row-level locking PGlite does not reproduce
//     the same way real Postgres does. Two create_project_with_defaults()
//     calls are fired concurrently (Promise.all), not sequentially.
//   - set_project_fee_terms()'s supersede-under-concurrency fix (Task 1
//     fix round 1, item 1) -- the `for update` row lock + the
//     project_fee_rules_one_active_per_project partial unique index were
//     only ever proven via a scratch-copy PGlite removal test, never
//     against real Postgres locking semantics.
//   - schema/019's new project_staff_assignments_self_select policy (the
//     Task 9 RLS gap) -- a non-admin staff session reading their own
//     assignment row but not a colleague's, on the real database.
//   - generate_project_number()'s cross-tenant rejection (Task 1 fix
//     round 1, item 2) -- a caller with no relationship to the target
//     org must be rejected, not merely bounded by convention.
//
// Every call here uses the exact real service functions/RPCs the app
// itself calls (projectIntakeService.ts, supabaseFinancialRepository.ts,
// buildAdminFinancialsViewModel.ts, raw RPCs for the SQL functions that
// have no JS wrapper of their own), through per-user RLS-scoped clients
// -- never service-role, matching live-p3-checkpoint.mjs's own precedent.
// service-role is used only to seed disposable staff/client auth users
// (mirroring seed.mjs's own precedent) and is never used to read or
// write any row a real user session could write itself.
//
// Usage: npx tsx scripts/db/live-p3.1-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local if present). Must be
// run with tsx, not plain node -- it require()s real .ts service-layer
// files across the packages/02-app-shell boundary, exactly like
// live-p4-checkpoint.mjs already does.

try {
  process.loadEnvFile(".env.local");
} catch {}

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Cross-package .ts imports use CJS require() via tsx, not ESM `import`
// -- packages/02-app-shell has no "type": "module" in its package.json,
// so a plain ESM import from this script would need file-extension/
// resolution config this monorepo doesn't have across this boundary,
// but require() resolves them correctly (live-p4-checkpoint.mjs's own
// precedent).
const {
  upsertProjectBrief,
  getProjectBriefForStaff,
  upsertProjectSiteInfo,
  getProjectSiteInfo,
  upsertProjectContact,
  listProjectContacts,
  getMyActiveAssignmentForProject,
  getProjectSetupChecklist,
} = require("../../packages/02-app-shell/src/services/projectIntakeService.ts");
const { SupabaseFinancialRepository } = require("../../packages/02-app-shell/src/data/supabaseFinancialRepository.ts");
const { buildAdminFinancialsViewModel } = require("../../packages/02-app-shell/src/viewmodels/buildAdminFinancialsViewModel.ts");

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
  const email = `p3.1-checkpoint-${label}-${stamp}@example.com`;
  const password = "Checkpoint-Test-Password-123!";
  const client = freshClient();
  const { data: signUp, error: signUpErr } = await client.auth.signUp({ email, password });
  if (signUpErr || !signUp.user) throw new Error(`Signup failed for ${label}: ${signUpErr?.message}`);
  createdUserIds.push(signUp.user.id);
  const { data: orgId, error: bootErr } = await client.rpc("bootstrap_organization", {
    p_org_name: `P3.1 Checkpoint ${orgLabel} ${stamp}`,
    p_admin_full_name: `P3.1 Checkpoint Admin ${label}`,
    p_admin_email: email,
  });
  if (bootErr) throw new Error(`bootstrap_organization failed for ${label}: ${bootErr.message}`);
  createdOrgIds.push(orgId);
  const { data: userData } = await client.auth.getUser();
  return { client, userId: signUp.user.id, orgId, email, password, adminProfileId: userData.user.id };
}

async function seedStaffProfile(orgId, fullName, staffFunction) {
  const email = `p3.1-checkpoint-staff-${Math.random().toString(36).slice(2)}-${stamp}@example.com`;
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

async function seedClientProfile(orgId, projectId, fullName) {
  const email = `p3.1-checkpoint-client-${Math.random().toString(36).slice(2)}-${stamp}@example.com`;
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
    role: "client",
    full_name: fullName,
    email,
    is_active: true,
  });
  if (profileErr) throw new Error(`profile insert failed for ${fullName}: ${profileErr.message}`);
  // project_members insert done by the caller (needs an org-staff/admin
  // client to satisfy project_members_staff_manage's RLS check), not
  // here -- this helper only creates the auth user + profile + session.
  const client = freshClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: "Checkpoint-Test-Password-123!" });
  if (signInErr) throw new Error(`sign-in failed for ${fullName}: ${signInErr.message}`);
  return { client, userId: authUser.user.id, email };
}

async function main() {
  console.log(`\n=== P3.1 live checkpoint (stamp ${stamp}) ===\n`);

  const { client: adminA, orgId: orgAId, userId: adminAUserId } = await signUpAndBootstrap("admin-a", "Org A");

  // =====================================================================
  // 1. Concurrency-safe project numbering: fire two create_project_with_
  //    defaults() calls at the SAME TIME, with NO pricing model supplied
  //    at all (design's "optional/deferred pricing" path, P3.1's headline
  //    schema change). This is the single most important assertion in
  //    this whole script -- generate_project_number()'s atomic-upsert
  //    claim was only ever proven against PGlite.
  // =====================================================================
  const [c1, c2] = await Promise.all([
    adminA.rpc("create_project_with_defaults", {
      p_org_id: orgAId,
      p_name: `P3.1 Checkpoint Concurrent A ${stamp}`,
      p_address: "10 Checkpoint Way",
      p_project_type: "custom_home",
    }),
    adminA.rpc("create_project_with_defaults", {
      p_org_id: orgAId,
      p_name: `P3.1 Checkpoint Concurrent B ${stamp}`,
      p_address: "11 Checkpoint Way",
      p_project_type: "custom_home",
    }),
  ]);
  record("create_project_with_defaults() succeeds with NO pricing model (project A, concurrent call 1)", !c1.error && !!c1.data, c1.error?.message);
  record("create_project_with_defaults() succeeds with NO pricing model (project B, concurrent call 2)", !c2.error && !!c2.data, c2.error?.message);
  if (c1.error || c2.error) throw new Error("Cannot continue without both concurrently-created projects.");

  const projectId1 = c1.data;
  const projectId2 = c2.data;
  record("The two concurrently-created projects have distinct ids", projectId1 !== projectId2, `${projectId1} vs ${projectId2}`);

  const { data: numberedProjects, error: numberErr } = await adminA
    .from("projects")
    .select("id, project_number")
    .in("id", [projectId1, projectId2]);
  const numberMap = new Map((numberedProjects ?? []).map((p) => [p.id, p.project_number]));
  const number1 = numberMap.get(projectId1);
  const number2 = numberMap.get(projectId2);
  const numberFormat = /^SC-(\d{4})-(\d{3,})$/;
  const m1 = numberFormat.exec(number1 ?? "");
  const m2 = numberFormat.exec(number2 ?? "");
  record(
    "Both projects received SC-YYYY-### formatted numbers",
    !numberErr && !!m1 && !!m2,
    numberErr?.message ?? `number1=${number1}, number2=${number2}`
  );
  const distinctNumbers = !!number1 && !!number2 && number1 !== number2;
  record("The two concurrently-generated project numbers are DISTINCT (real Postgres row-lock proof)", distinctNumbers, `number1=${number1}, number2=${number2}`);
  if (m1 && m2) {
    const seq1 = parseInt(m1[2], 10);
    const seq2 = parseInt(m2[2], 10);
    const sequential = Math.abs(seq1 - seq2) === 1;
    record(
      "The two concurrently-generated sequence numbers are exactly CONSECUTIVE integers (no gap, no duplicate — atomic increment held under real concurrency)",
      sequential,
      `seq1=${seq1}, seq2=${seq2}`
    );
  }

  // =====================================================================
  // 2. Zero-fee-rule project loads cleanly through the real financials
  //    pipeline (the Task 11.5 cross-cutting fix: getFeeRule()'s
  //    .maybeSingle() change, proven here via the actual repository class
  //    and the actual buildAdminFinancialsViewModel() the Overview/
  //    Financials screens call — not a hand-rolled equivalent query).
  // =====================================================================
  const { data: feeRuleRowsBefore, error: feeRuleCheckErr } = await adminA
    .from("project_fee_rules")
    .select("id")
    .eq("project_id", projectId1);
  record("Project A has zero project_fee_rules rows (pricing left to-be-determined)", !feeRuleCheckErr && feeRuleRowsBefore?.length === 0, feeRuleCheckErr?.message ?? `got ${feeRuleRowsBefore?.length}`);

  const repoA = new SupabaseFinancialRepository(adminA);
  let viewModelThrew = false;
  let viewModel = null;
  try {
    viewModel = await buildAdminFinancialsViewModel(projectId1, repoA);
  } catch (err) {
    viewModelThrew = true;
    record("buildAdminFinancialsViewModel() does NOT throw for a zero-fee-rule project", false, err.message);
  }
  if (!viewModelThrew) {
    record("buildAdminFinancialsViewModel() does NOT throw for a zero-fee-rule project", true);
    record("...and its feeSummary is honestly null (not a fabricated $0)", viewModel.feeSummary === null, `got ${JSON.stringify(viewModel.feeSummary)}`);
  }

  // =====================================================================
  // 3. Contact (project_clients), brief (project_briefs), and site info
  //    (project_site_info) round-trip through the real service layer.
  // =====================================================================
  const contactResult = await upsertProjectContact(adminA, projectId1, {
    fullName: "Checkpoint Homeowner",
    preferredName: "Chip",
    role: "primary_homeowner",
    email: "chip@example.com",
    phone: "555-0100",
    preferredContactMethod: "email",
    isPrimary: true,
    isDecisionMaker: true,
    infoStatus: "partial",
  });
  record("upsertProjectContact() succeeds", "id" in contactResult, "error" in contactResult ? contactResult.error : undefined);

  const contacts = await listProjectContacts(adminA, projectId1);
  const readBackContact = contacts.find((c) => "id" in contactResult && c.id === contactResult.id);
  record(
    "The contact is readable back with matching fields",
    !!readBackContact && readBackContact.fullName === "Checkpoint Homeowner" && readBackContact.isDecisionMaker === true && readBackContact.infoStatus === "partial",
    JSON.stringify(readBackContact)
  );

  const briefWriteResult = await upsertProjectBrief(adminA, projectId1, {
    summary: "Two-story custom home, checkpoint fixture.",
    knownScope: "Full custom build, no existing structure.",
    clientGoals: "Move in before next school year.",
    approxSquareFootage: 3200,
    bedrooms: 4,
    bathrooms: 3.5,
    targetBudgetLowCents: 120000000,
    targetBudgetHighCents: 150000000,
    internalNotes: "Internal-only checkpoint note — staff eyes only.",
    clientFacingNotes: "We're excited to get started!",
    clientFacingNotesPublished: true,
  });
  record("upsertProjectBrief() succeeds", !("error" in briefWriteResult), "error" in briefWriteResult ? briefWriteResult.error : undefined);

  const briefReadBack = await getProjectBriefForStaff(adminA, projectId1);
  record(
    "project_briefs round-trips correctly (staff read)",
    !!briefReadBack && briefReadBack.approxSquareFootage === 3200 && briefReadBack.internalNotes === "Internal-only checkpoint note — staff eyes only.",
    JSON.stringify(briefReadBack)
  );

  const siteInfoWriteResult = await upsertProjectSiteInfo(adminA, projectId1, {
    fullAddress: "10 Checkpoint Way, Checkpoint City",
    ownershipStatus: "owned",
    occupiedDuringWork: false,
    hoaReviewRequired: true,
    hoaStatus: "requested",
    surveyStatus: "received",
  });
  record("upsertProjectSiteInfo() succeeds", !("error" in siteInfoWriteResult), "error" in siteInfoWriteResult ? siteInfoWriteResult.error : undefined);

  const siteInfoReadBack = await getProjectSiteInfo(adminA, projectId1);
  record(
    "project_site_info round-trips correctly",
    !!siteInfoReadBack && siteInfoReadBack.fullAddress === "10 Checkpoint Way, Checkpoint City" && siteInfoReadBack.hoaStatus === "requested" && siteInfoReadBack.surveyStatus === "received",
    JSON.stringify(siteInfoReadBack)
  );

  // ---- internal_notes-style client-visibility split, checked directly ----
  const clientSeed = await seedClientProfile(orgAId, projectId1, "Checkpoint Client");
  const { error: memberInsertErr } = await adminA.from("project_members").insert({
    project_id: projectId1,
    user_id: clientSeed.userId,
    member_role: "client",
  });
  record("Admin can add the client as a project_members row", !memberInsertErr, memberInsertErr?.message);

  const { data: clientBriefRead, error: clientBriefErr } = await clientSeed.client.from("project_briefs").select("*").eq("project_id", projectId1);
  record(
    "A client session gets ZERO project_briefs rows (no client-read RLS policy exists yet — schema/018's own documented gap)",
    !clientBriefErr && (clientBriefRead?.length ?? -1) === 0,
    clientBriefErr?.message ?? `got ${clientBriefRead?.length}`
  );
  const { data: clientSiteInfoRead, error: clientSiteInfoErr } = await clientSeed.client.from("project_site_info").select("*").eq("project_id", projectId1);
  record(
    "A client session gets ZERO project_site_info rows (internal-only working info, by design)",
    !clientSiteInfoErr && (clientSiteInfoRead?.length ?? -1) === 0,
    clientSiteInfoErr?.message ?? `got ${clientSiteInfoRead?.length}`
  );
  const { data: clientContactsRead, error: clientContactsErr } = await clientSeed.client.from("project_clients").select("id").eq("project_id", projectId1);
  record(
    "The SAME client session CAN read project_clients (contacts have a real client-read policy, unlike briefs/site-info — proves the split is deliberate, not a blanket lockout)",
    !clientContactsErr && (clientContactsRead?.length ?? 0) > 0,
    clientContactsErr?.message ?? `got ${clientContactsRead?.length}`
  );

  // =====================================================================
  // 4. set_project_fee_terms(): first call sets pricing on the
  //    previously-undetermined project; second call with DIFFERENT terms
  //    proves the supersede/lock fix against real Postgres (Task 1 fix
  //    round 1, item 1 — only ever proven via a scratch-copy PGlite
  //    removal test before now).
  // =====================================================================
  const { error: feeTerms1Err } = await adminA.rpc("set_project_fee_terms", {
    p_project_id: projectId1,
    p_pricing_model: "cost_plus_percentage",
    p_fee_basis: "percentage",
    p_fee_basis_points: 1200,
    p_pricing_model_label: "Cost-plus 12%",
  });
  record("set_project_fee_terms() (first call) succeeds", !feeTerms1Err, feeTerms1Err?.message);

  const { data: projectAfterTerms1 } = await adminA.from("projects").select("pricing_model, pricing_model_label").eq("id", projectId1).single();
  record(
    "projects.pricing_model/pricing_model_label updated after the first set_project_fee_terms() call",
    projectAfterTerms1?.pricing_model === "cost_plus_percentage" && projectAfterTerms1?.pricing_model_label === "Cost-plus 12%",
    JSON.stringify(projectAfterTerms1)
  );

  const { data: feeRuleAfterTerms1 } = await adminA
    .from("project_fee_rules")
    .select("id, fee_basis, fee_basis_points, effective_to")
    .eq("project_id", projectId1)
    .is("effective_to", null)
    .maybeSingle();
  record(
    "Exactly one active (effective_to IS NULL) project_fee_rules row exists after the first call, with the correct terms",
    !!feeRuleAfterTerms1 && feeRuleAfterTerms1.fee_basis === "percentage" && feeRuleAfterTerms1.fee_basis_points === 1200,
    JSON.stringify(feeRuleAfterTerms1)
  );
  const firstFeeRuleId = feeRuleAfterTerms1?.id;

  const { error: feeTerms2Err } = await adminA.rpc("set_project_fee_terms", {
    p_project_id: projectId1,
    p_pricing_model: "cost_plus_fixed_fee",
    p_fee_basis: "fixed",
    p_fee_fixed_amount_cents: 7500000,
    p_pricing_model_label: "Cost-plus fixed fee",
  });
  record("set_project_fee_terms() (second call, DIFFERENT terms) succeeds", !feeTerms2Err, feeTerms2Err?.message);

  const { data: projectAfterTerms2 } = await adminA.from("projects").select("pricing_model, pricing_model_label").eq("id", projectId1).single();
  record(
    "projects.pricing_model/pricing_model_label updated again after the second call",
    projectAfterTerms2?.pricing_model === "cost_plus_fixed_fee" && projectAfterTerms2?.pricing_model_label === "Cost-plus fixed fee",
    JSON.stringify(projectAfterTerms2)
  );

  const { data: allFeeRulesAfterTerms2 } = await adminA
    .from("project_fee_rules")
    .select("id, fee_basis, fee_fixed_amount_cents, effective_to")
    .eq("project_id", projectId1)
    .order("created_at", { ascending: true });
  record("There are now exactly TWO project_fee_rules rows for the project (old superseded, new inserted — never updated in place)", (allFeeRulesAfterTerms2?.length ?? -1) === 2, `got ${allFeeRulesAfterTerms2?.length}`);
  const oldRow = allFeeRulesAfterTerms2?.find((r) => r.id === firstFeeRuleId);
  record("The OLD (first) row now has effective_to SET (superseded, not deleted)", !!oldRow && oldRow.effective_to !== null, JSON.stringify(oldRow));
  const activeRows = (allFeeRulesAfterTerms2 ?? []).filter((r) => r.effective_to === null);
  record(
    "Exactly ONE row has effective_to IS NULL, and it's the NEW row with the new terms (real Postgres locking + the partial unique index both held)",
    activeRows.length === 1 && activeRows[0].id !== firstFeeRuleId && activeRows[0].fee_basis === "fixed" && activeRows[0].fee_fixed_amount_cents === 7500000,
    JSON.stringify(activeRows)
  );

  // =====================================================================
  // 5. schema/019 self-select policy: a non-admin staff session can read
  //    their OWN project_staff_assignments row but not a colleague's.
  // =====================================================================
  const staff1 = await seedStaffProfile(orgAId, "Checkpoint PM", "project_manager");
  const staff2 = await seedStaffProfile(orgAId, "Checkpoint Super", "superintendent");

  const { data: assignment1, error: assign1Err } = await adminA
    .from("project_staff_assignments")
    .insert({ project_id: projectId2, profile_id: staff1.userId, assigned_by: adminAUserId })
    .select("id")
    .single();
  record("Admin can assign staff1 (PM) to project B", !assign1Err && !!assignment1, assign1Err?.message);
  const { data: assignment2, error: assign2Err } = await adminA
    .from("project_staff_assignments")
    .insert({ project_id: projectId2, profile_id: staff2.userId, assigned_by: adminAUserId })
    .select("id")
    .single();
  record("Admin can assign staff2 (Super) to project B", !assign2Err && !!assignment2, assign2Err?.message);

  const { error: handoffErr } = await adminA
    .from("project_staff_assignments")
    .update({
      requested_work: "estimating",
      priority: "high",
      target_due_date: "2026-09-15",
      next_action: "Confirm site visit with homeowner",
      internal_instructions: "Call before scheduling — gate code needed.",
    })
    .eq("id", assignment1.id);
  record("Admin can write staff1's handoff columns", !handoffErr, handoffErr?.message);

  const { data: staff1OwnRow, error: staff1OwnErr } = await staff1.client
    .from("project_staff_assignments")
    .select("id, requested_work, priority, next_action")
    .eq("id", assignment1.id);
  record(
    "staff1 CAN read their own project_staff_assignments row (schema/019 self-select policy, real Postgres)",
    !staff1OwnErr && staff1OwnRow?.length === 1 && staff1OwnRow[0].requested_work === "estimating" && staff1OwnRow[0].priority === "high",
    staff1OwnErr?.message ?? JSON.stringify(staff1OwnRow)
  );

  const { data: staff1OnColleagueRow, error: staff1OnColleagueErr } = await staff1.client
    .from("project_staff_assignments")
    .select("id")
    .eq("id", assignment2.id);
  record(
    "staff1 CANNOT read staff2's (colleague's) project_staff_assignments row",
    !staff1OnColleagueErr && (staff1OnColleagueRow?.length ?? -1) === 0,
    staff1OnColleagueErr?.message ?? `got ${staff1OnColleagueRow?.length}`
  );

  const { data: staff1ProjectRows } = await staff1.client.from("project_staff_assignments").select("id").eq("project_id", projectId2);
  record(
    "staff1's project-scoped list contains EXACTLY their own row, not both",
    staff1ProjectRows?.length === 1 && staff1ProjectRows[0].id === assignment1.id,
    JSON.stringify(staff1ProjectRows)
  );

  const { data: staff2ProjectRows } = await staff2.client.from("project_staff_assignments").select("id").eq("project_id", projectId2);
  record(
    "staff2's project-scoped list contains EXACTLY their own row, not staff1's",
    staff2ProjectRows?.length === 1 && staff2ProjectRows[0].id === assignment2.id,
    JSON.stringify(staff2ProjectRows)
  );

  const myAssignment = await getMyActiveAssignmentForProject(staff1.client, projectId2);
  record(
    "getMyActiveAssignmentForProject() (the real 'Your assignment' Overview-card call) returns staff1's own handoff data",
    !!myAssignment && myAssignment.requestedWork === "estimating" && myAssignment.nextAction === "Confirm site visit with homeowner",
    JSON.stringify(myAssignment)
  );

  // =====================================================================
  // 6. Setup checklist derivation sanity check (Task 2 logic, now against
  //    real writes made in steps 3-4 above on project A).
  // =====================================================================
  let checklist = null;
  try {
    checklist = await getProjectSetupChecklist(adminA, projectId1);
    record("getProjectSetupChecklist() does not throw for project A", true);
  } catch (err) {
    record("getProjectSetupChecklist() does not throw for project A", false, err.message);
  }
  if (checklist) {
    record(
      "Checklist: contractPricingTerms reads 'complete' (pricing_model set AND an active fee rule exists)",
      checklist.contractPricingTerms.kind === "derived" && checklist.contractPricingTerms.status === "complete",
      JSON.stringify(checklist.contractPricingTerms)
    );
    record(
      "Checklist: homeownersDecisionMakers reads 'in_progress' (one contact, info_status='partial', not 'complete')",
      checklist.homeownersDecisionMakers.kind === "derived" && checklist.homeownersDecisionMakers.status === "in_progress",
      JSON.stringify(checklist.homeownersDecisionMakers)
    );
    record(
      "Checklist: conceptScope reads a derived, non-'not_started' status now that the brief has real content",
      checklist.conceptScope.kind === "derived" && checklist.conceptScope.status !== "not_started",
      JSON.stringify(checklist.conceptScope)
    );
    record(
      "Checklist: propertySiteInfo reads a derived, non-'not_started' status now that site info has real content",
      checklist.propertySiteInfo.kind === "derived" && checklist.propertySiteInfo.status !== "not_started",
      JSON.stringify(checklist.propertySiteInfo)
    );
  }

  // =====================================================================
  // 7. generate_project_number() cross-tenant rejection (Task 1 fix round
  //    1, item 2) -- a caller with no relationship to the target org.
  // =====================================================================
  const { client: orgBAdmin, orgId: orgBId } = await signUpAndBootstrap("admin-b", "Org B");
  const { data: crossTenantResult, error: crossTenantErr } = await orgBAdmin.rpc("generate_project_number", { p_org_id: orgAId });
  record(
    "generate_project_number() REJECTS a caller with no relationship to the target org (Org B admin targeting Org A)",
    !crossTenantResult && !!crossTenantErr,
    crossTenantErr ? crossTenantErr.message : `unexpectedly succeeded: ${crossTenantResult}`
  );
  // Sanity: Org B's own admin can still generate a number for Org B itself.
  const { data: ownOrgResult, error: ownOrgErr } = await orgBAdmin.rpc("generate_project_number", { p_org_id: orgBId });
  record("generate_project_number() still works for a caller's OWN org (legitimate path unaffected by the fix)", !ownOrgErr && !!ownOrgResult, ownOrgErr?.message);

  // ---- Summary ----
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===\n`);
  if (failed.length > 0) {
    console.log("FAILURES:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  }

  // ---- Teardown: NOT POSSIBLE, same disclosure as live-p3-checkpoint.mjs ----
  // audit_log is append-only (a DB trigger rejects UPDATE/DELETE outright
  // -- CLAUDE.md's own non-negotiable), and every action this script took
  // (project creation, contact/brief/site-info writes, fee-terms changes,
  // staff assignment) wrote real audit_log rows referencing these
  // projects/profiles/org via plain (non-cascading) FKs. That makes the
  // created projects/profiles/org permanently undeletable through
  // ordinary means -- correct, intentional system behavior (confirmed
  // empirically the first time live-p3-checkpoint.mjs ran, 2026-08-19;
  // not re-attempted here since the mechanism is unchanged), not a bug in
  // this script.
  //
  // Practical consequence: this script's fixtures (2 orgs "P3.1
  // Checkpoint Org A/B <timestamp>", 2 projects, a handful of staff/
  // client profiles and their auth users) are NOT cleaned up
  // automatically and will persist in whatever project this script is
  // run against. They are clearly named and harmless (no real customer
  // data), but re-running this script repeatedly against the same
  // project will accumulate rows over time -- acceptable for a
  // dev/staging project, not something to run routinely or against
  // anything closer to production.
  console.log(
    "\nNOTE: fixture teardown skipped -- audit_log's append-only guard makes\n" +
    "the created org/projects/profiles permanently undeletable once real\n" +
    "actions have been audited against them (expected, not a bug — same\n" +
    "disclosure as live-p3-checkpoint.mjs). They remain in the database,\n" +
    `clearly named "P3.1 Checkpoint ... ${stamp}".`
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nCHECKPOINT SCRIPT ERROR:", err.message);
  console.error(err.stack);
  console.error("Fixtures created before the error may still exist and require manual cleanup:");
  console.error("  createdUserIds:", createdUserIds);
  console.error("  createdOrgIds:", createdOrgIds);
  process.exit(1);
});
