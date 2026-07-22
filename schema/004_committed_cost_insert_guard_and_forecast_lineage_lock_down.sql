-- =====================================================================
-- Migration 004 ROLLBACK
--
-- STATUS: written, NOT executed. Full teardown order: 004 down -> 003
-- down -> 002 down -> 001 down. Full reapply order: 001 -> 002 -> 003 -> 004.
-- =====================================================================

drop trigger if exists forecast_entries_lock_superseded_lineage on forecast_entries;
drop function if exists public.lock_forecast_superseded_lineage();

drop trigger if exists committed_costs_lock_terminal_row on committed_costs;
drop function if exists public.lock_committed_cost_terminal_row();

-- Restore 003's UPDATE-only version of the transition trigger/function.
drop trigger if exists committed_costs_status_transition on committed_costs;

create or replace function public.enforce_committed_cost_status_transition() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
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

create trigger committed_costs_status_transition before update on committed_costs
  for each row execute function public.enforce_committed_cost_status_transition();
