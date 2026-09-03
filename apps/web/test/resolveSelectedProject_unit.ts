/**
 * Unit-level tests for P5.0 (Project-Context Write-Safety)'s fix to
 * resolveSelectedProjectForCookieValue() (apps/web/src/server/project/
 * resolveSelectedProject.ts) and for the new project-access validation
 * helper isProjectAccessibleToUser() (apps/web/src/server/project/
 * assertProjectAccess.ts). Same "real function, hand-rolled fake
 * Supabase client, no network, no database" pattern already established
 * by procurement_actions_unit.ts/estimate_actions_unit.ts.
 *
 * Run with `npx tsx test/resolveSelectedProject_unit.ts`.
 */
import { strict as assert } from "node:assert";
import { resolveSelectedProjectForCookieValue } from "../src/server/project/resolveSelectedProject";
import { isProjectAccessibleToUser } from "../src/server/project/assertProjectAccess";
import type { ProjectRow } from "../../../packages/02-app-shell/src/services/projectService";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function makeProject(id: string, name: string): ProjectRow {
  return {
    id,
    orgId: "org_1",
    name,
    projectNumber: "SC-2026-001",
    address: null,
    projectType: null,
    status: "active",
    pricingModel: null as unknown as ProjectRow["pricingModel"],
    pricingModelLabel: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/**
 * Reproduces exactly the query shape listAccessibleProjects() issues
 * (`.from("projects").select(...).eq(...)[.neq(...)].order(...)`) so
 * both functions under test can be exercised through their real,
 * unmodified `listAccessibleProjects()` call rather than a second mock
 * of that function's own internals. `.order()` is always the terminal,
 * awaited call regardless of whether `.neq()` was chained first.
 */
function makeProjectsListClient(rows: ProjectRow[], reachedFrom: string[] = []) {
  const toDbRow = (p: ProjectRow) => ({
    id: p.id,
    org_id: p.orgId,
    name: p.name,
    project_number: p.projectNumber,
    address: p.address,
    project_type: p.projectType,
    status: p.status,
    pricing_model: p.pricingModel,
    pricing_model_label: p.pricingModelLabel,
    created_at: p.createdAt,
  });
  return {
    from(table: string) {
      reachedFrom.push(table);
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        neq() {
          return chain;
        },
        async order() {
          return { data: rows.map(toDbRow), error: null };
        },
      };
      return chain;
    },
  };
}

// --- resolveSelectedProjectForCookieValue --------------------------------

async function testResolveSelectedProjectForCookieValue() {
  console.log("--- resolveSelectedProjectForCookieValue (P5.0 no-silent-fallback) tests ---");

  const projectA = makeProject("proj_a", "Alpha House"); // sorts first alphabetically
  const projectB = makeProject("proj_b", "Blake Residence");

  {
    // No cookie at all (e.g. a fresh browser session) — the exact real
    // incident scenario (P5-EXTENSION-PACKAGES-DESIGN.md §3): must
    // return null, NEVER silently fall back to the alphabetically-first
    // project. Also proves the DB is never even queried in this case.
    const reachedFrom: string[] = [];
    const client = makeProjectsListClient([projectA, projectB], reachedFrom);
    const result = await resolveSelectedProjectForCookieValue(client as never, "org_1", null);
    check("no cookie -> null, not projects[0]", result === null);
    check("no cookie -> never queries listAccessibleProjects", reachedFrom.length === 0);
  }

  {
    // A cookie naming a project the caller can no longer see (revoked
    // assignment, wrong org, deleted) — must self-heal to null, not
    // silently fall through to a different, unrelated project.
    const client = makeProjectsListClient([projectA, projectB]);
    const result = await resolveSelectedProjectForCookieValue(client as never, "org_1", "proj_stale");
    check("stale cookie -> null, not projects[0]", result === null);
  }

  {
    // A cookie naming a project that IS in the caller's real accessible
    // list — still resolves normally.
    const client = makeProjectsListClient([projectA, projectB]);
    const result = await resolveSelectedProjectForCookieValue(client as never, "org_1", "proj_b");
    check("valid cookie -> resolves the matching project", result?.id === "proj_b");
  }

  {
    // Zero accessible projects, no cookie — still null (the org-has-
    // nothing case this function always handled).
    const client = makeProjectsListClient([]);
    const result = await resolveSelectedProjectForCookieValue(client as never, "org_1", null);
    check("zero projects, no cookie -> null", result === null);
  }

  {
    // Exactly ONE accessible project, no cookie — the judgment call this
    // task's brief called out explicitly. Chosen reading: still null
    // (no auto-select), so the caller renders the explicit "select a
    // project" state even when there's only one candidate.
    const client = makeProjectsListClient([projectA]);
    const result = await resolveSelectedProjectForCookieValue(client as never, "org_1", null);
    check("exactly one accessible project, no cookie -> still null (no auto-select)", result === null);
  }
}

// --- isProjectAccessibleToUser -------------------------------------------

async function testIsProjectAccessibleToUser() {
  console.log("--- isProjectAccessibleToUser (P5.0 server-side write validation) tests ---");

  const projectA = makeProject("proj_a", "Alpha House");
  const projectB = makeProject("proj_b", "Blake Residence");

  {
    const client = makeProjectsListClient([projectA, projectB]);
    const result = await isProjectAccessibleToUser(client as never, "org_1", "proj_b");
    check("returns true for a project in the caller's real accessible list", result === true);
  }

  {
    // The exact scenario this check exists for: a client-supplied
    // projectId that doesn't belong to the caller's real accessible
    // list (spoofed, stale, or from a different org) must be rejected.
    const client = makeProjectsListClient([projectA, projectB]);
    const result = await isProjectAccessibleToUser(client as never, "org_1", "proj_from_another_org");
    check("returns false for a project NOT in the caller's real accessible list", result === false);
  }

  {
    const client = makeProjectsListClient([]);
    const result = await isProjectAccessibleToUser(client as never, "org_1", "proj_a");
    check("returns false when the caller has zero accessible projects", result === false);
  }
}

async function main() {
  await testResolveSelectedProjectForCookieValue();
  await testIsProjectAccessibleToUser();
  console.log(`\nresolveSelectedProject_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
