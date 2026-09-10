/**
 * Unit-level tests for the P5.1 vendor-directory service functions
 * (packages/02-app-shell/src/services/vendorService.ts). Same "real
 * function, hand-rolled fake Supabase client, no network, no database"
 * pattern established by procurement_actions_unit.ts: each check proves
 * a validation branch rejects BEFORE the fake client's .from() would be
 * reached where that matters, and at least one valid-input case per
 * function proves the happy path still calls through with the right
 * shape.
 *
 * Required coverage per the P5.1 implementation brief: duplicate-
 * detection warning logic, the primary-contact-mirrors-to-vendors-
 * columns sync, merge/unmerge validation (including the no-merge-
 * chains rejection), and the W-9 status-vocabulary transitions.
 *
 * Run with `npx tsx test/vendor_service_unit.ts`.
 */
import { strict as assert } from "node:assert";
import {
  normalizeVendorName,
  normalizeVendorEmail,
  checkVendorDuplicate,
  upsertVendorContact,
  archiveVendorContact,
  mergeVendors,
  unmergeVendor,
  setVendorDocumentStatus,
  summarizeVendorOnboardingStatus,
  getVendorHistory,
} from "../../../packages/02-app-shell/src/services/vendorService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function throwingClient() {
  return {
    from(table: string) {
      throw new Error(`FAILED: .from('${table}') was called; validation should have rejected this input first`);
    },
  };
}

// --- normalizeVendorName / normalizeVendorEmail -------------------------

function testNormalization() {
  console.log("--- normalizeVendorName / normalizeVendorEmail ---");
  check("strips LLC suffix and lowercases", normalizeVendorName("Vendor X Plumbing LLC") === "vendor x plumbing");
  check("strips comma + Inc. suffix (with trailing period)", normalizeVendorName("Vendor X Plumbing, Inc.") === "vendor x plumbing");
  check("strips Corp suffix", normalizeVendorName("Acme Corp") === "acme");
  check("collapses internal whitespace", normalizeVendorName("Vendor   X   Plumbing") === "vendor x plumbing");
  check("two differently-suffixed names normalize equal", normalizeVendorName("Vendor X Plumbing LLC") === normalizeVendorName("Vendor X Plumbing, Inc."));
  check("distinct businesses stay distinct", normalizeVendorName("Vendor X Plumbing LLC") !== normalizeVendorName("Vendor Y Electric LLC"));
  check("email normalization lowercases and trims", normalizeVendorEmail("  Pat@VendorX.example  ") === "pat@vendorx.example");
}

// --- checkVendorDuplicate -------------------------------------------------

function makeVendorListClient(vendors: { id: string; name: string; email: string | null }[]) {
  return {
    from(table: string) {
      if (table !== "vendors") throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: async () => ({ data: vendors, error: null }) }) };
    },
  };
}

async function testCheckVendorDuplicate() {
  console.log("--- checkVendorDuplicate ---");
  const existing = [{ id: "v-1", name: "Vendor X Plumbing LLC", email: "office@vendorx.example" }];

  {
    const result = await checkVendorDuplicate(makeVendorListClient(existing) as never, "org-1", "Vendor X Plumbing, Inc.");
    check("name match found (suffix-insensitive)", result.warning?.matchedVendorId === "v-1" && result.warning?.matchType === "name");
  }
  {
    const result = await checkVendorDuplicate(makeVendorListClient(existing) as never, "org-1", "Totally Different Name", "OFFICE@VendorX.example");
    check("email match found (case-insensitive) when name doesn't match", result.warning?.matchedVendorId === "v-1" && result.warning?.matchType === "email");
  }
  {
    const result = await checkVendorDuplicate(makeVendorListClient(existing) as never, "org-1", "Brand New Vendor", "new@example.com");
    check("no warning when neither name nor email matches", result.warning === undefined);
  }
}

// --- upsertVendorContact: primary-contact mirror sync ---------------------

function makePrimaryContactClient() {
  const calls: { table: string; op: string; payload?: any }[] = [];
  return {
    calls,
    from(table: string) {
      if (table === "vendor_contacts") {
        return {
          update(patch: any) {
            calls.push({ table, op: "clear-other-primaries", payload: patch });
            return { eq: () => ({ eq: async () => ({ error: null }) }) };
          },
          insert(payload: any) {
            calls.push({ table, op: "insert", payload });
            return { select: () => ({ single: async () => ({ data: { id: "contact-1" }, error: null }) }) };
          },
        };
      }
      if (table === "vendors") {
        return {
          update(patch: any) {
            calls.push({ table, op: "mirror-update", payload: patch });
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function testUpsertVendorContactMirror() {
  console.log("--- upsertVendorContact: primary-contact mirror sync ---");

  {
    const client = makePrimaryContactClient();
    const result = await upsertVendorContact(client as never, {
      vendorId: "v-1",
      name: "Pat Plumber",
      email: "pat@vendorx.example",
      phone: "555-1000",
      isPrimaryBiddingContact: true,
    });
    check("insert succeeds and returns the new contact id", result.id === "contact-1");
    check("clears every other primary contact on the vendor first", client.calls[0].op === "clear-other-primaries");
    check("then inserts the new contact flagged primary", client.calls[1].op === "insert" && client.calls[1].payload.is_primary_bidding_contact === true);
    check(
      "then mirrors name/email/phone onto vendors' own columns",
      client.calls[2].op === "mirror-update" &&
        client.calls[2].payload.contact_name === "Pat Plumber" &&
        client.calls[2].payload.email === "pat@vendorx.example" &&
        client.calls[2].payload.phone === "555-1000"
    );
    check("exactly three writes happen for a primary-contact upsert", client.calls.length === 3);
  }

  {
    const client = makePrimaryContactClient();
    const result = await upsertVendorContact(client as never, { vendorId: "v-1", name: "Non-primary contact", isPrimaryBiddingContact: false });
    check("non-primary contact insert succeeds", result.id === "contact-1");
    check("never touches vendors' mirror columns for a non-primary contact", client.calls.every((c) => c.table !== "vendors"));
    check("never clears other primaries for a non-primary contact", client.calls.every((c) => c.op !== "clear-other-primaries"));
    check("exactly one write happens for a non-primary-contact upsert", client.calls.length === 1);
  }

  {
    const result = await upsertVendorContact(throwingClient() as never, { vendorId: "v-1", name: "   " });
    check("rejects a blank contact name before any write", result.error === "Contact name is required.");
  }
}

// --- upsertVendorContact / archiveVendorContact: stale headline-mirror ----
// (Fix 2, post-review follow-up) When the vendor's CURRENT mirrored
// primary contact is demoted or archived, with no other contact
// promoted to primary in the same call, vendors.contact_name/email/phone
// must be cleared to null rather than left pointing at a no-longer-
// primary contact.

function makeDemoteViaUpsertClient(currentlyPrimary: boolean) {
  const calls: { table: string; op: string; payload?: any }[] = [];
  return {
    calls,
    from(table: string) {
      if (table === "vendor_contacts") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { is_primary_bidding_contact: currentlyPrimary }, error: null }) }),
          }),
          update(patch: any) {
            calls.push({ table, op: "update-contact", payload: patch });
            return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: "contact-1" }, error: null }) }) }) };
          },
        };
      }
      if (table === "vendors") {
        return {
          update(patch: any) {
            calls.push({ table, op: "clear-mirror", payload: patch });
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function testStaleHeadlineMirrorOnDemoteOrArchive() {
  console.log("--- upsertVendorContact / archiveVendorContact: stale headline-mirror clearing ---");

  {
    // Demoting the contact that IS the vendor's current mirrored primary
    // (no replacement promoted in the same call) clears the mirror.
    const client = makeDemoteViaUpsertClient(true);
    const result = await upsertVendorContact(client as never, {
      id: "contact-1",
      vendorId: "v-1",
      name: "Pat Plumber",
      isPrimaryBiddingContact: false,
    });
    check("demoting the current primary succeeds", !result.error);
    check(
      "clears vendors.contact_name/email/phone to null when demoting the current mirrored primary",
      client.calls.some((c) => c.op === "clear-mirror" && c.payload.contact_name === null && c.payload.email === null && c.payload.phone === null)
    );
  }

  {
    // Demoting a contact that was NOT already primary leaves the mirror
    // untouched — nothing stale to clear.
    const client = makeDemoteViaUpsertClient(false);
    const result = await upsertVendorContact(client as never, {
      id: "contact-2",
      vendorId: "v-1",
      name: "Non-primary contact",
      isPrimaryBiddingContact: false,
    });
    check("demoting a non-primary contact succeeds", !result.error);
    check("never touches vendors' mirror columns when the demoted contact wasn't already primary", client.calls.every((c) => c.op !== "clear-mirror"));
  }

  {
    // archiveVendorContact: archiving the vendor's current primary
    // (no replacement designated) clears the mirror the same way.
    const calls: { table: string; op: string; payload?: any }[] = [];
    const client = {
      calls,
      from(table: string) {
        if (table === "vendor_contacts") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { vendor_id: "v-1", is_primary_bidding_contact: true }, error: null }) }),
            }),
            update(patch: any) {
              calls.push({ table, op: "archive", payload: patch });
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        if (table === "vendors") {
          return {
            update(patch: any) {
              calls.push({ table, op: "clear-mirror", payload: patch });
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const result = await archiveVendorContact(client as never, "contact-1");
    check("archiving the current primary succeeds", !result.error);
    check(
      "clears vendors.contact_name/email/phone to null when archiving the current mirrored primary",
      calls.some((c) => c.op === "clear-mirror" && c.payload.contact_name === null && c.payload.email === null && c.payload.phone === null)
    );
  }

  {
    // archiveVendorContact: archiving a non-primary contact leaves the
    // mirror untouched.
    const calls: { table: string; op: string; payload?: any }[] = [];
    const client = {
      calls,
      from(table: string) {
        if (table === "vendor_contacts") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { vendor_id: "v-1", is_primary_bidding_contact: false }, error: null }) }),
            }),
            update(patch: any) {
              calls.push({ table, op: "archive", payload: patch });
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        if (table === "vendors") {
          return {
            update(patch: any) {
              calls.push({ table, op: "clear-mirror", payload: patch });
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const result = await archiveVendorContact(client as never, "contact-2");
    check("archiving a non-primary contact succeeds", !result.error);
    check("never touches vendors' mirror columns when archiving a contact that wasn't the mirrored primary", calls.every((c) => c.op !== "clear-mirror"));
  }
}

// --- mergeVendors / unmergeVendor -----------------------------------------

function makeMergeClient(survivor: { id: string; merged_into_vendor_id: string | null } | null) {
  const calls: { op: string }[] = [];
  return {
    calls,
    from(table: string) {
      if (table !== "vendors") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: survivor, error: null }) }) }),
        update(_patch: any) {
          calls.push({ op: "update-merge" });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
}

async function testMergeVendors() {
  console.log("--- mergeVendors / unmergeVendor ---");

  {
    const result = await mergeVendors(throwingClient() as never, "v-1", "v-1");
    check("rejects self-merge before any DB read", result.error === "Cannot merge a vendor into itself.");
  }
  {
    const result = await mergeVendors(throwingClient() as never, "", "v-2");
    check("rejects a missing loser id before any DB read", !!result.error);
  }
  {
    const client = makeMergeClient(null);
    const result = await mergeVendors(client as never, "v-1", "v-2");
    check("rejects a nonexistent survivor", result.error === "Survivor vendor not found.");
    check("never attempts the merge write when the survivor doesn't exist", client.calls.length === 0);
  }
  {
    // The core no-merge-chains scenario: the chosen survivor is itself
    // already merged into a third vendor.
    const client = makeMergeClient({ id: "v-2", merged_into_vendor_id: "v-3" });
    const result = await mergeVendors(client as never, "v-1", "v-2");
    check(
      "rejects merging into an already-merged vendor (no merge chains)",
      !!result.error && result.error.toLowerCase().includes("already merged")
    );
    check("never attempts the merge write when the survivor is itself merged", client.calls.length === 0);
  }
  {
    const client = makeMergeClient({ id: "v-2", merged_into_vendor_id: null });
    const result = await mergeVendors(client as never, "v-1", "v-2");
    check("a valid merge (survivor is not itself merged) succeeds", !result.error);
    check("a valid merge actually issues the update write", client.calls.length === 1 && client.calls[0].op === "update-merge");
  }
  {
    let updateCalled = false;
    const client = {
      from(table: string) {
        if (table !== "vendors") throw new Error(`unexpected table ${table}`);
        return { update: () => ({ eq: async () => ((updateCalled = true), { error: null }) }) };
      },
    };
    const result = await unmergeVendor(client as never, "v-1");
    check("unmergeVendor succeeds and writes the clearing update", !result.error && updateCalled);
  }
}

// --- setVendorDocumentStatus: W-9 status-vocabulary transitions -----------

async function testVendorDocumentStatusVocabulary() {
  console.log("--- setVendorDocumentStatus: status vocabulary transitions ---");

  for (const bogus of ["bogus", "Verified", "", "approved"]) {
    const result = await setVendorDocumentStatus(throwingClient() as never, {
      vendorId: "v-1",
      orgId: "org-1",
      category: "w9",
      status: bogus as never,
    });
    check(`rejects out-of-vocabulary status "${bogus}" before any DB call`, !!result.error && result.error.includes("not a valid vendor document status"));
  }

  for (const valid of ["missing", "requested", "received", "verified", "expired", "not_applicable"] as const) {
    let updatedPatch: any = null;
    const client = {
      from(table: string) {
        if (table !== "vendor_documents") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ is: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: "doc-1" }, error: null }) }) }) }) }) }),
          }),
          update(patch: any) {
            updatedPatch = patch;
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    const result = await setVendorDocumentStatus(client as never, { vendorId: "v-1", orgId: "org-1", category: "w9", status: valid });
    check(`accepts valid status "${valid}" and updates the existing row`, !result.error && updatedPatch?.status === valid);
  }

  {
    // No current row for this vendor+category yet: inserts a fresh
    // placeholder row instead of updating (there's nothing to update).
    let inserted: any = null;
    const client = {
      from(table: string) {
        if (table !== "vendor_documents") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ is: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }),
          }),
          insert(payload: any) {
            inserted = payload;
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    const result = await setVendorDocumentStatus(client as never, { vendorId: "v-1", orgId: "org-1", category: "license", status: "requested" });
    check("inserts a placeholder row when no current row exists yet", !result.error && inserted?.status === "requested" && inserted?.category === "license");
  }
}

// --- summarizeVendorOnboardingStatus (pure) -------------------------------

function testSummarizeVendorOnboardingStatus() {
  console.log("--- summarizeVendorOnboardingStatus ---");
  const now = new Date("2026-09-09T00:00:00Z");

  check("no documents at all => 'Onboarding not started'", summarizeVendorOnboardingStatus([], now).label === "Onboarding not started");

  check(
    "no w9 row at all (only a COI) => 'W-9 missing'",
    summarizeVendorOnboardingStatus([{ category: "certificate_of_insurance", status: "verified", expirationDate: "2027-01-01" }], now).label === "W-9 missing"
  );

  check(
    "w9 present but status='requested' => still 'W-9 missing'",
    summarizeVendorOnboardingStatus([{ category: "w9", status: "requested", expirationDate: null }], now).label === "W-9 missing"
  );

  check(
    "w9 verified, COI already past its expiration date => 'Document expired'",
    summarizeVendorOnboardingStatus(
      [
        { category: "w9", status: "verified", expirationDate: null },
        { category: "certificate_of_insurance", status: "verified", expirationDate: "2026-01-01" },
      ],
      now
    ).label === "Document expired"
  );

  check(
    "w9 verified, COI expiring within 30 days => 'Expiring soon'",
    summarizeVendorOnboardingStatus(
      [
        { category: "w9", status: "verified", expirationDate: null },
        { category: "certificate_of_insurance", status: "verified", expirationDate: "2026-09-20" },
      ],
      now
    ).label === "Expiring soon"
  );

  check(
    "w9 verified, COI expiring well beyond 30 days => 'Up to date'",
    summarizeVendorOnboardingStatus(
      [
        { category: "w9", status: "verified", expirationDate: null },
        { category: "certificate_of_insurance", status: "verified", expirationDate: "2027-06-01" },
      ],
      now
    ).label === "Up to date"
  );

  check(
    "a not_applicable document's expiration is ignored entirely",
    summarizeVendorOnboardingStatus(
      [
        { category: "w9", status: "verified", expirationDate: null },
        { category: "license", status: "not_applicable", expirationDate: "2020-01-01" },
      ],
      now
    ).label === "Up to date"
  );
}

// --- getVendorHistory: subcontract attribution in a merge scenario -------
// (Fix 3, post-review follow-up) A subcontract history entry must
// attribute to the vendor whose bid_submission was actually AWARDED for
// that bid package — resolved the same way bid-submission entries
// themselves already are — never hardcoded to the vendor id the caller
// happens to be viewing history for. Proven specifically in a merge
// scenario: vendor A (merged away) was awarded bid package "pkg-1" and
// a subcontract was issued against it; viewing history through the
// SURVIVOR (vendor B, "v-b") must still show that subcontract entry
// attributed to vendor A ("v-a"), not v-b.
//
// A small generic chainable-query fake stands in for the real
// supabase-js query builder (which is both chainable AND awaitable at
// every step) since getVendorHistory issues several distinctly-shaped
// chained queries against the same tables (e.g. bid_submissions is
// queried once for "this vendor's own submissions" and again for "which
// submission was awarded").
function makeChain(resolve: (filters: { field: string; value: unknown }[]) => unknown, filters: { field: string; value: unknown }[] = []): any {
  const step: any = {
    eq: (field: string, value: unknown) => makeChain(resolve, [...filters, { field, value }]),
    in: (field: string, value: unknown) => makeChain(resolve, [...filters, { field, value }]),
    is: (field: string, value: unknown) => makeChain(resolve, [...filters, { field, value }]),
    order: () => step,
    limit: () => step,
    maybeSingle: async () => resolve(filters),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(resolve(filters)).then(onFulfilled, onRejected),
  };
  return step;
}

function makeVendorHistoryMergeClient() {
  const mergedAwayRows = [{ id: "v-a" }]; // v-a was merged into v-b
  const bidSubs = [
    {
      id: "sub-1",
      bid_package_id: "pkg-1",
      vendor_id: "v-a",
      status: "awarded",
      amount_cents: 500000,
      submitted_at: "2026-01-05T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      bid_packages: { title: "Framing package" },
    },
  ];
  const subcontractDocs = [{ id: "doc-1", source_id: "pkg-1", document_number: "SC-001", version: 1, issued_at: "2026-01-10T00:00:00Z" }];
  const awardedSubs = [{ bid_package_id: "pkg-1", vendor_id: "v-a" }];

  return {
    from(table: string) {
      return {
        select: () =>
          makeChain((filters) => {
            switch (table) {
              case "vendors":
                return { data: mergedAwayRows, error: null };
              case "bid_submissions": {
                const statusFilter = filters.find((f) => f.field === "status");
                return { data: statusFilter?.value === "awarded" ? awardedSubs : bidSubs, error: null };
              }
              case "material_orders":
                return { data: [], error: null };
              case "committed_costs":
                return { data: [], error: null };
              case "issued_documents": {
                const docTypeFilter = filters.find((f) => f.field === "document_type");
                return { data: docTypeFilter?.value === "subcontract" ? subcontractDocs : [], error: null };
              }
              default:
                throw new Error(`unexpected table ${table}`);
            }
          }),
      };
    },
  };
}

async function testGetVendorHistorySubcontractAttribution() {
  console.log("--- getVendorHistory: subcontract attribution in a merge scenario ---");

  const client = makeVendorHistoryMergeClient();
  const history = await getVendorHistory(client as never, "v-b");

  const subcontractEntry = history.find((h) => h.sourceType === "issued_document" && h.label.startsWith("Subcontract"));
  check("a subcontract history entry is produced for the merged-away vendor's awarded bid package", !!subcontractEntry);
  check(
    "the subcontract entry attributes to the originating vendor A (v-a), not the surviving vendor B (v-b) it's viewed through",
    subcontractEntry?.fromVendorId === "v-a"
  );

  const bidEntry = history.find((h) => h.sourceType === "bid_submission");
  check("the bid-submission entry (already-correct precedent) also attributes to v-a", bidEntry?.fromVendorId === "v-a");
}

async function main() {
  testNormalization();
  await testCheckVendorDuplicate();
  await testUpsertVendorContactMirror();
  await testStaleHeadlineMirrorOnDemoteOrArchive();
  await testMergeVendors();
  await testVendorDocumentStatusVocabulary();
  testSummarizeVendorOnboardingStatus();
  await testGetVendorHistorySubcontractAttribution();
  console.log(`\nvendor_service_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
