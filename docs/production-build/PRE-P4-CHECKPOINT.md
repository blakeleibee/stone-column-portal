# Pre-P4 Production-Readiness Checkpoint

**Status:** Complete. **Date:** 2026-08-06. Closes the single most
important open item from `docs/milestones/P1-complete.md`'s
"Production-readiness limitations" section: *"No live end-to-end
Supabase Auth verification happened in this package... This is the
single most important thing to verify before trusting this package in
production."* This document does not rewrite that milestone's record —
it supersedes that one specific limitation and stands as the durable
record of what was actually verified.

## 1. Real hosted Supabase project

A real hosted Supabase project (ref `bpgmpafwxnnqpqgyxqyc`, dev tier)
now exists — the first time this repository has ever had one. Prior
work (P1) used PGlite exclusively because no Docker/hosted project was
available in that execution environment.

- Linked locally via `supabase link`; `supabase/config.toml` and
  `supabase/.gitignore` are committed (no secrets — `.temp/`, which
  holds the actual project ref/connection state, is gitignored).
- `.env.local` (gitignored, never committed) holds the real
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
  `SUPABASE_SERVICE_ROLE_KEY` for this project.
- Auth config pushed via `supabase config push`: `site_url`/
  `additional_redirect_urls` corrected to the app's real dev port
  (`127.0.0.1:5173`, not the CLI template's default `3000`);
  `enable_confirmations` set to `false` for this dev project only, so
  signup/login can be verified without standing up real email delivery
  — **this must not carry over to preview/production configs**, which
  should require real email confirmation.

## 2. Migrations 001–012 applied to a real Postgres instance for the first time — two real defects found and fixed

Running the schema against genuine hosted Postgres (rather than PGlite)
surfaced two defects that no prior test run had ever caught:

### 2a. `schema/001_core_financial.sql`: two functions forward-referenced tables not yet created

`is_org_staff()` and `is_project_client()` were declared `LANGUAGE SQL`
and referenced `projects`/`project_members`, both created later in the
same file. The file's own comment claimed Postgres never validates
object references inside a function body at `CREATE FUNCTION` time
"for either `sql` or `plpgsql` language" — true for `plpgsql` (body
stored as an opaque string, checked only at first call), **false for
`LANGUAGE SQL`**, which real Postgres does validate against the catalog
at creation time. PGlite did not enforce this, so it was never caught.

**Fix:** both functions converted to `LANGUAGE plpgsql` (using
`begin ... return ...; end;`), which was always the actual intent per
the file's own comment. This is a direct edit to `schema/001` — a
deliberate, explicit exception to this project's standing "never edit
001–005 in place" rule, made with the user's explicit sign-off, because
migration 001 had never once successfully completed against real
Postgres anywhere; there was no deployed history to protect, and the
defect structurally cannot be fixed by a later forward migration (001
aborts before creating the tables everything after it depends on). All
other `LANGUAGE SQL` functions across every migration (`schema/001`
lines 62/74, `schema/007`, `schema/011`) were audited and confirmed to
only reference tables from already-applied prior migrations — no
further instances of this defect exist.

### 2b. Two extension-dependent functions unreachable under `supabase db push`'s narrower search path

`uuid_generate_v4()` (migration 001, via `uuid-ossp`) and
`gen_random_bytes()` (migration 009, via `pgcrypto`) both failed with
"function does not exist," even after their extensions were confirmed
installed. Root cause: Supabase installs extension objects into a
dedicated `extensions` schema, but `supabase db push` runs each
migration with a search path that doesn't include it (confirmed via
`supabase db query`, which does include `extensions` in its own default
search path, run alongside the failures to isolate the cause).

**Fix — environment-level, not a schema edit:** created
`public.uuid_generate_v4()` and `public.gen_random_bytes(integer)`
wrapper functions delegating to the real extension functions, applied
directly to the hosted project via `supabase db query` before
re-running the push. Both wrappers are correctly marked `volatile`
(an earlier draft mistakenly marked the UUID wrapper `immutable`,
which could have let Postgres cache/reuse a single generated value
across multiple rows — caught and corrected before it was ever used by
a real insert). This is treated as an environment/project-configuration
fix, not a migration-history rewrite, matching how forward-only fixes
are scoped everywhere else in this repo.

## 3. Live auth/RLS verification — 12/12 real checks passed

`scripts/db/live-auth-checkpoint.mjs` (new, committed) exercises the
exact same `@supabase/supabase-js` calls `apps/web`'s real route
handlers make — `auth.signUp`, `auth.signInWithPassword`,
`auth.setSession`, `auth.signOut`, the `bootstrap_organization()`/
`accept_invitation()` RPCs, and ordinary RLS-scoped table queries —
never the service-role client for anything a real user flow does
(service role is used only for teardown, identical in spirit to
`scripts/db/seed.mjs`). Run directly against the real hosted project:

```
PASS — Signup (Org A admin)
PASS — bootstrap_organization() creates org + admin profile
PASS — Login with real password
PASS — Session persistence (stored tokens rehydrate a working session on a new client)
PASS — Logout revokes access (post-logout query returns no row under anon RLS, not an error)
PASS — Admin creates an invitation (RLS-scoped insert, not service role)
PASS — Invitee signs up
PASS — accept_invitation() succeeds and returns the correct org
PASS — Role assignment: invitee's profile has role='staff' in Org A (not self-chosen)
PASS — Second organization (Org B) bootstrapped for isolation testing
PASS — Cross-org isolation (A -> B): Org A admin cannot read Org B's org row or profiles
PASS — Cross-org isolation (B -> A): Org B admin cannot read Org A's org row or profiles

12/12 checks passed.
```

The script cleans up every user/org/invitation it creates on exit
(including on a mid-run failure, verified by an actual partial-failure
run during development of this script) — confirmed zero residue on the
real project afterward via direct query. It is safe to re-run against
any real dev project at any time; it never touches financial/product
data and needs no `ALLOW_SEED`-style guard.

**What this does not cover** (already covered elsewhere, not
duplicated): the Next.js route/redirect layer (`DEMO_MODE` gating,
unauthenticated redirects) is `apps/web/test/auth_smoke.ts`'s job,
already passing. The `BOOTSTRAP_INVITE_CODE` check itself lives in
`apps/web/app/signup/actions.ts`, not in the RPC this script calls
directly, so it isn't exercised here.

**Still not covered** (unchanged, real remaining gaps, not claimed
otherwise): `scripts/db/seed.mjs` still hasn't been run end-to-end
against this project. The sign-up-then-RPC non-atomicity limitation
(`P1-DESIGN.md`) is unchanged — this checkpoint proves the happy path
works for real, not that the known race condition is fixed. Magic-link
login was not exercised (would require receiving a real email).

## 4. Off-device backup

A complete `git bundle --all` (all branches, all history, all three
milestone tags) was created and placed in the actively-syncing
`C:\Users\blake\OneDrive\Backups\stone-column-portal\` folder, verified
valid via `git bundle verify`. This satisfies the off-device backup
requirement while GitHub access remains suspended, with no new
third-party account needed.

## 5. Client approval model

Documented as a per-project, per-record-type configurable rule
(any-one / primary-binding / unanimous) rather than a single fixed
platform behavior — see `docs/production-build/CLIENT-APPROVAL-MODEL.md`
(committed separately, `bcf83d4`). Resolves the open question in
`docs/product-definition/COVERAGE_MATRIX.md` and Exception Register
#12/#37. Documentation only; `project_decision_makers` remains P2/P7/P8
implementation scope.

## Checkpoint outcome

All five items are complete. `docs/production-build/PRODUCTION-ROADMAP.md`'s
statement that **P4 is next** stands — this checkpoint found and fixed
real defects that would otherwise have surfaced for the first time
during P4 (or worse, during a future preview/production deployment),
and P4 can now proceed against a real, verified database instead of an
untested one.
