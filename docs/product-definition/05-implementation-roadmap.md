# Implementation Roadmap

Packages 1–2 are already built, tested, and approved — **not
renumbered or redefined here.** This roadmap continues from the
interactive-preview checkpoint just completed, through a **new,
required Phase 2 checkpoint**, into Package 3 onward.

## Recap of what's already true (do not re-do)

- **Package 1** — financial engine + full SQL schema. Conditionally
  approved — SQL/RLS designed but unverified against a real Postgres
  instance; that gate is **unchanged** and carries forward.
- **Package 2** — `AppShell`, repository/view-model layer, approved
  Financials screens, responsive nav, client-preview safeguards.
  Approved.
- **Interactive preview checkpoint** — restored the original
  prototype's visual direction and content richness; real npm
  workspace, pinned versions, genuine lockfile. No new backend.

---

## Phase 2 — Expanded Interactive Prototype Checkpoint (new, required, precedes Package 3)

**This is explicitly not production backend development.** It extends
the existing `apps/web` preview's sample-content pattern (already used
for Schedule/Selections/Documents/Updates/Conversations/Action Center)
to cover the newly-expanded product surface, so the full intended
platform can be evaluated visually and interactively before any new
schema/backend work begins. Every screen in this checkpoint uses static
or lightly-scripted sample data, the same honest labeling already
established ("Preview only — not yet functional") — nothing here claims
to be real, and nothing here is exempted from that labeling because the
underlying module is now scoped as "operational core" rather than
"later expansion."

**Must demonstrate, interactively** (per explicit requirement):
- Company dashboard and Action Center
- Lead conversion and New Project wizard
- Project setup, team, and permissions
- Editable estimate and budget (editable in the prototype sense — the
  interaction works and reflects back through the real Package 1
  engine's display logic; it does not persist to a real backend)
- QuickBooks import review (sample file, sample column mapping,
  sample duplicate detection — no real parser)
- Vendor bid comparison and commitment
- Draw/invoice builder
- Change-order creation and client approval
- Selections and their allowance effects (already partially real today
  via the engine for the financial *display*; this checkpoint extends
  the selection *workflow* interactivity, still against sample data)
- Documents and contract-signature status
- Schedule editing and daily field logs
- Vendor portal (the full IA from the Information Architecture
  document, §4 — interactive, sample data)
- Client portal (already real for Financials; extended for the rest)
- Investor reporting
- Warranty request
- Role switching (already real — `DemoControls` — extended to cover
  Vendor/Investor/Lender roles, not just Admin/Staff/Client)
- **Empty, error, overdue, rejected, and exception states** — every one
  of the screens above must show at least one non-happy-path state
  (an empty selections list, a rejected change order, an overdue
  draw, a failed QuickBooks import row), not just a fully-populated
  happy path — this is an explicit, distinct requirement from simply
  "build the screen."
- **Testing/approval criteria**: the same rigor already established —
  actually executed smoke tests (not just written), honest disclosure
  of anything that couldn't be verified in this sandbox, no
  duplicated financial calculations, admin/client/vendor separation
  preserved and extended (a vendor-role preview must not leak another
  vendor's data even in sample form — the sample data itself should be
  constructed to make this checkable, e.g. two sample vendors with
  distinct data).
- **This checkpoint must be explicitly approved before Package 3
  begins** — same stop-and-review discipline as every package so far.

---

## Package 3 — Platform Core + Project Setup + Vendor Identity Foundation + Leads (thin) + Templates (thin) + Backup Baseline

**Correction**: previously, vendor-facing work didn't appear until
Package 11, which risked Package 5 (Commitments/Bids) needing to expose
something to a vendor before secure vendor identity and RLS existed.
Fixed: **Package 3 now includes the vendor identity/RLS foundation**
(the `'vendor'` `app_role`, `project_members` vendor rows, and the
baseline "vendor sees nothing except their own membership" RLS policy)
even though the vendor-facing *portal UI* still doesn't ship until
Package 11. This is foundation only — no vendor screens ship in
Package 3 — but the security boundary exists and is tested from this
point forward, so every later package that touches vendor data is
building on an already-proven boundary, never introducing one under
time pressure.

- **Builds**: real Supabase Auth wiring; user invitation flow; the
  Project Setup Wizard (module 2); thin Leads (module 1 — intake,
  qualification, conversion to a project; full top-level nav item per
  the Information Architecture decision, but basic capability only);
  thin Project Templates (module 20); vendor identity/RLS foundation
  (module 12's security prerequisite, no UI); baseline backup/
  retention policy (module 35).
- **Completion path for "thin" modules** (per explicit requirement —
  every thin module gets a named completion package): **Leads**
  reaches full capability (lead-source reporting, conversion analytics)
  in **Package 14** alongside module 32. **Templates** reaches full
  capability (complete knowledge base) in **Package 14**.
- **Action Center events added**: none yet — Package 3 has no
  workflow-completion events of its own to surface (it's the
  foundation other packages' events depend on).
- **Dependencies**: none upstream.
- **Workflows made functional**: Workflow Map §1, §2.
- **Integrations required**: Supabase Auth.
- **Testing/approval criteria**: SQL/RLS must actually be run against a
  real Postgres/Supabase instance for the first time in this package —
  this is the package where that gate finally closes, since real user
  accounts start existing here. The vendor RLS foundation added this
  package needs its own explicit isolation test from day one (even
  before any vendor-facing UI exists), not deferred to Package 11.
- **Database/migration requirements**: `leads`, `project_templates`;
  vendor `app_role`/RLS already exist in Package 1's schema — this
  package is where they're finally exercised by real logins.
- **Security/permission requirements**: this is the first real security
  review checkpoint since Package 1's own unexecuted tests.

## Package 4 — Estimating & Budgeting UI + QuickBooks Import

- **Builds**: real budget-entry UI; the QuickBooks Desktop import
  wizard.
- **Action Center events added**: *unmapped QuickBooks costs*
  (a row that couldn't be matched to a cost code during import review);
  *budget overruns* (a category where actual+committed exceeds
  revised estimate — the engine already computes this via
  `generateBudgetSuggestions`, this package is what finally surfaces it
  as an Action Center item rather than only a Financials-screen
  suggestion).
- **Dependencies**: Package 3.
- **Workflows made functional**: Workflow Map §3, §5.
- **Integrations required**: none live (file-based QuickBooks import).
- **Testing/approval criteria**: import duplicate-detection and the
  pending→posted gate need real coverage against realistic QuickBooks
  export samples.
- **Database/migration requirements**: `import_mapping_profiles` (new).
- **Security/permission requirements**: Accounting-only import access.

## Package 5 — Commitments, Bids (PM-side), Procurement & Material Orders

- **Builds**: UI for the `committed_costs` ledger; Bid Management's
  PM-facing half (create package, receive/compare, award); PO/
  subcontract document generation; Procurement/Material Orders (module
  29, adjacent to POs).
- **Action Center events added**: *unapproved changes* (a commitment
  or bid awaiting a decision past its expected timeframe); *backordered
  material* (module 29's delivery-status tracking feeding a real alert,
  not just a status field nobody looks at).
- **Dependencies**: Package 3 (vendor identity/RLS foundation already
  exists — this package can safely reference `project_members` vendor
  rows for "who this bid was sent to" without building any new security
  boundary itself), Package 4 (budget to commit against).
- **Workflows made functional**: Workflow Map §4 (PM-facing half).
- **Integrations required**: PDF generation for PO/subcontract
  documents.
- **Testing/approval criteria**: the existing SQL test suite for
  `committed_costs` must finally run against real Postgres in this
  package if it hasn't already in Package 3.
- **Database/migration requirements**: `bid_packages`,
  `bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`,
  `material_order_line_items`.
- **Security/permission requirements**: bid/commitment data must be
  correctly scoped even though the vendor-facing UI to view it doesn't
  ship until Package 11 — i.e., the RLS policy must be correct and
  tested now, not merely "assumed fine until a vendor can log in and
  prove otherwise."

## Package 6 — Client Billing: Draws, Payments, Retainage

- **Builds**: `invoices`, `payments` tables; draft-draw-from-unbilled-
  expenses workflow; frozen-on-issue calculation; retainage handling.
- **Action Center events added**: *unpaid draws* (issued but not paid
  past their due date).
- **Dependencies**: Package 4, Package 1's fee engine (already built).
- **Workflows made functional**: Workflow Map §6.
- **Integrations required**: none (manual/external payment recording
  only — live payment processing is Package 6b, immediately following).
- **Testing/approval criteria**: "correcting a finalized draw"
  (Exception Register #4) needs explicit, direct test coverage.
- **Database/migration requirements**: `invoices`, `payments`.
- **Security/permission requirements**: client sees issued draws only.

## Package 6b — Payment Processing

**Added per explicit correction** — not an open-ended deferral, a real,
scheduled sub-package immediately following Package 6.

- **Builds**: ACH/card payment links via a real provider; configurable
  convenience-fee handling; provider-reconciliation against
  `payments`; partial/failed/reversed payment handling; refunds/
  credits; a "Pay Now" action added to the client Budget screen and the
  admin Draws & Payments screen.
- **Action Center events added**: *failed/reversed payment* needing
  attention.
- **Dependencies**: Package 6 (extends its payment-recording model with
  a live provider).
- **Workflows made functional**: extends Workflow Map §6 with a real
  online payment step.
- **Integrations required**: a payment processor (provider TBD at
  implementation time).
- **Testing/approval criteria**: a failed/reversed payment must be
  proven to never silently disappear — same append-only discipline as
  the rest of the financial schema, tested explicitly.
- **Database/migration requirements**: `payment_provider_transactions`.
- **Security/permission requirements**: client-initiated only;
  provider credentials/webhooks secured server-side, never exposed to
  the client bundle.

## Package 7 — Change Orders, Field Directives, E-Signature

- **Builds**: `change_orders`, `field_directives` tables; e-signature
  integration (provider chosen here).
- **Action Center events added**: *missing signatures* (a change order
  awaiting client sign-off past a defined window).
- **Dependencies**: Package 4, Package 6.
- **Workflows made functional**: Workflow Map §7, Exception Register #5.
- **Integrations required**: an e-signature provider.
- **Testing/approval criteria**: `budget_ledger`'s existing
  `source_type = 'change_order'` FK slot wired to a real
  `change_orders.id`, tested end-to-end.
- **Database/migration requirements**: `change_orders`,
  `field_directives`.
- **Security/permission requirements**: internal notes vs.
  client-visible terms split.

## Package 8 — Selections & Allowances

- **Builds**: `selections`, `selection_approvals` tables; real UI
  replacing the current preview's hardcoded sample selections.
- **Action Center events added**: *overdue selections* (a decision
  needed past its schedule-driven deadline).
- **Dependencies**: Package 4.
- **Workflows made functional**: Workflow Map §8.
- **Integrations required**: none required for the core.
- **Testing/approval criteria**: "approval must never happen from a
  single unreviewed click" needs a direct test.
- **Database/migration requirements**: `selections`,
  `selection_approvals`.
- **Security/permission requirements**: vendor sees only selections
  assigned to their own scope (references the Package 3 vendor RLS
  foundation).

## Package 9 — Scheduling, Field Operations, Documents, RFIs, Meetings, Safety, Calendar Sync

**Correction**: the prior round's version of this package said "four
new tables" while actually listing five (`schedule_phases`,
`daily_logs`, `field_issues`, `documents`, `rfis`). Corrected — it's
five, and this revision adds two more for the newly-scoped Meetings and
Safety modules, plus a Tasks table for the navigation placement decided
in the Information Architecture document.

- **Builds**: `schedule_phases`, `daily_logs`, `field_issues`,
  `documents`, `rfis` (five tables, corrected count); plus `tasks`,
  `meetings`, `meeting_action_items`, `safety_documents`,
  `safety_incidents` (module 27/28); calendar sync (module 30) as an
  export/sync layer over the above, no new storage.
- **Action Center events added**: *schedule delays* (a phase whose
  actual dates have slipped past plan); *open safety incidents*.
- **Dependencies**: Package 3.
- **Workflows made functional**: Workflow Map §9, §10, §11.
- **Integrations required**: Microsoft Graph/OneDrive (documents);
  Google Calendar/Microsoft Graph Calendar (sync).
- **Testing/approval criteria**: the publish-state pattern must be
  proven for documents including Exception Register #14 (accidental
  exposure) as an explicit test case.
- **Database/migration requirements**: nine new tables (corrected and
  expanded count).
- **Security/permission requirements**: client/vendor document access
  strictly publish-gated.

## Package 10 — Client Communication & Approvals (Conversations)

- **Builds**: `conversation_threads`, `messages`; later,
  `captured_emails` for the hybrid-email architecture, refined toward
  general email-to-project capture (module 31) as a follow-on within
  this same package's scope, not a separate build.
- **Action Center events added**: none new beyond the existing
  "unanswered conversation" concept already anticipated in the master
  plan's own Action Center design.
- **Dependencies**: Package 3; benefits from Packages 7–9 existing.
- **Workflows made functional**: referenced by nearly all named
  workflows as the "ask a question" side-channel.
- **Integrations required**: Microsoft 365/Outlook Graph (optional).
- **Testing/approval criteria**: an email reply must never be
  auto-treated as a signed approval — direct negative test required.
- **Database/migration requirements**: two to three new tables.
- **Security/permission requirements**: internal-only vs. shared
  threads.

## Package 11 — Vendor Portal (full), Bid Management (vendor-side), Compliance, 1099 Support

- **Builds**: the actual vendor-facing portal (the full IA from the
  Information Architecture document, §4); bid invitation/questions/
  addenda/submission UI (vendor-side half of module 13); bid leveling &
  scope-gap comparison; `vendor_profiles`, `vendor_assignments`,
  `vendor_compliance`, `vendor_performance_notes`, `vendor_invoices`,
  `vendor_change_requests`; 1099 export/summary view (module 33); the
  company-wide **Vendors** admin area from the Information Architecture
  document §1.
- **Action Center events added**: *expired COIs*, *missing lien
  waivers*, *vendor invoice exceeding commitment* (Exception Register
  addition).
- **Dependencies**: Package 5 (commitments/bids already exist to expose
  to a vendor), Package 3's vendor RLS foundation (already tested,
  extended here, never introduced fresh under pressure).
- **Workflows made functional**: the vendor-facing half of Workflow Map
  §4; new workflows this package implies (vendor invoice submission →
  matched against commitment → paid; compliance expiration → new-
  commitment block).
- **Integrations required**: none required for the core; COI
  verification services remain later expansion.
- **Testing/approval criteria**: Package 1's existing "Vendor A sees
  nothing" SQL test is the regression baseline this package must extend
  deliberately, re-testing after every new capability added, never
  accidentally weakening it.
- **Database/migration requirements**: six new tables.
- **Security/permission requirements**: the highest-scrutiny package
  for permissions after Package 3.

## Package 12 — Investor & Spec-Home Reporting, Lender Draw Support

- **Builds**: `investors`, `investor_project_stakes`,
  `lender_draw_requests`; a new `app_role` value for both Investor and
  Lender; the Investor portal and the narrow, single-draw-package
  Lender access model (both per the Information Architecture document).
- **Action Center events added**: *lender underfunding/rejected draw*
  (Exception Register addition).
- **Dependencies**: Package 6 (draws must be real to report on).
- **Workflows made functional**: Workflow Map §12b, §13.
- **Integrations required**: none required for the core.
- **Testing/approval criteria**: explicit isolation tests for two new
  roles (investor cannot see another investor's stake or raw vendor
  invoices; lender sees only their one open draw package, nothing else).
- **Database/migration requirements**: three new tables, one enum
  extension (two new role values).
- **Security/permission requirements**: new roles, new RLS policies
  from scratch, tested with the same rigor as the vendor baseline.

## Package 13 — Permits & Inspections, Warranty & Service

- **Builds**: `permits`, `inspections`, `punch_items`,
  `warranty_claims`; the company-level Warranty/Service view under
  **Reports** (Information Architecture document, §1).
- **Action Center events added**: *failed inspections*, *overdue
  warranty items*.
- **Dependencies**: Package 9 (documents, for permit files); Package 6
  (closeout often gates on final billing).
- **Workflows made functional**: Workflow Map §12a; Exception Register
  #10, #17.
- **Integrations required**: none required for the core.
- **Testing/approval criteria**: inspection history proven append-only.
- **Database/migration requirements**: four new tables.
- **Security/permission requirements**: client sees inspection status
  only, not raw reports.

## Package 14 — Company Operations & Reporting (completes every "thin" module)

**This is the explicit completion package for every module deliberately
scoped thin earlier**, per the requirement that no module be left
partially implemented without a named completion path: Leads (full
pipeline analytics, module 32's reporting half), Templates (full
knowledge base), Company Reporting/Action Center (cross-project
analytics, the one piece of Action Center that genuinely was deferred
this long, since it needs several other modules live to aggregate —
every other Action Center event was added incrementally per package
above, per correction).

- **Builds**: Employees & workload (module 23); Time/Mileage/Expense
  Reimbursement (module 24); Company Assets (module 25); Material
  Inventory (module 26); Company Overhead & True Profitability (module
  34, depends on module 24's labor-cost data); full lead-source
  reporting (module 32); self-service data export (module 35); the
  cross-project analytics layer of the Action Center/Reports area.
- **Action Center events added**: none new beyond what's already
  aggregated from Packages 4–13 — this package's job is the
  cross-project *view*, not new event *sources*.
- **Dependencies**: as many of Packages 4–13 as are live.
- **Workflows made functional**: none new; the reporting layer over
  everything else.
- **Integrations required**: none required.
- **Testing/approval criteria**: Action Center must remain "calm and
  actionable-only" even as this package adds analytics — a regression
  test proving it never balloons into a full activity log.
- **Database/migration requirements**: `employees`, `time_entries`,
  `mileage_entries`, `expense_reimbursements`, `company_assets`,
  `asset_assignments`, `material_inventory`, `overhead_allocations`.
- **Security/permission requirements**: true-profitability reporting
  (module 34) is Owner/Accounting only — the most commercially
  sensitive report in the platform, explicitly never PM/Field/Client/
  Vendor visible.

## Package 15 — Carefully Controlled AI Assistance

- **Builds**: `ai_interaction_log`; scoped AI assistance layered onto
  whichever modules are live.
- **Action Center events added**: none — this package doesn't surface
  new operational alerts, it assists with existing ones.
- **Dependencies**: deliberately last.
- **Workflows made functional**: none of the named workflows directly.
- **Integrations required**: an LLM provider (chosen at implementation
  time).
- **Testing/approval criteria**: the highest-scrutiny security review
  in the roadmap.
- **Database/migration requirements**: one new table.
- **Security/permission requirements**: the most stringent in the
  roadmap, by explicit request.

---

## Dependency graph (summary, corrected)

```
Phase 2 (Expanded Interactive Prototype — approval required before Package 3)
   │
Package 3 (Core + Setup + VENDOR RLS FOUNDATION + Leads[thin] + Templates[thin] + Backup baseline)
   │
   ├─→ Package 4 (Estimating + QuickBooks Import)
   │      │
   │      ├─→ Package 5 (Commitments + Bids[PM] + Procurement)
   │      │      │        (vendor RLS already exists from Package 3 — no new
   │      │      │         boundary introduced here under time pressure)
   │      │      └─→ Package 11 (Vendor Portal[full] + Bids[vendor] + Compliance + 1099)
   │      │
   │      ├─→ Package 6 (Billing: Draws/Payments/Retainage)
   │      │      │
   │      │      ├─→ Package 6b (Payment Processing)
   │      │      ├─→ Package 7 (Change Orders + E-Signature)
   │      │      ├─→ Package 12 (Investor/Lender Reporting)
   │      │      └─→ Package 13 (Permits/Inspections/Warranty)
   │      │
   │      └─→ Package 8 (Selections & Allowances)
   │
   ├─→ Package 9 (Scheduling/Field Ops/Documents/RFIs/Meetings/Safety/Calendar)
   │
   └─→ Package 10 (Conversations + Email-to-Project Capture)

Package 14 (Company Operations & Reporting — completes Leads, Templates, Action Center analytics)
   ← trails 4 through 13
Package 15 (AI Assistance) ← deliberately last
```
