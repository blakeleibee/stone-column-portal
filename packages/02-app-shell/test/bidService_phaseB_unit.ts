/**
 * Unit-level tests for P5.2 Phase B's new bidService.ts functions:
 * assembly-field editing, the vendor-visible read surface (package
 * fields, addenda, Q&A, documents), and bid-package document upload/
 * versioning. Same "real function, hand-rolled fake Supabase client, no
 * network, no database" pattern already established elsewhere in this
 * repo (e.g. test/action_center_queries_unit.ts, apps/web/test/
 * vendor_service_unit.ts's makeChain helper) — this file does not
 * introduce node:test.
 *
 * Run with `npx tsx test/bidService_phaseB_unit.ts`.
 */
import { strict as assert } from "node:assert";
import {
  updateBidPackageAssemblyDetails,
  getVendorVisibleBidPackage,
  listVendorVisibleBidQuestions,
  listVendorVisibleBidAddenda,
  listBidPackageDocuments,
  listVendorVisibleBidPackageDocuments,
  uploadBidPackageDocument,
} from "../src/services/bidService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

// A small generic chainable-and-awaitable fake query builder, matching
// apps/web/test/vendor_service_unit.ts's own makeChain — this file
// re-implements it locally rather than importing across the
// apps/web/packages boundary (this package has no apps/web dependency,
// matching every other service/test file here).
function makeChain(resolve: () => { data: any; error: any }): any {
  const step: any = {
    eq: () => step,
    order: () => step,
    is: () => step,
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return step;
}

// --- updateBidPackageAssemblyDetails ---------------------------------

async function testUpdateBidPackageAssemblyDetails() {
  console.log("--- updateBidPackageAssemblyDetails ---");

  {
    const calls: any[] = [];
    const client = {
      from(table: string) {
        return {
          update: (patch: any) => {
            calls.push({ table, patch });
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    const result = await updateBidPackageAssemblyDetails(client as never, "bp-1", {
      inclusions: "  Full roof tear-off and replacement.  ",
      exclusions: "",
      stoneColumnContactId: "profile-1",
    });
    check("no error on a successful update", !("error" in result));
    check("targets the bid_packages table", calls[0]?.table === "bid_packages");
    check("trims inclusions before writing", calls[0]?.patch.inclusions === "Full roof tear-off and replacement.");
    check("an explicit empty string clears the field to null", calls[0]?.patch.exclusions === null);
    check("maps stoneColumnContactId to stone_column_contact_id", calls[0]?.patch.stone_column_contact_id === "profile-1");
    check("only includes the fields actually passed", !("alternates" in calls[0]?.patch) && !("allowances" in calls[0]?.patch));
  }

  {
    // No fields at all -> a genuine no-op, no database call whatsoever.
    let calledUpdate = false;
    const client = {
      from() {
        return {
          update: () => {
            calledUpdate = true;
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    const result = await updateBidPackageAssemblyDetails(client as never, "bp-1", {});
    check("an empty fields object never calls .update() at all", !calledUpdate);
    check("returns {} (no error) for the no-op case", !("error" in result));
  }

  {
    const client = {
      from() {
        return { update: () => ({ eq: async () => ({ error: { message: "db exploded" } }) }) };
      },
    };
    const result = await updateBidPackageAssemblyDetails(client as never, "bp-1", { inclusions: "x" });
    check("propagates a real database error as { error }", result.error === "db exploded");
  }
}

// --- getVendorVisibleBidPackage (Phase B extension) -------------------

function makePackageDetailClient(opts: { pkg: any; costCode: any; contact?: any }) {
  return {
    from(table: string) {
      if (table === "bid_packages") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.pkg, error: null }) }) }) };
      }
      if (table === "cost_codes") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.costCode, error: null }) }) }) };
      }
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.contact ?? null, error: null }) }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  };
}

async function testGetVendorVisibleBidPackage() {
  console.log("--- getVendorVisibleBidPackage (Phase B assembly fields + contact) ---");

  {
    const client = makePackageDetailClient({
      pkg: {
        id: "bp-1",
        title: "Roofing",
        scope_description: "Full roof",
        due_at: null,
        status: "published",
        cost_code_id: "cc-1",
        inclusions: "Labor and material.",
        exclusions: null,
        alternates: null,
        allowances: null,
        pricing_breakdown_instructions: null,
        schedule_expectations: null,
        bid_instructions: "Submit by email.",
        stone_column_contact_id: "profile-1",
      },
      costCode: { code: "06-100" },
      contact: { full_name: "Jane PM" },
    });
    const result = await getVendorVisibleBidPackage(client as never, "bp-1");
    check("maps inclusions through", result?.inclusions === "Labor and material.");
    check("leaves unset assembly fields null, not undefined-shaped", result?.exclusions === null);
    check("resolves the designated contact's name via a separate profiles query", result?.stoneColumnContactName === "Jane PM");
    check("still resolves the cost code as before", result?.costCodeCode === "06-100");
  }

  {
    // No contact designated -> no profiles round trip needed, and the
    // result cleanly reports null rather than throwing.
    let profilesQueried = false;
    const client = {
      from(table: string) {
        if (table === "bid_packages") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "bp-2",
                    title: "Plumbing",
                    scope_description: null,
                    due_at: null,
                    status: "draft",
                    cost_code_id: "cc-2",
                    stone_column_contact_id: null,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "cost_codes") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { code: "15-100" }, error: null }) }) }) };
        }
        if (table === "profiles") {
          profilesQueried = true;
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const result = await getVendorVisibleBidPackage(client as never, "bp-2");
    check("stoneColumnContactName is null when no contact is designated", result?.stoneColumnContactName === null);
    check("no profiles query is issued at all when stone_column_contact_id is null", !profilesQueried);
  }
}

// --- listVendorVisibleBidQuestions / listVendorVisibleBidAddenda -----

async function testVendorVisibleCorrespondence() {
  console.log("--- listVendorVisibleBidQuestions / listVendorVisibleBidAddenda ---");

  {
    const calls: any[] = [];
    const client = {
      from(table: string) {
        calls.push(table);
        return {
          select: () =>
            makeChain(() => ({
              data: [{ id: "q-1", question_text: "Start date?", asked_at: "2026-01-01T00:00:00Z", answer_text: "March 1", answered_at: "2026-01-02T00:00:00Z" }],
              error: null,
            })),
        };
      },
    };
    const result = await listVendorVisibleBidQuestions(client as never, "bp-1");
    check("queries bid_questions", calls.includes("bid_questions"));
    check("maps question/answer fields to camelCase", result[0].questionText === "Start date?" && result[0].answerText === "March 1");
    check("no staff-attribution field (recordedByName) is present on the vendor-facing shape", !("recordedByName" in result[0]));
  }

  {
    const calls: any[] = [];
    const client = {
      from(table: string) {
        calls.push(table);
        return {
          select: () =>
            makeChain(() => ({
              data: [{ id: "a-1", title: "Addendum 1", body_text: "Revised scope.", revised_due_at: null, issued_at: "2026-01-03T00:00:00Z" }],
              error: null,
            })),
        };
      },
    };
    const result = await listVendorVisibleBidAddenda(client as never, "bp-1");
    check("queries bid_addenda", calls.includes("bid_addenda"));
    check("maps title/bodyText through", result[0].title === "Addendum 1" && result[0].bodyText === "Revised scope.");
  }

  {
    const client = { from: () => ({ select: () => makeChain(() => ({ data: null, error: { message: "boom" } })) }) };
    let threw = false;
    try {
      await listVendorVisibleBidQuestions(client as never, "bp-1");
    } catch {
      threw = true;
    }
    check("propagates a real query error rather than swallowing it", threw);
  }
}

// --- listBidPackageDocuments / listVendorVisibleBidPackageDocuments ---

async function testListBidPackageDocuments() {
  console.log("--- listBidPackageDocuments / listVendorVisibleBidPackageDocuments ---");

  const rows = [
    {
      id: "link-1",
      bid_package_id: "bp-1",
      document_id: "doc-1",
      internal_only: false,
      category: "plans",
      created_at: "2026-01-01T00:00:00Z",
      created_by: "profile-1",
      documents: { file_name: "Plan Set.pdf", mime_type: "application/pdf", size_bytes: 12345, version: 1 },
    },
  ];

  {
    const client = { from: () => ({ select: () => makeChain(() => ({ data: rows, error: null })) }) };
    const result = await listBidPackageDocuments(client as never, "bp-1");
    check("maps the embedded documents.file_name/mime_type/size_bytes/version through", result[0].fileName === "Plan Set.pdf" && result[0].version === 1 && result[0].sizeBytes === 12345);
    check("id is the JOIN row's own id (bid_package_documents.id), not the document's id", result[0].id === "link-1" && result[0].documentId === "doc-1");
  }

  {
    // Vendor variant additionally filters internal_only = false at the
    // query level (defense in depth alongside RLS — see the function's
    // own doc comment).
    const eqCalls: any[] = [];
    const client = {
      from: () => ({
        select: () => {
          const chain = makeChain(() => ({ data: [], error: null }));
          const originalEq = chain.eq;
          chain.eq = (col: string, val: unknown) => {
            eqCalls.push([col, val]);
            return originalEq();
          };
          return chain;
        },
      }),
    };
    await listVendorVisibleBidPackageDocuments(client as never, "bp-1");
    check("vendor-visible list explicitly filters internal_only = false", eqCalls.some(([col, val]) => col === "internal_only" && val === false));
  }
}

// --- uploadBidPackageDocument ------------------------------------------

async function testUploadBidPackageDocument() {
  console.log("--- uploadBidPackageDocument ---");

  // Fresh upload (no replacesId): version 1, no supersede, one new
  // documents row, one new bid_package_documents row.
  {
    const calls: any[] = [];
    const client = {
      from(table: string) {
        return {
          insert: (payload: any) => {
            calls.push({ table, op: "insert", payload });
            return {
              select: () => ({
                single: async () => {
                  if (table === "documents") return { data: { id: "doc-new" }, error: null };
                  return { data: { id: "link-new" }, error: null };
                },
              }),
            };
          },
        };
      },
    };
    const result = await uploadBidPackageDocument(client as never, {
      projectId: "proj-1",
      bidPackageId: "bp-1",
      storageKey: "bid-package-documents/bp-1/plans/1.pdf",
      fileName: "Plans.pdf",
      mimeType: "application/pdf",
      sizeBytes: 999,
      category: "plans",
      internalOnly: false,
      uploadedBy: "profile-1",
    });
    check("returns the new link id on success", result.id === "link-new");
    const documentsInsert = calls.find((c) => c.table === "documents" && c.op === "insert");
    check("a fresh upload inserts documents at version 1", documentsInsert?.payload.version === 1);
    check("no documents UPDATE (supersede) call happens for a fresh upload", !calls.some((c) => c.table === "documents" && c.op === "update"));
    const linkInsert = calls.find((c) => c.table === "bid_package_documents" && c.op === "insert");
    check("the new link points at the newly-created document", linkInsert?.payload.document_id === "doc-new");
  }

  // Replace path: version increments, the PRIOR document is superseded,
  // and a NEW bid_package_documents row is created — the row named by
  // replacesId is never touched (schema/025's immutable-link trigger
  // would reject any attempt to do so; this proves the service layer
  // never even tries).
  {
    const calls: any[] = [];
    const client = {
      from(table: string) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { document_id: "doc-1", documents: { version: 1 } }, error: null }),
            }),
          }),
          insert: (payload: any) => {
            calls.push({ table, op: "insert", payload });
            return {
              select: () => ({
                single: async () => {
                  if (table === "documents") return { data: { id: "doc-2" }, error: null };
                  return { data: { id: "link-2" }, error: null };
                },
              }),
            };
          },
          update: (patch: any) => {
            calls.push({ table, op: "update", patch });
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    const result = await uploadBidPackageDocument(client as never, {
      projectId: "proj-1",
      bidPackageId: "bp-1",
      storageKey: "bid-package-documents/bp-1/plans/2.pdf",
      fileName: "Plans-revised.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
      category: "plans",
      internalOnly: false,
      uploadedBy: "profile-1",
      replacesId: "link-1",
    });
    check("returns the NEW link id (link-2), never the replaced one", result.id === "link-2");
    const documentsInsert = calls.find((c) => c.table === "documents" && c.op === "insert");
    check("replacing increments the version (1 -> 2)", documentsInsert?.payload.version === 2);
    const documentsUpdate = calls.find((c) => c.table === "documents" && c.op === "update");
    check("the PRIOR document row is marked superseded_by_id -> the new document", documentsUpdate?.patch.superseded_by_id === "doc-2");
    const linkInsert = calls.find((c) => c.table === "bid_package_documents" && c.op === "insert");
    check("a brand-new bid_package_documents row links the NEW version — the old link (link-1) is never UPDATEd", linkInsert?.payload.document_id === "doc-2");
    check("no UPDATE is ever issued against bid_package_documents itself (the old link is left completely alone)", !calls.some((c) => c.table === "bid_package_documents" && c.op === "update"));
  }

  // Replace path against a nonexistent link id.
  {
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    };
    const result = await uploadBidPackageDocument(client as never, {
      projectId: "proj-1",
      bidPackageId: "bp-1",
      storageKey: "x",
      fileName: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      category: "plans",
      internalOnly: false,
      uploadedBy: "profile-1",
      replacesId: "does-not-exist",
    });
    check("a nonexistent replacesId returns a clear error, not a crash", result.error === "The document you're replacing could not be found.");
  }
}

async function main() {
  await testUpdateBidPackageAssemblyDetails();
  await testGetVendorVisibleBidPackage();
  await testVendorVisibleCorrespondence();
  await testListBidPackageDocuments();
  await testUploadBidPackageDocument();
  console.log(`\n${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
