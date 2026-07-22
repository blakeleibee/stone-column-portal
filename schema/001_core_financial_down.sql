-- =====================================================================
-- Stone Column Portal — Migration 001 ROLLBACK
--
-- STATUS: written, NOT executed — same reason as tests/sql/package1_tests.sql
-- (no local Postgres/Docker/network in this sandbox). This drops
-- everything 001_core_financial.sql creates, in reverse dependency
-- order, so `up -> down -> up` can be tested as a real rollback/reapply
-- cycle rather than asserted about.
--
-- Supabase/most teams treat migrations as forward-only in production
-- (you don't roll back a shipped migration, you write a new one) — this
-- file's purpose is narrower and pre-production: proving 001 itself has
-- no hidden one-way dependency that would make a clean re-run fail
-- (e.g. a leftover type, a partially-created index, a policy that
-- `create policy` — not `create or replace policy`, which doesn't exist
-- in Postgres — would choke on if it already existed).
--
-- RUNNING THE ROLLBACK/REAPPLY TEST (bare Postgres — Option B)
--   0. psql "$DATABASE_URL" -f tests/sql/000_bare_postgres_bootstrap.sql  (roles/grants/auth stub — once)
--   1. psql "$DATABASE_URL" -f schema/001_core_financial.sql
--   2. psql "$DATABASE_URL" -f tests/sql/package1_tests.sql   (optional — confirms it works pre-rollback)
--   3. psql "$DATABASE_URL" -f schema/001_core_financial_down.sql
--   4. psql "$DATABASE_URL" -f schema/001_core_financial.sql   (reapply — should succeed with zero errors;
--        step 0 does NOT need to repeat, since the roles/default-privileges/auth stub aren't touched by the down script)
--   5. psql "$DATABASE_URL" -f tests/sql/package1_tests.sql   (confirms the reapplied schema behaves identically)
--
-- On a real Supabase project (Option A), skip step 0 — the roles and
-- auth schema already exist — and step 3/4 double as a genuine "can
-- this migration be safely torn down and reapplied on a throwaway
-- branch/preview database" check.
-- =====================================================================

-- Views first (depend on tables).
drop view if exists client_expense_view;
drop view if exists client_budget_view;

-- Bootstrap / privileged functions.
drop function if exists public.bootstrap_organization(text, text, text);

-- Triggers are dropped automatically when their table is dropped, so no
-- explicit `drop trigger` statements are needed below — but the
-- trigger FUNCTIONS are separate objects and must be dropped explicitly
-- once nothing references them.

-- Tables in reverse dependency order (children before parents).
drop table if exists import_rows;
drop table if exists import_batches;
drop table if exists audit_log;
drop table if exists fee_ledger;
drop table if exists budget_suggestions;
drop table if exists forecast_entries;
drop table if exists committed_costs;
drop table if exists expenses;
drop table if exists budget_ledger;
drop table if exists cost_codes;
drop table if exists project_members;
drop table if exists project_fee_rules;
drop table if exists projects;
drop table if exists profiles;
drop table if exists orgs;

-- Trigger/helper functions (now safe — nothing references them).
drop function if exists public.reject_profile_self_escalation();
drop function if exists public.log_audit();
drop function if exists public.enforce_reversal_magnitude();
drop function if exists public.reject_expense_delete_unless_pending();
drop function if exists public.enforce_expense_state_transition();
drop function if exists public.reject_cost_code_delete_if_used();
drop function if exists public.reject_delete();
drop function if exists public.reject_mutation();
drop function if exists public.is_project_client(uuid);
drop function if exists public.is_org_staff(uuid);
drop function if exists public.is_org_admin_for_org(uuid);
drop function if exists public.is_org_staff_for_org(uuid);

-- Enum types last (nothing can depend on them once the tables are gone).
drop type if exists suggestion_status;
drop type if exists import_batch_status;
drop type if exists expense_publication_status;
drop type if exists expense_financial_status;
drop type if exists budget_entry_type;
drop type if exists cost_code_status;
drop type if exists billing_frequency;
drop type if exists pricing_model;
drop type if exists project_status;
drop type if exists fee_basis;
drop type if exists app_role;

-- Deliberately NOT dropped: the "uuid-ossp" extension and the `auth`
-- schema stub some test runs create (tests/sql/package1_tests.sql,
-- Option B) — those are environment setup, not part of this migration,
-- and dropping the extension could affect other schemas sharing the
-- database in a real multi-migration project.
