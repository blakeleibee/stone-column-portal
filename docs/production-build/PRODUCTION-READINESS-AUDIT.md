# Production Readiness Audit

Classifies every module in `docs/product-definition/01-feature-register.md`
against the repository as it actually exists on disk today (branch
`chore/production-transition-plan`, off `main` @ `730f43f`). This
supersedes any prior "approved"/"done" language for Package 1–2 for
the purposes of production planning — **approved as a prototype
reference is not the same as production-ready**, and nothing here is
credited as more complete than what actually runs, persists, or is
enforced server-side today.

## Classification legend

- **Production-functional** — real persistence, real auth/authz, real
  server-side validation, real tests, actually deployable as-is.
- **Production-backed but incomplete** — a real backend exists and has
  been validated in some form, but the module is missing required
  pieces (auth, RLS enforcement, audit, tests, or UI wiring).
- **Fixture-driven demonstration** — real calculation/rendering logic,
  but every input comes from a hardcoded in-memory fixture, not a
  database. Looks correct; proves nothing about a live system.
- **Preview-only** — static or lightly-scripted sample content,
  explicitly labeled "preview"/"not yet functional" in the UI. No
  calculation logic of consequence, no backend at all.
- **Planned only** — specified in the product-definition documents;
  zero code exists.
- **Deprecated or misleading** — code that must be removed or
  fundamentally re-scoped before production, because leaving it as-is
  would misrepresent what the system does.

Per instruction: **unexecuted SQL and TypeScript types are not
evidence of production readiness.** Every module below that touches
`schema/*.sql` is flagged "schema designed, never executed against a
real database" regardless of how thorough the SQL itself is.

---

## Module 0 — Platform Core Services (auth, orgs, roles, RLS foundation)

- **Frontend status:** None. No login screen, no session UI, no
  protected-route logic anywhere in `apps/web` or
  `packages/02-app-shell`.
- **Database status:** `orgs`, `profiles`, `app_role` enum
  (`admin`/`staff`/`client`/`vendor`), `is_org_staff_for_org()`,
  `is_org_admin_for_org()`, `is_project_client()`,
  `bootstrap_organization()` all defined in
  `schema/001_core_financial.sql`. **Never executed against a real
  Postgres/Supabase instance.**
- **Authentication status:** Not implemented. No `@supabase/supabase-js`
  (or any auth library) is a dependency anywhere in the repo
  (confirmed: no match in any `package.json` or `package-lock.json`).
- **Authorization/RLS status:** Designed (org-scoped staff/admin,
  project-scoped client), never validated against real Postgres roles
  or real JWTs.
- **Server-side validation status:** None — there is no server runtime
  in this repository at all today (`apps/web` is a static esbuild
  bundle with no API routes).
- **Audit-history status:** `audit_log` table + `log_audit()` trigger
  exist in schema, unexecuted.
- **Test coverage:** `tests/sql/package1_tests.sql` and
  `tests/sql/000_bare_postgres_bootstrap.sql` are written, reasoned
  through, **never run**.
- **Production blockers:** No auth library installed; no Supabase
  project exists (dev, staging, or prod); schema never executed;
  `investor`/`lender` roles don't exist yet in the enum; no
  "authorized client decision-maker" concept in schema yet.
- **Recommended destination package:** **P1** (schema execution/
  validation) → **P2** (real auth, membership, decision-maker
  designation).

## Module 1 — Leads & Preconstruction

- **Frontend:** None.
- **Database:** No `leads` table exists in any migration.
- **Auth/Authz/Validation/Audit:** N/A — nothing built.
- **Tests:** None.
- **Production blockers:** Entirely unbuilt.
- **Recommended destination package:** **P3** (thin, per product
  definition) → **P14** (full pipeline/reporting).
- **Classification: Planned only.**

## Module 2 — Project Setup & Administration

- **Frontend:** None (no project-creation wizard, no settings screen
  beyond `PlaceholderScreen`'s "Settings" card).
- **Database:** `projects`, `project_fee_rules`, `project_members`
  fully modeled in `schema/001_core_financial.sql`, including GMP
  constraints, billing frequency, pricing model enum. **Unexecuted.**
- **Authorization/RLS:** `projects_staff_full_access` /
  `projects_client_read` policies designed, unexecuted.
- **Server-side validation:** None (no server runtime).
- **Audit:** No trigger currently attached to `projects` itself (only
  `cost_codes`, `expenses`, `budget_ledger`, `fee_ledger`,
  `committed_costs`, `forecast_entries`, `budget_suggestions` have
  `log_audit()` triggers — `projects` and `project_members` do not,
  which is a gap for P3 to close).
- **Tests:** None executed.
- **Production blockers:** No UI at all; schema unexecuted; no audit
  trigger on `projects`/`project_members`/`project_fee_rules`; no
  archive/pause/reactivate logic (schema has a `project_status` enum
  with `draft/active/on_hold/closed_out/archived` values but no
  enforced transition rules, unlike the expense state machine which
  does have one).
- **Recommended destination package:** **P3**.
- **Classification: Planned only** (schema exists but is inert; no
  application capability exists yet).

## Module 3 — Estimating & Budgeting

- **Frontend:** Real. `AdminFinancialsScreen` /
  `ClientBudgetAndInvoicesScreen` (`packages/02-app-shell/src/screens/`)
  render genuine computed figures via `buildAdminFinancialsViewModel` /
  `buildClientBudgetViewModel`.
- **Calculation engine:** `packages/01-financial-engine` —
  production-quality, pure TypeScript, zero runtime dependencies, 123
  passing tests (31 edge cases + main suite), integer-cents/basis-point
  discipline throughout, independently-sourced reconciliation control
  total. **This sub-component is a reusable production asset as-is** —
  it needs to be called from real data, not rewritten.
- **Database:** `cost_codes`, `budget_ledger`, `budget_suggestions`
  fully modeled, **unexecuted**.
- **Data source in the running app:** `FixtureFinancialRepository` →
  `packages/01-financial-engine/fixtures/hawksRidge.ts` (one hardcoded
  fictional project, "Hawks Ridge Residence"). **Every number on
  screen today is fixture data, not database data.**
- **Authorization/RLS:** Designed (`cost_codes_staff_full`/
  `_client_read`, `budget_ledger_staff_*`/`_client_read`,
  `expenses_staff_full_access`/`_client_read`), unexecuted.
- **Server-side validation:** None. `getIndependentPostedActualCostCents`
  — the repository method whose entire contract is "must be a genuinely
  separate server-side aggregate query" — is currently implemented by
  summing the same in-memory fixture array (correct for a fixture, but
  proves nothing about a real independent SQL aggregate).
- **Audit:** Triggers exist and would fire once executed; no UI
  surfaces audit history today.
- **Tests:** 123 real, executed, passing checks — but all against
  fixture data, not a live database or live RLS.
- **Production blockers:** `SupabaseFinancialRepository` is a
  documented, intentionally non-functional stub (every method
  `throw`s) — this is the single largest concrete gap between "looks
  done" and "is done" in the entire repository. No budget-entry UI
  (create/edit a cost code or ledger line) exists — the screens are
  read-only.
- **Recommended destination package:** **P1** (schema execution) →
  **P4** (real budget-entry UI + QuickBooks import, per the existing
  roadmap's own dependency ordering).
- **Classification: Fixture-driven demonstration** (application level)
  wrapping a **production-functional** calculation engine.

## Module 4 — QuickBooks Desktop Job-Cost Import

- **Frontend:** None. `import_batches`/`import_rows` tables exist in
  schema but there is no import wizard UI anywhere.
- **Database:** Modeled, unexecuted.
- **Classification: Planned only.** Destination: **P4**.

## Modules 5–7 — Commitments/POs/Subcontracts, Client Billing/Draws/
Payments/Retainage, Change Orders & Field Directives

- **Frontend:** None.
- **Database:** `committed_costs`, `forecast_entries` exist (with real
  supersede-lineage triggers, migrations 002–005 — the most heavily
  hardened part of the schema). No `invoices`, `payments`,
  `change_orders`, or `field_directives` tables exist anywhere.
- **Classification: Planned only** for the invoicing/change-order
  surface; the `committed_costs`/`forecast_entries` schema underneath
  is unusually well-specified (5 migrations of hardening) but still
  **unexecuted**, so it does not get credit above "planned" for the
  application capability it would support.
- **Destination packages:** **P5** (Commitments), **P6**/**P6b**
  (Draws/Payments), **P7** (Change Orders).

## Module 8 — Selections & Allowances

- **Frontend:** `SelectionsTab` (`apps/web/src/screens/ProjectWorkspace.tsx`)
  renders a real-looking card grid with an **"Review & Approve
  (preview)" button that has no `onClick` handler at all** — it is
  visually a functional approval control and does nothing when
  clicked. This is the single clearest example in the repository of
  "looks interactive, isn't."
- **Database:** No `selections`/`selection_approvals` table exists.
- **Classification: Preview-only**, with one control that is actively
  **misleading** (a rendered primary-action button with zero behavior)
  and should be either disabled/labeled inert or removed until P8 wires
  it — flagged for the P0 "no fixture presented as live" sweep.
- **Destination package:** **P8.**

## Module 9 — Scheduling & Field Operations

- **Frontend:** `ScheduleTab`/`ScheduleClientTab` + `ScheduleRail`
  render a real, hardcoded 15-phase construction schedule
  (`sampleContent.ts`), read-only.
- **Database:** No `schedule_phases`/`daily_logs`/`field_issues`/
  `tasks`/`meetings`/`safety_*` tables exist.
- **Classification: Preview-only.** Destination: **P9.**

## Module 10 — Documents, Plans, RFIs & Electronic Signatures

- **Frontend:** `DocumentsTab` renders a hardcoded document list with
  a **"Download" button with no handler** (same pattern as Selections'
  approve button — a dead control, not a missing feature).
- **Database:** No `documents`/`rfis` tables. `expenses` already has
  the intended metadata-only pattern to reuse
  (`onedrive_item_id`/`onedrive_last_synced_at` columns) — this is a
  real, reusable design precedent for Module 10's own table.
- **Classification: Preview-only**, with the same "dead control"
  concern as Selections. Destination: **P9** (documents/RFIs), e-sig
  itself lands with **P7** (Change Orders, per existing roadmap, since
  that's the first package needing enforceable signatures).

## Module 11 — Client Communication & Approvals (Conversations)

- **Frontend:** `ConversationsTab` renders hardcoded thread data,
  read-only, no compose/reply UI.
- **Database:** No `conversation_threads`/`messages` tables.
- **Classification: Preview-only.** Destination: **P10.**

## Modules 12–13 — Vendor & Subcontractor Management, Bid Management

- **Frontend:** None (no vendor portal, no bid comparison UI).
- **Database:** `project_members.member_role` already allows
  `'vendor'`, and `is_project_client()` exists as a helper — but there
  is **no equivalent `is_project_vendor()` helper, no vendor-specific
  RLS policy anywhere in `schema/001_core_financial.sql`.** This is a
  real gap relative to the old roadmap's own stated intent ("Package 3
  now includes the vendor identity/RLS foundation") — that foundation
  was never actually written into the schema; only the `member_role`
  enum value and the `project_members_client_or_vendor_only` check
  constraint exist. No vendor RLS policy, no vendor helper function.
- **Classification: Planned only.** Destination: **P5** (record-
  keeping half) / **P11** (vendor-facing UI) — see
  `PRODUCTION-ROADMAP.md` for the recommended change to close this gap
  in **P3**, not P5.

## Modules 14–15 — Investor & Spec-Home Reporting, Lender Draw Support

- **Frontend:** None. **Database:** `app_role` enum has no `investor`
  or `lender` value yet — adding one is a real migration, not a UI
  task. **Classification: Planned only.** Destination: **P12.**

## Modules 16–18 — Permits & Inspections, Compliance (COIs/W-9s/Lien
Waivers), Warranty & Service

No code, no schema. **Classification: Planned only.** Destination:
**P13.**

## Module 19 — Company Reporting (incl. Action Center)

- **Frontend:** `ActionCenterScreen` renders a hardcoded, grouped
  action-item list (`ACTION_ITEMS` in `sampleContent.ts`) — no live
  aggregation of anything.
- **Classification: Preview-only.** Real version is incremental —
  every future package (P4 onward) adds its own real Action Center
  event query; there is no single "Action Center table" to build.

## Module 20 — Company Templates & Knowledge Base

No code. **Classification: Planned only.** Destination: **P3** (thin)
→ **P14** (full).

## Module 21 — Carefully Controlled AI Assistance

No code. **Classification: Planned only.** Destination: **P15**
(deliberately last, per existing roadmap and this task's own
instructions).

## Module 22 — Payment Processing

No code, no schema. **Classification: Planned only.** Destination:
**P6b.**

## Modules 23–35 — Employees/Roles/Workload, Time/Mileage/Expense
Reimbursement, Company Tools/Vehicles/Equipment, Material Inventory,
Meetings, Safety, Procurement/Material Orders, Calendar Sync,
Email-to-Project Capture, Website Lead Intake/Reporting, Vendor
Tax/1099, Company Overhead/True Profitability, Data Export/Backup

No code, no schema for any of these. **Classification: Planned only**
for all thirteen. Destinations as already mapped in
`docs/product-definition/COVERAGE_MATRIX.md` (Packages 9, 10, 11, 14 —
unchanged by this transition).

---

## Cross-cutting findings that apply to *every* module above

1. **No server runtime exists in this repository.** `apps/web` is a
   static SPA bundle (esbuild). There is no Next.js app, no API route,
   no Vercel serverless/edge function, no Supabase Edge Function
   anywhere. Every module above that will eventually need
   server-validated mutations needs this resolved first — see
   `TARGET-ARCHITECTURE.md`.
2. **No environment configuration exists.** Zero `.env*` files, zero
   documented environment variables, in the entire repository.
3. **No client-side router exists.** Navigation is `useState` +
   `activeKey`/`onNavigate` props — there are no URL routes, so nothing
   is deep-linkable or bookmarkable today.
4. **The role switcher (`DemoControls.tsx`) is explicitly demo-only**
   and correctly labeled as such in its own UI ("DEMO CONTROLS — not
   part of the real sign-in flow") — but it is currently the *only*
   mechanism that determines which role's screens render. It must be
   fully removed from any build that has real authentication, not
   evolved into one.
5. **Two controls render as functional but do nothing when clicked**
   (Selections' "Review & Approve" button, Documents' "Download"
   button) — flagged individually above, called out together here
   because both are the same class of problem: a rendered primary
   action with no handler is a misleading affordance, not a smaller
   version of the real feature.
6. **`localStorage` is not used anywhere** in the current codebase —
   confirmed by search. This is good; the "do not use `localStorage` as
   the authoritative store" rule has nothing to undo today, only to
   hold the line on going forward.
