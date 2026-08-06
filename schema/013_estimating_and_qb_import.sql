-- =====================================================================
-- Stone Column Portal — Migration 013: estimating & QuickBooks import.
-- See docs/production-build/P4-DESIGN.md for full rationale.
-- =====================================================================

create table import_mapping_profiles (
  id                        uuid primary key default uuid_generate_v4(),
  org_id                    uuid not null references orgs(id),
  name                      text not null,
  column_mapping            jsonb not null,
  cost_code_match_strategy  text not null default 'prefix',
  cost_code_prefix_length   integer,
  item_overrides            jsonb not null default '{}'::jsonb,
  is_archived               boolean not null default false,
  created_by                uuid references profiles(id),
  created_at                timestamptz not null default now(),
  constraint import_mapping_profiles_strategy_valid
    check (cost_code_match_strategy in ('prefix', 'exact', 'manual_only')),
  constraint import_mapping_profiles_prefix_length_required
    check (cost_code_match_strategy <> 'prefix' or cost_code_prefix_length is not null),
  unique (org_id, name)
);

alter table import_batches
  add column mapping_profile_id uuid references import_mapping_profiles(id);

alter table budget_ledger
  add constraint budget_ledger_correction_requires_note
    check (entry_type <> 'correction' or note is not null);

create or replace function public.enforce_single_original_budget_entry() returns trigger
language plpgsql
as $$
begin
  if new.entry_type = 'original' and exists (
    select 1 from public.budget_ledger
    where cost_code_id = new.cost_code_id and entry_type = 'original'
  ) then
    raise exception 'Cost code % already has an original budget entry — use an adjustment (correction) instead.', new.cost_code_id;
  end if;
  return new;
end;
$$;

create trigger enforce_single_original_budget_entry
  before insert on budget_ledger
  for each row execute function public.enforce_single_original_budget_entry();

alter table import_mapping_profiles enable row level security;

create policy import_mapping_profiles_staff_only on import_mapping_profiles
  for all to authenticated
  using (is_org_staff_for_org(org_id))
  with check (is_org_staff_for_org(org_id));

-- Resolves project_id through import_batches for tables (like
-- import_rows) that don't carry project_id directly, mirroring
-- log_audit_no_project()/log_audit_self_scoped() from schema/006.
create or replace function public.log_audit_via_batch() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_row_id uuid := coalesce(new.id, old.id);
begin
  select project_id into v_project_id from public.import_batches
  where id = coalesce(new.batch_id, old.batch_id);

  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, before_data, after_data)
  values (
    v_project_id,
    tg_table_name,
    v_row_id,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_import_batches after insert or update on import_batches
  for each row execute function public.log_audit();

create trigger audit_import_rows after insert or update on import_rows
  for each row execute function public.log_audit_via_batch();

create trigger audit_import_mapping_profiles after insert or update on import_mapping_profiles
  for each row execute function public.log_audit_no_project();
