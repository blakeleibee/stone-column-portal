# Change Log — Product Definition Revision

Every correction below traces to a specific numbered item in the
review. The Workflow Map document is substantively unchanged this
round (the new modules reference its existing workflows; no workflow
itself needed correction), so it's not listed item-by-item below.

## 1. Vendor portal no longer scoped as "deliberately minimal"

`01-feature-register.md` modules 12–13 fully rewritten: added vendor
directory/trade classifications, bid invitations/questions/addenda,
bid leveling & scope-gap comparison, work orders/POs/subcontracts,
e-signature, project assignments/plan access, schedule/availability
confirmation, vendor invoices/change requests, payment/retainage
status, W-9/COI/license/lien-waiver compliance with expiration
reminders, progress photos, punch/warranty assignment, internal
performance/quality/reliability/do-not-use records, and an explicit
statement that competing-bid/unrelated-project-finance protection is
non-negotiable. Each capability tagged with its own package and
priority rather than the whole module being capped at "later
expansion." `04-information-architecture.md` §4 rewritten to show the
full eventual vendor portal nav, not a minimal shell. `05-implementation-
roadmap.md` splits the build across Package 5 (record-keeping/PM-side)
and Package 11 (vendor-facing UI), explicitly not deferring the module
as a whole.

## 2. Thirteen omitted company-operations modules added

`01-feature-register.md` gained modules 22 (Payment Processing — see
#3 below), 23–35: Employees/Roles/Workload, Time/Mileage/Expense
Reimbursement, Company Tools/Vehicles/Equipment, Material Inventory,
Meetings/Agendas/Minutes/Action Items, Safety Documentation/Incident
Reporting, Procurement/Material Orders/Deliveries, Calendar
Synchronization, Email-to-Project Capture, Website Lead Intake/Lead-
Source Reporting, Vendor Tax-Document/1099 Support, Company Overhead/
Supervision Effort/True Profitability, Data Export/Backup/Retention/
Disaster Recovery. Each given priority tier and destination package —
none left as an unscheduled idea.

## 3. Payment Processing added with a real destination package

New module 22, destination **Package 6b** (a distinct sub-package
immediately following Package 6, not an open-ended deferral). Covers
ACH links, card payments, configurable convenience fees, provider
reconciliation, partial/failed/reversed payments, refunds/credits,
deposits/retainage as real payment-ledger entries, client receipts.
QuickBooks Desktop remains system of record, unchanged.

## 4. Action Center now grows incrementally, every package

`05-implementation-roadmap.md`: every package from Package 4 onward now
has an explicit "Action Center events added" line (unmapped QuickBooks
costs, budget overruns, unapproved changes, overdue selections, missing
signatures, unpaid draws, expired COIs, missing lien waivers, schedule
delays, failed inspections, overdue warranty items, and more — every
example given in the review is now attached to the specific package
whose workflow produces it). Package 14 is now explicitly scoped as
*cross-project analytics only*, not the sole place Action Center
becomes real.

## 5. Completion paths defined for every "thin" module

Package 3's entry in `05-implementation-roadmap.md` now states
explicitly: Leads reaches full capability (lead-source reporting,
conversion analytics) in Package 14; Templates reaches full capability
(complete knowledge base) in Package 14. Neither is left open-ended.

## 6. Phase 2 Expanded Interactive Prototype inserted as a formal, required checkpoint

`05-implementation-roadmap.md` now has a dedicated "Phase 2" section
between the product-definition approval and Package 3, explicitly
labeled as not production backend development, listing every required
demonstrated workflow from the review (company dashboard/Action
Center, lead conversion/New Project wizard, project setup/team/
permissions, editable estimate/budget, QuickBooks import review,
vendor bid comparison/commitment, draw/invoice builder, change-order
creation/approval, selections/allowance effects, documents/signature
status, schedule editing/daily logs, vendor portal, client portal,
investor reporting, warranty request, role switching, and — as its own
explicit requirement, not implied by the others — empty/error/overdue/
rejected/exception states). Requires explicit approval before Package 3
begins, same as every other checkpoint so far.

## 7. Roadmap and information-architecture corrections

- **Package 9 table count**: was stated as "four" while listing five
  (`schedule_phases`, `daily_logs`, `field_issues`, `documents`,
  `rfis`). Corrected to state five, and the package now also adds
  `tasks`, `meetings`, `meeting_action_items`, `safety_documents`,
  `safety_incidents` — nine tables total, explicitly counted.
- **Tasks, Meetings, Procurement, Deliveries navigation**: all four
  now have an explicit home in `04-information-architecture.md` §2 —
  Tasks and Meetings under the Project Workspace's Schedule tab;
  Procurement/Deliveries under Financials → Commitments & POs.
- **Leads navigation**: no longer an open question. `04-information-
  architecture.md` §1 makes it a firm top-level nav item from day one.
- **Company-wide Vendors area**: `04-information-architecture.md` §1
  adds a top-level **Vendors** destination, explicitly not a Settings
  sub-page, scaled for the full module 12/13 capability set.
- **Company-level Schedule/calendar**: added as a top-level **Schedule**
  destination in §1, aggregating every active project.
- **Reports and Warranty/Service in admin architecture**: added as a
  top-level **Reports** destination in §1, with company-wide Warranty
  status living there and per-project detail staying in the Project
  Workspace's Closeout tab.
- **Lender access clarified**: `01-feature-register.md` module 15 and
  `04-information-architecture.md` §6 now state explicitly: Lender is
  a real, narrowly-scoped portal role with its own RLS (matching
  Investor in kind), not published-report access — the UI can be
  minimal (one draw package, nothing else) without the access model
  being a shortcut.
- **Vendor-facing dependency ordering fixed**: `05-implementation-
  roadmap.md`'s Package 3 now explicitly includes the vendor identity/
  RLS foundation (the `'vendor'` role, `project_members` vendor rows,
  and the baseline isolation policy) even though no vendor-facing UI
  ships until Package 11 — so Package 5 (which references vendor bids/
  commitments) never needs to introduce a new security boundary under
  time pressure; it extends one that already exists and is tested.

## 8. Exception & Risk Register expanded

`03-exception-and-risk-register.md` gained 20 new scenarios (#18–#37):
vendor invoice exceeding its commitment, split costs across projects/
cost codes, sales tax/tax-exempt purchases, retainage release, failed/
reversed ACH or card payment, refunds, lost/damaged owner-supplied
material, backordered/discontinued selections, incorrect vendor paid,
joint checks, conditional/unconditional lien waivers, employee
departure/permission removal, data export/project ownership transfer,
safety incident, weather/force-majeure delay, lender underfunding/
rejected draw, scope performed by multiple vendors, project reopening
after closeout, duplicate contacts/companies, deceased/incapacitated
client or changed signing authority. Each with the same required
status/approval/reversal/notification/audit treatment as the original
17.

## Not changed

No application code was modified. `02-workflow-map.md` is substantively
unchanged (its existing 13 workflows are referenced by the newly-added
modules, not altered themselves).
