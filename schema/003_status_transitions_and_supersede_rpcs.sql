-- =====================================================================
-- Stone Column Portal — Migration 003: status transitions & atomic
-- supersede workflow for committed_costs and forecast_entries
--
-- STATUS: written, NOT executed — same disclosure as every other SQL
-- file in this project. See tests/sql/committed_forecast_hardening_tests.sql
-- (updated this round) for the test scenarios this is meant to satisfy.
--
-- WHY A NEW MIGRATION, NOT AN EDIT TO 001/002:
-- Same reasoning as 002 itself — 001/002 were already reviewed. This
-- adds new columns/constraints/functions rather than altering
-- established history.
--
-- WHAT THIS FIXES (from the Package 2 review):
--   Item 4 — forecast_entries had no supersede lineage
--   (superseded_by_id) the way committed_costs already did, and the SQL
--   test exercised an insert order that the partial unique index
--   (forecast_entries_one_active_per_cost_code, from 001) would
--   actually reject. The correct workflow is atomic: validate ->
--   supersede old -> insert new -> link, in one transaction, which is
--   exactly what supersede_forecast() below does.
--
--   Item 5 — committed_costs.status was a free-text column with only a
--   "must be one of these three strings" CHECK — nothing enforced
--   VALID TRANSITIONS (e.g. nothing stopped a 'fulfilled' commitment
--   from being edited back toward 'open', or superseded twice, or
--   pointing superseded_by_id at itself or at an already-retired row).
-- =====================================================================

-- ---------------------------------------------------------------------
-- committed_costs: real enum status, replacing the free-text CHECK.
-- ---------------------------------------------------------------------

create type committed_cost_status as enum ('open', 'fulfilled', 'cancelled', 'superseded');

alter table committed_costs drop constraint if exists committed_costs_status_valid;

alter table committed_costs
  alter column status drop default,
  alter column status type committed_cost_status using status::committed_cost_status,
  alter column status set default 'open';

-- Composite unique + FK so a supersede link can only point at a row in
-- the SAME cost code (transitively same project) — identical pattern
-- to budget_ledger's reverses_entry_id in 001.
alter table committed_costs add constraint committed_costs_id_cost_code_unique unique (id, cost_code_id);

alter table committed_costs
  add constraint committed_costs_superseded_by_same_cost_code_fk
  foreign key (superseded_by_id, cost_code_id) references committed_costs(id, cost_code_id);

alter table committed_costs
  add constraint committed_costs_no_self_supersede
  check (superseded_by_id is null or superseded_by_id <> id);

-- ---------------------------------------------------------------------
-- committed_costs: valid status transitions + supersede consistency.
-- This is a SEPARATE trigger from 002's reject_committed_cost_core_edit
-- (which governs amount/cost_code/project/vendor/source_type/source_id
-- and deliberately leaves status alone) — the two compose without
-- conflict since they check disjoint concerns.
-- ---------------------------------------------------------------------

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
    -- Anti-cycle rule: the replacement must itself be a fresh, currently
    -- 'open' row — it can't already be superseded (which would mean
    -- it's part of an existing chain) and can't be some other terminal
    -- row either. This is what actually prevents A supersedes B
    -- supersedes A, without needing a full graph-cycle check: every
    -- chain link must point strictly to a brand-new 'open' row.
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

-- ---------------------------------------------------------------------
-- Atomic supersede RPC for committed_costs. SECURITY INVOKER (not
-- DEFINER) — the caller must already have ordinary staff RLS access to
-- INSERT/UPDATE committed_costs (committed_costs_staff_only, 001);
-- this function doesn't need to bypass RLS, only to guarantee the
-- validate -> insert -> link sequence happens as one transaction so a
-- mid-sequence failure rolls back everything, never leaving an
-- orphaned new row or a stale old one.
-- ---------------------------------------------------------------------

create or replace function public.supersede_committed_cost(
  p_old_id uuid,
  p_new_amount_cents bigint,
  p_new_vendor_name text default null,
  p_new_source_type text default null,
  p_new_source_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old committed_costs%rowtype;
  v_new_id uuid;
begin
  select * into v_old from committed_costs where id = p_old_id for update;
  if not found then
    raise exception 'committed_costs row % not found', p_old_id;
  end if;
  if v_old.status <> 'open' then
    raise exception 'Cannot supersede committed cost % — it is not open (status=%)', p_old_id, v_old.status;
  end if;

  insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, source_type, source_id, status)
  values (
    v_old.project_id,
    v_old.cost_code_id,
    coalesce(p_new_vendor_name, v_old.vendor_name),
    p_new_amount_cents,
    coalesce(p_new_source_type, v_old.source_type),
    p_new_source_id,
    'open'
  )
  returning id into v_new_id;

  update committed_costs
    set status = 'superseded', superseded_at = now(), superseded_by_id = v_new_id
    where id = p_old_id;

  return v_new_id;
end;
$$;

revoke all on function public.supersede_committed_cost(uuid, bigint, text, text, uuid) from public;
grant execute on function public.supersede_committed_cost(uuid, bigint, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- forecast_entries: supersede lineage (was missing entirely — only
-- committed_costs had superseded_by_id before this migration).
-- ---------------------------------------------------------------------

alter table forecast_entries add column superseded_by_id uuid;

alter table forecast_entries add constraint forecast_entries_id_cost_code_unique unique (id, cost_code_id);

alter table forecast_entries
  add constraint forecast_entries_superseded_by_same_cost_code_fk
  foreign key (superseded_by_id, cost_code_id) references forecast_entries(id, cost_code_id);

alter table forecast_entries
  add constraint forecast_entries_no_self_supersede
  check (superseded_by_id is null or superseded_by_id <> id);

alter table forecast_entries
  add constraint forecast_entries_superseded_by_implies_at
  check (superseded_by_id is null or superseded_at is not null);
-- NOTE: deliberately one-directional (superseded_by_id implies
-- superseded_at, not the reverse) — see supersede_forecast() below for
-- why. A row can transiently have superseded_at set while
-- superseded_by_id is still null (claimed for replacement, link not
-- written yet); a row can never have superseded_by_id set without
-- superseded_at. Both end up set by the time the RPC's transaction
-- commits — this constraint only needs to tolerate the valid
-- intermediate step, not forbid it.

-- ---------------------------------------------------------------------
-- Atomic supersede RPC for forecast_entries — same shape as the
-- committed_costs one above, same SECURITY INVOKER reasoning.
-- ---------------------------------------------------------------------

create or replace function public.supersede_forecast(
  p_old_id uuid,
  p_new_forecast_to_complete_cents bigint,
  p_method text default 'manual',
  p_note text default null,
  p_source_suggestion_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old forecast_entries%rowtype;
  v_new_id uuid;
begin
  select * into v_old from forecast_entries where id = p_old_id for update;
  if not found then
    raise exception 'forecast_entries row % not found', p_old_id;
  end if;
  if v_old.superseded_at is not null then
    raise exception 'Cannot supersede forecast % — it is already superseded', p_old_id;
  end if;

  -- STEP 1: claim the old row (superseded_at only) FIRST. This is what
  -- makes step 2 legal — forecast_entries_one_active_per_cost_code
  -- (001) is a partial unique index on `where superseded_at is null`,
  -- checked immediately per statement. If we inserted the new row
  -- before this, both rows would momentarily have superseded_at IS
  -- NULL for the same cost_code_id and the index would reject the
  -- INSERT outright. Claiming first means only the not-yet-inserted
  -- new row will be the "active" one once it exists.
  update forecast_entries set superseded_at = now() where id = p_old_id;

  -- STEP 2: now safe — old row no longer counts as active.
  insert into forecast_entries (project_id, cost_code_id, forecast_to_complete_cents, method, source_suggestion_id, note)
  values (v_old.project_id, v_old.cost_code_id, p_new_forecast_to_complete_cents, p_method, p_source_suggestion_id, p_note)
  returning id into v_new_id;

  -- STEP 3: write the lineage link. forecast_entries_superseded_by_
  -- implies_at only requires superseded_at once superseded_by_id is
  -- set — already true from step 1 — so this is legal too.
  update forecast_entries set superseded_by_id = v_new_id where id = p_old_id;

  return v_new_id;
end;
$$;

revoke all on function public.supersede_forecast(uuid, bigint, text, text, uuid) from public;
grant execute on function public.supersede_forecast(uuid, bigint, text, text, uuid) to authenticated;
