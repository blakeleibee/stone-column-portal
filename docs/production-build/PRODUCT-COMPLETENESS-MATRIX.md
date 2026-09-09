# Product Completeness Matrix

**Status: Approved in principle (2026-08-19), living document.**
Companion analysis to `PRODUCT-VISION.md`, produced by reviewing the
full existing architecture/roadmap/design/milestone document set as of
2026-08-15. This is a **living snapshot**, not a permanent record —
re-derive it (or at least its status column) at each major package
boundary rather than trusting it as current forever. Section C's
foundation gaps are now being actively resolved by
`docs/production-build/P3-DESIGN.md`, pulled forward ahead of P5
Task 7 — update this document's status entries once P3 ships.

Sources reviewed in full for this document: `PRODUCTION-ROADMAP.md`,
`TARGET-ARCHITECTURE.md`, `PRODUCTION-READINESS-AUDIT.md`,
`FINANCIAL-ARCHITECTURE.md`, `SECURITY-AND-PERMISSIONS-MATRIX.md`,
`CLIENT-APPROVAL-MODEL.md`, `AI-ASSISTANT-ARCHITECTURE.md`,
`PROTOTYPE-TO-PRODUCTION-MATRIX.md`, `DATA-MIGRATION-AND-FIXTURES.md`,
`PRE-P4-CHECKPOINT.md`, `WORKBOOK-GAP-ANALYSIS.md`, every
`docs/milestones/*.md`, every `P*-DESIGN.md`, all five
`docs/product-definition/*.md` files, `docs/CHECKLIST.md`.

---

## How to read this

- **Status** values: **Live** (real, DB-backed, tested, in production
  code), **Designed/Paused** (design approved, schema may exist,
  implementation not finished — currently only P5), **Planned**
  (named in a future package, nothing built), **Missing/Underspecified**
  (implied by this vision or the feature register but not clearly
  homed in any package's exact-scope text today).
- **Package** cites the current `PRODUCTION-ROADMAP.md` P-number.
  Where a capability was named in the old, superseded
  `docs/product-definition/05-implementation-roadmap.md` but has no
  fully-specified home yet, that's called out in Section D/E, not
  silently mapped.

---

## Section A — Role summary

| Role | Live today | Next milestone that matters to them | Package that completes their experience |
|---|---|---|---|
| Owner/Admin | Full org visibility on everything built so far (financials, estimates, QuickBooks import); no project-create/switch UI yet | A real project-setup workflow | P2/P3 remainder |
| Project Manager | Estimate/budget entry (P4); bid-package schema ready, UI paused (P5) | P5 resuming (Tasks 7–9: commitments, procurement UI) | P5 |
| Superintendent/Field Staff | Nothing built for this role specifically; currently indistinguishable from PM/Accounting at the DB level | `staff_function` differentiation | P2/P3 remainder (flagged "no later than P3"), full field tools in P9 |
| Accounting | QuickBooks import/reconciliation (P4); no invoices/draws yet | Client billing | P6 |
| Client | Real, live budget view (`/admin/financials`-equivalent client screen); everything else preview-only fixture content | Selections, change orders, documents becoming real | P7, P8, P9 |
| Authorized Client Decision-Maker | Concept documented (`CLIENT-APPROVAL-MODEL.md`); `project_decision_makers` table not built | Real approval authority | P7/P8 (first real consumers) |
| Architect/Designer | No schema role, no UI | Owner decision on whether this role is needed at all | Unhomed — see Section D |
| Vendor/Subcontractor | RLS foundation only (`is_project_vendor()`, `vendor_members`); no vendor-facing UI | PM-side bidding UI resuming (P5), then vendor's own portal | P5 (PM side) → P11 (vendor side) |
| Investor | No role, no schema, no UI | — | P12 |
| Lender | No role, no schema, no UI | — | P12 |
| Read-Only Guest | Policy-level only | Owner decision on whether this is ever needed | Unhomed — see Section D |

## Section B — Lifecycle workflow matrix

### Setup & team

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| Create a new project | Owner, PM | P2/P3 remainder | Missing/Underspecified | No UI exists; `projects` table and `project_fee_rules` exist (P2.1) |
| Select / switch between projects, visible on every screen | All staff | P2/P3 remainder | Missing/Underspecified | Every current admin screen is fixture-bound to one project outside `/admin/financials` |
| Assign team members to a project | Owner, PM | P2/P3 remainder | Missing/Underspecified | `project_members` table exists; no assignment UI |
| Assign clients to a project | Owner, PM | P2/P3 remainder | Missing/Underspecified | — |
| Configure project pricing/fee terms | Owner, PM | P2/P3 remainder | Missing/Underspecified | `project_fee_rules` schema real (P2.1); no configuration UI |
| Company-wide auth, org/role foundation | All roles | P1 | **Live** | Real Supabase Auth, RLS, audit triggers, verified against hosted project |
| Financial master data (divisions, 113 cost codes, vendor master) | Owner, Accounting | P2.1 | **Live** | No UI; data only |

### Estimating & budgeting

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| Build/edit an estimate by cost code | Owner, PM | P4 | **Live** | |
| Budget ledger entry/adjustment | Owner, PM, Accounting | P4 | **Live** | Append-only, corrections not edits |
| QuickBooks Desktop import & reconciliation | Accounting | P4 | **Live** | Mapping profiles, duplicate detection, review gate |
| Project-specific cost-code breakdown items | Owner, PM, Accounting | P4.1 | Designed, not approved | See `P4.1-DESIGN.md`; confirmed to already satisfy the owner's 2026-08-20 "detailed budget foundation" requirement in full — no redesign |
| Historical pricing intelligence (avg/range/recent cost, source & confidence, per cost code/child) | Owner, PM, Accounting | P4.2 | Not yet designed | Recorded 2026-08-20; read-only analytical layer, no new source of truth — see `FINANCIAL-ARCHITECTURE.md` |
| Tiered pricing (Value/Standard/Premium, per cost item) & estimate-generation suggestion engine | Owner, PM | P4.3 | Not yet designed | Recorded 2026-08-20; depends on P4.1's child-item granularity and P4.2's historical data |
| Controlled QuickBooks budget/estimate export | Accounting, Owner | P4.4 | Not yet designed | Recorded 2026-08-20; QuickBooks Estimate-vs-Budget target explicitly deferred pending real QuickBooks evidence — see Section D |
| Progressive, savable project-setup workflow (identity/intake/handoff → brief & site info → estimate/budget → cost codes → selections → contract/pricing terms → QuickBooks → schedule → documents) | Owner, PM | P3+P3.1 (identity, intake, handoff, brief, site info, deferred pricing) → P4.1/P4.3/P4.4/P8/P9 (remaining steps) | P3.1 design drafted, not yet implemented; step 1 (identity only) live as of P3 | See `PRODUCT-VISION.md` §3 and `P3.1-DESIGN.md`; setup checklist names future steps "coming later," never simulates them |

### Procurement & commitments

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| Record a commitment (PO/subcontract value) | PM, Accounting | P5 | Designed/Paused | Schema live (migration 015); UI paused after Task 6 of 12 |
| PM-side bid packages: create, invite, receive, compare, award | PM, Vendor(invited) | P5 | Designed/Paused | `/admin/bids` shipped (Task 6); award/Q&A services shipped |
| Procurement / material orders / backorders | PM, Accounting, Vendor | P5 | Designed, not yet built | Tasks 8–9, not reached |
| PO/subcontract PDF generation | PM, Vendor | P5 | Designed, not yet built | Task 10, not reached |
| Vendor's own bid/portal experience | Vendor | P11 | Planned | Only PM-side exists in P5 |
| Vendor compliance, 1099 support | Accounting | P11 | Planned | |

### Client experience

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| Budget & invoice view | Client | P4 (budget), P6 (invoices) | Partially live | Budget real; invoices missing |
| Change order review/approval | Client, Decision-Maker | P7 | Planned | `budget_ledger.source_type='change_order'` slot reserved only |
| Selections & allowances | Client, Decision-Maker | P8 | Planned | Preview-only, dead "Review & Approve" control |
| Documents (published, gated) | Client | P9 | Planned | Preview-only, dead "Download" control |
| Messages / Conversations | Client | P10 | Planned | Preview-only, hardcoded threads |
| Progress / schedule visibility | Client | P9 | Planned | Preview-only, hardcoded 15-phase schedule |
| Decisions awaiting client action (a dashboard of them) | Client, Decision-Maker | Cross-cutting, incremental | Missing | No single "your decisions" surface exists yet — see Section D |

### Billing & payments

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| Draws, invoices, retainage | Accounting, Owner, Client | P6 | Planned | |
| Payment processing (ACH/card) | Accounting, Owner, Client | P6b | Planned | |

### Company operations

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| Action Center (cross-project attention list) | Owner, PM, Accounting | Incremental, every package | Preview-only | Static grouped list today; real query hooks land per-package |
| Scheduling, field ops, RFIs, meetings, safety | PM, Field, Client, Vendor | P9 | Planned | Ten new tables |
| Leads intake → project conversion (thin) | Owner, PM | P3 (thin) → P14 (full) | Missing/Underspecified | Thin slice not restated with schema/acceptance detail in new roadmap |
| Company templates / knowledge base (thin) | Owner, PM | P3 (thin) → P14 (full) | Missing/Underspecified | Same treatment as Leads |
| Employees, workload, time/mileage/expense | Owner, PM, Field, Accounting | P14 | Planned | |
| Company overhead & true profitability | Owner, Accounting only | P14 | Planned | Explicitly never PM/Field/Client/Vendor-visible |
| Backup/retention policy (product-level) | Owner | P3 (baseline) → P14 (self-service export) | Missing/Underspecified | Infra-level Supabase backups exist; no product-level policy/export feature |

### Investor / lender

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| Investor/spec-home summary reporting | Owner, Investor | P12 | Planned | No `investor` role in enum yet |
| Lender draw package view | Lender | P12 | Planned | No `lender` role in enum yet |

### Closeout & warranty

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| Permits & inspections | PM, Field | P13 | Planned | |
| Warranty & service claims | PM, Field, Client, Vendor | P13 | Planned | |
| Project closeout workflow (the actual "mark this project done" flow) | Owner, PM | Not named as a discrete deliverable anywhere | Missing/Underspecified | See Section D |

### Platform-wide

| Capability | Primary role(s) | Package | Status | Notes |
|---|---|---|---|---|
| RLS-enforced role isolation | All | P1 (foundation) + every package's own tests | **Live** (foundation), extended per-package | `staff_function` differentiation still outstanding — see Section C |
| Audit history | All (scoped) | P1 (foundation) | **Live**, but over-broad for Superintendent today | See Section C |
| Future AI assistant | All (via existing sessions) | P15 | Architecture pre-committed, not built | Deliberately last |

---

## Section C — Foundation gaps to correct before P5 continues

**Update, 2026-08-20: gaps 1–3 below are RESOLVED as of P3's
implementation** (kept here, marked resolved, rather than deleted, so
the record of what was gapped and why stays intact):

1. ~~No real create/select/switch-project workflow~~ — **RESOLVED.**
   Real project creation, an accessible-project list, `ProjectSwitcher`,
   and archived-project view all live and independently reviewed; see
   `P3-DESIGN.md`. A short list of remaining UI/UX completion items
   (address-field layout, project-type selector, conditional pricing
   inputs, staff-picker empty state, project-number guidance, filter/
   label clarity, inline validation, a lightweight post-creation setup
   checklist) and one remaining security guard (archived-project team
   management reachable by direct URL) are now COMPLETE as of this
   entry — not a re-opening of this gap, a completion pass on an
   already-real feature.
2. ~~P2/P3's "remaining scope" has no fully-specified design
   document~~ — **RESOLVED.** `P3-DESIGN.md` is now that document.
3. ~~`staff_function` role differentiation does not exist at the
   database level~~ — **RESOLVED.** Built, independently reviewed
   (twice — once at design stage, once at implementation stage, with
   two Critical authorization bugs found and fixed before either
   review closed), and live-verified against the real hosted dev
   Supabase project. The audit-log over-exposure bug named here is
   closed.

4. **`project_decision_makers` is not built**, so the Client Approval
   Model (`CLIENT-APPROVAL-MODEL.md`) is a documented design with
   nothing to enforce it yet. This does not block P5 (bid awarding is
   staff-only, no client approval step), but it means any future
   package assuming decision-maker enforcement exists (P7, P8) needs
   it built first. **Recommendation:** no action needed before P5
   continues; flag as a hard prerequisite check before P7 design
   begins. **Note (P3.1 design, 2026-08-26):** `P3.1-DESIGN.md` proposes
   an `is_decision_maker` boolean on `project_clients` — informational
   only (tells staff who to ask), no approval authority, no
   effective-dated history. This is explicitly not an early version of
   this item's real model; P7 still needs to build
   `project_decision_makers` from scratch, using the flagged rows as a
   natural migration seed at most.

Items intentionally **not** listed here because they're already
correctly scoped to a later package rather than being foundation
gaps: invoices/draws (P6), change orders (P7), selections (P8),
scheduling/documents/RFIs (P9), conversations (P10), vendor portal
(P11), investor/lender (P12) — none of these block P5's own
completion, they're simply not built yet, on schedule.

## Section D — Prioritized missing capabilities for future packages

Capabilities implied by the owner's product vision that either have no
named home yet, or whose scope is broader than what's currently
specified. None of these should be added to P5's active scope — each
is a candidate for a specific future package, listed for owner
decision on priority and placement.

| Priority | Capability | Why it's missing/incomplete | Recommended home |
|---|---|---|---|
| **High** | A cross-project, per-user "your decisions" surface — the concrete list of approvals/selections/change-orders/bids currently waiting on *this specific person* | The vision explicitly calls for clients to see "decisions" and for every user to have "an obvious next action." Today this exists only as static fixture content inside `ActionCenterScreen`; no package currently owns turning it into a real, live, per-role query. | Incremental: each package that creates an approval-needing record (P7 change orders, P8 selections, P5/P11 bids) registers its own Action Center condition, per the pattern P4 already established (unmapped costs, budget overruns) — no new package needed, but this should be an explicit, stated acceptance criterion in P6/P7/P8's design docs, not assumed. |
| **High** | Notifications / reminders (email or in-app) for pending approvals, overdue selections, upcoming draws, unanswered bid questions | The vision's opening line names "manual follow-up" as one of the things the portal replaces. No module in the feature register is named "Notifications." | Not yet homed. Owner decision needed: a dedicated thin package (candidate: alongside P10 Conversations, since email-to-project capture is already there), or distributed per-package acceptance criteria the way Action Center conditions are. |
| **Medium** | An explicit, product-level project closeout workflow (a real "this project is done" state transition, not just the last punch item closing) | No package names "closeout" as a discrete deliverable — P13 covers warranty/permits but not the act of closing a project out. | Candidate: P13, as an explicit added acceptance criterion, or a short standalone package after P13. Owner decision needed. |
| **Medium** | Product-level backup/export/retention policy (per data type, not just Supabase's infrastructure-level managed backups) | Old roadmap's module 35 ("baseline backup/retention from the moment real customer data exists") is not restated with schema/acceptance detail in the new roadmap's P3 section; only the infra layer is covered (`TARGET-ARCHITECTURE.md` §12). | P3 (baseline policy, cheap, should exist before real customer data does) + P14 (self-service export, already named there). |
| **Low** | Architect/Designer and Read-Only Guest roles | Named in the feature register's role list but have no schema role in any package and no clear demand signal from the actual stated business (a small custom builder). | Owner decision: confirm whether Stone Column's actual workflow needs either role at all before spending a package slot on them — the vision explicitly warns against enterprise complexity a small builder doesn't need. If confirmed needed, home in P14 alongside other long-tail roles. |
| **Low** | Thin Leads intake, thin Company Templates, website lead-source tagging | Named in the old roadmap's Package 3 with schema-level detail; the new roadmap's P3 section only references them by pointer to the superseded document. | Same as Section C gap #2 — resolve when P2/P3's design doc is finally written; full builds remain correctly homed in P14. |
| **High, explicitly deferred** | Whether the QuickBooks export target (P4.4) is a QuickBooks Estimate, a job-specific QuickBooks Budget, or both | Recorded 2026-08-20. This is a real-evidence question, not a design question — guessing it now risks building against the wrong QuickBooks object entirely. | P4.4's own design pass, and only after inspecting Stone Column's actual QuickBooks Desktop Enterprise Contractor setup or a representative export (same discipline `WORKBOOK-GAP-ANALYSIS.md` used before P2.1). **Do not decide this in advance of that inspection.** |
| **Medium** | "Fixed price" pricing model has no real place to capture a total contract amount | Recorded 2026-08-20, found while completing P3's project-creation form. `project_fee_rules` models a builder *fee* (percentage or fixed dollar amount added to cost-plus costs) — it has no column for "the whole job is a single flat contract total," and `create_project_with_defaults()` requires a `fee_basis` regardless of the chosen `pricing_model`. Building a `contract_amount_cents`-style field now would be exactly the "parallel financial model" `FINANCIAL-ARCHITECTURE.md` forbids. | P3's own completion pass keeps `pricing_model='fixed_price'` selectable (a label) but still requires the existing fee-basis capture, honestly labeled as provisional — no new field invented. A real fixed-price contract-amount concept, if the business needs it, is a future architecture decision (likely P6 Billing or a P4.x amendment), not something to guess at now. |
| **Medium** | `closed_out` and `archived` are two distinct terminal-ish project states in the schema (`schema/008`'s transition trigger) but P3's project list only ever showed two views (active-ish vs. archived), silently folding `closed_out` into the active view | Recorded 2026-08-20, owner-flagged during preview. A completed job showing in the same list as an in-progress one is a real UX gap the schema already has the data to fix. | P3's own completion pass adds a third, distinct "Completed" view for `status='closed_out'`, alongside the existing Active and Archived views — no schema change, this data already exists. |
| **Medium** | Procurement efficiency: awarded-bid→order conversion, order duplication/recurring orders, order line-item CSV import, estimate-line→order creation, supplier quote/document conversion, reusable per-vendor item catalogs | Recorded 2026-09-01, raised during the P5 Tasks 7–9 owner preview (duplicate-manual-entry concern). **Updated 2026-09-04:** reconciled against the approved P5.1–P5.4 design (`P5-EXTENSION-PACKAGES-DESIGN.md` Section 6) — none of the six behaviors are built by P5.1–P5.4, but P5.2/P5.3 build real document-upload infrastructure a future "supplier quote/document conversion" feature would need, and P5.1's vendor record is a natural future home for a reusable per-vendor item catalog. `bid_award` and `material_order` remain two permanently separate `committed_costs` paths, unchanged. | Still not homed for implementation. P5.1–P5.4 lay groundwork for two of the six; the other four (bid→order conversion, order duplication, CSV import, estimate-line→order) remain candidates for a future package once real field usage shows which matters most. Do not build speculatively. |
| **Medium** | Whether P4.4's "actual-cost feedback" reconciles QuickBooks actuals against individual commitments (`committed_costs`/`material_orders`), not just cost-code/import-batch aggregates | Recorded 2026-09-01, same preview. Today `expenses` (P4's QuickBooks import) carries no link to any specific `committed_costs`/`material_orders` row — reconciliation is aggregate-only. P4.4's title implies commitment-level feedback but its body scope only ever covered the export direction. | P4.4's own design pass — `PRODUCTION-ROADMAP.md`'s P4.4 section now names this as a second open decision alongside the existing QuickBooks-target-object question. |
| **High — homed, approved 2026-09-04** | No admin-side UI to create/manage a `vendors` row anywhere in the running application | Recorded 2026-09-02, found during the P5 Task 10 owner preview: the org backing this preview had zero vendors, and there is no in-app way to add one. Verified exhaustively: P2.1 (complete) built the `vendors` table explicitly "no UI, data only"; P5 only ever consumes existing vendor rows (bid invites, material-order vendor selection) and never scoped a creation form; P11 (planned) is the vendor's own portal login, not an admin-side creation screen. `PRODUCTION-ROADMAP.md`'s P11 section previously claimed this already existed as "the admin-side Vendors area, already built as record-keeping in P5" — that line was inaccurate and has been corrected in place. | **Homed: Package P5.1 (Vendor Directory & Onboarding), approved 2026-09-04.** Full design: `P5-EXTENSION-PACKAGES-DESIGN.md`. Not yet implemented — sequenced after P5.0 and P5's own Task 11/12 closeout, per the approved sequence in that document's Section 4. |

## Section E — Contradictions and documentation gaps requiring reconciliation

1. **Old roadmap's Package 3 does not map 1:1 to any single new
   package.** `docs/product-definition/05-implementation-roadmap.md`'s
   "Package 3" (Platform Core + Project Setup + Vendor Identity
   Foundation + thin Leads + thin Templates + backup baseline) is
   split across new P1 (vendor-identity slice, delivered), and an
   unwritten P2/P3 remainder. This is not wrong, but it means anyone
   reading only the new `PRODUCTION-ROADMAP.md` cannot currently tell
   where thin-Leads/thin-Templates/backup-baseline landed without
   also reading the old, nominally-superseded document. **Resolution:**
   Section C gap #2 (write the P2/P3 design doc) closes this.

2. **`PRODUCTION-ROADMAP.md` self-corrects its own table count for P9**
   (nine tables in an earlier draft, ten in the current text) — noted
   here only so it isn't mistaken for a live discrepancy between two
   different current documents; it is a single document's own internal
   correction, already resolved in the text as it stands today.

3. **`docs/CHECKLIST.md` is stale** — written at the prototype
   checkpoint, before P0/P1/P2.1/P4 existed, and never updated. It
   still reads "Packages 3–8: Not started," which is now meaningless
   against the P0–P15 scheme. **Resolution:** either mark it explicitly
   historical (a one-line banner, matching how this repo already
   treats `docs/product-definition/` as terminology-only, not
   sequencing-authoritative), or retire it. Owner decision needed —
   this document does not propose deleting project history unilaterally.

4. **This vision document's §3 ("no user ever trapped in a single
   hard-coded project") is not yet true of the running application.**
   Documented directly rather than silently softened — see Section C
   gap #1. `PRODUCT-VISION.md` states the requirement as permanent
   intent; this matrix states the current gap against it. That is a
   deliberate, not accidental, split between the two documents: the
   vision should not be watered down to match today's implementation
   state.

No contradiction was found between `PRODUCT-VISION.md` and any
approved financial architecture, security matrix, or client approval
model document — the vision's non-negotiables section is a condensed
restatement of `CLAUDE.md`/`FINANCIAL-ARCHITECTURE.md`/
`TARGET-ARCHITECTURE.md`, not a reinterpretation of them.
