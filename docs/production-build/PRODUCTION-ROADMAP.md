# Production Roadmap

**Status:** P0 complete (`p0-complete` tag, commit `54f05a3`) — see
`docs/milestones/P0-complete.md`. **P1 complete** (`p1-complete` tag,
commit `7145c18`) — see `docs/milestones/P1-complete.md` for the
closeout record (final acceptance-criteria status, verified commands,
and the significant findings — including two caught only by the final
whole-branch review — found and fixed during execution; details are
not duplicated here). P1 consolidated the old P1 (schema/RLS
validation), P2 (auth wiring), and P3's vendor-identity slice into one
package — see `docs/production-build/P1-DESIGN.md` for the
reconciliation record. **P2.1 (Financial Master Data & Project Setup)
complete** (`p2.1-complete` tag) — see
`docs/production-build/P2.1-DESIGN.md` and
`docs/milestones/P2.1-complete.md`. This was not one of the brief's
original P0-P15 packages; it was inserted between P1 and P4 because P4
(Estimating & Budgeting UI) needs real cost-code granularity to build
against, and
`docs/production-build/WORKBOOK-GAP-ANALYSIS.md` (an approved gap
analysis comparing this portal against Stone Column's actual cost-plus
Excel workbook) found that granularity didn't exist yet — see that
document for the full comparison. **P4 (Estimating & Budgeting UI +
QuickBooks Desktop Import) complete** (`p4-complete` tag) — see
`docs/production-build/P4-DESIGN.md` and `docs/milestones/P4-complete.md`.
Built after two permanent cross-package architecture decisions were
established: `docs/production-build/FINANCIAL-ARCHITECTURE.md` (the
project + cost-code ledger as the permanent financial backbone) and
`docs/production-build/AI-ASSISTANT-ARCHITECTURE.md` (business logic
exposed as repository/service functions a future AI layer can reuse).
**The next package is P5.**

Replaces the "Package 3 onward" portion of
`docs/product-definition/05-implementation-roadmap.md` with small,
reviewable **production** packages. Packages 1–2 (financial engine,
app shell) remain approved as prototype/UX reference, unchanged in
scope; the old roadmap's "Phase 2 Expanded Interactive Prototype"
checkpoint is **superseded** by this document per the direction that
started this work — no further prototype-only expansion is planned.

Every package below states exact scope, real workflows made
functional, schema/migration changes, RLS, server-side operations, UI
screens connected to live data, fixture behavior removed or retained,
audit events, tests, CI requirements, deployment requirements,
acceptance criteria, dependencies, and explicit exclusions. No package
is "build the backend" or "make the portal functional" — if a line
below reads that vaguely, it's a bug in this document, not a
deliberate scope.

## Recommended change to the given package order

The brief's suggested P0–P3 order is followed exactly as given, with
**one addition to P3's stated scope**: the vendor identity/RLS
foundation. The old roadmap explicitly placed this in Package 3
specifically so that Commitments/Bids (this roadmap's P5) never has to
introduce a new security boundary under time pressure — but the actual
schema audit (`PRODUCTION-READINESS-AUDIT.md`, Modules 12–13) found
that foundation was **never actually written**, only the `'vendor'`
enum value and a check constraint exist. Since P5 in this roadmap
still references vendor-assigned bids (same as the old roadmap's
Package 5), the same reasoning still applies, and P3 below includes it
as new scope, not an inherited-and-already-done item.

**Vendor RLS sequencing, stated precisely (corrected for clarity):**
1. **P3 establishes vendor identity, project membership, and
   visibility of the vendor's own membership record** — the
   `is_project_vendor(project_id)` helper, and exactly one policy
   consuming it: a vendor can read their own `project_members` row.
   Nothing more.
2. **P3 does not add vendor access policies broadly to unrelated
   existing financial tables** — `expenses`, `budget_ledger`,
   `committed_costs`, `forecast_entries`, `fee_ledger` and the rest
   stay staff/client-only exactly as they are today. There is no
   vendor policy on any of these tables until a package that actually
   needs one adds it.
3. **Each later package adds narrowly scoped vendor policies only to
   the tables vendors genuinely need** — in that table's own migration,
   at the time that table is created, not as a batch of speculative
   vendor policies added early "to save a step later."
4. **P5 extends the already-established vendor identity boundary for
   its new bid/procurement tables** (`bid_packages`, `bid_submissions`,
   `bid_questions`, `bid_addenda`) — it calls the P3
   `is_project_vendor()` helper in its own new policies; it does not
   define vendor identity itself, and it does not touch any table
   outside its own new ones.
5. **Every vendor policy, at every package, receives an explicit
   cross-project and cross-vendor isolation test** — "Vendor A on
   Project 1 sees nothing on Project 2" and "Vendor A sees nothing
   belonging to Vendor B on the same project" are both required, not
   just the single-axis version of the test. This applies from P3
   onward, not only at P11 when the vendor-facing UI ships.

No other reordering is recommended: `budget_ledger.source_type`/
`source_id` and `committed_costs.source_type`/`source_id` are
deliberately untyped free-text/uuid pairs (not FKs) specifically so
Commitments, Draws, and Change Orders can each land independently
without forcing a schema-level dependency between them — the given
order (Estimate/Budget → QuickBooks → Commitments → Draws → Change
Orders → Selections → Documents/Signatures → Schedule → Client Portal →
Vendor Ops → remaining) has no hard schema blocker forcing a different
sequence, and matches the old roadmap's own dependency graph
(Package 6 before Package 7, Package 5 before Package 11) exactly.

---

## Package P0 — Production foundation and environment verification

**Status: Complete.** Tag `p0-complete`, commit `54f05a3`. Full
closeout record: `docs/milestones/P0-complete.md`.

- **Exact scope:** No product feature work and no broad visual
  redesign. Establishes the scaffolding every later package depends
  on, **including migrating the existing UI into Next.js** (per
  `TARGET-ARCHITECTURE.md` §5.1, corrected from the previous version
  of that document, which had left this as an open, deferrable
  decision — it is now P0 scope).
- **User workflows made genuinely functional:** None yet — this
  package is infrastructure only. The Next.js migration is a hosting/
  framework change, not a new workflow.
- **Schema/migration changes:** None.
- **Permissions/RLS policies:** None new.
- **Server-side operations:** None new (the Next.js server/client
  component boundary is established structurally in this package, but
  no route performs a privileged mutation yet — that starts in P2).
- **UI screens connected to live data:** None. Every screen keeps its
  current fixture/sample-data source through this package — only the
  framework/build system underneath changes.
- **Fixture behavior removed/retained:** Retained as-is; the migration
  moves `apps/web`'s existing components into a Next.js app structure
  without changing what data source any of them use yet.
- **Audit events:** None new.
- **Tests:**
  - Re-confirm `npm ci`/`typecheck`/`test`/`build` pass on the actual
    target Node version (already verified: Node v24.18.0 locally,
    `engines: >=18.0.0` declared — confirm CI pins a specific supported
    version rather than "whatever's latest," since ">=18" is wide).
  - Add a smoke test (or CI step) that fails the build if any
    `.env*` file other than `.env.example` is ever committed.
  - **Route and rendering regression tests**, added as part of the
    Next.js migration: every existing `activeKey`/screen combination
    that `render_smoke.tsx` already asserts on today must render
    equivalently under its new Next.js route, using the migration as
    the trigger to convert `AppShell`'s `activeKey`/`onNavigate` props
    into real Next.js routes for the first time (closing the "no
    client-side router exists" gap flagged in the audit) — this is
    the acceptance bar for "no broad redesign," not a subjective
    visual review.
- **CI requirements:** Extend `.github/workflows/ci.yml` (already
  passing) with: environment-variable-template validation; a step that
  fails if fixture data (`sampleContent.ts`, `fixtures/hawksRidge.ts`)
  is imported from anywhere outside `apps/web`'s own demo path or a
  test file (extending the existing grep-based check in
  `packages/02-app-shell/test/render_smoke.tsx` to cover the whole
  repo); and the Next.js build/typecheck/test commands replacing (not
  running alongside) the current esbuild-based ones once the migration
  lands.
- **Deployment requirements:** `vercel.json` updated for a Next.js
  build (framework detection, build/output settings) — this is the
  "deployment configuration update" the migration requires; still
  Vercel, still the same project, no new environment.
- **Acceptance criteria:**
  1. `.env.example` exists at repo root, documents every variable name
     `TARGET-ARCHITECTURE.md` §10 identifies, contains zero real
     values, and is the **only** `.env*` file tracked in git.
  2. Local/preview/production are documented as three genuinely
     separate Supabase projects (even before P1 creates the local one)
     — a written runbook, not yet a live project.
  3. A minimal React error boundary wraps the app shell so a single
     screen's thrown error shows a fallback, not a blank page (closes
     the "no error states anywhere" gap flagged in the audit).
  4. A basic structured-logging/monitoring plan is written (which
     Vercel/Supabase built-ins are used at minimum; whether a paid
     error-reporting service is added is a genuine remaining owner
     decision — see the PR description's executive summary).
  5. Every existing "Preview only" and "not yet functional" label is
     re-confirmed still accurate; the two misleading dead-control
     buttons (Selections "Review & Approve," Documents "Download") are
     either given a visibly disabled state or their button element is
     removed until their real package lands — a rendered, clickable,
     no-op primary action is not acceptable to carry into a
     production-labeled build.
  6. **The existing UI is migrated into Next.js with no broad
     redesign** — the approved visual language (design tokens,
     layout, `AppShell` chrome), navigation structure, financial
     logic, and construction terminology are preserved exactly;
     the change is structural (framework, routing, server/client
     boundary), not visual or product scope.
  7. **Server/client component boundary is established**: data-fetching
     and any future privileged logic live in Server Components/Route
     Handlers; interactive UI (the demo role switcher's eventual real
     replacement, form state, mobile drawer/sheet open-close state)
     stays in Client Components — this boundary is drawn now, before
     P2 has real mutations to place on the correct side of it.
  8. **Route and rendering regression tests pass**: every screen
     reachable today (Overview, Financials, Action Center,
     Conversations, Contacts, Settings, and every `ProjectWorkspace`
     tab, on both admin and client) renders under its new real URL
     route with equivalent content to today's `activeKey`-based
     render, verified by the tests described above, not by manual
     click-through alone.
- **Dependencies:** None.
- **Explicit exclusions:** No new tables, no auth, no real financial
  writes, no external service connections of any kind. No product
  scope change, no new screens, no visual redesign — this package
  changes *how* the existing approved UI is served, never *what* it
  looks like or does.

## Package P1 — Database and security validation

**Status: Complete** (`p1-complete` tag, commit `7145c18`) — scope
superseded by `docs/production-build/P1-DESIGN.md`, which is the
authoritative record of what P1 actually became: it consolidated this
section, the auth-wiring portion of Package P2 below, and the
vendor-identity slice of Package P3 below into one package. See
`docs/milestones/P1-complete.md` for the closeout record. The section
below is retained as the original, narrower schema-validation-only
scope for historical reference.

- **Exact scope:** Execute the existing, already-written schema for
  the first time ever against a real disposable Postgres/Supabase
  instance, and validate it — not extend it, except to fix defects
  found.
- **User workflows made genuinely functional:** None yet — still no
  UI wired to real data.
- **Schema/migration changes:** Run `001`–`005` (forward) as-is
  against a local Supabase CLI stack. Any defect found is fixed via a
  **new forward migration** (`006_*.sql` onward) — never by editing
  `001`–`005` in place, per the standing instruction not to rewrite
  migration history.
- **Permissions/RLS policies:** Validate every existing policy
  (`orgs_select_own_org`, `profiles_select_self_or_org_staff`,
  `projects_staff_full_access`/`_client_read`,
  `expenses_staff_full_access`/`_client_read`, all the rest) against
  real seeded test users with real JWTs — not just read the SQL and
  reason about it, which is all that has ever happened to this schema
  so far.
- **Server-side operations:** Validate `bootstrap_organization()`,
  `supersede_committed_cost()`, `supersede_forecast()`, and every
  trigger (`enforce_expense_state_transition`,
  `enforce_reversal_magnitude`, `reject_profile_self_escalation`,
  `log_audit`, etc.) actually behaves as documented under real
  transactions, real concurrent writes.
- **UI screens connected to live data:** None yet.
- **Fixture behavior removed/retained:** Retained; `apps/web` still
  runs on fixtures during this package.
- **Audit events:** Confirm `audit_log` actually populates correctly
  for every triggered table, with real `actor_id`/`before_data`/
  `after_data` — not just confirm the trigger exists.
- **Tests:**
  - Run `tests/sql/000_bare_postgres_bootstrap.sql`,
    `tests/sql/package1_tests.sql`,
    `tests/sql/committed_forecast_hardening_tests.sql` for the first
    time ever, against a real instance. Fix and re-run until green.
  - Add automated (not manual/one-off) database + permission tests
    that run in CI against a real ephemeral Postgres, per instruction
    — a GitHub Actions Postgres service container or the Supabase CLI
    in CI, decided during this package.
  - Full `up → down → up` reapply cycle test for every migration pair.
- **CI requirements:** New CI job: spin up ephemeral Postgres, apply
  all migrations, run the SQL test suite, tear down. Must be green
  before this package is considered complete.
- **Deployment requirements:** Provision the actual local Supabase CLI
  project (§1 of `TARGET-ARCHITECTURE.md`). Preview/production Supabase
  projects are **not** created yet — that's P2 (Supabase Auth needs a
  real project to authenticate against, but P1's validation can run
  entirely against a disposable local/CI instance).
- **Acceptance criteria:**
  1. Every SQL test file in `tests/sql/` passes against a real
     Postgres instance, in CI, on every PR.
  2. Any defects discovered must be corrected through new forward
     migrations and documented. Finding no defect does not prevent
     acceptance if all execution, RLS, transaction, concurrency,
     migration, and rollback tests pass.
  3. RLS is proven, not asserted: a real test user with role `client`
     cannot read another project's `expenses` row, and a real test
     user with role `staff` cannot read another org's `projects` row,
     via actual queries against actual RLS, not code review.
- **Dependencies:** P0 (CI/environment scaffolding).
- **Explicit exclusions:** No new product tables (leads, selections,
  etc.) — this package validates what already exists in
  `schema/001`–`005` only. No auth UI. No production Supabase project.

## Package P2.1 — Financial Master Data & Project Setup

**Status: Complete.** Tag `p2.1-complete`. Full design record:
`docs/production-build/P2.1-DESIGN.md`. Closeout record:
`docs/milestones/P2.1-complete.md`. Not one of the brief's original
P0-P15 packages — inserted here after
`docs/production-build/WORKBOOK-GAP-ANALYSIS.md` (comparing this portal
against Stone Column's actual cost-plus Excel workbook,
`docs/reference/Stone_Column_Cost_Plus_Blank_Template.xlsx`) found the
portal's cost-code model was far coarser than the real business's
(18 broad categories vs. the workbook's 113 numbered codes across 7
divisions) — a gap P4 (Estimating & Budgeting UI) would otherwise have
built real UI on top of.

- **Exact scope:** Schema/master-data only — normalized `divisions`;
  all 113 workbook cost codes with activity names, and the two
  independent `include_in_estimate`/`billable` flags (distinct from the
  pre-existing `fee_eligible`); project financial setup fields (deposit
  %, estimate/invoice numbering, draw counter, estimate terms text);
  organization billing identity; client billing/contact information; a
  credit-applied tracking ledger structure; a vendor master table.
  **No UI, no estimates, no vendor quotes, no change orders, no
  QuickBooks import wiring, no draws, no invoices, no invoice lines** —
  all of those remain later packages' scope, per
  `docs/production-build/WORKBOOK-GAP-ANALYSIS.md` §7.
- **Schema/migration changes:** `schema/012_financial_master_data.sql`
  (+ down). New tables: `divisions`, `vendors`,
  `project_financial_settings`, `project_clients`, `credit_ledger`,
  `division_templates`, `cost_code_templates`. Extends `cost_codes`
  (+5 columns) and `orgs` (+7 billing-identity columns, +1 new UPDATE
  policy — previously bootstrap-only). New RPC:
  `apply_standard_cost_code_template(project_id)`.
- **Permissions/RLS policies:** Every new table RLS-enabled from
  creation, `to authenticated` only, following the exact staff-full/
  client-read or staff-only patterns already established in
  schema/001-011. Full detail in `P2.1-DESIGN.md`.
- **Tests:** `tests/sql/package_p2_1_financial_master_data_tests.sql` —
  9 sections, run for real against PGlite via
  `scripts/db/run-sql-tests.mjs` (all 17 SQL files, migrations 001-012
  plus every test suite, pass together in one session).
- **Acceptance criteria:** All met — see `P2.1-DESIGN.md`'s "How this
  was verified" section for the exact verification performed, and its
  "Unresolved decisions"/"Known limitations" sections for what was
  deliberately flagged rather than resolved.
- **Dependencies:** P1.
- **Explicit exclusions:** Estimates, vendor quotes, change orders,
  QuickBooks import, draws, invoices, invoice lines — all remain future
  packages' scope (P4 onward).

## Package P2 — Authentication, company membership, and project access

**Status: Auth-wiring/invitations content delivered as part of P1 (complete)
— see `docs/production-build/P1-DESIGN.md` and
`docs/milestones/P1-complete.md`.** `project_decision_makers` was
explicitly excluded from P1 (open product decision, per `CLAUDE.md`)
and remains this section's (future) scope once that decision is made.
Project-creation/settings/team-management UI is also still this
section's/Package P3's future scope — P1 only built the data/auth
foundation, not this product UI.

- **Exact scope:** Real Supabase Auth wiring end-to-end; the
  `DemoControls` role switcher is removed from any authenticated
  build path.
- **User workflows made genuinely functional:** Sign up (gated —
  see acceptance criteria), log in, log out, session persistence,
  invite a team member, accept an invitation, assign a role, designate
  an authorized client decision-maker.
- **Schema/migration changes:**
  - New migration: audit triggers on `projects`, `project_members`,
    `project_fee_rules` (missing today — flagged in the audit).
  - New migration: `project_decision_makers` table implementing the
    preserved Client Approval Rule (`project_id`, contact reference,
    `is_authorized`, designation metadata) — RLS-enabled, audited, from
    its first migration.
  - New migration: `invitations` table (token, email, role, project
    scope if applicable, expiry, accepted/revoked state).
- **Permissions/RLS policies:** `project_decision_makers` and
  `invitations` both RLS-enabled with `to authenticated`-scoped
  policies from creation. `bootstrap_organization()` gated behind an
  invite code or manual-approval flag before this package is
  considered complete for production use (per its own SQL comment).
- **Server-side operations:** Invitation-send Next.js Route Handler
  (using the server runtime established in P0 — see
  `TARGET-ARCHITECTURE.md` §5.1) emailing an invite link, calling a
  Postgres RPC for the actual row insert; invitation-accept flow
  creating the `profiles` row; decision-maker designation RPC
  (admin/staff only). All of these run under the ordinary
  user-JWT-and-RLS access pattern (§5.2) except the invite email send
  itself, which needs an email-provider credential and is one of the
  narrow, explicitly-justified service-role/privileged-credential
  cases per §5.2's enumerated list.
- **UI screens connected to live data:** Login/logout, a minimal
  "Team & Invitations" screen, a minimal "Decision Makers" designation
  UI on the project. `DemoControls.tsx` is deleted from any build with
  auth enabled — not hidden behind a flag, removed.
- **Fixture behavior removed/retained:** The role switcher (fixture
  auth) is removed. Financial screens still run on
  `FixtureFinancialRepository` until P3/P4 — auth existing does not by
  itself give those screens real project data yet.
- **Audit events:** Every invite sent/accepted/revoked; every
  decision-maker designation change; every role assignment change
  (already covered by `reject_profile_self_escalation` at the trigger
  level — needs a UI-level audit view eventually, not new logging
  logic).
- **Tests:** Real login/logout integration test against the P1
  Postgres+Auth stack; RLS test proving an invited user only ever
  lands with the role/project scope they were invited to; self-
  escalation rejection test (already schema-level, confirm it holds
  through the real auth path too).
- **CI requirements:** CI now needs a real (ephemeral, per-run)
  Supabase Auth-enabled instance, not just bare Postgres — extends
  P1's CI job.
- **Deployment requirements:** First real preview/staging Supabase
  project created here (auth needs somewhere real to point at).
  Production Supabase project still **not** created yet.
- **Acceptance criteria:**
  1. A real user can sign up (through whatever gate is chosen),
     log in, and land on a role-appropriate (still mostly placeholder)
     screen with zero use of `DemoControls`.
  2. An invited user cannot self-assign a different role or org.
  3. A designated authorized decision-maker record exists and is
     queryable, satisfying every bullet of the preserved Client
     Approval Rule at the data-model level (multiple contacts,
     explicit designation, per-project/per-record-type configurability
     as a forward-compatible shape even though no record type consumes
     it yet).
- **Dependencies:** P1.
- **Explicit exclusions:** No SSO. No investor/lender roles yet
  (P12). No real financial mutation UI yet.

## Package P3 — Production project foundation ("Project & Staff Access Foundation")

**Status: Implemented, independently reviewed, and live-verified against
the real hosted dev Supabase project; sitting at an owner-preview
checkpoint as of 2026-08-20** (a completion pass covering UI/UX
polish and one remaining security guard — archived-project team
management by direct URL — is in progress before final acceptance).
Not yet merged into `p5-commitments-bids-procurement`, no `p3-complete`
tag. Full design record: **`docs/production-build/P3-DESIGN.md`**,
pulled forward ahead of P5 Task 7 by explicit owner decision
(2026-08-19). That document supersedes this section's bullet list below
with exact schema/RLS/tests/acceptance-criteria detail, the same way
`P4-DESIGN.md`/`P5-DESIGN.md` supersede their own sections — this text
is retained for historical continuity, not as the current spec. It also
closed a gap this roadmap previously left open:
`SECURITY-AND-PERMISSIONS-MATRIX.md`'s long-flagged `staff_function`
(PM/Superintendent/Accounting) differentiation and the resulting
audit-log over-exposure correction, neither of which this section
originally named, are now part of P3's scope. **P3's real project-
creation flow is also Step 1 ("Project identity") of the owner's
2026-08-20 progressive project-setup workflow** (identity → estimate/
budget → cost codes/subcategories → specs/selections → client/team →
QuickBooks connection → schedule → documents) — the remaining seven
steps belong to their own respective future packages (P4.1 for cost
codes/subcategories, P4.3/P4.4 for a real estimate-at-creation step and
QuickBooks connection respectively, P8 for selections, P9 for schedule/
documents), and are explicitly **not** built by P3 — P3's own creation
form ends with a lightweight, static setup checklist showing what's
done and what's coming later, never a fake in-progress workflow for
steps that don't exist yet. Thin Leads intake, thin Company Templates, and the baseline
backup/retention policy — old Package 3's other named items — remain
explicitly **not** part of P3 as redefined; see
`P3-DESIGN.md`'s Exclusions and
`PRODUCT-COMPLETENESS-MATRIX.md` Section D for their status.

- **Exact scope:** Real project CRUD and lifecycle, plus (per the
  recommended change above) the vendor identity/RLS foundation.
- **User workflows made genuinely functional:** Create a project,
  edit project settings/contract type, add/remove team members and
  set their project-level permissions, add/remove client and vendor
  contacts, change project status (draft → active → on_hold →
  closed_out → archived) with enforced valid transitions, archive/
  pause/reactivate.
- **Schema/migration changes:**
  - New migration: enforced status-transition trigger on `projects`
    (the `project_status` enum exists; no transition-validity trigger
    exists yet, unlike the expense state machine's own precedent).
  - New migration: `is_project_vendor(project_id)` helper function +
    exactly one new policy consuming it — a vendor may read their own
    `project_members` row, nothing else. **No vendor policy is added
    to any other table in this package** (see "Vendor RLS sequencing"
    above) — no vendor product screens ship until P11, matching the
    old roadmap's own "foundation only" framing, and no other table's
    RLS is touched by this migration.
- **Permissions/RLS policies:** Vendor baseline ("vendor sees nothing
  except their own membership row") tested from this package forward,
  per the recommended-change rationale above — this is the whole of
  P3's vendor scope, deliberately minimal.
- **Server-side operations:** Project-create RPC (validates
  project-number uniqueness per org, GMP amount/flag consistency —
  already enforced at the CHECK-constraint level, RPC just surfaces
  clean errors); status-transition RPC; team-member add/remove RPC.
- **UI screens connected to live data:** Project creation wizard,
  project settings screen, team/permissions screen, Contacts screen
  (replacing its current fixture-plus-hardcoded-contact data).
- **Fixture behavior removed/retained:** `ContactsScreen` moves off
  `projectMeta`/`CONTACT` fixtures onto real `project_members`/
  `profiles` queries. Financials screens still remain fixture-backed
  until P4 (this package does not touch cost codes/budget).
- **Audit events:** Every project create/edit/status-change/
  archive/reactivate.
- **Tests:** Status-transition validity test (reject an invalid jump,
  e.g. `draft → closed_out` directly); vendor-isolation RLS tests on
  **both axes** required by the vendor RLS sequencing above —
  cross-project ("Vendor A sees nothing on a project they're not a
  member of," extending the exact test class Package 1 already wrote,
  now runnable for real since P1 executed the schema) and cross-vendor
  ("Vendor A sees nothing belonging to Vendor B on the same project").
- **CI requirements:** Extends P1/P2's Postgres+Auth CI job with the
  new migrations; vendor-isolation test added to the required suite.
- **Deployment requirements:** No new environment; still on the P2
  preview/staging Supabase project.
- **Acceptance criteria:**
  1. A real project can be created, edited, and its status changed
     through enforced valid transitions only, with a full audit trail.
  2. A vendor test account, added to Project A only, cannot read any
     row scoped to Project B, verified by an actual query, not review.
     A second vendor test account, also added to Project A, cannot
     read the first vendor's `project_members` row either.
  3. Contacts screen shows real project team/client data, zero
     hardcoded names.
- **Dependencies:** P2.
- **Explicit exclusions:** No cost codes/budget UI (P4). No leads
  pipeline beyond the thinnest intake-and-convert-to-project flow
  (matches old roadmap's "thin Leads" scope, completing in P14). No
  vendor-facing screens (P11) — foundation only, per instruction.

---

## Packages P4 and onward

Each following package inherits the same required-field structure;
written more compactly since the pattern is now established, but with
no less specificity in scope, dependencies, and exclusions.

**Every package below is constrained by
`docs/production-build/FINANCIAL-ARCHITECTURE.md`**: the project +
cost-code ledger is the permanent financial backbone, and new financial
concepts (commitments, change orders, selections, draws, invoices,
payments, retainage, vendor invoices) reference it via new tables and
the registered `source_type` provenance convention — never a parallel
financial model. That document also confirms, package by package, that
none of P5–P13 requires restructuring `budget_ledger`/`expenses`/
`committed_costs`/`forecast_entries`/`cost_codes`, with one flagged
exception (`fee_ledger.source_type`'s closed CHECK constraint, which
would need an ordinary additive migration if a new fee-triggering event
type is ever introduced).

**Every package below is also constrained by
`docs/production-build/AI-ASSISTANT-ARCHITECTURE.md`** (see also
`TARGET-ARCHITECTURE.md` §14): business logic is exposed as a
repository (reads) and plain service functions (writes) that Server
Actions wrap thinly, so P15 (Project Intelligence Assistant) can later
call the same functions the UI calls, under the same asking user's
session — no package builds a service-role shortcut or a
duplicate-logic path for the assistant to use later.

### Package P4 — Estimating & Budgeting UI + QuickBooks Desktop Import

**Status: Complete.** Tag `p4-complete`. Full closeout record:
`docs/milestones/P4-complete.md`. Built via subagent-driven development
(12 tasks, fresh implementer + independent reviewer per task) per
`docs/superpowers/plans/2026-08-06-p4-estimating-budgeting-qbimport.md`.
**The next package is P5.**

- **Scope:** Real cost-code/budget-ledger entry UI (replacing
  read-only `AdminFinancialsScreen`/`ClientBudgetAndInvoicesScreen`
  fixture wiring with `SupabaseFinancialRepository`, fully
  implemented for the first time); QuickBooks Desktop file-based
  import wizard with duplicate detection and pending→posted review.
- **Workflows made functional:** Create/edit cost codes; enter
  original estimate and approved-change ledger lines; import a
  QuickBooks report file, review/map/confirm import rows, post
  reviewed expenses.
- **Schema/migrations:** `import_mapping_profiles` (new, per old
  roadmap). `import_batches`/`import_rows` (already exist, unexecuted
  until now) come online for real.
- **RLS:** `cost_codes_staff_full`, `budget_ledger_staff_*`,
  `expenses_staff_full_access`, `import_batches_staff_only`,
  `import_rows_staff_only` — all already designed, now actually
  exercised by a real import flow for the first time.
- **Server-side operations:** Import-file parser, running as a Next.js
  Route Handler on the server runtime established in P0 (see
  `TARGET-ARCHITECTURE.md` §5.1); category-rollup and independent-
  control-total real SQL implementations, finally retiring
  `SupabaseFinancialRepository`'s stub status.
- **UI screens connected to live data:** `AdminFinancialsScreen`,
  `ClientBudgetAndInvoicesScreen`, new import wizard screens.
- **Fixture behavior removed:** `FixtureFinancialRepository` is no
  longer the repository `apps/web` wires up for these screens in any
  build claiming to be production — it is retained **only** as a test
  fixture (see `DATA-MIGRATION-AND-FIXTURES.md`).
- **Audit events:** Every ledger entry, every posted expense, every
  import batch confirm/cancel.
- **Tests:** Import duplicate-detection test against realistic sample
  QuickBooks export files; pending→posted gate test; the
  now-no-longer-stubbed independent-control-total actually catches a
  1-cent discrepancy end-to-end (the fixture-level version of this
  test already exists and passes — this is the same guarantee, proven
  against a live query instead).
- **Action Center events added:** Unmapped QuickBooks costs; budget
  overruns.
- **CI requirements:** Import-file fixtures checked into
  `tests/fixtures/quickbooks/` (or similar), exercised in CI.
- **Deployment requirements:** None new.
- **Acceptance criteria:** A real cost code, entered through the UI,
  appears correctly in both admin and client-safe views with figures
  matching the engine's computation, end to end through a live
  database — no fixture involved anywhere in the path.
- **Dependencies:** P3, P2.1 (divisions/cost-code master data and
  `apply_standard_cost_code_template()` already exist — this package
  builds the entry UI and QuickBooks import on top of them, it does not
  design the cost-code model itself).
- **Exclusions:** No live QuickBooks API (file-based only, per
  instruction — QuickBooks Desktop has no live cloud API to begin
  with). No commitments/bids yet (P5).

### Package P4.1 — Cost Code Breakdown (Detailed Budget Foundation)

**Status: Design complete, not yet approved for implementation.** Full
design record: `docs/production-build/P4.1-DESIGN.md`. Inserted here
(not part of the original P0–P15 brief) after the owner's explicit
"every project cost code must optionally support customizable child
budget items" requirement (2026-08-15), reconfirmed and unchanged by
the broader 2026-08-20 "detailed budget foundation" requirement — see
`FINANCIAL-ARCHITECTURE.md`'s "Detailed budget foundation" section,
which confirms the existing design already satisfies it in full.

- **Scope:** `cost_code_children` (new table: project-specific,
  renameable, reorderable, archivable breakdown rows under a canonical,
  QuickBooks-mapped parent cost code); nullable `cost_code_child_id` on
  `budget_ledger`, `expenses`, `committed_costs`, `forecast_entries`,
  `bid_packages`, `material_order_line_items`.
- **Dependencies:** P4 (cost codes/budget ledger to extend), P5 Tasks
  1–2 (the `committed_costs`/`bid_packages`/`material_order_line_items`
  schema this package's RPC changes touch).
- **Exclusions:** No client-facing child visibility. No QuickBooks
  auto-resolution of children (import stays parent-level; manual
  post-import reassignment only). No order-level convenience child
  default on `material_orders` (line-item level only).
- **Sequencing note:** independent of P5's own remaining UI tasks —
  implementing this before or after P5 Task 7 resumes is an owner
  timing choice, not an architectural dependency either way (P5 Task 7
  itself is blocked on P3, not on P4.1 — see P3's own status above).

### Package P4.2 — Historical Pricing Intelligence & Comparable-Project Library

**Status: Not yet designed.** Recorded here per the owner's 2026-08-20
"historical pricing intelligence" requirement — full detail in
`FINANCIAL-ARCHITECTURE.md`'s "Planned: historical pricing intelligence"
section.

- **Scope (expected):** A read-only analytical layer surfacing, per
  cost code/child item: average historical cost, low/high range, most
  recent cost, unit cost where applicable, source projects and dates,
  whether the source is an estimate/bid/commitment/actual, a
  confidence score based on relevance and sample size, and transparent
  time/inflation adjustments. Completed-job actuals weigh more heavily
  than old estimates, but every suggestion remains explainable and
  owner-editable — no suggestion is ever auto-applied (existing
  `budget_suggestions` governance, unchanged).
- **Dependencies:** P4 (cost codes, budget ledger, QuickBooks actuals),
  P4.1 (child-item granularity to report on), P5 (vendor bids,
  commitments as additional historical data sources).
- **Exclusions:** No writes to `budget_ledger` or any backbone table.
  No new source of truth for any dollar amount — pure read/aggregate
  layer over data that already exists.

### Package P4.3 — Tiered Pricing, Estimate Templates & Suggestion Engine

**Status: Not yet designed.** Recorded per the owner's 2026-08-20
"tiered pricing" requirement.

- **Scope (expected):** Reusable Value/Standard/Premium pricing tiers,
  applied per cost item/specification (never a whole-project
  multiplier — a project may mix tiers across different line items).
  Project setup eventually captures project type, square footage,
  location, target tier, pricing model, and an optional comparable
  project/template, and may generate a draft estimate showing suggested
  values, historical ranges, sources, dates, adjustments, and missing/
  low-confidence warnings — a draft a human reviews, never a budget the
  system silently approves or revises.
- **Dependencies:** P4.1 (the child-item level a tier attaches to —
  see `FINANCIAL-ARCHITECTURE.md`'s note that this package must confirm
  the exact attachment point once real P4.1 rows exist), P4.2
  (historical data the suggestion engine draws on).
- **Exclusions:** No automatic budget approval or revision — every
  generated draft requires explicit human acceptance, matching the
  existing `budget_suggestions` non-negotiable.

### Package P4.4 — Controlled QuickBooks Budget/Estimate Export & Actual-Cost Feedback

**Status: Not yet designed — and deliberately cannot be fully designed
yet.** Recorded per the owner's 2026-08-20 QuickBooks-export
requirement; full constraint detail in `FINANCIAL-ARCHITECTURE.md`'s
"Planned: budget export to QuickBooks" section.

- **Scope (expected):** Controlled, versioned export of an *approved*
  budget/estimate snapshot (never a draft) to the mapped QuickBooks
  Customer:Job, via explicit parent-cost-code-to-QuickBooks-item/account
  mapping. Detailed P4.1 children roll into their mapped parent for
  export unless an equivalent QuickBooks item exists. Export history is
  versioned (user, timestamp, project, budget version, mapping version,
  output, result), idempotent, pre-export-validated, and
  post-import-reconciled, with clear error reporting and a backup
  warning before any IIF import. No budget is ever independently
  editable in both systems.
- **The one genuine open owner decision this package cannot start
  without:** whether the correct QuickBooks target is a QuickBooks
  Estimate, a job-specific QuickBooks Budget, or both for distinct
  reporting purposes. **Explicitly deferred** until this package's own
  design pass inspects Stone Column's actual QuickBooks Desktop
  Enterprise Contractor setup or a representative export — the same
  "inspect the real system before designing against it" discipline
  `WORKBOOK-GAP-ANALYSIS.md` already used for P2.1. Do not guess this
  decision in advance of that inspection.
- **Dependencies:** P4.1 (parent/child structure to map), P4.2/P4.3
  (richer estimate data worth exporting, though not a hard technical
  blocker — this package's own design should confirm whether export can
  usefully ship before P4.2/P4.3 land, since the owner's proposed
  sequence places it last but the dependency is soft, not hard).
- **Exclusions:** No live QuickBooks API — file-based (IIF or
  equivalent) only, matching P4's own QuickBooks-import precedent, since
  QuickBooks Desktop has no live cloud API to begin with.

**P5 Task 7 is not blocked by P4.2/P4.3/P4.4** — only by P3 and,
separately, by whichever of P3/P4.1 the owner chooses to sequence first
(see the P3 section's own status). The new estimating packages above
extend P4's domain and can be sequenced relative to P5's remaining
tasks by business priority, not by a hard technical dependency either
way.

### Package P5 — Commitments, Bids (PM-side), Procurement & Material Orders

- **Scope:** `committed_costs` UI (already schema-hardened across 5
  migrations, never exercised by any UI); PM-facing bid package
  create/receive/compare/award; PO/subcontract document generation;
  procurement/material orders.
- **Schema/migrations:** `bid_packages`, `bid_submissions`,
  `bid_questions`, `bid_addenda`, `material_orders`,
  `material_order_line_items` (new) — each with its own narrowly
  scoped vendor-read policy (own bid/submission only, never a
  competing vendor's) calling P3's `is_project_vendor()` helper.
- **RLS:** Extends the vendor identity boundary P3 already established
  — calls `is_project_vendor()`, does not redefine vendor identity and
  does not introduce a new security boundary of its own. Every new
  vendor policy here gets its own cross-project and cross-vendor
  isolation test per the roadmap-wide vendor RLS sequencing rule.
- **Server-side operations:** Commitment supersede flow (already has
  real RPCs — `supersede_committed_cost()` — wire real UI to them for
  the first time); PDF generation for PO/subcontract documents.
- **Audit events:** Unapproved changes past expected timeframe;
  backordered material.
- **Action Center events added:** Unapproved changes; backordered
  material.
- **Tests:** Real Postgres run of `committed_forecast_hardening_tests.sql`
  in context (already validated in P1 in isolation — confirm it still
  holds once real UI writes through it).
- **Acceptance criteria:** A commitment can be created, superseded,
  and its lineage remains correct and queryable — through the UI, not
  just direct SQL.
- **Dependencies:** P3 (vendor RLS foundation), P4 (budget to commit
  against).
- **Exclusions:** No vendor-facing UI yet (P11) — vendor data is
  referenced (who a bid was sent to) but never displayed to a vendor
  session in this package.

### Package P6 — Client Billing: Draws, Payments, Retainage

- **Scope:** `invoices`/`payments` tables; draft-draw-from-unbilled-
  expenses workflow; frozen-on-issue calculation; retainage.
- **Schema/migrations:** `invoices`, `payments` (new).
- **Server-side operations:** Draw-issue RPC that freezes the
  computed total at issue time (never recomputed live afterward,
  matching the append-only philosophy already used elsewhere).
- **Action Center events added:** Unpaid draws past due date.
- **Tests:** "Correcting a finalized draw" (Exception Register #4)
  gets direct, explicit test coverage — a finalized draw is corrected
  via a new reversing record, never edited in place.
- **Acceptance criteria:** A draw, once issued, displays identically
  to the client regardless of later budget changes — proven by
  changing the underlying budget after issue and confirming the draw
  figure doesn't move.
- **Dependencies:** P4, P1's fee engine (already built and reusable).
- **Exclusions:** No live payment processing (P6b, immediately after).

### Package P6b — Payment Processing

- **Scope:** ACH/card payment links via the chosen provider (server-
  side integration, per `TARGET-ARCHITECTURE.md` §9 — never an
  improvised custom payment implementation); convenience-fee handling;
  provider reconciliation; partial/failed/reversed payments; refunds.
- **Schema/migrations:** `payment_provider_transactions` (new).
- **Server-side operations:** Webhook handler, running on the Next.js
  server runtime already established in P0 (§5.1) — this is exactly
  the kind of verified-external-caller case §5.2 scopes service-role/
  privileged-credential use to, with explicit signature verification
  before anything is trusted; reconciliation job matching provider
  transactions to `payments` rows.
- **Action Center events added:** Failed/reversed payment.
- **Tests:** A failed/reversed payment is proven to never silently
  disappear — it always produces a visible, queryable record.
- **Acceptance criteria:** "Payment complete" is never shown based
  only on a browser-side fetch response — confirmed server-side via
  webhook before any UI reflects paid status, per instruction.
- **Dependencies:** P6.
- **Exclusions:** Provider selection itself is an owner decision, not
  made by this document (see the PR description's executive summary).

### Package P7 — Change Orders, Field Directives, E-Signature

- **Scope:** `change_orders`/`field_directives` tables; e-signature
  integration (provider chosen here); client approval consuming
  `project_decision_makers` (P2) for real for the first time.
- **Schema/migrations:** `change_orders`, `field_directives` (new).
  `budget_ledger.source_type = 'change_order'`'s existing loosely-typed
  slot gets wired to a real `change_orders.id` — tested end-to-end,
  per the old roadmap's own stated intent, now actually executed.
- **Server-side operations:** Change-order approval RPC enforcing the
  Client Approval Rule in full (missing required signer or
  disagreement → blocked/disputed state, never auto-resolved); e-sig
  provider webhook.
- **Action Center events added:** Missing signatures past a defined
  window.
- **Tests:** Approval-authority + disagreement/blocked-state tests
  (shared test shape with P8's Selections approval, since both consume
  the same `project_decision_makers` model).
- **Acceptance criteria:** A change order with two designated decision-
  makers, one approving and one rejecting, produces a blocked/disputed
  state visible to staff — never a silently-resolved approval.
- **Dependencies:** P4, P6.
- **Exclusions:** No claim of legal signature capability without the
  chosen e-signature provider actually integrated — no "type your name
  to sign" substitute, per instruction.

### Package P8 — Selections & Allowances

- **Scope:** Real `selections`/`selection_approvals` tables and UI,
  replacing `SelectionsTab`'s hardcoded data and dead "Review &
  Approve" button.
- **Schema/migrations:** `selections`, `selection_approvals` (new).
- **Server-side operations:** Same approval-RPC pattern as P7,
  reusing `project_decision_makers`.
- **Action Center events added:** Overdue selections past a schedule-
  driven deadline.
- **Tests:** The exact "approval must never happen from a single
  unreviewed click" test the button's current absence of a handler
  makes trivially true today and must remain true once real — i.e. a
  real click must go through the same authority/disagreement checks as
  P7, not a simpler shortcut just because it's "just a selection."
- **Acceptance criteria:** The Selections tab's approve action
  persists a real, audited approval record and enforces the same
  decision-maker rules as Change Orders.
- **Dependencies:** P4.
- **Exclusions:** Vendor-scoped selection visibility (fulfillment
  assignment) deferred to P11, though the RLS shape is prepared
  against the P3 vendor foundation.

### Package P9 — Scheduling, Field Operations, Documents, RFIs, Meetings, Safety, Calendar Sync

- **Scope:** `schedule_phases`, `daily_logs`, `field_issues`,
  `documents`, `rfis` (five tables — corrected count carried forward
  from the old roadmap's own correction), plus `tasks`, `meetings`,
  `meeting_action_items`, `safety_documents`, `safety_incidents` (five
  more) — **ten tables total** (corrected here: the previous version
  of this document said "nine," which undercounted the second group of
  five as four).
- **Schema/migrations:** All ten tables above (new). `documents`
  follows the `onedrive_item_id`/`onedrive_last_synced_at` metadata-
  only pattern already established on `expenses` (§8 of
  `TARGET-ARCHITECTURE.md`).
- **Server-side operations:** Microsoft Graph integration for
  OneDrive/SharePoint file access (server-side only); calendar-sync
  export layer.
- **Action Center events added:** Schedule delays; open safety
  incidents.
- **Tests:** Publish-state pattern proven for `documents`, explicitly
  including Exception Register #14 (accidental exposure) as a real
  test case, not just a design comment.
- **Acceptance criteria:** `ScheduleTab`/`ScheduleClientTab`,
  `DocumentsTab`, `UpdatesTab` all read/write real data; the
  "Download" button gets a real handler for the first time.
- **Dependencies:** P3.
- **Exclusions:** No vendor-facing schedule confirmation UI yet (P11).

### Package P10 — Client Communication & Approvals (Conversations)

- **Scope:** `conversation_threads`, `messages`; later, captured-email
  ingestion toward Module 31 (email-to-project capture) as a follow-on
  within this package's scope.
- **Schema/migrations:** `conversation_threads`, `messages` (new).
- **Server-side operations:** Microsoft 365/Outlook Graph integration
  (optional, server-side).
- **Tests:** Direct negative test — an email reply is never
  auto-treated as a signed approval, regardless of content.
- **Acceptance criteria:** `ConversationsTab` sends/receives real
  messages, internal-only vs. shared threads correctly scoped by RLS.
- **Dependencies:** P3; benefits from P7–P9 existing.
- **Exclusions:** No AI-assisted drafting (P15).

### Package P11 — Vendor Portal (full), Bid Management (vendor-side), Compliance, 1099 Support

- **Scope:** The actual vendor-facing portal, extending the P3
  foundation and P5's record-keeping half; `vendor_profiles`,
  `vendor_assignments`, `vendor_compliance`, `vendor_performance_notes`,
  `vendor_invoices`, `vendor_change_requests`; 1099 export.
- **Schema/migrations:** Six new tables (as above).
- **Tests:** The P1/P3 "Vendor A sees nothing" test is the regression
  baseline this package must extend deliberately, re-testing after
  every new capability, never accidentally weakening it — same
  requirement as the old roadmap, now backed by a foundation that
  actually exists and was actually tested starting in P3.
- **Acceptance criteria:** A vendor logs in for real (Supabase Auth,
  `vendor` role), sees only their own assigned projects/bids/
  compliance status, nothing else.
- **Dependencies:** P5, P3's vendor RLS foundation.
- **Exclusions:** No company-wide vendor directory UI for the vendor
  themselves (that's the admin-side Vendors area, already built as
  record-keeping in P5).

### Package P12 — Investor & Spec-Home Reporting, Lender Draw Support

- **Scope:** `investors`, `investor_project_stakes`,
  `lender_draw_requests`; new `investor`/`lender` `app_role` enum
  values (a real migration — the enum has no such values today);
  Investor portal; narrow single-draw-package Lender access.
- **Tests:** Explicit isolation tests for both new roles from scratch,
  same rigor as the vendor baseline.
- **Acceptance criteria:** An investor cannot see another investor's
  stake or raw vendor invoices; a lender sees only their one open draw
  package.
- **Dependencies:** P6 (draws must be real to report on).

### Package P13 — Permits & Inspections, Warranty & Service

- **Scope:** `permits`, `inspections`, `punch_items`,
  `warranty_claims`; company-level Warranty/Service view.
- **Tests:** Inspection history proven append-only.
- **Dependencies:** P9 (documents, for permit files), P6 (closeout
  often gates on final billing).

### Package P14 — Company Operations & Reporting

- **Scope:** Completes every deliberately-thin module: full Leads
  pipeline analytics, full Templates/knowledge base, Employees/
  Workload, Time/Mileage/Expense Reimbursement, Company Assets,
  Material Inventory, Company Overhead/True Profitability, self-service
  data export, cross-project Action Center analytics.
- **Tests:** Regression proving Action Center stays "calm and
  actionable-only" even as cross-project analytics are added.
- **Dependencies:** As many of P4–P13 as are live.
- **Security:** True-profitability reporting is Owner/Accounting only
  — never PM/Field/Client/Vendor visible, unchanged from the old
  roadmap's own explicit requirement.

### Package P15 — Project Intelligence Assistant

**Long-term core feature, not a bolt-on chatbot** — the assistant is
intended to eventually become the portal's primary interface across
every role. It is still built **last**, deliberately, per the original
roadmap's own instruction and the highest-scrutiny-review requirement
below — what changed on 2026-08-06 is that every package from P4
onward is now built so this package requires no refactor of anything
beneath it. Full architectural rationale, the repository/service
pattern every prior package must expose, and the authorization/
grounding/audit rules this package must follow:
`docs/production-build/AI-ASSISTANT-ARCHITECTURE.md` and
`TARGET-ARCHITECTURE.md` §14 — both required reading before this
package's own detailed design doc is written.

- **Scope:** Conversational Q&A, project summaries, financial
  explanations, document search, schedule questions, change order
  explanations, homeowner assistance, vendor assistance, admin
  insights, and — last to mature, highest scrutiny — secure action
  execution on behalf of an authorized user. Every capability is a
  caller of the repository/service layer P4–P14 already built; this
  package introduces **no parallel data model and no independent
  calculation path** (per `FINANCIAL-ARCHITECTURE.md`'s permanent-
  backbone rule and `AI-ASSISTANT-ARCHITECTURE.md`'s grounding rule).
- **User workflows made genuinely functional:** A user in any role asks
  a natural-language question or, later, requests an action, from a
  persistent assistant surface available across the portal — not a
  separate page bolted onto one screen.
- **Schema/migrations:** `ai_interaction_log` (new — every question
  asked, which repositories/services were called, what was returned;
  distinct from `audit_log`, which continues to record only data
  mutations). `audit_log.initiated_via` (new nullable column,
  `'ui' | 'api' | 'ai_assistant'`) — the one schema addition flagged in
  advance by `AI-ASSISTANT-ARCHITECTURE.md`, an ordinary additive
  migration. A search index over P9's document metadata (exact
  mechanism — Postgres full-text vs. an external vector store — is this
  package's own decision to make when it's actually designed, not
  pre-decided here).
- **Permissions/RLS policies:** None new on any existing table — the
  assistant answers through the *asking user's own* session, so every
  existing RLS policy already governs what it can see or do. New:
  `ai_interaction_log` policies scoping each user (and staff oversight)
  to their own interaction history, following the same staff-
  full/self-read shape used elsewhere.
- **Server-side operations:** An assistant Route Handler
  (`/api/assistant/chat` or equivalent) authenticating the caller
  exactly like every other Route Handler (§5.2's JWT pattern, never
  service-role); a tool-calling layer where every tool is a thin
  adapter over an existing repository/service function, never a new
  bespoke query written "for the AI"; a grounding step that calls the
  real calculation before the model narrates it, for every financial or
  quantitative claim.
- **UI screens connected to live data:** A persistent assistant surface
  integrated into `AppShell`, available (with role-scoped content) to
  admin, staff, client, and vendor sessions alike — the eventual "natural
  interface" framing means this is treated as a first-class navigation
  element by the time this package is designed in detail, not a
  corner-of-the-screen widget.
- **Audit events:** Every assistant-initiated mutation logged via the
  same `log_audit()` path as its human-equivalent action, tagged
  `initiated_via='ai_assistant'`. Every question (mutating or not)
  logged to `ai_interaction_log`.
- **Tests:** Everything every prior package already tests for
  human-driven RLS/authorization boundaries, re-run with the assistant
  as the caller — a vendor's question must be provably unable to
  surface data vendor RLS doesn't already grant, a client's question
  must be provably unable to surface another client's project,
  following the exact "real query, not review" bar every package since
  P1 has held to. Additionally: a grounding-violation test proving a
  financial answer's cited numbers match a real, independently-called
  engine result, not a model-generated figure.
- **Acceptance criteria:** A real user in each of the four roles can
  ask a real question and receive an answer scoped to exactly what
  their role's RLS already permits, with every quantitative claim
  traceable to a real repository/engine call logged in
  `ai_interaction_log`; secure action execution (last capability to
  ship within this package) requires explicit user confirmation before
  any financially or legally consequential action, never an autonomous
  mutation from a single ambiguous request.
- **Dependencies:** P4 through P14 — this package is a caller of every
  repository/service those packages build, not a foundation any of them
  depend on.
- **Explicit exclusions:** No autonomous action without human
  confirmation for anything financially or legally consequential. No
  chat data used to train or fine-tune any shared/external model
  without a separate, explicit data-handling decision — out of scope
  for this roadmap entry. No bypassing `project_decision_makers`
  approval-authority rules (§3) for any action the assistant proposes
  on a user's behalf.
- **Security:** Highest-scrutiny review in the entire roadmap, by
  explicit request — no change from prior direction.

---

## Dependency graph

```
P0 (foundation/environment)
 │
P1 (schema execution + real DB/RLS validation)
 │
P2 (real auth, membership, decision-makers)
 │
P3 (real projects + vendor RLS foundation) ──────────────┐
 │                                                        │
 ├─→ P4 (Estimating + QuickBooks import)                  │
 │      │                                                 │
 │      ├─→ P5 (Commitments + Bids[PM] + Procurement) ────┘ (vendor RLS
 │      │      └─→ P11 (Vendor Portal[full] + Bids[vendor] + Compliance)  reused, not
 │      │                                                                  re-introduced)
 │      ├─→ P6 (Billing: Draws/Payments/Retainage)
 │      │      ├─→ P6b (Payment Processing)
 │      │      ├─→ P7 (Change Orders + E-Signature)
 │      │      ├─→ P12 (Investor/Lender Reporting)
 │      │      └─→ P13 (Permits/Inspections/Warranty)
 │      └─→ P8 (Selections & Allowances)
 │
 ├─→ P9 (Scheduling/Field Ops/Documents/RFIs/Meetings/Safety/Calendar)
 │
 └─→ P10 (Conversations + Email-to-Project Capture)

P14 (Company Operations & Reporting) ← trails P4 through P13
P15 (Project Intelligence Assistant) ← deliberately last; calls every
  package's repository/service layer, introduces no parallel data or
  calculation path (FINANCIAL-ARCHITECTURE.md, AI-ASSISTANT-ARCHITECTURE.md)
```
