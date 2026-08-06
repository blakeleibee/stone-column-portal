# P1 — Complete

**Status:** Complete
**Verified commit:** `7145c18`
**Tag:** `p1-complete`
**Completed:** 2026-07-23

## Scope

A consolidated package covering what the original roadmap split across three future packages: schema/RLS validation, real Supabase Auth wiring, and the vendor-identity RLS foundation — reconciled against a broader request against this repo's existing, already-reviewed architecture. Full scope, reconciliation record, and acceptance criteria: `docs/production-build/P1-DESIGN.md` (authoritative — supersedes the old roadmap's separate P1/P2/P3 sections where they conflict). Environment-constraint finding that shaped execution: no Docker/local Postgres/hosted Supabase project available; `@electric-sql/pglite` (real Postgres compiled to WASM) was used instead, verified directly to enforce RLS correctly under role-switching.

## Acceptance criteria — final status

All 12 of `P1-DESIGN.md`'s explicit acceptance criteria are **Met** as of the final whole-branch review and re-verification:

| # | Criterion | Status |
|---|---|---|
| 1 | Every SQL test file passes against PGlite, automated, in `npm run test` + CI | Met |
| 2 | RLS proven (not asserted) for every role pairing, including cross-org staff isolation | Met — a second organization was added to the fixture set specifically to prove this with a real query, after the first pass was found to only assert it via a mock |
| 3 | Schema defects fixed via new forward migration only, `schema/001-005` never edited | Met |
| 4 | `DEMO_MODE=true` reproduces every P0 criterion/test unchanged | Met |
| 5 | `DEMO_MODE` unset → every protected route redirects unauthenticated requests to `/login` | Met |
| 6 | `bootstrap_organization()` unreachable without a valid invite code | Met |
| 7 | Authorization helpers have real allow+deny tests for all 5 negative-path scenarios | Met — the first version of these tests was found to be vacuous (never called real authorization code) and was rewritten via an additive dependency-injection seam |
| 8 | `SupabaseFinancialRepository` fully implemented, independent-aggregate contract real | Met |
| 9 | `documents` table + storage adapters implemented, access enforced and tested | Met (download delivery itself not yet fully wired end-to-end — see limitations) |
| 10 | Every new mutable table writes a real, readable `audit_log` row | Met — closed a real gap where org/profile-level audit rows were written but permanently unreadable under the existing RLS policy |
| 11 | `npm ci`/`typecheck`/`test`/`build` all pass from a clean install | Met |
| 12 | Milestone explicitly lists what remains externally blocked | Met (this document) |

## Verified commands (from a clean install, at `7145c18`)

```
npm ci
npm run typecheck   # 3/3 workspaces clean

# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY set to placeholder
# values for this run — required for middleware/auth code to construct a
# client at all; no real credentials involved.
npm run test         # 7 suites, all pass:
                      #   financial-engine: run.ts + edge_cases.ts (31/31)
                      #   app-shell: render_smoke.tsx (47/47)
                      #   preview-app: route_smoke.ts (41/41)
                      #   test:db — 15 SQL files applied/passed against PGlite
                      #   test:auth — auth_smoke.ts (17/17, real next dev server, both DEMO_MODE states)
                      #   test:authz — authorization_unit.ts (9/9, real auth functions via DI seam)
npm run build         # DEMO_MODE unset: all routes dynamic (real per-request auth)
DEMO_MODE=true npm run build   # reproduces P0's exact static/dynamic split
node scripts/check-fixture-boundaries.mjs   # 82 files, clean
```

## What shipped

- **Database**: `schema/001-005` (~2000 lines, written but never executed before this package) run against a real Postgres engine for the first time ever. Six new forward migrations (006-011): audit triggers on `orgs`/`profiles`/`projects`/`project_members`/`project_fee_rules` (plus an additive RLS policy making org/profile-level audit rows actually readable), `is_project_vendor()` helper, enforced project status transitions, an `invitations` table + `accept_invitation()` RPC, a `documents` table with staff-full/client-published-only/vendor-none RLS, and a `sum_posted_expenses` RPC for genuinely independent financial aggregation.
- **Auth**: real Supabase Auth wired end-to-end — browser/server clients, session-refresh middleware, `/login` (password + magic link), invite-code-gated `/signup`, `/invite/[token]` invitation acceptance — all behind a `DEMO_MODE` flag that reproduces every P0 behavior unchanged when true, and requires real authentication when false/unset.
- **Authorization**: `getCurrentUser`/`requireAuthenticatedUser`/`requireRole`/`requireProjectAccess`/`requireOrganizationAccess`/`canViewProject`/`canManageProject`/`canViewDocument`/`canUploadDocument` — every one resolves through the calling user's own JWT-bearing Supabase client (never service-role), so Postgres RLS is always an independent second enforcement layer. All 14 existing P0 routes plus a new `/vendor` holding route are now genuinely gated.
- **Data access**: `SupabaseFinancialRepository` fully implemented (previously an unimplemented stub); `/admin/financials` proves the whole stack (auth → RLS → repository → financial engine → screen) end-to-end on one real vertical slice.
- **File storage**: `StorageAdapter` interface, a local dev adapter (path-traversal guarded), a documented OneDrive interface boundary, and an authenticated document-download Route Handler.
- **Tests**: `tests/sql/package_p1_auth_tests.sql` (RLS negative-path coverage, including genuine two-organization cross-tenant isolation), `apps/web/test/auth_smoke.ts` (real HTTP route-protection regression across both `DEMO_MODE` states), `apps/web/test/authorization_unit.ts` (fast unit coverage of all 5 required negative-path scenarios against real authorization code).
- **Docs**: `docs/production-build/P1-DESIGN.md` (scope/acceptance criteria/reconciliation record) and `docs/production-build/P1-AUTH-AND-ACCESS.md` (setup, operations, and an honest limitations section).

## Significant findings — during execution (task-level reviews)

Each caught and fixed within its own task, confined to test files or new migrations — `schema/001-005` was never edited:

- **Four independent, pre-existing SQL test-file defects** surfaced by running the schema for the first time ever: a `UNION` enum-cast bug, a missing `GRANT` on a cross-section fixture table, `assert_raises` misused against a silently-blocked RLS update, and a frozen-transaction-timestamp bug.
- **`log_audit()` couldn't be attached to tables without a `project_id` column** (org/profile-level tables) — fixed with two new scoped trigger function variants in the new migration, which then surfaced the audit-visibility RLS gap closed via an additive policy.
- **A Critical financial-repository bug**: three methods (`getCommittedCosts`, `getForecastEntries`, `getFeeLedgerEntries`) returned unmapped snake_case database rows instead of the camelCase shape the financial engine requires — would have silently computed **$0** for committed costs, forecast-to-complete, and fee accrual on every real project. Fixed with correct field mappings, independently field-verified against the schema and interface.
- **A path-traversal gap** in the local file-storage adapter, not exploitable by anything wired up in this package but cheap, worthwhile defense-in-depth — fixed with a containment check.
- **Windows process-management issues** in two new test scripts (fire-and-forget `taskkill`, a `spawn EINVAL` requiring `shell: true`) — fixed, verified not to affect the Linux/CI path.
- **`authorization_unit.ts` was initially vacuous** — 4 of 5 required negative-path tests never called real authorization code, just asserted properties of hand-authored mock data. Fixed with an additive, zero-regression client-injection seam added to the authorization helpers, then rewriting all 5 tests to call real code; also fixed a self-catching bug in the test harness's own `checkThrows` helper.

## Significant findings — final whole-branch review

Caught only because the entire 30-commit range was reviewed together — no single task review could have seen these:

- **`DemoControls`/`SampleDataTag` rendered unconditionally**, even in real non-demo authenticated mode, contradicting the design doc's explicit "never renders outside demo mode" guarantee. Not a privilege escalation (server-side role checks still gated every route), but a real design-guarantee violation and a demo affordance leaking into production UI. Fixed by threading an `isDemoMode` prop into both Chrome components from all 14 admin/client routes.
- **Cross-organization staff isolation — the single most important multi-tenant security property in this schema — was proven only by a mocked client, never by a real query against real Postgres RLS**, because the entire SQL fixture set contained exactly one organization. Fixed by bootstrapping a genuine second organization (via a brand-new, never-before-profiled auth user) and proving isolation bidirectionally with real RLS-scoped queries; a negative-control trace confirmed the new test would actually fail if the underlying RLS helper function were broken.

## Production-readiness limitations (explicit — see `docs/production-build/P1-AUTH-AND-ACCESS.md` for full detail)

- **No live end-to-end Supabase Auth verification** happened in this package — no Docker, no hosted Supabase project available in this execution environment. The auth code follows Supabase's documented Next.js patterns exactly and everything reachable without a live auth backend was actually run and passed, but a real person signing up, logging in, and confirming session persistence has not happened. **This is the single most important thing to verify before trusting this package in production.** **Resolved 2026-08-06** — see `docs/production-build/PRE-P4-CHECKPOINT.md`: a real hosted Supabase project now exists, and signup, login, session persistence, logout, invitation acceptance, role assignment, and cross-org isolation all passed 12/12 against it. Two real defects were found and fixed in the process (a `LANGUAGE SQL` forward-reference bug in `schema/001`, and two extensions unreachable under `supabase db push`'s search path) — neither was catchable by PGlite alone.
- `scripts/db/seed.mjs` was written and schema-cross-checked line-by-line, but never executed end-to-end for the same reason.
- Sign-up-then-RPC is not atomic in `/signup` and `/invite/[token]` — an RPC failure or an accept-invitation race can leave a Supabase Auth user with no matching profile and no self-service recovery path. Documented in both call sites; acceptable for this package's scope, must be revisited before real use.
- `loadViewModels.ts` still serves fixture data unconditionally for every admin/client screen except `/admin/financials`, even outside `DEMO_MODE` — a deliberate P1 scope decision (see `P1-DESIGN.md` §D), not a bug, but real users would see "Hawks Ridge" fixture content on most screens until later packages replace them.
- No type-level barrier prevents a future contributor from passing a service-role client into the authorization helpers' client-injection seam — currently a non-issue (no service-role client exists anywhere in the codebase today).
- Document download is not yet functional end-to-end (the `canViewDocument` authorization gate is real and tested; no route exists yet to actually serve file bytes locally, and the redirect's base URL needs fixing).
- `accept_invitation()` does not verify the caller's authenticated email matches the invitation's target email — token possession alone is sufficient; acceptable for a manual-link, single-use, 14-day-expiry model, should be tightened before real invitations are sent.
- `invitations.role = 'staff'` combined with a `project_id` is now rejected by a CHECK constraint (resolved during execution, not open).

## Detailed execution history

The full task-by-task execution ledger (20 tasks, each with its own implementer/reviewer subagent pair, fix rounds, and commit SHAs, plus the final whole-branch review and its fix round) lived at `.superpowers/sdd/progress.md` during execution — gitignored scratch state, not part of this repository's committed history. This document is the durable record of what happened and why it matters.

## Next milestone

P2+ — see `docs/production-build/PRODUCTION-ROADMAP.md`'s superseded old P2/P3 sections for what remains (project-creation/settings/team-management UI, the Client Approval Rule / `project_decision_makers` — an explicitly open product decision per `CLAUDE.md`, not resolved here — email delivery of invitations, real OneDrive/SharePoint integration, and full fixture-to-real-data replacement across every remaining screen).
