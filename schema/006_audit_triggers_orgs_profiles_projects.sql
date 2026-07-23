-- =====================================================================
-- Stone Column Portal — Migration 006: audit triggers on orgs,
-- profiles, projects, project_members, project_fee_rules.
--
-- TARGET-ARCHITECTURE.md §7 flags this gap explicitly: these five
-- tables existed since 001 but never got the log_audit() trigger every
-- other mutable table in this schema already has. No new tables, no
-- new columns, no RLS change.
--
-- IMPORTANT DEVIATION FROM THE ORIGINAL PLAN, DISCOVERED BY ACTUALLY
-- RUNNING THIS MIGRATION'S OWN TEST SECTION (see
-- tests/sql/package1_tests.sql, "Migration 006" section) against
-- PGlite, not assumed from reading the SQL:
--
-- public.log_audit() (schema/001, left completely unmodified here)
-- unconditionally references NEW.project_id / OLD.project_id. Every
-- table it was originally attached to (expenses, budget_ledger,
-- fee_ledger, committed_costs, forecast_entries, budget_suggestions,
-- cost_codes) has a real project_id column, so this always worked.
-- orgs and profiles have NO project_id column at all, and projects
-- itself has no project_id column (a project *is* the row, it doesn't
-- reference one). Attaching log_audit() directly to those three tables
-- fails immediately -- on INSERT as much as UPDATE/DELETE -- with
-- "record ... has no field project_id". This is NOT a runtime-data
-- issue that CASE's short-circuiting avoids: Postgres must resolve
-- every column reference in the statement against the trigger table's
-- row type at prepare time, even inside a CASE branch that turns out
-- not to be taken. CASE only defers *evaluation*, not *type
-- resolution*.
--
-- audit_log.project_id has in fact been nullable since 001 for exactly
-- this reason -- 001's own comment on that column says "Nullable only
-- in case a future table without project scope (e.g. profiles) is
-- ever added to the trigger set" -- but log_audit() itself was never
-- actually written to produce a null instead of erroring.
--
-- Fix, scoped entirely to this new migration (log_audit() itself is
-- NOT touched, satisfying "consumes log_audit() unmodified"):
--   - project_members / project_fee_rules: genuinely have a project_id
--     column -> use log_audit() exactly as originally planned.
--   - projects: self-scoped -- project_id is written as the row's own
--     id. This keeps audit_log_staff_select's existing
--     `is_org_staff(project_id)` policy meaningful: staff see a
--     project's own audit trail the same way they already see one for
--     every other project-scoped table.
--   - orgs / profiles: genuinely org-wide, not project-scoped.
--     project_id is written NULL, exactly as 001's own comment
--     anticipated.
--
-- CALLED-OUT LIMITATION (schema/001 territory, intentionally not
-- touched here): audit_log_staff_select's policy is
--   `using (project_id is not null and is_org_staff(project_id))`
-- so a NULL project_id is invisible to EVERY authenticated role,
-- including admin/staff, not just clients. orgs/profiles audit rows
-- are written durably (this migration's own test proves that) but are
-- not retrievable through the app's normal RLS-scoped read path today.
-- Making org/profile audit history visible would require changing
-- audit_log's RLS policy in schema/001 -- out of scope for this
-- migration, flagged here rather than silently worked around.
-- =====================================================================

create or replace function public.log_audit_self_scoped() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, before_data, after_data)
  values (
    case tg_op when 'DELETE' then OLD.id else NEW.id end,
    tg_table_name,
    case tg_op when 'DELETE' then OLD.id else NEW.id end,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );
  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke all on function public.log_audit_self_scoped() from public;

create or replace function public.log_audit_no_project() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, before_data, after_data)
  values (
    null,
    tg_table_name,
    case tg_op when 'DELETE' then OLD.id else NEW.id end,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );
  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke all on function public.log_audit_no_project() from public;

create trigger audit_orgs             after insert or update on orgs             for each row execute function public.log_audit_no_project();
create trigger audit_profiles         after insert or update on profiles         for each row execute function public.log_audit_no_project();
create trigger audit_projects         after insert or update on projects         for each row execute function public.log_audit_self_scoped();
create trigger audit_project_members  after insert or update or delete on project_members for each row execute function public.log_audit();
create trigger audit_project_fee_rules after insert or update on project_fee_rules for each row execute function public.log_audit();
