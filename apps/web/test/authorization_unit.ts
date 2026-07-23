/**
 * Unit-level negative-path tests for the authorization helpers
 * (apps/web/src/server/auth/). Uses a hand-rolled fake Supabase
 * client (no real network, no PGlite, no next dev server) so these
 * run in milliseconds and cover the 5 explicitly-required negative-
 * path scenarios directly against the helper functions themselves —
 * cross-checked against the equivalent PGlite RLS tests in
 * tests/sql/package_p1_auth_tests.sql, which cover the same scenarios
 * at the database layer.
 *
 * Each of the 5 scenario checks below calls the REAL exported function
 * from src/server/auth/ (getCurrentUser/requireAuthenticatedUser/
 * requireRole/requireOrganizationAccess/canViewProject), passing the
 * fake Supabase client through the optional dependency-injection
 * parameter those functions accept (added specifically so this file
 * doesn't have to re-derive their decision logic and call it a test).
 * Only the 6th, fixture-isolation check does not need this seam --
 * it already calls the real getRepository().
 */
import { strict as assert } from "node:assert";
import { getCurrentUser } from "../src/server/auth/getCurrentUser";
import { requireAuthenticatedUser, requireRole, requireOrganizationAccess, AuthorizationError } from "../src/server/auth/require";
import { canViewProject } from "../src/server/auth/can";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

async function checkThrows(name: string, fn: () => Promise<unknown>) {
  // NOTE: the "did not throw" case must be raised and caught OUTSIDE this
  // try/catch, or it self-catches and this helper reports "ok" no matter
  // what fn() does. (This was previously a live bug in this exact file --
  // fixed here so a real regression in fn() can actually fail the check.)
  let threw = false;
  let caughtMessage = "";
  try {
    await fn();
  } catch (err) {
    threw = true;
    caughtMessage = (err as Error).message;
  }
  assert.ok(threw, `FAILED: ${name} — expected it to throw/redirect, but it did not`);
  checks++;
  console.log(`  ok — ${name} (rejected: ${caughtMessage})`);
}

// ---------------------------------------------------------------------
// Fake profiles/projects/project_members tables and a fake Supabase
// client good enough to exercise getCurrentUser()/requireProjectAccess()'s
// actual query shapes without a real database.
// ---------------------------------------------------------------------
type FakeRow = Record<string, unknown>;

function makeFakeSupabaseClient(opts: {
  currentUserId: string | null;
  profiles: FakeRow[];
  projects: FakeRow[]; // projects this user's RLS would actually return
}) {
  return {
    auth: {
      async getUser() {
        return { data: { user: opts.currentUserId ? { id: opts.currentUserId } : null } };
      },
    },
    from(table: string) {
      const rows = table === "profiles" ? opts.profiles : table === "projects" ? opts.projects : [];
      return {
        select() {
          return this;
        },
        eq(column: string, value: unknown) {
          this._filtered = rows.filter((r) => r[column] === value);
          return this;
        },
        limit() {
          return this;
        },
        async single() {
          const row = (this._filtered ?? rows)[0];
          return row ? { data: row, error: null } : { data: null, error: new Error("not found") };
        },
        async maybeSingle() {
          const row = (this._filtered ?? rows)[0];
          return { data: row ?? null, error: null };
        },
        _filtered: undefined as FakeRow[] | undefined,
      };
    },
  };
}

async function main() {
  // Each scenario below calls the REAL exported function from
  // src/server/auth/, passing the fake client through that function's
  // optional dependency-injection parameter. This exercises the actual
  // decision logic (role checks, org comparisons, query shapes) — a
  // regression in the real code (inverted role check, dropped org
  // comparison, wrong query/column) will make these checks fail, not
  // just a hand-authored Array.filter standing in for it.

  console.log("--- Scenario: unauthenticated request to a protected resource ---");
  {
    const client = makeFakeSupabaseClient({ currentUserId: null, profiles: [], projects: [] });
    const user = await getCurrentUser(client);
    check("getCurrentUser() returns null when there is no session (real function, fake client)", user === null);

    // redirect() from next/navigation throws a special internal signal
    // that depends on Next's request-context internals; outside a real
    // Next.js request it still throws (just not a usable HTTP redirect),
    // which is all checkThrows needs: requireAuthenticatedUser() must
    // not silently return a user for an unauthenticated session.
    await checkThrows("requireAuthenticatedUser() throws/redirects when there is no session (real function, fake client)", () =>
      requireAuthenticatedUser(client)
    );
  }

  console.log("\n--- Scenario: homeowner (client) attempting to access another client's project ---");
  {
    // client_a's own profile exists; the project they're trying to
    // reach (project_b) is NOT in the set RLS would return for them
    // (simulating project_b's real RLS policy excluding a non-member).
    const client = makeFakeSupabaseClient({
      currentUserId: "client-a-id",
      profiles: [{ id: "client-a-id", org_id: "org-1", role: "client", full_name: "Client A", email: "a@x.com", is_active: true }],
      projects: [{ id: "project-a" }], // project-b deliberately absent — RLS would never return it
    });
    const denied = await canViewProject("project-b", client);
    check("canViewProject() denies a client access to another client's project (real function, fake client)", denied === false);
    const allowed = await canViewProject("project-a", client);
    check("canViewProject() allows a client access to their own project (real function, fake client)", allowed === true);
  }

  console.log("\n--- Scenario: vendor attempting to access a project they're not assigned to ---");
  {
    const client = makeFakeSupabaseClient({
      currentUserId: "vendor-a-id",
      profiles: [{ id: "vendor-a-id", org_id: "org-1", role: "vendor", full_name: "Vendor A", email: "v@x.com", is_active: true }],
      projects: [{ id: "project-a" }], // vendor-a is only a member of project-a
    });
    const denied = await canViewProject("project-z", client);
    check("canViewProject() denies a vendor access to an unassigned project (real function, fake client)", denied === false);
    const allowed = await canViewProject("project-a", client);
    check("canViewProject() allows a vendor access to their assigned project (real function, fake client)", allowed === true);
  }

  console.log("\n--- Scenario: vendor attempting an admin-only action (role check) ---");
  {
    const client = makeFakeSupabaseClient({
      currentUserId: "vendor-a-id",
      profiles: [{ id: "vendor-a-id", org_id: "org-1", role: "vendor", full_name: "Vendor A", email: "v@x.com", is_active: true }],
      projects: [],
    });
    let caught: unknown;
    try {
      await requireRole(["admin", "staff"], client);
    } catch (err) {
      caught = err;
    }
    check(
      "requireRole(['admin','staff']) throws AuthorizationError for a vendor (real function, fake client)",
      caught instanceof AuthorizationError
    );
  }

  console.log("\n--- Scenario: client-supplied ID horizontal privilege escalation (org boundary) ---");
  {
    const client = makeFakeSupabaseClient({
      currentUserId: "staff-org1-id",
      profiles: [{ id: "staff-org1-id", org_id: "org-1", role: "staff", full_name: "Staff Org1", email: "s@x.com", is_active: true }],
      projects: [],
    });
    let caught: unknown;
    try {
      await requireOrganizationAccess("org-2-someone-elses-org", client);
    } catch (err) {
      caught = err;
    }
    check(
      "requireOrganizationAccess() throws AuthorizationError for a client-supplied different org id (real function, fake client)",
      caught instanceof AuthorizationError
    );
  }

  console.log("\n--- Fixture isolation: getRepository() never returns a fixture repo outside DEMO_MODE ---");
  {
    const originalDemoMode = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "";
    const { getRepository } = await import("../src/data/getRepository");
    const { FixtureFinancialRepository } = await import(
      "../../../packages/02-app-shell/src/data/fixtureFinancialRepository"
    );
    const repo = getRepository({} as never);
    check(
      "getRepository() with DEMO_MODE unset does not return a FixtureFinancialRepository instance",
      !(repo instanceof FixtureFinancialRepository)
    );
    process.env.DEMO_MODE = originalDemoMode;
  }

  console.log(`\nauthorization_unit.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
