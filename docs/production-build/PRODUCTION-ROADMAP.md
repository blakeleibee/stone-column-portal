# Production Roadmap

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
foundation (`'vendor'` `project_members` rows, an `is_project_vendor()`
helper, and a baseline "vendor sees nothing except their own
membership" RLS policy). The old roadmap explicitly placed this in
Package 3 specifically so that Commitments/Bids (this roadmap's P5)
never has to introduce a new security boundary under time pressure —
but the actual schema audit (`PRODUCTION-READINESS-AUDIT.md`, Modules
12–13) found that foundation was **never actually written**, only the
enum value and a check constraint exist. Since P5 in this roadmap
still references vendor-assigned bids (same as the old roadmap's
Package 5), the same reasoning still applies, and P3 below includes it
as new scope, not an inherited-and-already-done item.

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

- **Exact scope:** No product feature work. Establishes the scaffolding
  every later package depends on.
- **User workflows made genuinely functional:** None yet — this
  package is infrastructure only.
- **Schema/migration changes:** None.
- **Permissions/RLS policies:** None new.
- **Server-side operations:** None new.
- **UI screens connected to live data:** None.
- **Fixture behavior removed/retained:** Retained as-is; this package
  does not touch `apps/web` product screens.
- **Audit events:** None new.
- **Tests:**
  - Re-confirm `npm ci`/`typecheck`/`test`/`build` pass on the actual
    target Node version (already verified: Node v24.18.0 locally,
    `engines: >=18.0.0` declared — confirm CI pins a specific supported
    version rather than "whatever's latest," since ">=18" is wide).
  - Add a smoke test (or CI step) that fails the build if any
    `.env*` file other than `.env.example` is ever committed.
- **CI requirements:** Extend `.github/workflows/ci.yml` (already
  passing) with: environment-variable-template validation, and a
  step that fails if fixture data (`sampleContent.ts`,
  `fixtures/hawksRidge.ts`) is imported from anywhere outside
  `apps/web`'s own demo path or a test file (extending the existing
  grep-based check in `packages/02-app-shell/test/render_smoke.tsx` to
  cover the whole repo, not just that one package).
- **Deployment requirements:** No deploy target changes yet (Vercel
  config as-is).
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
     error-reporting service is added is called out as a decision, not
     assumed — see the executive summary).
  5. Every existing "Preview only" and "not yet functional" label is
     re-confirmed still accurate; the two misleading dead-control
     buttons (Selections "Review & Approve," Documents "Download") are
     either given a visibly disabled state or their button element is
     removed until their real package lands — a rendered, clickable,
     no-op primary action is not acceptable to carry into a
     production-labeled build.
- **Dependencies:** None.
- **Explicit exclusions:** No new tables, no auth, no real financial
  writes, no external service connections of any kind.

## Package P1 — Database and security validation

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
  2. At least one defect is expected to be found (no schema this size
     has ever run clean on its first real execution) — it must be
     fixed via a new forward migration with its own `_down.sql`, and
     documented in this file's changelog section (added once a defect
     is actually found — not fabricated now).
  3. RLS is proven, not asserted: a real test user with role `client`
     cannot read another project's `expenses` row, and a real test
     user with role `staff` cannot read another org's `projects` row,
     via actual queries against actual RLS, not code review.
- **Dependencies:** P0 (CI/environment scaffolding).
- **Explicit exclusions:** No new product tables (leads, selections,
  etc.) — this package validates what already exists in
  `schema/001`–`005` only. No auth UI. No production Supabase project.

## Package P2 — Authentication, company membership, and project access

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
- **Server-side operations:** Invitation-send RPC (or Next.js API
  route if adopted this early — see `TARGET-ARCHITECTURE.md` §5)
  emailing an invite link; invitation-accept RPC creating the
  `profiles` row; decision-maker designation RPC (admin/staff only).
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

## Package P3 — Production project foundation

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
    vendor RLS policies on every table that currently has only
    staff/client policies, scoped to what a vendor should ever see at
    this stage (their own `project_members` row only — no vendor
    product screens ship until P11, matching the old roadmap's own
    "foundation only" framing).
- **Permissions/RLS policies:** Vendor baseline ("vendor sees nothing
  except their own membership") tested from this package forward, per
  the recommended-change rationale above.
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
  e.g. `draft → closed_out` directly); vendor-isolation RLS test
  ("Vendor A sees nothing" — extending the exact test class Package 1
  already wrote for this, now runnable for real since P1 executed the
  schema).
- **CI requirements:** Extends P1/P2's Postgres+Auth CI job with the
  new migrations; vendor-isolation test added to the required suite.
- **Deployment requirements:** No new environment; still on the P2
  preview/staging Supabase project.
- **Acceptance criteria:**
  1. A real project can be created, edited, and its status changed
     through enforced valid transitions only, with a full audit trail.
  2. A vendor test account, added to Project A only, cannot read any
     row scoped to Project B, verified by an actual query, not review.
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

### Package P4 — Estimating & Budgeting UI + QuickBooks Desktop Import

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
- **Server-side operations:** Import-file parser (needs a server
  runtime — see `TARGET-ARCHITECTURE.md` §5 decision); category-
  rollup and independent-control-total real SQL implementations,
  finally retiring `SupabaseFinancialRepository`'s stub status.
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
- **Dependencies:** P3.
- **Exclusions:** No live QuickBooks API (file-based only, per
  instruction — QuickBooks Desktop has no live cloud API to begin
  with). No commitments/bids yet (P5).

### Package P5 — Commitments, Bids (PM-side), Procurement & Material Orders

- **Scope:** `committed_costs` UI (already schema-hardened across 5
  migrations, never exercised by any UI); PM-facing bid package
  create/receive/compare/award; PO/subcontract document generation;
  procurement/material orders.
- **Schema/migrations:** `bid_packages`, `bid_submissions`,
  `bid_questions`, `bid_addenda`, `material_orders`,
  `material_order_line_items` (new).
- **RLS:** References the vendor RLS foundation from P3 — this
  package must not introduce any new vendor-facing security boundary
  of its own; it only extends the one already tested.
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
- **Server-side operations:** Webhook handler (requires the server
  runtime decision from §5 to be resolved by now at the latest);
  reconciliation job matching provider transactions to `payments` rows.
- **Action Center events added:** Failed/reversed payment.
- **Tests:** A failed/reversed payment is proven to never silently
  disappear — it always produces a visible, queryable record.
- **Acceptance criteria:** "Payment complete" is never shown based
  only on a browser-side fetch response — confirmed server-side via
  webhook before any UI reflects paid status, per instruction.
- **Dependencies:** P6.
- **Exclusions:** Provider selection itself is an owner decision, not
  made by this document (see executive summary).

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
  `meeting_action_items`, `safety_documents`, `safety_incidents` —
  nine tables total.
- **Schema/migrations:** All nine tables above (new). `documents`
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

### Package P15 — Carefully Controlled AI Assistance

- **Scope:** `ai_interaction_log`; scoped AI assistance layered onto
  whichever modules are live by this point.
- **Dependencies:** Deliberately last, per instruction and the old
  roadmap alike.
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
P15 (AI Assistance) ← deliberately last
```
