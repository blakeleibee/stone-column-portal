# Workflow Map

Each workflow lists: **Trigger**, **Steps** (with the responsible role
in brackets), **System state changes**, and **Depends on** (which
Feature Register modules/packages must exist first). Workflows are
numbered to match the user's brief.

---

## 1. Lead to Preconstruction to Active Project

- **Trigger**: a prospective client contacts Stone Column, or a
  referral comes in.
- **Steps**:
  1. [Owner/PM] Create a lead record (contact, source, rough scope/budget).
  2. [PM] Qualify — site visit, rough feasibility.
  3. [PM] Prepare a preliminary estimate/proposal.
  4. [Owner] Contract signed with client.
  5. [Owner/PM] Convert the lead into a real Project via the Project
     Setup Wizard, carrying over contact info and any preliminary
     estimate as the starting budget.
- **System state changes**: lead status moves `new → qualified →
  proposal_sent → won` (or `lost`); a new `projects` row is created,
  linked back to the originating lead for traceability.
- **Depends on**: Leads (module 1) + Project Setup (module 2) — both
  currently missing.

---

## 2. New-Project Creation

- **Trigger**: a signed contract (from workflow 1) or a decision to
  start a spec project with no client yet.
- **Steps**:
  1. [Owner/PM] Choose a template (Custom Home / Renovation / Small
     Service Job / Blank) or start from scratch.
  2. [Owner/PM] Set pricing model, fee rules, currency, timezone.
  3. [Owner/PM] Load or confirm the cost-code library.
  4. [Owner/PM] Enable modules for this project (Financials, Schedule,
     Selections, etc. — the master plan's "portal modules" step).
  5. [Owner/PM] Invite client(s) and assign team members.
  6. [System] Review checklist surfaces anything incomplete (missing
     budget, uninvited clients, unconfirmed fee rules) before the
     project is marked active.
- **System state changes**: `projects` row created (`is_draft = true`
  until the checklist passes), `project_fee_rules` row created,
  `cost_codes` populated, `project_members` rows created for invited
  users, `budget_ledger` seeded with `entry_type = 'original'` rows if
  a starting budget was provided.
- **Depends on**: Project Setup & Administration (module 2, schema
  exists, wizard UI missing) + Company Templates (module 20, thin
  version).

---

## 3. Estimate to Approved Budget

- **Trigger**: initial project creation (workflow 2), or a
  significant rebid mid-project.
- **Steps**:
  1. [PM/Accounting] Enter or import the original per-cost-code estimate.
  2. [Owner] Review and approve.
  3. [System] `budget_ledger` original entries are locked in.
  4. Later revisions only ever arrive via approved Change Orders
     (workflow 7) or explicit manual corrections (reversing entries).
- **System state changes**: `budget_ledger` rows with
  `entry_type = 'original'`; `computeCategoryFinancials` immediately
  reflects the new `originalEstimateCents`/`revisedEstimateCents` —
  this half of the engine already works correctly today.
- **Depends on**: Estimating & Budgeting (module 3) — engine exists,
  entry UI missing.

---

## 4. Vendor Bid to Commitment

- **Trigger**: a cost code needs a vendor (framing, plumbing, etc.).
- **Steps**:
  1. [PM] Create a bid package for the scope, invite vendors.
  2. [Vendor] Submit a bid.
  3. [PM] Compare bids (each vendor sees only their own number).
  4. [PM/Owner] Award — the winning bid becomes a `committed_costs`
     row.
  5. Later, as the vendor invoices for completed work, [Accounting]
     matches actual expenses against the commitment; when the
     commitment is fully or partially invoiced, it's superseded (never
     edited) via `supersede_committed_cost()`.
- **System state changes**: `bid_packages`/`bid_submissions` created
  and resolved (missing schema); `committed_costs` row created with
  `status = 'open'`; later, `status = 'superseded'` with lineage to
  the replacement/remaining-balance row.
- **Depends on**: Bid Management (module 13, missing) for the earlier
  steps; Commitments (module 5, ledger exists and is the most
  hardened part of the schema) for the later steps.

---

## 5. QuickBooks Job-Cost Import to Budget Actuals

- **Trigger**: Accounting has a new QuickBooks Desktop job-cost report
  to bring in (typically weekly/monthly).
- **Steps**:
  1. [Accounting] Upload the export file.
  2. [System] Preview rows, map columns (remembering prior mapping
     profiles by report type).
  3. [System] Match project/cost codes; detect likely duplicates via
     source ID or a documented fallback fingerprint.
  4. [Accounting] Review new/changed/duplicate/unmatched/invalid rows;
     correct mappings as needed.
  5. [Accounting] Confirm — creates an immutable import batch.
  6. Imported expenses land as `financial_status = 'pending'`,
     invisible to the client, until reviewed.
  7. [Accounting] Review and post (`pending → posted`) — only then do
     they count toward actual cost, fee accrual, or client-visible
     budget figures.
- **System state changes**: `import_batches`/`import_rows` created
  (schema exists, empty); `expenses` rows created as `pending`, later
  transitioned to `posted` via the already-built, tested state machine.
- **Depends on**: QuickBooks Import (module 4) — parsing/UI missing;
  Estimating & Budgeting (module 3) — the posting state machine and
  engine consumption of `posted` expenses already work.

---

## 6. Unbilled Costs to Client Draw and Payment

- **Trigger**: enough reviewed, unbilled `posted` expenses have
  accumulated to justify a draw, or a scheduled billing date arrives.
- **Steps**:
  1. [Accounting] Build a draft draw from unbilled expenses; inspect
     every included transaction; exclude/defer any with a reason.
  2. [Accounting] Apply fee, credits, deposit, retainage, taxes.
  3. [Accounting] Generate a client preview.
  4. [Owner/Accounting] Issue the draw — its calculation is frozen
     permanently from this point, even if fee rules change later.
  5. [Client] Views the issued draw, remits payment.
  6. [Accounting] Records the payment against the draw; balance updates.
- **System state changes**: needs a new `invoices` table
  (`draft → issued → partially_paid → paid`/`void`/`overdue`) and a
  `payments` table; on issue, a `fee_ledger` row with
  `source_type = 'invoice_issued'` is created (schema already reserves
  this exact slot).
- **Depends on**: Client Billing, Draws, Payments & Retainage (module
  6) — entirely missing, but its two prerequisites (fee engine,
  client-safe view-model shape) are already built.

---

## 7. Change Request to Signed Change Order, Budget Update, and Billing

- **Trigger**: a scope change is identified (client request, field
  condition, selection overage).
- **Steps**:
  1. [PM] Draft the short-form change order (description, pricing
     method, schedule impact) — designed to be completed during an
     onsite meeting.
  2. [PM] Generate a clean client preview.
  3. [Client/Decision-maker] Reviews cost/pricing method and schedule
     impact.
  4. [Client/Decision-maker] Signs/confirms (e-signature).
  5. [Owner/PM] Countersigns/executes if required.
  6. [System] Approved financial impact posts to the correct budget
     categories automatically, without duplicate entry —
     `budget_ledger` gets a new `entry_type = 'approved_change'` row
     with `source_type = 'change_order'` and a real `source_id` FK
     (today this FK slot exists but is only populated by hand in tests).
  7. Once signed, the change order is frozen — corrections are new,
     linked change orders, never edits.
- **System state changes**: new `change_orders` table (missing);
  `budget_ledger` row creation (existing, tested mechanism, just
  waiting for a real caller).
- **Depends on**: Change Orders & Field Directives (module 7, missing)
  + Documents/E-Signature (module 10, missing) for the signing step +
  Estimating & Budgeting (module 3, exists) for the budget posting.

---

## 8. Selection to Approval, Purchasing, Delivery, and Installation

- **Trigger**: a selection category is reached in the schedule, or a
  client wants to make an early decision.
- **Steps**:
  1. [PM] Present options (or a custom/inspiration-only selection with
     no manufacturer/model fields).
  2. [Client/Decision-maker] Reviews a locked, versioned preview
     (exact item, financial impact, lead-time/schedule impact).
  3. [Client/Decision-maker] Approves — never from a single unreviewed
     click; the approval records the exact version and an
     acknowledgment.
  4. [PM] Places the order with the assigned vendor.
  5. [Vendor] Delivers; [Field] confirms installation.
  6. Any material change after approval requires re-approval (a new
     version, not an edit to the old one).
- **System state changes**: needs `selections` and
  `selection_approvals` (missing); allowance-vs-price variance should
  flow into the budget engine's committed/actual figures the same way
  any other cost source does today.
- **Depends on**: Selections & Allowances (module 8) — entirely
  missing at the schema level; realistic sample content already exists
  in the preview as a design reference.

---

## 9. Document Upload to Review and Electronic Signature

- **Trigger**: a new plan revision, permit, or contract document needs
  to be shared.
- **Steps**:
  1. [PM/Architect] Upload or link the document (OneDrive-backed).
  2. [PM] Set category, version, and publish state (internal vs.
     client-visible — same pattern already proven for expenses).
  3. If signature is required, [System] creates a signature request;
     [Client/Decision-maker] signs electronically.
  4. [System] Records the signed version immutably.
- **System state changes**: needs `documents`, `signature_requests`
  (missing).
- **Depends on**: Documents, Plans, RFIs & E-Signatures (module 10) —
  entirely missing at the schema level; realistic sample content
  exists in the preview.

---

## 10. Schedule Update to Vendor/Client Notification

- **Trigger**: a phase's dates change (weather, inspection result,
  material delay).
- **Steps**:
  1. [PM/Field] Update the affected phase(s).
  2. [System] Notifies only the vendors/clients whose own scope is
     affected — vendors never see the whole schedule, only their
     relevant dates (a permission rule already established for
     Commitments should extend here).
- **System state changes**: needs `schedule_phases` (missing); history
  should be retained, not overwritten, so past dates remain answerable.
- **Depends on**: Scheduling & Field Operations (module 9) — entirely
  missing at the schema level; `ScheduleRail` UI component already
  exists and is reused across Overview/Schedule/Client Home in the
  preview.

---

## 11. Daily Log or Field Issue to Task, RFI, or Change Request

- **Trigger**: a field condition is discovered (unexpected
  site condition, damaged material, a subcontractor question).
- **Steps**:
  1. [Field] Logs the issue (photo, description, room/phase).
  2. [PM] Triages: becomes a simple task, an RFI to the architect, or
     escalates into a Change Request (workflow 7).
  3. [System] Links the originating field log to whichever downstream
     record it became, so the full history is traceable from a single
     photo to a signed change order and budget impact.
- **System state changes**: needs `daily_logs`, `field_issues`
  (missing); the "convert to Change Order without retyping" pattern the
  master plan specifies for Field Decisions should extend here too.
- **Depends on**: Scheduling & Field Operations (module 9, daily logs)
  + Change Orders & Field Directives (module 7) for the escalation path.

---

## 12a. Project Completion to Closeout and Warranty

- **Trigger**: substantial completion is reached.
- **Steps**:
  1. [PM/Field] Complete the punch list (room, issue, photo, assigned
     vendor, due date, completion photo).
  2. [Client] Acknowledges each completed punch item.
  3. [System] Marks the project closed out; any post-completion issue
     becomes a Warranty Claim instead of a punch item.
  4. [Client] Submits warranty claims as they arise; [PM] assigns to
     the responsible (or a fallback) vendor.
- **System state changes**: needs `punch_items`, `warranty_claims`
  (missing); `projects.status` already has a `closed_out` value
  reserved in the enum, unused today.
- **Depends on**: Warranty & Service (module 18) — entirely missing.

## 12b. Spec Project to Investor Reporting

- **Trigger**: a spec (non-client) project has outside investors.
- **Steps**:
  1. [Owner] Adds investor(s) to the project with defined stakes.
  2. [System] Grants investor-tier access — a visibility level
     distinct from admin/client/vendor, showing project financials
     appropriate to an investor (likely including committed/forecast
     data clients don't see, but not raw vendor invoices).
  3. [Owner/Accounting] Publishes periodic investor reports.
  4. If an investor exits mid-project, their access ends cleanly
     without retroactively hiding history they were entitled to see
     while active.
- **System state changes**: needs `investors`,
  `investor_project_stakes`, and a new `app_role` value (missing —
  today's enum is `admin/staff/client/vendor` only).
- **Depends on**: Investor & Spec-Home Reporting (module 14) —
  entirely missing.

---

## 13. Lender Draw Request and Supporting Package

- **Trigger**: a construction loan draw is due.
- **Steps**:
  1. [Accounting] Assembles the required package (specific invoices,
     inspection sign-offs, progress photos) — often overlapping with,
     but not identical to, the client draw (workflow 6).
  2. [Owner] Reviews and submits to the lender (likely a PDF export,
     not a live API, per most lenders' own tooling).
  3. [Lender] Reviews (read-only, scoped to this draw package only)
     and releases funds.
  4. A failed inspection blocks submission until resolved.
- **System state changes**: needs `lender_draw_requests` (missing); a
  fourth distinct visibility tier (Lender), narrower than Investor.
- **Depends on**: Lender Draw Support (module 15) + Client Billing
  (module 6, for the underlying draw data) + Permits & Inspections
  (module 16, for inspection sign-off status).
