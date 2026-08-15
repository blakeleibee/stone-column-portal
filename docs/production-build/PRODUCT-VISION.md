# Stone Column Portal — Product Vision

**Status: DRAFT.** Produced at the owner's request as a candidate
permanent north-star document. Not yet approved. Do not treat this as
a binding project instruction, and do not cite it as settled policy in
any future package design, until the owner has reviewed it and the
open reconciliation items at the bottom of this document are resolved.
Once approved, this document should be referenced from `CLAUDE.md`
alongside the other `docs/production-build/` standing records.

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
  at a single hard-coded project. (This is a currently-unmet
  requirement as of this document's drafting — see §9, Foundation Gap 1.)

## 4. Source of truth discipline

QuickBooks Desktop remains the **system of record for accounting
transactions.** The portal does not compete with it, replace it, or
maintain a second books-of-record. Instead the portal provides:

- Controlled, reviewed, one-way synchronization of QuickBooks data
  into the portal's own construction-management ledger (via the
  import/mapping/reconciliation pipeline — see `FINANCIAL-ARCHITECTURE.md`).
- The construction-management detail QuickBooks was never designed to
  hold: commitments, bids, procurement, schedules, selections, change
  orders, client/vendor communication, and the day-to-day operational
  record of the job.
- A single, explicit, documented answer to **"what is the source of
  truth for this piece of information"** for every data type the
  portal touches — QuickBooks for posted accounting transactions, the
  portal's own append-only ledger for everything derived or
  construction-specific, never both, never silently duplicated.

Where practical, the portal eliminates duplicate entry — staff should
never have to type the same fact into two systems when one can supply
it to the other through a controlled, auditable path.

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
  them.

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

## Open reconciliation items — pending owner decision

This vision was drafted by reviewing the full existing document set,
and that review surfaced real gaps and documentation conflicts that
should be resolved before this document is adopted as permanent. They
are not restated here in full — see
`docs/production-build/PRODUCT-COMPLETENESS-MATRIX.md`, sections
**"Foundation gaps to correct before P5 continues"** and
**"Contradictions and documentation gaps requiring reconciliation."**
In short: (1) no real create/select/switch-project workflow exists in
production yet, which §3 above states as a firm requirement; (2) the
new P0–P15 roadmap's P2/P3 sections are not yet fully specified the
way every other package is; (3) staff-role differentiation
(PM/Superintendent/Accounting) does not yet exist at the database
level, which understates §5's isolation guarantee for those three
roles today. None of these invalidate the vision — they are exactly
the kind of gap this document exists to make visible.
