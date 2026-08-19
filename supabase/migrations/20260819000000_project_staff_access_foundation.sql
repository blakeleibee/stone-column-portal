-- =====================================================================
-- Stone Column Portal — Migration 016: Project & Staff Access Foundation
-- (Package P3). See
-- .superpowers/sdd/2026-08-19-p3-project-staff-access-foundation/ for
-- the full design + independent review record. Two Critical
-- authorization findings from that review are embedded directly in this
-- migration (see the comments at project_staff_assignments_admin_manage
-- and at the projects_staff_* policy split below) — do not "simplify"
-- either back to a form that looks cleaner; both simplifications were
-- tried in an earlier draft and are real authorization holes.
--
-- SUMMARY:
--   - New `staff_function` enum (project_manager/superintendent/
--     accounting/general) on `profiles`, required for role='staff'.
--   - New `project_staff_assignments` table: the source of truth for
--     which project_manager/superintendent is scoped to which project.
--     Admin-managed only (never self-service, never via the org-wide
--     is_org_staff_for_org() check — see the Critical-A1 comment below).
--   - `is_org_staff(project_id)` (schema/001) is modified in place:
--     admin and accounting/general staff remain org-wide (today's
--     behavior, unchanged); project_manager/superintendent are now
--     gated by project_staff_assignments.
--   - New `is_financial_staff(project_id)` helper: is_org_staff() minus
--     superintendent (superintendents get schedule/field access in a
--     future package, not financial/procurement access). Swapped into
--     every financial/procurement table's staff policy (Decision 4).
--   - `projects`' own staff policy is split into SELECT/INSERT/UPDATE
--     (Decision 7a) instead of a single is_org_staff(id)-style rewrite —
--     schema/001 lines 84-89 already document why a self-join on INSERT
--     is unreliable; independent review confirmed the same caution
--     applies to UPDATE's WITH CHECK, not just INSERT.
--   - New `audit_financial_tables` registry + `is_financial_audit_table()`
--     helper, and audit_log's staff-select policy split into
--     admin/accounting/project-manager variants so a project_manager's
--     audit visibility is project-scoped, not org-wide.
--   - New `create_project_with_defaults()` RPC: admin-only project
--     creation that also seeds project_fee_rules, the standard cost-code
--     template, and initial staff/client assignments in one call.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Step 1: staff_function enum, profiles column, backfill, constraint
-- ---------------------------------------------------------------------
create type staff_function as enum ('project_manager', 'superintendent', 'accounting', 'general');

alter table profiles add column staff_function staff_function;

update profiles set staff_function = 'general'
  where role = 'staff' and staff_function is null;

alter table profiles add constraint staff_function_required_for_staff
  check (role <> 'staff' or staff_function is not null);

-- Step 1a (found during this migration's own verification, not in the
-- original brief): accept_invitation() (schema/009) inserts a new
-- profiles row directly from an invitation's role and, until now, never
-- needed to set staff_function. Left unpatched, accepting ANY staff
-- invitation post-016 would raise staff_function_required_for_staff —
-- a real functional regression, not just a test-fixture inconvenience.
-- Modified in place here (same "CREATE OR REPLACE in a later migration"
-- pattern already used for is_org_staff() below), defaulting new staff
-- to 'general' — identical to this migration's own backfill default for
-- pre-existing staff rows. An admin can retarget staff_function
-- afterward via the existing profiles_update_self_or_org_admin policy
-- (self-escalation trigger only blocks role/org_id/is_active, not
-- staff_function). Only the INSERT's column list/values changes; every
-- other line is copied verbatim from schema/009.
create or replace function public.accept_invitation(p_token text, p_full_name text) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'accept_invitation requires an authenticated caller.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This account already has a profile and cannot accept another invitation.';
  end if;

  select * into v_invitation from public.invitations
  where token = p_token and accepted_at is null and revoked_at is null and expires_at > now();

  if v_invitation.id is null then
    raise exception 'This invitation is invalid, expired, already accepted, or revoked.';
  end if;

  insert into public.profiles (id, org_id, role, full_name, email, staff_function)
  values (
    auth.uid(), v_invitation.org_id, v_invitation.role, p_full_name, v_invitation.email,
    case when v_invitation.role = 'staff' then 'general'::staff_function else null end
  );

  if v_invitation.project_id is not null then
    insert into public.project_members (project_id, user_id, member_role)
    values (v_invitation.project_id, auth.uid(), v_invitation.role);
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_invitation.id;

  return v_invitation.org_id;
end;
$$;

revoke all on function public.accept_invitation(text, text) from public;
grant execute on function public.accept_invitation(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Step 2: project_staff_assignments table, RLS, revocation triggers, audit
-- ---------------------------------------------------------------------
create table project_staff_assignments (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references projects(id) on delete cascade,
  profile_id   uuid not null references profiles(id),
  assigned_at  timestamptz not null default now(),
  assigned_by  uuid references profiles(id),
  revoked_at   timestamptz,
  revoked_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),

  constraint project_staff_assignments_unique_pair unique (project_id, profile_id)
);

alter table project_staff_assignments enable row level security;

-- Admin-only, deliberately NOT is_org_staff_for_org() -- a
-- project_manager/superintendent's entire access model is downstream
-- of this table, so if any org-wide staff account could write to it,
-- a restricted account could grant itself the exact access this
-- package exists to restrict. Found in independent review (Critical
-- finding A1) against an earlier draft that used is_org_staff_for_org.
create policy project_staff_assignments_admin_manage on project_staff_assignments
  for all to authenticated
  using (is_org_admin_for_org((select org_id from projects where id = project_id)))
  with check (is_org_admin_for_org((select org_id from projects where id = project_id)));

create or replace function public.enforce_project_staff_assignment_org_match() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_project_org uuid;
  v_profile_org uuid;
begin
  select org_id into v_project_org from projects where id = new.project_id;
  select org_id into v_profile_org from profiles where id = new.profile_id;
  if v_project_org is distinct from v_profile_org then
    raise exception 'Cannot assign profile % to project % — org mismatch (profile org %, project org %)',
      new.profile_id, new.project_id, v_profile_org, v_project_org;
  end if;
  return new;
end;
$$;

create trigger project_staff_assignments_org_match before insert or update on project_staff_assignments
  for each row execute function public.enforce_project_staff_assignment_org_match();

-- Mirrors enforce_vendor_member_identity_and_revocation() (schema/015)
-- exactly: identity immutable after insert; revoked_by must equal the
-- acting session's own auth.uid(), checked on both INSERT (an
-- already-revoked row) and UPDATE (either field changing); reactivation
-- (revoked_at cleared) also clears revoked_by.
create or replace function public.enforce_project_staff_assignment_identity_and_revocation() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- assigned_by provenance (independent review finding C3, same
    -- class of fix as bid_questions.recorded_by / bid_addenda.issued_by
    -- in P5 Revision 3 -- a default is not a boundary).
    if new.assigned_by is distinct from auth.uid() then
      raise exception 'project_staff_assignments.assigned_by must equal the acting session''s own auth.uid() (%) — got %.',
        auth.uid(), new.assigned_by;
    end if;
    if new.revoked_at is not null and new.revoked_by is distinct from auth.uid() then
      raise exception 'project_staff_assignments.revoked_by must equal the acting session''s own auth.uid() (%) when inserting an already-revoked row — got % (row %).',
        auth.uid(), new.revoked_by, new.id;
    end if;
    return new;
  end if;

  if new.project_id is distinct from old.project_id or new.profile_id is distinct from old.profile_id
     or new.assigned_by is distinct from old.assigned_by then
    raise exception 'project_staff_assignments.project_id/profile_id/assigned_by are immutable after insert (row %).', old.id;
  end if;

  if new.revoked_at is distinct from old.revoked_at or new.revoked_by is distinct from old.revoked_by then
    if new.revoked_at is not null then
      if new.revoked_by is distinct from auth.uid() then
        raise exception 'project_staff_assignments.revoked_by must equal the acting session''s own auth.uid() (%) — got % (row %).',
          auth.uid(), new.revoked_by, old.id;
      end if;
    else
      -- Reactivation: revoked_at cleared must also clear revoked_by.
      if new.revoked_by is not null then
        raise exception 'Reactivating project_staff_assignments row % must also clear revoked_by.', old.id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger project_staff_assignments_identity_and_revocation
  before insert or update on project_staff_assignments
  for each row execute function public.enforce_project_staff_assignment_identity_and_revocation();

create trigger audit_project_staff_assignments after insert or update or delete on project_staff_assignments
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Step 3: has_project_assignment() helper
-- ---------------------------------------------------------------------
create or replace function public.has_project_assignment(p_project_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_staff_assignments
    where project_id = p_project_id and profile_id = auth.uid() and revoked_at is null
  );
$$;

revoke all on function public.has_project_assignment(uuid) from public;
grant execute on function public.has_project_assignment(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Step 4: is_org_staff(project_id) — modified in place (Decision 1).
-- Preserves the exact language/security/search_path clauses of the
-- pre-016 body (schema/001 lines 103-112); only the internal logic
-- changes.
-- ---------------------------------------------------------------------
create or replace function public.is_org_staff(p_project_id uuid) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_role app_role;
  v_function staff_function;
begin
  select org_id into v_org_id from public.projects where id = p_project_id;
  if v_org_id is null or not public.is_org_staff_for_org(v_org_id) then
    return false;
  end if;

  select role, staff_function into v_role, v_function
  from public.profiles where id = auth.uid();

  if v_role = 'admin' then
    return true;
  end if;

  if v_function in ('project_manager', 'superintendent') then
    return public.has_project_assignment(p_project_id);
  end if;

  -- 'accounting', 'general', and legacy NULL (pre-migration, should not
  -- occur post-backfill) remain org-wide, matching today's behavior.
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Step 5: is_financial_staff() helper + swap into the Decision 4 table list
-- ---------------------------------------------------------------------
create or replace function public.is_financial_staff(p_project_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_org_staff(p_project_id)
    and coalesce(
      (select staff_function from public.profiles where id = auth.uid()),
      'general'
    ) <> 'superintendent';
$$;

revoke all on function public.is_financial_staff(uuid) from public;
grant execute on function public.is_financial_staff(uuid) to authenticated;

-- Decision 4 swap: every policy below is drop + recreate with the
-- identical name and predicate shape, replacing is_org_staff(...) with
-- is_financial_staff(...). Each policy's existing project-id-resolution
-- expression is preserved exactly — only the outer function name changes.

-- project_fee_rules (schema/001)
drop policy fee_rules_staff_only on project_fee_rules;
create policy fee_rules_staff_only on project_fee_rules
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- cost_codes (schema/001)
drop policy cost_codes_staff_full on cost_codes;
create policy cost_codes_staff_full on cost_codes
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- budget_ledger (schema/001)
drop policy budget_ledger_staff_select on budget_ledger;
create policy budget_ledger_staff_select on budget_ledger
  for select to authenticated using (is_financial_staff(project_id));
drop policy budget_ledger_staff_insert on budget_ledger;
create policy budget_ledger_staff_insert on budget_ledger
  for insert to authenticated with check (is_financial_staff(project_id));

-- expenses (schema/001)
drop policy expenses_staff_full_access on expenses;
create policy expenses_staff_full_access on expenses
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- committed_costs (schema/001)
drop policy committed_costs_staff_only on committed_costs;
create policy committed_costs_staff_only on committed_costs
  for all to authenticated using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- forecast_entries (schema/001)
drop policy forecast_entries_staff_only on forecast_entries;
create policy forecast_entries_staff_only on forecast_entries
  for all to authenticated using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- budget_suggestions (schema/001)
drop policy budget_suggestions_staff_only on budget_suggestions;
create policy budget_suggestions_staff_only on budget_suggestions
  for all to authenticated using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- fee_ledger (schema/001)
drop policy fee_ledger_staff_select on fee_ledger;
create policy fee_ledger_staff_select on fee_ledger
  for select to authenticated using (is_financial_staff(project_id));
drop policy fee_ledger_staff_insert on fee_ledger;
create policy fee_ledger_staff_insert on fee_ledger
  for insert to authenticated with check (is_financial_staff(project_id));

-- import_batches (schema/001)
drop policy import_batches_staff_only on import_batches;
create policy import_batches_staff_only on import_batches
  for all to authenticated using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- import_rows (schema/001) — resolved project id via import_batches, preserved exactly
drop policy import_rows_staff_only on import_rows;
create policy import_rows_staff_only on import_rows
  for all to authenticated
  using (is_financial_staff((select project_id from import_batches b where b.id = batch_id)))
  with check (is_financial_staff((select project_id from import_batches b where b.id = batch_id)));

-- divisions (schema/012)
drop policy divisions_staff_full on divisions;
create policy divisions_staff_full on divisions
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- project_financial_settings (schema/012)
drop policy project_financial_settings_staff_only on project_financial_settings;
create policy project_financial_settings_staff_only on project_financial_settings
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- credit_ledger (schema/012)
drop policy credit_ledger_staff_select on credit_ledger;
create policy credit_ledger_staff_select on credit_ledger
  for select to authenticated using (is_financial_staff(project_id));
drop policy credit_ledger_staff_insert on credit_ledger;
create policy credit_ledger_staff_insert on credit_ledger
  for insert to authenticated with check (is_financial_staff(project_id));

-- bid_packages (schema/015)
drop policy bid_packages_staff_full_access on bid_packages;
create policy bid_packages_staff_full_access on bid_packages
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- bid_submissions (schema/015) — resolved project id via get_bid_package_project_id, preserved exactly
drop policy bid_submissions_staff_full_access on bid_submissions;
create policy bid_submissions_staff_full_access on bid_submissions
  for all to authenticated
  using (is_financial_staff(get_bid_package_project_id(bid_submissions.bid_package_id)))
  with check (is_financial_staff(get_bid_package_project_id(bid_submissions.bid_package_id)));

-- bid_questions (schema/015)
drop policy bid_questions_staff_full_access on bid_questions;
create policy bid_questions_staff_full_access on bid_questions
  for all to authenticated
  using (is_financial_staff(get_bid_package_project_id(bid_questions.bid_package_id)))
  with check (is_financial_staff(get_bid_package_project_id(bid_questions.bid_package_id)));

-- bid_addenda (schema/015)
drop policy bid_addenda_staff_full_access on bid_addenda;
create policy bid_addenda_staff_full_access on bid_addenda
  for all to authenticated
  using (is_financial_staff(get_bid_package_project_id(bid_addenda.bid_package_id)))
  with check (is_financial_staff(get_bid_package_project_id(bid_addenda.bid_package_id)));

-- material_orders (schema/015)
drop policy material_orders_staff_full_access on material_orders;
create policy material_orders_staff_full_access on material_orders
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- material_order_line_items (schema/015) — resolved project id via material_orders, preserved exactly
drop policy material_order_line_items_staff_full_access on material_order_line_items;
create policy material_order_line_items_staff_full_access on material_order_line_items
  for all to authenticated
  using (is_financial_staff((select project_id from material_orders where id = material_order_line_items.material_order_id)))
  with check (is_financial_staff((select project_id from material_orders where id = material_order_line_items.material_order_id)));

-- issued_documents (schema/015) — confirmed verbatim in Step 0 against
-- the real schema/015_commitments_bids_procurement.sql (lines 614-627):
-- a CASE over document_type resolving the project id two different ways
-- depending on source table, identical in USING and WITH CHECK.
drop policy issued_documents_staff_full_access on issued_documents;
create policy issued_documents_staff_full_access on issued_documents
  for all to authenticated
  using (
    case document_type
      when 'purchase_order' then is_financial_staff((select project_id from material_orders where id = issued_documents.source_id))
      when 'subcontract' then is_financial_staff(get_bid_package_project_id(issued_documents.source_id))
    end
  )
  with check (
    case document_type
      when 'purchase_order' then is_financial_staff((select project_id from material_orders where id = issued_documents.source_id))
      when 'subcontract' then is_financial_staff(get_bid_package_project_id(issued_documents.source_id))
    end
  );

-- ---------------------------------------------------------------------
-- Step 6: projects_staff_full_access split into command-specific
-- policies (Decision 7a) — NOT a single is_org_staff(id) rewrite.
-- schema/001_core_financial.sql lines 84-89 document, in the same
-- comment block that defines is_org_staff() itself, that this exact
-- substitution was deliberately avoided for `projects`' own policy
-- because "a self-join against the row currently being inserted is
-- unreliable." Independent review confirmed this warning is real and
-- specific to INSERT's WITH CHECK evaluation — not to SELECT/UPDATE's
-- USING clause, which check an already-existing row.
--
-- FIX ROUND 1 (Critical finding C1): the self-join hazard is *also*
-- reachable through SELECT, not just INSERT/UPDATE's WITH CHECK.
-- create_project_with_defaults() does
-- `insert into projects (...) returning id into v_project_id` —
-- Postgres evaluates the table's SELECT policy against a RETURNING
-- clause too. The original projects_staff_select's `is_org_staff(id)`
-- internally does `select org_id from public.projects where id =
-- p_project_id`, which cannot see the not-yet-committed row mid-INSERT
-- and resolves to null org_id, so is_org_staff() returns false and the
-- RETURNING clause is rejected by RLS even though the INSERT itself
-- was correctly authorized — breaking create_project_with_defaults()
-- for every caller. Fixed by is_org_staff_for_project_row() below,
-- which takes org_id directly off the row being checked (already
-- visible, no self-join — the same pattern already used correctly by
-- projects_staff_insert's is_org_admin_for_org(org_id) and
-- projects_staff_update's WITH CHECK), reproducing is_org_staff()'s
-- assignment-aware logic without querying `projects` at all.
-- ---------------------------------------------------------------------
drop policy projects_staff_full_access on projects;

create or replace function public.is_org_staff_for_project_row(p_org_id uuid, p_project_id uuid) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_role app_role;
  v_function staff_function;
begin
  if p_org_id is null or not public.is_org_staff_for_org(p_org_id) then
    return false;
  end if;

  select role, staff_function into v_role, v_function
  from public.profiles where id = auth.uid();

  if v_role = 'admin' then
    return true;
  end if;

  if v_function in ('project_manager', 'superintendent') then
    return public.has_project_assignment(p_project_id);
  end if;

  return true;
end;
$$;

revoke all on function public.is_org_staff_for_project_row(uuid, uuid) from public;
grant execute on function public.is_org_staff_for_project_row(uuid, uuid) to authenticated;

-- SELECT: existing row, but also reachable mid-INSERT via RETURNING
-- (see FIX ROUND 1 note above) — org_id is a plain column on the row
-- being checked, so no self-join hazard either way.
create policy projects_staff_select on projects
  for select to authenticated
  using (is_org_staff_for_project_row(org_id, id));

-- INSERT: no self-join (org_id is a column on the incoming row
-- itself); also tightens creation to admin-only at the RLS layer
-- (Decision 7), not merely inside create_project_with_defaults().
create policy projects_staff_insert on projects
  for insert to authenticated
  with check (is_org_admin_for_org(org_id));

-- UPDATE: USING checks the existing row (safe, assignment-aware);
-- WITH CHECK deliberately avoids any self-referential subquery on
-- the new row image, per the same caution as INSERT above, even
-- though the original comment only names INSERT explicitly.
--
-- FIX ROUND 1 (Important finding I2): USING is now is_financial_staff,
-- not is_org_staff — projects carries two real dollar columns
-- (gmp_amount_cents, deposit_amount_cents), so Decision 4's exclusion
-- of `projects` from the financial-table swap list was incomplete.
-- Without this, an assigned superintendent could UPDATE projects and
-- change those amounts directly, defeating is_financial_staff()'s
-- purpose everywhere else. WITH CHECK stays is_org_staff_for_org(org_id)
-- (unchanged) — no self-join concern there, and USING is the financial
-- gate, not WITH CHECK.
create policy projects_staff_update on projects
  for update to authenticated
  using (is_financial_staff(id))
  with check (is_org_staff_for_org(org_id));

-- No DELETE policy is added — none existed before this package, and
-- projects are never hard-deleted in this system (status='archived' is
-- the terminal state). projects_client_read is untouched.

-- ---------------------------------------------------------------------
-- Step 7: audit_financial_tables registry + helper + audit_log policy rewrite
-- ---------------------------------------------------------------------
create table audit_financial_tables (
  table_name text primary key
);

alter table audit_financial_tables enable row level security;
-- Deliberately no policies at all -- reachable only via the
-- SECURITY DEFINER helper below, same pattern as every other
-- helper-gated lookup in this schema.

insert into audit_financial_tables (table_name) values
  ('project_fee_rules'), ('cost_codes'), ('budget_ledger'), ('expenses'),
  ('committed_costs'), ('forecast_entries'), ('budget_suggestions'),
  ('fee_ledger'), ('import_batches'), ('import_rows'), ('divisions'),
  ('project_financial_settings'), ('credit_ledger'), ('bid_packages'),
  ('bid_submissions'), ('bid_questions'), ('bid_addenda'),
  ('material_orders'), ('material_order_line_items'), ('issued_documents');

create or replace function public.is_financial_audit_table(p_table_name text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.audit_financial_tables where table_name = p_table_name);
$$;

revoke all on function public.is_financial_audit_table(text) from public;
grant execute on function public.is_financial_audit_table(text) to authenticated;

drop policy audit_log_staff_select on audit_log;

create policy audit_log_admin_select on audit_log
  for select to authenticated
  using (
    project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id = audit_log.project_id and public.is_org_admin_for_org(p.org_id)
    )
  );

create policy audit_log_accounting_financial_select on audit_log
  for select to authenticated
  using (
    project_id is not null
    and public.is_financial_audit_table(audit_log.table_name)
    and exists (
      select 1 from public.profiles pr
      join public.projects p on p.id = audit_log.project_id
      where pr.id = auth.uid() and pr.org_id = p.org_id
        and pr.role = 'staff' and pr.staff_function = 'accounting' and pr.is_active
    )
  );

create policy audit_log_pm_project_scoped_select on audit_log
  for select to authenticated
  using (
    project_id is not null
    and exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'staff'
        and pr.staff_function = 'project_manager' and pr.is_active
    )
    and public.has_project_assignment(audit_log.project_id)
  );

-- audit_log_org_scoped_select (schema/006) and
-- audit_log_vendor_members_staff_select (schema/015) are untouched — not
-- modified by this migration. Nor are audit_log_vendors_staff_select
-- (schema/012) and audit_log_import_mapping_profiles_staff_select
-- (schema/013) — only audit_log_staff_select (schema/001) is replaced.

-- ---------------------------------------------------------------------
-- Step 8: create_project_with_defaults() RPC.
--
-- Step 8a note (independent review finding A6): apply_standard_cost_
-- code_template() (schema/012) has its own internal is_org_staff()
-- gate, unrelated to the Decision 4 policy swap above. After this
-- migration a superintendent calling it directly on a project they're
-- assigned to (non-financial is_org_staff() passes) would pass that
-- internal gate and then hit a raw RLS-violation error on its first
-- divisions/cost_codes insert (now is_financial_staff-gated). Not an
-- authorization hole — is_financial_staff still correctly blocks the
-- actual write — but a confusing failure mode. No fix required in this
-- package: this RPC is never called by a superintendent in practice
-- (admin-only per Decision 7, enforced by the check below), so that
-- path is theoretical, not reachable through any sanctioned flow.
-- ---------------------------------------------------------------------
create or replace function public.create_project_with_defaults(
  p_org_id uuid,
  p_name text,
  p_project_number text,
  p_address text,
  p_project_type text,
  p_pricing_model pricing_model,
  p_pricing_model_label text,
  p_fee_basis fee_basis,
  p_fee_basis_points integer default null,
  p_fee_fixed_amount_cents bigint default null,
  p_initial_staff_profile_ids uuid[] default '{}',
  p_initial_client_profile_ids uuid[] default '{}'
) returns uuid
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_staff_id uuid;
  v_client_id uuid;
begin
  if not is_org_admin_for_org(p_org_id) then
    raise exception 'Only an org admin may create a project.';
  end if;

  -- Clean, explicit validation before hitting project_fee_rules' raw
  -- fee_basis_amount_present CHECK constraint (independent review
  -- finding B4) -- matches this function's own admin-check style
  -- rather than surfacing an opaque constraint-violation error.
  if p_fee_basis = 'percentage' and (p_fee_basis_points is null or p_fee_fixed_amount_cents is not null) then
    raise exception 'fee_basis=percentage requires fee_basis_points and no fee_fixed_amount_cents.';
  end if;
  if p_fee_basis = 'fixed' and (p_fee_fixed_amount_cents is null or p_fee_basis_points is not null) then
    raise exception 'fee_basis=fixed requires fee_fixed_amount_cents and no fee_basis_points.';
  end if;

  insert into projects (org_id, name, project_number, address, project_type,
                         status, pricing_model, pricing_model_label, created_by)
  values (p_org_id, p_name, p_project_number, p_address, p_project_type,
          'draft', p_pricing_model, p_pricing_model_label, auth.uid())
  returning id into v_project_id;

  insert into project_fee_rules (project_id, fee_basis, fee_basis_points, fee_fixed_amount_cents, created_by)
  values (v_project_id, p_fee_basis, p_fee_basis_points, p_fee_fixed_amount_cents, auth.uid());

  perform apply_standard_cost_code_template(v_project_id);

  foreach v_staff_id in array p_initial_staff_profile_ids loop
    insert into project_staff_assignments (project_id, profile_id, assigned_by)
    values (v_project_id, v_staff_id, auth.uid());
  end loop;

  foreach v_client_id in array p_initial_client_profile_ids loop
    insert into project_members (project_id, user_id, member_role)
    values (v_project_id, v_client_id, 'client');
  end loop;

  return v_project_id;
end;
$$;

revoke all on function public.create_project_with_defaults(
  uuid, text, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
) from public;
grant execute on function public.create_project_with_defaults(
  uuid, text, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
) to authenticated;
