-- =====================================================================
-- Stone Column Portal — Migration 018: Project Intake & Employee
-- Handoff (Package P3.1). See docs/production-build/P3.1-DESIGN.md and
-- docs/superpowers/plans/2026-08-26-p3.1-project-intake-and-handoff.md
-- (Task 1's section is the authoritative, corrected checklist for this
-- file — it was revised after independent review found real bugs in an
-- earlier draft).
--
-- SUMMARY:
--   - New `project_number_counters` table + `generate_project_number()`
--     SECURITY DEFINER helper: atomic per-org-per-year `SC-YYYY-###`
--     numbering, replacing the caller-supplied `p_project_number` param
--     on create_project_with_defaults().
--   - `projects.pricing_model` becomes nullable (NULL = "to be
--     determined"). `projects.pricing_model_label` is untouched — it
--     stays exactly as it is today (design §2's corrected finding: it
--     is actively read by ProjectListWorkspace.tsx,
--     supabaseFinancialRepository.ts, AdminOverviewScreen.tsx, and
--     AdminFinancialsScreen.tsx).
--   - `projects.phase` converts from bare `text` to a new `project_phase`
--     enum (design §5) — no live code writes it today, verified below
--     rather than assumed.
--   - `project_clients` gains new nullable columns for homeowner/
--     decision-maker/contact-method tracking (design §4). Its existing
--     audit trigger (schema/012's `audit_project_clients`) already
--     covers the new columns — confirmed by reading schema/012 directly,
--     not assumed; no new trigger added here.
--   - New `project_briefs` / `project_site_info` tables (design §§5-6),
--     1:1 with `projects`, reusing schema/012's `log_audit_project_
--     settings()` — NOT `log_audit()`, which indexes off `NEW.id`/
--     `OLD.id` and would crash on these `project_id`-only-keyed tables.
--   - `project_staff_assignments` gains new nullable handoff columns
--     (design §8) — no new RLS policy; the existing
--     `project_staff_assignments_admin_manage` policy is `for all`,
--     already covering UPDATE (confirmed by reading schema/016 directly,
--     not assumed — see the Step 4 comment below).
--   - `create_project_with_defaults()` revised in place: `p_project_number`
--     removed entirely (the RPC now generates it internally);
--     `p_pricing_model`/`p_pricing_model_label`/`p_fee_basis`/
--     `p_fee_basis_points`/`p_fee_fixed_amount_cents` all become optional
--     (default NULL); `project_fee_rules` is only inserted when a
--     fee-supported pricing model AND fee data are both provided.
--   - New `set_project_fee_terms()` RPC: admin-only, atomically
--     supersedes the current `project_fee_rules` row (if any) and
--     updates `projects.pricing_model`/`pricing_model_label` together.
--   - FIX (found during this migration's own verification, not in the
--     original brief): `project_fee_rules`' pre-existing RLS policy
--     (`fee_rules_staff_only`, schema/016) is `is_financial_staff` —
--     admits ANY non-superintendent staff, not just admins. Before this
--     migration that mismatch was latent (project_fee_rules had no
--     direct write path outside the already admin-gated
--     create_project_with_defaults()). set_project_fee_terms() makes it
--     live: without a fix, a non-admin financial-staff session could
--     bypass this RPC's own admin check entirely via a raw
--     `supabase.from("project_fee_rules").insert(...)/.update(...)` —
--     exactly the class of bug independent review found against
--     schema/017's first draft (projects_staff_update). Fixed below by
--     splitting the policy: SELECT stays `is_financial_staff` (read
--     access for existing screens, unchanged), INSERT/UPDATE become
--     admin-only (see Step 9 below).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Step 1: project_number_counters + generate_project_number(). RLS
-- enabled with NO policies, direct grants revoked from
-- authenticated/anon — matching audit_financial_tables' exact
-- precedent (schema/016) for a table meant to be reachable only through
-- a SECURITY DEFINER function, never directly by an authenticated
-- caller.
-- ---------------------------------------------------------------------
create table project_number_counters (
  org_id      uuid not null references orgs(id),
  year        integer not null,
  next_number integer not null default 1,
  primary key (org_id, year)
);

alter table project_number_counters enable row level security;
revoke all on project_number_counters from authenticated, anon;

-- SECURITY DEFINER so it can write project_number_counters (which has
-- no policies at all for `authenticated`) despite being invoked from
-- create_project_with_defaults(), a SECURITY INVOKER function. The
-- single-statement INSERT ... ON CONFLICT DO UPDATE ... RETURNING is
-- Postgres's standard atomic-increment idiom: it takes a row-level lock
-- as part of the same statement, so two concurrent callers for the same
-- org/year serialize on that row and always receive distinct,
-- sequential values.
--
-- FIX (independent review of this migration): this function must still
-- be GRANTed EXECUTE to `authenticated`, because
-- create_project_with_defaults() (SECURITY INVOKER) calls it from
-- within the calling session's own privilege context, which needs
-- EXECUTE on this function to reach it at all — the same reason
-- has_project_assignment()/is_financial_audit_table() (SECURITY
-- DEFINER, called from RLS policies evaluated as `authenticated`) are
-- also granted to `authenticated` despite being internal helpers. That
-- means it IS directly callable by any authenticated session for any
-- org_id, not just the org's own staff — an earlier draft of this
-- migration treated that as bounded/acceptable (design §1's "gaps are
-- acceptable" framing), but independent review empirically reproduced a
-- concrete exploit: a client-role user from Org A directly calling
-- generate_project_number(org_B_id) and successfully advancing Org B's
-- counter, despite having no relationship to Org B at all — a real
-- cross-tenant griefing vector (an attacker could burn through a
-- competitor's/another tenant's whole numbering sequence), not merely a
-- gap in an org's own numbers. Fixed by adding the same org-membership
-- check every other project-scoped SECURITY DEFINER helper in this
-- schema already uses (is_org_staff_for_org(), schema/001) — the
-- legitimate caller (an admin, via create_project_with_defaults()) is
-- unaffected, since an org admin always passes is_org_staff_for_org()
-- for their own org.
create or replace function public.generate_project_number(p_org_id uuid) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from now())::int;
  v_sequence integer;
begin
  if not is_org_staff_for_org(p_org_id) then
    raise exception 'Not authorized to generate a project number for org %.', p_org_id;
  end if;

  insert into project_number_counters (org_id, year, next_number)
  values (p_org_id, v_year, 2)
  on conflict (org_id, year)
    do update set next_number = project_number_counters.next_number + 1
  returning next_number - 1 into v_sequence;

  -- lpad never truncates: lpad('1000', 3, '0') = '1000' unchanged, so
  -- the format grows naturally past 999 (SC-2026-1000) rather than
  -- silently truncating (design §1's explicit requirement).
  return 'SC-' || v_year::text || '-' || lpad(v_sequence::text, 3, '0');
end;
$$;

revoke all on function public.generate_project_number(uuid) from public;
grant execute on function public.generate_project_number(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Step 2: projects.pricing_model -> nullable. pricing_model_label is
-- deliberately NOT touched anywhere in this migration (design §2's
-- corrected finding — it is actively read by three live screens).
-- ---------------------------------------------------------------------
alter table projects alter column pricing_model drop not null;

-- ---------------------------------------------------------------------
-- Step 3: projects.phase -> project_phase enum. Verify zero non-null
-- existing values before the type change (design §5's own promise,
-- confirmed here rather than assumed) — a non-null value that doesn't
-- match one of the six labels below would otherwise fail the `USING
-- phase::project_phase` cast with an opaque error, or worse, silently
-- succeed for a value that happens to coincide with a label.
-- ---------------------------------------------------------------------
do $$
declare
  v_nonnull_count int;
begin
  select count(*) into v_nonnull_count from projects where phase is not null;
  if v_nonnull_count > 0 then
    raise exception 'projects.phase has % non-null value(s) — cannot safely convert to the project_phase enum without a data-migration plan (design §5 assumed zero; this environment has data the design did not anticipate).', v_nonnull_count;
  end if;
end $$;

create type project_phase as enum (
  'lead', 'feasibility', 'preconstruction', 'pricing', 'contract_pending', 'ready_to_start'
);

alter table projects alter column phase type project_phase using phase::project_phase;

-- ---------------------------------------------------------------------
-- Step 4: project_staff_assignments handoff columns (design §8). No new
-- RLS policy — project_staff_assignments_admin_manage (schema/016) is
-- declared `for all to authenticated`, which already covers
-- SELECT/INSERT/UPDATE/DELETE, not just INSERT (confirmed directly
-- against schema/016's own text: "create policy
-- project_staff_assignments_admin_manage ... for all to authenticated
-- using (...) with check (...)"), so these new columns are writable
-- under the existing policy with no change needed here.
-- ---------------------------------------------------------------------
create type staff_request_type as enum (
  'estimating', 'planning', 'site_review', 'permitting', 'scheduling', 'vendor_pricing', 'other'
);
create type handoff_priority as enum ('low', 'normal', 'high', 'urgent');

alter table project_staff_assignments
  add column requested_work         staff_request_type,
  add column priority               handoff_priority not null default 'normal',
  add column target_due_date        date,
  add column next_action            text,
  add column internal_instructions  text;

-- ---------------------------------------------------------------------
-- Step 5: project_clients extension (design §4). schema/012 already
-- attaches `audit_project_clients` (`after insert or update or delete
-- ... execute function public.log_audit()`) to this table — confirmed
-- by reading schema/012 directly — so no new trigger is added here,
-- only the new columns. No new RLS policy either:
-- project_clients_staff_full/_client_read (schema/012) already govern
-- every column on the table, including these.
-- ---------------------------------------------------------------------
create type contact_role as enum (
  'primary_homeowner', 'secondary_homeowner', 'other_household', 'professional_contact'
);
create type contact_method as enum ('email', 'phone', 'text');
create type contact_info_status as enum ('not_started', 'requested', 'partial', 'complete');

alter table project_clients
  add column preferred_name           text,
  add column role                     contact_role,
  add column preferred_contact_method contact_method,
  add column is_decision_maker        boolean not null default false,
  add column is_billing_contact       boolean not null default false,
  add column info_status              contact_info_status not null default 'not_started';

-- ---------------------------------------------------------------------
-- Step 6: project_briefs (design §5, as corrected by the plan doc — the
-- "Concept & Scope" fields; soil/environmental fields belong on
-- project_site_info, Step 7 below, not here). 1:1 with projects, same
-- shape as project_financial_settings (project_id as primary key, no
-- separate id column).
--
-- RLS: project_briefs_staff_full only (is_org_staff, matching
-- project_clients' pattern — not financial data, so not
-- is_financial_staff). No client-read policy in this migration — per
-- the plan doc's own Task 1 test list ("a client session gets zero rows
-- from either table"), client-facing exposure of client_facing_notes
-- (gated on client_facing_notes_published, and internal_notes' blanket
-- exclusion) is a repository-layer concern for Task 2, not an RLS
-- concern for Task 1.
--
-- Audit trigger: log_audit_project_settings() (schema/012), reused —
-- NOT log_audit() (schema/001), which does
-- `case tg_op when 'DELETE' then OLD.id else NEW.id end` and would
-- raise `record "new" has no field "id"` on this project_id-keyed
-- table with no id column at all.
-- ---------------------------------------------------------------------
create table project_briefs (
  project_id                    uuid primary key references projects(id) on delete cascade,
  summary                       text,
  known_scope                   text,
  client_goals                  text,
  must_haves                    text,
  wishlist_items                text,
  known_exclusions              text,
  quality_expectations          text,
  approx_square_footage         integer,
  stories                       numeric,
  bedrooms                      integer,
  bathrooms                     numeric,
  target_budget_low_cents       bigint,
  target_budget_high_cents      bigint,
  confidence_note               text,
  lead_source                   text,
  internal_notes                text,
  client_facing_notes           text,
  client_facing_notes_published boolean not null default false,
  updated_by                    uuid references profiles(id),
  updated_at                    timestamptz not null default now(),
  created_at                    timestamptz not null default now(),

  constraint target_budget_range_consistent check (
    target_budget_low_cents is null or target_budget_high_cents is null
    or target_budget_low_cents <= target_budget_high_cents
  )
);

alter table project_briefs enable row level security;

create policy project_briefs_staff_full on project_briefs
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

create trigger audit_project_briefs after insert or update or delete on project_briefs
  for each row execute function public.log_audit_project_settings();

-- ---------------------------------------------------------------------
-- Step 7: project_site_info (design §6, as corrected — no
-- designer_contact_* columns; engineer/designer/architect contacts go
-- through project_clients with role='professional_contact' (Step 5)
-- instead, per the owner's explicit "one contact surface" ruling).
-- Same 1:1-with-projects shape as project_briefs. No client-read
-- policy at all (this is internal working information, not gated
-- narrative — matches the plan doc's own test list).
--
-- Audit trigger: log_audit_project_settings() (schema/012), reused —
-- same reasoning as project_briefs above.
-- ---------------------------------------------------------------------
create type intake_item_status as enum (
  'unknown', 'requested', 'received', 'not_applicable', 'complete'
);

create table project_site_info (
  project_id                 uuid primary key references projects(id) on delete cascade,
  full_address                text,
  parcel_id                   text,
  ownership_status             text,
  occupied_during_work         boolean,
  permitting_jurisdiction      text,
  hoa_review_required          boolean,
  hoa_status                   intake_item_status not null default 'unknown',
  zoning_notes                 text,
  survey_status                intake_item_status not null default 'unknown',
  architectural_plans_status   intake_item_status not null default 'unknown',
  septic_or_sewer              text,
  water_source                 text,
  utilities_available          text,
  soil_environmental_status    intake_item_status not null default 'unknown',
  soil_environmental_notes     text,
  site_access_notes            text,
  financing_status             intake_item_status not null default 'unknown',
  permit_status                intake_item_status not null default 'unknown',
  required_approvals_notes     text,
  updated_by                   uuid references profiles(id),
  updated_at                   timestamptz not null default now(),
  created_at                   timestamptz not null default now()
);

alter table project_site_info enable row level security;

create policy project_site_info_staff_full on project_site_info
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

create trigger audit_project_site_info after insert or update or delete on project_site_info
  for each row execute function public.log_audit_project_settings();

-- ---------------------------------------------------------------------
-- Step 8: create_project_with_defaults() revised in place.
--
-- Signature change (p_project_number REMOVED, not merely defaulted —
-- the RPC now generates it internally via generate_project_number())
-- means this is a DROP + CREATE, not a same-signature CREATE OR
-- REPLACE — Postgres identifies a function by name + argument list, and
-- removing a parameter from the middle changes that identity.
--
-- p_pricing_model / p_pricing_model_label / p_fee_basis /
-- p_fee_basis_points / p_fee_fixed_amount_cents all become optional
-- (default NULL) per design §2 — p_pricing_model_label must also gain a
-- default here purely because Postgres requires every parameter after
-- the first defaulted one to also have a default; it was already
-- effectively optional (nullable, no behavior change).
--
-- The project_fee_rules insert becomes conditional: only when a
-- fee-supported pricing model (cost_plus_percentage/cost_plus_fixed_fee
-- — unchanged from the JS layer's existing FEE_SUPPORTED_PRICING_MODELS
-- restriction) AND a non-null fee_basis are both supplied. The
-- fee_basis/amount consistency validation itself, however, still runs
-- whenever fee_basis is supplied AT ALL, independent of pricing_model —
-- a JUDGMENT CALL: if a caller supplies internally-inconsistent fee
-- data (e.g. fee_basis='percentage' with both fee_basis_points and
-- fee_fixed_amount_cents set), that is a caller bug worth surfacing
-- loudly regardless of whether the pricing model would have caused the
-- resulting row to be skipped anyway — silently swallowing bad input
-- because it "wouldn't have been persisted" would be a worse failure
-- mode than raising.
-- ---------------------------------------------------------------------
drop function if exists public.create_project_with_defaults(
  uuid, text, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
);

create or replace function public.create_project_with_defaults(
  p_org_id uuid,
  p_name text,
  p_address text,
  p_project_type text,
  p_pricing_model pricing_model default null,
  p_pricing_model_label text default null,
  p_fee_basis fee_basis default null,
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
  v_project_number text;
  v_staff_id uuid;
  v_client_id uuid;
begin
  if not is_org_admin_for_org(p_org_id) then
    raise exception 'Only an org admin may create a project.';
  end if;

  -- Clean, explicit validation before hitting project_fee_rules' raw
  -- fee_basis_amount_present CHECK constraint (unchanged reasoning from
  -- the pre-018 body — independent review finding B4) -- now only
  -- reachable when p_fee_basis is non-null (a NULL fee_basis short-
  -- circuits both IF conditions to NULL, which is falsy, so no
  -- exception when pricing is deferred entirely).
  if p_fee_basis = 'percentage' and (p_fee_basis_points is null or p_fee_fixed_amount_cents is not null) then
    raise exception 'fee_basis=percentage requires fee_basis_points and no fee_fixed_amount_cents.';
  end if;
  if p_fee_basis = 'fixed' and (p_fee_fixed_amount_cents is null or p_fee_basis_points is not null) then
    raise exception 'fee_basis=fixed requires fee_fixed_amount_cents and no fee_basis_points.';
  end if;

  v_project_number := generate_project_number(p_org_id);

  insert into projects (org_id, name, project_number, address, project_type,
                         status, pricing_model, pricing_model_label, created_by)
  values (p_org_id, p_name, v_project_number, p_address, p_project_type,
          'draft', p_pricing_model, p_pricing_model_label, auth.uid())
  returning id into v_project_id;

  if p_pricing_model in ('cost_plus_percentage', 'cost_plus_fixed_fee') and p_fee_basis is not null then
    insert into project_fee_rules (project_id, fee_basis, fee_basis_points, fee_fixed_amount_cents, created_by)
    values (v_project_id, p_fee_basis, p_fee_basis_points, p_fee_fixed_amount_cents, auth.uid());
  end if;

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
  uuid, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
) from public;
grant execute on function public.create_project_with_defaults(
  uuid, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
) to authenticated;

-- ---------------------------------------------------------------------
-- Step 9: set_project_fee_terms() — the new capability that makes
-- deferring pricing at creation meaningful (design §2). Admin-only,
-- same is_org_admin_for_org() pattern as create_project_with_defaults()
-- and change_project_status() (schema/017), SECURITY INVOKER (matching
-- both). Atomically supersedes the current project_fee_rules row (the
-- one with effective_to IS NULL — this is the exact "current row"
-- convention already relied on by supabaseFinancialRepository.ts's
-- getFeeRule(), which selects `.is("effective_to", null)`) and updates
-- projects.pricing_model/pricing_model_label together, never drifting
-- apart.
--
-- JUDGMENT CALL (supersede vs. update-in-place): project_fee_rules has
-- no unique constraint on project_id (it is deliberately append-only
-- and effective-dated — see schema/001's own comment immediately after
-- the table: "Rows here are never updated once an invoice has been
-- issued against them ... Only insert a new row with a new
-- effective_from/effective_to to change fee terms going forward").
-- An UPDATE-in-place would violate that documented design intent and
-- would also destroy the historical record of what the terms used to
-- be. This function instead closes out the currently-active row (if
-- any) by setting its effective_to = now(), then INSERTs a fresh row —
-- the same supersede shape already used by committed_costs/
-- forecast_entries (schema/003), applied here without a dedicated
-- superseded_by_id column since project_fee_rules doesn't have one and
-- adding one is beyond this task's scope.
--
-- FIX (independent review of this migration — real defect, not
-- theoretical): an earlier draft of this "close old row, then insert
-- new row" sequence had no locking at all. Two concurrent calls for the
-- SAME project could each independently observe "no active row yet" (or
-- the same active row, pre-close) and both proceed to INSERT, leaving
-- TWO rows with effective_to IS NULL simultaneously — which breaks
-- supabaseFinancialRepository.ts's getFeeRule() (`.is("effective_to",
-- null)` combined with `.single()`, which throws on >1 row), taking
-- down AdminFinancialsScreen for that project. schema/003's own
-- supersede_committed_cost()/supersede_forecast() precedent this
-- function's comment already claims parity with actually relies on TWO
-- safeguards this earlier draft omitted: `select ... for update` on the
-- row being superseded, AND (forecast_entries specifically) a partial
-- unique index enforcing at most one active row per key at the database
-- level, not just in application logic. Both are added below:
--   1. `select id from projects where id = p_project_id for update`
--      locks the parent project row for the duration of this
--      transaction, so two concurrent set_project_fee_terms() calls for
--      the same project fully serialize — the second call only
--      proceeds once the first has committed (or rolled back), and by
--      then always sees the first's already-inserted current row (if
--      the first succeeded), so it correctly supersedes it instead of
--      racing to insert a second "active" row. This covers the
--      first-ever-call case too (no existing project_fee_rules row for
--      either transaction to lock onto), which a `for update` on
--      project_fee_rules itself could not — schema/003's committed_costs/
--      forecast_entries supersede RPCs never face this case, since they
--      always supersede an existing, caller-identified row (`p_old_id`
--      is required, not optional).
--   2. `project_fee_rules_one_active_per_project`, a partial unique
--      index mirroring `forecast_entries_one_active_per_cost_code`
--      (schema/001) exactly — a hard, unconditional database-level
--      guarantee (not merely an application-logic convention) that at
--      most one row per project can ever have effective_to IS NULL,
--      so even a future bug that bypassed this function's locking
--      entirely could not silently corrupt the "current row" invariant;
--      it would surface as a loud constraint-violation error instead.
--
-- JUDGMENT CALL (pricing_model restriction): unlike
-- create_project_with_defaults()'s conditional insert, this function
-- ALWAYS inserts a project_fee_rules row, so it must reject an
-- unsupported pricing_model outright rather than silently skip —
-- otherwise a caller could create a fee rule that visually contradicts
-- projects.pricing_model (e.g. a percentage fee row underneath
-- pricing_model='fixed_price'). Enforces the same
-- FEE_SUPPORTED_PRICING_MODELS restriction the JS layer already applies
-- to create_project_with_defaults() (projectService.ts), moved
-- server-side as the authoritative check for this RPC specifically,
-- matching this codebase's existing "the guard belongs at the one seam
-- every caller funnels through" precedent.
-- ---------------------------------------------------------------------
create unique index project_fee_rules_one_active_per_project
  on project_fee_rules (project_id)
  where effective_to is null;

create or replace function public.set_project_fee_terms(
  p_project_id uuid,
  p_pricing_model pricing_model,
  p_fee_basis fee_basis,
  p_fee_basis_points integer default null,
  p_fee_fixed_amount_cents bigint default null,
  p_pricing_model_label text default null
) returns void
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from projects where id = p_project_id;
  if v_org_id is null then
    raise exception 'Project % not found or not accessible.', p_project_id;
  end if;

  if not is_org_admin_for_org(v_org_id) then
    raise exception 'Only an org admin may set a project''s pricing/fee terms.';
  end if;

  -- Serializes concurrent set_project_fee_terms() calls for this SAME
  -- project (see the FIX comment above the function for why): the
  -- second concurrent caller blocks here until the first's transaction
  -- commits or rolls back, so it always observes the first's completed
  -- effect (an already-superseded old row + an already-inserted new
  -- current row, if the first succeeded) rather than racing it.
  perform 1 from projects where id = p_project_id for update;

  if p_pricing_model not in ('cost_plus_percentage', 'cost_plus_fixed_fee') then
    raise exception 'set_project_fee_terms() only supports cost_plus_percentage or cost_plus_fixed_fee pricing models today.';
  end if;

  if p_fee_basis = 'percentage' and (p_fee_basis_points is null or p_fee_fixed_amount_cents is not null) then
    raise exception 'fee_basis=percentage requires fee_basis_points and no fee_fixed_amount_cents.';
  end if;
  if p_fee_basis = 'fixed' and (p_fee_fixed_amount_cents is null or p_fee_basis_points is not null) then
    raise exception 'fee_basis=fixed requires fee_fixed_amount_cents and no fee_basis_points.';
  end if;

  update project_fee_rules
  set effective_to = now()
  where project_id = p_project_id and effective_to is null;

  insert into project_fee_rules (project_id, fee_basis, fee_basis_points, fee_fixed_amount_cents, created_by)
  values (p_project_id, p_fee_basis, p_fee_basis_points, p_fee_fixed_amount_cents, auth.uid());

  update projects
  set pricing_model = p_pricing_model, pricing_model_label = p_pricing_model_label
  where id = p_project_id;
end;
$$;

revoke all on function public.set_project_fee_terms(uuid, pricing_model, fee_basis, integer, bigint, text) from public;
grant execute on function public.set_project_fee_terms(uuid, pricing_model, fee_basis, integer, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- Step 10: FIX — project_fee_rules RLS split (see this file's header
-- comment for full rationale). SELECT keeps the existing
-- is_financial_staff visibility (read access for the existing
-- AdminFinancialsScreen/getFeeRule() path is unchanged, still available
-- to project_manager/accounting/general staff, not just admins).
-- INSERT/UPDATE become admin-only, matching set_project_fee_terms()'s
-- own authorization exactly — the RPC is the sanctioned entry point;
-- this closes the raw-PostgREST bypass. No DELETE policy is added
-- (none effectively existed in spirit — see schema/001's "rows here are
-- never updated/deleted" comment on this table — this migration simply
-- stops a latent, never-actually-relied-upon DELETE grant from
-- surviving the split).
-- ---------------------------------------------------------------------
drop policy fee_rules_staff_only on project_fee_rules;

create policy project_fee_rules_staff_select on project_fee_rules
  for select to authenticated
  using (is_financial_staff(project_id));

create policy project_fee_rules_admin_insert on project_fee_rules
  for insert to authenticated
  with check (is_org_admin_for_org((select org_id from projects where id = project_id)));

create policy project_fee_rules_admin_update on project_fee_rules
  for update to authenticated
  using (is_org_admin_for_org((select org_id from projects where id = project_id)))
  with check (is_org_admin_for_org((select org_id from projects where id = project_id)));
