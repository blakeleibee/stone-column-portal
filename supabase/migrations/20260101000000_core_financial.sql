-- =====================================================================
-- Stone Column Portal — Migration 001: Core project & financial model
-- Target: Supabase Postgres 15+ (uses `security_invoker` views).
--
-- This is a full rewrite following an independent security/correctness
-- review of the first draft. See docs/PACKAGE_01_CORRECTIONS_V2.md for
-- the item-by-item record of what changed and why. Notably:
--   - staff/admin access is now ORG-scoped (via profiles.org_id), not
--     project_members-scoped — project_members is now exclusively how
--     CLIENTS and (later) VENDORS are scoped to specific projects. This
--     also resolves a chicken-and-egg RLS bootstrap problem (see the
--     bottom of this file).
--   - expenses now separate financial_status (pending/posted/void) from
--     publication_status (internal/ready/published/withdrawn).
--   - fee/retainage rates are integer basis points, never a JS/SQL
--     float percentage.
--   - cross-project reference integrity is enforced with composite
--     foreign keys, not triggers, everywhere Postgres allows it.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- Orgs & profiles
-- ---------------------------------------------------------------------
create table orgs (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  created_at    timestamptz not null default now()
);

create type app_role as enum ('admin', 'staff', 'client', 'vendor');

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  org_id        uuid not null references orgs(id),
  role          app_role not null,
  full_name     text not null,
  email         text not null,
  phone         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- =====================================================================
-- Access-control helper functions
--
-- SECURITY DEFINER functions bypass RLS (via table-owner privilege) so
-- they can safely query profiles/project_members to make an access
-- decision without recursing into the RLS policies that call them. Per
-- review item 8: every one of these sets an explicit search_path and
-- schema-qualifies every object it touches, and EXECUTE is revoked from
-- PUBLIC and re-granted only to `authenticated`.
-- =====================================================================

-- Org-level staff/admin check (role = 'admin' OR 'staff'). This is the
-- PRIMARY access-control predicate for internal (non-client) data: a
-- 2-person GC's staff can see every project in their org, not just ones
-- they've been explicitly added to. Also sidesteps a real bootstrap
-- problem — see the bottom of this file.
create or replace function public.is_org_staff_for_org(p_org_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and org_id = p_org_id
      and role in ('admin', 'staff') and is_active
  );
$$;

-- Admin-only (not staff) — used for profile/role management specifically.
create or replace function public.is_org_admin_for_org(p_org_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and org_id = p_org_id
      and role = 'admin' and is_active
  );
$$;

-- Convenience wrapper for tables that store project_id directly: looks
-- up the project's org and defers to is_org_staff_for_org. Not used for
-- the `projects` table's own INSERT check (see bootstrap note) because
-- a self-join against the row currently being inserted is unreliable —
-- projects' own policy uses is_org_staff_for_org(org_id) directly on
-- the incoming row instead.
--
-- NOTE ON ORDERING: this function's body references public.projects,
-- which is not created until further down this file. A prior version of
-- this comment claimed Postgres never validates table/column references
-- inside a function body at CREATE FUNCTION time regardless of language
-- — that is true for `plpgsql` (the body is stored as an opaque string,
-- checked only at first call) but false for `LANGUAGE SQL`, which a real
-- hosted Postgres instance DOES validate against the catalog at creation
-- time (first surfaced 2026-08-06, running this migration against a real
-- hosted Supabase project for the first time ever — every prior test run
-- used PGlite, which did not enforce this). Fixed here by using
-- `plpgsql` instead of `sql`, which was always the intent ("by the time
-- this function is actually called, `projects` will exist").
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

-- Clients are scoped per-project via project_members, NOT org-wide.
-- LANGUAGE plpgsql for the same forward-reference reason as
-- is_org_staff above (project_members is created further down this file).
create or replace function public.is_project_client(p_project_id uuid) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1 from public.project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and member_role = 'client'
  );
end;
$$;

revoke all on function public.is_org_staff_for_org(uuid) from public;
revoke all on function public.is_org_admin_for_org(uuid) from public;
revoke all on function public.is_org_staff(uuid) from public;
revoke all on function public.is_project_client(uuid) from public;
grant execute on function public.is_org_staff_for_org(uuid) to authenticated;
grant execute on function public.is_org_admin_for_org(uuid) to authenticated;
grant execute on function public.is_org_staff(uuid) to authenticated;
grant execute on function public.is_project_client(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Projects (Section 1 — Project Setup Wizard fields)
-- ---------------------------------------------------------------------
create type project_status as enum ('draft', 'active', 'on_hold', 'closed_out', 'archived');
create type pricing_model as enum (
  'cost_plus_percentage', 'cost_plus_fixed_fee', 'fixed_price',
  'time_and_materials', 'hybrid_custom', 'other'
);
create type billing_frequency as enum ('monthly', 'milestone', 'draw_schedule', 'custom');

create table projects (
  id                        uuid primary key default uuid_generate_v4(),
  org_id                    uuid not null references orgs(id),
  name                      text not null,
  project_number            text not null,
  address                   text,
  project_type              text,
  description               text,
  status                    project_status not null default 'draft',
  phase                     text,
  start_date                date,
  target_completion_date    date,
  lead_user_id              uuid references profiles(id),
  internal_notes            text,

  pricing_model             pricing_model not null,
  pricing_model_label       text,

  currency                  text not null default 'USD',
  timezone                  text not null default 'America/New_York',

  gmp_enabled               boolean not null default false,
  gmp_amount_cents          bigint,
  deposit_amount_cents      bigint,
  billing_frequency         billing_frequency,
  payment_terms             text,

  is_draft                  boolean not null default true,
  created_by                uuid references profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Review item 12: GMP amount required when enabled, forbidden when not.
  constraint gmp_amount_matches_flag check (
    (gmp_enabled and gmp_amount_cents is not null) or
    (not gmp_enabled and gmp_amount_cents is null)
  ),
  constraint gmp_amount_nonnegative check (gmp_amount_cents is null or gmp_amount_cents >= 0),
  constraint deposit_amount_nonnegative check (deposit_amount_cents is null or deposit_amount_cents >= 0),
  -- Review item 12: project number unique within an org, controlled currency format.
  constraint projects_number_unique_per_org unique (org_id, project_number),
  constraint currency_format check (currency ~ '^[A-Z]{3}$')
);

-- fee/retainage rates are INTEGER BASIS POINTS (review item 6) — never a
-- float. 1500 = 15.00%. Denominator is always 10,000 (see fee.ts).
create type fee_basis as enum ('percentage', 'fixed');

create table project_fee_rules (
  id                          uuid primary key default uuid_generate_v4(),
  project_id                  uuid not null references projects(id) on delete cascade,
  fee_basis                   fee_basis not null,
  fee_basis_points             integer,              -- e.g. 1500 = 15.00%; null unless fee_basis='percentage'
  fee_fixed_amount_cents      bigint,
  tax_treatment               text,
  freight_treatment           text,
  owner_direct_purchases_excluded boolean not null default true,
  contingency_fee_eligible    boolean not null default false,
  allowance_fee_eligible      boolean not null default true,
  retainage_basis_points       integer not null default 0,   -- e.g. 500 = 5.00%
  effective_from              timestamptz not null default now(),
  effective_to                timestamptz,
  created_by                  uuid references profiles(id),
  created_at                  timestamptz not null default now(),

  constraint fee_basis_amount_present check (
    (fee_basis = 'percentage' and fee_basis_points is not null and fee_fixed_amount_cents is null) or
    (fee_basis = 'fixed' and fee_fixed_amount_cents is not null and fee_basis_points is null)
  ),
  -- Review item 12: rates within a sane range. 0–10000 bp = 0–100%. This
  -- is a sanity bound, not a business rule — a genuine need to exceed it
  -- is a deliberate schema change, not a silent overflow.
  constraint fee_basis_points_range check (fee_basis_points is null or fee_basis_points between 0 and 10000),
  constraint retainage_basis_points_range check (retainage_basis_points between 0 and 10000),
  constraint fee_fixed_amount_nonnegative check (fee_fixed_amount_cents is null or fee_fixed_amount_cents >= 0)
);
-- Rows here are never updated once an invoice has been issued against
-- them (Package 4 enforces via trigger once invoices exist). Only
-- insert a new row with a new effective_from/effective_to to change fee
-- terms going forward.

-- project_members is now used EXCLUSIVELY for client/vendor project
-- scoping. Staff/admin access is org-wide via is_org_staff_for_org() —
-- see the helper functions above and the bootstrap note at the bottom.
create table project_members (
  id            uuid primary key default uuid_generate_v4(),
  project_id    uuid not null references projects(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  member_role   app_role not null,
  is_primary    boolean not null default false,
  added_at      timestamptz not null default now(),
  unique (project_id, user_id),
  constraint project_members_client_or_vendor_only check (member_role in ('client', 'vendor'))
);

-- ---------------------------------------------------------------------
-- Cost codes (budget categories)
-- ---------------------------------------------------------------------
create type cost_code_status as enum (
  'not_started', 'active', 'substantially_complete', 'complete', 'closed'
);

create table cost_codes (
  id            uuid primary key default uuid_generate_v4(),
  project_id    uuid not null references projects(id) on delete cascade,
  code          text not null,
  sort_order    integer not null default 0,
  fee_eligible  boolean not null default true,
  status        cost_code_status not null default 'not_started',
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (project_id, code),
  -- Enables composite FKs from expenses/committed_costs/forecast_entries/
  -- budget_suggestions so Postgres itself rejects a cost_code_id from a
  -- different project than the referencing row's project_id (review item 7).
  unique (id, project_id)
);

-- ---------------------------------------------------------------------
-- Append-only budget ledger
-- ---------------------------------------------------------------------
create type budget_entry_type as enum ('original', 'approved_change', 'correction');

create table budget_ledger (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid not null references projects(id) on delete cascade,
  cost_code_id      uuid not null,
  entry_type        budget_entry_type not null,
  amount_cents      bigint not null,
  source_type       text,
  source_id         uuid,
  reverses_entry_id uuid,
  is_adjustment     boolean not null default false,  -- true = intentionally exceeds original magnitude; see reversal-integrity trigger below
  note              text,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),

  constraint budget_ledger_cost_code_project_fk
    foreign key (cost_code_id, project_id) references cost_codes(id, project_id),
  -- Review item 7/10: a reversal must reference a row for the SAME cost
  -- code (transitively the same project, since cost_code->project is fixed).
  constraint budget_ledger_reversal_same_cost_code_fk
    foreign key (reverses_entry_id, cost_code_id) references budget_ledger(id, cost_code_id),
  constraint budget_ledger_no_self_reversal check (reverses_entry_id is null or reverses_entry_id <> id),
  -- Review item 10: only 'correction' rows may populate reverses_entry_id.
  constraint budget_ledger_reversal_requires_correction_type
    check (entry_type = 'correction' or reverses_entry_id is null),
  -- Review item 12: an 'original' entry can't be negative (a credit is
  -- always modeled as a correction/approved_change against it).
  constraint budget_ledger_original_nonnegative
    check (entry_type <> 'original' or amount_cents >= 0),
  unique (id, cost_code_id)
);

-- ---------------------------------------------------------------------
-- Expenses — financial_status and publication_status are SEPARATE
-- (review item 3). financial_status controls whether the money is real
-- for cost/fee/forecast/reconciliation purposes; publication_status
-- controls only what a client can see. A posted-but-unpublished expense
-- is real money the client can't see yet; there is no combination that
-- lets an unposted expense affect any official total.
-- ---------------------------------------------------------------------
create type expense_financial_status as enum ('pending', 'posted', 'void');
create type expense_publication_status as enum ('internal', 'ready', 'published', 'withdrawn');

create table expenses (
  id                      uuid primary key default uuid_generate_v4(),
  project_id              uuid not null references projects(id) on delete cascade,
  cost_code_id            uuid not null,
  vendor_name             text not null,
  transaction_date        date not null,
  description_internal    text,
  description_client      text,
  amount_cents            bigint not null,

  financial_status        expense_financial_status not null default 'pending',
  publication_status      expense_publication_status not null default 'internal',
  fee_eligible_override    boolean,

  source_type             text not null default 'manual',
  import_batch_id         uuid,
  source_reference        text,

  onedrive_item_id        text,
  onedrive_last_synced_at timestamptz,

  corrects_expense_id     uuid,

  created_by              uuid references profiles(id),
  created_at              timestamptz not null default now(),
  posted_by               uuid references profiles(id),
  posted_at               timestamptz,
  published_by            uuid references profiles(id),
  published_at            timestamptz,

  constraint expenses_cost_code_project_fk
    foreign key (cost_code_id, project_id) references cost_codes(id, project_id),
  -- Review item 3/7: a correction must reference an expense in the SAME
  -- project, and can't reference itself.
  constraint expenses_correction_same_project_fk
    foreign key (corrects_expense_id, project_id) references expenses(id, project_id),
  constraint expenses_no_self_correction check (corrects_expense_id is null or corrects_expense_id <> id),

  constraint expenses_posted_requires_poster
    check (financial_status <> 'posted' or (posted_by is not null and posted_at is not null)),
  constraint expenses_published_requires_publisher
    check (publication_status <> 'published' or (published_by is not null and published_at is not null)),

  -- Review item 3: a pending expense can never be publication-visible;
  -- a void expense is always frozen as withdrawn (never left "published"
  -- pointing at money that turned out not to be real).
  constraint expenses_pending_is_internal_only
    check (financial_status <> 'pending' or publication_status = 'internal'),
  constraint expenses_void_is_withdrawn
    check (financial_status <> 'void' or publication_status = 'withdrawn'),

  unique (id, project_id)
);

-- (import_batch_id FK to import_batches is added further down, once
-- import_batches exists.)

-- ---------------------------------------------------------------------
-- Committed costs
-- ---------------------------------------------------------------------
create table committed_costs (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid not null references projects(id) on delete cascade,
  cost_code_id      uuid not null,
  vendor_name       text,
  amount_cents      bigint not null,
  source_type       text,
  source_id         uuid,
  status            text not null default 'open',
  superseded_at     timestamptz,
  superseded_by_id  uuid references committed_costs(id),
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),

  constraint committed_costs_cost_code_project_fk
    foreign key (cost_code_id, project_id) references cost_codes(id, project_id),
  constraint committed_costs_status_valid check (status in ('open', 'fulfilled', 'cancelled')),
  -- Review item 12: a commitment amount is a forward obligation, never negative.
  constraint committed_costs_amount_nonnegative check (amount_cents >= 0)
);

-- ---------------------------------------------------------------------
-- Forecast-to-complete
-- ---------------------------------------------------------------------
create table forecast_entries (
  id                         uuid primary key default uuid_generate_v4(),
  project_id                 uuid not null references projects(id) on delete cascade,
  cost_code_id               uuid not null,
  forecast_to_complete_cents bigint not null,
  method                     text not null,
  source_suggestion_id       uuid,
  note                       text,
  created_by                 uuid references profiles(id),
  created_at                 timestamptz not null default now(),
  superseded_at              timestamptz,

  constraint forecast_entries_cost_code_project_fk
    foreign key (cost_code_id, project_id) references cost_codes(id, project_id),
  constraint forecast_entries_method_valid check (method in ('manual', 'accepted_suggestion')),
  constraint forecast_entries_amount_nonnegative check (forecast_to_complete_cents >= 0)
);

-- Review item 12: at most one ACTIVE (non-superseded) forecast per cost
-- code, enforced natively via a partial unique index rather than a
-- trigger or application convention.
create unique index forecast_entries_one_active_per_cost_code
  on forecast_entries (cost_code_id)
  where superseded_at is null;

-- ---------------------------------------------------------------------
-- Suggested under/over budget forecasts
-- ---------------------------------------------------------------------
create type suggestion_status as enum ('pending', 'accepted', 'edited', 'dismissed');

create table budget_suggestions (
  id                     uuid primary key default uuid_generate_v4(),
  project_id             uuid not null references projects(id) on delete cascade,
  cost_code_id           uuid not null,
  suggested_amount_cents bigint not null,
  direction              text not null,
  reason                 text not null,
  source_type            text not null,
  evidence_refs          jsonb not null default '[]'::jsonb,
  confidence             text not null,
  generated_at           timestamptz not null default now(),
  status                 suggestion_status not null default 'pending',
  resolved_by            uuid references profiles(id),
  resolved_at            timestamptz,
  resolved_amount_cents  bigint,

  constraint budget_suggestions_cost_code_project_fk
    foreign key (cost_code_id, project_id) references cost_codes(id, project_id),
  constraint budget_suggestions_direction_valid check (direction in ('over', 'under')),
  constraint budget_suggestions_confidence_valid check (confidence in ('low', 'medium', 'high')),
  -- Review item 12: a resolved suggestion must show who/when resolved it;
  -- an accepted one must show the final amount actually used.
  constraint budget_suggestions_resolution_requires_resolver
    check (status = 'pending' or (resolved_by is not null and resolved_at is not null)),
  constraint budget_suggestions_accepted_requires_amount
    check (status <> 'accepted' or resolved_amount_cents is not null)
);

-- ---------------------------------------------------------------------
-- Fee ledger
-- ---------------------------------------------------------------------
create table fee_ledger (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid not null references projects(id) on delete cascade,
  source_type       text not null,
  source_id         uuid not null,
  fee_amount_cents  bigint not null,
  reverses_entry_id uuid,
  is_adjustment     boolean not null default false,
  created_at        timestamptz not null default now(),

  constraint fee_ledger_reversal_same_project_fk
    foreign key (reverses_entry_id, project_id) references fee_ledger(id, project_id),
  constraint fee_ledger_no_self_reversal check (reverses_entry_id is null or reverses_entry_id <> id),
  -- Review item 10: only a 'reversal_adjustment' row may populate reverses_entry_id.
  constraint fee_ledger_reversal_requires_type
    check (source_type = 'reversal_adjustment' or reverses_entry_id is null),
  constraint fee_ledger_source_type_valid
    check (source_type in ('expense_accrual', 'invoice_issued', 'reversal_adjustment')),
  unique (id, project_id)
);

-- ---------------------------------------------------------------------
-- Import batches
-- ---------------------------------------------------------------------
create type import_batch_status as enum ('processing', 'ready_for_review', 'confirmed', 'cancelled');

create table import_batches (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references projects(id) on delete cascade,
  source_filename text not null,
  report_type     text,
  status          import_batch_status not null default 'processing',
  row_count       integer not null default 0,
  imported_by     uuid references profiles(id),
  imported_at     timestamptz not null default now()
);

alter table expenses
  add constraint expenses_import_batch_fk
  foreign key (import_batch_id) references import_batches(id);

create table import_rows (
  id                 uuid primary key default uuid_generate_v4(),
  batch_id           uuid not null references import_batches(id) on delete cascade,
  row_number         integer not null,
  raw_data           jsonb not null,
  match_status       text not null,
  matched_expense_id uuid references expenses(id),
  error_message      text,

  constraint import_rows_match_status_valid
    check (match_status in ('new', 'changed', 'duplicate', 'unmatched', 'error', 'excluded'))
);

-- ---------------------------------------------------------------------
-- Audit log — append-only, project-scoped (review item 1), written only
-- by the log_audit() trigger (review item 3).
-- ---------------------------------------------------------------------
create table audit_log (
  id           uuid primary key default uuid_generate_v4(),
  -- project_id is populated by the trigger from NEW/OLD.project_id for
  -- every table this fires on (all of them have a direct project_id
  -- column in this revision — see the cost_code composite-FK rework
  -- above). Nullable only in case a future table without project scope
  -- (e.g. profiles) is ever added to the trigger set.
  project_id   uuid references projects(id),
  table_name   text not null,
  record_id    uuid not null,
  action       text not null,
  actor_id     uuid,
  before_data  jsonb,
  after_data   jsonb,
  created_at   timestamptz not null default now()
);

-- =====================================================================
-- Append-only / immutability enforcement (database-level)
--
-- These triggers fire for ANY role, including a service_role key that
-- bypasses RLS entirely — RLS controls row visibility, not mutation
-- rights, so it is never the sole enforcement layer here.
-- =====================================================================

create or replace function public.reject_mutation() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    'Table % is append-only: % is not permitted. Insert a reversing/adjusting row instead.',
    tg_table_name, tg_op;
end;
$$;

create or replace function public.reject_delete() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    'Rows in % cannot be deleted. Use status/superseded_at/is_archived instead.',
    tg_table_name;
end;
$$;

-- budget_ledger, fee_ledger, audit_log: no update or delete, ever.
create trigger budget_ledger_append_only before update or delete on budget_ledger
  for each row execute function public.reject_mutation();
create trigger fee_ledger_append_only before update or delete on fee_ledger
  for each row execute function public.reject_mutation();
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function public.reject_mutation();

revoke update, delete on budget_ledger from authenticated, anon;
revoke update, delete on fee_ledger from authenticated, anon;
revoke update, delete, insert on audit_log from authenticated, anon;

-- committed_costs / forecast_entries / budget_suggestions: update is
-- allowed (supersede pattern: setting superseded_at/superseded_by_id,
-- or resolving a suggestion), but DELETE is never allowed — review item
-- 5 ("active or superseded commitments cannot disappear", "forecast
-- history cannot be hard-deleted").
create trigger committed_costs_no_delete before delete on committed_costs
  for each row execute function public.reject_delete();
create trigger forecast_entries_no_delete before delete on forecast_entries
  for each row execute function public.reject_delete();
create trigger budget_suggestions_no_delete before delete on budget_suggestions
  for each row execute function public.reject_delete();

revoke delete on committed_costs from authenticated, anon;
revoke delete on forecast_entries from authenticated, anon;
revoke delete on budget_suggestions from authenticated, anon;

-- cost_codes: delete allowed ONLY if nothing references it yet (truly
-- unused). Once any budget_ledger/expense/committed_cost/forecast/
-- suggestion references it, delete is rejected — archive it instead.
create or replace function public.reject_cost_code_delete_if_used() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.budget_ledger where cost_code_id = OLD.id)
     or exists (select 1 from public.expenses where cost_code_id = OLD.id)
     or exists (select 1 from public.committed_costs where cost_code_id = OLD.id)
     or exists (select 1 from public.forecast_entries where cost_code_id = OLD.id)
     or exists (select 1 from public.budget_suggestions where cost_code_id = OLD.id)
  then
    raise exception 'Cost code % is in use and cannot be deleted. Archive it instead (is_archived = true).', OLD.id;
  end if;
  return OLD;
end;
$$;

create trigger cost_codes_no_delete_if_used before delete on cost_codes
  for each row execute function public.reject_cost_code_delete_if_used();

-- =====================================================================
-- Expense state machine (review items 3 & 4)
--
-- financial_status: pending -> posted -> void. No other transition.
-- Once posted, financial fields (amount/cost code/vendor/date/project)
-- are frozen. Once void, the row is frozen entirely — no further update
-- of ANY kind. DELETE is only permitted while still 'pending' (a
-- reviewed-but-not-yet-real import row); posted or void rows can never
-- be deleted, only voided/corrected.
-- =====================================================================

create or replace function public.enforce_expense_state_transition() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Void is a terminal state: absolutely no further changes.
  if OLD.financial_status = 'void' then
    raise exception 'Expense % is void and is immutable — no further changes are permitted.', OLD.id;
  end if;

  -- financial_status may only move pending -> posted -> void, one step
  -- at a time, never backward and never skipped-then-reverted.
  if NEW.financial_status <> OLD.financial_status then
    if not (
      (OLD.financial_status = 'pending' and NEW.financial_status = 'posted') or
      (OLD.financial_status = 'posted' and NEW.financial_status = 'void')
    ) then
      raise exception 'Invalid expense financial_status transition: % -> % (id=%)',
        OLD.financial_status, NEW.financial_status, OLD.id;
    end if;
  end if;

  -- Once posted (including in the same statement that just posted it),
  -- financial fields are frozen. A correction is a new row referencing
  -- this one via corrects_expense_id, never an edit here.
  if OLD.financial_status = 'posted' and (
    NEW.amount_cents     is distinct from OLD.amount_cents or
    NEW.cost_code_id     is distinct from OLD.cost_code_id or
    NEW.vendor_name      is distinct from OLD.vendor_name or
    NEW.transaction_date is distinct from OLD.transaction_date or
    NEW.project_id       is distinct from OLD.project_id
  ) then
    raise exception
      'Cannot edit financial fields of a posted expense (id=%). Void it and insert a corrected expense with corrects_expense_id set.',
      OLD.id;
  end if;

  return NEW;
end;
$$;

create trigger expenses_state_transition before update on expenses
  for each row execute function public.enforce_expense_state_transition();

-- DELETE is only ever allowed while financial_status = 'pending'.
create or replace function public.reject_expense_delete_unless_pending() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if OLD.financial_status <> 'pending' then
    raise exception
      'Expense % has financial_status=%, which cannot be deleted. Void it instead.',
      OLD.id, OLD.financial_status;
  end if;
  return OLD;
end;
$$;

create trigger expenses_no_delete_unless_pending before delete on expenses
  for each row execute function public.reject_expense_delete_unless_pending();

-- =====================================================================
-- Reversal-integrity trigger (review item 10)
--
-- DECISION: multiple reversals against the same original entry ARE
-- allowed (partial reversals can accumulate). The SUM of reversal
-- amounts referencing a given original must not exceed the original's
-- magnitude UNLESS is_adjustment = true, which explicitly signals "this
-- intentionally goes beyond a pure reversal" (e.g. correcting a
-- mis-keyed amount to something larger than what it's replacing). This
-- can only be checked with a trigger (it's an aggregate across sibling
-- rows), not a CHECK constraint.
-- =====================================================================

create or replace function public.enforce_reversal_magnitude() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_original_amount   bigint;
  v_prior_reversals    bigint;  -- sum of OTHER reversal rows already committed, excluding this NEW one
  v_new_amount        bigint;   -- NEW's own amount, read via the correct column name for this table
  v_total_after       bigint;
begin
  if NEW.reverses_entry_id is null or NEW.is_adjustment then
    return NEW;
  end if;

  if tg_table_name = 'budget_ledger' then
    v_new_amount := NEW.amount_cents;
    select amount_cents into v_original_amount from public.budget_ledger where id = NEW.reverses_entry_id;
    select coalesce(sum(amount_cents), 0) into v_prior_reversals
      from public.budget_ledger where reverses_entry_id = NEW.reverses_entry_id and not is_adjustment;
  else
    v_new_amount := NEW.fee_amount_cents;
    select fee_amount_cents into v_original_amount from public.fee_ledger where id = NEW.reverses_entry_id;
    select coalesce(sum(fee_amount_cents), 0) into v_prior_reversals
      from public.fee_ledger where reverses_entry_id = NEW.reverses_entry_id and not is_adjustment;
  end if;

  -- SELF-REVIEW CATCH #1 (not on the original review list, found while
  -- re-verifying item 10): a pure reversal must move the OPPOSITE
  -- direction of the original — e.g. original=+1000, "reversal"=+500 is
  -- not a reversal at all, it's compounding in the same direction, and
  -- the magnitude check alone (below) would have let it through since
  -- |500| <= |1000|.
  if v_original_amount <> 0 and v_new_amount <> 0 and (
    (v_original_amount > 0 and v_new_amount >= 0) or
    (v_original_amount < 0 and v_new_amount <= 0)
  ) then
    raise exception
      'A reversal of entry % (%) must move the opposite direction of the original amount (%) — got % with the same sign. Set is_adjustment=true if this is an intentional same-direction change.',
      NEW.reverses_entry_id, tg_table_name, v_original_amount, v_new_amount;
  end if;

  -- SELF-REVIEW CATCH #2 (a real bug in the first draft of this
  -- function, not just a missing case): the magnitude check MUST include
  -- this NEW row's own amount, not just prior reversals — a BEFORE
  -- INSERT trigger's own SELECT against the same table never sees the
  -- row currently being inserted, so the original version of this check
  -- compared only pre-existing reversals against the original amount and
  -- would have let a single lone over-magnitude reversal through
  -- untouched (it would only start rejecting starting with the SECOND
  -- over-magnitude attempt). Fixed by explicitly adding v_new_amount.
  v_total_after := v_prior_reversals + v_new_amount;
  if abs(v_total_after) > abs(v_original_amount) then
    raise exception
      'Reversals against entry % (%) would total % (including this one) against an original of % — exceeding the original magnitude. Set is_adjustment=true if this is intentional.',
      NEW.reverses_entry_id, tg_table_name, v_total_after, v_original_amount;
  end if;

  return NEW;
end;
$$;

create trigger budget_ledger_reversal_magnitude before insert on budget_ledger
  for each row execute function public.enforce_reversal_magnitude();
create trigger fee_ledger_reversal_magnitude before insert on fee_ledger
  for each row execute function public.enforce_reversal_magnitude();

-- =====================================================================
-- Centralized, trigger-based audit logging (review item 3)
-- =====================================================================

create or replace function public.log_audit() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, before_data, after_data)
  values (
    -- CASE short-circuits per-branch in SQL, so the NEW.project_id
    -- expression is never evaluated when tg_op = 'DELETE' (where NEW is
    -- unassigned) — unlike coalesce(NEW.project_id, OLD.project_id),
    -- which would evaluate NEW.project_id unconditionally and raise
    -- "record NEW is not assigned yet" on DELETE.
    case tg_op when 'DELETE' then OLD.project_id else NEW.project_id end,
    tg_table_name,
    case tg_op when 'DELETE' then OLD.id else NEW.id end,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );
  -- BEFORE-style return value doesn't matter for AFTER triggers, but a
  -- trigger function must return a row; DELETE triggers conventionally
  -- return OLD.
  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke all on function public.log_audit() from public;

create trigger audit_expenses      after insert or update or delete on expenses          for each row execute function public.log_audit();
create trigger audit_budget_ledger after insert on budget_ledger                          for each row execute function public.log_audit();
create trigger audit_fee_ledger    after insert on fee_ledger                             for each row execute function public.log_audit();
create trigger audit_committed     after insert or update on committed_costs              for each row execute function public.log_audit();
create trigger audit_forecast      after insert or update on forecast_entries             for each row execute function public.log_audit();
create trigger audit_suggestions   after insert or update on budget_suggestions           for each row execute function public.log_audit();
create trigger audit_cost_codes    after insert or update or delete on cost_codes         for each row execute function public.log_audit();
-- Nothing is ever hard-deleted except pending expenses and truly-unused
-- cost codes, and both of those deletions are still captured above
-- (audit_expenses/audit_cost_codes include DELETE), so "how do
-- voided/deleted records remain visible in audit history" is answered
-- by: the before/after snapshots in audit_log, which is itself
-- append-only and immutable.

-- =====================================================================
-- Profiles: prevent self-escalation (review item 2)
--
-- A user can update their own full_name/phone freely (via RLS below),
-- but role/org_id/is_active changes on THEIR OWN row are rejected
-- unconditionally at the trigger level — even an admin editing their
-- own profile cannot use this path to change their own role or org.
-- Those changes must come from ANOTHER admin acting on someone else's
-- row (which RLS below permits, scoped to the same org).
-- =====================================================================

create or replace function public.reject_profile_self_escalation() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.id = auth.uid() and (
    NEW.role is distinct from OLD.role or
    NEW.org_id is distinct from OLD.org_id or
    NEW.is_active is distinct from OLD.is_active
  ) then
    raise exception 'You cannot change your own role, organization, or active status.';
  end if;
  return NEW;
end;
$$;

create trigger profiles_no_self_escalation before update on profiles
  for each row execute function public.reject_profile_self_escalation();

-- =====================================================================
-- Row Level Security
--
-- Every policy below is explicitly scoped `to authenticated` (review
-- item 1 finding: a policy with no `to` clause applies to PUBLIC,
-- including the anonymous role — the original audit_log policy's
-- `for select using (true)` combined with the implicit PUBLIC scope is
-- exactly that bug). Nothing in this schema is ever readable by `anon`.
-- =====================================================================

alter table orgs enable row level security;
alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_fee_rules enable row level security;
alter table project_members enable row level security;
alter table cost_codes enable row level security;
alter table budget_ledger enable row level security;
alter table expenses enable row level security;
alter table committed_costs enable row level security;
alter table forecast_entries enable row level security;
alter table budget_suggestions enable row level security;
alter table fee_ledger enable row level security;
alter table import_batches enable row level security;
alter table import_rows enable row level security;
alter table audit_log enable row level security;

-- ---- orgs ----
-- Any authenticated user who has a profile in the org can see its name;
-- there's nothing sensitive in this row (name only). Insert/update/
-- delete: none via normal roles — org creation is bootstrap-only
-- (see bottom of file).
create policy orgs_select_own_org on orgs
  for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and org_id = orgs.id));

-- ---- profiles ----
-- Select: your own row, or any row in your org if you're staff/admin.
-- This is what "clients/vendors cannot enumerate unrelated profiles"
-- and "cross-organization access is impossible" resolve to: a client's
-- only matching row is their own (is_org_staff_for_org is false for a
-- client role), and org_id scoping makes a different org's profiles
-- invisible to everyone regardless of role.
create policy profiles_select_self_or_org_staff on profiles
  for select to authenticated
  using (id = auth.uid() or is_org_staff_for_org(org_id));

-- Update: your own row (full_name/phone only — role/org_id/is_active
-- self-changes are rejected by the trigger above regardless of this
-- policy passing), or an admin updating someone else's row in their org.
create policy profiles_update_self_or_org_admin on profiles
  for update to authenticated
  using (id = auth.uid() or is_org_admin_for_org(org_id))
  with check (id = auth.uid() or is_org_admin_for_org(org_id));

-- No insert/delete policy for profiles at all — creation only happens
-- via bootstrap_organization() (first admin) or an existing admin
-- inviting a user through a future server-side/RPC flow (Package 2+),
-- never a direct client-side insert.
revoke insert, delete on profiles from authenticated, anon;

-- ---- projects ----
-- Staff/admin: full access to every project in their org (see the
-- org-wide access-model note at the top of this file). Clients: read
-- their assigned project only.
create policy projects_staff_full_access on projects
  for all to authenticated
  using (is_org_staff_for_org(org_id))
  with check (is_org_staff_for_org(org_id));

create policy projects_client_read on projects
  for select to authenticated
  using (is_project_client(id));

-- ---- project_fee_rules / cost_codes / budget_ledger ----
create policy fee_rules_staff_only on project_fee_rules
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

create policy cost_codes_staff_full on cost_codes
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));
create policy cost_codes_client_read on cost_codes
  for select to authenticated
  using (is_project_client(project_id));

create policy budget_ledger_staff_select on budget_ledger
  for select to authenticated using (is_org_staff(project_id));
create policy budget_ledger_staff_insert on budget_ledger
  for insert to authenticated with check (is_org_staff(project_id));
create policy budget_ledger_client_read on budget_ledger
  for select to authenticated using (is_project_client(project_id));

-- ---- expenses ----
-- Staff/admin: full access. Clients: ONLY posted + published rows —
-- this is the review item 3 rule made concrete in RLS, not just in the
-- application layer.
create policy expenses_staff_full_access on expenses
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

create policy expenses_client_read on expenses
  for select to authenticated
  using (
    is_project_client(project_id)
    and financial_status = 'posted'
    and publication_status = 'published'
  );

-- ---- committed_costs / forecast_entries / budget_suggestions ----
-- Internal-only: no client policy exists for any of these at all, which
-- means clients get zero rows (the safe default for RLS-enabled tables
-- with no matching policy).
create policy committed_costs_staff_only on committed_costs
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));
create policy forecast_entries_staff_only on forecast_entries
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));
create policy budget_suggestions_staff_only on budget_suggestions
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));
create policy fee_ledger_staff_select on fee_ledger
  for select to authenticated using (is_org_staff(project_id));
create policy fee_ledger_staff_insert on fee_ledger
  for insert to authenticated with check (is_org_staff(project_id));

create policy import_batches_staff_only on import_batches
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));
create policy import_rows_staff_only on import_rows
  for all to authenticated
  using (is_org_staff((select project_id from import_batches b where b.id = batch_id)))
  with check (is_org_staff((select project_id from import_batches b where b.id = batch_id)));

-- ---- project_members ----
create policy project_members_staff_manage on project_members
  for all to authenticated using (is_org_staff(project_id)) with check (is_org_staff(project_id));
-- A client/vendor can see their OWN membership row (so the app can
-- confirm "you're a member of project X"), nothing else.
create policy project_members_self_read on project_members
  for select to authenticated using (user_id = auth.uid());

-- ---- audit_log ----
-- FIX (review item 1): the previous policy used `using (true)` with no
-- `to` clause, exposing full before/after snapshots to any authenticated
-- user regardless of org or project. Replaced with a real project-scoped
-- staff-only check. No insert/update/delete policy exists at all — see
-- log_audit()'s SECURITY DEFINER status above, and the REVOKEs below.
create policy audit_log_staff_select on audit_log
  for select to authenticated
  using (project_id is not null and is_org_staff(project_id));

revoke insert, update, delete on audit_log from authenticated, anon;

-- =====================================================================
-- Client-safe views (review item 9)
--
-- `security_invoker = true` (Postgres 15+) makes the view evaluate RLS
-- using the CALLING role's permissions, not the view owner's — without
-- this, a view's underlying-table access is checked against the view
-- owner (typically a superuser-ish migration role), which would leak
-- rows regardless of the view's own WHERE clause. The WHERE clause
-- below is an explicit belt-and-suspenders filter on top of RLS, not a
-- substitute for it.
-- =====================================================================

create view client_expense_view
  with (security_invoker = true) as
select
  e.id,
  e.project_id,
  e.cost_code_id,
  e.transaction_date,
  e.description_client,
  e.amount_cents,
  e.vendor_name
from expenses e
where e.financial_status = 'posted' and e.publication_status = 'published';

create view client_budget_view
  with (security_invoker = true) as
select
  cc.id as cost_code_id,
  cc.project_id,
  cc.code,
  coalesce(sum(bl.amount_cents) filter (where bl.entry_type = 'original'), 0) as original_estimate_cents,
  coalesce(sum(bl.amount_cents) filter (where bl.entry_type in ('approved_change', 'correction')), 0) as approved_changes_cents
from cost_codes cc
left join budget_ledger bl on bl.cost_code_id = cc.id
where not cc.is_archived
group by cc.id, cc.project_id, cc.code;
-- Deliberately excludes: internal_notes, fee_eligible, status,
-- committed costs, forecasts, suggestions, and any correction/reversal
-- metadata — none of that is client-facing information.

grant select on client_expense_view to authenticated;
grant select on client_budget_view to authenticated;

-- =====================================================================
-- Bootstrap process (review item 11)
--
-- Problem: creating the first project/project_member for a brand-new
-- org requires SOMEONE to already be recognized as org staff/admin —
-- but a brand-new Supabase auth user has no `profiles` row yet, and
-- `profiles`/`orgs` have no INSERT policy for `authenticated` at all
-- (by design — see above). This function is the one sanctioned,
-- narrowly-scoped way to escape that chicken-and-egg problem:
--
--   1. Must be called by an already-authenticated Supabase user
--      (auth.uid() is not null) — anonymous callers are rejected.
--   2. That user must not already have a profiles row — this function
--      creates exactly one org+admin-profile per eligible caller and
--      cannot be used to spin up additional orgs for an existing user,
--      nor to re-run itself.
--   3. It creates the org and the caller's own profile (role='admin')
--      as one atomic operation, using SECURITY DEFINER to bypass the
--      (deliberately absent) INSERT policies on orgs/profiles.
--
-- After this runs once, the new admin can create projects and add
-- project_members directly through normal RLS (is_org_staff_for_org
-- passes because their profile now exists with role='admin' and the
-- matching org_id) — no further bootstrap-style function is needed for
-- subsequent projects or team members.
-- =====================================================================

create or replace function public.bootstrap_organization(
  p_org_name text,
  p_admin_full_name text,
  p_admin_email text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'bootstrap_organization requires an authenticated caller.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This account already has a profile and cannot bootstrap a new organization.';
  end if;

  insert into public.orgs (name) values (p_org_name) returning id into v_org_id;

  insert into public.profiles (id, org_id, role, full_name, email)
  values (auth.uid(), v_org_id, 'admin', p_admin_full_name, p_admin_email);

  return v_org_id;
end;
$$;

revoke all on function public.bootstrap_organization(text, text, text) from public;
grant execute on function public.bootstrap_organization(text, text, text) to authenticated;
-- NOT granted to anon: a Supabase session (even an anonymous-auth one,
-- if that feature is enabled) is required to have auth.uid() at all.
-- A production deployment should additionally gate this behind an
-- invite code or manual approval step before general release — this
-- function only guarantees "can't self-escalate an existing account"
-- and "can't be re-run," not "anyone who signs up gets to found a
-- company," which is a product decision outside this schema's scope.
