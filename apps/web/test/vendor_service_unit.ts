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
  mergeVendors,
  unmergeVendor,
  setVendorDocumentStatus,
  summarizeVendorOnboardingStatus,
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

async function main() {
  testNormalization();
  await testCheckVendorDuplicate();
  await testUpsertVendorContactMirror();
  await testMergeVendors();
  await testVendorDocumentStatusVocabulary();
  testSummarizeVendorOnboardingStatus();
  console.log(`\nvendor_service_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
