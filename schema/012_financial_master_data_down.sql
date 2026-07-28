-- =====================================================================
-- Stone Column Portal — Migration 012 ROLLBACK.
-- Reverses schema/012_financial_master_data.sql in dependency order.
-- See schema/001_core_financial_down.sql for the up/down/up reapply
-- test procedure this file is meant to support.
-- =====================================================================

drop function if exists public.apply_standard_cost_code_template(uuid);

-- audit_log policy added by 012 (audit_log itself is 001's table).
drop policy if exists audit_log_vendors_staff_select on audit_log;

-- Template tables (children before parent).
drop table if exists cost_code_templates;
drop table if exists division_templates;

-- orgs billing-identity additions.
drop policy if exists orgs_update_admin on orgs;
alter table orgs
  drop column if exists payable_to_name,
  drop column if exists billing_address,
  drop column if exists billing_city,
  drop column if exists billing_state,
  drop column if exists billing_zip,
  drop column if exists billing_phone,
  drop column if exists billing_email;

drop table if exists credit_ledger;
drop table if exists project_clients;
drop table if exists project_financial_settings;
drop function if exists public.log_audit_project_settings();
drop table if exists vendors;

-- cost_codes additions (constraint before columns).
alter table cost_codes drop constraint if exists cost_codes_division_project_fk;
alter table cost_codes
  drop column if exists division_id,
  drop column if exists activity_name,
  drop column if exists scope_description,
  drop column if exists include_in_estimate,
  drop column if exists billable;

drop table if exists divisions;
