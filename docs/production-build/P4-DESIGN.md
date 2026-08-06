# P4 — Estimating & Budgeting UI + QuickBooks Desktop Import — Design Record

**Status:** Design only. Not yet implemented. Awaiting review/approval
before `docs/superpowers/plans/2026-08-06-p4-estimating-budgeting-qbimport.md`
is executed. Full scope reference: `docs/production-build/PRODUCTION-ROADMAP.md`
§"Package P4"; business-workflow context: `docs/production-build/WORKBOOK-GAP-ANALYSIS.md`;
governing cross-package constraints:
`docs/production-build/FINANCIAL-ARCHITECTURE.md` (the permanent-
backbone rule this design record follows, the money-flow diagram P4's
own place in, and the `source_type` registry P4's new values are drawn
from) and `docs/production-build/AI-ASSISTANT-ARCHITECTURE.md` (the
repository/service-layer discipline this design's "Server-side
operations" section below now follows, so P4's mutations are directly
callable by a future AI tool-calling layer without a second
implementation).

## The core architectural fact this design rests on

**The "one ledger centered on project + cost code" requirement already
exists in the schema — P4 does not invent it.** `budget_ledger`,
`expenses`, `committed_costs`, `forecast_entries`, and `budget_suggestions`
all carry a composite foreign key `(cost_code_id, project_id) →
cost_codes(id, project_id)` (schema/001), which is exactly the shared
spine the brief asks for and which `FINANCIAL-ARCHITECTURE.md` now
declares the permanent backbone for every future financial package, not
just this one. `budget_ledger.source_type`/`source_id` and
`committed_costs.source_type`/`source_id` are deliberately untyped
free-text/uuid pairs (per `PRODUCTION-ROADMAP.md`'s own "no reordering
recommended" note) specifically so future provenance — a QuickBooks
import batch, a vendor quote, a commitment, a change order, a draw —
can each point back at the same cost-code row without a schema change
or a second, disconnected table. **P4's job is to activate this spine
for real writes for the first time (it has only ever been read), not
to design a new one.** Every new P4 write path re-uses these exact
tables and the composite-FK pattern; no new "budget" or "actuals" table
is created. P4 registers two new `source_type` values
(`quickbooks_import`, and reserves `bid_award`/`change_order`/
`selection_overage`/`vendor_invoice` for P5/P7/P8/P11 respectively) in
`FINANCIAL-ARCHITECTURE.md`'s registry — any future package adding a
new value updates that registry in the same commit, per its own stated
rule.

## Scope

Real cost-code/budget-ledger entry UI (replacing `AdminFinancialsScreen`'s
read-only-only status) plus a QuickBooks Desktop file-based import
wizard with mapping profiles, duplicate detection, and a pending →
posted review gate. Explicitly following `PRODUCTION-ROADMAP.md`'s P4
scope; **P5 (Commitments/Bids) and P6 (Billing/Draws) are not started**.

## Decisions made in this design (flagged explicitly, per project convention)

1. **`import_mapping_profiles` is org-scoped, not project-scoped.**
   Every project uses the same 113-code standard template
   (`apply_standard_cost_code_template`, P2.1), so a QuickBooks
   item-name-to-cost-code mapping is realistically identical across an
   org's projects. Org-scoping means staff teach the system once, not
   once per project — matches `vendors`' existing org-scoping (P2.1),
   not project-scoped tables like `cost_codes` itself.
2. **"Original budget entry" is one-time per cost code; all subsequent
   changes are `correction` rows with a mandatory reason.** `budget_ledger`
   is append-only with no `revised` column — `revisedEstimateCents` is
   always derived (`computeCategoryFinancials`,
   `packages/01-financial-engine/src/budget.ts:30-37`, sums
   `approved_change` + `correction` rows on top of `original`). A new
   DB trigger blocks inserting a second `original` row for a cost code
   that already has one (directing the user to the adjustment path
   instead); a new CHECK constraint requires `note is not null` on
   every `correction` row. This is the append-only non-negotiable
   applied to estimating for the first time, not a new invariant.
3. **QuickBooks import produces `pending` expenses, never `posted`
   directly.** Confirming an import batch is a separate act from
   posting the expenses it created — reusing the *already-existing*
   `expenses` state machine (`pending → posted → void`,
   `enforce_expense_state_transition`, schema/001) rather than
   inventing a new "review" concept. This is what makes "pending
   review before posting" true: import-row review (match/duplicate/
   error triage) gates *creation* of the expense; the existing posting
   action gates whether it counts in `actualCostCents`
   (`budget.ts:39-51` already excludes non-`posted` rows from actual
   cost — this exclusion was added in P1 specifically so a
   not-yet-reviewed import row could never silently affect the
   official numbers).
4. **New dependency: `csv-parse`** (a small, well-established CSV
   parsing library) for the import Route Handler. QuickBooks Desktop's
   job-cost export is a delimited file with quoting/escaping edge cases
   a hand-rolled splitter would get wrong; no existing dependency in
   the repo parses CSV today.
5. **Reconciliation reporting scope is deliberately narrower than the
   full workbook.** Buildable now: per-batch "does the sum of confirmed
   import rows match the sum of the `expenses` rows it produced"
   (catches partial-confirm/error-row silent gaps). **Deferred to P6**
   (explicitly, not silently dropped): the workbook's `COST
   RECONCILIATION!J` "PRIOR BILLING EXCEEDS QB ACTUAL" flag
   (`WORKBOOK-GAP-ANALYSIS.md` §6) needs real billing/draw data, which
   doesn't exist until P6. Recorded here so P6 doesn't have to
   rediscover it.
6. **New UI routes are flat** (`/admin/estimate`, `/admin/import`),
   matching the *existing* limitation that every current admin route
   (including `/admin/financials`) operates on "the first project"
   with no per-project routing (`apps/web/app/admin/financials/page.tsx:23`,
   `firstProject` query, no `[projectId]` dynamic segment anywhere in
   the app today). P4 does not introduce or fix per-project routing —
   that's P3 UI scope, already noted as not yet built.

## Schema/migration changes

One new migration, `schema/013_estimating_and_qb_import.sql` (+ down),
following P2.1's precedent of bundling one package's full schema
surface into a single file:

- **New table `import_mapping_profiles`**:
  ```sql
  create table import_mapping_profiles (
    id                        uuid primary key default uuid_generate_v4(),
    org_id                    uuid not null references orgs(id),
    name                      text not null,
    column_mapping            jsonb not null,
    cost_code_match_strategy  text not null default 'prefix',
    cost_code_prefix_length   integer,
    item_overrides            jsonb not null default '{}'::jsonb,
    is_archived               boolean not null default false,
    created_by                uuid references profiles(id),
    created_at                timestamptz not null default now(),
    constraint import_mapping_profiles_strategy_valid
      check (cost_code_match_strategy in ('prefix', 'exact', 'manual_only')),
    constraint import_mapping_profiles_prefix_length_required
      check (cost_code_match_strategy <> 'prefix' or cost_code_prefix_length is not null),
    unique (org_id, name)
  );
  ```
  `column_mapping` shape: `{"item": "<CSV header>", "vendor": "<CSV header>", "amount": "<CSV header>", "date": "<CSV header>", "memo": "<CSV header>"}`. `item_overrides` shape: `{"<exact item text>": "<cost_codes.code>"}` — checked before the prefix/exact strategy, so a one-off bad match gets fixed once and reused forever.
- **Alter `import_batches`**: add `mapping_profile_id uuid references import_mapping_profiles(id)` (nullable — a batch always used *some* profile, but the profile could later be archived; keep the historical link, don't cascade-delete the batch).
- **New trigger on `budget_ledger`**: `enforce_single_original_budget_entry` (BEFORE INSERT) — raises if `NEW.entry_type = 'original'` and a non-reversed `original` row already exists for `(cost_code_id)`. Model the trigger-function shape on `enforce_expense_state_transition` (schema/001, lines 627-666) — same "raise a clear, specific exception message" style.
- **New CHECK constraint on `budget_ledger`**: `budget_ledger_correction_requires_note check (entry_type <> 'correction' or note is not null)`.
- **New audit triggers** (closing a real, confirmed gap — `import_batches`/`import_rows` currently have none, unlike every other mutable table): `audit_import_batches`, `audit_import_rows`, `audit_import_mapping_profiles`. `import_rows` has no direct `project_id` column (only `batch_id`) — write a new trigger function `log_audit_via_batch()` resolving `project_id` through `import_batches`, modeled on the existing `log_audit_self_scoped()`/`log_audit_no_project()` pair (schema/006) rather than inventing an unrelated pattern.

## RLS policies

- `import_mapping_profiles_staff_only` (`for all`, `is_org_staff_for_org(org_id)`) — same shape as `vendors_staff_only` (P2.1), the closest existing org-scoped precedent.
- No RLS changes to `import_batches`/`import_rows`/`budget_ledger`/`cost_codes`/`expenses` — their existing staff-only/client-read policies already cover every new write path P4 adds (a new trigger/constraint is not a new access grant).

## Server-side operations

Per `TARGET-ARCHITECTURE.md` §5.1/§5.2: ordinary user-JWT client, RLS
as the real gate — no service-role client anywhere in this package.
**Per `TARGET-ARCHITECTURE.md` §14 / `AI-ASSISTANT-ARCHITECTURE.md`
(added after this design was first drafted, retrofitted here before
implementation begins):** the validation and mutation logic below lives
in plain service functions under a new
`packages/02-app-shell/src/services/` directory
(`budgetService.ts`, `costCodeService.ts`, `importMappingService.ts`),
not inline in the Server Action. Each Server Action listed below is a
thin adapter — parse `FormData`, call the service function, shape the
result for the UI — so a future AI tool-calling layer can call the
identical service function directly, under the same asking user's
session, without a second implementation.

- `enterOriginalBudget(costCodeId, amountCents, note?)` and
  `adjustBudget(costCodeId, deltaCents, reason)` — in `budgetService.ts`,
  called by a thin Server Action of the same name. Plain RLS-gated
  `.insert()` on `budget_ledger` (no RPC needed; the new trigger/
  constraint enforce the invariants at the DB level, so there's nothing
  left for a wrapper function to "re-derive"). Staff RLS already grants
  this via `cost_codes_staff_full`'s sibling `budget_ledger_staff_insert`.
- `updateCostCodeMetadata(costCodeId, { activityName?, scopeDescription?, includeInEstimate?, billable? })`
  — in `costCodeService.ts`, called by a thin Server Action. Plain
  RLS-gated `.update()` on `cost_codes` (`cost_codes_staff_full`
  already grants this).
- `createMappingProfile(...)` / `updateMappingProfile(...)` — in
  `importMappingService.ts`, called by thin Server Actions. Plain
  RLS-gated inserts/updates on `import_mapping_profiles`.
- **Import parse Route Handler** (`POST /api/imports/parse`, new): accepts
  a multipart file + `projectId` + `mappingProfileId`. Parses the CSV
  with `csv-parse`, resolves `cost_code_id` per row (`item_overrides`
  lookup → strategy-based match → `unmatched`), checks for duplicates
  against existing `expenses` rows (same `project_id`+`cost_code_id`+
  `vendor_name`+`transaction_date`+`amount_cents`) and against other
  rows in the same upload, inserts one `import_batches` row
  (`status='processing'` then `'ready_for_review'`) and one `import_rows`
  row per parsed line (`raw_data` = the full parsed row, `match_status`
  set per the rules above). This is genuine business logic (file
  parsing, matching), so it runs server-side per §5.1 — never a
  client-side parse-then-insert.
- **`confirm_import_batch(p_batch_id uuid) returns void`** — new
  `plpgsql security invoker` RPC (not `security definer`: staff already
  has direct RLS access to every table it touches; this exists purely
  for transactional atomicity across multiple inserts, same reasoning
  as why `sum_posted_expenses` is `security invoker`, not `definer`).
  For every `import_rows` row in the batch with `match_status in
  ('new','changed')` (i.e., not `duplicate`/`unmatched`/`error`/`excluded`):
  insert one `expenses` row (`financial_status='pending'`,
  `source_type='quickbooks_import'`, `import_batch_id = p_batch_id`),
  set `matched_expense_id` on the `import_rows` row, then set
  `import_batches.status = 'confirmed'`. Raises if any row is still
  `unmatched`/`error` and not `excluded` (forces the reviewer to
  resolve or explicitly exclude every problem row — no silent partial
  confirm).

## UI screens

- **`/admin/estimate`** (new route): cost-code list (reusing
  `BudgetTable`'s data shape where sensible, but this screen needs
  mutation affordances `BudgetTable` deliberately doesn't have — a new
  component, not a `BudgetTable` prop flag) with per-row "Enter
  Original" (only shown/enabled when no original entry exists yet) and
  "Adjust" (opens a small form: signed delta + required reason) actions,
  plus inline editing of `activityName`/`scopeDescription`/
  `includeInEstimate`/`billable`. Same "first project" convention as
  `/admin/financials` today.
- **`/admin/import`** (new route): three-step wizard —
  1. select or create a mapping profile;
  2. upload a file (calls the parse Route Handler), then review
     `import_rows` grouped by `match_status` (per-row cost-code
     override dropdown, per-row exclude toggle);
  3. confirm (calls `confirm_import_batch`), then show the batch-level
     reconciliation check (imported-rows total vs. resulting
     `expenses` total for that batch — see "Decisions made" §5).
- **Fixture behavior**: unaffected — `/admin/estimate` and
  `/admin/import` are new routes with no fixture equivalent to retire;
  `/admin/financials` remains read-only and unchanged by this package.

## Audit events

Every `budget_ledger` insert (already audited, schema/001 —
`original`/`correction` rows now flow through the same existing
trigger for the first time with real data). Every `cost_codes` update
(already audited, schema/001). New: every `import_batches`/`import_rows`/
`import_mapping_profiles` insert/update (this package closes that gap —
see "New audit triggers" above).

## Tests

- `tests/sql/package_p4_estimating_qb_import_tests.sql` (new), following
  `package_p2_1_financial_master_data_tests.sql`'s exact structure and
  reusing its `set_test_user`/`assert_that`/`assert_raises`/
  `test_fixture_ids`/`org_b_admin` fixtures:
  1. `import_mapping_profiles` RLS + cross-org isolation (reuse
     `org_b_admin`, same pattern as P2.1's vendors section).
  2. `enforce_single_original_budget_entry` rejects a second `original`
     row for the same cost code; accepts the first.
  3. `budget_ledger_correction_requires_note` rejects a `correction`
     row with `note is null`; accepts one with a note.
  4. `confirm_import_batch()` happy path (all rows `new`/`changed` →
     matching `expenses` rows created, `pending`, correct
     `import_batch_id`); rejects when an `unmatched`/`error` row isn't
     `excluded` first.
  5. Audit visibility: an insert to each of the three new/altered
     tables produces a real, staff-readable `audit_log` row (mirrors
     P1's own "closed a real gap where... audit rows were written but
     permanently unreadable" finding — verify readability, not just
     existence).
- New file added to `scripts/db/run-sql-tests.mjs`'s `FILES` array
  (both the migration and its test file), in position after
  `package_p2_1_financial_master_data_tests.sql`.
- `apps/web` test: a new `apps/web/test/import_parse_unit.ts` covering
  the CSV-parse/match-resolution logic in isolation (prefix match, exact
  match, override hit, duplicate detection, malformed-row error) —
  fast, no server, same style as `authorization_unit.ts`.
- Import-file fixtures: `tests/fixtures/quickbooks/` (new directory) —
  at minimum one realistic sample CSV (hand-authored, matching a
  plausible QuickBooks Desktop job-cost export column layout: Item,
  Name, Memo, Date, Amount) covering a clean match, a prefix match, an
  override case, a duplicate, and a malformed row, since no real sample
  export exists anywhere in this repo today (confirmed during
  research) — `PRODUCTION-ROADMAP.md` line 522 calls for this
  directory but it doesn't exist yet.

## CI requirements

Extends the existing `test:db` job with the new migration/test file
(no new CI job needed — same ephemeral-PGlite job P1 already set up).
`import_parse_unit.ts` added to whichever `npm run test` step already
runs `authorization_unit.ts`.

## Deployment requirements

None new — same Vercel/Supabase projects as P1. The real hosted dev
Supabase project from the pre-P4 checkpoint (`docs/production-build/PRE-P4-CHECKPOINT.md`)
is where migration 013 gets applied and end-to-end-tested before this
package is considered complete, exactly as migrations 001-012 were.

## Acceptance criteria

1. A real original budget amount, entered through `/admin/estimate`,
   appears correctly in `/admin/financials`'s existing rollup — same
   engine, same numbers, no fixture involved.
2. Attempting to enter a second "original" amount for a cost code that
   already has one is rejected with a clear message directing the user
   to "Adjust" instead; an adjustment without a reason is rejected.
3. A QuickBooks CSV file, imported through `/admin/import` end to end,
   produces correctly-matched `pending` expenses; posting them (the
   existing action) makes them appear in `actualCostCents`.
4. A duplicate row (matching an existing expense or another row in the
   same file) is flagged `duplicate`, never silently imported twice.
5. A row confirm-blocked by `unmatched`/`error` status cannot be
   confirmed into an expense until resolved or explicitly excluded —
   proven by an actual attempted confirm, not code review.
6. Every new/altered table's writes produce a real, staff-readable
   `audit_log` row — proven by an actual query, matching P1's own bar.
7. `npm ci`/`typecheck`/`test`/`build` all pass from a clean install,
   migration 013 applies cleanly to the real hosted dev project
   alongside 001-012.

## Dependencies

P3 (vendor foundation — via P1's consolidation, already complete),
P2.1 (cost-code/division master data, complete). The pre-P4 checkpoint
(`PRE-P4-CHECKPOINT.md`) — complete.

## Explicit exclusions

No live QuickBooks API (file-based only, matches the roadmap's own
instruction — QuickBooks Desktop has no cloud API). No commitments/bids
(P5). No draws/invoices/payments (P6/P6b) — the reconciliation report
this package ships is intentionally narrower than the full workbook
check, which needs billing data (see "Decisions made" §5). No
per-project routing/switching (P3 UI scope, not fixed here). No change
to `AdminFinancialsScreen`/`ClientBudgetAndInvoicesScreen` themselves —
both remain exactly as they are; P4 only gives them real data to render
and adds new screens alongside.
