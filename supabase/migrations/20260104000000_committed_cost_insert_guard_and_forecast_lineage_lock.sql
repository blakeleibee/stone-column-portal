-- =====================================================================
-- Stone Column Portal — Migration 004: close remaining integrity gaps
-- on committed_costs (INSERT-time bypass) and forecast_entries
-- (lineage mutation after supersede)
--
-- STATUS: written, NOT executed — same disclosure as every other SQL
-- file in this project. See tests/sql/committed_forecast_hardening_tests.sql
-- (extended this round) for the scenarios this is meant to satisfy.
--
-- WHY A NEW MIGRATION: 003 was already delivered and reviewed. This
-- adds a broader trigger definition (BEFORE INSERT OR UPDATE, replacing
-- 003's BEFORE UPDATE-only version) and one new trigger, rather than
-- editing 003's file in place.
-- =====================================================================

-- ---------------------------------------------------------------------
-- committed_costs: close the INSERT-time bypass.
--
-- 003's enforce_committed_cost_status_transition() only ran on UPDATE.
-- A direct INSERT with status='superseded' (or status='open' plus
-- supersede fields already populated) skipped it entirely. Replacing
-- the trigger function to branch on TG_OP, and re-creating the trigger
-- to fire on INSERT as well as UPDATE.
-- ---------------------------------------------------------------------

create or replace function public.enforce_committed_cost_status_transition() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if NEW.status <> 'open' then
      raise exception
        'A new committed cost must be inserted with status=''open'' (got %). Terminal statuses are only reached via a subsequent transition or the supersede_committed_cost() RPC.',
        NEW.status;
    end if;
    if NEW.superseded_at is not null or NEW.superseded_by_id is not null then
      raise exception
        'A new committed cost must not be inserted with supersede fields already set (superseded_at/superseded_by_id must both be null on insert).';
    end if;
    return NEW;
  end if;

  -- UPDATE path — unchanged from 003.
  if NEW.status is distinct from OLD.status then
    if OLD.status <> 'open' then
      raise exception
        'Committed cost % is in a terminal status (%) and cannot transition to % — terminal statuses never return to open or move again.',
        OLD.id, OLD.status, NEW.status;
    end if;
    if NEW.status not in ('fulfilled', 'cancelled', 'superseded') then
      raise exception 'Invalid committed cost status transition: % -> % (id=%)', OLD.status, NEW.status, OLD.id;
    end if;
  end if;

  if NEW.status = 'superseded' then
    if NEW.superseded_at is null or NEW.superseded_by_id is null then
      raise exception 'A superseded committed cost must have both superseded_at and superseded_by_id set (id=%)', NEW.id;
    end if;
    if exists (select 1 from committed_costs where id = NEW.superseded_by_id and status <> 'open') then
      raise exception
        'superseded_by_id must reference a currently OPEN committed cost, not one that is itself terminal/superseded (id=%, target=%)',
        NEW.id, NEW.superseded_by_id;
    end if;
  else
    if NEW.superseded_at is not null or NEW.superseded_by_id is not null then
      raise exception 'superseded_at/superseded_by_id may only be set when status = ''superseded'' (id=%)', NEW.id;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists committed_costs_status_transition on committed_costs;
create trigger committed_costs_status_transition before insert or update on committed_costs
  for each row execute function public.enforce_committed_cost_status_transition();

-- ---------------------------------------------------------------------
-- committed_costs: lock a TERMINAL row's status/lineage completely.
--
-- 003 already rejects a FORWARD transition away from a terminal status
-- (e.g. fulfilled -> open). What it did NOT separately guard: touching
-- superseded_at/superseded_by_id on an ALREADY-superseded row (e.g.
-- redirecting the link to a different replacement, or changing the
-- timestamp) while leaving `status` itself unchanged — the check above
-- only fires `if NEW.status is distinct from OLD.status`, so an UPDATE
-- that leaves status='superseded' but changes superseded_by_id would
-- have sailed through both this function's checks. This trigger closes
-- that specific gap: once OLD.status is terminal, NOTHING about that
-- row may change, full stop.
-- ---------------------------------------------------------------------

create or replace function public.lock_committed_cost_terminal_row() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if OLD.status in ('fulfilled', 'cancelled', 'superseded') then
    if NEW.status is distinct from OLD.status
       or NEW.superseded_at is distinct from OLD.superseded_at
       or NEW.superseded_by_id is distinct from OLD.superseded_by_id
    then
      raise exception
        'Committed cost % is % (terminal) — its status and supersede lineage are permanently frozen, including superseded_at/superseded_by_id.',
        OLD.id, OLD.status;
    end if;
  end if;
  return NEW;
end;
$$;

create trigger committed_costs_lock_terminal_row before update on committed_costs
  for each row execute function public.lock_committed_cost_terminal_row();

-- ---------------------------------------------------------------------
-- forecast_entries: lock lineage after supersede, while still allowing
-- the RPC's one legitimate intermediate step (claim, then link).
--
-- 003's forecast_entries_superseded_by_implies_at CHECK already
-- guarantees a row can't have superseded_by_id set without
-- superseded_at also set. What was still open: once superseded_at is
-- set (claimed, whether or not superseded_by_id is linked yet), nothing
-- stopped a direct UPDATE from later changing superseded_at itself, or
-- — once superseded_by_id was written — redirecting it to a different
-- forecast, or clearing either field back to null.
--
-- Rule enforced below: if the OLD row was already "claimed"
-- (superseded_at is not null), the ONLY legal change is
-- superseded_by_id going from null to a value (the RPC's step 3).
-- Everything else — changing superseded_at at all, or touching
-- superseded_by_id once it's already non-null — is rejected.
-- ---------------------------------------------------------------------

create or replace function public.lock_forecast_superseded_lineage() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if OLD.superseded_at is not null then
    if NEW.superseded_at is distinct from OLD.superseded_at then
      raise exception
        'forecast_entries % is already superseded — superseded_at is immutable once set (id=%).',
        OLD.id, OLD.id;
    end if;
    if OLD.superseded_by_id is not null and NEW.superseded_by_id is distinct from OLD.superseded_by_id then
      raise exception
        'forecast_entries % already has a supersede link — superseded_by_id cannot be redirected or cleared once set (id=%).',
        OLD.id, OLD.id;
    end if;
    -- The one legal case: OLD.superseded_by_id is null (claimed but not
    -- yet linked — mid-RPC) and NEW.superseded_by_id is being set. Any
    -- other combination already raised above.
  end if;
  return NEW;
end;
$$;

create trigger forecast_entries_lock_superseded_lineage before update on forecast_entries
  for each row execute function public.lock_forecast_superseded_lineage();
