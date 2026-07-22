# Coverage Matrix

Every capability explicitly named in the review, mapped to its
destination package. Nothing below is "deferred without a destination."

## Vendor/Subcontractor capabilities (review item 1)

| Capability | Destination package |
|---|---|
| Vendor directory & trade classifications | Package 11 |
| Bid invitations, questions, addenda, proposal submission | Package 5 (build) / Package 11 (vendor UI) |
| Bid leveling & scope-gap comparison | Package 11 |
| Work orders, purchase orders, subcontracts | Package 5 |
| Electronic signatures (vendor documents) | Package 11 (reuses Package 7's e-signature capability) |
| Project assignments & relevant plan access | Package 11 |
| Schedule dates & availability confirmation | Package 11 |
| Vendor invoices & change requests | Package 11 |
| Payment and retainage status (vendor-facing) | Package 11 (depends on Package 6) |
| W-9, COI, license, lien-waiver compliance | Package 11 |
| Expiration reminders | Package 11 (Action Center hook) |
| Progress photos | Package 11 |
| Punch-list and warranty assignments | Package 11 (depends on Package 13) |
| Internal performance/quality/reliability/do-not-use records | Package 11 |
| Strict protection of competing bids/unrelated finances | Package 3 (RLS foundation) through Package 5 and Package 11 (enforced throughout, tested at each stage) |

## Company-operations modules (review item 2)

| Module | Destination package |
|---|---|
| Employees, roles & workload | Package 14 |
| Time, mileage & expense reimbursement | Package 14 |
| Company tools, vehicles, trailers, equipment | Package 14 |
| Material inventory & leftover-material locations | Package 14 |
| Meetings, agendas, minutes, decisions, action items | Package 9 |
| Safety documentation & incident reporting | Package 9 |
| Procurement, material orders, lead times, delivery, backorders | Package 5 |
| Calendar synchronization | Package 9 |
| Email-to-project capture | Package 10 |
| Website lead intake & lead-source reporting | Package 3 (tagging) / Package 14 (reporting) |
| Vendor tax-document & 1099 support | Package 11 |
| Company overhead, supervision effort, true profitability | Package 14 |
| Data export, backup, retention, disaster recovery | Package 3 (baseline) / Package 14 (self-service tooling) |

## Payment processing (review item 3)

| Capability | Destination package |
|---|---|
| ACH payment links | Package 6b |
| Card payments | Package 6b |
| Configurable convenience-fee handling | Package 6b |
| Payment-provider reconciliation | Package 6b |
| Partial payments | Package 6 (recording) / Package 6b (live provider) |
| Failed or reversed payments | Package 6b |
| Refunds and credits | Package 6b |
| Deposits and retainage | Package 6 |
| Client receipts | Package 6b |

## Action Center incremental growth (review item 4)

| Alert | Destination package |
|---|---|
| Unmapped QuickBooks costs | Package 4 |
| Budget overruns | Package 4 |
| Unapproved changes (bids/commitments) | Package 5 |
| Backordered material | Package 5 |
| Unpaid draws | Package 6 |
| Failed/reversed payment | Package 6b |
| Missing signatures | Package 7 |
| Overdue selections | Package 8 |
| Schedule delays | Package 9 |
| Open safety incidents | Package 9 |
| Expired COIs | Package 11 |
| Missing lien waivers | Package 11 |
| Vendor invoice exceeding commitment | Package 11 |
| Lender underfunding/rejected draw | Package 12 |
| Failed inspections | Package 13 |
| Overdue warranty items | Package 13 |
| Cross-project analytics (aggregation only) | Package 14 |

## Thin-module completion paths (review item 5)

| Module (thin in) | Completes in |
|---|---|
| Leads (thin — Package 3) | Package 14 (lead-source reporting, conversion analytics) |
| Templates (thin — Package 3) | Package 14 (full knowledge base) |

## Phase 2 checkpoint required demonstrations (review item 6)

| Required demonstration | Covered in Phase 2 |
|---|---|
| Company dashboard and Action Center | Yes |
| Lead conversion and New Project wizard | Yes |
| Project setup, team, permissions | Yes |
| Editable estimate and budget | Yes |
| QuickBooks import review | Yes |
| Vendor bid comparison and commitment | Yes |
| Draw/invoice builder | Yes |
| Change-order creation and client approval | Yes |
| Selections and allowance effects | Yes |
| Documents and contract-signature status | Yes |
| Schedule editing and daily field logs | Yes |
| Vendor portal | Yes |
| Client portal | Yes |
| Investor reporting | Yes |
| Warranty request | Yes |
| Role switching (expanded to Vendor/Investor/Lender) | Yes |
| Empty, error, overdue, rejected, exception states | Yes (explicit, distinct requirement) |

## Roadmap/IA corrections (review item 7)

| Issue | Resolution |
|---|---|
| Package 9 table-count mismatch | Corrected: 5 tables (was miscounted as 4), plus 4 more added for Meetings/Safety/Tasks = 9 total, explicitly stated |
| Tasks navigation | Project Workspace, Schedule tab |
| Meetings navigation | Project Workspace, Schedule tab |
| Procurement navigation | Project Workspace, Financials, Commitments & POs |
| Deliveries navigation | Project Workspace, Financials, Commitments & POs |
| Leads navigation decision | Firm: top-level nav item, Company/Admin Workspace |
| Company-wide Vendors area | Firm: top-level nav item, not a Settings sub-page |
| Company-level Schedule/calendar | Firm: top-level nav item, Company/Admin Workspace |
| Reports in admin architecture | Firm: top-level nav item |
| Warranty/Service in admin architecture | Firm: company-wide status under Reports; per-project detail under Project Workspace Closeout |
| Lender: real role vs. published report | Decided: real, narrowly-scoped portal role with its own RLS |
| Vendor-facing access before secure RLS exists | Fixed: vendor identity/RLS foundation moved into Package 3, before Package 5 references any vendor data |

## Exception Register additions (review item 8)

| Scenario | Register entry |
|---|---|
| Vendor invoice exceeding its commitment | #18 |
| Split costs across projects/cost codes | #19 |
| Sales tax and tax-exempt purchases | #20 |
| Retainage release | #21 |
| Failed/reversed ACH or card payment | #22 |
| Refunds | #23 |
| Lost or damaged owner-supplied material | #24 |
| Backordered/discontinued selections | #25 |
| Incorrect vendor paid | #26 |
| Joint checks | #27 |
| Conditional and unconditional lien waivers | #28 |
| Employee departure or permission removal | #29 |
| Data export and project ownership transfer | #30 |
| Safety incident | #31 |
| Weather and force-majeure delay | #32 |
| Lender underfunding or rejected draw | #33 |
| Scope performed by multiple vendors | #34 |
| Project reopening after closeout | #35 |
| Duplicate contacts or companies | #36 |
| Deceased/incapacitated client or changed signing authority | #37 |

## One open product question flagged, not yet resolved

The Exception Register (#12 and #37) surfaces a genuine, unresolved
product decision: whether a project requires a single "primary
decision-maker" whose approval is binding, or unanimous approval among
multiple decision-makers. This needs a decision before Package 7
(Change Orders) or Package 8 (Selections) is built, since both depend
on it. It is flagged, not silently assumed, in both documents.
