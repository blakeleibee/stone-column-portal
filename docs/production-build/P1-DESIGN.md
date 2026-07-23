# Package P1 — Design Document

**Status:** Active. Written 2026-07-22, after reconciling a broader P1
request against this repository's existing, already-reviewed
architecture. **This document is the authoritative P1 scope** —
`PRODUCTION-ROADMAP.md`'s old P1/P2/P3 sections are superseded by it
where they conflict (see "Relationship to the old P1/P2/P3 sections"
below); read this file first.

## Reconciliation record (why this document exists)

A P1 request was received asking for full authentication, a Prisma
schema, and a flat `ADMIN`/`VENDOR`/`HOMEOWNER` role model, all in one
package. This repository already has:

- `TARGET-ARCHITECTURE.md` §2: **Supabase Auth**, decided and reasoned
  ("the schema is already built around `auth.users`/`auth.uid()`...
  not an added dependency, it's the dependency the existing schema was
  written for") — not Auth.js, not a hand-rolled provider layer.
- `schema/001_core_financial.sql` through `005_*.sql`: ~2,000 lines of
  already-written, already-reviewed raw-SQL Postgres migrations —
  append-only ledgers, `SECURITY DEFINER` helpers, RLS policies,
  audit triggers, a `bootstrap_organization()` first-admin path. Not
  Prisma, and not something to re-author in Prisma's DSL without
  discarding this review history.
- A real role model: the `app_role` enum is `admin` / `staff` /
  `client` / `vendor` — four values, not three, with `staff` a
  distinct, already-built role throughout the UI (`DemoControls` has
  three buttons: Admin/Staff/Client). There is no "homeowner" naming
  anywhere; the docs consistently call that role `client`.
- A deliberate staging of this exact work across three packages
  (`PRODUCTION-ROADMAP.md`'s old P1 = schema/RLS validation only, no
  auth; P2 = auth wiring; P3 = vendor identity + project lifecycle),
  reasoned through in detail (see the "Vendor RLS sequencing" note in
  that file).

Presented to the project owner as a clarifying question; the decision
was: **keep the existing architecture (Supabase, not Prisma; the real
`admin`/`staff`/`client`/`vendor` roles, not a new enum) and
consolidate scope (validation + auth + RBAC + vendor identity
foundation delivered together as one P1), instead of either replacing
the existing design or keeping the original three-package staging.**
This document is that consolidated plan.

## Relationship to the old P1/P2/P3 sections in `PRODUCTION-ROADMAP.md`

| Old section | What it specified | Disposition in this P1 |
|---|---|---|
| Old P1 (Database and security validation) | Execute `schema/001-005` for the first time, prove RLS with real queries | **Folded in as-is** — see "A. Database" below |
| Old P2 (Auth, company membership, project access) | Supabase Auth end-to-end, invitations, decision-makers | **Mostly folded in** — auth, invitations (manual-link, no email provider). **`project_decision_makers` explicitly excluded** — `CLAUDE.md` flags the single- vs. multi-decision-maker approval model as a genuinely open, unresolved product question "needed before Package 7/8," not something to guess at now |
| Old P3 (Production project foundation) | Project CRUD/lifecycle UI + vendor identity | **Only the vendor-identity RLS slice folded in** (`is_project_vendor()` + one policy, exactly as already scoped — "no vendor policy on any other table," "no vendor product screens ship until P11"). Project-creation wizard, settings UI, and team-management UI are genuine product-UI work, not foundation — **deferred**, matching the instruction not to build P2+ business-module workflows prematurely |

`PRODUCTION-ROADMAP.md` is updated with pointers to this file rather
than having its old P1/P2/P3 content deleted (that content remains
accurate as a description of what those packages *would have* been
standalone; it's superseded, not wrong).

## Environment constraint that shapes this plan

This execution environment has **no Docker, no local Postgres, no
`psql`, no network access to provision a hosted Supabase project**
(verified directly: `docker`, `psql`, `pg_ctl` all absent). Real
Supabase Auth (GoTrue) and a live `supabase start` stack are therefore
not runnable here.

**What this does NOT block:** `tests/sql/000_bare_postgres_bootstrap.sql`
was already written specifically for a Docker-optional "bare Postgres"
scenario (see its own header) — it creates the `authenticated`/`anon`
roles and a minimal `auth.users`/`auth.uid()` stub that real Supabase
provides automatically. Combined with
[`@electric-sql/pglite`](https://pglite.dev) (a real Postgres compiled
to WASM, pure npm install, no system dependencies), this repo's
**existing, never-before-executed** SQL test suite
(`tests/sql/package1_tests.sql`,
`tests/sql/committed_forecast_hardening_tests.sql`) can genuinely run
for the first time, with real RLS enforcement (verified directly in
this session: a role-switched query correctly returns only the
current test user's own row). This is the primary, real, automated
verification mechanism for every database/RLS acceptance criterion
below.

**What this DOES block:** actually signing a real user up through
Supabase Auth, receiving a real session cookie, and exercising the
full browser login flow end-to-end. The auth *code* (Next.js
integration, session handling, route protection, authorization
helpers) is written correctly per Supabase's documented patterns and
tested everywhere it can be — but full live-auth E2E verification
requires either Docker (`supabase start`) or a real hosted Supabase
project, neither available here. This is recorded as the **exact
remaining external action** in the P1 completion milestone, not
silently skipped or fabricated as passing.

## A. Database — validate existing schema, extend only where required

1. **PGlite-based SQL test harness** (`scripts/db/run-sql-tests.mjs`):
   runs `tests/sql/000_bare_postgres_bootstrap.sql` →
   `schema/001` → `002` → `003` → `004` → `005` →
   `tests/sql/package1_tests.sql` →
   `tests/sql/committed_forecast_hardening_tests.sql` → the new
   `tests/sql/package_p1_auth_tests.sql` (below), in order, against a
   fresh in-memory PGlite instance per run. Wired into a new
   `npm run test:db` script and into the root `npm run test`
   aggregate, and into CI.
2. **New migration `006_audit_triggers_orgs_profiles_projects.sql`**:
   attaches `log_audit()` to `orgs`, `profiles`, `projects`,
   `project_members`, `project_fee_rules` — the gap
   `TARGET-ARCHITECTURE.md` §7 already flagged by name.
3. **New migration `007_vendor_identity.sql`**: `is_project_vendor(project_id)`
   helper + exactly one policy (`project_members_vendor_self_read`) —
   vendor reads their own `project_members` row, nothing else. No
   other table's RLS changes. Matches the already-written P3 spec
   verbatim.
4. **New migration `008_project_status_transitions.sql`**: an
   enforced-transition trigger on `projects.status`
   (`draft → active → on_hold → closed_out → archived`, no invalid
   jumps), mirroring the existing expense state-machine trigger's
   proven pattern. Data-integrity only — no project-creation UI.
5. **New migration `009_invitations.sql`**: `invitations` table
   (`id`, `org_id`, `email`, `role`, `project_id` nullable, `token`,
   `expires_at`, `accepted_at`, `revoked_at`, `created_by`,
   `created_at`), RLS-enabled (staff/admin manage within their org;
   no direct-table read/write for the invited party — acceptance goes
   through a `SECURITY DEFINER` RPC, matching the `bootstrap_organization()`
   pattern), audited from creation.
6. **New migration `010_documents.sql`**: `documents` table (`id`,
   `project_id`, `uploaded_by`, `file_name`, `mime_type`,
   `size_bytes`, `category`, `storage_key`, `is_published_to_client`,
   `created_at`) — RLS: staff full access; client read only where
   `is_published_to_client`; no vendor policy yet (extensible, per
   `TARGET-ARCHITECTURE.md` §3's "each later package adds its own
   narrowly scoped vendor policy" rule) — audited from creation.
7. **New test file `tests/sql/package_p1_auth_tests.sql`**: cross-org
   staff isolation, cross-project client isolation, vendor sees only
   their own membership row, vendor cannot see another vendor's row on
   the same project, non-staff cannot list org invitations, client
   cannot see an unpublished document, unauthenticated (`anon` role)
   gets zero rows from every table.

**Explicitly excluded from the schema:** `project_decision_makers`
(open product decision, see above); any `staff_function` sub-role
split (`SECURITY-AND-PERMISSIONS-MATRIX.md` already designs this as a
*forward-compatible, additive* concept — nothing here blocks adding it
later, and building it now would be speculative for a two-person
company).

## B. Authentication — Supabase Auth, gated by a `DEMO_MODE` flag

The existing P0 app (`apps/web`) has zero auth today and runs entirely
on fixture data via `DemoControls`' role switcher — and per this
project's fixture-safety rules, that demo behavior must be preserved
for seeded demonstration environments while being impossible in real
production. The reconciling design:

- **`DEMO_MODE`** — a server-only environment flag (`DEMO_MODE=true`),
  read once at startup. When true: today's exact P0 behavior (fixture
  repository, `DemoControls`, `SampleDataTag`, no auth required) —
  completely unchanged, every existing P0 test still passes. When
  false (the real/production default — **absence of the flag means
  false**, not true, so a misconfigured deployment fails closed into
  "real auth required," never into "silently show fixtures"): real
  Supabase Auth is required for every `/admin`, `/client`, `/vendor`
  route; `DemoControls`/`SampleDataTag` never render;
  `FixtureFinancialRepository` is never instantiated (a hard runtime
  guard throws if something tries).
- `@supabase/ssr` + `@supabase/supabase-js` for browser/server clients
  (cookie-based sessions, Supabase's documented Next.js App Router
  pattern) — `middleware.ts` refreshes the session on every request.
- `/login`: email/password + magic link.
- `/signup`: gated behind a single server-only `BOOTSTRAP_INVITE_CODE`
  env var, checked before calling `bootstrap_organization()` — the
  "production must gate it behind an invite code" requirement the
  function's own SQL comment already flags. One-time-use in spirit
  (the function itself already rejects a second call per-user); the
  code is a coarse gate suitable for a two-person company's first
  admin, not a general invitation system.
- `/invite/[token]`: accepts an `invitations` row — validates the
  token via RPC, creates/links the Supabase Auth user, creates their
  `profiles` row with the pre-assigned role/org. **No email delivery**
  (no email-provider credential available in this environment or
  documented as chosen) — the invite link is generated for an admin to
  send manually. Documented as a P1-scoped limitation, not a silent
  gap.
- Role-aware post-login redirect: `admin`/`staff` → `/admin/overview`;
  `client` → `/client/home`; `vendor` → a minimal `/vendor` holding
  route (real vendor UI is P11+; only auth and the redirect target
  exist here).
- **Route protection is enforced in the route itself** (every
  `/admin/*`, `/client/*`, `/vendor/*` Server Component independently
  confirms the session and role server-side), not only in middleware —
  per the explicit instruction that middleware alone is not a security
  boundary.

## C. Authorization layer

New server-only module, colocated with the rest of `apps/web`'s
server code: `apps/web/src/server/auth/`.

- `getCurrentUser()` — resolves the Supabase session server-side,
  returns the matching `profiles` row (role, org, active status) or
  `null`. Every other helper is built on this one function, so a
  future auth-provider change touches one call site's internals, not
  every route.
- `requireAuthenticatedUser()`, `requireRole(roles: AppRole[])`,
  `requireProjectAccess(projectId)`, `requireOrganizationAccess(orgId)`
  — throw/redirect on failure.
- `canViewProject`, `canManageProject`, `canViewDocument`,
  `canUploadDocument` — boolean predicates for conditional UI, backed
  by the same real queries the `require*` functions use (never a
  separate, potentially-drifting code path).

Every helper queries through the current user's own Supabase
client (their JWT, subject to RLS) — per `TARGET-ARCHITECTURE.md`
§5.2, these are the "ordinary user-originated" case, never the
service-role client. This means RLS is always the second, independent
enforcement layer behind every one of these checks, not a
belt-only-no-suspenders design.

## D. Data access layer

- `SupabaseFinancialRepository` (currently a documented stub in
  `packages/02-app-shell/src/data/`) is implemented for real, per the
  query shapes its own comments already specify — including
  `getIndependentPostedActualCostCents` as a genuinely separate
  aggregate query, not a client-side sum of `getExpenses()`'s result
  (the exact contract `TARGET-ARCHITECTURE.md` §6 requires).
- A new `getRepository()` factory returns `FixtureFinancialRepository`
  when `DEMO_MODE=true` and `SupabaseFinancialRepository` otherwise —
  this one function is the hard guard against production silently
  running on fixtures.
- The admin Financials path (`AdminFinancialsScreen` via
  `/admin/financials`) is switched to call `getRepository()` instead
  of hardcoding `FixtureFinancialRepository`, proving the whole stack
  (auth → RLS → repository → engine → screen) end-to-end on at least
  one real vertical slice. Other fixture-backed screens are left as
  P0 left them — full fixture replacement across every screen is
  later-package scope, not P1's.

## E. File storage

- `StorageAdapter` interface: `upload(file, key)`,
  `getDownloadUrl(key)`, `delete(key)`.
- `LocalFilesystemStorageAdapter`: dev-only, writes to a gitignored
  `.local-storage/` directory at the repo root.
- `OneDriveStorageAdapter`: **interface boundary and config contract
  only** (per `TARGET-ARCHITECTURE.md` §8-9) — not implemented, no
  Microsoft Graph credentials available or requested.
- `documents` table (§A.6) stores metadata only, never file bytes.
- `GET /api/documents/[id]/download` Route Handler: calls
  `canViewDocument` before resolving a download URL — no public
  access to any project file by default.
- Upload/delete both go through `requireProjectAccess`/role checks;
  the `documents` table's `log_audit()` trigger captures every
  upload/delete automatically.

## F. Seed data

A new `scripts/db/seed.mjs`, explicitly refusing to run unless
`ALLOW_SEED=true` is set (fails closed against an accidental
production run) — creates one org, four profiles (one per role), one
project, `project_members` rows, two sample documents, one pending
invitation. Labeled dev/test-only in its own output and in the
runbook.

## G. Tests

- The PGlite SQL suite (§A) — the primary, real, automated
  verification for every RLS/database acceptance criterion.
- `apps/web/test/auth_smoke.ts` (new, extending `route_smoke.ts`'s
  real-HTTP-server pattern): unauthenticated requests to
  `/admin/overview`, `/client/home`, `/vendor` all redirect to
  `/login`; `DEMO_MODE=true` still serves exactly what P0's existing
  `route_smoke.ts` already proves (no regression).
- Unit tests on the authorization helpers (§C) using a lightweight
  fake Supabase client — this is where the 5 explicitly named
  negative-path scenarios (homeowner→other homeowner's project,
  vendor→unassigned project, vendor→admin-only action, unauthenticated
  →protected route, client-supplied-ID horizontal escalation) get
  their most direct coverage, cross-checked against the PGlite RLS
  tests covering the same scenarios at the database layer.
- Fixture-isolation test: asserts `getRepository()` throws if called
  with `DEMO_MODE` false-or-unset and something has bypassed the
  factory to reach `FixtureFinancialRepository` directly outside
  `apps/web`'s own tree (extends `check-fixture-boundaries.mjs`'s
  existing enforcement, doesn't replace it).

## H. Documentation

- `.env.example`: add `DEMO_MODE`, `BOOTSTRAP_INVITE_CODE`, local
  storage path config.
- New `docs/production-build/P1-AUTH-AND-ACCESS.md`: role/permission
  model, local dev setup (explicit about the Docker-for-full-verification
  gap), migration workflow, seed workflow, test workflow, file-storage
  configuration, deployment considerations, and a named
  production-readiness limitations section.

## P1 Acceptance Criteria (explicit, testable)

1. Every SQL test file in `tests/sql/` (including the new
   `package_p1_auth_tests.sql`) passes against PGlite, automated, in
   `npm run test` and CI. *(Old P1 criterion 1, fulfilled via PGlite
   instead of a Docker-based Postgres — equivalent RLS enforcement,
   verified directly in this session.)*
2. RLS is proven, not asserted, for every role pairing: `client`
   cannot read another project's `expenses`; `staff` cannot read
   another org's `projects`; `vendor` cannot read another project's
   `project_members`, nor another vendor's row on the same project.
   *(Old P1 criterion 3 + P3's vendor-isolation criterion.)*
3. Any schema defect found while running the suite for the first time
   is fixed via a new forward migration, never by editing `001`-`005`
   in place.
4. `DEMO_MODE=true` reproduces every P0 acceptance criterion and every
   P0 test unchanged (zero regression to the existing demo/preview
   experience).
5. `DEMO_MODE=false` (or unset): every `/admin`, `/client`, `/vendor`
   route redirects an unauthenticated request to `/login`, verified by
   a real HTTP test against a running server (not a code-reading
   claim).
6. `bootstrap_organization()` is unreachable without a valid
   `BOOTSTRAP_INVITE_CODE` — verified by a test that an incorrect/
   missing code is rejected server-side.
7. The authorization helpers (§C) each have a passing test proving
   both the allow and the deny path, including all 5 explicitly
   requested negative-path scenarios.
8. `SupabaseFinancialRepository` is fully implemented (no
   `notImplemented()` stubs remaining) and the admin Financials route
   uses it when `DEMO_MODE=false`, with `getIndependentPostedActualCostCents`
   confirmed to be a genuinely separate query path (test asserts the
   repository method's SQL/RPC target, not just its return type).
9. `documents` table + `StorageAdapter` + `LocalFilesystemStorageAdapter`
   are implemented; upload/download/delete all enforce
   `canViewDocument`/`canUploadDocument`/`requireProjectAccess`,
   verified by tests including an explicit denial case (a user with no
   project access cannot download).
10. Every new mutable table (`invitations`, `documents`, plus the
    audit-trigger backfill on `orgs`/`profiles`/`projects`/
    `project_members`/`project_fee_rules`) writes a real `audit_log`
    row on insert/update, verified by a PGlite test reading
    `audit_log` after the mutation, not by confirming the trigger
    merely exists.
11. `npm ci`, `npm run typecheck`, `npm run test`, `npm run build` all
    pass from a clean install at the final P1 commit.
12. The P1 milestone document explicitly lists what remains externally
    blocked (Docker or a hosted Supabase project, for full live-auth
    E2E verification) rather than claiming full auth E2E coverage that
    was never actually exercised.

## Explicit, named exclusions (not silently dropped — deferred with a reason)

- `project_decision_makers` / Client Approval Rule implementation —
  genuinely open product decision per `CLAUDE.md`, not P1's to resolve.
- Project-creation wizard, project settings UI, team-management UI —
  product UI, not foundation (schema already supports adding it).
- Email delivery of invitations — no email-provider credential
  available; manual link-sharing documented as the P1-scoped
  limitation.
- Vendor-facing portal UI — still P11+; only auth/redirect exists.
- OneDrive/SharePoint integration — interface boundary only, no
  Microsoft Graph credentials.
- Live end-to-end Supabase Auth verification (real sign-up/login
  against a running GoTrue instance) — requires Docker or a hosted
  Supabase project; documented as the exact remaining external action
  for the repository owner.
- `staff_function` sub-role granularity (Project Manager vs.
  Superintendent vs. Accounting) — schema is already forward-compatible
  for it per `SECURITY-AND-PERMISSIONS-MATRIX.md`; not built now.
