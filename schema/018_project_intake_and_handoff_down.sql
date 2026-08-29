-- =====================================================================
-- Stone Column Portal — Migration 018 ROLLBACK.
-- Reverses schema/018_project_intake_and_handoff.sql in dependency
-- order. Every restored CREATE POLICY/CREATE FUNCTION body below is
-- copied verbatim from schema/016 (not reconstructed from memory), same
-- "byte-identical round-trip" discipline as schema/016_down.sql and
-- schema/017_down.sql.
--
-- NOTE: Step 2's reverse (`alter column pricing_model set not null`)
-- and Step 3's reverse (`phase` back to plain `text`) will fail loudly
-- if any row written after the up-migration ran violates the
-- constraint being restored (a NULL pricing_model, in particular) —
-- that is correct, intentional behavior for a down migration: it
-- surfaces real data incompatibility rather than silently discarding
-- it. Same posture as every other down migration in this schema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Step 10 reverse: drop the 3-way project_fee_rules policy split,
-- restore fee_rules_staff_only to its exact pre-018 body (schema/016
-- Step 5's Decision-4 swap: `is_financial_staff`, `for all`).
-- ---------------------------------------------------------------------
drop policy if exists project_fee_rules_admin_update on project_fee_rules;
drop policy if exists project_fee_rules_admin_insert on project_fee_rules;
drop policy if exists project_fee_rules_staff_select on project_fee_rules;

create policy fee_rules_staff_only on project_fee_rules
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));

-- ---------------------------------------------------------------------
-- Step 9 reverse: drop set_project_fee_terms(), then the partial unique
-- index this migration's own fix round added alongside it (neither
-- existed before this migration).
-- ---------------------------------------------------------------------
drop function if exists public.set_project_fee_terms(uuid, pricing_model, fee_basis, integer, bigint, text);
drop index if exists project_fee_rules_one_active_per_project;

-- ---------------------------------------------------------------------
-- Step 8 reverse: drop the 018 signature of create_project_with_defaults(),
-- restore the exact pre-018 body (schema/016 lines 620-687, copied
-- verbatim).
-- ---------------------------------------------------------------------
drop function if exists public.create_project_with_defaults(
  uuid, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
);

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

-- ---------------------------------------------------------------------
-- Step 7 reverse: drop project_site_info (cascades its policy/trigger),
-- then intake_item_status.
-- ---------------------------------------------------------------------
drop table if exists project_site_info;
drop type if exists intake_item_status;

-- ---------------------------------------------------------------------
-- Step 6 reverse: drop project_briefs (cascades its policy/trigger).
-- No type was created solely for this table.
-- ---------------------------------------------------------------------
drop table if exists project_briefs;

-- ---------------------------------------------------------------------
-- Step 5 reverse: drop project_clients' new columns, then the three new
-- enum types. No trigger/policy to restore — none were added in Step 5.
-- ---------------------------------------------------------------------
alter table project_clients
  drop column if exists info_status,
  drop column if exists is_billing_contact,
  drop column if exists is_decision_maker,
  drop column if exists preferred_contact_method,
  drop column if exists role,
  drop column if exists preferred_name;

drop type if exists contact_info_status;
drop type if exists contact_method;
drop type if exists contact_role;

-- ---------------------------------------------------------------------
-- Step 4 reverse: drop project_staff_assignments' new columns, then the
-- two new enum types.
-- ---------------------------------------------------------------------
alter table project_staff_assignments
  drop column if exists internal_instructions,
  drop column if exists next_action,
  drop column if exists target_due_date,
  drop column if exists priority,
  drop column if exists requested_work;

drop type if exists handoff_priority;
drop type if exists staff_request_type;

-- ---------------------------------------------------------------------
-- Step 3 reverse: projects.phase back to plain text, drop project_phase.
-- ---------------------------------------------------------------------
alter table projects alter column phase type text using phase::text;
drop type if exists project_phase;

-- ---------------------------------------------------------------------
-- Step 2 reverse: projects.pricing_model back to not null.
-- ---------------------------------------------------------------------
alter table projects alter column pricing_model set not null;

-- ---------------------------------------------------------------------
-- Step 1 reverse: drop generate_project_number(), then
-- project_number_counters.
-- ---------------------------------------------------------------------
drop function if exists public.generate_project_number(uuid);
drop table if exists project_number_counters;
