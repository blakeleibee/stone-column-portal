# Package 1 — Corrections, Round 2 (independent review)

This round came from an independent review of the actual SQL/TypeScript,
not just the written summary. Items 1–12 are schema/engine corrections;
item 13 is about verification, and is where the most important honesty
disclosure in this document lives — read that section first if you only
read one.

## Up front: what was actually executed vs. only written

- **TypeScript**: actually executed in this sandbox. `npx tsc --noEmit`,
  `npx ts-node test/run.ts`, and `npx ts-node test/edge_cases.ts` all ran
  moments ago, from a clean copy in `/mnt/user-data/outputs`, and the
  output is pasted in Test Results below.
- **SQL/RLS**: **written but not executed.** This sandbox has no local
  Postgres, no Docker, and no network access to provision either —
  verified directly before writing anything (`apt-get install postgresql`
  fails with a 403 from the package mirror; there is no `psql`/`pg_ctl`/
  `docker` binary present). `tests/sql/package1_tests.sql` is a complete,
  runnable test script covering every scenario item 13 asked for
  (admin/staff/Client A/Client B/anonymous RLS, append-only enforcement,
  state-machine transitions, delete protection, reversal-magnitude
  guard, composite-FK cross-project rejection, bootstrap, self-
  escalation), with instructions for running it against either a real
  Supabase project or a bare local Postgres via Docker. I reasoned
  through it carefully and fixed one real bug I caught myself while
  reviewing it (see below), but I have not run it, and I'm not going to
  claim otherwise. Please run it and tell me what happens — that result,
  not this document, is the actual verification.
- Migration rollback/reapply test: not created, for the same reason —
  it requires a real database to mean anything.

## 1. Audit-log RLS

**The bug:** `for select using (true)` with no `to` clause. In Postgres,
a policy with no `to` clause applies to `PUBLIC` — every role, including
`anon`. Combined with `using (true)`, this made every audit row
(including full before/after snapshots of financial data) readable by
anyone with any Supabase session, authenticated or not.

**The fix, and a broader pattern it revealed:** every single policy in
the schema is now written `for select/insert/update/all **to
authenticated** using (...)`. This wasn't just an audit_log-specific
fix — I audited every policy in the original file and none of them had
a `to` clause, meaning the entire schema had this exposure, not just
audit_log (it happened to be least visible there because `using (true)`
made it total, but a client-scoped `using (is_project_client(...))`
policy without `to authenticated` would still evaluate for `anon`, and
`is_project_client()` calls `auth.uid()`, which is NULL for anon — so
those policies happened to fail closed for anon by accident of what
`auth.uid()` returns, not by design. That's not something to rely on.)

`audit_log`'s new policy: `for select to authenticated using (project_id
is not null and is_org_staff(project_id))`. This required adding a
`project_id` column to `audit_log` (see item 3) so there's something to
scope the policy against. No insert/update/delete policy exists for
`audit_log` at all, and direct grants are revoked — see item 3's writeup
on `log_audit()`.

Test: SQL suite Section 4.

## 2. RLS on orgs and profiles

Both tables had RLS **disabled entirely** in the original migration —
the "RLS enabled on every table" claim in the checklist was wrong for
these two.

- `orgs`: `select` policy lets any authenticated user with a profile in
  that org see its name (nothing else is stored there). No insert/
  update/delete policy for any application role — org creation is
  bootstrap-only (item 11).
- `profiles`: `select` — your own row, or any row in your org if you're
  staff/admin (`is_org_staff_for_org`). This directly answers "clients/
  vendors cannot enumerate unrelated profiles" (a client's `role`
  doesn't satisfy `is_org_staff_for_org`, so their only visible row is
  their own) and "cross-organization access is impossible" (`org_id`
  scoping means a different org's rows never match, for anyone).
  `update` — your own row, or an org admin (not just staff — see below)
  updating someone else's row in their org.
- **Self-escalation**: RLS alone can't do column-level restriction (a
  user could otherwise pass an UPDATE that changes their own `role` or
  `org_id` alongside `full_name`, and RLS would allow it since the "is
  this your own row" check doesn't know which columns changed). Added
  `reject_profile_self_escalation()`, a trigger that unconditionally
  rejects a self-update that changes `role`, `org_id`, or `is_active` —
  even for an admin editing their own row. Those changes require another
  admin to act on your row, which the RLS update policy separately
  permits (scoped to their org).
- No insert/delete policy for `profiles` at all — creation only happens
  through `bootstrap_organization()` (item 11).

Test: SQL suite Section 3 (Client A/B enumeration), Section 8
(self-escalation).

## 3. Separated financial_status from publication_status

Replaced the single `status: draft|published|void` + `client_visible:
boolean` model with two independent enums:

- `financial_status: pending | posted | void` — the only thing that
  affects actual cost, fee accrual, forecasts, or reconciliation. The
  TypeScript engine's actual-cost and fee-basis filters now check
  `financialStatus === 'posted'` specifically (previously they checked
  `status !== 'void'`, which incorrectly let *pending* — i.e. not-yet-
  reviewed import rows — affect official totals).
- `publication_status: internal | ready | published | withdrawn` —
  controls only what a client can see. A posted-but-internal expense is
  real money the client can't see yet; there is no combination where a
  non-posted expense is client-visible (enforced by a CHECK constraint:
  `financial_status <> 'pending' or publication_status = 'internal'`,
  and symmetrically `financial_status <> 'void' or publication_status =
  'withdrawn'` — a voided expense is always frozen as withdrawn, never
  left looking "published" once the money behind it turned out not to
  be real).

`test/run.ts`'s sample data now includes two genuinely `pending`
expenses and asserts the project total would have been larger (wrong)
had they been included. `test/edge_cases.ts` §3–4 test pending/posted/
void/fee-eligibility interactions explicitly.

## 4. Expense state-machine enforcement

`enforce_expense_state_transition()` (trigger, `before update`):
- `financial_status` may only move `pending → posted` or `posted →
  void`, one step, never backward, never skipped. `void` is checked
  first and is unconditionally terminal — any update at all to a void
  row is rejected, not just financial-field edits.
- Once `posted` (checked against `OLD`, so this applies from the moment
  a row *was* posted, including the same transaction that just posted
  it), `amount_cents`, `cost_code_id`, `vendor_name`, `transaction_date`,
  and `project_id` are frozen. A correction is a new row with
  `corrects_expense_id` set — never an edit here.

`reject_expense_delete_unless_pending()` (trigger, `before delete`):
DELETE only succeeds while `financial_status = 'pending'` — a reviewed-
but-not-yet-real import row is the one case where hard deletion is
legitimate (see item 5). Posted or void rows can never be deleted.

Test: SQL suite Section 5.

## 5. No destructive deletion of financial records

Reviewed every financially-relevant table:

| Table | Delete policy |
|---|---|
| `budget_ledger`, `fee_ledger`, `audit_log` | Never — `reject_mutation()` blocks UPDATE and DELETE unconditionally, for any role |
| `expenses` | Only while `financial_status = 'pending'`; posted/void rows rejected by trigger |
| `committed_costs`, `forecast_entries`, `budget_suggestions` | Never — `reject_delete()` trigger, plus grants revoked |
| `cost_codes` | Only if truly unused (no budget_ledger/expense/committed_cost/forecast/suggestion references it) — `reject_cost_code_delete_if_used()` checks before allowing; otherwise archive (`is_archived`) instead |

**Delete-audit behavior where deletion is legitimate:** the only table
where DELETE can ever succeed for a real financial row is `expenses`
(pending-only), and its `log_audit` trigger fires `after insert or
update **or delete**`, so a successful pending-expense deletion still
produces an `audit_log` row capturing the deleted row's full state.

Test: SQL suite Section 5 (also exercises the pending-delete-succeeds
and audit-row-exists paths, not just the rejections).

## 6. Integer basis points, not floating-point percentages

**The bug:** `multiplyCentsByPercentage(cents, percentage)` took a JS
number like `0.15` and did `cents * percentage` before rounding — a
float multiplication, exactly the "does not satisfy exact integer
financial arithmetic" problem named in review.

**The fix:** `FeeRule.feePercentage: number` (e.g. `0.15`) is gone,
replaced by `FeeRule.feeBasisPoints: number` (e.g. `1500`), always over
a fixed `BASIS_POINT_DENOMINATOR = 10_000n`. The new
`multiplyCentsByBasisPoints()` converts both operands to `BigInt`,
computes the product exactly (`BigInt` multiplication has no precision
ceiling), and does the division by 10,000 with an explicit
round-half-away-from-zero `BigInt` division — no `Math.round`, no float
division, anywhere in the path. The result is converted back to a JS
number only at the very end and re-validated as a safe integer.

Schema: `project_fee_rules.fee_percentage numeric(6,4)` →
`fee_basis_points integer` (with a `0–10000` range check),
`retainage_percentage` → `retainage_basis_points` (same treatment).

Tests (`test/edge_cases.ts` §5, 9 checks): fractional-cent rounding,
exact half-cent (both signs, proving symmetry for credits), a 1-basis-
point rate, a rate exceeding 100% (the math shouldn't break even though
it's not a realistic contractor fee), a rate producing an exact-zero
result, a **large-value** case near `Number.MAX_SAFE_INTEGER` checked
against an independent `BigInt` computation, the category-level-
rounding-happens-once proof (carried over from round 1, now re-verified
against basis points), and a rejection test for a non-integer
basis-points value.

## 7. Cross-project reference integrity

**Composite foreign keys, not triggers**, wherever Postgres allows it —
this was the reviewer's explicit and correct suggestion, since a FK is
enforced by the database engine itself and can't be forgotten or
bypassed the way a trigger written by a future contributor might be:

- `cost_codes` gained a `unique (id, project_id)` constraint.
- `expenses`, `committed_costs`, `forecast_entries`, `budget_suggestions`
  each got `foreign key (cost_code_id, project_id) references
  cost_codes(id, project_id)` — a row can only reference a cost code
  that actually belongs to the same `project_id` it declares. Postgres
  itself rejects a mismatch at insert/update time.
- `expenses` also gained `unique (id, project_id)` and a self-referential
  `foreign key (corrects_expense_id, project_id) references
  expenses(id, project_id)` — a correction can only reference an
  expense in the same project (and a `CHECK` separately rejects
  self-reference).
- `budget_ledger` and `fee_ledger` got the same treatment for their
  `reverses_entry_id` self-references (item 10).

Test: SQL suite Section 6 (attempts an expense with `project_id` A and
a cost code that actually belongs to project B; expects rejection).

## 8. Hardened SECURITY DEFINER functions

Every `security definer` function (`is_org_staff_for_org`,
`is_org_admin_for_org`, `is_org_staff`, `is_project_client`, `log_audit`,
`bootstrap_organization`) now has `set search_path = public, pg_temp`
and schema-qualifies every object it touches (`public.profiles`, not
`profiles`). This closes the classic SECURITY DEFINER vulnerability
where a malicious `search_path` could redirect an unqualified table
reference to an attacker-controlled object in another schema.

`EXECUTE` is revoked from `PUBLIC` on all of these and re-granted only
to `authenticated` (or, for `bootstrap_organization`, granted to
`authenticated` and deliberately withheld from `anon` — see item 11).

## 9. Client-safe views

`client_expense_view` and `client_budget_view`, both created `with
(security_invoker = true)` — a Postgres 15+ option that makes the view
evaluate RLS using the **calling** role's permissions rather than the
view owner's. Without it, a view's access to its underlying tables is
checked against the view owner (typically a migration/superuser-ish
role), which would leak rows regardless of the view's own `WHERE`
clause — that clause is a belt-and-suspenders filter on top of RLS, not
a substitute for it.

`client_expense_view` exposes: `id, project_id, cost_code_id,
transaction_date, description_client, amount_cents, vendor_name` — never
`description_internal`, `source_type`, `import_batch_id`,
`onedrive_item_id`, `corrects_expense_id`, or any audit metadata.
`client_budget_view` exposes original/approved/revised estimate by cost
code — never `internal_notes`, `fee_eligible`, `status`, committed
costs, forecasts, or suggestions.

## 10. Reversal-integrity constraints

- **Same-scope FK**: `budget_ledger.reverses_entry_id` is constrained
  via `foreign key (reverses_entry_id, cost_code_id) references
  budget_ledger(id, cost_code_id)` — a reversal must reference a row for
  the *same cost code* (transitively the same project). `fee_ledger`
  gets the same treatment scoped by `project_id`.
- **No self-reversal**: `check (reverses_entry_id is null or
  reverses_entry_id <> id)` on both tables.
- **Only correction/reversal rows populate it**: `check (entry_type =
  'correction' or reverses_entry_id is null)` on `budget_ledger`;
  `check (source_type = 'reversal_adjustment' or reverses_entry_id is
  null)` on `fee_ledger`.
- **Partial and multiple reversals**: explicitly **allowed** — a
  decision, not an oversight. What's enforced is that the *sum* of
  reversal amounts against a given original entry can't exceed the
  original's magnitude, **unless** the reversing row is flagged
  `is_adjustment = true` (an intentional, explicit "this goes beyond a
  pure reversal" signal — e.g., correcting a mis-keyed amount to
  something larger than what it replaces). This is a cross-row
  aggregate check, which a `CHECK` constraint can't express, so it's a
  `before insert` trigger (`enforce_reversal_magnitude()`).

Test: SQL suite Section 7 (an over-magnitude pure reversal is rejected;
the identical amount with `is_adjustment = true` succeeds).

## 11. Bootstrap process

**The chicken-and-egg problem this solves:** creating the first
project (and its first project_member) requires someone to already be
recognized as org staff — but a brand-new Supabase auth user has no
`profiles` row, and `profiles`/`orgs` deliberately have no INSERT policy
for `authenticated` at all. Worse, in the first draft of this schema,
staff access was checked *through* `project_members`, which has the
same problem one level down (you can't insert the first
`project_members` row proving you're staff without already being
provable staff).

**The fix has two parts:**
1. **Re-modeled staff access as org-wide, not project-membership-based.**
   `is_org_staff_for_org(org_id)` checks `profiles` directly (role
   admin/staff + matching org_id) — no `project_members` row needed at
   all for staff. This also better matches how a 2-person GC actually
   works (everyone sees every project in the company, not just ones
   they were explicitly invited to). `project_members` is now used
   *exclusively* for client/vendor project-scoping, which is a real
   per-project restriction that should exist.
2. **`bootstrap_organization(org_name, admin_name, admin_email)`** — a
   narrowly-scoped `security definer` RPC. Requires `auth.uid()` to be
   non-null (must already be an authenticated Supabase session) and
   requires the caller to have **no existing profile row** (blocks both
   an anonymous caller and an existing user re-running it or spinning up
   a second org for themselves). It creates the org and the caller's own
   admin profile as one atomic operation. After this runs once, the new
   admin creates projects and adds project_members directly through
   normal RLS — no further bootstrap-style function is needed.

Documented explicitly in the schema comment: this guarantees "can't
self-escalate an existing account" and "can't be re-run," not "anyone
who signs up gets to found a company" — gating general signup behind an
invite code or manual approval is a product decision for later, outside
this schema's scope.

Test: SQL suite Section 1.

## 12. Schema validation constraints

Added: `gmp_amount_cents` required exactly when `gmp_enabled` (both
directions, not just the "absent when disabled" half that existed
before); non-negativity checks on `gmp_amount_cents`,
`deposit_amount_cents`, `committed_costs.amount_cents`,
`forecast_entries.forecast_to_complete_cents`,
`fee_ledger`/`project_fee_rules` fixed amounts; `fee_basis_points`/
`retainage_basis_points` range-checked to 0–10000; `projects(org_id,
project_number)` uniqueness; `currency ~ '^[A-Z]{3}$'` format check;
`budget_suggestions` resolution fields required once `status <>
'pending'`, and `resolved_amount_cents` required once `accepted`; a
partial unique index (`forecast_entries_one_active_per_cost_code`)
guaranteeing at most one active forecast per cost code at the database
level, not by convention; the `expenses_pending_is_internal_only` /
`expenses_void_is_withdrawn` constraints from item 3; the cross-project
composite FKs from item 7.

## Test Results

**TypeScript — actually run, this session, from the clean copy in
`/mnt/user-data/outputs`:**

```
$ npx tsc --noEmit
(clean, no output)

$ npx ts-node test/run.ts
... category rollups, project totals, fee, reconciliation, suggestions ...
run.ts: all assertions passed.

$ npx ts-node test/edge_cases.ts
... 31 named checks ...
edge_cases.ts: all 31 checks passed.
```

**SQL — written, not executed.** See the disclosure at the top of this
document and the instructions inside `tests/sql/package1_tests.sql`.

## Remaining limitations (honest accounting)

- The SQL test suite has not been run against a real Postgres. It is
  internally consistent as far as careful reading can confirm, and one
  real bug was caught and fixed during that reading (an earlier draft
  referenced `NEW.project_id` inside a `DELETE` trigger context, where
  `NEW` is unassigned and Postgres raises `record "new" is not assigned
  yet` — fixed with a `CASE` expression that never evaluates the `NEW`
  branch when `tg_op = 'DELETE'`), but "read carefully" is not "ran
  successfully," and I'd rather say that plainly than let the schema's
  polish imply otherwise.
- `committed_costs.superseded_by_id` and `forecast_entries`'s supersede
  pattern still aren't trigger-enforced against direct amount edits
  (flagged already in round 1) — still true, still deferred to Package
  4.
- Vendor RLS remains entirely unbuilt (no `vendor_assignments` concept
  yet) — `project_members` supports a `'vendor'` `member_role` value
  today only so the enum exists; no policy grants vendors anything.
- No invoice/draw table yet, so `fee_ledger.source_type =
  'invoice_issued'` and the reversal-magnitude guard's interaction with
  a real invoice-issuance flow are both still conceptual until Package
  4.
- Migration rollback/reapply has not been tested, and can't be
  meaningfully tested without a real database either.
