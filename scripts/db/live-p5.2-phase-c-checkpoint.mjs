#!/usr/bin/env node
// Checkpoint for P5.2 Phase C (vendor bid submission/revision history,
// vendor-submitted Q&A, addendum acknowledgment tracking). Proves
// schema/026_vendor_bid_submission_revisions_qa_addenda.sql end-to-end
// against the real hosted dev project, using the exact same service
// functions the app's own Server Actions/pages call (bidService.ts's
// submitVendorBid/getVendorOwnBidSubmission/listBidSubmissionRevisions/
// askVendorBidQuestion/acknowledgeBidAddendum/
// listBidAddendumAcknowledgments/getVendorBidAddendumAcknowledgments),
// matching Phase A/B's own established checkpoint pattern exactly.
//
// Staff side: signs in as the established p3-preview-admin@example.com
// test account. Vendor side: creates two DISTINCT, clearly-named real
// Supabase Auth accounts ("P5.2-PHASEC-TEST Vendor A" / "...Vendor B"),
// deleted in cleanup() below.
//
// Usage: node scripts/db/live-p5.2-phase-c-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from apps/web/.env.local if present).

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
  getBidPackageDetail,
  submitVendorBid,
  getVendorOwnBidSubmission,
  listBidSubmissionRevisions,
  askVendorBidQuestion,
  listVendorVisibleBidQuestions,
  answerBidQuestion,
  issueBidAddendum,
  acknowledgeBidAddendum,
  listBidAddendumAcknowledgments,
  getVendorBidAddendumAcknowledgments,
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
const STAFF_PASSWORD = "REDACTED-ROTATED-CREDENTIAL";

const VENDOR_A_EMAIL = `p522-phasec-test-vendor-a-${stamp}@example.com`;
const VENDOR_B_EMAIL = `p522-phasec-test-vendor-b-${stamp}@example.com`;
const VENDOR_PASSWORD = "P522PhaseC-Test-Password-123!";

async function main() {
  // ---- Staff setup ----
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
      name: `P5.2-PHASEC-TEST Project ${stamp}`,
      project_number: `P522PC-${stamp}`,
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
    .limit(2);
  record("Two real cost codes exist on the project", !costCodesErr && (costCodes?.length ?? 0) === 2, costCodesErr?.message);
  const [costCodeForPkg1, costCodeForPkg2] = costCodes ?? [];

  // ---- Two distinct vendor companies, two bid packages in the SAME project ----
  const { data: vendorA, error: vendorAErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASEC-TEST Vendor A ${stamp}`, email: VENDOR_A_EMAIL })
    .select("id")
    .single();
  record("Vendor A created", !vendorAErr && !!vendorA, vendorAErr?.message);
  if (vendorA) createdVendorIds.push(vendorA.id);

  const { data: vendorB, error: vendorBErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASEC-TEST Vendor B ${stamp}`, email: VENDOR_B_EMAIL })
    .select("id")
    .single();
  record("Vendor B created", !vendorBErr && !!vendorB, vendorBErr?.message);
  if (vendorB) createdVendorIds.push(vendorB.id);

  // Package 1: where vendor A will submit/revise and ask a question and
  // acknowledge an addendum. Created 'draft' first, published below via
  // the real publishBidPackage() service function.
  const { data: package1, error: package1Err } = await staff
    .from("bid_packages")
    .insert({ project_id: project.id, cost_code_id: costCodeForPkg1.id, title: `P5.2-PHASEC-TEST Package 1 ${stamp}`, status: "draft" })
    .select("id")
    .single();
  record("Bid package 1 created (draft)", !package1Err && !!package1, package1Err?.message);
  const publish1 = await publishBidPackage(staff, package1.id);
  record("Bid package 1 published", !publish1.error, publish1.error);

  // Package 2: vendor B's own package, used for cross-vendor isolation checks.
  const { data: package2, error: package2Err } = await staff
    .from("bid_packages")
    .insert({ project_id: project.id, cost_code_id: costCodeForPkg2.id, title: `P5.2-PHASEC-TEST Package 2 ${stamp}`, status: "draft" })
    .select("id")
    .single();
  record("Bid package 2 created (draft)", !package2Err && !!package2, package2Err?.message);
  const publish2 = await publishBidPackage(staff, package2.id);
  record("Bid package 2 published", !publish2.error, publish2.error);

  // A THIRD package, immediately cancelled, to prove a closed package
  // rejects a new submission with real data (not just the SQL suite).
  const { data: package3, error: package3Err } = await staff
    .from("bid_packages")
    .insert({ project_id: project.id, cost_code_id: costCodeForPkg1.id, title: `P5.2-PHASEC-TEST Package 3 (cancelled) ${stamp}`, status: "published" })
    .select("id")
    .single();
  record("Bid package 3 created (published)", !package3Err && !!package3, package3Err?.message);
  const { error: cancelErr } = await staff.from("bid_packages").update({ status: "cancelled" }).eq("id", package3.id);
  record("Bid package 3 cancelled", !cancelErr, cancelErr?.message);

  const inviteA1 = await inviteVendor(staff, package1.id, vendorA.id);
  record("inviteVendor(package1, vendorA) returns a real access token", !inviteA1.error && !!inviteA1.accessToken, inviteA1.error);

  const inviteA3 = await inviteVendor(staff, package3.id, vendorA.id);
  record("inviteVendor(package3 [cancelled], vendorA) returns a real access token", !inviteA3.error && !!inviteA3.accessToken, inviteA3.error);

  const inviteB2 = await inviteVendor(staff, package2.id, vendorB.id);
  record("inviteVendor(package2, vendorB) returns a real access token", !inviteB2.error && !!inviteB2.accessToken, inviteB2.error);

  const vendorAClient = freshClient();
  const { data: vendorASignUp, error: vendorASignUpErr } = await vendorAClient.auth.signUp({ email: VENDOR_A_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor A real Supabase Auth sign-up", !vendorASignUpErr && !!vendorASignUp.user, vendorASignUpErr?.message);
  if (vendorASignUp?.user) createdUserIds.push(vendorASignUp.user.id);
  const { error: acceptA1Err } = await vendorAClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteA1.accessToken,
    p_full_name: "P5.2-PHASEC-TEST Vendor A Contact",
  });
  record("Vendor A accept_vendor_bid_invitation() (package 1) succeeds", !acceptA1Err, acceptA1Err?.message);
  const { error: acceptA3Err } = await vendorAClient.rpc("accept_vendor_bid_invitation", { p_token: inviteA3.accessToken, p_full_name: null });
  record("Vendor A accept_vendor_bid_invitation() (package 3) succeeds", !acceptA3Err, acceptA3Err?.message);

  const vendorBClient = freshClient();
  const { data: vendorBSignUp, error: vendorBSignUpErr } = await vendorBClient.auth.signUp({ email: VENDOR_B_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor B real Supabase Auth sign-up", !vendorBSignUpErr && !!vendorBSignUp.user, vendorBSignUpErr?.message);
  if (vendorBSignUp?.user) createdUserIds.push(vendorBSignUp.user.id);
  const { error: acceptB2Err } = await vendorBClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteB2.accessToken,
    p_full_name: "P5.2-PHASEC-TEST Vendor B Contact",
  });
  record("Vendor B accept_vendor_bid_invitation() (package 2) succeeds", !acceptB2Err, acceptB2Err?.message);

  // ======================================================================
  // Bid submission + revision, full history, cross-vendor isolation
  // ======================================================================
  const vendorASubmission1 = await getVendorOwnBidSubmission(vendorAClient, package1.id);
  record("Vendor A can read its own (invited) bid_submissions row on package 1", !!vendorASubmission1 && vendorASubmission1.status === "invited", JSON.stringify(vendorASubmission1));

  const submitResult1 = await submitVendorBid(vendorAClient, vendorASubmission1.id, 4_200_00, "Base bid, per plans dated 2026-08-01.");
  record("Vendor A's FIRST submission (submitVendorBid) succeeds", !submitResult1.error && !!submitResult1.revisionId, submitResult1.error);

  const submitResult2 = await submitVendorBid(vendorAClient, vendorASubmission1.id, 3_985_00, "Revised — value-engineered the flashing detail.");
  record("Vendor A's REVISION (second submitVendorBid call) succeeds", !submitResult2.error && submitResult2.revisionId !== submitResult1.revisionId, submitResult2.error);

  const vendorARevisions = await listBidSubmissionRevisions(vendorAClient, vendorASubmission1.id);
  record("Vendor A's own revision history has exactly 2 rows, never overwritten", vendorARevisions.length === 2, JSON.stringify(vendorARevisions));
  record(
    "The full historical sequence of amounts is intact (4200.00 then 3985.00), oldest first",
    vendorARevisions[0]?.amountCents === 420000 && vendorARevisions[1]?.amountCents === 398500,
    JSON.stringify(vendorARevisions.map((r) => r.amountCents))
  );

  const detailAsStaff1 = await getBidPackageDetail(staff, package1.id);
  const staffSeenSubmission = detailAsStaff1?.submissions.find((s) => s.vendorId === vendorA.id);
  record("Staff getBidPackageDetail() reflects the LATEST amount (current-state row unchanged in shape)", staffSeenSubmission?.amountCents === 398500, JSON.stringify(staffSeenSubmission));
  record("Staff getBidPackageDetail() embeds the FULL revision history for this vendor, not just the latest", staffSeenSubmission?.revisions.length === 2, JSON.stringify(staffSeenSubmission?.revisions));

  // Cross-vendor isolation: vendor B cannot read vendor A's pricing history at all.
  const vendorBReadOfARevisions = await listBidSubmissionRevisions(vendorBClient, vendorASubmission1.id);
  record("Vendor B reads ZERO of vendor A's revision rows — pricing isolation holds with real data", vendorBReadOfARevisions.length === 0, JSON.stringify(vendorBReadOfARevisions));

  const vendorBSubmitOnA = await submitVendorBid(vendorBClient, vendorASubmission1.id, 1, null);
  record("Vendor B cannot submit a revision against vendor A's own bid_submissions row (RLS/trigger rejects)", !!vendorBSubmitOnA.error, vendorBSubmitOnA.error);

  // A closed (cancelled) package rejects a new submission with real data.
  const vendorASubmission3 = await getVendorOwnBidSubmission(vendorAClient, package3.id);
  record("Vendor A can read its (invited) submission on the now-cancelled package 3", !!vendorASubmission3, JSON.stringify(vendorASubmission3));
  const closedPackageSubmit = await submitVendorBid(vendorAClient, vendorASubmission3.id, 100_00, null);
  record("Submitting against a CANCELLED package is rejected — package-closed enforcement proven live", !!closedPackageSubmit.error, closedPackageSubmit.error);

  // ======================================================================
  // Vendor-submitted questions, private-by-default, staff answers
  // ======================================================================
  const askResult = await askVendorBidQuestion(vendorAClient, package1.id, vendorA.id, "Which sheet governs — A-4 or A-5?");
  record("Vendor A's askVendorBidQuestion() succeeds", !askResult.error, askResult.error);

  const vendorAQuestions = await listVendorVisibleBidQuestions(vendorAClient, package1.id);
  const askedQuestion = vendorAQuestions.find((q) => q.questionText === "Which sheet governs — A-4 or A-5?");
  record("Vendor A can see its own question", !!askedQuestion, JSON.stringify(vendorAQuestions));

  const vendorBQuestionsOnPackage1 = await listVendorVisibleBidQuestions(vendorBClient, package1.id);
  record("Vendor B (different package) sees ZERO of package 1's Q&A, including vendor A's private question", vendorBQuestionsOnPackage1.length === 0, JSON.stringify(vendorBQuestionsOnPackage1));

  const answerResult = askedQuestion ? await answerBidQuestion(staff, askedQuestion.id, "A-5 governs; A-4 is superseded.") : { error: "no question id" };
  record("Staff answerBidQuestion() on the vendor-submitted question succeeds", !answerResult.error, answerResult.error);

  const vendorAQuestionsAfterAnswer = await listVendorVisibleBidQuestions(vendorAClient, package1.id);
  const answeredQuestion = vendorAQuestionsAfterAnswer.find((q) => q.questionText === "Which sheet governs — A-4 or A-5?");
  record("Vendor A sees the staff answer to its own question", answeredQuestion?.answerText === "A-5 governs; A-4 is superseded.", JSON.stringify(answeredQuestion));

  const vendorEpsilonAskOnPackage1 = await askVendorBidQuestion(vendorBClient, package1.id, vendorB.id, "I was never invited to this package");
  record("Vendor B cannot ask a question on package 1 (not invited there)", !!vendorEpsilonAskOnPackage1.error, vendorEpsilonAskOnPackage1.error);

  // ======================================================================
  // Addendum acknowledgment tracking
  // ======================================================================
  const addendumResult = await issueBidAddendum(staff, package1.id, "Addendum 1 — Roof pitch correction", "The roof pitch on sheet A-3 is corrected from 6:12 to 8:12.");
  record("issueBidAddendum() succeeds", !addendumResult.error, addendumResult.error);

  const staffAckListBefore = await listBidAddendumAcknowledgments(staff, package1.id);
  record("Staff sees ZERO acknowledgments before anyone acknowledges", staffAckListBefore.length === 0, JSON.stringify(staffAckListBefore));

  const { listVendorVisibleBidAddenda } = require("../../packages/02-app-shell/src/services/bidService.ts");
  const addendaAsVendorA = await listVendorVisibleBidAddenda(vendorAClient, package1.id);
  const theAddendum = addendaAsVendorA.find((a) => a.title === "Addendum 1 — Roof pitch correction");
  record("Vendor A can see the real addendum", !!theAddendum, JSON.stringify(addendaAsVendorA));

  const ackResult = theAddendum ? await acknowledgeBidAddendum(vendorAClient, theAddendum.id, vendorA.id) : { error: "no addendum id" };
  record("Vendor A's acknowledgeBidAddendum() succeeds", !ackResult.error, ackResult.error);

  const duplicateAck = theAddendum ? await acknowledgeBidAddendum(vendorAClient, theAddendum.id, vendorA.id) : { error: "no addendum id" };
  record("A duplicate acknowledgment by the same vendor is rejected (real unique constraint)", !!duplicateAck.error, duplicateAck.error);

  const impersonationAck = theAddendum ? await acknowledgeBidAddendum(vendorBClient, theAddendum.id, vendorA.id) : { error: "no addendum id" };
  record("Vendor B cannot acknowledge on behalf of vendor A's vendor_id (impersonation rejected)", !!impersonationAck.error, impersonationAck.error);

  const wrongPackageAck = theAddendum ? await acknowledgeBidAddendum(vendorBClient, theAddendum.id, vendorB.id) : { error: "no addendum id" };
  record("Vendor B cannot acknowledge an addendum on a package it was never invited to", !!wrongPackageAck.error, wrongPackageAck.error);

  const vendorAAcks = theAddendum ? await getVendorBidAddendumAcknowledgments(vendorAClient, package1.id) : [];
  record("Vendor A sees its own acknowledgment with a real timestamp", vendorAAcks.some((a) => a.bidAddendumId === theAddendum?.id && !!a.acknowledgedAt), JSON.stringify(vendorAAcks));

  const vendorBAcksOnPackage1 = theAddendum ? await getVendorBidAddendumAcknowledgments(vendorBClient, package1.id) : [];
  record("Vendor B (different package) sees ZERO acknowledgments on package 1's addendum", vendorBAcksOnPackage1.length === 0, JSON.stringify(vendorBAcksOnPackage1));

  const staffAckListAfter = theAddendum ? await listBidAddendumAcknowledgments(staff, package1.id) : [];
  record(
    "Staff sees the real acknowledgment, correctly attributed to vendor A",
    staffAckListAfter.some((a) => a.bidAddendumId === theAddendum?.id && a.vendorName === `P5.2-PHASEC-TEST Vendor A ${stamp}`),
    JSON.stringify(staffAckListAfter)
  );
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable P5.2 Phase C checkpoint data) ---");
  for (const projectId of createdProjectIds) {
    const { error: deleteErr } = await admin.from("projects").delete().eq("id", projectId);
    if (deleteErr) console.warn(`  project ${projectId} could not be deleted (${deleteErr.message}) — left in place, clearly named P5.2-PHASEC-TEST.`);
  }
  for (const vendorId of createdVendorIds) {
    const { error: deleteErr } = await admin.from("vendors").delete().eq("id", vendorId);
    if (deleteErr) console.warn(`  vendor ${vendorId} could not be deleted (${deleteErr.message}) — left in place, clearly named P5.2-PHASEC-TEST.`);
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
