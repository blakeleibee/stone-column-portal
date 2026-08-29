/**
 * Unit-level tests for packages/02-app-shell/src/services/projectIntakeService.ts
 * (P3.1 Task 2), calling the REAL exported functions directly against a
 * hand-rolled in-memory fake Supabase client — same "real function, fake
 * client" pattern projectService_unit.ts/authorization_unit.ts already
 * established in this directory. No real network, no PGlite, no next
 * dev server.
 *
 * Two things the Task 2 brief specifically flagged as the independent
 * reviewer's focus, and therefore the two things this file spends the
 * most effort proving directly against the real code (not just
 * asserting the shape looks right):
 *   1. getProjectBriefForClient() never lets internal_notes reach the
 *      caller, under ANY published-flag state — proven by asserting the
 *      key is entirely absent from the returned object (not merely
 *      null/falsy), and that its own secret marker string never appears
 *      anywhere in the serialized result.
 *   2. getProjectSetupChecklist() matches P3.1-DESIGN.md §9's table row
 *      by row, across an empty project (checked against the correct
 *      not_started/coming_later/available split) and a fully-filled one
 *      (checked against complete).
 *
 * Run with `npx tsx test/projectIntakeService_unit.ts`.
 */
import { strict as assert } from "node:assert";
import {
  upsertProjectBrief,
  getProjectBriefForStaff,
  getProjectBriefForClient,
  upsertProjectSiteInfo,
  upsertProjectContact,
  listProjectContacts,
  updateStaffAssignmentHandoff,
  getMyActiveAssignmentForProject,
  getProjectSetupChecklist,
} from "../../../packages/02-app-shell/src/services/projectIntakeService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

// ---------------------------------------------------------------------
// A minimal in-memory fake Postgrest-ish client: enough of
// select/eq/is/order/maybeSingle/single/insert/update/upsert (and bare
// awaiting a filtered list) to exercise projectIntakeService.ts's actual
// query shapes, without re-deriving its logic in the test itself.
// ---------------------------------------------------------------------
type Row = Record<string, any>;

function makeFakeDbClient(initialTables: Record<string, Row[]> = {}, userId: string | null = "staff-1") {
  const tables: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(initialTables)) {
    tables[table] = rows.map((r) => ({ ...r }));
  }
  let idCounter = 1000;

  function makeChain(rows: Row[], mode: "select" | "update", patch?: Row) {
    let filtered = rows.slice();
    const chain: any = {
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] === val);
        return chain;
      },
      is(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] === val);
        return chain;
      },
      order() {
        return chain;
      },
      select() {
        return chain;
      },
      async maybeSingle() {
        if (mode === "update" && patch) filtered.forEach((r) => Object.assign(r, patch));
        return { data: filtered[0] ?? null, error: null };
      },
      async single() {
        if (mode === "update" && patch) filtered.forEach((r) => Object.assign(r, patch));
        if (filtered.length === 0) return { data: null, error: { message: "Row not found" } };
        return { data: filtered[0], error: null };
      },
      then(resolve: any, reject: any) {
        if (mode === "update" && patch) filtered.forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    auth: {
      async getUser() {
        return { data: { user: userId ? { id: userId } : null } };
      },
    },
    from(table: string) {
      if (!tables[table]) tables[table] = [];
      const rows = tables[table];
      return {
        select() {
          return makeChain(rows, "select");
        },
        update(patch: Row) {
          return makeChain(rows, "update", patch);
        },
        insert(obj: Row) {
          const row = { id: obj.id ?? `generated-${idCounter++}`, ...obj };
          rows.push(row);
          return {
            select() {
              return {
                async single() {
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        async upsert(obj: Row, opts: { onConflict: string }) {
          const key = opts.onConflict;
          const existing = rows.find((r) => r[key] === obj[key]);
          if (existing) Object.assign(existing, obj);
          else rows.push({ ...obj });
          return { data: null, error: null };
        },
      };
    },
    _tables: tables,
  };
}

function activeProject(id: string, status = "active") {
  return { projects: [{ id, status }] };
}

async function main() {
  // =====================================================================
  console.log("--- getProjectBriefForClient(): internal_notes never reaches a client-role caller ---");
  // =====================================================================
  {
    const SECRET = "SECRET-STAFF-ONLY-DO-NOT-LEAK";
    const client = makeFakeDbClient({
      project_briefs: [
        {
          project_id: "proj-1",
          summary: "New primary residence",
          known_scope: null,
          client_goals: null,
          must_haves: null,
          wishlist_items: null,
          known_exclusions: null,
          quality_expectations: null,
          approx_square_footage: null,
          stories: null,
          bedrooms: null,
          bathrooms: null,
          target_budget_low_cents: null,
          target_budget_high_cents: null,
          confidence_note: null,
          lead_source: null,
          internal_notes: SECRET,
          client_facing_notes: "Excited to build with you!",
          client_facing_notes_published: false,
          updated_by: null,
          updated_at: "2026-08-26T00:00:00Z",
          created_at: "2026-08-26T00:00:00Z",
        },
      ],
    });

    const result = await getProjectBriefForClient(client as never, "proj-1");
    check("getProjectBriefForClient() returns a row when one exists", result !== null);
    check(
      "getProjectBriefForClient()'s returned object has NO internalNotes property at all (not just null)",
      result !== null && !Object.prototype.hasOwnProperty.call(result, "internalNotes")
    );
    check(
      "the secret internal_notes string never appears anywhere in the serialized client-safe result",
      !JSON.stringify(result).includes(SECRET)
    );
    check(
      "clientFacingNotes is withheld (null) when client_facing_notes_published is false, even though staff already wrote content",
      result !== null && result.clientFacingNotes === null
    );

    // Same row, but published — clientFacingNotes should now surface,
    // while internal_notes must STILL be absent (the two flags are
    // independent; publishing client notes must never leak internal
    // ones).
    client._tables.project_briefs[0].client_facing_notes_published = true;
    const publishedResult = await getProjectBriefForClient(client as never, "proj-1");
    check(
      "clientFacingNotes surfaces once client_facing_notes_published flips true",
      publishedResult !== null && publishedResult.clientFacingNotes === "Excited to build with you!"
    );
    check(
      "internalNotes is STILL absent from the client-safe result even after publishing client notes",
      publishedResult !== null && !Object.prototype.hasOwnProperty.call(publishedResult, "internalNotes")
    );

    // The staff-facing read is the control: it MUST see internal_notes,
    // proving the omission above is a deliberate column-list choice for
    // the client function, not an accident that also broke staff access.
    const staffResult = await getProjectBriefForStaff(client as never, "proj-1");
    check(
      "getProjectBriefForStaff() (the STAFF read) still returns internalNotes unchanged (control case)",
      staffResult !== null && staffResult.internalNotes === SECRET
    );
  }

  // =====================================================================
  console.log("\n--- upsertProjectBrief()/upsertProjectSiteInfo(): archived-project guard ---");
  // =====================================================================
  {
    const client = makeFakeDbClient(activeProject("proj-archived", "archived"));
    const briefResult = await upsertProjectBrief(client as never, "proj-archived", { summary: "New idea" });
    check(
      "upsertProjectBrief() rejects when the project is archived (real function, fake client)",
      "error" in briefResult && /archived/i.test((briefResult as any).error)
    );
    const siteInfoResult = await upsertProjectSiteInfo(client as never, "proj-archived", { parcelId: "123-ABC" });
    check(
      "upsertProjectSiteInfo() rejects when the project is archived (real function, fake client)",
      "error" in siteInfoResult && /archived/i.test((siteInfoResult as any).error)
    );
  }

  // =====================================================================
  console.log("\n--- upsertProjectBrief(): partial-write semantics (undefined vs explicit null) ---");
  // =====================================================================
  {
    const client = makeFakeDbClient(activeProject("proj-1"));
    const first = await upsertProjectBrief(client as never, "proj-1", { summary: "Summary A", knownScope: "Scope A" });
    check("upsertProjectBrief() first call (insert) succeeds", !("error" in first));

    // Second call only touches leadSource — summary/knownScope must
    // survive unchanged (pickDefined() must have omitted them, not sent
    // them as undefined-turned-null).
    const second = await upsertProjectBrief(client as never, "proj-1", { leadSource: "Referral" });
    check("upsertProjectBrief() second call (partial update) succeeds", !("error" in second));

    const row = await getProjectBriefForStaff(client as never, "proj-1");
    check("a field not included in the second upsert call keeps its previously written value (summary)", row?.summary === "Summary A");
    check("a field not included in the second upsert call keeps its previously written value (knownScope)", row?.knownScope === "Scope A");
    check("the field actually included in the second call was written", row?.leadSource === "Referral");
  }

  // =====================================================================
  console.log("\n--- upsertProjectContact(): create vs. edit branching ---");
  // =====================================================================
  {
    const client = makeFakeDbClient(activeProject("proj-1"));
    const created = await upsertProjectContact(client as never, "proj-1", {
      fullName: "Jane Homeowner",
      role: "primary_homeowner",
      isPrimary: true,
    });
    check("upsertProjectContact() with no id creates a new contact", "id" in created);

    const contactId = "id" in created ? created.id : "";
    const edited = await upsertProjectContact(client as never, "proj-1", {
      id: contactId,
      fullName: "Jane Homeowner",
      email: "jane@example.com",
    });
    check("upsertProjectContact() with an id edits the existing contact (same id returned)", "id" in edited && edited.id === contactId);

    const contacts = await listProjectContacts(client as never, "proj-1");
    check("listProjectContacts() returns exactly one row (edit did not create a duplicate)", contacts.length === 1);
    check("the edited contact's new field was written", contacts[0].email === "jane@example.com");
    check("the edited contact's original field survived the edit (partial update)", contacts[0].fullName === "Jane Homeowner");

    const blank = await upsertProjectContact(client as never, "proj-1", { fullName: "   " });
    check("upsertProjectContact() rejects a blank full name before ever touching the fake client", "error" in blank);

    const wrongProject = await upsertProjectContact(client as never, "other-project", {
      id: contactId,
      fullName: "Hijacked",
    });
    check(
      "upsertProjectContact() editing a real contact id under the WRONG project id fails rather than silently succeeding",
      "error" in wrongProject
    );
  }

  // =====================================================================
  console.log("\n--- updateStaffAssignmentHandoff(): archived guard + real write ---");
  // =====================================================================
  {
    const activeClient = makeFakeDbClient({
      projects: [{ id: "proj-1", status: "active" }],
      project_staff_assignments: [{ id: "assign-1", project_id: "proj-1", revoked_at: null }],
    });
    const result = await updateStaffAssignmentHandoff(activeClient as never, "assign-1", {
      requestedWork: "estimating",
      priority: "urgent",
      nextAction: "Send preliminary estimate",
    });
    check("updateStaffAssignmentHandoff() succeeds for a non-archived project", !("error" in result));
    const updatedRow = activeClient._tables.project_staff_assignments[0];
    check("updateStaffAssignmentHandoff() actually wrote the new columns", updatedRow.requested_work === "estimating" && updatedRow.priority === "urgent");

    const archivedClient = makeFakeDbClient({
      projects: [{ id: "proj-archived", status: "archived" }],
      project_staff_assignments: [{ id: "assign-2", project_id: "proj-archived", revoked_at: null }],
    });
    const archivedResult = await updateStaffAssignmentHandoff(archivedClient as never, "assign-2", { priority: "low" });
    check(
      "updateStaffAssignmentHandoff() rejects when the assignment's project is archived (real function, fake client)",
      "error" in archivedResult && /archived/i.test((archivedResult as any).error)
    );

    const missingClient = makeFakeDbClient({ projects: [], project_staff_assignments: [] });
    const missingResult = await updateStaffAssignmentHandoff(missingClient as never, "assign-missing", { priority: "low" });
    check(
      "updateStaffAssignmentHandoff() fails closed when the assignment id doesn't resolve",
      "error" in missingResult && /not found/i.test((missingResult as any).error)
    );
  }

  // =====================================================================
  console.log("\n--- getProjectSetupChecklist(): brand-new (empty) project matches design §9 exactly ---");
  // =====================================================================
  {
    const client = makeFakeDbClient({
      projects: [{ id: "proj-empty", pricing_model: null }],
    });
    const checklist = await getProjectSetupChecklist(client as never, "proj-empty");

    check("projectIdentity is always derived/complete", checklist.projectIdentity.kind === "derived" && (checklist.projectIdentity as any).status === "complete");
    check(
      "homeownersDecisionMakers is derived/not_started with zero contacts",
      checklist.homeownersDecisionMakers.kind === "derived" && (checklist.homeownersDecisionMakers as any).status === "not_started"
    );
    check(
      "conceptScope is derived/not_started with no project_briefs row",
      checklist.conceptScope.kind === "derived" && (checklist.conceptScope as any).status === "not_started"
    );
    check(
      "propertySiteInfo is derived/not_started with no project_site_info row",
      checklist.propertySiteInfo.kind === "derived" && (checklist.propertySiteInfo as any).status === "not_started"
    );
    check("plansDocuments is coming_later, not a derived state", checklist.plansDocuments.kind === "coming_later");
    check(
      "staffResponsibilities is derived/not_started with zero assignments",
      checklist.staffResponsibilities.kind === "derived" && (checklist.staffResponsibilities as any).status === "not_started"
    );
    check(
      "preliminaryEstimating is 'available' (real, already-built P4 screen) — NOT coming_later, NOT a derived not_started",
      checklist.preliminaryEstimating.kind === "available"
    );
    check(
      "permitting is derived/not_started with no site-info row",
      checklist.permitting.kind === "derived" && (checklist.permitting as any).status === "not_started"
    );
    check("quickbooksConnection is coming_later", checklist.quickbooksConnection.kind === "coming_later");
    check(
      "contractPricingTerms is derived/not_started when pricing_model is null",
      checklist.contractPricingTerms.kind === "derived" && (checklist.contractPricingTerms as any).status === "not_started"
    );
    check("schedule is coming_later", checklist.schedule.kind === "coming_later");
  }

  // =====================================================================
  console.log("\n--- getProjectSetupChecklist(): fully-filled project derives 'complete' for every real item ---");
  // =====================================================================
  {
    const client = makeFakeDbClient({
      projects: [{ id: "proj-full", pricing_model: "cost_plus_percentage" }],
      project_fee_rules: [{ id: "fee-1", project_id: "proj-full", effective_to: null }],
      project_clients: [
        { id: "c1", project_id: "proj-full", info_status: "complete" },
        { id: "c2", project_id: "proj-full", info_status: "complete" },
      ],
      project_briefs: [
        {
          project_id: "proj-full",
          summary: "S",
          known_scope: "K",
          client_goals: "G",
          must_haves: "M",
          wishlist_items: "W",
          known_exclusions: "E",
          quality_expectations: "Q",
          approx_square_footage: 3200,
          stories: 2,
          bedrooms: 4,
          bathrooms: 2.5,
          target_budget_low_cents: 100000000,
          target_budget_high_cents: 150000000,
          confidence_note: "High",
          lead_source: "Referral",
          internal_notes: null,
          client_facing_notes: null,
          client_facing_notes_published: false,
          updated_by: null,
          updated_at: "t",
          created_at: "t",
        },
      ],
      project_site_info: [
        {
          project_id: "proj-full",
          full_address: "123 Main St",
          parcel_id: "P-1",
          ownership_status: "owned",
          occupied_during_work: false,
          permitting_jurisdiction: "County",
          hoa_review_required: true,
          hoa_status: "complete",
          zoning_notes: null,
          survey_status: "complete",
          architectural_plans_status: "received",
          septic_or_sewer: "public sewer",
          water_source: "public water",
          utilities_available: null,
          soil_environmental_status: "not_applicable",
          soil_environmental_notes: null,
          site_access_notes: null,
          financing_status: "complete",
          permit_status: "requested",
          required_approvals_notes: null,
          updated_by: null,
          updated_at: "t",
          created_at: "t",
        },
      ],
      project_staff_assignments: [{ id: "a1", project_id: "proj-full", revoked_at: null }],
    });
    const checklist = await getProjectSetupChecklist(client as never, "proj-full");

    check(
      "homeownersDecisionMakers is complete when every contact's info_status is 'complete'",
      checklist.homeownersDecisionMakers.kind === "derived" && (checklist.homeownersDecisionMakers as any).status === "complete"
    );
    check(
      "conceptScope is complete when every tracked project_briefs field is filled",
      checklist.conceptScope.kind === "derived" && (checklist.conceptScope as any).status === "complete"
    );
    check(
      "propertySiteInfo is complete when every intake_item_status field is resolved (not 'unknown')",
      checklist.propertySiteInfo.kind === "derived" && (checklist.propertySiteInfo as any).status === "complete"
    );
    check(
      "staffResponsibilities is complete with at least one active (non-revoked) assignment",
      checklist.staffResponsibilities.kind === "derived" && (checklist.staffResponsibilities as any).status === "complete"
    );
    check(
      "permitting is complete when jurisdiction/hoa_review_required/hoa_status/permit_status are all resolved",
      checklist.permitting.kind === "derived" && (checklist.permitting as any).status === "complete"
    );
    check(
      "contractPricingTerms is complete when pricing_model is set AND an active project_fee_rules row exists",
      checklist.contractPricingTerms.kind === "derived" && (checklist.contractPricingTerms as any).status === "complete"
    );
    check("preliminaryEstimating is still 'available' regardless of intake data", checklist.preliminaryEstimating.kind === "available");
    check("plansDocuments/quickbooksConnection/schedule are still coming_later regardless of intake data",
      checklist.plansDocuments.kind === "coming_later" &&
      checklist.quickbooksConnection.kind === "coming_later" &&
      checklist.schedule.kind === "coming_later"
    );
  }

  // =====================================================================
  console.log("\n--- getProjectSetupChecklist(): in-between states (in_progress) ---");
  // =====================================================================
  {
    const client = makeFakeDbClient({
      // pricing_model set but its project_fee_rules row was never
      // inserted (e.g. legacy/edge data) — must read in_progress, not
      // complete, since the design's derivation requires BOTH.
      projects: [{ id: "proj-mid", pricing_model: "cost_plus_fixed_fee" }],
      project_clients: [{ id: "c1", project_id: "proj-mid", info_status: "not_started" }],
      // All assignments revoked: staffing was attempted but nobody is
      // currently active — distinct from "never staffed at all".
      project_staff_assignments: [{ id: "a1", project_id: "proj-mid", revoked_at: "2026-08-01T00:00:00Z" }],
    });
    const checklist = await getProjectSetupChecklist(client as never, "proj-mid");

    check(
      "contractPricingTerms is in_progress when pricing_model is set but no active fee rule exists",
      checklist.contractPricingTerms.kind === "derived" && (checklist.contractPricingTerms as any).status === "in_progress"
    );
    check(
      "homeownersDecisionMakers is in_progress (not complete) when a contact exists but isn't info_status='complete'",
      checklist.homeownersDecisionMakers.kind === "derived" && (checklist.homeownersDecisionMakers as any).status === "in_progress"
    );
    check(
      "staffResponsibilities is in_progress when every assignment on record is revoked (attempted, not currently staffed)",
      checklist.staffResponsibilities.kind === "derived" && (checklist.staffResponsibilities as any).status === "in_progress"
    );
  }

  // =====================================================================
  console.log("\n--- getMyActiveAssignmentForProject(): Task 9's 'Your assignment' card data source ---");
  // =====================================================================
  {
    // Relies on schema/019's project_staff_assignments_self_select
    // policy in a real Postgres session (proven separately by
    // tests/sql/package_p3_1_project_intake_and_handoff_tests.sql
    // Section 8) — this fake client has no RLS at all, so what THIS test
    // proves is the function's own query shape/filtering/mapping logic:
    // scoped to profile_id = the calling user, project_id, and
    // revoked_at IS NULL, with every handoff column mapped to camelCase.
    const client = makeFakeDbClient(
      {
        project_staff_assignments: [
          {
            id: "assign-mine",
            project_id: "proj-1",
            profile_id: "staff-1",
            revoked_at: null,
            requested_work: "site_review",
            priority: "high",
            target_due_date: "2026-09-01",
            next_action: "Walk the site with the framer",
            internal_instructions: "Check the north wall grading before Friday.",
            assigned_at: "2026-08-20T00:00:00Z",
          },
          // A teammate's row on the SAME project — must never be
          // returned for staff-1's own query, proving this is scoped by
          // profile_id, not just project_id.
          { id: "assign-teammate", project_id: "proj-1", profile_id: "staff-2", revoked_at: null, priority: "normal", assigned_at: "2026-08-19T00:00:00Z" },
          // staff-1's own REVOKED row on a different project — must not
          // surface as "active".
          { id: "assign-revoked", project_id: "proj-2", profile_id: "staff-1", revoked_at: "2026-08-10T00:00:00Z", priority: "normal", assigned_at: "2026-08-01T00:00:00Z" },
        ],
      },
      "staff-1"
    );

    const mine = await getMyActiveAssignmentForProject(client as never, "proj-1");
    check("getMyActiveAssignmentForProject() returns the caller's own active row", mine !== null && mine.id === "assign-mine");
    check(
      "getMyActiveAssignmentForProject() maps every handoff column to camelCase",
      mine !== null &&
        mine.requestedWork === "site_review" &&
        mine.priority === "high" &&
        mine.targetDueDate === "2026-09-01" &&
        mine.nextAction === "Walk the site with the framer" &&
        mine.internalInstructions === "Check the north wall grading before Friday."
    );

    const revokedOnly = await getMyActiveAssignmentForProject(client as never, "proj-2");
    check(
      "getMyActiveAssignmentForProject() returns null for a project where the caller's only row is revoked — not 'active' just because a row exists",
      revokedOnly === null
    );

    const noAssignmentAtAll = await getMyActiveAssignmentForProject(client as never, "proj-3");
    check("getMyActiveAssignmentForProject() returns null when the caller has no row at all for the project", noAssignmentAtAll === null);

    const noSession = makeFakeDbClient(
      { project_staff_assignments: [{ id: "assign-mine", project_id: "proj-1", profile_id: "staff-1", revoked_at: null }] },
      null
    );
    const unauthenticated = await getMyActiveAssignmentForProject(noSession as never, "proj-1");
    check("getMyActiveAssignmentForProject() returns null (not a throw) when there is no session", unauthenticated === null);
  }

  console.log(`\nprojectIntakeService_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
