-- =====================================================================
-- Stone Column Portal — Migration 005: commit-time lineage consistency
-- for forecast_entries
--
-- STATUS: written, NOT executed — same disclosure as every other SQL
-- file in this project.
--
-- THE GAP THIS CLOSES:
-- 004's `forecast_entries_lock_superseded_lineage` (BEFORE UPDATE) only
-- acts when `OLD.superseded_at IS NOT NULL` — i.e. it protects an
-- ALREADY-superseded row from being redirected/cleared/retimed. It does
-- nothing when OLD.superseded_at IS NULL (an active row), so a direct
--   UPDATE forecast_entries SET superseded_at = now() WHERE id = <active>;
-- (touching ONLY superseded_at, never superseded_by_id) passes every
-- existing check and COMMITS successfully, leaving the row permanently
-- "half-superseded": superseded_at set, superseded_by_id null forever.
-- A direct INSERT with only one of the two fields set has the same gap.
--
-- THE REQUIRED INVARIANT, enforced by this migration, AT TRANSACTION
-- COMMIT (not necessarily at every intermediate statement — the RPC
-- legitimately needs a mid-transaction window where only superseded_at
-- is set, between its claim step and its link step):
--   (superseded_at IS NULL AND superseded_by_id IS NULL)   -- active
--   OR
--   (superseded_at IS NOT NULL AND superseded_by_id IS NOT NULL)  -- superseded
--
-- WHY A DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER, AND WHY IT
-- RE-QUERIES THE ROW INSTEAD OF TRUSTING ITS OWN NEW/OLD PARAMETERS:
-- A naive version of this trigger that validates NEW.superseded_at/
-- NEW.superseded_by_id directly, deferred to commit, has a real bug:
-- if the SAME row is updated twice before commit (exactly what
-- supersede_forecast() does — once to claim, once to link), Postgres
-- queues a SEPARATE deferred trigger event for EACH update, each
-- carrying the NEW values as they were AT THAT STATEMENT. The event
-- queued by the CLAIM step would still describe the row as
-- superseded_at-set-but-superseded_by_id-null — even though the LINK
-- step, executed later in the same transaction, made the row's actual
-- final stored state fully consistent. If the trigger function trusted
-- its own captured NEW parameter, the stale "claim-step" event would
-- incorrectly fail at commit even though the row's real, final,
-- about-to-be-committed contents are perfectly valid.
--
-- The fix: the trigger function below IGNORES its NEW/OLD parameters
-- for the actual validity check and instead re-SELECTs the row fresh,
-- by id, from the table itself. Every queued firing for that row —
-- however many there are — ends up running the exact same query
-- against the exact same (by-then-final) transaction-local state, so
-- redundant firings are harmless and the decision is always based on
-- what will actually be written to disk, not on a stale intermediate
-- snapshot from an earlier statement in the same transaction.
-- =====================================================================

create or replace function public.check_forecast_lineage_consistency() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid := coalesce(NEW.id, OLD.id);
  v_superseded_at timestamptz;
  v_superseded_by_id uuid;
begin
  -- Deliberately re-SELECT rather than trust NEW — see file header for
  -- why this specific choice matters for a deferred trigger that may
  -- fire more than once for the same row within one transaction.
  select superseded_at, superseded_by_id
    into v_superseded_at, v_superseded_by_id
    from forecast_entries
    where id = v_id;

  if v_superseded_at is null and v_superseded_by_id is not null then
    raise exception
      'forecast_entries % would commit with inconsistent lineage: superseded_by_id is set (%) while superseded_at is null. A forecast must be either fully active (both null) or fully superseded (both set) by the end of the transaction.',
      v_id, v_superseded_by_id;
  end if;

  if v_superseded_at is not null and v_superseded_by_id is null then
    raise exception
      'forecast_entries % would commit permanently half-superseded: superseded_at is set (%) while superseded_by_id is null. A forecast must be either fully active (both null) or fully superseded (both set) by the end of the transaction — this is exactly the bug this constraint exists to prevent.',
      v_id, v_superseded_at;
  end if;

  return null; -- return value is ignored for AFTER-row triggers
end;
$$;

-- Constraint triggers must be AFTER ROW triggers (a hard Postgres
-- requirement for anything DEFERRABLE) — this is why the check can't
-- simply live in the existing BEFORE UPDATE trigger from 004.
create constraint trigger forecast_entries_lineage_consistency_check
  after insert or update on forecast_entries
  deferrable initially deferred
  for each row execute function public.check_forecast_lineage_consistency();

-- NOTE (disclosed limitation, not a bug): this constraint trigger only
-- fires on rows touched by an INSERT or UPDATE from this point forward.
-- It does not retroactively scan pre-existing rows. Not a practical
-- concern pre-production (no live data exists yet), but worth stating
-- plainly rather than implying a full-table backfill check happened.
