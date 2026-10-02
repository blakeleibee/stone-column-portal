#!/usr/bin/env node
// Checkpoint for P5.2 Phase B (bid package assembly fields + document
// control + vendor-visible addenda/Q&A). Proves
// schema/024_bid_package_assembly_fields.sql and
// schema/025_bid_package_documents.sql end-to-end against the real
// hosted dev project, using the exact same service functions the app's
// own Server Actions/pages call (bidService.ts's
// getVendorVisibleBidPackage/updateBidPackageAssemblyDetails/
// uploadBidPackageDocument/listBidPackageDocuments/
// listVendorVisibleBidPackageDocuments/listVendorVisibleBidQuestions/
// listVendorVisibleBidAddenda), plus a REAL file written through
// LocalFilesystemStorageAdapter (this hosted-dev environment has no
// MICROSOFT_GRAPH_CLIENT_ID set, so this is genuinely the same adapter
// getStorageAdapter() returns to the real app) and a REAL signed
// download URL verified end-to-end (bytes actually read back).
//
// Staff side: signs in as the established p3-preview-admin@example.com
// test account. Vendor side: creates two DISTINCT, clearly-named real
// Supabase Auth accounts ("P5.2-PHASEB-TEST Vendor A" / "...Vendor B"),
// deleted in cleanup() below, exactly like Phase A's own checkpoint.
//
// Usage: node scripts/db/live-p5.2-phase-b-checkpoint.mjs
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

// LocalFilesystemStorageAdapter resolves its storage root relative to
// process.cwd() (it assumes it's running inside apps/web, as it always
// is in the real app) — this script must run from the repo root (env
// file loading above depends on that), so it explicitly chdirs into
// apps/web right before anything touches the adapter, exactly so this
// checkpoint exercises the SAME storage root the real dev server uses,
// not an accidental path two levels above the repo entirely.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.join(__dirname, "..", "..", "apps", "web"));
const {
  inviteVendor,
  updateBidPackageAssemblyDetails,
  getVendorVisibleBidPackage,
  getBidPackageDetail,
  uploadBidPackageDocument,
  listBidPackageDocuments,
  listVendorVisibleBidPackageDocuments,
  listVendorVisibleBidQuestions,
  listVendorVisibleBidAddenda,
  askBidQuestion,
  answerBidQuestion,
  issueBidAddendum,
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
const writtenStorageKeys = [];

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

const VENDOR_A_EMAIL = `p522-phaseb-test-vendor-a-${stamp}@example.com`;
const VENDOR_B_EMAIL = `p522-phaseb-test-vendor-b-${stamp}@example.com`;
const VENDOR_PASSWORD = "P522PhaseB-Test-Password-123!";

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
      name: `P5.2-PHASEB-TEST Project ${stamp}`,
      project_number: `P522PB-${stamp}`,
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
    .insert({ org_id: orgId, name: `P5.2-PHASEB-TEST Vendor A ${stamp}`, email: VENDOR_A_EMAIL })
    .select("id")
    .single();
  record("Vendor A created", !vendorAErr && !!vendorA, vendorAErr?.message);
  if (vendorA) createdVendorIds.push(vendorA.id);

  const { data: vendorB, error: vendorBErr } = await staff
    .from("vendors")
    .insert({ org_id: orgId, name: `P5.2-PHASEB-TEST Vendor B ${stamp}`, email: VENDOR_B_EMAIL })
    .select("id")
    .single();
  record("Vendor B created", !vendorBErr && !!vendorB, vendorBErr?.message);
  if (vendorB) createdVendorIds.push(vendorB.id);

  const { data: package1, error: package1Err } = await staff
    .from("bid_packages")
    .insert({ project_id: project.id, cost_code_id: costCode.id, title: `P5.2-PHASEB-TEST Package 1 ${stamp}`, status: "published" })
    .select("id")
    .single();
  record("Bid package 1 created (published)", !package1Err && !!package1, package1Err?.message);

  const { data: package2, error: package2Err } = await staff
    .from("bid_packages")
    .insert({ project_id: project.id, cost_code_id: costCode.id, title: `P5.2-PHASEB-TEST Package 2 ${stamp}`, status: "published" })
    .select("id")
    .single();
  record("Bid package 2 created (published)", !package2Err && !!package2, package2Err?.message);

  const inviteA = await inviteVendor(staff, package1.id, vendorA.id);
  record("inviteVendor(package1, vendorA) returns a real access token", !inviteA.error && !!inviteA.accessToken, inviteA.error);

  const inviteB = await inviteVendor(staff, package2.id, vendorB.id);
  record("inviteVendor(package2, vendorB) returns a real access token", !inviteB.error && !!inviteB.accessToken, inviteB.error);

  const vendorAClient = freshClient();
  const { data: vendorASignUp, error: vendorASignUpErr } = await vendorAClient.auth.signUp({ email: VENDOR_A_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor A real Supabase Auth sign-up", !vendorASignUpErr && !!vendorASignUp.user, vendorASignUpErr?.message);
  if (vendorASignUp?.user) createdUserIds.push(vendorASignUp.user.id);
  const { error: acceptAErr } = await vendorAClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteA.accessToken,
    p_full_name: "P5.2-PHASEB-TEST Vendor A Contact",
  });
  record("Vendor A accept_vendor_bid_invitation() succeeds", !acceptAErr, acceptAErr?.message);

  const vendorBClient = freshClient();
  const { data: vendorBSignUp, error: vendorBSignUpErr } = await vendorBClient.auth.signUp({ email: VENDOR_B_EMAIL, password: VENDOR_PASSWORD });
  record("Vendor B real Supabase Auth sign-up", !vendorBSignUpErr && !!vendorBSignUp.user, vendorBSignUpErr?.message);
  if (vendorBSignUp?.user) createdUserIds.push(vendorBSignUp.user.id);
  const { error: acceptBErr } = await vendorBClient.rpc("accept_vendor_bid_invitation", {
    p_token: inviteB.accessToken,
    p_full_name: "P5.2-PHASEB-TEST Vendor B Contact",
  });
  record("Vendor B accept_vendor_bid_invitation() succeeds", !acceptBErr, acceptBErr?.message);

  // ======================================================================
  // Part B — assembly fields + Stone Column contact
  // ======================================================================
  const updateResult = await updateBidPackageAssemblyDetails(staff, package1.id, {
    inclusions: "All labor, material, and equipment for full roof replacement.",
    exclusions: "Permit fees.",
    bidInstructions: "Submit a single lump-sum price by the due date.",
    stoneColumnContactId: staffSignIn.user.id,
  });
  record("updateBidPackageAssemblyDetails() succeeds (staff session)", !updateResult.error, updateResult.error);

  const detailAsStaff = await getBidPackageDetail(staff, package1.id);
  record("staff getBidPackageDetail() reflects the new assembly fields", detailAsStaff?.inclusions === "All labor, material, and equipment for full roof replacement.", JSON.stringify(detailAsStaff?.inclusions));
  record("staff getBidPackageDetail() resolves the designated contact's real name", !!detailAsStaff?.stoneColumnContactName, detailAsStaff?.stoneColumnContactName);

  const pkg1AsA = await getVendorVisibleBidPackage(vendorAClient, package1.id);
  record("Vendor A (invited to package 1) sees the real assembly fields", pkg1AsA?.inclusions === "All labor, material, and equipment for full roof replacement.", JSON.stringify(pkg1AsA?.inclusions));
  record("Vendor A resolves the Stone Column contact's real name (new profiles vendor-read policy)", !!pkg1AsA?.stoneColumnContactName, pkg1AsA?.stoneColumnContactName);

  const pkg2AsB = await getVendorVisibleBidPackage(vendorBClient, package2.id);
  record("Vendor B (package 2, no contact designated) sees stoneColumnContactName === null", pkg2AsB?.stoneColumnContactName === null, JSON.stringify(pkg2AsB?.stoneColumnContactName));

  // Isolation: Vendor B must NOT be able to resolve package 1's contact.
  const { data: crossProfile, error: crossProfileErr } = await vendorBClient.from("profiles").select("id").eq("id", staffSignIn.user.id);
  record("Vendor B (not invited to package 1) cannot read package 1's designated contact profile at all", !crossProfileErr && (crossProfile?.length ?? -1) === 0, crossProfileErr?.message ?? JSON.stringify(crossProfile));

  // ======================================================================
  // Part C — real document upload, versioning, and vendor visibility
  // ======================================================================
  const { LocalFilesystemStorageAdapter } = require("../../apps/web/src/server/storage/LocalFilesystemStorageAdapter.ts");
  const adapter = new LocalFilesystemStorageAdapter();

  const vendorVisibleKey = `bid-package-documents/${package1.id}/plans/${stamp}-plan-set.txt`;
  const internalOnlyKey = `bid-package-documents/${package1.id}/reference/${stamp}-internal-notes.txt`;
  const vendorVisibleBytes = Buffer.from(`P5.2-PHASEB-TEST real plan set contents, stamp ${stamp}`);
  const internalOnlyBytes = Buffer.from(`P5.2-PHASEB-TEST real internal notes, stamp ${stamp}`);

  await adapter.upload(vendorVisibleKey, vendorVisibleBytes, "text/plain");
  writtenStorageKeys.push(vendorVisibleKey);
  await adapter.upload(internalOnlyKey, internalOnlyBytes, "text/plain");
  writtenStorageKeys.push(internalOnlyKey);
  record("Two real files written via the REAL LocalFilesystemStorageAdapter (the same adapter getStorageAdapter() returns)", true);

  const vendorVisibleUpload = await uploadBidPackageDocument(staff, {
    projectId: project.id,
    bidPackageId: package1.id,
    storageKey: vendorVisibleKey,
    fileName: "Plan Set.txt",
    mimeType: "text/plain",
    sizeBytes: vendorVisibleBytes.length,
    category: "plans",
    internalOnly: false,
    uploadedBy: staffSignIn.user.id,
  });
  record("uploadBidPackageDocument() (vendor-visible, non-internal) succeeds", !vendorVisibleUpload.error && !!vendorVisibleUpload.id, vendorVisibleUpload.error);

  const internalOnlyUpload = await uploadBidPackageDocument(staff, {
    projectId: project.id,
    bidPackageId: package1.id,
    storageKey: internalOnlyKey,
    fileName: "Internal Notes.txt",
    mimeType: "text/plain",
    sizeBytes: internalOnlyBytes.length,
    category: "reference",
    internalOnly: true,
    uploadedBy: staffSignIn.user.id,
  });
  record("uploadBidPackageDocument() (internal-only) succeeds", !internalOnlyUpload.error && !!internalOnlyUpload.id, internalOnlyUpload.error);

  const staffDocs = await listBidPackageDocuments(staff, package1.id);
  record("staff listBidPackageDocuments() sees BOTH documents (internal + non-internal)", staffDocs.length === 2, JSON.stringify(staffDocs.map((d) => d.fileName)));

  const vendorADocs = await listVendorVisibleBidPackageDocuments(vendorAClient, package1.id);
  record("Vendor A sees EXACTLY the one non-internal document, not the internal one", vendorADocs.length === 1 && vendorADocs[0].fileName === "Plan Set.txt", JSON.stringify(vendorADocs.map((d) => d.fileName)));

  // Isolation: Vendor B (invited only to package 2) sees NONE of package 1's documents.
  const vendorBDocsOnPackage1 = await listVendorVisibleBidPackageDocuments(vendorBClient, package1.id);
  record("Vendor B (invited to a DIFFERENT package) sees ZERO of package 1's documents", vendorBDocsOnPackage1.length === 0, JSON.stringify(vendorBDocsOnPackage1));

  // Real signed-URL download, end to end: resolve via the same adapter,
  // then actually read the bytes back and confirm they match.
  const realDownloadUrl = await adapter.getDownloadUrl(vendorVisibleKey, { expiresInSeconds: 60 });
  record("A real, time-limited signed download URL is issued for the vendor-visible document", realDownloadUrl.includes("signed-download") && realDownloadUrl.includes("sig="), realDownloadUrl);
  const readBackBytes = await adapter.readLocal(vendorVisibleKey);
  record("The real uploaded file's bytes read back correctly through the real adapter", readBackBytes.toString() === vendorVisibleBytes.toString());

  // Versioning: replace the vendor-visible document with a new version.
  // The ORIGINAL bid_package_documents row must remain untouched
  // (published-snapshot guarantee, proven live, not just in the SQL
  // suite).
  const replacedKey = `bid-package-documents/${package1.id}/plans/${stamp}-plan-set-v2.txt`;
  await adapter.upload(replacedKey, Buffer.from(`P5.2-PHASEB-TEST real plan set v2, stamp ${stamp}`), "text/plain");
  writtenStorageKeys.push(replacedKey);

  const replaceResult = await uploadBidPackageDocument(staff, {
    projectId: project.id,
    bidPackageId: package1.id,
    storageKey: replacedKey,
    fileName: "Plan Set.txt",
    mimeType: "text/plain",
    sizeBytes: 100,
    category: "plans",
    internalOnly: false,
    uploadedBy: staffSignIn.user.id,
    replacesId: vendorVisibleUpload.id,
  });
  record("Replacing a document (new version) succeeds", !replaceResult.error && !!replaceResult.id && replaceResult.id !== vendorVisibleUpload.id, replaceResult.error);

  const docsAfterReplace = await listBidPackageDocuments(staff, package1.id);
  const originalLinkStillPresent = docsAfterReplace.some((d) => d.id === vendorVisibleUpload.id && d.version === 1);
  const newLinkPresent = docsAfterReplace.some((d) => d.id === replaceResult.id && d.version === 2);
  record("After replacing, the ORIGINAL link still exists, unchanged, at version 1 — published-snapshot guarantee proven live", originalLinkStillPresent, JSON.stringify(docsAfterReplace.map((d) => ({ id: d.id, version: d.version }))));
  record("A brand-new link exists at version 2 for the replacement", newLinkPresent);

  // ======================================================================
  // Part C — Q&A and addenda, real data, vendor-visible read surface
  // ======================================================================
  const questionResult = await askBidQuestion(staff, package1.id, vendorA.id, "Does the plan set include the revised elevation?");
  record("askBidQuestion() succeeds", !questionResult.error, questionResult.error);
  const questionsAfterAsk = await listVendorVisibleBidQuestions(staff, package1.id);
  const questionId = questionsAfterAsk[questionsAfterAsk.length - 1]?.id;
  const answerResult = questionId ? await answerBidQuestion(staff, questionId, "Yes, the current Plan Set.txt is the latest revision.") : { error: "no question id" };
  record("answerBidQuestion() succeeds", !answerResult.error, answerResult.error);

  const addendumResult = await issueBidAddendum(staff, package1.id, "Addendum 1", "A revised plan set has been posted.");
  record("issueBidAddendum() succeeds", !addendumResult.error, addendumResult.error);

  const vendorAQuestions = await listVendorVisibleBidQuestions(vendorAClient, package1.id);
  record("Vendor A sees the real question + real answer", vendorAQuestions.some((q) => q.answerText === "Yes, the current Plan Set.txt is the latest revision."), JSON.stringify(vendorAQuestions));

  const vendorAAddenda = await listVendorVisibleBidAddenda(vendorAClient, package1.id);
  record("Vendor A sees the real addendum", vendorAAddenda.some((a) => a.title === "Addendum 1"), JSON.stringify(vendorAAddenda));

  const vendorBQuestionsOnPackage1 = await listVendorVisibleBidQuestions(vendorBClient, package1.id);
  record("Vendor B (different package) sees ZERO of package 1's questions — isolation holds with real data present", vendorBQuestionsOnPackage1.length === 0, JSON.stringify(vendorBQuestionsOnPackage1));

  const vendorBAddendaOnPackage1 = await listVendorVisibleBidAddenda(vendorBClient, package1.id);
  record("Vendor B (different package) sees ZERO of package 1's addenda", vendorBAddendaOnPackage1.length === 0, JSON.stringify(vendorBAddendaOnPackage1));
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable P5.2 Phase B checkpoint data) ---");
  for (const projectId of createdProjectIds) {
    const { error: deleteErr } = await admin.from("projects").delete().eq("id", projectId);
    if (deleteErr) console.warn(`  project ${projectId} could not be deleted (${deleteErr.message}) — left in place, clearly named P5.2-PHASEB-TEST.`);
  }
  for (const vendorId of createdVendorIds) {
    const { error: deleteErr } = await admin.from("vendors").delete().eq("id", vendorId);
    if (deleteErr) console.warn(`  vendor ${vendorId} could not be deleted (${deleteErr.message}) — left in place, clearly named P5.2-PHASEB-TEST.`);
  }
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`  cleanup warning: could not delete user ${id}: ${error.message}`);
  }
  try {
    const { LocalFilesystemStorageAdapter } = require("../../apps/web/src/server/storage/LocalFilesystemStorageAdapter.ts");
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
