-- =====================================================================
-- Stone Column Portal — Migration 012: financial master data & project
-- setup (Package P2.1).
--
-- Source of truth: docs/reference/Stone_Column_Cost_Plus_Blank_Template.xlsx
-- (the "BUDGET" sheet), reviewed in full and cross-checked against every
-- other sheet in docs/production-build/WORKBOOK-GAP-ANALYSIS.md before
-- this migration was written. The 7 division names and 113 cost-code
-- rows inserted near the bottom of this file are TRANSCRIBED VERBATIM
-- from that workbook — activity names, division assignments, and the
-- Include-in-Estimate?/Billable Cost? flags are reproduced exactly as
-- authored, including naming inconsistencies. Six specific naming/
-- categorization questions are flagged, NOT silently corrected, in
-- docs/production-build/P2.1-DESIGN.md ("Unresolved decisions").
--
-- SCOPE (per explicit instruction): financial master data and project
-- setup ONLY. This migration does NOT add estimates, vendor quotes,
-- change orders, QuickBooks import wiring, draws, invoices, or invoice
-- lines — those remain schema-only placeholders described in
-- docs/production-build/WORKBOOK-GAP-ANALYSIS.md §7 for a future
-- package. Nothing in this migration reads or writes budget_ledger,
-- expenses, committed_costs, forecast_entries, or fee_ledger.
--
-- DESIGN SUMMARY (full rationale in docs/production-build/P2.1-DESIGN.md):
--   - `division_templates` / `cost_code_templates`: global, org-independent
--     reference data — the digitized workbook itself. Read-only via RLS;
--     only this migration writes to them.
--   - `apply_standard_cost_code_template(project_id)`: the "seed/import
--     logic" — copies the templates into a real project's `divisions`/
--     `cost_codes` rows. Staff-only, idempotent-guarded (raises if the
--     project already has any divisions).
--   - `divisions` and the new `cost_codes` columns follow the exact
--     composite-FK pattern already used by budget_ledger/committed_costs/
--     forecast_entries (`unique(id, project_id)` + composite FK) — see
--     schema/001_core_financial.sql's own comment on that pattern.
--   - `include_in_estimate` / `billable` are independent booleans,
--     distinct from the pre-existing `fee_eligible` — proven load-bearing
--     by the workbook's own 7082/9999 rows (Include=Yes, Billable=No).
--   - `vendors`, `project_clients`, `project_financial_settings`,
--     `credit_ledger` are new, org/project-scoped master data with no
--     linkage yet to commitments/invoices (those tables don't exist).
--   - `orgs` gains billing-identity columns (payable-to name/address/
--     phone/email) plus, for the first time, an UPDATE policy — orgs
--     previously had no update path at all outside bootstrap.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Divisions (per-project, mirrors cost_codes' own project-scoping)
-- ---------------------------------------------------------------------
create table divisions (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  unique (project_id, name),
  -- Enables the composite FK from cost_codes.division_id below, same
  -- pattern as cost_codes(id, project_id) itself (schema/001 comment).
  unique (id, project_id)
);

alter table divisions enable row level security;

create policy divisions_staff_full on divisions
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));
create policy divisions_client_read on divisions
  for select to authenticated
  using (is_project_client(project_id));

create trigger audit_divisions after insert or update or delete on divisions
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Cost codes: add division/activity/scope + the two workbook visibility
-- flags. `fee_eligible` (schema/001) is left completely untouched — it
-- is a THIRD, independent flag, not replaced by either new one.
-- ---------------------------------------------------------------------
alter table cost_codes
  add column division_id         uuid,
  add column activity_name       text,
  add column scope_description   text,
  add column include_in_estimate boolean not null default true,
  add column billable            boolean not null default true;

-- Nullable by design: cost_codes is generic per-project data, not
-- exclusively the workbook's standard template — a project that never
-- applies apply_standard_cost_code_template() below can still create
-- ad hoc cost codes with no division. Every code seeded FROM the
-- template (below) always gets one.
alter table cost_codes
  add constraint cost_codes_division_project_fk
    foreign key (division_id, project_id) references divisions(id, project_id);

-- ---------------------------------------------------------------------
-- Vendor master (org-scoped — a subcontractor typically works across
-- multiple projects for the same org). No RLS policy grants a vendor's
-- own portal session (member_role='vendor') access to this table — this
-- is internal record-keeping, not the vendor's own identity/login,
-- exactly like committed_costs.vendor_name today, just normalized.
-- ---------------------------------------------------------------------
create table vendors (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references orgs(id) on delete cascade,
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  address       text,
  notes         text,
  is_archived   boolean not null default false,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

alter table vendors enable row level security;

create policy vendors_staff_only on vendors
  for all to authenticated
  using (is_org_staff_for_org(org_id)) with check (is_org_staff_for_org(org_id));

create trigger audit_vendors after insert or update or delete on vendors
  for each row execute function public.log_audit_no_project();

-- vendors carries is_archived specifically so it's never hard-deleted —
-- same "no delete, ever" posture as committed_costs/forecast_entries/
-- budget_suggestions (schema/001), applied here as a blanket reject
-- (nothing references vendors.id yet, so there's no "unless unused"
-- exception to make, unlike cost_codes' conditional version).
create trigger vendors_no_delete before delete on vendors
  for each row execute function public.reject_delete();
revoke delete on vendors from authenticated, anon;

-- audit_log_org_scoped_select (schema/006) only covers table_name IN
-- ('orgs', 'profiles') today — extend it here (new policy, additive,
-- not editing 006) so a vendor's audit trail is actually readable by
-- the org's own staff, not just durably written and unreachable, which
-- is the exact gap 006's own header comment calls out for orgs/profiles
-- and would otherwise silently repeat here.
create policy audit_log_vendors_staff_select on audit_log
  for select to authenticated
  using (project_id is null and table_name = 'vendors' and is_org_staff_for_org(
    (select org_id from vendors where id = record_id)
  ));

-- ---------------------------------------------------------------------
-- Project financial settings (1:1 with projects) — the workbook's
-- Project Setup fields that have no home anywhere else: deposit %,
-- estimate/invoice numbering, current draw counter, estimate terms text.
-- Deliberately a single mutable row, NOT an append-only ledger: nothing
-- reads from this table yet (no estimate/invoice logic exists), so
-- there is no "already-issued document" whose numbers this could
-- silently move out from under. Once P4/P6 build estimates/invoices,
-- THOSE tables must snapshot the values they used at creation time
-- (matching budget_ledger's append-only precedent) — this settings
-- table stays simple, forward-looking configuration.
-- ---------------------------------------------------------------------
create table project_financial_settings (
  project_id              uuid primary key references projects(id) on delete cascade,
  deposit_basis_points    integer not null default 0,
  estimate_number_prefix  text,
  next_estimate_number    integer not null default 1,
  invoice_number_prefix   text,
  next_draw_number        integer not null default 1,
  estimate_terms_text     text,
  created_by              uuid references profiles(id),
  created_at              timestamptz not null default now(),

  constraint project_financial_settings_deposit_range
    check (deposit_basis_points between 0 and 10000),
  constraint project_financial_settings_next_estimate_positive
    check (next_estimate_number >= 1),
  constraint project_financial_settings_next_draw_positive
    check (next_draw_number >= 1)
);

alter table project_financial_settings enable row level security;

-- Staff-only, matching committed_costs_staff_only's precedent: no
-- client-facing screen consumes numbering counters/deposit config yet.
create policy project_financial_settings_staff_only on project_financial_settings
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

-- log_audit()/log_audit_self_scoped() (001/006) both reference .id,
-- which this table doesn't have — its primary key IS project_id, one
-- row per project. Dedicated function, same "new function, never edit
-- a shipped one" precedent as 006's own log_audit_self_scoped()/
-- log_audit_no_project().
create or replace function public.log_audit_project_settings() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, before_data, after_data)
  values (
    case tg_op when 'DELETE' then OLD.project_id else NEW.project_id end,
    tg_table_name,
    case tg_op when 'DELETE' then OLD.project_id else NEW.project_id end,
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

revoke all on function public.log_audit_project_settings() from public;

-- Includes DELETE (unlike vendors, this table is NOT delete-blocked —
-- project_financial_settings.project_id has ON DELETE CASCADE from
-- projects, and a reject-delete trigger here would break that cascade
-- the moment a project is ever deleted; capturing the delete in
-- audit_log is the right amount of protection for a 1:1 config row).
create trigger audit_project_financial_settings
  after insert or update or delete on project_financial_settings
  for each row execute function public.log_audit_project_settings();

-- ---------------------------------------------------------------------
-- Client billing/contact information. Deliberately separate from
-- project_members/profiles: a billing contact does not need (and may
-- never have) a portal login. Forward-compatible with the Client
-- Approval Rule's "multiple client contacts" requirement (CLAUDE.md /
-- COVERAGE_MATRIX.md) WITHOUT implementing decision-maker authority —
-- that remains project_decision_makers' (future) scope, unchanged.
-- ---------------------------------------------------------------------
create table project_clients (
  id            uuid primary key default uuid_generate_v4(),
  project_id    uuid not null references projects(id) on delete cascade,
  full_name     text not null,
  email         text,
  phone         text,
  address       text,
  city          text,
  state         text,
  zip           text,
  is_primary    boolean not null default false,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

alter table project_clients enable row level security;

create policy project_clients_staff_full on project_clients
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));
create policy project_clients_client_read on project_clients
  for select to authenticated
  using (is_project_client(project_id));

create trigger audit_project_clients after insert or update or delete on project_clients
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Credit ledger — the structural replacement for the workbook's single
-- "Credit/Deposit Applied This Draw" cell (Project Setup!B25), which
-- gets manually overwritten every draw. This is append-only, mirroring
-- budget_ledger/fee_ledger exactly: a correction is a new
-- 'reversal_adjustment' row with reverses_entry_id set, never an edit.
--
-- DELIBERATELY NOT WIRED to anything yet, and DELIBERATELY does not
-- reuse budget_ledger/fee_ledger's enforce_reversal_magnitude() trigger
-- (schema/001) — that function is not modified by this migration (per
-- the standing "never edit a shipped migration" rule), and duplicating
-- its full magnitude-check logic here for a ledger nothing currently
-- reads from would be speculative complexity ahead of the feature that
-- needs it. When P6 (Billing: Draws) starts consuming this ledger to
-- compute "credit/deposit applied," this is the right place to add the
-- same magnitude-safety trigger fee_ledger already has — tracked as a
-- known limitation in docs/production-build/P2.1-DESIGN.md.
-- ---------------------------------------------------------------------
create table credit_ledger (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid not null references projects(id) on delete cascade,
  entry_type        text not null,
  amount_cents      bigint not null,
  source_type       text,
  source_id         uuid,
  reverses_entry_id uuid,
  is_adjustment     boolean not null default false,
  note              text,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),

  constraint credit_ledger_entry_type_valid
    check (entry_type in ('deposit_received', 'credit_applied', 'reversal_adjustment')),
  constraint credit_ledger_reversal_same_project_fk
    foreign key (reverses_entry_id, project_id) references credit_ledger(id, project_id),
  constraint credit_ledger_no_self_reversal
    check (reverses_entry_id is null or reverses_entry_id <> id),
  constraint credit_ledger_reversal_requires_type
    check (entry_type = 'reversal_adjustment' or reverses_entry_id is null),
  unique (id, project_id)
);

alter table credit_ledger enable row level security;

-- Staff-only for the same reason as project_financial_settings: the
-- `note` field can carry internal commentary, and CLAUDE.md's
-- non-negotiable ("internal notes never appear in any client-facing
-- query path") argues for staying conservative until a real
-- client-safe view (matching client_expense_view's precedent) is
-- purpose-built for whatever P6 actually needs to show.
create policy credit_ledger_staff_select on credit_ledger
  for select to authenticated using (is_org_staff(project_id));
create policy credit_ledger_staff_insert on credit_ledger
  for insert to authenticated with check (is_org_staff(project_id));

create trigger credit_ledger_append_only before update or delete on credit_ledger
  for each row execute function public.reject_mutation();
revoke update, delete on credit_ledger from authenticated, anon;

create trigger audit_credit_ledger after insert on credit_ledger
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Organization billing identity — the workbook's Company Name/Payable
-- To/Address/Phone/Email (Project Setup rows 4-9). `orgs.name` already
-- exists (schema/001); `payable_to_name` is intentionally separate from
-- it (the workbook's own banner company name and its "Payable To" legal
-- entity name are two distinct fields, e.g. a DBA vs. the LLC name).
-- ---------------------------------------------------------------------
alter table orgs
  add column payable_to_name text,
  add column billing_address text,
  add column billing_city    text,
  add column billing_state   text,
  add column billing_zip     text,
  add column billing_phone   text,
  add column billing_email   text;

-- orgs (schema/001) had NO update policy at all — org identity could
-- only ever be set at bootstrap_organization() time. Admins now need to
-- be able to edit their own org's billing identity.
create policy orgs_update_admin on orgs
  for update to authenticated
  using (is_org_admin_for_org(id))
  with check (is_org_admin_for_org(id));
-- audit_orgs (schema/006, log_audit_no_project) already fires on UPDATE
-- as well as INSERT, so this newly-permitted update path is covered by
-- the existing trigger with no change needed here.

-- =====================================================================
-- Financial master-data templates — the digitized workbook itself.
-- Global reference data: no org_id/project_id, readable by any
-- authenticated user (nothing sensitive — division/cost-code names
-- only), writable only by this migration. apply_standard_cost_code_
-- template() below is the one sanctioned way real project rows get
-- created from these.
-- =====================================================================

create table division_templates (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,
  sort_order  integer not null default 0
);

create table cost_code_templates (
  id                      uuid primary key default uuid_generate_v4(),
  division_template_id    uuid not null references division_templates(id),
  code                    text not null unique,
  activity_name           text not null,
  include_in_estimate     boolean not null default true,
  billable                boolean not null default true,
  sort_order              integer not null default 0
);

alter table division_templates enable row level security;
alter table cost_code_templates enable row level security;

create policy division_templates_read_all on division_templates
  for select to authenticated using (true);
create policy cost_code_templates_read_all on cost_code_templates
  for select to authenticated using (true);
-- No insert/update/delete policy on either table: this reference data
-- is migration-managed only, same posture as orgs' pre-012 state.
revoke insert, update, delete on division_templates from authenticated, anon;
revoke insert, update, delete on cost_code_templates from authenticated, anon;

-- ---------------------------------------------------------------------
-- Seed data: transcribed verbatim from
-- docs/reference/Stone_Column_Cost_Plus_Blank_Template.xlsx, sheet
-- "BUDGET", columns A (Code), B (Activity), I (Include in Estimate?),
-- J (Billable Cost?), K (Division). Generated programmatically from a
-- parsed read of the workbook (not hand-typed) to eliminate
-- transcription risk across 113 rows — see
-- docs/production-build/P2.1-DESIGN.md for how this block was produced
-- and verified against the workbook a second, independent way (row
-- count and division subtotals cross-checked against the ESTIMATE and
-- INVOICE DETAIL sheets, which list the identical 113 codes).
--
-- Every code below has include_in_estimate = billable = true EXCEPT
-- 7082 (Sales Commission) and 9999 (Transfer WIP to CGS), which are
-- include_in_estimate = true, billable = false in the workbook itself —
-- reproduced exactly, not corrected. See P2.1-DESIGN.md "Unresolved
-- decisions" for the six flagged naming/categorization questions
-- (5011/5111/5170's "***" markers, the Mat/Sub vs. M/S abbreviation
-- inconsistency, the two "Trim" material codes, the 6060/7050 possible
-- Fence overlap, the multi-scope 7050 row, and this Include/Billable
-- combination itself) — none of them are altered here.
-- ---------------------------------------------------------------------

insert into division_templates (id, name, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'Preconstruction & General', 0),
  ('00000000-0000-0000-0000-000000000002', 'Sitework', 10),
  ('00000000-0000-0000-0000-000000000003', 'Foundation', 20),
  ('00000000-0000-0000-0000-000000000004', 'Structure, Exterior & MEP', 30),
  ('00000000-0000-0000-0000-000000000005', 'Interior Finishes', 40),
  ('00000000-0000-0000-0000-000000000006', 'Exterior Improvements & Closeout', 50),
  ('00000000-0000-0000-0000-000000000007', 'Other Project Costs', 60);

insert into cost_code_templates (division_template_id, code, activity_name, include_in_estimate, billable, sort_order) values
  ('00000000-0000-0000-0000-000000000001', '1010', 'Plan / Site Plans', true, true, 0),
  ('00000000-0000-0000-0000-000000000001', '1011', 'Permits/Fees/Water/Sewer', true, true, 10),
  ('00000000-0000-0000-0000-000000000001', '1020', 'Surveys', true, true, 20),
  ('00000000-0000-0000-0000-000000000001', '1070', 'Builders Risk Insurance', true, true, 30),
  ('00000000-0000-0000-0000-000000000001', '1080', 'Reinspection Fees', true, true, 40),
  ('00000000-0000-0000-0000-000000000002', '2010', 'Grading - Clear Lot', true, true, 50),
  ('00000000-0000-0000-0000-000000000002', '2011', 'Grading - Haul Debris', true, true, 60),
  ('00000000-0000-0000-0000-000000000002', '2012', 'Grading - Cut Foundation', true, true, 70),
  ('00000000-0000-0000-0000-000000000002', '2013', 'Grading - Backfill Found', true, true, 80),
  ('00000000-0000-0000-0000-000000000002', '2014', 'Grading - Cut Drive', true, true, 90),
  ('00000000-0000-0000-0000-000000000002', '2015', 'Grading - Final', true, true, 100),
  ('00000000-0000-0000-0000-000000000002', '2016', 'Grading - Misc', true, true, 110),
  ('00000000-0000-0000-0000-000000000002', '2021', 'Retaining Walls - Sub', true, true, 120),
  ('00000000-0000-0000-0000-000000000002', '2030', 'Erosion Control', true, true, 130),
  ('00000000-0000-0000-0000-000000000002', '2031', 'Gravel', true, true, 140),
  ('00000000-0000-0000-0000-000000000003', '3005', 'Pump Concrete', true, true, 150),
  ('00000000-0000-0000-0000-000000000003', '3010', 'Footing - Material', true, true, 160),
  ('00000000-0000-0000-0000-000000000003', '3011', 'Footing - Sub', true, true, 170),
  ('00000000-0000-0000-0000-000000000003', '3020', 'Block - Materials', true, true, 180),
  ('00000000-0000-0000-0000-000000000003', '3021', 'Block - Sub', true, true, 190),
  ('00000000-0000-0000-0000-000000000003', '3031', 'Slab - Sub', true, true, 200),
  ('00000000-0000-0000-0000-000000000003', '3050', 'Foundation Wall - Material', true, true, 210),
  ('00000000-0000-0000-0000-000000000003', '3051', 'Foundation Wall - Sub', true, true, 220),
  ('00000000-0000-0000-0000-000000000003', '3070', 'Termite Treat Soil', true, true, 230),
  ('00000000-0000-0000-0000-000000000003', '3080', 'Waterproof Foundation', true, true, 240),
  ('00000000-0000-0000-0000-000000000003', '3090', 'Engineering', true, true, 250),
  ('00000000-0000-0000-0000-000000000003', '3095', 'Water Lines - Sub', true, true, 260),
  ('00000000-0000-0000-0000-000000000003', '3096', 'Sewer Lines - Sub', true, true, 270),
  ('00000000-0000-0000-0000-000000000004', '4010', 'Brick - Materials', true, true, 280),
  ('00000000-0000-0000-0000-000000000004', '4011', 'Brick - Sub', true, true, 290),
  ('00000000-0000-0000-0000-000000000004', '4020', 'Stone - Sub', true, true, 300),
  ('00000000-0000-0000-0000-000000000004', '4021', 'Stucco - Sub', true, true, 310),
  ('00000000-0000-0000-0000-000000000004', '4030', 'Framing - Material', true, true, 320),
  ('00000000-0000-0000-0000-000000000004', '4031', 'Framing - Sub', true, true, 330),
  ('00000000-0000-0000-0000-000000000004', '4032', 'Floor Screw - Sub', true, true, 340),
  ('00000000-0000-0000-0000-000000000004', '4040', 'Trusses - Material', true, true, 350),
  ('00000000-0000-0000-0000-000000000004', '4041', 'Steel Beams', true, true, 360),
  ('00000000-0000-0000-0000-000000000004', '4050', 'Windows/Ex Doors - Mat', true, true, 370),
  ('00000000-0000-0000-0000-000000000004', '4051', 'Windows/Ex Doors - Sub', true, true, 380),
  ('00000000-0000-0000-0000-000000000004', '4060', 'Skylight - Sub', true, true, 390),
  ('00000000-0000-0000-0000-000000000004', '4061', 'Specialty Glass - Sub', true, true, 400),
  ('00000000-0000-0000-0000-000000000004', '4070', 'Roofing - Material', true, true, 410),
  ('00000000-0000-0000-0000-000000000004', '4071', 'Roofing - Sub', true, true, 420),
  ('00000000-0000-0000-0000-000000000004', '4080', 'Plumbing - Sub', true, true, 430),
  ('00000000-0000-0000-0000-000000000004', '4082', 'Plumbing - Fixtures', true, true, 440),
  ('00000000-0000-0000-0000-000000000004', '4085', 'Electrical - Sub', true, true, 450),
  ('00000000-0000-0000-0000-000000000004', '4086', 'Low Voltage - Sub', true, true, 460),
  ('00000000-0000-0000-0000-000000000004', '4090', 'HVAC - Sub', true, true, 470),
  ('00000000-0000-0000-0000-000000000004', '4100', 'Pre-Fab Fireplace - Sub', true, true, 480),
  ('00000000-0000-0000-0000-000000000004', '4110', 'Trash Removal - Sub', true, true, 490),
  ('00000000-0000-0000-0000-000000000004', '4120', 'Deck - Materials', true, true, 500),
  ('00000000-0000-0000-0000-000000000004', '4121', 'Deck - Sub', true, true, 510),
  ('00000000-0000-0000-0000-000000000004', '4130', 'Front Porch - Mat', true, true, 520),
  ('00000000-0000-0000-0000-000000000004', '4131', 'Front Porch - Sub', true, true, 530),
  ('00000000-0000-0000-0000-000000000004', '4140', 'Siding/Cornice - Mat', true, true, 540),
  ('00000000-0000-0000-0000-000000000004', '4141', 'Siding/Cornice - Sub', true, true, 550),
  ('00000000-0000-0000-0000-000000000004', '4145', 'Flashing - Sub', true, true, 560),
  ('00000000-0000-0000-0000-000000000004', '4150', 'Cedar Shingles - Mat', true, true, 570),
  ('00000000-0000-0000-0000-000000000004', '4151', 'Cedar Shingles - Sub', true, true, 580),
  ('00000000-0000-0000-0000-000000000004', '4170', 'Shutters', true, true, 590),
  ('00000000-0000-0000-0000-000000000004', '4180', 'Insulation - Sub', true, true, 600),
  ('00000000-0000-0000-0000-000000000004', '4190', 'Flower Box - Sub', true, true, 610),
  ('00000000-0000-0000-0000-000000000004', '4200', 'Housewrap - Sub', true, true, 620),
  ('00000000-0000-0000-0000-000000000005', '5010', 'Sheetrock - Materials', true, true, 630),
  ('00000000-0000-0000-0000-000000000005', '5011', 'Sheetrock - Sub ***', true, true, 640),
  ('00000000-0000-0000-0000-000000000005', '5020', 'Garage Doors - Sub', true, true, 650),
  ('00000000-0000-0000-0000-000000000005', '5030', 'Drive/Walk/Patio - M', true, true, 660),
  ('00000000-0000-0000-0000-000000000005', '5031', 'Drive/Walk/Patio - S', true, true, 670),
  ('00000000-0000-0000-0000-000000000005', '5035', 'Public Walks - Conc', true, true, 680),
  ('00000000-0000-0000-0000-000000000005', '5036', 'Public Walks - Sub', true, true, 690),
  ('00000000-0000-0000-0000-000000000005', '5045', 'Lockout - Materials', true, true, 700),
  ('00000000-0000-0000-0000-000000000005', '5046', 'Lockout - Sub', true, true, 710),
  ('00000000-0000-0000-0000-000000000005', '5049', 'Trim - Materials', true, true, 720),
  ('00000000-0000-0000-0000-000000000005', '5050', 'Trim -Int Doors - Mat', true, true, 730),
  ('00000000-0000-0000-0000-000000000005', '5051', 'Trim - Sub', true, true, 740),
  ('00000000-0000-0000-0000-000000000005', '5055', 'Stair Parts - Mat', true, true, 750),
  ('00000000-0000-0000-0000-000000000005', '5060', 'Gutters - Sub', true, true, 760),
  ('00000000-0000-0000-0000-000000000005', '5065', 'Metal Roof - Sub', true, true, 770),
  ('00000000-0000-0000-0000-000000000005', '5070', 'Cabinets - Sub', true, true, 780),
  ('00000000-0000-0000-0000-000000000005', '5075', 'Countertops - Sub', true, true, 790),
  ('00000000-0000-0000-0000-000000000005', '5080', 'Paint - Sub', true, true, 800),
  ('00000000-0000-0000-0000-000000000005', '5090', 'Sinks / Tubs', true, true, 810),
  ('00000000-0000-0000-0000-000000000005', '5095', 'Cultured Marble - Sub', true, true, 820),
  ('00000000-0000-0000-0000-000000000005', '5100', 'Fireplace Veneer - Mat', true, true, 830),
  ('00000000-0000-0000-0000-000000000005', '5101', 'Fireplace Veneer - Sub', true, true, 840),
  ('00000000-0000-0000-0000-000000000005', '5111', 'Ceramic Tile - Sub ***', true, true, 850),
  ('00000000-0000-0000-0000-000000000005', '5130', 'Hardware/Supplies', true, true, 860),
  ('00000000-0000-0000-0000-000000000005', '5140', 'Mirrors/Ecl/Shlve - Sub', true, true, 870),
  ('00000000-0000-0000-0000-000000000005', '5150', 'Light Fixtures', true, true, 880),
  ('00000000-0000-0000-0000-000000000005', '5160', 'Appliances - Material', true, true, 890),
  ('00000000-0000-0000-0000-000000000005', '5170', 'Hardwoods - Sub ***', true, true, 900),
  ('00000000-0000-0000-0000-000000000005', '5180', 'Vinyl Flooring - Sub', true, true, 910),
  ('00000000-0000-0000-0000-000000000005', '5190', 'Carpet Flooring - Sub', true, true, 920),
  ('00000000-0000-0000-0000-000000000005', '5200', 'Screens - Sub', true, true, 930),
  ('00000000-0000-0000-0000-000000000005', '5220', 'Mailbox - Sub', true, true, 940),
  ('00000000-0000-0000-0000-000000000005', '5230', 'Wrought Iron - Sub', true, true, 950),
  ('00000000-0000-0000-0000-000000000005', '5240', 'Tub/Sink Repair - Sub', true, true, 960),
  ('00000000-0000-0000-0000-000000000005', '5270', 'Elevator - Sub', true, true, 970),
  ('00000000-0000-0000-0000-000000000006', '6040', 'Irrigation System - Sub', true, true, 980),
  ('00000000-0000-0000-0000-000000000006', '6050', 'Landscape - Sub', true, true, 990),
  ('00000000-0000-0000-0000-000000000006', '6060', 'Fence', true, true, 1000),
  ('00000000-0000-0000-0000-000000000006', '6070', 'Window Clean - Sub', true, true, 1010),
  ('00000000-0000-0000-0000-000000000006', '6080', 'Interior Clean - Sub', true, true, 1020),
  ('00000000-0000-0000-0000-000000000006', '6090', 'Carpet Clean - Sub', true, true, 1030),
  ('00000000-0000-0000-0000-000000000006', '6100', 'Pressure Wash - Sub', true, true, 1040),
  ('00000000-0000-0000-0000-000000000006', '6110', 'Labor Cleanup / Punchout', true, true, 1050),
  ('00000000-0000-0000-0000-000000000007', '7025', 'Utilities - Water/Sewer', true, true, 1060),
  ('00000000-0000-0000-0000-000000000007', '7050', 'Pool, pavers, Fence', true, true, 1070),
  ('00000000-0000-0000-0000-000000000007', '7055', 'Interior Upgrades', true, true, 1080),
  ('00000000-0000-0000-0000-000000000007', '7060', 'Exterior Upgrades', true, true, 1090),
  ('00000000-0000-0000-0000-000000000007', '7080', 'Design Fee', true, true, 1100),
  ('00000000-0000-0000-0000-000000000007', '7082', 'Sales Commission', true, false, 1110),
  ('00000000-0000-0000-0000-000000000007', '9999', 'Transfer WIP to CGS', true, false, 1120);

-- =====================================================================
-- apply_standard_cost_code_template(project_id) — the "seed/import"
-- entry point a real project-creation flow (future package) calls once
-- to populate a brand-new project with the workbook's standard 7
-- divisions and 113 cost codes. Staff-only (checked directly, not via
-- RLS alone, so the error message is meaningful rather than "0 rows
-- affected"). Guards against being run twice against the same project
-- (raises rather than silently duplicating divisions/codes) — there is
-- no "re-apply" or "merge" semantic here, matching the append-only
-- philosophy elsewhere in this schema: a project either gets the
-- standard template once at creation, or its cost codes are managed by
-- hand from the start.
-- =====================================================================
create or replace function public.apply_standard_cost_code_template(p_project_id uuid) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_division_map jsonb := '{}'::jsonb;
  v_template record;
  v_new_division_id uuid;
begin
  if not public.is_org_staff(p_project_id) then
    raise exception 'Not authorized to apply the standard cost-code template to project %.', p_project_id;
  end if;

  if exists (select 1 from public.divisions where project_id = p_project_id) then
    raise exception 'Project % already has divisions — apply_standard_cost_code_template() only runs once, on a project with none.', p_project_id;
  end if;

  for v_template in select id, name, sort_order from public.division_templates order by sort_order loop
    insert into public.divisions (project_id, name, sort_order)
    values (p_project_id, v_template.name, v_template.sort_order)
    returning id into v_new_division_id;

    v_division_map := v_division_map || jsonb_build_object(v_template.id::text, v_new_division_id::text);
  end loop;

  for v_template in
    select division_template_id, code, activity_name, include_in_estimate, billable, sort_order
    from public.cost_code_templates
    order by sort_order
  loop
    insert into public.cost_codes (
      project_id, code, activity_name, division_id,
      include_in_estimate, billable, sort_order
    )
    values (
      p_project_id,
      v_template.code,
      v_template.activity_name,
      (v_division_map ->> v_template.division_template_id::text)::uuid,
      v_template.include_in_estimate,
      v_template.billable,
      v_template.sort_order
    );
  end loop;
end;
$$;

revoke all on function public.apply_standard_cost_code_template(uuid) from public;
grant execute on function public.apply_standard_cost_code_template(uuid) to authenticated;
