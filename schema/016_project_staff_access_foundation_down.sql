-- =====================================================================
-- Stone Column Portal — Migration 016 ROLLBACK.
-- Reverses schema/016_project_staff_access_foundation.sql in dependency
-- order. Every restored CREATE POLICY/CREATE FUNCTION body below is
-- copied verbatim from the original schema/001, schema/012, and
-- schema/015 files (not reconstructed from memory), so that up -> down
-- round-trips to a byte-identical pre-016 state (independent review
-- finding B3 — see the Verify step in the Task 1 brief for how this is
-- checked: pg_get_functiondef / pg_policies diffed against a pre-016
-- baseline, not just "no errors during down").
-- =====================================================================

-- ---------------------------------------------------------------------
-- Step 8 reverse: drop the RPC.
-- ---------------------------------------------------------------------
drop function if exists public.create_project_with_defaults(
  uuid, text, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
);

-- ---------------------------------------------------------------------
-- Step 7 reverse: drop the 3 new audit_log policies, restore
-- audit_log_staff_select's exact original body (schema/001 lines
-- 993-995), then drop is_financial_audit_table() / audit_financial_tables.
-- ---------------------------------------------------------------------
drop policy if exists audit_log_pm_project_scoped_select on audit_log;
drop policy if exists audit_log_accounting_financial_select on audit_log;
drop policy if exists audit_log_admin_select on audit_log;

create policy audit_log_staff_select on audit_log
  for select to authenticated
  using (project_id is not null and is_org_staff(project_id));

drop function if exists public.is_financial_audit_table(text);
drop table if exists audit_financial_tables;

-- ---------------------------------------------------------------------
-- Step 6 reverse: restore projects_staff_full_access
-- (schema/001 lines 913-916), dropping the 3 command-specific policies
-- and the FIX ROUND 1 helper function.
-- ---------------------------------------------------------------------
drop policy if exists projects_staff_update on projects;
drop policy if exists projects_staff_insert on projects;
drop policy if exists projects_staff_select on projects;

drop function if exists public.is_org_staff_for_project_row(uuid, uuid);

create policy projects_staff_full_access on projects
  for all to authenticated
  using (is_org_staff_for_org(org_id))
  with check (is_org_staff_for_org(org_id));

-- ---------------------------------------------------------------------
-- Step 5 reverse: restore every Decision-4 table's policy to its exact
-- pre-016 is_org_staff(...) form (verbatim from schema/001, 012, 015),
-- then drop is_financial_staff().
-- ---------------------------------------------------------------------

-- issued_documents (schema/015 lines 614-627)
drop policy if exists issued_documents_staff_full_access on issued_documents;
create policy issued_documents_staff_full_access on issued_documents
  for all to authenticated
  using (
    case document_type
      when 'purchase_order' then is_org_staff((select project_id from material_orders where id = issued_documents.source_id))
      when 'subcontract' then is_org_staff(get_bid_package_project_id(issued_documents.source_id))
    end
  )
  with check (
    case document_type
      when 'purchase_order' then is_org_staff((select project_id from material_orders where id = issued_documents.source_id))
      when 'subcontract' then is_org_staff(get_bid_package_project_id(issued_documents.source_id))
    end
  );

-- material_order_line_items (schema/015 lines 478-481)
drop policy if exists material_order_line_items_staff_full_access on material_order_line_items;
create policy material_order_line_items_staff_full_access on material_order_line_items
  for all to authenticated
  using (is_org_staff((select project_id from material_orders where id = material_order_line_items.material_order_id)))
  with check (is_org_staff((select project_id from material_orders where id = material_order_line_items.material_order_id)));

-- material_orders (schema/015 lines 440-442)
drop policy if exists material_orders_staff_full_access on material_orders;
create policy material_orders_staff_full_access on material_orders
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- bid_addenda (schema/015 lines 371-374)
drop policy if exists bid_addenda_staff_full_access on bid_addenda;
create policy bid_addenda_staff_full_access on bid_addenda
  for all to authenticated
  using (is_org_staff(get_bid_package_project_id(bid_addenda.bid_package_id)))
  with check (is_org_staff(get_bid_package_project_id(bid_addenda.bid_package_id)));

-- bid_questions (schema/015 lines 286-289)
drop policy if exists bid_questions_staff_full_access on bid_questions;
create policy bid_questions_staff_full_access on bid_questions
  for all to authenticated
  using (is_org_staff(get_bid_package_project_id(bid_questions.bid_package_id)))
  with check (is_org_staff(get_bid_package_project_id(bid_questions.bid_package_id)));

-- bid_submissions (schema/015 lines 204-207)
drop policy if exists bid_submissions_staff_full_access on bid_submissions;
create policy bid_submissions_staff_full_access on bid_submissions
  for all to authenticated
  using (is_org_staff(get_bid_package_project_id(bid_submissions.bid_package_id)))
  with check (is_org_staff(get_bid_package_project_id(bid_submissions.bid_package_id)));

-- bid_packages (schema/015 lines 161-163)
drop policy if exists bid_packages_staff_full_access on bid_packages;
create policy bid_packages_staff_full_access on bid_packages
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- credit_ledger (schema/012 lines 310-313)
drop policy if exists credit_ledger_staff_insert on credit_ledger;
create policy credit_ledger_staff_insert on credit_ledger
  for insert to authenticated with check (is_org_staff(project_id));
drop policy if exists credit_ledger_staff_select on credit_ledger;
create policy credit_ledger_staff_select on credit_ledger
  for select to authenticated using (is_org_staff(project_id));

-- project_financial_settings (schema/012 lines 182-184)
drop policy if exists project_financial_settings_staff_only on project_financial_settings;
create policy project_financial_settings_staff_only on project_financial_settings
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- divisions (schema/012 lines 65-67)
drop policy if exists divisions_staff_full on divisions;
create policy divisions_staff_full on divisions
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- import_rows (schema/001 lines 974-977)
drop policy if exists import_rows_staff_only on import_rows;
create policy import_rows_staff_only on import_rows
  for all to authenticated
  using (is_org_staff((select project_id from import_batches b where b.id = batch_id)))
  with check (is_org_staff((select project_id from import_batches b where b.id = batch_id)));

-- import_batches (schema/001 lines 972-973)
drop policy if exists import_batches_staff_only on import_batches;
create policy import_batches_staff_only on import_batches
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- fee_ledger (schema/001 lines 967-970)
drop policy if exists fee_ledger_staff_insert on fee_ledger;
create policy fee_ledger_staff_insert on fee_ledger
  for insert to authenticated with check (is_org_staff(project_id));
drop policy if exists fee_ledger_staff_select on fee_ledger;
create policy fee_ledger_staff_select on fee_ledger
  for select to authenticated using (is_org_staff(project_id));

-- budget_suggestions (schema/001 line 966)
drop policy if exists budget_suggestions_staff_only on budget_suggestions;
create policy budget_suggestions_staff_only on budget_suggestions
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- forecast_entries (schema/001 line 964)
drop policy if exists forecast_entries_staff_only on forecast_entries;
create policy forecast_entries_staff_only on forecast_entries
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- committed_costs (schema/001 line 962)
drop policy if exists committed_costs_staff_only on committed_costs;
create policy committed_costs_staff_only on committed_costs
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- expenses (schema/001 lines 945-947)
drop policy if exists expenses_staff_full_access on expenses;
create policy expenses_staff_full_access on expenses
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- budget_ledger (schema/001 lines 934-937)
drop policy if exists budget_ledger_staff_insert on budget_ledger;
create policy budget_ledger_staff_insert on budget_ledger
  for insert to authenticated with check (is_org_staff(project_id));
drop policy if exists budget_ledger_staff_select on budget_ledger;
create policy budget_ledger_staff_select on budget_ledger
  for select to authenticated using (is_org_staff(project_id));

-- cost_codes (schema/001 lines 927-929)
drop policy if exists cost_codes_staff_full on cost_codes;
create policy cost_codes_staff_full on cost_codes
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- project_fee_rules (schema/001 lines 923-925)
drop policy if exists fee_rules_staff_only on project_fee_rules;
create policy fee_rules_staff_only on project_fee_rules
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

drop function if exists public.is_financial_staff(uuid);

-- ---------------------------------------------------------------------
-- Step 4 reverse: restore is_org_staff() to its exact pre-016 body
-- (schema/001 lines 103-112), preserving the same
-- language/security/search_path clauses.
-- ---------------------------------------------------------------------
create or replace function public.is_org_staff(p_project_id uuid) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  return public.is_org_staff_for_org(
    (select org_id from public.projects where id = p_project_id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Step 3/2 reverse: drop has_project_assignment(), then
-- project_staff_assignments (cascades its own triggers/policy).
-- ---------------------------------------------------------------------
drop function if exists public.has_project_assignment(uuid);

drop table if exists project_staff_assignments;
drop function if exists public.enforce_project_staff_assignment_org_match();
drop function if exists public.enforce_project_staff_assignment_identity_and_revocation();

-- ---------------------------------------------------------------------
-- Step 1a reverse: restore accept_invitation() to its exact pre-016
-- body (schema/009 lines 55-92) — drops the staff_function insert added
-- by this migration.
-- ---------------------------------------------------------------------
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

  insert into public.profiles (id, org_id, role, full_name, email)
  values (auth.uid(), v_invitation.org_id, v_invitation.role, p_full_name, v_invitation.email);

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

-- ---------------------------------------------------------------------
-- Step 1 reverse: drop the staff_function_required_for_staff constraint
-- and staff_function column, then the staff_function type.
-- ---------------------------------------------------------------------
alter table profiles drop constraint if exists staff_function_required_for_staff;
alter table profiles drop column if exists staff_function;
drop type if exists staff_function;
