# Cost-Plus Workbook → Portal Gap Analysis

**Status: report only — no code, schema, or workbook changes have been made as part of this document. Stop and await approval before implementing anything described here.**

**Reference reviewed:** `docs/reference/Stone_Column_Cost_Plus_Blank_Template.xlsx` (copied from the user's Desktop; not yet git-added — see [Open Items](#open-items)).

**Compared against:** `schema/001_core_financial.sql` (+`schema/010_documents.sql`), `packages/01-financial-engine/src/*.ts`, `packages/01-financial-engine/fixtures/hawksRidge.ts`, `apps/web/src/screens/*`.

This workbook is treated as the business specification for the cost-plus workflow, not as a literal screen-by-screen blueprint. Per instruction, questionable naming/categorization in the workbook is **flagged, not silently corrected**.

---

## 1. Cost codes, activity names, and division assignments

### What the workbook has

113 four-digit cost codes across 7 divisions, each row carrying 16 fields (code, activity name, original budget, scope description, adjustment, adjustment reason, vendor discount, adjusted budget, include-in-estimate flag, billable-cost flag, division, current QB actual, prior billed, current draw cost, budget variance, status).

| Division | Code range | Count |
|---|---|---|
| Preconstruction & General | 1010–1080 | 5 |
| Sitework | 2010–2031 | 10 |
| Foundation | 3005–3096 | 13 |
| Structure, Exterior & MEP | 4010–4200 | 35 |
| Interior Finishes | 5010–5270 | 35 |
| Exterior Improvements & Closeout | 6040–6110 | 8 |
| Other Project Costs | 7025–9999 | 7 |

Full list preserved verbatim in the workbook's `BUDGET` / `INVOICE DETAIL` / `DRAW HISTORY` sheets (identical code+activity list across all three).

### What the portal has today

- `cost_codes` (schema/001_core_financial.sql:241) is a **flat, one-level model**: `id, project_id, code (text), sort_order, fee_eligible (boolean), status, is_archived`. No division field, no activity-name-separate-from-code, no scope/description field, no vendor-discount/adjustment fields, and only **one** visibility flag (`fee_eligible`) where the workbook has **two** distinct ones (`Include in Estimate?`, `Billable Cost?`).
- `packages/01-financial-engine/fixtures/hawksRidge.ts` uses 18 broad category-style strings (`"Framing"`, `"Plumbing"`, `"Contingency / Other"`, ...) directly as the `code` value — this is the workbook's *division* level, not its *cost-code* level. The engine and UI are proven against this coarse model; they've never been exercised against 100+ granular codes per project.

**Gap:** the portal's current cost-code concept is closer to the workbook's *division* than its *cost code*. Building real projects on the current schema would collapse the granularity the workbook (and presumably QuickBooks item-level job costing) depends on.

### Flagged for your decision — not changed

These are observations about the workbook's own data, offered for you to accept, correct, or explicitly keep as-is. None have been altered.

1. **Three activity names carry an unexplained `***` marker**: `5011 Sheetrock - Sub ***`, `5111 Ceramic Tile - Sub ***`, `5170 Hardwoods - Sub ***`. No footnote or legend elsewhere in the workbook explains the asterisks. Worth asking whoever built the template what they meant (a QuickBooks item-mapping caveat? a rate note?) before that meaning is lost.
2. **Inconsistent material/sub abbreviation style**: most codes use `- Mat` / `- Sub` (`4050 Windows/Ex Doors - Mat`), but a cluster uses single-letter abbreviations instead (`5030 Drive/Walk/Patio - M`, `5031 Drive/Walk/Patio - S`, `5035 Public Walks - Conc`, `5036 Public Walks - Sub`). Cosmetic today, but if activity names are ever parsed or pattern-matched (e.g. to auto-classify QuickBooks items), the inconsistency will bite.
3. **Two "trim material" codes with unclear boundary**: `5049 Trim - Materials` and `5050 Trim -Int Doors - Mat` both look like interior-trim material buckets. Possibly a legitimate split (general trim stock vs. interior door trim specifically) — flagging because the names alone don't make the distinction obvious to a new user entering costs.
4. **Possible scope overlap between `6060 Fence` (Exterior Improvements & Closeout) and `7050 "Pool, pavers, Fence"` (Other Project Costs)** — the same word "Fence" appears in two different divisions' cost codes. Worth confirming this is intentional (e.g. a decorative closeout fence vs. a pool-safety fence billed differently) rather than a leftover duplicate.
5. **`7050` bundles three unrelated scope items into one code** (`Pool, pavers, Fence`) while every other code is single-scope. This will make vendor-quote and change-order attribution ambiguous the moment a project has, say, pavers but no pool.
6. **Two codes are structurally different from the other 111**: `7082 Sales Commission` and `9999 Transfer WIP to CGS` both have `Billable Cost? = No` and `Status = EXCLUDED`, but *also* `Include in Estimate? = Yes` — i.e., they're meant to appear in the client-facing estimate rollup but never bill against QuickBooks actuals. That's a real, load-bearing combination of the two flags (not a data-entry mistake), which is exactly why the portal needs both flags modeled as independent booleans rather than collapsed into the current single `fee_eligible`.

---

## 2. Project setup fields

| Workbook field (`Project Setup` sheet) | Current portal equivalent | Gap |
|---|---|---|
| Company Name / Payable To / Address / City-State-Zip / Phone | *(none — org-level billing identity)* | `orgs` table has only `name`. No payable-to address/phone for invoice letterhead. |
| Customer Name / Address / City-State-Zip / Email | *(none)* | No client contact/address entity at all — `project_members` only links a `profiles.id`, which has name/email/phone but no mailing address. |
| Project Name / Address | `projects.name`, `projects.address` | Present. |
| Estimate # | *(none)* | No estimate entity exists yet (planned only, per feature register). |
| Estimate Date | *(none)* | Same. |
| **Management Fee %** | `project_fee_rules.fee_basis_points` | Present and a superset — stored as integer basis points (not a float %), and `project_fee_rules` also carries retainage, tax/freight treatment, and per-category eligibility flags the workbook doesn't have. |
| **Estimated Deposit %** | *(none)* | `projects.deposit_amount_cents` exists but is a flat dollar amount, not a percentage-of-estimate formula field. No field drives "deposit = estimate total × X%". |
| Estimate Terms (disclosure text) | *(none)* | No stored contract/disclosure text field. |
| **Current Draw Number** | *(none)* | No draw entity exists at all yet — see Area 3/5. This is the counter the workbook manually increments each invoice cycle. |
| Invoice # Prefix | *(none)* | No invoice entity exists yet. |
| Invoice Date / Due Date | *(none)* | Same. |
| Credit/Deposit Applied This Draw | *(none)* | Same — no per-draw deposit-application tracking. |
| Payment Terms | `projects.payment_terms` | Present. |

**Gap summary:** roughly half of the workbook's Project Setup fields have no home in the current schema at all, because they belong to entities (estimate, invoice, draw, client contact, org billing identity) that don't exist yet. The fields that *do* exist (fee %, payment terms) are modeled more rigorously in the portal than in the workbook (basis points vs. float, structured fee rules vs. a single cell).

---

## 3. Full workflow: project creation → budget → estimate → QB import → reconciliation → draw → invoice detail → draw history

| Workbook step | Portal status today |
|---|---|
| **1. Project Setup** creates project identity, fee %, deposit %, terms | `projects` + `project_fee_rules` real and tested, but missing several fields (Area 2). No project-creation UI beyond preview screens. |
| **2. BUDGET**: enter ~100 cost-code rows with original budget, scope, adjustments, vendor discount → adjusted budget | `cost_codes` + `budget_ledger` (append-only, `original`/`approved_change`/`correction` entry types) are real and tested, but flat/coarse (Area 1). No scope-description or vendor-discount fields. `budget.ts` computes `revisedEstimateCents = original + approvedChanges` — conceptually matches `Adjusted Budget = Original + Adjustment - Vendor Discount`, but vendor discount has no explicit representation (would currently have to be modeled as a negative `approved_change`, losing the "this was a vendor discount specifically" semantic). |
| **3. ESTIMATE**: client-facing rollup by division, filtered on `Include in Estimate = Yes`, + deposit calc | No estimate entity or screen exists (planned only). `client_budget_view` exists but is cost-code-level, staff-and-client-agnostic in its filtering (shows everything not archived — no `Include in Estimate` equivalent). |
| **4. QB JOB COST IMPORT**: paste raw QuickBooks export, parse cost code from item-name prefix | `import_batches` / `import_rows` tables exist and are well-designed for exactly this (batch status, per-row match_status: new/changed/duplicate/unmatched/error/excluded) — but **no import parser or UI exists**. This is schema-only, never wired to code. |
| **5. COST RECONCILIATION**: `Current Draw Cost = IF(Billable, CumulativeActual − PreviouslyInvoiced, 0)` | No equivalent computation exists anywhere in the engine, because there is no persisted "previously invoiced" concept yet (no `invoices` table). `reconciliation.ts` today does something different — it's an internal consistency checker (do category sums match project totals), not a billing-reconciliation calculator. |
| **6. Progress Draw** (increment draw number, run the numbers) | No draw entity. `CURRENT DRAW NUMBER` in Project Setup has no analog. |
| **7. INVOICE**: division-level cost + flat fee % + deposit credit = amount due | No `invoices` table, no invoice-generation logic. `fee.ts` already computes a fee accrual/invoiced/unbilled model that is *more* granular than the workbook's flat "18% of new actual cost," but nothing persists an actual invoice document/record. |
| **8. INVOICE DETAIL**: cost-code-level backup for the division-level invoice | No equivalent — same gap as #7. |
| **9. DRAW HISTORY**: manual paste of each draw's current-cost column, by cost code, into a hardcoded Draw 1–10 grid | No equivalent, and per your explicit instruction this should **not** be replicated — see Area 6/7 for the proposed replacement (immutable invoice-line records + computed "previously invoiced," no manual paste, no 10-draw ceiling). |

**Bottom line:** steps 1–2 (setup, budget) are real and reasonably close in spirit, though coarser-grained than the workbook. Steps 3–9 (estimate, QB import, reconciliation-as-billing, draw, invoice, invoice detail, draw history) are **entirely unbuilt** — the relevant tables either don't exist (`invoices`, `estimates`, `draws`) or exist only as an unused foundation (`import_batches`/`import_rows`).

---

## 4. Where the portal currently requires duplicate or unnecessary manual entry

Since most of the downstream workflow (estimate/invoice/draw) doesn't exist yet, most "duplicate entry" risk today is *latent* — it will appear the moment those screens are built on the current schema, unless the design in Area 7 is adopted instead. Concretely, if built naively on today's tables:

- **No cost-code ↔ vendor-quote ↔ commitment linkage exists beyond a free-text `vendor_name` on `committed_costs`.** There's no vendor master record, so the same vendor's name would be retyped per commitment, with no dedupe/normalization and no way to pull "everything this vendor is committed to across the project."
- **No estimate entity** means a client-facing estimate would either be hand-typed separately from the budget (duplicate entry of every division total) or would need to be built as a computed view now — the latter is what's recommended in Area 7.
- **No invoice/draw entity** is the biggest latent duplication risk: without it, "previously invoiced" has nowhere to live, which is exactly the condition that forces the workbook's manual copy-paste into `DRAW HISTORY`. Building invoices as real persisted rows (Area 7) is what removes this permanently, per your explicit requirement.
- **`documents` (schema/010_documents.sql) has no `cost_code_id`.** A vendor bill or quote uploaded as a document today can't be linked to the cost-code record it supports — it would have to be re-associated manually (or found by filename/date) every time someone wants "the paperwork behind this line."
- **Change orders have no dedicated entity.** They currently have to be represented as a generic `budget_ledger` row with `entry_type = 'approved_change'` — which captures the dollar impact but not a change order's own identity (description, client approval metadata, originating document). If change-order approval (the open product question already flagged in `docs/product-definition/COVERAGE_MATRIX.md`, blocking Package 7) is entered once as a change order and *separately* re-entered as a budget adjustment, that's duplicate entry by construction.

---

## 5. How estimates, quotes, commitments, actuals, change orders, deposits, fees, invoices, and prior draws should stay linked to one project + one cost-code ledger

**Current state:** the schema already has the right *shape* of pattern for this in `budget_ledger`, `committed_costs`, and `forecast_entries` — each row carries `project_id` + `cost_code_id` as a composite foreign key back to `cost_codes(id, project_id)`, and `committed_costs`/`budget_ledger` additionally carry a generic `source_type`/`source_id` pair for polymorphic provenance. That's a solid foundation to extend, not replace.

**What's missing to reach the "one persistent record per cost code" model you described** (using `5070 — Cabinets - Sub` as the example):

| Piece of the example | Exists today? |
|---|---|
| Original budget | Yes — `budget_ledger` |
| Scope description | No — `cost_codes` has no description field |
| Vendor quote | No entity |
| Selected vendor | Free-text only (`committed_costs.vendor_name`), no vendor master |
| Commitment/subcontract | Yes — `committed_costs`, but no document/quote linkage |
| Approved change orders | Partially — as an untyped `budget_ledger` row, not a distinct change-order record |
| QuickBooks actual costs | Yes, once import is wired — `expenses` with `source_type`/`import_batch_id` |
| Current forecast | Yes — `forecast_entries` |
| Amount previously invoiced | **No** — no `invoices`/`invoice_lines` table exists |
| Current draw | **No** — same gap, and this is the one your instructions are most explicit about |
| Supporting vendor bills | Partially — `expenses` exist, but `documents` can't attach to a cost code |
| Homeowner-facing estimate category | No — no estimate entity, and no division reference table (division is a free-text string duplicated across the workbook's sheets) |
| Invoice detail | **No** — same gap as invoices |

All of these should key off the same `(project_id, cost_code_id)` pair already used by `budget_ledger`/`committed_costs`/`forecast_entries`, so a single cost-code detail screen can pull every related row without any re-entry — this is achievable with the existing composite-FK pattern, extended to the missing tables.

---

## 6. Workbook logic to preserve, improve, or replace

**Preserve:**
- Cost-code-level granularity as the ledger's unit of truth, division as a *grouping* on top of it (not a replacement for it) — this is the core structural insight of the workbook and the current fixture/engine understates it.
- The core billing formula: `Current billable cost = cumulative approved actual cost − amount already invoiced`, filtered to billable-eligible codes. This is exactly `COST RECONCILIATION!F = IF(Billable="Yes", CumulativeActual − PreviouslyInvoiced, 0)`, and it's the right formula — it just needs "PreviouslyInvoiced" to come from a real invoice ledger instead of a hand-maintained grid.
- The data-integrity review flag: `COST RECONCILIATION!J` flags "PRIOR BILLING EXCEEDS QB ACTUAL" as a warning condition. That's a genuinely useful sanity check (it means a cost code was over-billed relative to what QuickBooks now shows as actual — e.g. an actual cost got voided/corrected after being invoiced) and should be preserved as an automated flag in the new system, not dropped.
- Two independent visibility flags per cost code (`Include in Estimate?`, `Billable Cost?`) — confirmed load-bearing by the `7082`/`9999` combination noted in Area 1, and should be modeled as two distinct booleans, separate from `fee_eligible`.

**Improve:**
- **Eliminate the `DRAW HISTORY` manual paste entirely**, per your explicit instruction — replace with immutable invoice-line records and a computed "previously invoiced" total (detailed in Area 7). This also removes the workbook's hardcoded 10-draw ceiling (`DRAW HISTORY` only has columns for Draw 1–10; an 11th draw has no column to paste into today).
- **QuickBooks import matching**: the workbook parses a cost code from `LEFT(TRIM(ItemName), 4)` — i.e., it trusts that every QuickBooks item name starts with the matching 4-digit code as plain text. That's fragile (a typo'd or renamed QuickBooks item silently fails to match, with no error surfaced beyond a blank cell). The existing `import_rows.match_status` enum (`new/changed/duplicate/unmatched/error/excluded`) already anticipates a more robust version of this — explicit per-row match results a human can review, rather than a silent formula failure.
- **Fee model**: the workbook applies one flat management-fee % to the whole draw's new actual cost. `project_fee_rules` + `fee.ts` already support per-cost-code fee eligibility and both percentage/fixed fee bases — genuinely more capable than the workbook. Worth carrying that forward rather than regressing to the workbook's flatter model.

**Replace:**
- Division names as free-text strings duplicated across `BUDGET`, `ESTIMATE`, `INVOICE`, and `INVOICE DETAIL` sheets (7 divisions, each retyped identically in multiple places) should become a normalized reference table (`divisions`), referenced by `cost_codes.division_id` — not a text column repeated per row.
- The workbook's implicit "one workbook = one project" model should become explicit multi-project support using the existing `project_id`-scoped tables — this is already how the schema works, just noting it as a deliberate improvement over the spreadsheet's one-file-per-project convention.

---

## 7. Proposed implementation plan (not yet approved — do not build from this without sign-off)

This section is a proposal for discussion, not a build order. It's sequenced to minimize manual entry and preserve the append-only/audit patterns already established elsewhere in the schema.

### 7.1 Schema additions

1. **`divisions`** — `id, project_id (or org_id, if divisions are meant to be a shared template), name, sort_order`. Seed with the workbook's 7 names as the starting template; project-level override if a project needs a different set.
2. **Extend `cost_codes`**: add `division_id` (FK to `divisions`), `activity_name` (workbook currently conflates this with `code`'s display), `scope_description text`, `include_in_estimate boolean not null default true`, `billable boolean not null default true` — as two flags distinct from the existing `fee_eligible`, matching the Area 1 finding that all three are independently meaningful.
3. **`vendors`** — a minimal master record (`id, org_id, name, contact info`) so `committed_costs.vendor_name` (and a new `vendor_quotes.vendor_id`) can reference one row instead of free text, enabling "everything this vendor is committed to" queries without retyping.
4. **`vendor_quotes`** — `id, project_id, cost_code_id, vendor_id, amount_cents, status (pending/selected/declined), document_id, created_by, created_at`. A selected quote becomes the `source_id` a `committed_costs` row points to via its existing `source_type`/`source_id` columns — no schema change needed on `committed_costs` itself.
5. **`change_orders`** — `id, project_id, cost_code_id (or a change order could span multiple cost codes — needs a decision), description, amount_cents, status (draft/pending_approval/approved/rejected), requested_by, approved_by, approved_at, document_id`. An approved change order is what generates the existing `budget_ledger` row with `entry_type='approved_change'` and `source_type='change_order'`/`source_id=<change_order.id>` — preserving the append-only ledger pattern while giving change orders their own identity and approval trail. **This table's design should wait for the client-approval-model decision already flagged in `docs/product-definition/COVERAGE_MATRIX.md` as a blocker for Package 7**, since "approved_by" needs to know whether single- or multi-decision-maker approval applies.
6. **`estimates`** — `id, project_id, estimate_number, estimate_date, status (draft/sent/accepted), deposit_basis_points, terms_text, created_by, created_at`. The estimate's line items are **not** a separate stored table — they're a computed rollup of `cost_codes` (filtered on `include_in_estimate`) grouped by `division_id`, snapshotted at send-time (see below) so a sent estimate doesn't silently change if the budget changes afterward.
7. **`invoices`** — `id, project_id, invoice_number, draw_number (replaces the workbook's manual "Current Draw Number" counter — auto-incremented per project), invoice_date, due_date, status (draft/finalized/void), credit_applied_cents, fee_amount_cents, created_by, finalized_by, finalized_at`.
8. **`invoice_lines`** — the direct replacement for `DRAW HISTORY`'s manual paste, and the centerpiece of the "eliminate manual draw history" requirement: `id, invoice_id, project_id, cost_code_id, cumulative_actual_cost_cents, previously_invoiced_cost_cents, current_draw_cost_cents, created_at`. **Immutable once the parent invoice is finalized** — same append-only pattern as `budget_ledger`/`fee_ledger` (reject UPDATE/DELETE via trigger). `current_draw_cost_cents` is computed and stored at finalize-time as `cumulative_actual_cost_cents − previously_invoiced_cost_cents`, where `previously_invoiced_cost_cents` is itself computed as `SUM(current_draw_cost_cents)` from every prior finalized `invoice_lines` row for that `(project_id, cost_code_id)` — no manual paste, no fixed 10-draw ceiling, auditable by construction since every historical draw's line is a permanent row instead of a value copy-pasted into a shrinking set of grid columns.
9. **Add `cost_code_id` to `documents`** (nullable) so vendor bills/quotes can be attached directly to the cost-code record they support, closing the Area 4 gap.

### 7.2 Computation changes (`packages/01-financial-engine`)

- New `invoicing.ts` module: `computePreviouslyInvoiced(costCodeId, priorInvoiceLines)` and `computeCurrentDrawCost(cumulativeActual, previouslyInvoiced, billable)` — a direct port of the `COST RECONCILIATION!F` formula, but reading from real `invoice_lines` rows instead of a QB-import + hand-pasted-grid pair.
- New reconciliation check ported from `COST RECONCILIATION!J`: flag any cost code where `previously_invoiced_cost_cents > cumulative_actual_cost_cents` (the workbook's "PRIOR BILLING EXCEEDS QB ACTUAL" condition) as a review item before an invoice can be finalized.
- Extend `computeCategoryFinancials` output (or add a sibling function) to surface `previouslyInvoicedCents` / `currentDrawCostCents` per category, the same way it already surfaces `actualCostCents`/`committedCostCents`/`forecastToCompleteCents` — keeping the "no screen computes its own financial numbers" rule intact.

### 7.3 Sequencing note

This maps onto packages beyond the currently-approved P0/P1 scope in `docs/production-build/PRODUCTION-ROADMAP.md`. Change orders (item 5 above) explicitly depend on the not-yet-made approval-model decision that's already called out as a blocker for Package 7 in the roadmap docs. Estimate/invoice/draw (items 6–8) look like natural Package 7/8-adjacent work but that's a sequencing call for you to make, not something implied by this analysis.

### 7.4 Explicitly out of scope for this report

No code, migration, or UI work has been started. This section is a proposal to react to, not a plan already in motion.

---

## Open items

- `docs/reference/Stone_Column_Cost_Plus_Blank_Template.xlsx` has been copied into the repo but is **not yet `git add`-ed** — it's sitting as an untracked file pending your confirmation that it should be committed as a reference document.
- A second file was noticed on your Desktop but not opened or compared: `Stone_Column_Cost_Plus_Estimate_Invoice_Model.xlsx` (different name, earlier modified date — possibly a filled-in example rather than a blank template). Let me know if you'd like that reviewed too; it wasn't part of the original request.
