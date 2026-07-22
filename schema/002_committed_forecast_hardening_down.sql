-- =====================================================================
-- Migration 002 ROLLBACK
--
-- STATUS: written, NOT executed (same disclosure as everywhere else).
-- Must run BEFORE schema/001_core_financial_down.sql in a full
-- rollback (002 only adds triggers/functions on top of 001's tables;
-- dropping 001's tables first would drop these triggers implicitly
-- anyway, but running things out of order is exactly the kind of thing
-- that should be prevented by convention, not accident).
--
-- Full teardown order: 002 down -> 001 down.
-- Full reapply order:  001 up -> 002 up.
-- =====================================================================

drop trigger if exists budget_suggestions_no_core_edit on budget_suggestions;
drop trigger if exists forecast_entries_no_core_edit on forecast_entries;
drop trigger if exists committed_costs_no_core_edit on committed_costs;

drop function if exists public.reject_suggestion_core_edit();
drop function if exists public.reject_forecast_core_edit();
drop function if exists public.reject_committed_cost_core_edit();
