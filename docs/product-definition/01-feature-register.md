# Stone Column Operating Platform — Complete Feature Register

Status is graded against the actual repository as of this checkpoint
(Package 1 financial engine, Package 2 app shell/repositories/view
models, and the `apps/web` interactive preview with static sample
content for anything without a real backend yet). "Exists" means real,
tested, engine/schema-backed. "Partial" means schema and/or UI exists
but is incomplete or preview-only. "Missing" means no schema, no
engine, and nothing beyond possibly a nav placeholder.

Role legend: **Owner** (company owner/admin), **PM** (project
manager), **Field** (superintendent/field staff), **Accounting**,
**Client**, **Decision-maker** (authorized client decision-maker,
narrower than Client), **Architect**, **Vendor** (vendor/subcontractor),
**Investor**, **Lender**, **Guest** (read-only).

---

## 0. Platform Core Services (cross-cutting, not one of the user's named modules, but foundational to all of them)

- **Primary users**: all roles.
- **Business purpose**: authentication, organization/role/permission
  management, project membership, audit logging, and the client-safe
  data boundary every other module depends on.
- **Major workflows**: org bootstrap (first admin), user invitation,
  role assignment, project membership assignment, client-preview mode.
- **Important data records**: `orgs`, `profiles`, `project_members`,
  `audit_log`.
- **Permissions/visibility**: RLS-enforced org-scoped staff access,
  project-scoped client/vendor access (vendor RLS not yet written).
  Self-escalation blocked (a user cannot change their own role/org).
- **External integrations**: none yet (real Supabase Auth is the
  intended eventual identity provider; today it's a fixture repository
  with no real login).
- **Exception scenarios**: see Exception Register — confidential file
  exposure, disagreeing decision-makers (needs a "primary
  decision-maker" concept not yet modeled).
- **Audit requirements**: `audit_log` is trigger-written, immutable,
  append-only — already built and tested.
- **Status**: **Partial.** Schema/RLS/bootstrap RPC exist and are
  tested (unexecuted against real Postgres — see Package 1's own
  disclosed gate). No real Supabase Auth wiring, no invitation flow, no
  UI for any of this.
- **Recommended package**: Package 3 (must exist before most other
  modules can have real, non-fixture data).
- **Priority**: **Operational core.**

---

## 1. Leads & Preconstruction

- **Primary users**: Owner, PM, Architect (external, view-only).
- **Business purpose**: capture and track prospective projects before
  they become a signed, active job — the top of the funnel the rest of
  the platform currently assumes already happened.
- **Major workflows**: lead intake → qualification → proposal/estimate
  → contract signed → converts to an active Project (see Workflow Map
  §1).
- **Important data records**: lead (contact, source, estimated scope/
  budget range, status), proposal/estimate versions, contract
  documents.
- **Permissions/visibility**: Owner/PM only; never client- or
  vendor-visible (a lead is pre-relationship).
- **External integrations**: none required for the core; email capture
  (shared with Conversations, module 11) is a natural later fit for
  inbound lead emails.
- **Exception scenarios**: lead goes cold/dead, duplicate lead entry,
  lead converts to a spec project (module 14) instead of a client
  project.
- **Audit requirements**: standard change history; low sensitivity
  compared to financial/legal records, but conversion-to-project must
  be traceable (which lead became which project).
- **Status**: **Missing.** No schema, no UI, not even a placeholder nav
  item.
- **Recommended package**: Package 3 (paired with Project Setup, since
  "lead converts to project" is one workflow spanning both).
- **Priority**: **Second phase.** Real client projects can be created
  directly without a lead pipeline; leads matter once the business
  wants funnel visibility, not for day-one operations.

---

## 2. Project Setup & Administration

- **Primary users**: Owner, PM.
- **Business purpose**: the "New Project" wizard the original master
  plan specified in detail — create a project with the correct
  pricing model, fee rules, cost-code library, modules enabled, and
  client/team invitations, in one guided flow.
- **Major workflows**: new-project wizard (Workflow Map §2); project
  template selection; ongoing project settings edits (fee rules,
  client-visibility defaults, module toggles).
- **Important data records**: `projects`, `project_fee_rules`,
  `project_members`, `cost_codes` (initial library).
- **Permissions/visibility**: Owner/PM create and edit; Accounting can
  view fee rules; Client/Vendor never see internal fee-rule detail
  (already enforced — `project_fee_rules` has no client RLS policy).
- **External integrations**: none for setup itself.
- **Exception scenarios**: changing builder-fee percentage after
  billing has started (see Exception Register); project pause/
  cancellation/contract-type change; saving a project as a draft and
  resuming later.
- **Audit requirements**: every fee-rule change must be versioned, not
  overwritten — `project_fee_rules` already models this via
  `effective_from`/`effective_to`, but no UI writes to it yet.
- **Status**: **Partial.** Schema fully exists and is tested
  (`projects`, `project_fee_rules`, `cost_codes`). No setup wizard UI —
  today, the one demo project (Hawks Ridge) is fixture data, not
  created through any real flow.
- **Recommended package**: Package 3.
- **Priority**: **Operational core.**

---

## 3. Estimating & Budgeting

- **Primary users**: Owner, PM, Accounting.
- **Business purpose**: build and maintain the cost-code-level budget
  a project runs on — original estimate, approved changes, revised
  estimate — which the financial engine already consumes correctly.
- **Major workflows**: estimate to approved budget (Workflow Map §3);
  ongoing budget revisions via change orders (module 7) or manual
  corrections.
- **Important data records**: `budget_ledger` (append-only), `cost_codes`.
- **Permissions/visibility**: Owner/PM/Accounting edit; Client sees
  original/approved/revised via `client_budget_view` (already built);
  never sees internal ledger metadata (source, notes, reversal links).
- **External integrations**: QuickBooks Desktop (module 4) is the
  primary source of *actuals* against this budget, not the budget
  itself, which originates from Stone Column's own estimating.
- **Exception scenarios**: correcting a budget entry (must be a
  reversing entry, never an edit — already enforced by 001's
  append-only triggers); allowance credits/overages (module 8 overlap).
- **Audit requirements**: fully built — `budget_ledger` is append-only,
  reversal-integrity-checked, and every entry is audit-logged.
- **Status**: **Exists** at the engine/schema level (this is the most
  mature module in the platform — Package 1). **Missing** the UI to
  actually create/edit budget entries; today only the fixture
  repository supplies them.
- **Recommended package**: Package 4 (real budget-entry UI + a real
  repository, replacing the fixture).
- **Priority**: **Operational core.**

---

## 4. QuickBooks Desktop Job-Cost Import

- **Primary users**: Accounting.
- **Business purpose**: bring real actual costs in from QuickBooks
  Desktop (the master plan explicitly rejected live QBD integration in
  favor of file import) without duplicating or silently overwriting
  existing expenses.
- **Major workflows**: QuickBooks import to budget actuals (Workflow
  Map §5) — upload, preview, map columns, match cost codes, detect
  duplicates, review, confirm as an immutable batch.
- **Important data records**: `import_batches`, `import_rows`,
  `expenses` (created as `financial_status = 'pending'` until reviewed).
- **Permissions/visibility**: Accounting only; imported-but-unposted
  rows are invisible to Client by construction (posting gate already
  enforced by 002/004's expense state machine).
- **External integrations**: QuickBooks Desktop, via file export
  (IIF/CSV/XLSX), not a live API — matches the master plan's explicit
  choice.
- **Exception scenarios**: duplicate/recoded invoices, credits received
  after billing, vendor name mismatches, wrong cost-code mapping caught
  before posting.
- **Audit requirements**: `import_batches` is designed to be immutable
  once confirmed; every imported expense carries its source batch and
  row number.
- **Status**: **Partial.** `import_batches`/`import_rows` table shells
  exist in schema; zero parsing logic, zero UI, zero column-mapping or
  duplicate-detection code.
- **Recommended package**: Package 4 (alongside real budget entry, since
  the point of importing is populating actuals against that budget).
- **Priority**: **Operational core** — Accounting cannot do real work
  without this.

---

## 5. Commitments, Purchase Orders & Subcontracts

- **Primary users**: PM, Accounting, Vendor.
- **Business purpose**: track money Stone Column has committed to spend
  (signed subs, issued POs) before it becomes an actual expense — the
  budget-vs-committed-vs-actual distinction the engine already computes
  correctly.
- **Major workflows**: vendor bid to commitment (Workflow Map §4);
  commitment partially invoiced (already modeled at the data layer via
  the `supersede_committed_cost()` RPC).
- **Important data records**: `committed_costs` (status enum, supersede
  lineage — the most hardened table in the schema after multiple
  correction rounds).
- **Permissions/visibility**: PM/Accounting full access; Vendor sees
  only their own commitment(s), never others' pricing (vendor RLS not
  yet written).
- **External integrations**: none required for the ledger itself; PO/
  subcontract *document generation* (a PDF to send a vendor) is a
  separate, currently-missing capability.
- **Exception scenarios**: vendor abandonment mid-project, correcting a
  committed amount (supersede, never edit — enforced), expired
  insurance during active work (ties to module 17).
- **Audit requirements**: fully built and the most extensively
  hardened part of the schema — status-transition trigger, INSERT-time
  guard, anti-cycle check, audit-logged.
- **Status**: **Exists** at the ledger/schema level. **Missing**: PO/
  subcontract document generation, bid-to-commitment UI, and the
  vendor-facing side entirely.
- **Recommended package**: Package 5.
- **Priority**: **Operational core** for the ledger (already done);
  **second phase** for PO/subcontract document generation and vendor
  self-service.

---

## 6. Client Billing, Draws, Payments & Retainage

- **Primary users**: Accounting, Owner, Client.
- **Business purpose**: turn reviewed, unbilled actual costs into a
  client-facing draw/invoice, track payment against it, and handle
  retainage — the single biggest gap in the current platform relative
  to the master plan's "exact financial system" requirement.
- **Major workflows**: unbilled costs to client draw and payment
  (Workflow Map §6); correcting a finalized draw (Exception Register).
- **Important data records**: none yet — needs a new `invoices`
  (draws) table, `payments` table, and a formal link from
  `fee_ledger.source_type = 'invoice_issued'` (already reserved in
  schema) to real rows.
- **Permissions/visibility**: Accounting/Owner create and issue;
  Client sees issued draws and payment history only (never drafts).
  `ClientBudgetViewModel` already has `invoices`/`invoiceSummary`
  fields wired and waiting, currently always empty.
- **External integrations**: payment processing is explicitly deferred
  by the master plan (no online payments in this phase).
- **Exception scenarios**: partial client payment, correcting a
  finalized draw (must never edit a signed/issued draw — needs the
  same reversing-entry discipline already proven out for
  `budget_ledger`/`committed_costs`), credits after billing.
- **Audit requirements**: an issued draw must freeze its calculation
  permanently even if fee rules or expenses change later — this is
  explicitly called out in the master plan and not yet built.
- **Status**: **Missing**, but the two things it depends on
  (fee-accrual engine, client-safe view-model shape) are already built
  and waiting — `AdminFinancialsScreen`'s Invoiced/Payments/Balance
  stats are already rendered as explicit "Preview" placeholders for
  exactly this reason.
- **Recommended package**: Package 6.
- **Priority**: **Operational core** — this is the module clients most
  directly feel the absence of.

---

## 7. Change Orders & Field Directives

- **Primary users**: PM, Client, Decision-maker.
- **Business purpose**: the "fast change order suitable for an onsite
  meeting" workflow from the master plan — propose, price, get signed,
  post to budget, all traceably.
- **Major workflows**: change request to signed change order, budget
  update, and billing (Workflow Map §7); a lightweight "Field
  Directive" for emergency/unsigned-in-the-moment work that gets
  formalized after the fact (Exception Register).
- **Important data records**: needs a new `change_orders` table
  (currently only referenced as a free-text `source_type` string on
  `budget_ledger` — not a real linked record) and a `field_directives`
  table for the emergency-work case.
- **Permissions/visibility**: PM drafts; Client/Decision-maker reviews
  and signs; internal notes never shown to client (matches the
  existing internal/client-description split pattern already used for
  `expenses`).
- **External integrations**: e-signature (module 9) for the actual
  signing step.
- **Exception scenarios**: unsigned work authorized in an emergency,
  multiple decision-makers who disagree, a change order that affects
  builder fee eligibility.
- **Audit requirements**: once signed, a change order's terms must be
  frozen — the same append-only discipline as everything else in this
  schema.
- **Status**: **Missing** as a real linked entity — `budget_ledger`
  already has a `source_type = 'change_order'` slot ready to be filled
  by a real foreign key once this table exists (currently populated by
  hand in test fixtures).
- **Recommended package**: Package 7.
- **Priority**: **Operational core.**

---

## 8. Selections & Allowances

- **Primary users**: PM, Client, Decision-maker, Vendor (fulfillment).
- **Business purpose**: the category → room → item approval hierarchy
  from the master plan, including custom/inspiration-only selections
  with no manufacturer/model fields.
- **Major workflows**: selection to approval, purchasing, delivery, and
  installation (Workflow Map §8).
- **Important data records**: needs `selections` (category, room,
  allowance, price, status, approval version) and a
  `selection_approvals` history table (versioned — "approval must never
  happen from a single unreviewed click" per the master plan).
- **Permissions/visibility**: PM manages; Client/Decision-maker
  approves; Vendor sees only selections assigned to their scope.
- **External integrations**: none required for the core; photo storage
  overlaps with Documents (module 9).
- **Exception scenarios**: allowance credits and overages, client-
  supplied materials (no vendor cost, allowance still tracked),
  multiple decision-makers disagreeing on a selection.
- **Audit requirements**: every approval must record exact
  version/financial-impact/acknowledgment — the master plan is explicit
  that this can never be a single unreviewed button click.
- **Status**: **Missing real backend.** The `apps/web` preview shows
  eight realistic sample selections with full detail (category, room,
  allowance, price, status, notes) — restored from the original
  prototype — but every one of them is hardcoded sample content, not
  backed by any schema or engine.
- **Recommended package**: Package 8.
- **Priority**: **Operational core** — allowance tracking directly
  feeds the budget engine's committed/actual figures.

---

## 9. Scheduling & Field Operations

- **Primary users**: PM, Field, Client, Vendor.
- **Business purpose**: the phase-based schedule (the `ScheduleRail`
  component is explicitly called out as the original prototype's
  "signature element") plus daily field logs and issue tracking.
- **Major workflows**: schedule update to vendor/client notification
  (Workflow Map §10); daily log or field issue to task/RFI/change
  request (Workflow Map §11).
- **Important data records**: needs `schedule_phases` (or
  `schedule_milestones`), `daily_logs`, `field_issues`.
- **Permissions/visibility**: Field/PM log; Client sees a client-safe
  schedule view (no internal delay-reason notes); Vendor sees only
  dates affecting their own scope.
- **External integrations**: none required for the core; calendar
  export/sync is a reasonable later addition.
- **Exception scenarios**: schedule slip cascading to multiple trades,
  a field issue that becomes a change order.
- **Audit requirements**: schedule history should be retained (not
  overwritten) so "why did this date move" is answerable later.
- **Status**: **Missing real backend.** `ScheduleRail` and 15 realistic
  sample phases exist in the preview (restored from the original), zero
  schema, zero real data.
- **Recommended package**: Package 9.
- **Priority**: **Operational core** for the schedule itself; **second
  phase** for daily logs/field issues as their own structured records
  (vs. today's informal field communication).

---

## 10. Documents, Plans, RFIs & Electronic Signatures

- **Primary users**: PM, Architect, Client, Vendor.
- **Business purpose**: the OneDrive-backed document library from the
  master plan, plus RFIs and e-signature for change orders/selections/
  contracts.
- **Major workflows**: document upload to review and electronic
  signature (Workflow Map §9).
- **Important data records**: needs `documents` (category, version,
  publish state, OneDrive reference), `rfis`, `signature_requests`.
- **Permissions/visibility**: publish-controlled, matching the
  `financial_status`/`publication_status` split pattern already proven
  out for `expenses` — a document can be internally final but not yet
  client-visible.
- **External integrations**: Microsoft Graph/OneDrive (explicitly the
  master plan's chosen document source of truth); an e-signature
  provider (not yet chosen).
- **Exception scenarios**: outdated plan use in the field, confidential
  internal file accidentally exposed (see Exception Register — this is
  a serious one), a linked OneDrive file renamed/moved/deleted upstream.
- **Audit requirements**: every document view/download by a client
  should be logged given the sensitivity of construction contract
  documents.
- **Status**: **Missing real backend.** Six realistic sample documents
  exist in the preview with category/date/publish-state, restored from
  the original prototype; zero schema, zero OneDrive integration.
- **Recommended package**: Package 9 (paired with schedule, since both
  are field-facing) for documents/RFIs; e-signature can land alongside
  Change Orders (Package 7) since that's its first real consumer.
- **Priority**: **Operational core** for documents; **second phase**
  for RFIs/e-signature as fully structured workflows (vs. document
  upload alone).

---

## 11. Client Communication & Approvals (Conversations)

- **Primary users**: PM, Client, Decision-maker, Vendor.
- **Business purpose**: structured, topic-linked messaging plus the
  "hybrid email" capture architecture from the master plan (a project
  gets a tokenized email address; forwarded emails become portal
  threads).
- **Major workflows**: none of the 13 named end-to-end workflows are
  Conversations-specific, but it's referenced by nearly all of them as
  the "ask a question about X" side-channel.
- **Important data records**: needs `conversation_threads`,
  `messages`, and (later) `captured_emails` for the hybrid-email
  architecture.
- **Permissions/visibility**: internal-only vs. shared visibility per
  thread — never client-visible unless explicitly shared, matching the
  spec's explicit requirement.
- **External integrations**: Microsoft 365/Outlook Graph (optional,
  later phase per the master plan — explicitly not required for MVP).
- **Exception scenarios**: an email reply saying "looks good" must
  never be treated as a signed approval automatically — the master plan
  is explicit that approvals must go through the real
  selection/change-order signature flow.
- **Audit requirements**: full thread history, read/unread state,
  reassignment history.
- **Status**: **Missing real backend.** A realistic sample thread list
  exists in the preview; zero schema, zero email-capture
  infrastructure (this is a master-spec addition — it did not exist in
  the original prototype at all).
- **Recommended package**: Package 10.
- **Priority**: **Second phase.** Useful, but every other module can
  function without it if Stone Column keeps using real email/phone in
  the interim.

---

## 12. Vendor & Subcontractor Management (full scope — implemented progressively, never capped)

**Correction from the prior round**: this module was previously scoped
as "foundation-only, not a full subcontractor-management product." That
framing is removed. Stone Column's long-term platform requires a
complete vendor/subcontractor system; what's progressive is the
**build order** (sub-capabilities below are tagged with their own
package and priority), not the **product ceiling**. Nothing here is a
permanent limitation.

- **Primary users**: Owner, PM, Accounting, Vendor.
- **Business purpose**: the complete lifecycle of working with a trade
  partner — who they are, what they're qualified for, how they're
  invited to bid, how they're paid, whether they're compliant, and
  whether Stone Column would use them again.
- **Full capability list** (each tagged: package / priority):
  - **Vendor directory & trade classifications** — searchable company
    directory, trade/specialty tags, service area. *(Package 11 /
    operational core)*
  - **Bid invitations, questions, addenda, proposal submission** — see
    module 13 (Bid Management) for full detail; listed here for
    completeness. *(Package 5 build, Package 11 vendor-facing UI /
    operational core)*
  - **Bid leveling & scope-gap comparison** — a structured, apples-to-
    apples comparison view (not just a list of numbers) that flags
    what one bidder included that another excluded. *(Package 11 /
    second phase)*
  - **Work orders, purchase orders, and subcontracts** — document
    generation from a `committed_costs` row (already schema-real) into
    an actual PO/subcontract PDF. *(Package 5 / operational core)*
  - **Electronic signatures** (on subcontracts/POs/work orders) — reuses
    the e-signature capability built for Change Orders (module 7,
    Package 7). *(Package 11 / operational core)*
  - **Project assignments & relevant plan access** — a vendor sees only
    the plan sheets/documents explicitly shared with them, not the
    full project file. *(Package 11 / operational core)*
  - **Schedule dates & availability confirmation** — a vendor confirms
    (or flags a conflict with) the dates affecting their own scope; this
    is a real two-way workflow, not just read access. *(Package 11 /
    operational core)*
  - **Vendor invoices & change requests** — a vendor can submit their
    own invoice against a commitment and request a change to their own
    scope/price (distinct from a client-facing Change Order — this is
    vendor-to-Stone-Column, not Stone-Column-to-client). *(Package 11 /
    operational core)*
  - **Payment and retainage status** — a vendor sees what's been paid,
    what's retained, and what's outstanding against their own
    commitment only. *(Package 11, depends on Package 6's payment
    infrastructure / operational core)*
  - **W-9, COI, license, and lien-waiver compliance** — documents on
    file, expiration dates, both conditional and unconditional lien
    waivers (see Exception Register). *(Package 11 / operational core)*
  - **Expiration reminders** — proactive Action Center surfacing before
    a COI/license lapses, not passive storage that's only checked when
    someone happens to look. *(Package 11, Action Center hook added
    incrementally per §4 of the Roadmap / operational core)*
  - **Progress photos** — a vendor can attach photos to their own
    completed work, feeding the same photo infrastructure as Updates &
    Photos (module 9/10). *(Package 11 / second phase)*
  - **Punch-list and warranty assignments** — a vendor sees punch/
    warranty items assigned to them (module 18). *(Package 11, depends
    on Package 13 / second phase)*
  - **Internal performance, quality, reliability, and do-not-use
    records** — an internal-only (never vendor-visible) rating/notes
    system, including a hard "do not use" flag that should block new
    bid invitations to that vendor. *(Package 11 / second phase)*
  - **Vendor tax documents & 1099 support** — see module 33.
    *(Package 11 / second phase)*
  - **Strict protection of competing bids and unrelated project
    finances** — not a feature so much as the non-negotiable security
    property underlying all of the above; see Permissions/visibility
    below.
- **Major workflows**: the vendor-facing half of Workflow Map §4 (Bid
  to Commitment); new workflows this expansion implies —
  "vendor submits invoice → matched against commitment → paid" and
  "vendor compliance expires → blocked from new commitments until
  renewed" (both should be added to the Workflow Map in a future
  revision once their owning packages are scheduled in detail).
- **Important data records**: `app_role` already includes `'vendor'`;
  needs `vendor_profiles` (directory/trade classification),
  `vendor_assignments`, `vendor_compliance` (COI/W-9/license/lien-
  waiver, with expiration dates), `vendor_performance_notes` (internal
  only), `vendor_invoices`, `vendor_change_requests`.
- **Permissions/visibility**: the single most-tested "negative" case in
  the whole schema — Package 1's SQL test suite already proves "Vendor
  A sees nothing except their own `project_members` row" as the
  intentional current baseline. That test is the **regression
  baseline** every one of the capabilities above must be added against
  without weakening it: a vendor must never see another vendor's bid,
  price, performance notes, or an unrelated project's finances, full
  stop, regardless of which capability above is being used.
- **External integrations**: COI verification services exist in the
  market and remain a reasonable **later expansion**, not a day-one
  requirement — the manual compliance-tracking capability above must
  exist first and stand on its own.
- **Exception scenarios**: expired insurance during active work, vendor
  abandonment, vendor invoice exceeding its commitment, incorrect
  vendor paid, joint checks, conditional vs. unconditional lien waivers
  — all added to the Exception Register in this revision.
- **Audit requirements**: compliance expirations need proactive
  surfacing (Action Center); performance/do-not-use records need their
  own access log given their sensitivity (who looked at a vendor's
  internal rating, and when).
- **Status**: **Missing entirely.** No vendor-facing UI, no compliance
  tables.
- **Recommended package**: build spans **Package 5** (commitments/PO
  generation, the record-keeping half) through **Package 11** (the
  actual vendor-facing portal, performance records, compliance
  automation) — see the Roadmap's explicit note that vendor identity
  and RLS must exist *before* Package 5 exposes anything vendor-facing,
  even though the full portal isn't built until Package 11.
- **Priority**: **Operational core** for directory, bid/PO/subcontract
  generation, e-signature, assignments/plan access, schedule
  confirmation, invoices/change requests, payment/retainage status, and
  compliance tracking with expiration reminders. **Second phase** for
  bid leveling, progress photos, punch/warranty assignment, and
  performance/do-not-use records. **Later expansion** only for
  automated third-party COI verification.

---

## 13. Bid Management (full scope)

- **Primary users**: PM, Vendor.
- **Business purpose**: solicit, compare, and award vendor bids before
  they become a commitment (module 5) — including the full invitation/
  clarification/addendum cycle real construction bidding requires, not
  just "submit a number."
- **Full capability list**:
  - Bid package creation and vendor invitation *(Package 5 build /
    operational core)*
  - Vendor questions and formal addenda during the bid period
    *(Package 11 vendor-facing UI / operational core)*
  - Proposal submission, including qualifications/exclusions, not just
    a price *(Package 11 / operational core)*
  - Bid leveling & scope-gap comparison (structured side-by-side, not
    just a sorted list) *(Package 11 / second phase)*
  - Award → creates a `committed_costs` row (already real) *(Package 5
    / operational core)*
- **Major workflows**: vendor bid to commitment (Workflow Map §4).
- **Important data records**: `bid_packages`, `bid_submissions`,
  `bid_questions`, `bid_addenda`.
- **Permissions/visibility**: PM manages; each vendor sees only their
  own submission and the addenda/questions relevant to the package they
  were invited to — never a competitor's pricing or qualifications.
- **External integrations**: none required.
- **Exception scenarios**: a vendor withdraws a bid, a bid expires
  before award, an addendum issued after some vendors already
  submitted.
- **Audit requirements**: bid amounts and submitted qualifications must
  be immutable once submitted (same append-only philosophy as the rest
  of the financial schema); addenda are additive, never edits to the
  original bid package.
- **Status**: **Missing entirely.**
- **Recommended package**: **Package 5** for the PM-facing half (create
  package, receive/compare submissions, award); **Package 11** for the
  vendor-facing half (invitation, questions, addenda, submission UI) —
  this split is deliberate, see the Roadmap's vendor-RLS-ordering note.
- **Priority**: **Operational core** for invitation through award and
  PM-side comparison; **second phase** for structured bid-leveling/
  scope-gap comparison as its own dedicated view.

---

## 14. Investor & Spec-Home Reporting

- **Primary users**: Owner, Investor.
- **Business purpose**: for spec (non-client-commissioned) projects
  with outside investment, report project financials to investors —
  a different visibility model than the client-safe view (investors
  may need to see committed/forecast data clients don't, but not
  necessarily raw vendor invoices).
- **Major workflows**: spec project to investor reporting (Workflow
  Map §12).
- **Important data records**: needs an `investors` table, an
  `investor_project_stakes` link table, and a distinct
  "investor-safe" view model (neither the admin nor the client shape —
  a third visibility tier the platform doesn't have yet).
- **Permissions/visibility**: a genuinely new access tier — not
  admin/staff, not client, not vendor. `app_role` would need an
  `'investor'` value added.
- **External integrations**: none required for the core.
- **Exception scenarios**: an investor enters or leaves a project
  mid-construction (see Exception Register) — their reporting access
  must start/stop cleanly without retroactively hiding history they
  were entitled to at the time.
- **Audit requirements**: investor access grants/revocations should be
  logged given the financial sensitivity.
- **Status**: **Missing entirely.** No schema, no role, no UI.
- **Recommended package**: Package 12.
- **Priority**: **Later expansion** — only relevant once Stone Column
  actually runs a spec project with outside investors.

---

## 15. Lender Draw Support

- **Primary users**: Owner, Accounting, Lender.
- **Business purpose**: assemble the supporting package a construction
  lender requires to release a draw (often overlapping with, but not
  identical to, the client draw in module 6).
- **Major workflows**: lender draw request and supporting package
  (Workflow Map §13).
- **Important data records**: needs a `lender_draw_requests` table and
  a way to bundle specific documents/invoices/inspection sign-offs into
  one package.
- **Decision (per explicit correction request): Lender is a real,
  narrowly-scoped portal role with its own RLS, not merely "published
  report access."** The distinction matters: published-report access
  would mean a lender just receives a PDF/link with no ongoing account;
  a real portal role means a lender can log in, see the specific draw
  package(s) they're entitled to, and that access is governed by the
  same RLS discipline as every other role — auditable, revocable, and
  incapable of seeing anything outside its scope by construction, not
  by convention. Given how infrequently lenders need access (per draw,
  not continuously), the practical UI can still be extremely minimal —
  a single draw-package view, nothing else — but the underlying access
  model is a real role (`app_role` gains a `'lender'` value), matching
  Investor (module 14) in kind, not a report-emailing shortcut.
- **Permissions/visibility**: narrower than Investor — typically
  read-only on one specific, currently-open draw package, not the whole
  project.
- **External integrations**: many lenders have their own draw-request
  portals/formats; likely PDF export is the realistic near-term
  integration, not a live API.
- **Exception scenarios**: a failed inspection blocking a draw release,
  lender underfunding or a rejected draw (added to the Exception
  Register in this revision).
- **Audit requirements**: once submitted to a lender, a draw package
  should be frozen, same as a client draw; lender access grants/
  revocations logged, same as Investor.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 12 (alongside Investor reporting,
  since both are "external financial stakeholder" reporting problems
  needing the same kind of new, narrow role).
- **Priority**: **Later expansion.**

---

## 16. Permits & Inspections

- **Primary users**: PM, Field.
- **Business purpose**: track permit applications/approvals and
  inspection scheduling/results as first-class records, not just a
  line item in Documents.
- **Major workflows**: overlaps with Documents (module 10) for the
  permit document itself; inspection results feed Schedule (module 9)
  and can block a draw (module 15).
- **Important data records**: needs `permits`, `inspections`.
- **Permissions/visibility**: PM/Field manage; Client typically sees
  status only, not the raw inspection report.
- **External integrations**: some jurisdictions offer permit-status
  APIs; not assumed for the core.
- **Exception scenarios**: a failed inspection, a permit expiring
  before work completes.
- **Audit requirements**: inspection history should never be edited
  after the fact, only appended to (re-inspection is a new record).
- **Status**: **Missing entirely.**
- **Recommended package**: Package 13.
- **Priority**: **Later expansion** for a dedicated module — basic
  permit tracking can live as a Documents sub-category (module 10)
  until then.

---

## 17. Compliance (COIs, W-9s, Lien Waivers) — merged into module 12

**Correction**: this is not a separate module — it is the compliance
data domain already fully specified inside the expanded module 12
above (W-9/COI/license/lien-waiver tracking, expiration reminders,
conditional vs. unconditional lien waivers). Retained as a numbered
entry only so a reader looking for "Compliance" by name finds a
pointer rather than a gap. See module 12 for full detail, package, and
priority.

---

## 18. Warranty & Service

- **Primary users**: PM, Field, Client, Vendor.
- **Business purpose**: the master plan's lightweight "Punch/Warranty"
  concept — room, issue, photo, assigned vendor, due date, completion
  photo, client acknowledgment — extended post-completion into a
  service-request/warranty-claim lifecycle.
- **Major workflows**: project completion to closeout and warranty
  (Workflow Map §12, shares a number with spec reporting in the user's
  list — treated as two related but distinct workflows here); warranty
  claim after a subcontractor is unavailable (Exception Register).
- **Important data records**: needs `punch_items`, `warranty_claims`.
- **Permissions/visibility**: Client submits/views their own claims;
  Vendor sees only claims assigned to them.
- **External integrations**: none required.
- **Exception scenarios**: warranty claim after the responsible
  subcontractor is no longer in business — needs a fallback
  assignment path.
- **Audit requirements**: completion photo + client acknowledgment
  should be immutable once recorded (proof of resolution).
- **Status**: **Missing entirely.**
- **Recommended package**: Package 13 (paired with Permits, since both
  are "project lifecycle bookend" concerns — permits at the start,
  warranty at the end).
- **Priority**: **Second phase** — every active project will
  eventually need this; it's not needed for projects still under
  construction.

---

## 19. Company Reporting (incl. Action Center)

- **Primary users**: Owner, Accounting, PM.
- **Business purpose**: cross-project visibility — the master plan's
  "Action Center" (calm, actionable-only list, not a full activity
  feed) plus company-wide financial/operational reporting once
  multiple real projects exist.
- **Major workflows**: not one of the 13 named workflows directly;
  this is the aggregation layer sitting on top of all of them.
- **Important data records**: no new tables required for Action
  Center itself (it aggregates existing records — pending selections,
  unpublished expenses, expiring compliance, etc.); company-wide
  reporting will need cross-project aggregation queries, not new
  storage.
- **Permissions/visibility**: Owner/Accounting/PM only, scoped to
  projects they're a member of (already the RLS model).
- **External integrations**: none required.
- **Exception scenarios**: none specific to this module.
- **Audit requirements**: none beyond what the underlying records
  already carry.
- **Status**: **Partial.** The preview shows a realistic Action Center
  with grouped sample items (Needs attention today / Waiting on
  client / Waiting on vendor / Upcoming this week) — the exact
  grouping the master plan specifies — but it's static sample content,
  not aggregated from real records (because most of the record types
  it should aggregate — selections, documents, expenses-needing-
  review — don't have real backends yet either).
- **Recommended package**: Package 14, after enough of the underlying
  modules are real that aggregating them means something.
- **Priority**: **Second phase** for company-wide reporting; the
  Action Center's *aggregation logic* should actually be built
  incrementally alongside each module it surfaces (e.g., the
  unpublished-expense count becomes real the moment Package 4 ships).

---

## 20. Company Templates & Knowledge Base

- **Primary users**: Owner, PM.
- **Business purpose**: reusable project templates (Custom Home,
  Renovation/Addition, Small Service Job — named in the original master
  plan's Project Setup Wizard section) and an internal knowledge base
  for company standards/processes.
- **Major workflows**: consumed by Project Setup (module 2)'s
  "template" step, not a standalone workflow.
- **Important data records**: needs `project_templates` (default cost
  codes, default modules enabled, default fee structure).
- **Permissions/visibility**: Owner/PM manage; never client/vendor
  visible.
- **External integrations**: none required.
- **Exception scenarios**: none specific.
- **Audit requirements**: template changes shouldn't retroactively
  alter projects already created from that template.
- **Status**: **Missing entirely** — the master plan named specific
  template types but none exist as real records; today every project
  is built from scratch (in practice, from the one fixture).
- **Recommended package**: Package 3 (a thin version — just enough
  template support for the Project Setup Wizard to be useful); Package
  14 for the fuller knowledge-base UI.
- **Priority**: **Second phase** for basic templates; **later
  expansion** for a full knowledge base.

---

## 21. Carefully Controlled AI Assistance

- **Primary users**: all roles, scoped per-role.
- **Business purpose**: the user's brief explicitly asks for this to be
  "carefully controlled" — meaning scoped, auditable AI help (e.g.,
  drafting a client update from field notes, summarizing a long
  conversation thread, flagging an unusual budget variance) rather than
  open-ended access to all company data.
- **Major workflows**: not one of the 13 named workflows; this is an
  assistive layer across several of them once they exist.
- **Important data records**: needs an `ai_interaction_log` (what was
  asked, what data was in scope, what was generated) for auditability —
  the "carefully controlled" requirement implies this is non-negotiable
  from day one of this module, not an afterthought.
- **Permissions/visibility**: must respect the exact same admin/client/
  vendor boundaries as everything else — an AI assistant must never be
  a backdoor around RLS (e.g., a client-facing assistant must only ever
  see client-safe data, enforced the same way `ClientBudgetViewModel`
  is today, not by trusting a prompt).
- **External integrations**: an LLM provider (unspecified) — this
  document doesn't recommend one; that's an implementation-time
  decision, not a product-definition one.
- **Exception scenarios**: AI-generated content must never be treated
  as an approval, signature, or financial calculation — the same
  principle already enforced for the Package 1 suggestion engine
  ("suggestions are never official until a human accepts them") should
  extend to any AI output.
- **Audit requirements**: the highest of any module in this register —
  every AI-assisted action needs a clear record of what data it saw and
  what it produced.
- **Status**: **Missing entirely.** Explicitly the last module in this
  register, by design — it depends on nearly everything else existing
  first to have real data worth assisting with.
- **Recommended package**: Package 15 (last).
- **Priority**: **Later expansion.**

---

## 22. Payment Processing

**Added per explicit correction** — this must have a real destination
package, not an open-ended deferral.

- **Primary users**: Accounting, Owner, Client.
- **Business purpose**: QuickBooks Desktop remains the accounting
  system of record (unchanged), but clients should eventually be able
  to pay a draw directly through the portal rather than by check/wire
  arranged entirely outside it.
- **Full capability list**: ACH payment links; card payments where
  appropriate; configurable convenience-fee handling (who absorbs a
  card processing fee, shown transparently); payment-provider
  reconciliation against the draw ledger; partial payments; failed or
  reversed payments; refunds and credits; deposits and retainage
  handled as real payment-ledger entries, not just budget-side numbers;
  client payment receipts.
- **Major workflows**: extends Workflow Map §6 (Unbilled Costs to Draw
  and Payment) with a real online payment step instead of an external,
  manually-recorded one.
- **Important data records**: needs `payment_provider_transactions`
  (linked to `payments`, module 6), storing provider reference IDs,
  status, and fee amounts distinctly from the payment amount itself so
  reconciliation is exact to the cent — the same "exact, traceable,
  accounted for" discipline already proven throughout the Package 1
  schema.
- **Permissions/visibility**: Client initiates their own payment;
  Accounting sees full reconciliation detail; a failed/reversed payment
  must never silently disappear — it stays a visible record with its
  own status.
- **External integrations**: a payment processor (Stripe or similar;
  provider choice is an implementation-time decision, not a product-
  definition one) supporting ACH and card.
- **Exception scenarios**: failed/reversed ACH or card payment,
  refunds, retainage release (added to the Exception Register in this
  revision).
- **Audit requirements**: the same append-only, reversing-entry
  discipline as every other financial record in this platform — a
  failed payment is never edited into a successful one; it's superseded
  by a new, successful attempt with a link back to the failed one.
- **Status**: **Missing entirely.**
- **Recommended package**: **Package 6b** — a distinct sub-package
  immediately following Package 6 (Client Billing: Draws, Payments,
  Retainage), since it extends that module's payment-recording
  capability with a live provider rather than introducing new
  first-party concepts. Explicitly not "later, unscheduled" — see the
  Roadmap.
- **Priority**: **Second phase.** The manual/external payment recording
  Package 6 already builds is sufficient for operational core; live
  in-portal payment is a real, scheduled enhancement on top of it, not
  a permanent deferral.

---

## 23. Employees, Roles & Workload

- **Primary users**: Owner, PM, Field, Accounting.
- **Business purpose**: track who works for Stone Column (distinct from
  `profiles`, which covers anyone with portal access, including
  clients/vendors) — their role, trade skills, and current workload
  across active projects.
- **Important data records**: needs `employees` (distinct from
  `profiles` — an employee record can exist without portal access, and
  a `profiles` row can exist for a non-employee like a client).
- **Permissions/visibility**: Owner/PM only; never client/vendor
  visible.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 14 (Company Reporting/Operations),
  since workload visibility is inherently a cross-project reporting
  concern.
- **Priority**: **Second phase.**

---

## 24. Time, Mileage & Expense Reimbursement

- **Primary users**: Field, PM, Accounting.
- **Business purpose**: employee time/mileage/expense tracking that
  feeds true project profitability (module 34) and payroll (explicitly
  out of scope per the original master plan's payroll deferral — this
  module stops at *tracking*, not running payroll itself).
- **Important data records**: needs `time_entries`, `mileage_entries`,
  `expense_reimbursements`.
- **Permissions/visibility**: employee submits their own; PM/Accounting
  approves; never client/vendor visible.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 14.
- **Priority**: **Later expansion** — genuinely useful, but the
  platform's financial core (client-facing budget/billing) doesn't
  depend on it.

---

## 25. Company Tools, Vehicles, Trailers & Equipment

- **Primary users**: Owner, Field.
- **Business purpose**: track company-owned (not project-purchased)
  assets — which truck/trailer/tool is where, maintenance due dates.
- **Important data records**: needs `company_assets`,
  `asset_assignments` (which project/employee currently has it).
- **Permissions/visibility**: Owner/Field only.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 14.
- **Priority**: **Later expansion.**

---

## 26. Material Inventory & Leftover-Material Locations

- **Primary users**: PM, Field.
- **Business purpose**: track leftover/surplus material from one
  project that could be used on another, rather than it being
  forgotten in a trailer or written off.
- **Important data records**: needs `material_inventory` (item,
  quantity, current location/project).
- **Permissions/visibility**: PM/Field only.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 14.
- **Priority**: **Later expansion.**

---

## 27. Meetings, Agendas, Minutes, Decisions & Action Items

- **Primary users**: Owner, PM, Field, Architect, Client.
- **Business purpose**: structured record of project meetings (OAC
  meetings, subcontractor coordination) — agenda, minutes, decisions
  made, and action items assigned, distinct from the informal
  Conversations thread (module 11).
- **Important data records**: needs `meetings`, `meeting_action_items`
  (which can convert into a Task the same way a Field Directive
  converts into a Change Order — content carried forward, not retyped).
- **Permissions/visibility**: per-meeting, similar to Conversations'
  internal-vs-shared model.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 9 (alongside Scheduling & Field
  Operations, since meetings are fundamentally a field-operations
  record) — see the Information Architecture's placement of "Meetings"
  and "Tasks" under Schedule.
- **Priority**: **Second phase.**

---

## 28. Safety Documentation & Incident Reporting

- **Primary users**: Owner, PM, Field, Vendor.
- **Business purpose**: safety plans, toolbox talks, and incident
  reports (the Exception Register's "safety incident" scenario) as
  first-class, retained (never-edited-after-the-fact) records.
- **Important data records**: needs `safety_documents`,
  `safety_incidents`.
- **Permissions/visibility**: Owner/PM manage; an incident report
  should be visible to the vendor whose worker was involved, not to
  unrelated vendors.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 9 (field operations).
- **Priority**: **Second phase** — genuinely important, but distinct
  from the platform's financial/client-facing core.

---

## 29. Procurement, Material Orders, Lead Times, Delivery & Backorders

- **Primary users**: PM, Accounting, Vendor.
- **Business purpose**: track material orders distinct from
  Commitments (module 5, which is about *who* Stone Column owes money
  to) — *what* was ordered, expected lead time, delivery status, and
  backorder handling, which directly affects Schedule (module 9).
- **Important data records**: needs `material_orders`,
  `material_order_line_items` (expected/actual delivery date, backorder
  flag).
- **Permissions/visibility**: PM/Accounting manage; Vendor (the
  supplier) sees their own order status.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 5 (Commitments), since a material
  order is naturally adjacent to a purchase order — same package,
  distinct data domain.
- **Priority**: **Second phase.**

---

## 30. Calendar Synchronization

- **Primary users**: Owner, PM, Field, Client, Vendor.
- **Business purpose**: sync Schedule (module 9) dates and Meetings
  (module 27) to each user's own external calendar (Google/Outlook).
- **Important data records**: none new — this is an export/sync layer
  over existing schedule/meeting data, not a new source of truth.
- **Permissions/visibility**: each user only syncs what they're already
  entitled to see (no new exposure — a client's calendar sync shows
  only client-safe schedule data).
- **External integrations**: Google Calendar / Microsoft Graph Calendar
  APIs.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 9 (alongside Scheduling, its natural
  consumer).
- **Priority**: **Later expansion.**

---

## 31. Email-to-Project Capture

- **Primary users**: PM, Owner.
- **Business purpose**: distinct from Conversations' (module 11)
  hybrid-email architecture in scope — that module captures ongoing
  project *conversation* via a tokenized project email address; this
  module is the more general capability of routing **any** inbound
  email (including ones that aren't part of an existing thread) to the
  correct project automatically, which Conversations' architecture is
  the foundation for but doesn't fully solve alone (matching a new,
  never-before-seen sender to the right project is a harder problem
  than matching a reply to an existing thread).
- **Status**: **Missing entirely.**
- **Recommended package**: Package 10 (Conversations), as a later
  refinement of that module's own email-capture architecture, not a
  separate build.
- **Priority**: **Later expansion.**

---

## 32. Website Lead Intake & Lead-Source Reporting

- **Primary users**: Owner, PM.
- **Business purpose**: capture leads (module 1) directly from Stone
  Column's website contact form, and report which lead sources
  (website, referral, past client) actually convert.
- **Important data records**: extends the `leads` table (module 1)
  with a `source` field (already anticipated in module 1's design) and
  adds lead-source conversion reporting.
- **External integrations**: a website form → API webhook.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 3 (alongside the thin Leads module
  it extends) for basic source tagging; **Package 14** for the
  reporting half.
- **Priority**: **Second phase** for source tagging; **later
  expansion** for full conversion-rate reporting.

---

## 33. Vendor Tax-Document & 1099 Support

- **Primary users**: Accounting.
- **Business purpose**: W-9 collection (already listed under module 12)
  plus 1099 preparation support at year-end — this module is the
  reporting/export half; module 12 owns the document-collection half.
- **Important data records**: uses `vendor_compliance` (module 12) for
  the W-9 itself; needs a year-end 1099 export/summary view.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 11 (same as module 12 — this is a
  reporting view over the same data, not a new domain).
- **Priority**: **Second phase.**

---

## 34. Company Overhead, Supervision Effort & True Project Profitability

- **Primary users**: Owner, Accounting.
- **Business purpose**: a project's contractor fee (already
  accurately computed by the Package 1 engine) is not the same as its
  true profitability once company overhead and PM/supervision time
  (module 24) are allocated against it — this module is the
  company-level "did we actually make money" view the master plan's
  "Company Reporting" section implies but doesn't fully specify.
- **Important data records**: needs `overhead_allocations`,
  consuming `time_entries` (module 24) and the existing Package 1
  fee/actual-cost data — this module computes nothing new at the
  per-project level, it aggregates and allocates.
- **Permissions/visibility**: Owner/Accounting only — this is the most
  commercially sensitive report in the entire platform (true margin,
  not just contract fee) and should never be visible to PM/Field, let
  alone Client/Vendor.
- **Status**: **Missing entirely.**
- **Recommended package**: Package 14.
- **Priority**: **Later expansion** — depends on Time & Expense
  (module 24) existing first to have real labor-cost data to allocate.

---

## 35. Data Export, Backup, Retention & Disaster Recovery

- **Primary users**: Owner.
- **Business purpose**: the operational counterpart to everything else
  in this register — regular backups, a defined retention policy
  (especially for financial/audit records, which likely need
  longer retention than operational chatter), and a real data-export
  capability (also the mechanism behind the "project ownership
  transfer" exception scenario).
- **Important data records**: none new — this is operational
  infrastructure around the existing schema, not a new domain.
- **Permissions/visibility**: Owner-initiated exports only; backup/
  recovery is an infrastructure concern, not a portal feature most
  users ever see directly.
- **External integrations**: Supabase's own backup capabilities are the
  likely foundation; disaster-recovery runbooks are a process
  deliverable, not just code.
- **Status**: **Missing entirely** as a deliberate, designed capability
  — though every table in the existing schema is already designed
  around append-only, non-destructive patterns specifically because
  that makes backup/recovery/audit meaningfully easier than a schema
  built on in-place updates would be.
- **Recommended package**: Package 3 (basic backup/retention policy
  should exist from the moment real customer data exists, not be an
  afterthought) for the operational baseline; **Package 14** for a full
  self-service export UI.
- **Priority**: **Operational core** for backup/retention existing at
  all once real data exists (Package 3); **later expansion** for
  self-service export tooling.

---

## Summary Table

| # | Module | Status | Package | Priority |
|---|---|---|---|---|
| 0 | Platform Core Services | Partial | 3 | Operational core |
| 1 | Leads & Preconstruction | Missing | 3 | Second phase |
| 2 | Project Setup & Administration | Partial | 3 | Operational core |
| 3 | Estimating & Budgeting | Exists (engine) / Missing (UI) | 4 | Operational core |
| 4 | QuickBooks Desktop Import | Partial (shells) | 4 | Operational core |
| 5 | Commitments/POs/Subcontracts | Exists (ledger) / Missing (docs, vendor side) | 5 | Operational core / Second phase |
| 6 | Client Billing, Draws, Payments, Retainage | Missing | 6 | Operational core |
| 7 | Change Orders & Field Directives | Missing | 7 | Operational core |
| 8 | Selections & Allowances | Missing (preview only) | 8 | Operational core |
| 9 | Scheduling & Field Operations | Missing (preview only) | 9 | Operational core / Second phase |
| 10 | Documents, Plans, RFIs, E-Signatures | Missing (preview only) | 9 (docs) / 7 (e-sign) | Operational core / Second phase |
| 11 | Client Communication & Approvals | Missing (preview only) | 10 | Second phase |
| 12 | Vendor & Subcontractor Management (full scope) | Missing | 5 (build) → 11 (portal) | Operational core (most capabilities) / Second phase / Later expansion (COI auto-verify) |
| 13 | Bid Management (full scope) | Missing | 5 (build) → 11 (vendor UI) | Operational core / Second phase (leveling) |
| 14 | Investor & Spec-Home Reporting | Missing | 12 | Later expansion |
| 15 | Lender Draw Support (real portal role, narrow scope) | Missing | 12 | Later expansion |
| 16 | Permits & Inspections | Missing | 13 | Later expansion |
| 17 | Compliance — merged into module 12 | — | 5/11 | — |
| 18 | Warranty & Service | Missing | 13 | Second phase |
| 19 | Company Reporting (incl. Action Center) | Partial (preview only) | 14 (analytics) — Action Center grows every package | Second phase |
| 20 | Company Templates & Knowledge Base | Missing | 3 (thin) / 14 (full) | Second phase / Later expansion |
| 21 | Carefully Controlled AI Assistance | Missing | 15 | Later expansion |
| 22 | Payment Processing | Missing | 6b | Second phase |
| 23 | Employees, Roles & Workload | Missing | 14 | Second phase |
| 24 | Time, Mileage & Expense Reimbursement | Missing | 14 | Later expansion |
| 25 | Company Tools, Vehicles, Trailers & Equipment | Missing | 14 | Later expansion |
| 26 | Material Inventory & Leftover-Material Locations | Missing | 14 | Later expansion |
| 27 | Meetings, Agendas, Minutes, Decisions & Action Items | Missing | 9 | Second phase |
| 28 | Safety Documentation & Incident Reporting | Missing | 9 | Second phase |
| 29 | Procurement, Material Orders, Lead Times, Delivery | Missing | 5 | Second phase |
| 30 | Calendar Synchronization | Missing | 9 | Later expansion |
| 31 | Email-to-Project Capture (general inbound routing) | Missing | 10 | Later expansion |
| 32 | Website Lead Intake & Lead-Source Reporting | Missing | 3 (tagging) / 14 (reporting) | Second phase / Later expansion |
| 33 | Vendor Tax-Document & 1099 Support | Missing | 11 | Second phase |
| 34 | Company Overhead, Supervision Effort & True Profitability | Missing | 14 | Later expansion |
| 35 | Data Export, Backup, Retention & Disaster Recovery | Missing | 3 (baseline) / 14 (self-service) | Operational core (baseline) / Later expansion (tooling) |

