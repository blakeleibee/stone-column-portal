# P1 — Auth, RBAC, and Data Foundation: Setup and Operations

Companion to `docs/production-build/P1-DESIGN.md` (the scope/acceptance
-criteria document) — this is the how-to-run-it reference.

## Role and permission model

Four roles (`app_role` Postgres enum, unchanged since `schema/001`):
`admin`, `staff`, `client`, `vendor`. `admin`/`staff` are org-wide
(`is_org_staff_for_org()`); `client`/`vendor` are scoped per-project via
`project_members` (`is_project_client()`/`is_project_vendor()`). Every
server-side authorization decision in `apps/web/src/server/auth/`
queries through the current user's own Supabase client (their JWT), so
Postgres RLS is always the second, independent enforcement layer behind
every check — a bug in a `require*()`/`can*()` function's logic still
can't leak a row RLS itself would deny.

## Local development setup

1. `npm ci` at the repo root.
2. Copy `.env.example` to `.env.local` inside `apps/web/` (gitignored).
   For a fully fixture-driven local dev loop with zero Supabase setup,
   set `DEMO_MODE=true` and leave the Supabase variables blank — this
   reproduces Package P0's exact experience.
3. For real auth locally, you need **either**:
   - **Docker + the Supabase CLI**: `npx supabase init`, `npx supabase start`
     (spins up a full local Postgres+Auth+Storage stack), then apply
     migrations with `npx supabase db push` or by running each
     `schema/*.sql` file against the printed local connection string.
     Fill `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
     `SUPABASE_SERVICE_ROLE_KEY` from `npx supabase status`'s output.
   - **A hosted Supabase project** (free tier is sufficient): create one
     at supabase.com, apply the migrations via `supabase link` +
     `supabase db push` or the SQL editor, fill the same three env vars
     from the project's Settings → API page.
4. Set `BOOTSTRAP_INVITE_CODE` to any value you choose; visit `/signup`
   with that code to create the first admin.
5. `npm run dev`.

**This repository's own execution environment for Package P1 had
neither Docker nor a hosted Supabase project available** — every piece
of database/auth code was written and verified as far as possible
without one (see the "Production-readiness limitations" section
below). **Resolved 2026-08-06**: a real hosted Supabase project now
exists and the full live flow (signup, login, session persistence,
logout, invitation acceptance, role assignment, cross-org isolation)
has been exercised end-to-end and passed — see
`docs/production-build/PRE-P4-CHECKPOINT.md`.

## Database: migrations, testing, seeding

- **Automated test suite (no live database needed):** `npm run test:db`
  runs the entire migration chain (`schema/001` through the newest
  numbered file) plus every SQL test file in `tests/sql/` against an
  in-memory PGlite instance (a real Postgres compiled to WASM). This is
  the primary, real, automated verification for every RLS/database
  behavior in this package — it runs in CI on every push.
- **Applying migrations to a real database** (once you have one via
  Docker or hosted Supabase): apply `schema/001_core_financial.sql`
  through the newest numbered file, in order, via `supabase db push`
  or `psql "$DATABASE_URL" -f schema/00N_*.sql` for each file in
  sequence. Never apply a `_down.sql` file to a database with real
  data — those exist for local `up → down → up` reapply-cycle testing
  only (see `schema/*_down.sql` files' own convention, unchanged since
  before this package).
- **Seeding:** `ALLOW_SEED=true node scripts/db/seed.mjs` (equivalently,
  `ALLOW_SEED=true npm run db:seed` from the repo root) against a real
  (never production) database — creates one org, four profiles (one
  per role, password `seed-password-123` for all), one project, two
  documents, one pending invitation. The script fails closed and
  refuses to run unless `ALLOW_SEED=true` is set explicitly. **This
  script has been written and cross-checked against the schema but not
  executed end-to-end** in this repository's own environment (no live
  Supabase project available) — run it yourself against your
  local/preview project and report back if anything doesn't work as
  documented.

## Test workflow

```
npm run test          # everything: workspace tests + test:db + test:auth + test:authz
npm run test:db        # SQL/RLS suite only (PGlite, no live database needed)
npm run test:auth      # HTTP route-protection regression (spins up next dev twice)
npm run test:authz     # authorization-helper unit tests (fast, no server)
```

## File storage configuration

`apps/web/src/server/storage/getStorageAdapter.ts` returns a
`LocalFilesystemStorageAdapter` (writes to a gitignored `.local-storage/`
directory at the repo root) unless `MICROSOFT_GRAPH_CLIENT_ID` is set,
in which case it returns `OneDriveStorageAdapter` — which is an
interface boundary only today (every method throws
`not implemented`; no Microsoft Graph credentials are configured or
available). Implementing it for real is a later package's job once
Graph credentials are provisioned.

## Deployment considerations

- `DEMO_MODE` must be **unset or `false`** in any real production
  deployment — a deployment that leaves it `true` would serve fixture
  data to real users, which is exactly the failure mode this flag
  exists to prevent everywhere else.
- `BOOTSTRAP_INVITE_CODE` should be set to a real secret (not left
  blank) before a production deployment's `/signup` route is reachable
  — an unset/blank value means `bootstrapFirstAdmin()`'s comparison
  (`inviteCode !== process.env.BOOTSTRAP_INVITE_CODE`) will reject
  every submission (an empty submitted field would need to exactly
  equal an empty env var, which the form's `required` attribute
  already prevents client-side, and the server-side check doesn't
  special-case an empty env var as "gate disabled") — verify this
  explicitly before relying on it in production, don't assume.
- `SUPABASE_SERVICE_ROLE_KEY` is used only by `scripts/db/seed.mjs`
  (a local/CI-only script) — no application server code path in this
  package uses the service-role client at all (see `P1-DESIGN.md`'s
  §C for why: every authorization helper deliberately uses the
  user's own JWT).
- `ALLOW_SEED` should never be set to `true` in any production
  environment or its variable store — it exists solely to keep
  `scripts/db/seed.mjs` from running by accident against the wrong
  database.

## Production-readiness limitations (explicit, not silently omitted)

- **No live end-to-end verification of real Supabase Auth sign-up/
  login** happened in this package's execution — no Docker, no hosted
  Supabase project was available. The auth *code* follows Supabase's
  documented Next.js App Router patterns exactly (`@supabase/ssr`'s
  standard `createServerClient`/`createBrowserClient`/middleware
  shape), and everything reachable without a live auth backend (the
  entire SQL/RLS layer via PGlite, the route-protection redirect logic
  via `auth_smoke.ts`, the authorization-helper logic via
  `authorization_unit.ts`) was actually run and passed — but a real
  person signing up, logging in, and confirming a session persists
  correctly has not happened. **This is the single most important
  thing to verify before trusting this package in production.**
- `scripts/db/seed.mjs` has not been run end-to-end for the same
  reason — it has been written and cross-checked against the current
  schema (org/profile/project/document/invitation shapes) but never
  executed against a real Postgres/Supabase instance.
- **The sign-up-then-RPC flow in `/signup` and `/invite/[token]` is not
  atomic.** `apps/web/app/signup/actions.ts`'s `bootstrapFirstAdmin()`
  and `apps/web/app/invite/[token]/actions.ts`'s `acceptInvitation()`
  each call `supabase.auth.signUp()` and then a follow-up RPC
  (`bootstrap_organization()` / `accept_invitation()`) as two separate,
  non-transactional steps. If the RPC fails after `signUp()` succeeds —
  a transient DB error, or a race on `accept_invitation()` between two
  people accepting the same invitation — the resulting Supabase Auth
  user is left with no matching `profiles` row, and there is no
  self-service recovery path: a retry with the same email is rejected
  by `signUp()` with "already registered" before the RPC ever runs
  again. Both files carry inline code comments describing this
  (written during Task 10); this doc names it explicitly so it isn't
  only discoverable by reading the source. Acceptable for P1's
  foundation (a first-admin bootstrap and low-volume manual invitations)
  but must be revisited before either path sees real, repeated
  production use.
- **Fixture data still backs nearly every screen outside `DEMO_MODE`.**
  `apps/web/src/data/loadViewModels.ts`'s `loadAdminVM()` and
  `loadClientVM()` construct a `FixtureFinancialRepository` and serve
  "Hawks Ridge Residence" sample data unconditionally, regardless of
  `DEMO_MODE`. Only the `/admin/financials` route
  (`apps/web/app/admin/financials/page.tsx`) branches on `DEMO_MODE`
  and calls the real-repository path (`loadAdminVMFor()` with
  `getRepository()`'s `SupabaseFinancialRepository`) when it's false.
  Every other admin/client screen — including `/client/budget`, which
  calls `requireRole(["client"])` for real auth but then still renders
  `loadClientVM()`'s fixture data — is untouched. This is a deliberate
  P1 scope decision, not a bug (see `P1-DESIGN.md` §D: "the admin
  Financials path... proving the whole stack... on at least one real
  vertical slice. Other fixture-backed screens are left as P0 left
  them"), but it means a real production deployment today would show
  fixture content on most screens until later packages replace them
  one at a time.
- **No type-level barrier prevents a future service-role client from
  being passed into the Task 17 authorization helpers.**
  `getCurrentUser()`, `requireAuthenticatedUser()`, `requireRole()`,
  `requireProjectAccess()`, and `requireOrganizationAccess()` (in
  `apps/web/src/server/auth/getCurrentUser.ts` and `require.ts`) all
  accept an optional `client` parameter typed as
  `Awaited<ReturnType<typeof createServerSupabaseClient>>` — the same
  shape a hypothetical service-role client factory would have to
  return. Nothing in the type system distinguishes "the current user's
  own JWT-scoped client" (the only kind these helpers are meant to
  receive) from "a service-role client with RLS bypassed." Today this
  is a non-issue — no service-role Supabase client is constructed
  anywhere in this codebase — but it is a design gap worth closing (a
  distinct branded type, or an assertion) before any later package
  introduces a service-role client alongside these helpers.
- **Resolved, not open:** `invitations.role = 'staff'` combined with a
  non-null `project_id` was previously insertable; this is now rejected
  by the `invitations_staff_not_project_scoped` CHECK constraint in
  `schema/009_invitations.sql`, fixed during Task 10.
- Email delivery of invitations is not implemented — an admin must
  manually copy an invitation's token into a `/invite/<token>` link and
  send it themselves.
- `project_decision_makers` (the Client Approval Rule) does not exist —
  deliberately, an open product decision per `CLAUDE.md`.
- Project-creation/settings/team-management UI does not exist — the
  `/admin/financials` route's "first project in the org" placeholder
  (see `P1-DESIGN.md` §D) stands in for a real project picker.
- **Document download is not yet functional end-to-end.**
  `LocalFilesystemStorageAdapter.getDownloadUrl()` returns a URL for a
  `/api/documents/download-by-key` route that doesn't exist, and the
  actual download route (`/api/documents/[id]/download/route.ts`)
  redirects using a hardcoded `new URL(url, "http://localhost")` base —
  so no configuration today actually delivers file bytes end-to-end.
  The `canViewDocument` authorization gate itself is real and tested; a
  later package must add the missing local-serving route and fix the
  redirect's base URL.
- **`accept_invitation()` does not verify the caller's authenticated
  email matches the invitation's target email** — token possession
  alone is sufficient to accept. Acceptable for a manual-link,
  single-use, 14-day-expiry model, but should be tightened before real
  invitations are sent to real people.
- An authenticated user with the wrong role visiting a route they
  can't access sees the generic error boundary, not a redirect to their
  own home — correct denial, minor UX rough edge.
- `getClientSafeBudgetLines`'s `revisedEstimateCents: row.original_estimate_cents
  + row.approved_changes_cents` arithmetic assumes both values
  deserialize as JS numbers from Postgres/PostgREST — verify this holds
  once real Supabase is connected (a `numeric` column type returned as
  a string would silently become string concatenation instead of
  addition).
