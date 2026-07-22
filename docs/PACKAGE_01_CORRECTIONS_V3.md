# Package 1 — Corrections, Round 3 (self-verification of Round 2)

Round 2 (`PACKAGE_01_CORRECTIONS_V2.md`) was already thorough and mostly
honest about its own limits. This round is a careful, line-by-line
re-read of that work — checking it the way the independent reviewer
checked the original — and closing four gaps it found, one of which is
a genuine logic bug that a real Postgres run would have caught (and
that I should have caught by reading more carefully the first time).

## What was found

### A real bug in the reversal-magnitude trigger

`enforce_reversal_magnitude()` computed `v_existing_reversals` by
summing rows **already in the table** with `reverses_entry_id = NEW.
reverses_entry_id` — but during a `BEFORE INSERT` trigger, a `SELECT`
against the same table never sees the row currently being inserted (it
doesn't exist yet as far as any query is concerned). That means the
magnitude check compared *prior* reversals against the original amount,
**never including the very reversal being inserted**. Concretely: a
lone `-150000` reversal against a `+100000` original would have sailed
through untouched (`v_existing_reversals = 0`, and `0 > 100000` is
false) — exactly the scenario `tests/sql/package1_tests.sql` Section 7
is supposed to catch. The check would only have started working from
the *second* over-magnitude reversal onward, one insert too late.

**Fixed** by explicitly adding the new row's own amount
(`v_new_amount`, read via the correct column name per table —
`amount_cents` for `budget_ledger`, `fee_amount_cents` for `fee_ledger`)
into the total before comparing against the original's magnitude.

### A missing check in the same trigger: direction, not just magnitude

Separately, the original version never verified a "reversal" actually
moves the *opposite* direction of what it's reversing. `original =
+1000, reversal = +500` would have passed the magnitude check
(`|500| <= |1000|`) while not reversing anything — just compounding in
the same direction. Added an explicit sign check: for a non-adjustment
row, the new amount must have the opposite sign of the entry it
reverses (skipped entirely when `is_adjustment = true`, which is the
documented escape hatch for an intentional same-direction change).

Both fixes are in the same function in
`schema/001_core_financial.sql` — see the two `SELF-REVIEW CATCH`
comments inline.

### Item 13, re-read literally: two roles never tested, two deliverables missing

Re-reading item 13's exact list — "RLS tests for admin, staff, Client
A, Client B, Vendor A and anonymous access" plus "package.json and
lockfile" — against what Round 2 actually shipped:

- **`staff` was never tested as distinct from `admin`.** Both roles
  pass `is_org_staff_for_org` (org-wide operational access), but only
  `admin` passes `is_org_admin_for_org` (used for the profile-update
  policy). Without a dedicated test, a regression that accidentally let
  staff update other users' profiles would go unnoticed. **Added**:
  Section 3b — staff sees both projects (parity with admin), but is
  rejected when attempting to update another user's profile.
- **Vendor A was never tested at all.** Correct behavior today is "sees
  nothing except their own `project_members` row" (no vendor policy
  exists yet — vendor portal is Package 8), but *that itself* is worth
  a regression test: it's the baseline Package 8 needs to build against,
  and its own future test should be what makes these assertions
  meaningfully change. **Added**: Section 3c.
- **`package.json`/lockfile were entirely absent.** **Added**:
  `packages/01-financial-engine/package.json`, pinned to the exact
  `typescript`/`ts-node` versions verified installed and working in
  this sandbox. **No `package-lock.json`** — see
  `NOTE_ON_LOCKFILE.md` for why fabricating one with invented integrity
  hashes would be worse than omitting it, and how to generate a real
  one.
- **Migration rollback/reapply**: Round 2 said this "requires a real
  database to mean anything" and stopped there — true, but the exact
  same reasoning applied to every other SQL test in this project and
  didn't stop those from being written and clearly labeled unexecuted.
  Inconsistent to carve out an exception here. **Added**:
  `schema/001_core_financial_down.sql` (drops everything 001 creates,
  reverse dependency order) plus a documented `up → down → up` test
  procedure.

### A real environment-ordering bug discovered while writing the rollback test

While writing the reapply instructions, re-reading `001_core_financial
.sql`'s own policies (`create policy ... to authenticated`) surfaced
something Round 2 missed: **Postgres validates that the `authenticated`
role exists at the moment `CREATE POLICY` runs** — this is checked
immediately, unlike a function body's forward table references (which
aren't validated until first execution, and which Round 2's own
comments correctly reasoned through for a *different* case). On bare
Postgres (Option B), the `authenticated`/`anon` roles don't exist by
default, so **001 itself would fail immediately** unless something
creates those roles *first*. Round 2's test file created these roles,
but inside `package1_tests.sql`, which runs *after* 001 — too late.

**Fixed** by splitting environment setup into a new file,
`tests/sql/000_bare_postgres_bootstrap.sql`, which must run *before*
001: creates the `authenticated`/`anon` roles, sets up `ALTER DEFAULT
PRIVILEGES` (not a plain `GRANT ... ON ALL TABLES`, since the tables
don't exist yet at this point — default privileges apply automatically
to tables 001 is about to create, mirroring how Supabase actually
provisions a fresh project: baseline access first, then the migration's
own `REVOKE`s take effect on top and are authoritative), and the
`auth.uid()`/`auth.users` stub. `package1_tests.sql` no longer contains
any role/grant/auth-stub setup — only test-logic helpers.

(This also means Round 2's claim "one real bug was caught and fixed
during \[careful reading]" underclaimed slightly in one direction —
there were two, plus this ordering issue, all found only on this
second pass. Careful reading catches real bugs; it doesn't catch
everything. That's exactly why "written but not executed" is the
correct claim to keep making, not "reasoned through, therefore fine.")

## What was NOT changed

Everything else in Round 2 held up under this re-read: the
financial/publication status split, the expense state machine, the
delete-prevention triggers, the composite cross-project foreign keys,
the `SECURITY DEFINER` hardening, the client-safe views, the bootstrap
RPC, and the schema validation constraints all check out as internally
consistent. TypeScript required zero changes this round — none of the
four gaps above touch the engine.

## Test Results

**TypeScript — actually re-run, this session:**

```
$ npm run typecheck   # tsc --noEmit
(clean, no output)

$ npm test   # ts-node test/run.ts && ts-node test/edge_cases.ts
run.ts: all assertions passed.
edge_cases.ts: all 31 checks passed.
```

**SQL — still written, still not executed.** `tests/sql/
000_bare_postgres_bootstrap.sql` and `tests/sql/package1_tests.sql`
(now with staff + Vendor A sections) and `schema/
001_core_financial_down.sql` are all new or updated this round and
have the same status as before: reasoned through carefully (twice now),
never run. Please run them and report back — including, ideally, the
rollback/reapply cycle, which has literally never been attempted
against a real engine.

## Remaining limitations (honest accounting, carried forward + updated)

- SQL/RLS still not executed against a real Postgres — this is the
  single most important caveat in this entire package and bears
  repeating a third time.
- `committed_costs.superseded_by_id` and `forecast_entries`'s supersede
  pattern still aren't trigger-enforced against direct amount edits —
  still deferred to Package 4.
- Vendor RLS remains entirely unbuilt by design (Package 8); Section 3c
  now at least pins down and tests today's "sees nothing" baseline.
- No invoice/draw table yet — `fee_ledger.source_type = 'invoice_issued'`
  and the reversal-magnitude guard's interaction with a real
  invoice-issuance flow are still conceptual until Package 4.
- The rollback/reapply test procedure is documented and the down-
  migration is written, but — like everything else SQL — has never
  actually been run. A real run might surface a dependency-order
  mistake in `001_core_financial_down.sql` itself (e.g. a type dropped
  before every table referencing it is gone) that careful reading
  didn't catch, the same way the reversal-magnitude bug wasn't caught
  until this pass either.
- No lockfile — see `packages/01-financial-engine/NOTE_ON_LOCKFILE.md`.
