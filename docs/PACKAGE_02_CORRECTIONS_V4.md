# Package 2 — Corrections, Round 4 (two remaining SQL issues)

Scope of this round, per instruction: SQL only. No TypeScript/UI files
were touched — confirmed by checking modification timestamps on every
`.ts`/`.tsx`/`.json` file in both packages before starting, and by
rerunning the full TS/UI suite unchanged at the end (results below).

## 1. Commit-time lineage invariant for `forecast_entries`

### The gap

`004_committed_cost_insert_guard_and_forecast_lineage_lock.sql`'s
`forecast_entries_lock_superseded_lineage` trigger only acts when
`OLD.superseded_at IS NOT NULL` — it protects an *already*-superseded
row from being redirected, cleared, or retimed. It does nothing when
`OLD.superseded_at IS NULL` (an active row), so:

```sql
UPDATE forecast_entries SET superseded_at = now() WHERE id = <active>;
```

passes every existing check and commits, leaving the row permanently
"half-superseded" — exactly the bug you identified.

### The fix

`schema/005_forecast_commit_time_lineage_consistency.sql` — a new
forward migration (004 was already delivered/reviewed) adding:

```sql
create constraint trigger forecast_entries_lineage_consistency_check
  after insert or update on forecast_entries
  deferrable initially deferred
  for each row execute function public.check_forecast_lineage_consistency();
```

**The invariant it enforces, at commit time:**
```
(superseded_at IS NULL AND superseded_by_id IS NULL)      -- active
OR
(superseded_at IS NOT NULL AND superseded_by_id IS NOT NULL)  -- superseded
```

**A subtlety I want to be explicit about, because it's the kind of
thing that looks right and isn't:** a naive version of this trigger
would validate `NEW.superseded_at`/`NEW.superseded_by_id` directly.
That's wrong. `supersede_forecast()` updates the *same row* twice
before commit (claim, then link). Postgres queues a **separate**
deferred trigger event for each UPDATE, and each event carries the
`NEW` values as they were *at that specific statement* — not
re-fetched later. So the event queued by the claim step would still
show `superseded_at` set and `superseded_by_id` null, even though the
link step (later in the same transaction) made the row's real, final,
about-to-be-committed state fully consistent. A trigger that trusted
its own `NEW` parameter would fail on the RPC's own legitimate,
successful operation.

The fix: the trigger function **ignores `NEW`/`OLD` for the actual
check** and re-`SELECT`s the row fresh, by id, from the table. However
many times it fires for a given row, every firing runs the same query
against the same (by-then-final) transaction-local state — so
redundant firings are harmless, and the decision is always based on
what will actually land on disk, never on a stale intermediate
snapshot from an earlier statement. This is documented at length in
the migration file's header comment, specifically so a future reader
doesn't "simplify" it back into the naive, broken version.

### Why a constraint trigger, not just "wait until commit" some other way

Constraint triggers are a real, first-class Postgres mechanism for
exactly this: `DEFERRABLE INITIALLY DEFERRED` triggers run at
transaction commit by default, or on demand via `SET CONSTRAINTS ...
IMMEDIATE`, and they *must* be `AFTER ROW` triggers (a hard Postgres
requirement) — which is also why this couldn't simply be folded into
004's existing `BEFORE UPDATE` trigger.

### Tests added — and an honest note on how they had to be written

Your instruction was explicit: *"Do not use an assert helper that
hides transaction-end behavior incorrectly... must actually force
constraint evaluation using SET CONSTRAINTS ALL IMMEDIATE or an
equivalent transaction boundary."* You were right to flag this — the
existing generic `assert_raises(sql_string, message)` helper executes
one dynamic SQL string and catches exceptions raised *during* that
execution. A deferred constraint violation is, by design, **not**
raised during the triggering statement — it's raised later, at commit
(or when forced). Wrapping a single statement in `assert_raises` would
silently prove nothing about deferred behavior; it would just show the
statement itself didn't raise, which is expected and uninformative.

So the deferred-specific tests use dedicated `DO $$ ... $$` blocks
instead, each following the same explicit pattern:
1. Perform the mutation (UPDATE or INSERT).
2. Assert, implicitly, that it did **not** raise yet (if it had, we'd
   never reach the next line) — this is itself part of what's being
   proven: the check really is deferred, not immediate.
3. `SET CONSTRAINTS ALL IMMEDIATE` — forces the deferred check to run
   right there, inside the block.
4. If no exception occurred by that point, the block raises its own
   `ASSERTION FAILED` (the test failed to catch what it should have).
5. The `EXCEPTION WHEN OTHERS` handler catches whatever the deferred
   trigger raised, confirms it isn't our own `ASSERTION FAILED`, and
   logs success — and PL/pgSQL's implicit savepoint-on-exception
   automatically rolls back every change made inside the block, so the
   test row is back to its pre-test state afterward (verified by a
   follow-up `assert_that`).

**Tests added** (in `tests/sql/committed_forecast_hardening_tests.sql`,
new "Migration 005" section), against a fresh, dedicated cost code
(`cost_code_m5`) added inline in the test file so these don't interact
with the already-established `cost_code_a`/`cost_code_b` chains:

- Active row lands with both fields null (ordinary case)
- Direct `UPDATE` setting only `superseded_at` → does not raise
  immediately, **does** raise when forced to commit-check, row rolls
  back to clean state afterward
- Direct `INSERT` with only `superseded_at` set → same pattern, same
  result (this row isn't a candidate for the one-active-per-cost-code
  index at all, since its `superseded_at` isn't null — so this is a
  clean, isolated test of the deferred check specifically)
- Direct `INSERT` with only `superseded_by_id` set → **also fails, but
  I want to be transparent about which layer actually catches it and
  why**, rather than contorting the test to force a specific mechanism:
  for this row's `superseded_by_id` to satisfy the composite same-
  cost-code FK at all, it must reference an existing row in that cost
  code — but any cost code with existing history always has exactly
  one current active row (by construction — see the full trace below),
  so this new row (itself `superseded_at`-null, i.e. "active"-looking)
  collides with the *pre-existing* partial unique index before the
  deferred trigger is ever reached. This isn't a gap in coverage; it's
  what the schema's other layers already guarantee. The deferred
  trigger's own uniquely-necessary case — unreachable by any other
  guard — is the "UPDATE setting only `superseded_at`" scenario above,
  and that one is tested directly.
- `supersede_forecast()` succeeds, leaving the old row with both
  fields populated and correctly linked, and the new row active
- Completed lineage remains immutable (redirect/clear/retime, all
  rejected) — re-verified against the fresh `cost_code_m5` chain, not
  just assumed carried over from the `cost_code_a` tests above

## 2. The invalid `forecast_3` test setup

### The bug, confirmed

You were right. At the point in the file where the old `forecast_3`
row was inserted for `cost_code_a`, `forecast_2` was still that cost
code's active forecast — never superseded. That `INSERT` would itself
have been rejected by `forecast_entries_one_active_per_cost_code`,
making the whole downstream "does the RPC still work after 004"
assertion meaningless (it would never have run against real committed
state).

### The fix

Per your explicit instruction not to directly edit supersede fields
just to prepare the test, I used the first option you offered:
**continue the existing chain through the RPC** instead of inserting a
competing row. `forecast_2` is now properly superseded via
`supersede_forecast()`, creating `forecast_2b` — the chain for
`cost_code_a` is now `forecast_1 → forecast_2 → forecast_2b`, and at no
point does that cost code ever have more than one active row.

### Full per-cost-code trace (as required)

Added directly to the test file's header comment — reproduced here:

```
cost_code_a:
  1. INSERT forecast_1                          -> active: {forecast_1}          (count: 1)
  2. INSERT attempt (300000) while forecast_1 active -> REJECTED, no change      (count: 1)
  3. supersede_forecast(forecast_1 -> forecast_2)     -> active: {forecast_2}     (count: 1)
  4. INSERT attempt (100000) while forecast_2 active -> REJECTED, no change      (count: 1)
  5. supersede_forecast(forecast_1) again (already superseded) -> REJECTED, no change (count: 1)
  6. supersede_forecast(forecast_2 -> forecast_2b)    -> active: {forecast_2b}    (count: 1)
  7. supersede_forecast(forecast_2) again (already superseded) -> REJECTED, no change (count: 1)
cost_code_b:
  1. INSERT unrelated_forecast_id                -> active: {unrelated_forecast_id} (count: 1)
  (never superseded or touched again)
cost_code_m5 (fresh, migration-005 section):
  1. INSERT m5_active_1                          -> active: {m5_active_1}         (count: 1)
  2. (DO block, rolled back) UPDATE superseded_at only -> rolled back, still {m5_active_1} (count: 1)
  3. (DO block, rolled back) INSERT bad row (superseded_at only) -> rolled back, still {m5_active_1} (count: 1)
  4. INSERT bad row (superseded_by_id only) while m5_active_1 active -> REJECTED (count: 1)
  5. supersede_forecast(m5_active_1 -> m5_active_2)  -> active: {m5_active_2}      (count: 1)
```

At every point in the file, every cost code has at most one
`forecast_entries` row with `superseded_at IS NULL`.

## Files changed this round

- `schema/005_forecast_commit_time_lineage_consistency.sql` (new)
- `schema/005_forecast_commit_time_lineage_consistency_down.sql` (new)
- `tests/sql/committed_forecast_hardening_tests.sql` (forecast_3 bug
  fixed; new migration-005 test section; full per-cost-code trace
  added to the header comment)
- `docs/CHECKLIST.md` (migration 005 entry added)
- `docs/PACKAGE_02_CORRECTIONS_V4.md` (this file)

**Not touched:** anything under `packages/01-financial-engine/src`,
`packages/01-financial-engine/test`, `packages/02-app-shell/src`,
`packages/02-app-shell/test`, or either package's `package.json`/
`tsconfig.json` — confirmed by checking file modification timestamps
before making any change this round.

## Exact TypeScript/UI test results (rerun this round, unchanged)

```
$ cd packages/01-financial-engine && npm run typecheck
(clean, no output)

$ npm test
run.ts: all assertions passed.
edge_cases.ts: all 31 checks passed.

$ cd packages/02-app-shell && npx tsx test/render_smoke.tsx
render_smoke.tsx: all 47 checks passed.
```

`npx tsc --noEmit` in this sandbox still reports the same disclosed gap
as last round (missing `@types/react`/`@types/react-dom`, no network
access here to fetch them) — unchanged, and consistent with your report
that it passes in an environment where those are actually installed.

## SQL — still labeled exactly as what it is

Every file under `schema/` and `tests/sql/`, including the two new ones
this round, is **written, reasoned through carefully, and has never
been executed against a real PostgreSQL instance** — no local Postgres,
Docker, or network access exists in this sandbox to change that. Please
run the full migration sequence (001 → 002 → 003 → 004 → 005, plus
`000_bare_postgres_bootstrap.sql` first if using bare Postgres) and the
test files, and treat that as the actual verification.

## Remaining limitations

- All SQL (001–005) is designed-but-unverified against a real Postgres
  — the load-bearing caveat, unchanged.
- The `SET CONSTRAINTS ALL IMMEDIATE` / constraint-trigger test pattern
  is standard, documented Postgres usage, but — like everything else in
  this file — has not been executed, and is the one part of this
  file where I'd most want independent confirmation the exact syntax
  behaves as reasoned, given how much of this round's fix hinges on it.
- All previously-disclosed Package 2 limitations (no headless browser/
  jsdom, `SupabaseFinancialRepository` stub, "Projected Final" product
  question, no router, icon placeholder, cross-package import
  ergonomics, no real lockfile) are unchanged and still apply.
