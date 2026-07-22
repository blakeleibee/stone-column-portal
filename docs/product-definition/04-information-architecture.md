# Information Architecture

Principle carried through every portal below (the approved Package 2
design philosophy): **primary nav stays short**; anything beyond ~8-9
top-level items moves into a project-level tab strip, a company-level
sub-area, or a secondary sheet — never a longer primary list. This
revision corrects several placement gaps flagged in review: Tasks,
Meetings, Procurement, and Deliveries now have an explicit home; Leads
is a firm navigation decision, not a postponed one; Vendors gets a real
company-wide area, not a Settings sub-page; a company-level Schedule
and Reports exist; Warranty is represented at both company and project
level.

---

## 1. Company/Admin Workspace

**Decision: Leads gets its own top-level nav item, not a deferred
question.** The prior round left "Leads vs. Projects" as an open
question to resolve later. That's corrected here: Leads is
sufficiently different in kind (pre-relationship, never client-
visible, a distinct funnel stage) to warrant its own slot from day one,
even while it's still a "thin" module (Package 3).

Primary nav (revised from the approved 7-item `adminNav` — this is a
**planned future state**, not a change to the current, approved,
7-item config, which remains unmodified today):

```
Overview          — company-wide dashboard, today's Action Center summary
Leads             — (new) lead pipeline; converts into a Project
Projects           — project list; opening one enters the Project Workspace (below)
Vendors             — (new) company-wide vendor directory, bids, compliance, performance —
                       NOT a Settings sub-page; scalable to hundreds of vendors, its own
                       primary destination given the full scope of module 12/13
Schedule            — (new) company-level calendar aggregating every active project's
                       schedule, meetings, and deliveries in one view (module 9/27/29/30)
Action Center        — cross-project actionable items (existing, currently sample-only;
                       grows incrementally — see Roadmap §4)
Financials           — company-wide financial rollup, drill into any project
Reports              — (new) company reporting: profitability (module 34), employee
                       workload (module 23), lead-source conversion (module 32) —
                       distinct from the per-project Financials rollup above
Conversations        — cross-project message threads (existing, currently sample-only)
Contacts             — clients, staff, investors, lenders (Vendors moved out to its own
                       top-level item above, since it outgrew a shared "Contacts" list)
Settings             — org profile, users/roles, cost-code library, templates
```

That's 10 top-level items in the eventual full state — above the ~7-9
guideline this document itself sets, which is an intentional, disclosed
tension: a genuine operating system for a construction company has more
irreducible top-level destinations than a single client-facing portal
does. The mitigation is **progressive disclosure by package**, not a
shorter list — only the items whose owning package has actually shipped
appear in any given deployment; a company running only Packages 1–4
sees Overview/Projects/Financials/Settings and nothing else, not a
half-built "Vendors" tab with nothing behind it.

**Settings** sub-pages (kept minimal — compliance and vendor-facing
content moved OUT to the new company-wide Vendors area per correction):

```
Settings
  ├─ Company Profile
  ├─ Users & Roles
  ├─ Cost-Code Library
  ├─ Project Templates
  ├─ Knowledge Base            (later expansion)
  ├─ Company Assets              (module 25 — tools/vehicles/equipment, later expansion)
  └─ Data Export & Retention     (module 35)
```

**Warranty & Service at the company level**: a cross-project "open
warranty claims" view lives under **Reports** (company-wide status
across every project), while the per-project detail (assign, resolve,
client acknowledgment) lives in the Project Workspace's Closeout tab
(below) — the same "aggregate view at company level, detail at project
level" pattern already used for Financials/Action Center.

---

## 2. Individual Project Workspace

Extends the existing, approved `projectTabs` array (9 items) — the new
modules from this correction round slot into it rather than growing the
top-level tab count, same principle as the prior round:

```
Overview        — project summary, ScheduleRail, pending decisions
Scope           — inclusions/exclusions/allowances
Financials       — real engine-driven budget/fee/reconciliation
  ├─ Budget
  ├─ Commitments & POs
  │    └─ Material Orders & Deliveries   (new — module 29; procurement lives here,
  │                                        adjacent to the PO it's usually tied to)
  ├─ Bids                                (new — module 13's PM-facing half)
  ├─ Change Orders
  └─ Draws & Payments                    (module 6, gains a "Pay Now" action once
                                           module 22 — Payment Processing — ships)
Schedule         — ScheduleRail + phase list
  ├─ Daily Logs & Field Issues
  ├─ Tasks                               (new — a task can originate from a daily log/
                                           field issue, per Workflow Map §11, or be
                                           created directly; distinct from a full Change
                                           Order or RFI)
  ├─ Meetings                            (new — module 27: agenda/minutes/decisions/
                                           action items; an action item can become a Task)
  └─ Safety                              (new — module 28)
Selections       — category/room/item cards
Files            — documents/plans (label may become "Documents")
  ├─ RFIs
  └─ Permits & Inspections
Conversations    — threaded messages
Closeout         — existing tab slot
  └─ Punch List & Warranty
```

**Tasks** placement (explicitly requested): under **Schedule**, since a
task is fundamentally a field-operations record, sitting alongside
Daily Logs/Field Issues it most often originates from — not a separate
top-level tab, and not buried under Conversations.

**Meetings** placement (explicitly requested): also under **Schedule**,
for the same reason — meetings are field/project-operations records,
not communication-thread records (Conversations is for informal,
ongoing messages; Meetings is for structured, minuted, decision-bearing
records).

**Procurement/Deliveries** placement (explicitly requested): under
**Financials → Commitments & POs**, since a material order is
fundamentally tied to a purchase order/commitment — not a separate top-
level tab, and not hidden only inside Schedule even though delivery
delays do affect it (Schedule's Daily Logs can reference a delayed
delivery without owning the record itself).

---

## 3. Client Portal

Unchanged from the prior round's approved 5-item bottom nav + More
sheet — this correction round's additions (Payment Processing, Tasks/
Meetings visibility) nest into existing destinations rather than adding
new ones, preserving the mobile-nav constraint:

```
Home           — welcome, ScheduleRail, latest update, contact card, financial summary
Budget         — client-safe budget + Invoices & Payments (gains a "Pay Now" action
                  once module 22 ships — the client-facing surface for Payment Processing)
Schedule       — client-safe schedule (meetings/tasks are NOT client-visible by default;
                  only schedule dates and, where explicitly shared, meeting decisions
                  that directly affect the client)
Selections     — approve/review
Messages       — client-facing Conversations
  More sheet:
  Updates & Photos
  Documents      — e-signature requests appear here when action is needed
```

Warranty claims (module 18) surface as a client-visible sub-view under
**Home** once the project reaches closeout, same as the prior round.

---

## 4. Vendor Portal — now a real, scaled destination (corrected from "deliberately minimal")

**Correction**: the prior round scoped this portal as intentionally
thin. It is not — it's the full lifecycle from module 12/13, delivered
progressively (Package 5 builds the record-keeping half; Package 11
builds this actual vendor-facing UI). The navigation below reflects the
**eventual full vendor portal**, not a permanently minimal shell:

```
Home              — this vendor's open items across all assigned projects (bids awaiting
                     response, commitments needing confirmation, compliance expiring soon)
Bids              — invitations, questions/addenda, proposal submission
Assignments       — committed costs/POs/work orders/subcontracts, e-signature where needed
Schedule           — dates affecting this vendor's own scope; confirm/flag-conflict
Selections         — selections assigned to this vendor for fulfillment
Documents          — files explicitly shared with this vendor; relevant plan sheets
Invoices           — submit an invoice against a commitment; see payment/retainage status
Compliance         — this vendor's own W-9/COI/license/lien-waiver status, expiration
                     reminders, upload renewals
Punch & Warranty   — items assigned to this vendor
```

No company-wide vendor nav is exposed to the vendor themselves (a
vendor's entire experience stays scoped to whichever project(s) they're
assigned to) — the company-wide **Vendors** area in §1 is an
admin-side destination for managing the vendor relationship, distinct
from this vendor-facing portal. The RLS baseline this entire portal
must respect without exception: "Vendor A sees nothing except their own
`project_members` row" (already tested in Package 1) is the floor every
one of these destinations is added on top of, never around.

---

## 5. Investor Portal

Unchanged from the prior round:

```
Project Summary   — status, phase, investor-safe financial summary
Reports           — periodic investor reports
Documents         — only documents explicitly shared with investors
```

---

## 6. Lender Access

Per the explicit decision in the Feature Register (module 15): Lender
is a real, narrowly-scoped portal role, not merely published-report
access. Its "portal" is intentionally the smallest in the platform:

```
Draw Package      — the single currently-open draw package this lender is entitled to
                     see; nothing else (no project overview, no schedule, no other draws)
```

A lender does not get a persistent multi-page portal the way Investor
does — each draw request effectively grants scoped, time-bound access
to one package, expiring or narrowing again once that draw is resolved.
