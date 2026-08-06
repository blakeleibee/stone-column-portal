-- =====================================================================
-- Stone Column Portal — Migration 013 ROLLBACK.
-- Reverses schema/013_estimating_and_qb_import.sql in dependency order.
-- See schema/001_core_financial_down.sql for the up/down/up reapply
-- test procedure this file is meant to support.
-- =====================================================================

-- Triggers (before functions that define them)
drop trigger if exists audit_import_batches on import_batches;
drop trigger if exists audit_import_rows on import_rows;
drop trigger if exists audit_import_mapping_profiles on import_mapping_profiles;
drop trigger if exists enforce_single_original_budget_entry on budget_ledger;

-- Trigger functions
drop function if exists public.log_audit_via_batch();
drop function if exists public.enforce_single_original_budget_entry();

-- Indexes (before constraints)
drop index if exists budget_ledger_one_original_per_cost_code;

-- RLS policy
drop policy if exists import_mapping_profiles_staff_only on import_mapping_profiles;

-- Constraints (before columns)
alter table budget_ledger
  drop constraint if exists budget_ledger_correction_requires_note;

-- Columns added to existing tables
alter table import_batches
  drop column if exists mapping_profile_id;

-- Tables created
drop table if exists import_mapping_profiles;
