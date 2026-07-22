-- =====================================================================
-- Migration 005 ROLLBACK
--
-- STATUS: written, NOT executed. Full teardown order: 005 down -> 004
-- down -> 003 down -> 002 down -> 001 down. Full reapply order:
-- 001 -> 002 -> 003 -> 004 -> 005.
-- =====================================================================

drop trigger if exists forecast_entries_lineage_consistency_check on forecast_entries;
drop function if exists public.check_forecast_lineage_consistency();
