-- =====================================================================
-- Stone Column Portal — Bare-Postgres bootstrap (Option B ONLY)
--
-- STATUS: written, NOT executed — same disclosure as everywhere else in
-- tests/sql: no local Postgres/Docker/network in the assistant's
-- sandbox to run this against.
--
-- WHY THIS MUST RUN BEFORE schema/001_core_financial.sql, NOT AFTER:
-- 001 contains statements like `create policy ... to authenticated
-- using (...)`. Postgres validates that the `authenticated` role
-- exists at the moment `CREATE POLICY` runs — unlike a function body's
-- forward references (which aren't checked until first execution),
-- this one is checked immediately. On a real Supabase project this is
-- a non-issue (the roles already exist before any migration ever
-- runs). On bare Postgres, 001 will fail immediately with "role
-- authenticated does not exist" unless this file runs first.
--
-- This also uses `ALTER DEFAULT PRIVILEGES`, not a plain `GRANT ... ON
-- ALL TABLES`, because the tables don't exist yet at this point (001
-- hasn't run). Default privileges apply automatically to tables
-- created AFTER this point by the same role that runs 001 — which is
-- exactly what Supabase does behind the scenes for every project
-- (baseline SELECT/INSERT/UPDATE/DELETE to `authenticated`, baseline
-- SELECT to `anon`), before any RLS policy or migration-specific
-- REVOKE narrows it back down.
--
-- RUNNING (Option B):
--   1. docker run --rm -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16
--   2. psql "postgresql://postgres:test@localhost:5432/postgres" \
--        -f tests/sql/000_bare_postgres_bootstrap.sql
--   3. psql "postgresql://postgres:test@localhost:5432/postgres" \
--        -f schema/001_core_financial.sql
--   4. psql "postgresql://postgres:test@localhost:5432/postgres" \
--        -f tests/sql/package1_tests.sql
--
-- Option A (real Supabase project): skip this file entirely. The roles,
-- default privileges, and auth.uid()/auth.users already exist.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  execute format('grant authenticated to %I', current_user);
  execute format('grant anon to %I', current_user);
end $$;

grant usage on schema public to authenticated, anon;

-- Applies to every table 001_core_financial.sql is about to create,
-- automatically, the moment each `create table` runs — mirroring
-- Supabase's real provisioning order (defaults first, then the
-- migration's own REVOKEs take effect on top and are authoritative).
alter default privileges for role current_user in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role current_user in schema public
  grant select on tables to anon;
alter default privileges for role current_user in schema public
  grant execute on functions to authenticated;

-- ---------------------------------------------------------------------
-- Minimal auth.users / auth.uid() stub. Must exist before
-- package1_tests.sql runs (any time before, including now, is fine —
-- unlike role creation above, nothing in 001 itself calls auth.uid()
-- at CREATE TIME).
-- ---------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.current_test_user', true), '')::uuid;
$$;
