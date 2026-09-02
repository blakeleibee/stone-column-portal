# Stone Column Portal — Product Vision

**Status: Approved in principle (2026-08-19).** This is now a
permanent standing record, referenced from `CLAUDE.md` alongside the
other `docs/production-build/` documents. The open reconciliation
items originally listed below are resolved as of this revision: the
create/select/switch-project gap is being actively closed by
`docs/production-build/P3-DESIGN.md` ("Project & Staff Access
Foundation," pulled forward ahead of P5 Task 7); the P2/P3
specification gap is closed by that same document; `staff_function`
differentiation is designed there too, pending its own independent
review and owner approval before implementation. Amendments from here
require the same explicit-approval bar as any other architecture
document (§9).

This document is the **permanent, durable statement of what the
portal is for.** It changes rarely and only with explicit owner
approval. It does not restate sequencing (`PRODUCTION-ROADMAP.md`),
stack decisions (`TARGET-ARCHITECTURE.md`), financial schema
(`FINANCIAL-ARCHITECTURE.md`), or role/permission detail
(`SECURITY-AND-PERMISSIONS-MATRIX.md`) — it cross-references those
documents and states the intent they all serve.

---

## 1. What this is

Stone Column Custom Homes & Remodeling is a small custom-home builder
running cost-plus residential construction today on QuickBooks
Desktop, spreadsheets, email, texts, shared files, and manual
follow-up. The portal's job is to become the **complete, branded
operating system** for running that business — not a financial-report
viewer, not a client-portal add-on, but the place staff actually run a
project from initial setup through closeout, and the place clients,
vendors, and investors/lenders get a controlled, appropriate window
into it.

**A user should be able to manage a project from setup to closeout
without needing to understand the underlying software architecture.**
Every design and package decision is measured against that sentence.

## 2. Who uses it

Eleven roles are recognized by the product (see
`SECURITY-AND-PERMISSIONS-MATRIX.md` for the full enforcement detail
per record type). The portal's job for each:

| Role | What the portal needs to do for them |
|---|---|
| **Owner/Admin** | Run the whole company through it — every project, every role, full financial and operational visibility, org-wide configuration. |
| **Project Manager** | Run their assigned projects day to day — estimates, budgets, commitments, bids, procurement, schedule, selections, change orders, client and vendor communication. |
| **Superintendent/Field Staff** | Run the field side of their assigned projects — schedule, daily logs, RFIs, field issues, safety — without exposure to figures they don't need. |
| **Accounting** | Keep the financial ledger, invoices, draws, and QuickBooks reconciliation correct org-wide, without needing PM-level operational authority. |
| **Client** | See a polished, simple, honest picture of their own project — budget, approvals, selections, change orders, documents, invoices, payments, messages, progress, and the decisions waiting on them. |
| **Authorized Client Decision-Maker** | Everything a Client sees, plus binding approval authority on the record types their project configuration designates. |
| **Architect/Designer** *(no schema role built yet — see gaps)* | Read relevant design/estimate context and respond to RFIs and selections on projects they're attached to. |
| **Vendor/Subcontractor** | Receive invitations, see only the bid packages and projects they're invited to, submit bids, ask/answer questions, receive POs and subcontracts, track their own commitments and invoices — never a competitor's data. |
| **Investor** | See summary-level performance on the specific project(s) they hold a stake in — never raw expense rows or another investor's position. |
| **Lender** | See their own open draw package only. Nothing else. |
| **Read-Only Guest** *(policy-level only, no schema role built yet)* | See exactly what's explicitly shared with them, nothing by default. |

Every role's access is **enforced by PostgreSQL RLS and trusted server
operations — never by hiding a button in the UI.** A role that
shouldn't see a record gets zero rows back from the database, not a
UI that happens not to render a link to it.

## 3. The project is the organizing unit

Every meaningful piece of work in this product happens *inside a
project*. That means, as a permanent product requirement:

- Staff can create a new project, select an existing one, and switch
  between projects they have access to, at any time.
- **Every screen clearly shows which project the user is currently
  working in** — no ambiguity, no accidental cross-project action.
- Staff can assign team members and clients to a project, configure
  its pricing/fee terms, and build its estimate as part of getting it
  underway.
- No user is ever trapped in seeded demo data or permanently pointed
  at a single hard-coded project. (Real, live as of P3 — see
  `PRODUCT-COMPLETENESS-MATRIX.md` for current implementation status.)
- **Project setup is progressive, not all-or-nothing.** Creating a
  project begins a multi-step setup a user can save and return to
  without finishing everything at once — identity, then estimate/
  budget, cost codes and project-specific subcategories, specifications/
  selections, client and team, QuickBooks connection, schedule, and
  documents. Each step belongs to whichever package owns that domain
  (see `PRODUCTION-ROADMAP.md`'s P3/P4.1/P4.3/P4.4/P8/P9 sections for
  exactly which package builds which step) — no package pretends a
  future step already works. A setup checklist may name a step "coming
  later"; it must never simulate a workflow that isn't real yet.

## 4. Source of truth discipline

**The portal — not QuickBooks — is the source of truth for
estimating and budgeting**: original and revised estimates, allowances,
detailed cost-code breakdowns (a canonical parent code plus
project-specific child items), commitments, forecasts, and projected
final cost. **QuickBooks Desktop Enterprise Contractor remains the
source of truth for accounting**: bills, checks, credit cards, payroll,
invoices, payments, and actual job costs. The portal does not compete
with QuickBooks on accounting, replace it, or maintain a second
books-of-record — and QuickBooks does not become a second place a
budget can be edited.

Money moves both directions, each for a different reason, neither ever
live/automatic:

- **QuickBooks → portal**: actual costs, reviewed and confirmed by
  staff before they post (the existing import pipeline).
- **Portal → QuickBooks**: an *approved* budget/estimate snapshot,
  exported to the mapped QuickBooks Customer:Job so QuickBooks'
  own reporting reflects the portal's numbers without anyone retyping
  them — never a draft, never silently overwritten in either direction.

Beyond that boundary, the portal also holds the construction-management
detail QuickBooks was never designed for: commitments, bids,
procurement, schedules, selections, change orders, client/vendor
communication, and the day-to-day operational record of the job. Every
data type the portal touches has a single, explicit, documented answer
to **"what is the source of truth for this"** — see
`FINANCIAL-ARCHITECTURE.md` for the full accounting of which system
owns which fact.

Where practical, the portal eliminates duplicate entry — staff should
never have to type the same fact into two systems when one can supply
it to the other through a controlled, auditable path. **This applies
within the portal's own procurement lifecycle, not just at the
QuickBooks boundary** (recorded 2026-09-01): the intended shape of a
meaningful planned purchase is Estimate/vendor quote → Material Order →
Purchase Order → receipt → QuickBooks bill/actual cost, each step
capable of feeding the next rather than being re-keyed from scratch.
A small, incidental purchase should never need to pass through that
whole chain — it can post as a plain QuickBooks actual. This is a
standing intent for future procurement-efficiency packages to build
toward, not a description of what exists today — see
`FINANCIAL-ARCHITECTURE.md`'s "Bid awards and material orders" note and
`PRODUCT-COMPLETENESS-MATRIX.md` Section D for exactly what's built,
what's homed, and what's still an open decision.

## 5. Non-negotiables

These are carried through every package without exception. Full detail
lives in `CLAUDE.md` and the referenced architecture documents; this
is the durable summary.

**Financial** (`FINANCIAL-ARCHITECTURE.md`):
- Money is always an integer number of cents. Never a float.
- Financial history is append-only where the architecture requires it
  — corrections are new ledger rows with a reason, never edits.
- No screen computes its own financial numbers — every figure routes
  through `packages/01-financial-engine`.
- The project + cost-code ledger (`budget_ledger`/`expenses`/
  `committed_costs`/`forecast_entries`/`fee_ledger`, joined to
  `cost_codes`) is the permanent financial backbone. Every new
  financial concept references it via the registered `source_type`/
  `source_id` provenance convention — no package introduces a parallel
  financial model.
- Existing cost codes remain canonical and QuickBooks-mapped.
  Project-specific cost-code breakdown items (P4.1, pending approval)
  provide additional detail while rolling up to the parent — they are
  never a second global cost-code system.
- Client visibility requires both `published` status and an explicit
  visibility flag — never one alone. Billability is likewise explicit.
- Suggested numbers are never official until a human accepts or edits
  them — this governs the estimating system's future use of historical
  project data and reusable Value/Standard/Premium pricing tiers too: a
  suggested price is always explainable (its sources, dates, and
  adjustments shown), always owner-editable, and never silently applied
  or auto-approved. Pricing tiers apply per cost item or specification,
  never as a single whole-project multiplier.

**Technical & security** (`TARGET-ARCHITECTURE.md`,
`SECURITY-AND-PERMISSIONS-MATRIX.md`):
- PostgreSQL RLS and trusted server operations are the actual
  authorization boundary. UI visibility is never authorization.
- Ordinary user operations run under the authenticated user's own
  session and remain subject to RLS. Service-role access is
  exceptional, narrow, validated, and audited — never a convenience
  shortcut.
- Repository functions handle reads; plain service functions handle
  writes; thin adapters (Server Actions, and eventually AI tool calls)
  expose them to the UI. Business logic never lives inline in a Server
  Action or a component.
- The future AI assistant (P15) calls the exact same
  repository/service functions, under the exact same asking user's
  session, that the UI already calls. It never gets a service-role
  shortcut, a duplicated calculation, or a parallel data path.
- Organization, project, client, and vendor isolation are proven by
  explicit tests, not assumed from policy intent.

## 6. What "done" means

A feature is not complete because a route renders. It is complete when
an authorized user can:

1. **Discover** it — find their way to it through normal navigation.
2. **Enter the workflow** and **complete the normal task** — create,
   view, edit, archive, and (where the workflow calls for it) recover.
3. **Understand the result** — a clear confirmation, a clear resulting
   state, no ambiguity about what just happened.
4. **Recover from mistakes** where the workflow allows it — draft vs.
   submitted, archive vs. delete, correction vs. edit.
5. **See the correct downstream financial or operational effect** —
   the number that should move, moves, computed by the engine, not by
   the screen.

And the workspace as a whole must have considered: creation, viewing,
editing, archiving, recovery, empty states, validation, errors,
permissions, audit history, and navigation. List-oriented screens
normally need search, filtering, sorting, and status views. Every user
should have an obvious next action — never a dead end.

A live owner preview is a **workflow review**, not proof the
application compiles. `docs/production-build/OWNER-PREVIEW-CHECKLIST.md`
operationalizes this section for every future package preview.

## 7. Product feel

- **Language:** construction-industry terms a contractor, homeowner,
  or trade partner naturally understands — never software jargon
  leaking into product copy.
- **Visual identity:** the approved Stone Column identity — premium,
  restrained, professional, approachable. Preserve it; do not
  reinterpret it package by package.
- **Simplicity:** avoid clutter, excessive settings, and enterprise
  complexity a small custom builder doesn't need. Every screen earns
  its controls.
- **Device fit:** desktop-efficient for staff running the business;
  clear and fully responsive on phones for clients and vendors, who
  will mostly touch this from a job site or their kitchen counter, not
  a desk.

## 8. How packages are sequenced against this vision

`docs/production-build/PRODUCTION-ROADMAP.md` (P0–P15) is the current,
authoritative sequencing plan implementing this vision. This document
does not reorder that roadmap. When a package's design work surfaces a
capability this vision implies but no package yet owns, the correct
response is to **name it and record it in the right future package**
(see `PRODUCT-COMPLETENESS-MATRIX.md`) — never to quietly expand the
package currently in flight.

## 9. Governance

- This document is reviewed against every package's design doc before
  that design is approved, and against every live owner preview before
  a package is marked complete.
- Amendments to this document require explicit owner approval, the
  same bar as an architecture document.
- Where a package's approved design and this vision appear to
  conflict, the conflict is surfaced to the owner explicitly — neither
  document silently overrides the other.

## Status of items this vision originally flagged as unresolved

This vision was drafted by reviewing the full existing document set,
and that review surfaced real gaps that needed resolving before this
document could be adopted as permanent. As of this revision: the
create/select/switch-project gap (§3), the missing P2/P3 design
specification, and the missing staff-role differentiation (§5) are all
in active resolution via `docs/production-build/P3-DESIGN.md` — not
yet implemented, but designed, independently reviewed for
authorization/migration risk, and awaiting the owner's implementation
go-ahead. `docs/production-build/PRODUCT-COMPLETENESS-MATRIX.md`
remains the living tracker for this and every other package's
completeness status — consult it, not this document, for current
implementation state.
