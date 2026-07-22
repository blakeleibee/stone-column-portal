# Package 1 — Corrections (post-review pass)

This document records the corrections made in response to review of the
initial Package 1 submission, item by item.

## 1. Cost code completion status (no more inferring completion)

Added `cost_code_status` enum (`not_started`, `active`,
`substantially_complete`, `complete`, `closed`) and a `status` column on
`cost_codes`, defaulting to `not_started`. This is a fact a human sets —
nothing in the engine ever infers it.

`CategoryFinancials` now carries `status` through from `CostCode`, and
`generateBudgetSuggestions()` only produces the "completed under budget"
suggestion when `status` is `complete` or `closed` AND there are zero
open committed costs (both conditions, not either alone — a category
marked complete while a commitment is still open is a data
inconsistency worth surfacing differently, not a below-budget signal).

Verified in `test/run.ts`: Site Work (`complete`) generates the
suggestion; Framing, Plumbing, Electrical, and General Conditions (all
`active`, all under their revised estimate with zero recorded
commitments) explicitly do **not** — this is the exact false-positive
pattern flagged in the original submission, now fixed and asserted
against by name.

## 2. Append-only verification: budget_ledger, fee_ledger, audit_log

**Who can insert:** staff/admin (RLS `insert` policies, scoped by
`is_org_admin(project_id)`) for `budget_ledger` and `fee_ledger`.
`audit_log` has **no** insert policy for any application role at all —
see item 3.

**Whether anyone can update:** No. Three layers, not one:
- RLS: the old `for all` staff policies on `budget_ledger` and
  `fee_ledger` are replaced with separate `select`/`insert` policies —
  there is no `update` policy, so RLS denies it by default for
  `authenticated`.
- Explicit `revoke update, delete ... from authenticated, anon` on all
  three tables — this doesn't depend on RLS being configured correctly.
- A `before update or delete` trigger (`reject_mutation()`) on all three
  tables that unconditionally raises an exception, regardless of role —
  including Supabase's `service_role` key, which bypasses RLS entirely
  and is exactly the case RLS-only enforcement would have missed.

**Whether anyone can delete:** No — same three layers as above.

**How an incorrect entry is reversed:** Never by editing the row.
- `budget_ledger` and `fee_ledger` both got a new `reverses_entry_id`
  self-referencing column. A correction is a new row with
  `entry_type = 'correction'` (or an offsetting `fee_amount_cents`) and
  `reverses_entry_id` pointing at the row it corrects. The original row
  is untouched and still visible.
- `expenses` isn't append-only (status legitimately moves
  draft → published → void), but a **published** expense's financial
  fields (amount, cost code, vendor, date) are now protected by a
  dedicated trigger (`reject_published_expense_financial_edit`) — you
  can void it, but you can't quietly change the amount on a published
  transaction. The correction pattern is: void the original, insert a
  new expense with `corrects_expense_id` set to the original's id.
- `committed_costs` (partial-invoice scenario) follows the same
  non-destructive pattern via `superseded_at`/`superseded_by_id`, though
  this isn't DB-trigger-enforced yet — see Known Limitations.

**How voided records remain visible in audit history:** They're never
deleted, so there's nothing to "restore." A voided expense is still a
row in `expenses` with `status = 'void'`; the `audit_log` additionally
has the `insert`/`update` rows showing the before/after state of every
transition that row ever went through, written automatically (item 3).

## 3. Centralized audit logging (trigger-based, not screen-remembered)

Added `log_audit()`, a `security definer` trigger function (runs with
the privileges of its owner, the table owner — the same mechanism that
lets a table owner bypass their own table's RLS) attached via
`after insert or update` triggers to `expenses`, `budget_ledger`,
`fee_ledger`, `committed_costs`, `forecast_entries`,
`budget_suggestions`, and `cost_codes`. Every mutation to those tables
writes an `audit_log` row automatically — no future UI screen has to
remember to do it.

`audit_log` itself has no insert/update/delete grant for
`authenticated`/`anon` roles and no RLS policy permitting any of those
operations — the trigger function is the only path that can write to
it. This is what "prevent client-side code from directly inserting
trusted audit-log entries" means concretely: there is no code path,
authorized or not, other than the trigger.

## 4. Contractor-fee rounding policy

**Policy (now documented in `money.ts` and `fee.ts`):** round once, per
cost category, applied to that category's summed fee-eligible actual
cost. Not per-transaction, not at the project-total level. Project
totals are the sum of the already-rounded per-category amounts —
there's no second, independent rounding pass at the top, so
`project total = Σ(category totals)` holds by construction rather than
by coincidence.

**Rounding rule:** round-half-away-from-zero, not JavaScript's native
`Math.round()` (which rounds `-0.5` toward zero, breaking symmetry for
a category in net credit). Implemented in `roundHalfAwayFromZero()` and
used by `multiplyCentsByPercentage()`.

**Once invoiced:** Package 4's invoices will freeze the exact fee amount
included at issuance time. This package's contribution is making sure
that frozen number itself came from one consistent, documented rounding
rule rather than an ad hoc one.

**Tests (`test/edge_cases.ts` §5):**
- $0.33 basis at 15% → $0.05 (0.495 rounds up)
- $0.10 basis at 5% → $0.01 (exact half-cent, positive)
- -$0.10 basis at 5% → -$0.01 (exact half-cent, negative — proves symmetry)
- $0.01 basis at 1% → $0.00 (rounds down to nothing, not a fraction)
- Three $0.01 expenses at 50%: sum-then-round gives $0.02
  (`round(0.03 × 0.5) = round(1.5¢) = 2¢`), which is explicitly checked
  against what per-transaction rounding would have produced (3¢) to
  prove the category-level policy is actually what's running, not an
  accident of the test data.

## 5. BIGINT / Supabase-JS safety

Added `parseCentsFromApi(value: string | number)` and
`serializeCentsForApi(cents)` to `money.ts`.

**The real risk:** Postgres `bigint` (`int8`) columns can hold values
beyond `Number.MAX_SAFE_INTEGER` (2^53−1 ≈ $90 trillion in cents — not
realistic for this business, but the failure mode if ever hit is silent
precision loss, not a crash, which is worse). How a bigint arrives at
the JS layer depends on the client: node-postgres returns `int8` as a
string by default specifically to avoid float64 coercion; some
PostgREST/Supabase configurations instead serialize it as a JSON
number, which can already have lost precision before this code ever
sees it. `parseCentsFromApi` accepts either shape defensively, validates
the string is digits-only (rejecting e.g. `"12.50"` — a bigint column
should never produce a decimal string, and if one appears it means
something upstream coerced it through a float), and throws if the
numeric value exceeds the safe-integer range rather than silently
returning a wrong number.

**Recommendation documented for the real app:** expose money columns to
PostgREST cast to `text` in any view/RPC that crosses the wire (`amount_
cents::text as amount_cents`), and always route API responses through
`parseCentsFromApi` rather than using a raw response number directly.

**Tests (`test/edge_cases.ts` §13):** parses a bigint-as-string,
accepts a plain safe number, rejects a fractional string, rejects a
value beyond `Number.MAX_SAFE_INTEGER`, and round-trips serialization
back to a digit string.

## 6. Financial-engine test coverage

All twelve requested scenarios are implemented in
`test/edge_cases.ts`, each as an independently-runnable, named check:
credits/negative ledger entries, refunds, voided/reversed expenses,
fee-eligible vs. fee-exempt costs (including per-expense override),
one-cent/fractional-cent rounding, mixed positive/negative approved
changes, zero-dollar categories, actual exceeding revised estimate,
commitments partially invoiced (via the new supersede pattern),
forecast replacement without double counting, dismissed vs. accepted
suggestions, and deliberately unreconciled ledger records (both a
fabricated revised-estimate and a fabricated projected-final-cost
case). 26 checks total, all passing — see Test Results below.

## 7. Suggestions never become official on their own

Unchanged in spirit from the original submission, but now explicitly
asserted rather than just structurally implied: `test/run.ts` calls
`computeProjectTotals()` again after `generateBudgetSuggestions()` runs
and asserts the `projectedFinalCostCents` is identical — proving the
suggestion engine (which has no database access and returns plain
objects) cannot have changed anything. `test/edge_cases.ts` §11 goes
further and simulates the full lifecycle: a suggestion is generated,
"dismissed" (nothing persisted, projected final cost unchanged), then
separately "accepted" — and only inserting a real `forecast_entries` row
with `method: 'accepted_suggestion'` moves the number.

## 8. Documentation and full test suite

This file, plus updates to `CHECKLIST.md`, `packages/01-financial-engine/README.md`,
and `docs/IMPLEMENTATION_PLAN.md` (unchanged — still accurate). Full
results below.

---

## Test Results

```
$ npx tsc --noEmit
(clean, no output)

$ npx ts-node test/run.ts
... (full category/fee/reconciliation report) ...
run.ts: all assertions passed.

$ npx ts-node test/edge_cases.ts
... 26 named checks, each printed as it passes ...
edge_cases.ts: all 26 checks passed.
```

Both scripts were actually executed during this revision (not just
written) — see the checklist for the exact commands.

## Remaining limitations (honest accounting)

- `committed_costs` supersede pattern (`superseded_at`/`superseded_by_id`)
  is modeled in the schema and engine and tested, but — unlike
  `budget_ledger`/`fee_ledger`/`audit_log` — it is **not** yet enforced
  by a database trigger against direct amount edits. The RLS policy
  still permits staff to `UPDATE` a `committed_costs` row (needed to set
  `superseded_at`/`superseded_by_id` in the first place). Tightening this
  to a trigger that only allows those two columns to change, never
  `amount_cents`, is a good Package 4 task once invoices exist and there's
  a concrete workflow to test it against.
- `forecast_entries` has the same "soft append-only via supersede" shape
  and the same gap: nothing at the DB level stops someone from editing
  `forecast_to_complete_cents` on an existing row instead of superseding
  it. Same recommendation as above.
- The audit trigger captures full before/after row snapshots
  (`to_jsonb(OLD)`/`to_jsonb(NEW)`) without yet distinguishing
  internal-only fields from client-safe ones for display purposes —
  fine for an internal audit log (which has no client policy at all
  anyway), but if a future package ever surfaces audit history to
  clients for their own published records, the internal fields will
  need to be filtered at the query layer, not assumed absent.
- `parseCentsFromApi`/`serializeCentsForApi` are written and tested in
  isolation; they aren't wired to an actual Supabase client yet because
  there isn't one in this sandbox — Package 2 (once real data-fetching
  code exists) is where they get called for real.
