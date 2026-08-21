-- =====================================================================
-- Stone Column Portal — Migration 017 ROLLBACK.
-- Drops change_project_status(), then restores
-- enforce_project_status_transition() to its exact pre-017 body
-- (schema/008_project_status_transitions.sql lines 17-37, copied
-- verbatim, not reconstructed from memory). The projects_status_
-- transition trigger itself is untouched by 017 (and therefore by this
-- rollback too) — it already points at this function by name.
-- =====================================================================

drop function if exists public.change_project_status(uuid, project_status);

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
