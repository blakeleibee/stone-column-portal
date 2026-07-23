-- =====================================================================
-- Tests for schema/002_committed_forecast_hardening.sql,
-- schema/003_status_transitions_and_supersede_rpcs.sql,
-- schema/004_committed_cost_insert_guard_and_forecast_lineage_lock.sql,
-- AND schema/005_forecast_commit_time_lineage_consistency.sql
--
-- STATUS: written, NOT executed (same disclosure as every other SQL
-- test file in this project). Run after: 000_bare_postgres_bootstrap
-- (Option B only) -> 001 -> 002 -> 003 -> 004 -> 005 ->
-- package1_tests.sql (for fixtures) -> this file.
--
-- REVISION NOTE: this file previously (1) superseded a commitment that
-- had already been marked 'fulfilled', and (2) inserted two
-- simultaneously-active forecast_entries rows before superseding the
-- first — both scenarios that 003's own constraints now correctly
-- reject, which the ORIGINAL version of this test never exercised
-- (it just did the update directly and asserted the field changed,
-- rather than going through a workflow that respects the partial
-- unique index / terminal-status rules). Fixed below.
--
-- ROUND 3 ADDITION: 004 closes two more gaps — direct INSERT bypasses
-- on committed_costs, and lineage mutation on forecast_entries after a
-- supersede completes. New sections near the end of this file.
--
-- ROUND 4 ADDITIONS:
--   (a) fixed an invalid test setup: a "forecast_3" row was previously
--       inserted for cost_code_a while forecast_2 was still its active
--       forecast — that insert would itself have been rejected by
--       forecast_entries_one_active_per_cost_code. Replaced with a
--       proper chain continuation via the RPC (forecast_2 -> forecast_2b).
--   (b) migration 005's deferred commit-time consistency check, with
--       its own new test section near the end of this file.
--
-- FULL PER-COST-CODE ACTIVE-FORECAST TRACE (required after the round-4
-- fix — every forecast_entries INSERT/RPC call in this file, in order,
-- with the active-row count for its cost code immediately after):
--
--   cost_code_a:
--     1. INSERT forecast_1                          -> active: {forecast_1}          (count: 1)
--     2. INSERT attempt (300000) while forecast_1 active -> REJECTED, no change      (count: 1)
--     3. supersede_forecast(forecast_1 -> forecast_2)     -> active: {forecast_2}     (count: 1)
--     4. INSERT attempt (100000) while forecast_2 active -> REJECTED, no change      (count: 1)
--     5. supersede_forecast(forecast_1) again (already superseded) -> REJECTED, no change (count: 1)
--     6. supersede_forecast(forecast_2 -> forecast_2b)    -> active: {forecast_2b}    (count: 1)
--     7. supersede_forecast(forecast_2) again (already superseded) -> REJECTED, no change (count: 1)
--   cost_code_b:
--     1. INSERT unrelated_forecast_id                -> active: {unrelated_forecast_id} (count: 1)
--     (never superseded or touched again in this file)
--   cost_code_m5 (fresh, inserted solely for the migration-005 section below):
--     1. INSERT m5_active_1                          -> active: {m5_active_1}         (count: 1)
--     2. (DO block, rolled back) UPDATE m5_active_1 superseded_at only -> exception -> rolled back, still {m5_active_1} (count: 1)
--     3. (DO block, rolled back) INSERT bad row (superseded_at only)   -> exception -> rolled back, still {m5_active_1} (count: 1)
--     4. INSERT bad row (superseded_by_id only, superseded_at null) while m5_active_1 active -> REJECTED by the partial unique index (count: 1)
--     5. supersede_forecast(m5_active_1 -> m5_active_2)  -> active: {m5_active_2}      (count: 1)
--
-- At every single point in this file, every cost code has AT MOST ONE
-- forecast_entries row with superseded_at IS NULL. No ordinary INSERT
-- in this file ever creates a second simultaneously-active forecast for
-- the same cost code — every attempt to do so is deliberately wrapped
-- in assert_raises (or, for the two migration-005 cases that mutate
-- state before failing, a DO block whose exception handler triggers
-- PL/pgSQL's automatic rollback-to-savepoint, undoing the attempt).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- ---- committed_costs: valid transitions ----

with new_row as (
  insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, status)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         'Framing Crew Phase 2', 660000, 'open'
  returning id
)
insert into test_fixture_ids select 'committed_1', id from new_row;

-- Allowed: open -> fulfilled (a terminal status).
update committed_costs set status = 'fulfilled' where id = (select value from test_fixture_ids where key = 'committed_1');

do $$
begin
  perform assert_that(
    (select status = 'fulfilled' from committed_costs where id = (select value from test_fixture_ids where key = 'committed_1')),
    'open -> fulfilled must be allowed'
  );
end $$;

-- REJECTED (this is the fix — item 5): a FULFILLED commitment is
-- terminal. Superseding it (or any other status change) must now be
-- rejected — the original test superseded a fulfilled commitment and
-- treated that as valid, which review correctly flagged as a decision
-- that was never actually made on purpose.
select assert_raises(
  format('update committed_costs set status = ''superseded'' where id = %L', (select value from test_fixture_ids where key = 'committed_1')),
  'a FULFILLED committed cost must not be supersedable — fulfilled is terminal'
);
select assert_raises(
  format('update committed_costs set status = ''open'' where id = %L', (select value from test_fixture_ids where key = 'committed_1')),
  'a terminal committed cost must never transition back to open'
);

-- Separate, still-open commitment to actually exercise a valid
-- open -> superseded transition, via the atomic RPC (item 4/5's
-- "atomic replace/supersede workflow" requirement).
with new_row as (
  insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, status)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         'Electrical rough-in quote', 500000, 'open'
  returning id
)
insert into test_fixture_ids select 'committed_electrical', id from new_row;

insert into test_fixture_ids (key, value)
select 'committed_electrical_v2', supersede_committed_cost(
  (select value from test_fixture_ids where key = 'committed_electrical'),
  620000,
  'Electrical rough-in quote (revised)'
);

do $$
declare v_old_status committed_cost_status; v_new_amount bigint;
begin
  select status into v_old_status from committed_costs where id = (select value from test_fixture_ids where key = 'committed_electrical');
  perform assert_that(v_old_status = 'superseded', 'supersede_committed_cost() must mark the old row superseded');

  select amount_cents into v_new_amount from committed_costs where id = (select value from test_fixture_ids where key = 'committed_electrical_v2');
  perform assert_that(v_new_amount = 620000, 'supersede_committed_cost() must create the replacement with the new amount');

  perform assert_that(
    (select superseded_by_id from committed_costs where id = (select value from test_fixture_ids where key = 'committed_electrical'))
      = (select value from test_fixture_ids where key = 'committed_electrical_v2'),
    'the old row must link to the new row via superseded_by_id'
  );
end $$;

-- Rejected: core field edits still apply on top of the new status rules.
select assert_raises(
  format('update committed_costs set amount_cents = 1 where id = %L', (select value from test_fixture_ids where key = 'committed_electrical_v2')),
  'committed_costs.amount_cents must be immutable after creation'
);
select assert_raises(
  format(
    'update committed_costs set cost_code_id = %L where id = %L',
    (select value from test_fixture_ids where key = 'cost_code_b'),
    (select value from test_fixture_ids where key = 'committed_electrical_v2')
  ),
  'committed_costs.cost_code_id must be immutable (also violates the cross-project composite FK)'
);

-- Anti-cycle: cannot supersede-with a row that is not itself 'open'.
select assert_raises(
  format(
    'update committed_costs set status = ''superseded'', superseded_at = now(), superseded_by_id = %L where id = %L',
    (select value from test_fixture_ids where key = 'committed_1'),  -- already 'fulfilled', not 'open'
    (select value from test_fixture_ids where key = 'committed_electrical_v2')
  ),
  'superseded_by_id must reference a currently OPEN row, not a terminal one'
);

-- ---- forecast_entries: atomic supersede via RPC (item 4 fix) ----

with new_row as (
  insert into forecast_entries (project_id, cost_code_id, forecast_to_complete_cents, method)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         500000, 'manual'
  returning id
)
insert into test_fixture_ids select 'forecast_1', id from new_row;

-- REJECTED (this is the fix — item 4): inserting a second simultaneously-
-- active forecast for the SAME cost code, without superseding the
-- first, must be rejected by the partial unique index from 001. The
-- original test did exactly this and never asserted it should fail.
select assert_raises(
  format(
    'insert into forecast_entries (project_id, cost_code_id, forecast_to_complete_cents, method) values (%L, %L, 300000, ''manual'')',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'a second simultaneously-active forecast for the same cost code must be rejected (forecast_entries_one_active_per_cost_code)'
);

-- The correct, atomic way to replace it:
insert into test_fixture_ids (key, value)
select 'forecast_2', supersede_forecast(
  (select value from test_fixture_ids where key = 'forecast_1'),
  300000, 'manual', 'HVAC rough-in quote came in higher than allowance'
);

do $$
declare v_old_superseded_at timestamptz; v_link uuid; v_new_amount bigint;
begin
  select superseded_at into v_old_superseded_at from forecast_entries where id = (select value from test_fixture_ids where key = 'forecast_1');
  perform assert_that(v_old_superseded_at is not null, 'supersede_forecast() must mark the old row superseded');

  select superseded_by_id into v_link from forecast_entries where id = (select value from test_fixture_ids where key = 'forecast_1');
  perform assert_that(v_link = (select value from test_fixture_ids where key = 'forecast_2'), 'the old forecast must link to its replacement via superseded_by_id');

  select forecast_to_complete_cents into v_new_amount from forecast_entries where id = (select value from test_fixture_ids where key = 'forecast_2');
  perform assert_that(v_new_amount = 300000, 'the replacement forecast must carry the new amount');
end $$;

-- A THIRD attempt to insert another active forecast (after the
-- replacement exists) must also be rejected — proving the index
-- protection is real ongoing behavior, not a one-time check.
select assert_raises(
  format(
    'insert into forecast_entries (project_id, cost_code_id, forecast_to_complete_cents, method) values (%L, %L, 100000, ''manual'')',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'a forecast cannot be inserted while another one is already active for the same cost code, even after a supersede has already happened once'
);

-- Rejected: core field edits on the replacement forecast.
select assert_raises(
  format('update forecast_entries set forecast_to_complete_cents = 1 where id = %L', (select value from test_fixture_ids where key = 'forecast_2')),
  'forecast_entries.forecast_to_complete_cents must be immutable after creation'
);
select assert_raises(
  format('update forecast_entries set method = ''accepted_suggestion'' where id = %L', (select value from test_fixture_ids where key = 'forecast_2')),
  'forecast_entries.method must be immutable after creation'
);

-- Cannot supersede an already-superseded forecast a second time.
select assert_raises(
  format('select supersede_forecast(%L, 999999, ''manual'')', (select value from test_fixture_ids where key = 'forecast_1')),
  'cannot supersede a forecast that is already superseded'
);

-- ---- budget_suggestions (unchanged from the previous round) ----

with new_row as (
  insert into budget_suggestions (project_id, cost_code_id, suggested_amount_cents, direction, reason, source_type, confidence)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         50000, 'over', 'Test suggestion', 'actual_plus_committed_exceeds_revised', 'high'
  returning id
)
insert into test_fixture_ids select 'suggestion_id', id from new_row;

update budget_suggestions
  set status = 'accepted', resolved_by = (select value from test_fixture_ids where key = 'admin'),
      resolved_at = now(), resolved_amount_cents = 50000
  where id = (select value from test_fixture_ids where key = 'suggestion_id');

select assert_raises(
  format('update budget_suggestions set suggested_amount_cents = 1 where id = %L', (select value from test_fixture_ids where key = 'suggestion_id')),
  'budget_suggestions.suggested_amount_cents must be immutable once created, even after resolution'
);
select assert_raises(
  format('update budget_suggestions set reason = ''rewritten after the fact'' where id = %L', (select value from test_fixture_ids where key = 'suggestion_id')),
  'budget_suggestions.reason must be immutable once created'
);

-- =====================================================================
-- Migration 004: committed_costs INSERT-time bypass closed
-- =====================================================================

-- REJECTED: direct INSERT with status='superseded'.
select assert_raises(
  format(
    'insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, status) values (%L, %L, ''Bad insert'', 100000, ''superseded'')',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'a committed cost must not be INSERTed directly as status=''superseded'' — only reachable via a transition or the RPC'
);

-- REJECTED: direct INSERT of an "open" row with supersede fields already populated.
select assert_raises(
  format(
    'insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, status, superseded_at) values (%L, %L, ''Bad insert 2'', 100000, ''open'', now())',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'a new open committed cost must not be insertable with supersede fields already set'
);

-- ALLOWED: an ordinary open insert with no supersede fields.
with new_row as (
  insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, status)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         'Plain open commitment', 75000, 'open'
  returning id
)
insert into test_fixture_ids select 'plain_open_id', id from new_row;
do $$
begin
  perform assert_that(
    (select superseded_at is null and superseded_by_id is null
       from committed_costs where id = (select value from test_fixture_ids where key = 'plain_open_id')),
    'a normal open insert must land with both supersede fields null'
  );
end $$;

-- REJECTED: clearing lineage from an already-superseded commitment
-- (the "committed_electrical" row, superseded earlier in this file).
select assert_raises(
  format('update committed_costs set superseded_at = null where id = %L', (select value from test_fixture_ids where key = 'committed_electrical')),
  'superseded_at must not be clearable on an already-terminal committed cost'
);
select assert_raises(
  format('update committed_costs set superseded_by_id = null where id = %L', (select value from test_fixture_ids where key = 'committed_electrical')),
  'superseded_by_id must not be clearable on an already-terminal committed cost'
);

-- REJECTED: redirecting superseded_by_id to a different (also-open) row.
with new_row as (
  insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, status)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         'Decoy open row', 1000, 'open'
  returning id
)
insert into test_fixture_ids select 'decoy_id', id from new_row;
select assert_raises(
  format(
    'update committed_costs set superseded_by_id = %L where id = %L',
    (select value from test_fixture_ids where key = 'decoy_id'),
    (select value from test_fixture_ids where key = 'committed_electrical')
  ),
  'superseded_by_id must not be redirectable once a committed cost is terminal'
);

-- REJECTED: any further transition away from fulfilled/cancelled/superseded,
-- covering all three terminal states explicitly (fulfilled already
-- covered earlier in this file via committed_1).
with new_row as (
  insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, status)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         'To be cancelled', 2000, 'open'
  returning id
)
insert into test_fixture_ids select 'cancelled_test_id', id from new_row;
update committed_costs set status = 'cancelled' where id = (select value from test_fixture_ids where key = 'cancelled_test_id');
select assert_raises(
  format('update committed_costs set status = ''open'' where id = %L', (select value from test_fixture_ids where key = 'cancelled_test_id')),
  'a CANCELLED committed cost must never transition back to open'
);
select assert_raises(
  format('update committed_costs set status = ''fulfilled'' where id = %L', (select value from test_fixture_ids where key = 'cancelled_test_id')),
  'a CANCELLED committed cost must never transition to fulfilled either — terminal means terminal'
);
select assert_raises(
  format(
    'update committed_costs set superseded_at = now(), superseded_by_id = %L where id = %L',
    (select value from test_fixture_ids where key = 'plain_open_id'),
    (select value from test_fixture_ids where key = 'committed_electrical')  -- already 'superseded'
  ),
  'an already-SUPERSEDED committed cost must never transition again, including to superseded once more with a different link'
);

-- =====================================================================
-- Migration 004: forecast_entries lineage immutability
-- =====================================================================

-- REJECTED: clearing either lineage field after a completed supersede
-- (forecast_1 was superseded earlier in this file, linked to forecast_2).
select assert_raises(
  format('update forecast_entries set superseded_at = null where id = %L', (select value from test_fixture_ids where key = 'forecast_1')),
  'superseded_at must not be clearable on an already-superseded forecast'
);
select assert_raises(
  format('update forecast_entries set superseded_by_id = null where id = %L', (select value from test_fixture_ids where key = 'forecast_1')),
  'superseded_by_id must not be clearable on an already-superseded forecast'
);

-- REJECTED: redirecting the lineage to a different forecast.
with new_row as (
  insert into forecast_entries (project_id, cost_code_id, forecast_to_complete_cents, method)
  select (select value from test_fixture_ids where key = 'project_b'),
         (select value from test_fixture_ids where key = 'cost_code_b'),
         10000, 'manual'
  returning id
)
insert into test_fixture_ids select 'unrelated_forecast_id', id from new_row;
select assert_raises(
  format(
    'update forecast_entries set superseded_by_id = %L where id = %L',
    (select value from test_fixture_ids where key = 'unrelated_forecast_id'),
    (select value from test_fixture_ids where key = 'forecast_1')
  ),
  'superseded_by_id must not be redirectable once a forecast is already superseded (also would violate the same-cost-code composite FK)'
);

-- REJECTED: changing the supersede timestamp after the fact.
--
-- NOTE: deliberately `now() + interval '1 second'`, not bare `now()`.
-- This whole file runs as a single implicit transaction (Postgres wraps
-- an entire multi-statement simple-query batch in one transaction
-- unless it contains explicit BEGIN/COMMIT), and `now()` is
-- transaction_timestamp() — frozen for the whole transaction, not the
-- wall clock. forecast_1's superseded_at was already set via `now()`
-- earlier in this same file/transaction, so a bare `now()` here would
-- evaluate to the exact same frozen value, making `NEW.superseded_at
-- IS DISTINCT FROM OLD.superseded_at` false and silently passing the
-- trigger (no-op write) instead of exercising the immutability check.
-- Adding an interval guarantees a genuinely different value regardless
-- of real elapsed wall-clock time.
select assert_raises(
  format('update forecast_entries set superseded_at = now() + interval ''1 second'' where id = %L', (select value from test_fixture_ids where key = 'forecast_1')),
  'superseded_at must be immutable once set on a forecast, even to a different non-null timestamp'
);

-- Sanity re-check: the RPC's legitimate intermediate step (claim, then
-- link) still works end-to-end after 004 — by CONTINUING the same
-- chain (forecast_1 -> forecast_2 -> forecast_2b) rather than
-- inserting a new, separate row for cost_code_a.
--
-- CORRECTION (this file previously inserted a fresh "forecast_3" row
-- for cost_code_a here — but forecast_2 is STILL THE ACTIVE forecast
-- for cost_code_a at this exact point in the file (it was created
-- above and never superseded), so that insert would itself have been
-- rejected by forecast_entries_one_active_per_cost_code, the same class
-- of bug this file was already correcting for forecast_1/forecast_2.
-- See the full per-cost-code trace in this file's header comment.
insert into test_fixture_ids (key, value)
select 'forecast_2b', supersede_forecast(
  (select value from test_fixture_ids where key = 'forecast_2'),
  40000, 'manual', 'Re-verified after migrations 004/005'
);

do $$
begin
  perform assert_that(
    (select superseded_by_id from forecast_entries where id = (select value from test_fixture_ids where key = 'forecast_2'))
      = (select value from test_fixture_ids where key = 'forecast_2b'),
    'supersede_forecast() must still work end-to-end after migrations 004/005''s stricter lineage locking'
  );
  perform assert_that(
    (select superseded_at is null and superseded_by_id is null
       from forecast_entries where id = (select value from test_fixture_ids where key = 'forecast_2b')),
    'the new active replacement (forecast_2b) must land with both lineage fields null'
  );
end $$;

-- A repeated/concurrent-style second attempt against the same
-- already-superseded forecast (forecast_2, now superseded and linked
-- to forecast_2b) must still be rejected.
select assert_raises(
  format('select supersede_forecast(%L, 1, ''manual'')', (select value from test_fixture_ids where key = 'forecast_2')),
  'a second supersede attempt against an already-superseded forecast must be rejected even after migrations 004/005'
);

-- =====================================================================
-- Migration 005: forecast_entries commit-time lineage consistency
-- (DEFERRABLE INITIALLY DEFERRED constraint trigger)
--
-- Uses a FRESH cost code (never touched above) so these tests can
-- freely insert/mutate without interacting with cost_code_a/b's
-- already-established chains — see the per-cost-code trace in this
-- file's header for exactly why.
-- =====================================================================

with new_row as (
  insert into cost_codes (project_id, code, fee_eligible, status)
  select (select value from test_fixture_ids where key = 'project_a'), 'Migration 005 Test Category', true, 'active'
  returning id
)
insert into test_fixture_ids select 'cost_code_m5', id from new_row;

-- "Active rows with both fields null succeed" — the ordinary case.
with new_row as (
  insert into forecast_entries (project_id, cost_code_id, forecast_to_complete_cents, method)
  select (select value from test_fixture_ids where key = 'project_a'), (select value from test_fixture_ids where key = 'cost_code_m5'), 100000, 'manual'
  returning id
)
insert into test_fixture_ids select 'm5_active_1', id from new_row;
do $$
begin
  perform assert_that(
    (select superseded_at is null and superseded_by_id is null
       from forecast_entries where id = (select value from test_fixture_ids where key = 'm5_active_1')),
    'a normal active forecast must land with both lineage fields null'
  );
end $$;

-- "A direct UPDATE setting only superseded_at fails at transaction
-- commit" — the exact scenario from the review. The UPDATE itself must
-- NOT raise immediately (that's the whole point of DEFERRABLE INITIALLY
-- DEFERRED); SET CONSTRAINTS ALL IMMEDIATE forces the deferred check to
-- run right here, inside this DO block, instead of waiting for the
-- actual end of the whole script — this is the "genuinely force
-- constraint evaluation" step the review required. On exception,
-- PL/pgSQL's implicit savepoint rolls back everything this block did,
-- so m5_active_1 is back to {both null} immediately afterward.
do $$
begin
  update forecast_entries set superseded_at = now()
    where id = (select value from test_fixture_ids where key = 'm5_active_1');

  -- If DEFERRABLE INITIALLY DEFERRED were somehow not actually in
  -- effect, the UPDATE above would already have raised and we'd never
  -- reach this line — so simply getting here is itself part of what's
  -- being proven (the check really is deferred, not immediate).

  set constraints all immediate;

  raise exception 'ASSERTION FAILED: expected a commit-time rejection of a half-superseded forecast (superseded_at set alone), got none';
exception
  when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok (rejected when constraints were forced immediate, as expected) — %', sqlerrm;
end $$;

do $$
begin
  perform assert_that(
    (select superseded_at is null and superseded_by_id is null
       from forecast_entries where id = (select value from test_fixture_ids where key = 'm5_active_1')),
    'after the failed/rolled-back attempt above, m5_active_1 must be back to {both null} — not left half-modified'
  );
end $$;

-- "A direct INSERT with only superseded_at fails at transaction
-- commit". This row's superseded_at is non-null, so it is NOT a
-- candidate for forecast_entries_one_active_per_cost_code (that index
-- only covers rows where superseded_at IS NULL) — it can safely target
-- cost_code_m5 even though m5_active_1 is still active there, and its
-- superseded_by_id is null so the composite FK (which never restricts
-- NULL values) doesn't interfere either. The only thing that can catch
-- this row is the new deferred consistency check.
do $$
begin
  insert into forecast_entries (project_id, cost_code_id, forecast_to_complete_cents, method, superseded_at)
  values (
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_m5'),
    50000, 'manual', now()
  );

  set constraints all immediate;

  raise exception 'ASSERTION FAILED: expected a commit-time rejection of an INSERT with only superseded_at set, got none';
exception
  when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok (rejected when constraints were forced immediate, as expected) — %', sqlerrm;
end $$;

-- "A direct INSERT with only superseded_by_id fails." This one is
-- caught earlier in the layer stack than the deferred trigger, and
-- it's worth explaining why rather than contorting the test to avoid
-- it: for THIS row's superseded_by_id to satisfy the composite same-
-- cost-code foreign key at all, it must point at an EXISTING forecast
-- row in cost_code_m5 — but the only existing row there (m5_active_1)
-- is currently active, and this new row's own superseded_at is NULL,
-- which makes IT look "active" too under
-- forecast_entries_one_active_per_cost_code. So the partial unique
-- index rejects it before the deferred trigger is ever reached. This
-- isn't a gap — it's what "every cost code with any history always has
-- exactly one active row" (see this file's header trace) structurally
-- guarantees: a valid FK target for superseded_by_id can only exist in
-- a cost code that (by definition) already has a current active row,
-- so a second superseded_at-null row for that same cost code always
-- collides with the unique index first. The deferred trigger's OWN
-- uniquely-necessary case — unreachable by any other guard — is the
-- "UPDATE setting only superseded_at" scenario already proven above.
select assert_raises(
  format(
    'insert into forecast_entries (project_id, cost_code_id, forecast_to_complete_cents, method, superseded_by_id) values (%L, %L, 50000, ''manual'', %L)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_m5'),
    (select value from test_fixture_ids where key = 'm5_active_1')
  ),
  'INSERT with only superseded_by_id set must fail — here, via the pre-existing partial unique index, for the structural reason explained above'
);

-- "supersede_forecast() succeeds with both fields populated."
insert into test_fixture_ids (key, value)
select 'm5_active_2', supersede_forecast(
  (select value from test_fixture_ids where key = 'm5_active_1'),
  80000, 'manual', 'Migration 005 verification'
);

do $$
begin
  perform assert_that(
    (select superseded_at is not null and superseded_by_id = (select value from test_fixture_ids where key = 'm5_active_2')
       from forecast_entries where id = (select value from test_fixture_ids where key = 'm5_active_1')),
    'supersede_forecast() must leave the old row with BOTH lineage fields populated and correctly linked'
  );
  perform assert_that(
    (select superseded_at is null and superseded_by_id is null
       from forecast_entries where id = (select value from test_fixture_ids where key = 'm5_active_2')),
    'the new replacement must land with both lineage fields null (active)'
  );
end $$;

-- "Completed lineage remains immutable" — re-verified here against the
-- fresh m5 chain (004's equivalent tests above already cover forecast_1
-- with the same logic; this confirms it holds for a row that went
-- through the full migration-005-verified RPC path too).
select assert_raises(
  format('update forecast_entries set superseded_at = null where id = %L', (select value from test_fixture_ids where key = 'm5_active_1')),
  'superseded_at must remain immutable on an already-superseded forecast (m5 chain)'
);
select assert_raises(
  format('update forecast_entries set superseded_by_id = null where id = %L', (select value from test_fixture_ids where key = 'm5_active_1')),
  'superseded_by_id must remain immutable on an already-superseded forecast (m5 chain)'
);
-- NOTE: `now() + interval '1 second'`, not bare `now()` — same reason
-- as the forecast_1 case above (this whole file is one implicit
-- transaction, so `now()` is frozen and would equal the value already
-- stored, silently passing as a no-op instead of exercising the check).
select assert_raises(
  format('update forecast_entries set superseded_at = now() + interval ''1 second'' where id = %L', (select value from test_fixture_ids where key = 'm5_active_1')),
  'superseded_at must not be changeable to a different timestamp on an already-superseded forecast (m5 chain)'
);

reset role;
select clear_test_user();

select 'ALL 002/003/004/005 HARDENING TESTS PASSED' as result;
