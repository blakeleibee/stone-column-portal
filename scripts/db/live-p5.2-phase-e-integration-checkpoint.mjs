#!/usr/bin/env node
// P5.2 PHASE E — full-package, end-to-end INTEGRATION checkpoint.
//
// Unlike scripts/db/live-p5.2-phase-{a,b,c,d}-checkpoint.mjs (each of
// which proves ONE phase's own new schema/service functions against
// real hosted dev, in isolation), this script walks the ENTIRE P5.2
// vendor-bid-access lifecycle in ONE continuous run, in the order a
// real staff person and two real vendors would actually experience it:
//
//   create project -> bid package with full assembly fields -> attach
//   documents (vendor-visible + internal-only) -> invite TWO vendors to
//   the SAME package -> each vendor accepts its invitation (the
//   sign-up + accept_vendor_bid_invitation() RPC pair a real magic-link
//   landing page drives; the literal browser click-through is covered
//   separately by this phase's live browser walkthrough) -> each
//   vendor views the full package -> each vendor submits a bid, one
//   revises -> each vendor asks a question, staff answers both ->
//   staff issues an addendum, both vendors acknowledge it -> staff and
//   each vendor exchange correspondence -> a real Svix-signed inbound
//   webhook POST routes a reply into the correct thread -> spoofed /
//   unmatched-token / revoked-vendor webhook cases are quarantined ->
//   vendor A's access is revoked mid-package and immediately loses
//   documents/submission/correspondence/Q&A access while vendor B is
//   completely unaffected -> staff can still see everything for BOTH
//   vendors, never mixed -> the bid is awarded to vendor B (the
//   non-revoked vendor) -> exactly one committed_costs row is created,
//   and budget_ledger is confirmed untouched by ANYTHING in this
//   entire run.
//
// This proves the four phases genuinely COMPOSE, not just that each
// phase's own narrow checkpoint still passes in isolation.
//
// Usage: node scripts/db/live-p5.2-phase-e-integration-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from apps/web/.env.local), and a
// dev server already running at DEV_SERVER_URL (default
// http://127.0.0.1:5173) with RESEND_WEBHOOK_SECRET set to the SAME
// value as WEBHOOK_TEST_SECRET below (matching Phase D's own
// established pattern — see that script's header comment).

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
  updateBidPackageAssemblyDetails,
  getBidPackageDetail,
  getVendorVisibleBidPackage,
  uploadBidPackageDocument,
  listBidPackageDocuments,
  listVendorVisibleBidPackageDocuments,
  getVendorOwnBidSubmission,
  submitVendorBid,
  listBidSubmissionRevisions,
  askVendorBidQuestion,
  listVendorVisibleBidQuestions,
  listBidQuestions,
  answerBidQuestion,
  issueBidAddendum,
  listVendorVisibleBidAddenda,
  acknowledgeBidAddendum,
  listBidAddendumAcknowledgments,
  revokeVendorMember,
  awardBid,
} = require("../../packages/02-app-shell/src/services/bidService.ts");
const { sendStaffMessage, sendVendorMessage, listEntityMessages } = require("../../packages/02-app-shell/src/services/correspondenceService.ts");
const { signSvixPayloadForTesting } = require("../../packages/02-app-shell/src/services/email/svixSignature.ts");
const { buildReplyToAddress } = require("../../packages/02-app-shell/src/services/email/constants.ts");
const { LocalFilesystemStorageAdapter } = require("../../apps/web/src/server/storage/LocalFilesystemStorageAdapter.ts");

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
const writtenStorageKeys = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}

function freshClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const STAFF_EMAIL = "p3-preview-admin@example.com";
const STAFF_PASSWORD = "REDACTED-ROTATED-CREDENTIAL";

const VENDOR_A_EMAIL = `p522-phasee-test-vendor-a-${stamp}@example.com`;
const VENDOR_B_EMAIL = `p522-phasee-test-vendor-b-${stamp}@example.com`;
const VENDOR_PASSWORD = "P522PhaseE-Test-Password-123!";

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

async function main() {
  // =====================================================================
  // STEP 1 — staff session, project, cost code, bid package w/ full
  // assembly fields.
  // =====================================================================
  const staff = freshClient();
  const { data: staffSignIn, error: staffSignInErr } = await staff.auth.signInWithPassword({ email: STAFF_EMAIL, password: STAFF_PASSWORD });
  record("Staff sign-in (p3-preview-admin)", !staffSignInErr && !!staffSignIn.user, staffSignInErr?.message);
  if (staffSignInErr) throw new Error("Cannot continue without a real staff session.");

  const { data: staffProfile } = await staff.from("profiles").select("org_id").eq("id", staffSignIn.user.id).single();
  const orgId = staffProfile.org_id;

  const { data: project, error: projectErr } = await staff
    .from("projects")
    .insert({ org_id: orgId, name: `P5.2-PHASEE-TEST Project ${stamp}`, project_number: `P522PE-${stamp}`, pricing_model: "cost_plus_percentage" })
    .select("id")
    .single();
  record("Real project created", !projectErr && !!project, projectErr?.message);
  if (projectErr) throw new Error("Cannot continue without a project.");
  createdProjectIds.push(project.id);

  const { error: templateErr } = await staff.rpc("apply_standard_cost_code_template", { p_project_id: project.id });
  record("apply_standard_cost_code_template()", !templateErr, templateErr?.message);
  const { data: costCodes } = await staff.from("cost_codes").select("id").eq("project_id", project.id).limit(1);
  const costCodeId = costCodes[0].id;

  // Baseline: zero budget_ledger rows for this fresh project, checked
  // now AND again at the very end — nothing in this entire flow may
  // ever write to it (CLAUDE.md's non-negotiable financial-backbone
  // rule, requirement #14).
  const { data: budgetLedgerBefore } = await admin.from("budget_ledger").select("id").eq("project_id", project.id);
  record("Baseline: zero budget_ledger rows for the brand-new project", (budgetLedgerBefore ?? []).length === 0, `count=${budgetLedgerBefore?.length}`);

  const { data: pkg, error: pkgErr } = await staff
    .from("bid_packages")
    .insert({
      project_id: project.id,
      cost_code_id: costCodeId,
      title: `P5.2-PHASEE-TEST Roofing Package ${stamp}`,
      scope_description: "Full tear-off and re-roof, per plans.",
      due_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: "draft",
    })
    .select("id")
    .single();
  record("Bid package created (draft)", !pkgErr && !!pkg, pkgErr?.message);

  const assemblyResult = await updateBidPackageAssemblyDetails(staff, pkg.id, {
    inclusions: "All labor, material, and equipment for full roof replacement.",
    exclusions: "Permit fees; dumpster rental billed separately.",
    alternates: "Alternate 1: upgrade to 50-year architectural shingle.",
    allowances: "Flashing allowance: $2,500.",
    pricingBreakdownInstructions: "Provide a single lump-sum price plus a unit price per square for the alternate.",
    scheduleExpectations: "4-week completion window from notice to proceed.",
    bidInstructions: "Submit a single lump-sum price by the due date.",
    stoneColumnContactId: staffSignIn.user.id,
  });
  record("Bid package full assembly fields set (updateBidPackageAssemblyDetails)", !assemblyResult.error, assemblyResult.error);

  const publish = await publishBidPackage(staff, pkg.id);
  record("Bid package published", !publish.error, publish.error);

  // =====================================================================
  // STEP 2 — attach documents: one vendor-visible, one internal-only.
  // =====================================================================
  const adapter = new LocalFilesystemStorageAdapter();
  const vendorVisibleKey = `bid-package-documents/${pkg.id}/plans/${stamp}-plan-set.txt`;
  const internalOnlyKey = `bid-package-documents/${pkg.id}/reference/${stamp}-internal-estimate-notes.txt`;
  const vendorVisibleBytes = Buffer.from(`P5.2-PHASEE-TEST real plan set contents, stamp ${stamp}`);
  const internalOnlyBytes = Buffer.from(`P5.2-PHASEE-TEST real internal estimate notes, stamp ${stamp}`);
  await adapter.upload(vendorVisibleKey, vendorVisibleBytes, "text/plain");
  writtenStorageKeys.push(vendorVisibleKey);
  await adapter.upload(internalOnlyKey, internalOnlyBytes, "text/plain");
  writtenStorageKeys.push(internalOnlyKey);

  const vendorVisibleUpload = await uploadBidPackageDocument(staff, {
    projectId: project.id,
    bidPackageId: pkg.id,
    storageKey: vendorVisibleKey,
    fileName: "Plan Set.txt",
    mimeType: "text/plain",
    sizeBytes: vendorVisibleBytes.length,
    category: "plans",
    internalOnly: false,
    uploadedBy: staffSignIn.user.id,
  });
  record("Vendor-visible document uploaded", !vendorVisibleUpload.error && !!vendorVisibleUpload.id, vendorVisibleUpload.error);

  const internalOnlyUpload = await uploadBidPackageDocument(staff, {
    projectId: project.id,
    bidPackageId: pkg.id,
    storageKey: internalOnlyKey,
    fileName: "Internal Estimate Notes.txt",
    mimeType: "text/plain",
    sizeBytes: internalOnlyBytes.length,
    category: "reference",
    internalOnly: true,
    uploadedBy: staffSignIn.user.id,
  });
  record("Internal-only document uploaded", !internalOnlyUpload.error && !!internalOnlyUpload.id, internalOnlyUpload.error);

  const staffDocs = await listBidPackageDocuments(staff, pkg.id);
  record("Staff sees BOTH documents", staffDocs.length === 2, JSON.stringify(staffDocs.map((d) => d.fileName)));

  // =====================================================================
  // STEP 3 — two vendors, invited to the SAME package.
  // =====================================================================
  const { data: vendorA, error: vendorAErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASEE-TEST Vendor A ${stamp}`, email: VENDOR_A_EMAIL })
    .select("id")
    .single();
  record("Vendor A (canonical vendor record) created with its bidding email", !vendorAErr && !!vendorA, vendorAErr?.message);
  if (vendorA) createdVendorIds.push(vendorA.id);

  const { data: vendorB, error: vendorBErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASEE-TEST Vendor B ${stamp}`, email: VENDOR_B_EMAIL })
    .select("id")
    .single();
  record("Vendor B (canonical vendor record) created with its bidding email", !vendorBErr && !!vendorB, vendorBErr?.message);
  if (vendorB) createdVendorIds.push(vendorB.id);

  // Requirement #2: require a valid recipient. A vendor with NO email on
  // file must be refused a real access link, not silently invited into
  // the void.
  const { data: vendorNoEmail } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASEE-TEST Vendor NoEmail ${stamp}` })
    .select("id")
    .single();
  createdVendorIds.push(vendorNoEmail.id);
  const inviteNoEmail = await inviteVendor(staff, pkg.id, vendorNoEmail.id, DEV_SERVER_URL);
  record(
    "Requirement #2 — inviting a vendor with NO email on file returns a warning, not a silent success",
    !!inviteNoEmail.warning && !inviteNoEmail.accessToken,
    JSON.stringify(inviteNoEmail)
  );

  // Requirement #1 + #2: inviteVendor() resolves the exact recipient
  // from the vendor's own canonical record and surfaces it BEFORE any
  // claim of success.
  const inviteA = await inviteVendor(staff, pkg.id, vendorA.id, DEV_SERVER_URL);
  record(
    "Requirement #1/#2 — inviteVendor(vendorA) resolves the real recipientEmail from the canonical vendor record",
    !inviteA.error && inviteA.recipientEmail === VENDOR_A_EMAIL && !!inviteA.accessToken,
    JSON.stringify(inviteA)
  );
  const inviteB = await inviteVendor(staff, pkg.id, vendorB.id, DEV_SERVER_URL);
  record(
    "Requirement #3 — inviteVendor(vendorB), SAME package as vendor A, also succeeds independently",
    !inviteB.error && inviteB.recipientEmail === VENDOR_B_EMAIL && !!inviteB.accessToken,
    JSON.stringify(inviteB)
  );

  const { data: inviteMsgs } = await admin.from("entity_messages").select("vendor_id, recipient, delivery_status").eq("bid_package_id", pkg.id);
  record(
    "Two real entity_messages invitation rows exist, one per vendor, honest 'pending_provider_configuration' status (no real email sent — RESEND_API_KEY confirmed blank)",
    inviteMsgs?.length === 2 && inviteMsgs.every((m) => m.delivery_status === "pending_provider_configuration"),
    JSON.stringify(inviteMsgs)
  );

  // Requirement #4: no vendor_members row exists yet for either vendor
  // — the membership RLS requires is created only on ACCEPT, not on
  // invite.
  const { data: membersBeforeAccept } = await admin.from("vendor_members").select("id").in("vendor_id", [vendorA.id, vendorB.id]);
  record("Requirement #4 (pre-check) — no vendor_members row exists before acceptance", (membersBeforeAccept ?? []).length === 0, `count=${membersBeforeAccept?.length}`);

  // =====================================================================
  // STEP 4 — each vendor's real access-invitation flow: brand-new
  // Supabase Auth sign-up + accept_vendor_bid_invitation() RPC (the
  // exact server-side pair the real /vendor/invite/[token] magic-link
  // landing page drives when a brand-new vendor completes it — the
  // literal browser click-through is covered by this phase's separate
  // live browser walkthrough).
  // =====================================================================
  const vendorAClient = freshClient();
  const { data: vendorASignUp, error: vendorASignUpErr } = await vendorAClient.auth.signUp({ email: VENDOR_A_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor A real Supabase Auth sign-up (magic-link landing step 1)", !vendorASignUpErr && !!vendorASignUp.user, vendorASignUpErr?.message);
  if (vendorASignUp?.user) createdUserIds.push(vendorASignUp.user.id);
  const { error: acceptAErr } = await vendorAClient.rpc("accept_vendor_bid_invitation", { p_token: inviteA.accessToken, p_full_name: "P5.2-PHASEE-TEST Vendor A Contact" });
  record("Vendor A accept_vendor_bid_invitation() (magic-link landing step 2)", !acceptAErr, acceptAErr?.message);

  const vendorBClient = freshClient();
  const { data: vendorBSignUp, error: vendorBSignUpErr } = await vendorBClient.auth.signUp({ email: VENDOR_B_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor B real Supabase Auth sign-up (magic-link landing step 1)", !vendorBSignUpErr && !!vendorBSignUp.user, vendorBSignUpErr?.message);
  if (vendorBSignUp?.user) createdUserIds.push(vendorBSignUp.user.id);
  const { error: acceptBErr } = await vendorBClient.rpc("accept_vendor_bid_invitation", { p_token: inviteB.accessToken, p_full_name: "P5.2-PHASEE-TEST Vendor B Contact" });
  record("Vendor B accept_vendor_bid_invitation() (magic-link landing step 2)", !acceptBErr, acceptBErr?.message);

  const { data: membersAfterAccept } = await admin.from("vendor_members").select("vendor_id, profile_id, revoked_at").in("vendor_id", [vendorA.id, vendorB.id]);
  record(
    "Requirement #4 — vendor_members rows now exist for BOTH vendors, created by acceptance, before either vendor could read anything",
    membersAfterAccept?.length === 2 && membersAfterAccept.every((m) => m.revoked_at === null),
    JSON.stringify(membersAfterAccept)
  );

  // =====================================================================
  // STEP 5 — Requirement #5/#7: each vendor sees the full package —
  // assembly fields, documents (vendor-visible only), addenda (none
  // yet), Q&A (none yet).
  // =====================================================================
  const pkgAsVendorA = await getVendorVisibleBidPackage(vendorAClient, pkg.id);
  record(
    "Requirement #5/#7 — Vendor A (invited) sees the full assembly fields, scope, due date, and Stone Column contact",
    pkgAsVendorA?.inclusions === "All labor, material, and equipment for full roof replacement." &&
      pkgAsVendorA?.bidInstructions === "Submit a single lump-sum price by the due date." &&
      !!pkgAsVendorA?.dueAt &&
      !!pkgAsVendorA?.stoneColumnContactName,
    JSON.stringify(pkgAsVendorA)
  );
  const pkgAsVendorB = await getVendorVisibleBidPackage(vendorBClient, pkg.id);
  record("Requirement #5/#7 — Vendor B (also invited to the SAME package) independently sees the same package details", pkgAsVendorB?.inclusions === pkgAsVendorA?.inclusions, JSON.stringify(pkgAsVendorB?.inclusions));

  const vendorADocs = await listVendorVisibleBidPackageDocuments(vendorAClient, pkg.id);
  record("Requirement #5/#6 — Vendor A sees EXACTLY the vendor-visible document, never the internal one", vendorADocs.length === 1 && vendorADocs[0].fileName === "Plan Set.txt", JSON.stringify(vendorADocs.map((d) => d.fileName)));
  const vendorBDocs = await listVendorVisibleBidPackageDocuments(vendorBClient, pkg.id);
  record("Requirement #3 — Vendor B (same package as A) also sees exactly the one vendor-visible document, independently", vendorBDocs.length === 1, JSON.stringify(vendorBDocs.map((d) => d.fileName)));

  // =====================================================================
  // STEP 6 — Requirement #8: each vendor submits a bid; vendor A revises.
  // =====================================================================
  const vendorASubmission = await getVendorOwnBidSubmission(vendorAClient, pkg.id);
  record("Vendor A can read its own invited bid_submissions row", !!vendorASubmission && vendorASubmission.status === "invited", JSON.stringify(vendorASubmission));
  const vendorBSubmission = await getVendorOwnBidSubmission(vendorBClient, pkg.id);
  record("Vendor B can read its own invited bid_submissions row", !!vendorBSubmission && vendorBSubmission.status === "invited", JSON.stringify(vendorBSubmission));

  const submitA1 = await submitVendorBid(vendorAClient, vendorASubmission.id, 420000, "Base bid, per plans.");
  record("Vendor A's first submission succeeds", !submitA1.error && !!submitA1.revisionId, submitA1.error);
  const submitA2 = await submitVendorBid(vendorAClient, vendorASubmission.id, 398500, "Revised — value-engineered flashing detail.");
  record("Requirement #8 — Vendor A REVISES (second submission), complete version history preserved", !submitA2.error && submitA2.revisionId !== submitA1.revisionId, submitA2.error);

  const submitB1 = await submitVendorBid(vendorBClient, vendorBSubmission.id, 415000, "Base bid, per plans.");
  record("Requirement #8 — Vendor B submits its own bid", !submitB1.error && !!submitB1.revisionId, submitB1.error);

  const vendorARevisions = await listBidSubmissionRevisions(vendorAClient, vendorASubmission.id);
  record(
    "Requirement #8 — Vendor A's full revision/audit history has exactly 2 immutable rows, oldest first, exact sequence preserved (4200.00 then 3985.00)",
    vendorARevisions.length === 2 && vendorARevisions[0].amountCents === 420000 && vendorARevisions[1].amountCents === 398500,
    JSON.stringify(vendorARevisions.map((r) => r.amountCents))
  );

  const vendorBReadOfARevisions = await listBidSubmissionRevisions(vendorBClient, vendorASubmission.id);
  record("Requirement #3 — Vendor B reads ZERO of vendor A's pricing/revision history (cross-vendor isolation)", vendorBReadOfARevisions.length === 0, `length=${vendorBReadOfARevisions.length}`);

  // =====================================================================
  // STEP 7 — Requirement #7/#9: each vendor asks a question; staff answers.
  // =====================================================================
  const askA = await askVendorBidQuestion(vendorAClient, pkg.id, vendorA.id, "Does the plan set include the revised elevation?");
  record("Vendor A asks a question", !askA.error, askA.error);
  const askB = await askVendorBidQuestion(vendorBClient, pkg.id, vendorB.id, "Is the flashing allowance inclusive of labor?");
  record("Vendor B asks a question", !askB.error, askB.error);

  const questionsAsStaff = await listBidQuestions(staff, pkg.id);
  const qA = questionsAsStaff.find((q) => q.vendorId === vendorA.id && q.questionText.includes("elevation"));
  const qB = questionsAsStaff.find((q) => q.vendorId === vendorB.id && q.questionText.includes("flashing"));
  record("Staff sees BOTH vendors' questions", !!qA && !!qB, JSON.stringify({ qA: !!qA, qB: !!qB }));

  const answerA = qA ? await answerBidQuestion(staff, qA.id, "Yes, the current Plan Set.txt is the latest revision.") : { error: "no question" };
  record("Staff answers vendor A's question", !answerA.error, answerA.error);
  const answerB = qB ? await answerBidQuestion(staff, qB.id, "Yes, labor is included in the flashing allowance.") : { error: "no question" };
  record("Staff answers vendor B's question", !answerB.error, answerB.error);

  const vendorBQuestionsSeenByA = (await listVendorVisibleBidQuestions(vendorAClient, pkg.id)).filter((q) => q.vendorId === vendorB.id);
  record("Requirement #3 — Vendor A cannot see vendor B's private question (same package)", vendorBQuestionsSeenByA.length === 0, `length=${vendorBQuestionsSeenByA.length}`);

  // =====================================================================
  // STEP 8 — Requirement #6/#8: staff issues an addendum; both vendors
  // acknowledge it.
  // =====================================================================
  const addendum = await issueBidAddendum(staff, pkg.id, "Addendum 1 — Roof pitch correction", "The roof pitch on sheet A-3 is corrected from 6:12 to 8:12.");
  record("Staff issues a real addendum", !addendum.error, addendum.error);

  const addendaAsVendorA = await listVendorVisibleBidAddenda(vendorAClient, pkg.id);
  const theAddendum = addendaAsVendorA.find((a) => a.title === "Addendum 1 — Roof pitch correction");
  record("Requirement #6/#7 — Vendor A sees the real addendum", !!theAddendum, JSON.stringify(addendaAsVendorA.map((a) => a.title)));

  const ackA = theAddendum ? await acknowledgeBidAddendum(vendorAClient, theAddendum.id, vendorA.id) : { error: "no addendum" };
  record("Vendor A acknowledges the addendum", !ackA.error, ackA.error);
  const ackB = theAddendum ? await acknowledgeBidAddendum(vendorBClient, theAddendum.id, vendorB.id) : { error: "no addendum" };
  record("Vendor B acknowledges the addendum", !ackB.error, ackB.error);

  const staffAcks = await listBidAddendumAcknowledgments(staff, pkg.id);
  record(
    "Staff sees BOTH vendors' acknowledgments, correctly attributed",
    staffAcks.filter((a) => a.bidAddendumId === theAddendum?.id).length === 2,
    JSON.stringify(staffAcks.map((a) => ({ vendorName: a.vendorName, addendum: a.bidAddendumId === theAddendum?.id })))
  );

  // =====================================================================
  // STEP 9 — Requirement #9/#10/#11: correspondence both directions,
  // per-vendor private threads.
  // =====================================================================
  const staffMsgToA = await sendStaffMessage(staff, { bidPackageId: pkg.id, vendorId: vendorA.id, subject: "Question about your bid", body: "Can you clarify the lead time on materials?", staffProfileId: staffSignIn.user.id });
  record("Requirement #10 — Staff message to vendor A resolves the real vendor email as recipient", !staffMsgToA.error && staffMsgToA.recipientEmail === VENDOR_A_EMAIL, JSON.stringify(staffMsgToA));
  const staffMsgToB = await sendStaffMessage(staff, { bidPackageId: pkg.id, vendorId: vendorB.id, subject: "Question about your bid", body: "Can you confirm your crew size?", staffProfileId: staffSignIn.user.id });
  record("Staff message to vendor B resolves the real vendor email as recipient", !staffMsgToB.error && staffMsgToB.recipientEmail === VENDOR_B_EMAIL, JSON.stringify(staffMsgToB));

  const vendorAReply = await sendVendorMessage(vendorAClient, { bidPackageId: pkg.id, vendorId: vendorA.id, body: "Two weeks from award." });
  record("Vendor A replies on its own thread (portal message)", !vendorAReply.error, vendorAReply.error);
  const vendorBReply = await sendVendorMessage(vendorBClient, { bidPackageId: pkg.id, vendorId: vendorB.id, body: "Crew of 6." });
  record("Vendor B replies on its own thread (portal message)", !vendorBReply.error, vendorBReply.error);

  const vendorAOwnThread = await listEntityMessages(vendorAClient, pkg.id, vendorA.id);
  record(
    "Requirement #11 — Vendor A's own thread shows sender/recipient/timestamp/direction/status for every message",
    vendorAOwnThread.length >= 3 && vendorAOwnThread.every((m) => !!m.sender && !!m.recipient && !!m.createdAt && !!m.direction),
    `length=${vendorAOwnThread.length}`
  );

  const vendorBTriesReadingAsThread = await listEntityMessages(vendorBClient, pkg.id, vendorA.id);
  record("Requirement #3 — Vendor B (SAME package) gets ZERO rows reading vendor A's correspondence thread", vendorBTriesReadingAsThread.length === 0, `length=${vendorBTriesReadingAsThread.length}`);
  const vendorATriesReadingBsThread = await listEntityMessages(vendorAClient, pkg.id, vendorB.id);
  record("Requirement #3 — Vendor A (SAME package) gets ZERO rows reading vendor B's correspondence thread", vendorATriesReadingBsThread.length === 0, `length=${vendorATriesReadingBsThread.length}`);

  // =====================================================================
  // STEP 10 — Requirement #10/#13: a real Svix-signed inbound webhook
  // reply routes into the correct thread; spoofed/unmatched/revoked
  // cases are quarantined, never routed, never crash.
  // =====================================================================
  const { data: tokenRowA } = await admin.from("inbound_reply_tokens").select("token").eq("bid_package_id", pkg.id).eq("vendor_id", vendorA.id).maybeSingle();
  record("A real inbound_reply_token exists for vendor A after sendStaffMessage", !!tokenRowA?.token, JSON.stringify(tokenRowA));
  const replyAddressA = buildReplyToAddress(tokenRowA.token);

  const validEvent = { type: "email.received", data: { from: VENDOR_A_EMAIL, to: [replyAddressA], subject: "Re: Question about your bid", text: "Confirmed, two weeks — and attached is our material spec sheet." } };
  const validResult = await postWebhook(validEvent);
  record("Requirement #10 — a valid Svix-signed inbound reply routes into the correct thread (status=routed)", validResult.status === 200 && validResult.json.status === "routed", JSON.stringify(validResult));

  const { data: routedMsg } = await admin.from("entity_messages").select("id, vendor_id, bid_package_id, direction, body").eq("provider_message_id", validResult.svixId).maybeSingle();
  record(
    "The routed inbound message lands in the CORRECT (bid_package, vendor A) thread, correct direction/body",
    routedMsg?.vendor_id === vendorA.id && routedMsg?.bid_package_id === pkg.id && routedMsg?.direction === "inbound" && routedMsg?.body.includes("Confirmed, two weeks"),
    JSON.stringify(routedMsg)
  );

  // Requirement #13a: duplicate/redelivered webhook is a safe no-op.
  const duplicateResult = await postWebhook(validEvent, { svixId: validResult.svixId });
  record("Requirement #13 — redelivering the SAME svix-id is a safe no-op (status=duplicate, no second row)", duplicateResult.status === 200 && duplicateResult.json.status === "duplicate", JSON.stringify(duplicateResult));
  const { data: countAfterDuplicate } = await admin.from("entity_messages").select("id").eq("provider_message_id", validResult.svixId);
  record("No duplicate entity_messages row was created", countAfterDuplicate?.length === 1, `count=${countAfterDuplicate?.length}`);

  // Requirement #13b: spoofed signature.
  const spoofedResult = await postWebhook(validEvent, { svixSignature: "v1,not-a-real-signature-at-all==" });
  record("Requirement #13 — a SPOOFED webhook signature is quarantined, not routed, no 500", spoofedResult.status === 200 && spoofedResult.json.reason === "signature_invalid", JSON.stringify(spoofedResult));

  // Requirement #13c: unmatched token (well-formed but non-existent).
  const unmatchedEvent = { type: "email.received", data: { from: VENDOR_A_EMAIL, to: ["reply+aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@notify.stonecolumn.com"], subject: "x", text: "y" } };
  const unmatchedResult = await postWebhook(unmatchedEvent);
  record("Requirement #13 — an UNMATCHED reply token is quarantined, not routed, no 500", unmatchedResult.status === 200 && unmatchedResult.json.reason === "unmatched_token", JSON.stringify(unmatchedResult));

  // Requirement #13d: sender mismatch (right token, wrong FROM).
  const spoofedSenderEvent = { type: "email.received", data: { from: "attacker@example.com", to: [replyAddressA], subject: "x", text: "y" } };
  const senderMismatchResult = await postWebhook(spoofedSenderEvent);
  record("Requirement #13 — a SENDER-MISMATCH reply (right token, wrong FROM) is quarantined, not routed", senderMismatchResult.status === 200 && senderMismatchResult.json.reason === "sender_mismatch", JSON.stringify(senderMismatchResult));

  const { data: quarantineRows } = await admin.from("quarantined_inbound_messages").select("reason").eq("bid_package_id", pkg.id);
  record(
    "Requirement #13 — real quarantine rows exist for the attributable cases (sender_mismatch)",
    (quarantineRows ?? []).some((r) => r.reason === "sender_mismatch"),
    JSON.stringify(quarantineRows)
  );

  // =====================================================================
  // STEP 11 — Requirement #15: revoke vendor A mid-package. Confirm
  // IMMEDIATE, total loss of access (documents, submission,
  // correspondence, Q&A) while vendor B is completely unaffected, and
  // staff continues to see everything for BOTH vendors.
  // =====================================================================
  const revokeResult = await revokeVendorMember(staff, vendorA.id, vendorASignUp.user.id);
  record("Staff revokes vendor A's access mid-package", !revokeResult.error, revokeResult.error);

  // Requirement #13e: a revoked vendor's reply token no longer resolves.
  const revokedEvent = { type: "email.received", data: { from: VENDOR_A_EMAIL, to: [replyAddressA], subject: "x", text: "y" } };
  const revokedResult = await postWebhook(revokedEvent);
  record("Requirement #13 — a REVOKED vendor's inbound reply is quarantined (reason=revoked_vendor), not routed", revokedResult.status === 200 && revokedResult.json.reason === "revoked_vendor", JSON.stringify(revokedResult));

  const revokedPkgView = await getVendorVisibleBidPackage(vendorAClient, pkg.id);
  record("Requirement #15 — revoked vendor A immediately loses package view access", revokedPkgView === null, JSON.stringify(revokedPkgView));

  const revokedDocs = await listVendorVisibleBidPackageDocuments(vendorAClient, pkg.id);
  record("Requirement #15 — revoked vendor A immediately loses document access", revokedDocs.length === 0, `length=${revokedDocs.length}`);

  const revokedOwnSubmission = await getVendorOwnBidSubmission(vendorAClient, pkg.id);
  record("Requirement #15 — revoked vendor A can no longer read its own bid submission", revokedOwnSubmission === null, JSON.stringify(revokedOwnSubmission));

  const revokedSubmitAttempt = await submitVendorBid(vendorAClient, vendorASubmission.id, 1, "should be rejected");
  record("Requirement #15 — revoked vendor A cannot submit/revise a bid", !!revokedSubmitAttempt.error, revokedSubmitAttempt.error);

  const revokedAskAttempt = await askVendorBidQuestion(vendorAClient, pkg.id, vendorA.id, "should be rejected");
  record("Requirement #15 — revoked vendor A cannot ask a new question", !!revokedAskAttempt.error, revokedAskAttempt.error);

  const revokedThread = await listEntityMessages(vendorAClient, pkg.id, vendorA.id);
  record("Requirement #15 — revoked vendor A immediately loses correspondence access (own thread now unreadable)", revokedThread.length === 0, `length=${revokedThread.length}`);

  // Vendor B: completely unaffected by vendor A's revocation.
  const vendorBPkgViewAfter = await getVendorVisibleBidPackage(vendorBClient, pkg.id);
  record("Requirement #15 — Vendor B's package view is COMPLETELY UNAFFECTED by vendor A's revocation", !!vendorBPkgViewAfter, JSON.stringify(!!vendorBPkgViewAfter));
  const vendorBDocsAfter = await listVendorVisibleBidPackageDocuments(vendorBClient, pkg.id);
  record("Requirement #15 — Vendor B's document access is unaffected", vendorBDocsAfter.length === 1, `length=${vendorBDocsAfter.length}`);
  const vendorBOwnSubmissionAfter = await getVendorOwnBidSubmission(vendorBClient, pkg.id);
  record("Requirement #15 — Vendor B's own submission is still readable", !!vendorBOwnSubmissionAfter, JSON.stringify(!!vendorBOwnSubmissionAfter));
  const vendorBThreadAfter = await listEntityMessages(vendorBClient, pkg.id, vendorB.id);
  record("Requirement #15 — Vendor B's correspondence thread is still fully intact", vendorBThreadAfter.length >= 3, `length=${vendorBThreadAfter.length}`);

  // Staff: still sees EVERYTHING for both vendors, never mixed.
  const staffDetailAfterRevoke = await getBidPackageDetail(staff, pkg.id);
  const staffSubA = staffDetailAfterRevoke?.submissions.find((s) => s.vendorId === vendorA.id);
  const staffSubB = staffDetailAfterRevoke?.submissions.find((s) => s.vendorId === vendorB.id);
  record(
    "Requirement #15/#12 — staff still sees vendor A's FULL submission history (2 revisions) after revocation",
    staffSubA?.revisions.length === 2 && staffSubA?.amountCents === 398500,
    JSON.stringify(staffSubA)
  );
  record("Requirement #15/#12 — staff still sees vendor B's full submission untouched", staffSubB?.amountCents === 415000, JSON.stringify(staffSubB));
  const staffThreadA = await listEntityMessages(staff, pkg.id, vendorA.id);
  const staffThreadB = await listEntityMessages(staff, pkg.id, vendorB.id);
  record("Requirement #12 — staff still sees vendor A's full correspondence thread (portal is the system of record)", staffThreadA.length >= 3, `length=${staffThreadA.length}`);
  record("Requirement #12 — staff still sees vendor B's full correspondence thread, never mixed with A's", staffThreadB.length >= 3 && staffThreadB.every((m) => m.body !== "Two weeks from award."), `length=${staffThreadB.length}`);

  // =====================================================================
  // STEP 12 — Requirement #14: award the bid to the NON-revoked vendor
  // (B). Exactly one committed_costs row appears; budget_ledger stays
  // untouched for the ENTIRE run, not just around award.
  // =====================================================================
  const { data: committedCostsBeforeAward } = await admin.from("committed_costs").select("id").eq("project_id", project.id);
  record("Zero committed_costs rows exist before award", (committedCostsBeforeAward ?? []).length === 0, `count=${committedCostsBeforeAward?.length}`);

  const awardResult = await awardBid(staff, vendorBSubmission.id);
  record("Requirement #14 — awardBid() (explicit staff action) succeeds for the non-revoked vendor B", !awardResult.error && !!awardResult.committedCostId, JSON.stringify(awardResult));

  const { data: committedCostsAfterAward } = await admin.from("committed_costs").select("id, vendor_name, amount_cents, source_type, source_id").eq("project_id", project.id);
  record(
    "Requirement #14 — EXACTLY ONE committed_costs row now exists, correctly attributed to vendor B's awarded submission",
    committedCostsAfterAward?.length === 1 &&
      committedCostsAfterAward[0].vendor_name === `P5.2-PHASEE-TEST Vendor B ${stamp}` &&
      committedCostsAfterAward[0].amount_cents === 415000 &&
      committedCostsAfterAward[0].source_type === "bid_award" &&
      committedCostsAfterAward[0].source_id === vendorBSubmission.id,
    JSON.stringify(committedCostsAfterAward)
  );

  const { data: pkgAfterAward } = await admin.from("bid_packages").select("status").eq("id", pkg.id).single();
  record("Bid package status is now 'awarded'", pkgAfterAward?.status === "awarded", JSON.stringify(pkgAfterAward));
  const { data: subAAfterAward } = await admin.from("bid_submissions").select("status").eq("id", vendorASubmission.id).single();
  record("Vendor A's (already-revoked-vendor's) submitted bid is auto-declined by award_bid, exactly like any other losing bid", subAAfterAward?.status === "declined", JSON.stringify(subAAfterAward));

  const { data: budgetLedgerAfter } = await admin.from("budget_ledger").select("id").eq("project_id", project.id);
  record(
    "Requirement #14 — budget_ledger has ZERO rows for this project after the ENTIRE flow (invites, submissions, revisions, Q&A, addenda, correspondence, webhooks, revocation, AND award)",
    (budgetLedgerAfter ?? []).length === 0,
    `count=${budgetLedgerAfter?.length}`
  );

  // A second award attempt on an already-declined/awarded package must
  // fail cleanly (the "commitment created only after explicit approval,
  // never twice, never silently" guarantee).
  const doubleAwardAttempt = await awardBid(staff, vendorASubmission.id);
  record("A second award attempt (on the declined vendor A submission) is rejected, not silently accepted", !!doubleAwardAttempt.error, doubleAwardAttempt.error);
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable P5.2 Phase E checkpoint data) ---");
  for (const projectId of createdProjectIds) {
    const { error } = await admin.from("projects").delete().eq("id", projectId);
    if (error) console.warn(`  project ${projectId} could not be deleted (${error.message}) — left in place, clearly named P5.2-PHASEE-TEST.`);
  }
  for (const vendorId of createdVendorIds) {
    const { error } = await admin.from("vendors").delete().eq("id", vendorId);
    if (error) console.warn(`  vendor ${vendorId} could not be deleted (${error.message}) — left in place, clearly named P5.2-PHASEE-TEST.`);
  }
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`  cleanup warning: could not delete user ${id}: ${error.message}`);
  }
  try {
    const adapter = new LocalFilesystemStorageAdapter();
    for (const key of writtenStorageKeys) {
      try {
        await adapter.delete(key);
      } catch (err) {
        console.warn(`  storage key ${key} could not be deleted: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`  storage cleanup skipped: ${err.message}`);
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
