-- =====================================================================
-- Stone Column Portal — Migration 008: enforced project status
-- transitions, mirroring the expense state-machine trigger's already-
-- proven pattern (enforce_expense_state_transition() in 001).
--
-- Valid transitions only:
--   draft -> active
--   active -> on_hold
--   active -> closed_out
--   on_hold -> active
--   on_hold -> closed_out
--   closed_out -> archived
-- Every other transition (including any transition FROM archived, and
-- any two-step jump like draft -> closed_out) is rejected.
-- =====================================================================

create or replace function public.enforce_project_status_transition() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.status = OLD.status then
    return NEW;
  end if;

  if not (
    (OLD.status = 'draft'      and NEW.status = 'active') or
    (OLD.status = 'active'     and NEW.status in ('on_hold', 'closed_out')) or
    (OLD.status = 'on_hold'    and NEW.status in ('active', 'closed_out')) or
    (OLD.status = 'closed_out' and NEW.status = 'archived')
  ) then
    raise exception 'Invalid project status transition: % -> % (id=%)', OLD.status, NEW.status, OLD.id;
  end if;

  return NEW;
end;
$$;

create trigger projects_status_transition before update on projects
  for each row execute function public.enforce_project_status_transition();
