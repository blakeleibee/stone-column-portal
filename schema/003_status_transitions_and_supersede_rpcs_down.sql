-- =====================================================================
-- Migration 003 ROLLBACK
--
-- STATUS: written, NOT executed. Full teardown order: 003 down -> 002
-- down -> 001 down. Full reapply order: 001 up -> 002 up -> 003 up.
-- =====================================================================

revoke execute on function public.supersede_forecast(uuid, bigint, text, text, uuid) from authenticated;
drop function if exists public.supersede_forecast(uuid, bigint, text, text, uuid);

revoke execute on function public.supersede_committed_cost(uuid, bigint, text, text, uuid) from authenticated;
drop function if exists public.supersede_committed_cost(uuid, bigint, text, text, uuid);

alter table forecast_entries drop constraint if exists forecast_entries_superseded_by_implies_at;
alter table forecast_entries drop constraint if exists forecast_entries_no_self_supersede;
alter table forecast_entries drop constraint if exists forecast_entries_superseded_by_same_cost_code_fk;
alter table forecast_entries drop constraint if exists forecast_entries_id_cost_code_unique;
alter table forecast_entries drop column if exists superseded_by_id;

drop trigger if exists committed_costs_status_transition on committed_costs;
drop function if exists public.enforce_committed_cost_status_transition();

alter table committed_costs drop constraint if exists committed_costs_no_self_supersede;
alter table committed_costs drop constraint if exists committed_costs_superseded_by_same_cost_code_fk;
alter table committed_costs drop constraint if exists committed_costs_id_cost_code_unique;

-- CAVEAT: if any committed_costs row already has status='superseded'
-- (only possible after 003 was applied and used), the re-added CHECK
-- constraint below will reject it — this rollback is intended for a
-- fresh/test environment where 003 hasn't been used in anger yet, not
-- for reverting a schema that already has real 'superseded' data in
-- production. That's a genuine, disclosed limitation of any rollback
-- that narrows a value set, not something this file works around.
alter table committed_costs
  alter column status drop default,
  alter column status type text using status::text,
  alter column status set default 'open';
alter table committed_costs add constraint committed_costs_status_valid check (status in ('open', 'fulfilled', 'cancelled'));

drop type if exists committed_cost_status;
