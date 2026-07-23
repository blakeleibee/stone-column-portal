-- =====================================================================
-- Stone Column Portal — Package 1 SQL/RLS test suite
--
-- STATUS: written, NOT executed by the assistant. This sandbox has no
-- local Postgres, Docker, or network access to provision one (verified
-- before writing this file — no `psql`/`pg_ctl`/`docker` binary present,
-- and package-mirror access is blocked). Every claim in
-- docs/PACKAGE_01_CORRECTIONS_V2.md about this file says "written" or
-- "reasoned through," never "passed" or "verified," for exactly that
-- reason. Run this yourself and treat the result as the actual
-- verification — not this file, and not the corrections document.
--
-- DESIGN NOTE: role-switching (`SET LOCAL ROLE`) and `auth.uid()`
-- simulation are done as plain top-level statements BETWEEN do $$ ... $$
-- blocks, never inside one — mixing a `SET ROLE` statement into a
-- PL/pgSQL function body is not something the author could verify
-- behaves as expected without a real Postgres to test against, so this
-- script avoids relying on it at all.
--
-- RUNNING THIS FILE
--
-- Option A — against a real Supabase project (recommended — exercises
-- the actual `auth` schema, `auth.uid()`, and real default privileges):
--   1. supabase link (or use a throwaway project)
--   2. supabase db push   (applies schema/001_core_financial.sql)
--   3. Create real auth.users rows via the Admin API or service-role
--      insert before Section 1 (Supabase already has
--      `auth.users`/`auth.uid()` — nothing to stub).
--   4. psql "$DATABASE_URL" -f tests/sql/package1_tests.sql
--
-- Option B — bare local Postgres (faster, exercises every RLS policy/
-- trigger/constraint in this schema, but not real Supabase Auth):
--   1. docker run --rm -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16
--   2. psql "postgresql://postgres:test@localhost:5432/postgres" \
--        -f tests/sql/000_bare_postgres_bootstrap.sql
--        (MUST run before 001 — creates the `authenticated`/`anon`
--        roles that 001's own `create policy ... to authenticated`
--        statements require to already exist, plus default privileges
--        and the auth.uid() stub. See that file for why the order matters.)
--   3. psql "postgresql://postgres:test@localhost:5432/postgres" \
--        -f schema/001_core_financial.sql
--   4. psql "postgresql://postgres:test@localhost:5432/postgres" \
--        -f tests/sql/package1_tests.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- Test-logic helpers only. Environment setup (roles, default
-- privileges, auth.uid() stub) lives in
-- tests/sql/000_bare_postgres_bootstrap.sql and MUST run before
-- schema/001_core_financial.sql, not after — see that file's header
-- for why. Putting it here instead would be too late: 001 itself would
-- already have failed to create its `to authenticated` policies.
-- ---------------------------------------------------------------------

create or replace function set_test_user(p_user_id uuid) returns void
language sql as $$
  select set_config('app.current_test_user', p_user_id::text, false);
$$;

create or replace function clear_test_user() returns void
language sql as $$
  select set_config('app.current_test_user', '', false);
$$;

create or replace function assert_that(p_condition boolean, p_message text) returns void
language plpgsql as $$
begin
  if not p_condition then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

create or replace function assert_raises(p_sql text, p_message text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'ASSERTION FAILED (expected an error, got none): %', p_message;
  exception
    when others then
      if sqlerrm like 'ASSERTION FAILED%' then
        raise;
      end if;
      raise notice 'ok (rejected as expected) — %: %', p_message, sqlerrm;
  end;
end;
$$;

create temporary table test_fixture_ids (key text primary key, value uuid);
grant select, insert, update, delete on test_fixture_ids to authenticated, anon;

-- =====================================================================
-- SECTION 1 — Bootstrap
-- =====================================================================

select set_test_user(gen_random_uuid());
insert into auth.users (id) select current_setting('app.current_test_user')::uuid;
insert into test_fixture_ids values ('admin', current_setting('app.current_test_user')::uuid);

select bootstrap_organization('Stone Column', 'Brent Leibee', 'brent@stonecolumnhomes.com') as new_org_id;

do $$
begin
  perform assert_that(
    (select role from profiles where id = (select value from test_fixture_ids where key = 'admin')) = 'admin',
    'bootstrapping user should become admin'
  );
end $$;

-- Second call by the SAME (still logged-in) user must fail.
select assert_raises(
  format('select bootstrap_organization(%L, %L, %L)', 'Second Co', 'Brent Again', 'brent2@x.com'),
  'a user with an existing profile cannot bootstrap a second organization'
);

select clear_test_user();

-- Anonymous (no auth.uid()) cannot bootstrap at all.
select assert_raises(
  $sql$select bootstrap_organization('Nobody Co', 'Nobody', 'nobody@x.com')$sql$,
  'bootstrap_organization requires an authenticated caller'
);

-- =====================================================================
-- SECTION 2 — Fixture setup (as the bootstrapped admin)
--
-- Builds: 1 project each for "Client A" and "Client B" scenarios, cost
-- codes, two client profiles each scoped to a different project, and
-- expenses in pending/posted-internal/posted-published states.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));

with new_row as (
  insert into projects (org_id, name, project_number, pricing_model)
  select org_id, 'Hawks Ridge', 'HR-001', 'cost_plus_percentage' from profiles where id = current_setting('app.current_test_user')::uuid
  returning id
)
insert into test_fixture_ids select 'project_a', id from new_row;

with new_row as (
  insert into projects (org_id, name, project_number, pricing_model)
  select org_id, 'Maple Street Reno', 'MS-002', 'fixed_price' from profiles where id = current_setting('app.current_test_user')::uuid
  returning id
)
insert into test_fixture_ids select 'project_b', id from new_row;

with new_row as (
  insert into cost_codes (project_id, code)
  values ((select value from test_fixture_ids where key = 'project_a'), 'Framing')
  returning id
)
insert into test_fixture_ids select 'cost_code_a', id from new_row;

with new_row as (
  insert into cost_codes (project_id, code)
  values ((select value from test_fixture_ids where key = 'project_b'), 'Demo')
  returning id
)
insert into test_fixture_ids select 'cost_code_b', id from new_row;

insert into test_fixture_ids (key, value) values
  ('client_a', gen_random_uuid()),
  ('client_b', gen_random_uuid()),
  ('vendor_a', gen_random_uuid()),
  ('staff_a', gen_random_uuid());

insert into auth.users (id)
select value from test_fixture_ids where key in ('client_a', 'client_b', 'vendor_a', 'staff_a');
insert into profiles (id, org_id, role, full_name, email)
select (select value from test_fixture_ids where key = 'client_a'), org_id, 'client'::app_role, 'Alex Carter', 'alex@example.com' from profiles where id = current_setting('app.current_test_user')::uuid
union all
select (select value from test_fixture_ids where key = 'client_b'), org_id, 'client'::app_role, 'Jordan Someone', 'jordan@example.com' from profiles where id = current_setting('app.current_test_user')::uuid
union all
select (select value from test_fixture_ids where key = 'vendor_a'), org_id, 'vendor'::app_role, 'Vendor Contractor', 'vendor@example.com' from profiles where id = current_setting('app.current_test_user')::uuid
union all
select (select value from test_fixture_ids where key = 'staff_a'), org_id, 'staff'::app_role, 'Staff Member', 'staff@example.com' from profiles where id = current_setting('app.current_test_user')::uuid;

insert into project_members (project_id, user_id, member_role) values ((select value from test_fixture_ids where key = 'project_a'), (select value from test_fixture_ids where key = 'client_a'), 'client');
insert into project_members (project_id, user_id, member_role) values ((select value from test_fixture_ids where key = 'project_b'), (select value from test_fixture_ids where key = 'client_b'), 'client');
insert into project_members (project_id, user_id, member_role) values ((select value from test_fixture_ids where key = 'project_a'), (select value from test_fixture_ids where key = 'vendor_a'), 'vendor');

insert into expenses (project_id, cost_code_id, vendor_name, transaction_date, amount_cents, financial_status, publication_status, posted_by, posted_at, published_by, published_at)
select (select value from test_fixture_ids where key = 'project_a'), (select value from test_fixture_ids where key = 'cost_code_a'), 'Lumber Co', '2026-06-01', 500000, 'posted', 'published',
       current_setting('app.current_test_user')::uuid, now(), current_setting('app.current_test_user')::uuid, now();

insert into expenses (project_id, cost_code_id, vendor_name, transaction_date, amount_cents, financial_status, publication_status, posted_by, posted_at)
select (select value from test_fixture_ids where key = 'project_a'), (select value from test_fixture_ids where key = 'cost_code_a'), 'Internal Vendor', '2026-06-02', 250000, 'posted', 'internal',
       current_setting('app.current_test_user')::uuid, now();

insert into expenses (project_id, cost_code_id, vendor_name, transaction_date, amount_cents, financial_status, publication_status)
values ((select value from test_fixture_ids where key = 'project_a'), (select value from test_fixture_ids where key = 'cost_code_a'), 'Pending Vendor', '2026-06-03', 100000, 'pending', 'internal');

select clear_test_user();

-- =====================================================================
-- SECTION 3 — RLS: Client A vs Client B vs anonymous
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from projects;
  perform assert_that(v_count = 1, 'Client A should see exactly 1 project (their own)');

  select count(*) into v_count from projects where id = (select value from test_fixture_ids where key = 'project_b');
  perform assert_that(v_count = 0, 'Client A must NOT see Client B''s project');

  select count(*) into v_count from expenses;
  perform assert_that(v_count = 1, 'Client A should see exactly 1 (posted+published) expense');

  select count(*) into v_count from profiles where id = (select value from test_fixture_ids where key = 'client_b');
  perform assert_that(v_count = 0, 'Client A must not be able to enumerate Client B''s profile');
end $$;

reset role;
select clear_test_user();

-- Anonymous role: zero rows everywhere that matters.
set local role anon;

do $$
declare v_count int;
begin
  select count(*) into v_count from projects;
  perform assert_that(v_count = 0, 'anon must see zero projects');
  select count(*) into v_count from expenses;
  perform assert_that(v_count = 0, 'anon must see zero expenses');
  select count(*) into v_count from audit_log;
  perform assert_that(v_count = 0, 'anon must see zero audit_log rows');
end $$;

reset role;

-- =====================================================================
-- SECTION 3b — RLS: staff (distinct from admin)
--
-- `staff` gets the same org-wide operational access as `admin`
-- (is_org_staff_for_org covers both roles) — but is_org_admin_for_org
-- requires role='admin' specifically, so staff should NOT be able to
-- update another user's profile (e.g. can't change a client's role),
-- even though staff CAN see every project in the org same as admin.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'staff_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from projects;
  perform assert_that(v_count = 2, 'staff should see BOTH projects in the org, same as admin (org-wide access)');

  select count(*) into v_count from expenses
    where project_id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(v_count > 0, 'staff should see internal (non-published) expenses too, same as admin');
end $$;

-- RLS silently blocks disallowed UPDATEs (0 rows affected) rather than
-- raising an error, so this must assert the value is unchanged instead
-- of expecting an exception via assert_raises.
do $$
declare
  v_name_before text;
  v_name_after text;
begin
  select full_name into v_name_before from profiles where id = (select value from test_fixture_ids where key = 'client_a');
  update profiles set full_name = 'Hacked' where id = (select value from test_fixture_ids where key = 'client_a');
  select full_name into v_name_after from profiles where id = (select value from test_fixture_ids where key = 'client_a');
  perform assert_that(
    v_name_before = v_name_after,
    'staff (role=staff, not admin) must NOT be able to update another user''s profile — RLS silently blocks the write (0 rows affected), it does not raise an error, so this asserts the value is unchanged rather than expecting an exception'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 3c — RLS: Vendor A
--
-- No vendor-facing policy exists anywhere in this schema yet (the
-- vendor portal is Package 8) — a vendor today should see NOTHING
-- except their own project_members row. This test exists to prove
-- that absence of access is real, not accidental, and to give Package
-- 8 a regression baseline: these assertions should start FAILING the
-- day a vendor-read policy is intentionally added, which is exactly
-- the signal that policy needs its own new test, not a silent gap.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'vendor_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from projects;
  perform assert_that(v_count = 0, 'Vendor A should see zero projects (no vendor-read policy exists in Package 1)');

  select count(*) into v_count from expenses;
  perform assert_that(v_count = 0, 'Vendor A should see zero expenses');

  select count(*) into v_count from cost_codes;
  perform assert_that(v_count = 0, 'Vendor A should see zero cost codes');

  select count(*) into v_count from audit_log;
  perform assert_that(v_count = 0, 'Vendor A should see zero audit_log rows');

  select count(*) into v_count from project_members where user_id = (select value from test_fixture_ids where key = 'vendor_a');
  perform assert_that(v_count = 1, 'Vendor A should see their OWN project_members row (so the app can confirm membership)');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 — audit_log: staff sees project-scoped rows, clients see
-- none (regression test for the exact bug flagged in review: the
-- original policy was `for select using (true)` with no `to` clause).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from audit_log
    where project_id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(v_count > 0, 'admin should see audit_log rows for their own project');
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from audit_log;
  perform assert_that(v_count = 0, 'client must see ZERO audit_log rows, including for their own project');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 5 — Append-only / delete protection
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

with new_row as (
  insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, source_type)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         'original', 1000000, 'initial_setup'
  returning id
)
insert into test_fixture_ids select 'ledger_1', id from new_row;

select assert_raises(
  format('update budget_ledger set amount_cents = 1 where id = %L', (select value from test_fixture_ids where key = 'ledger_1')),
  'budget_ledger UPDATE must be rejected (append-only trigger)'
);
select assert_raises(
  format('delete from budget_ledger where id = %L', (select value from test_fixture_ids where key = 'ledger_1')),
  'budget_ledger DELETE must be rejected (append-only trigger)'
);

do $$
declare v_expense_posted_id uuid; v_expense_pending_id uuid;
begin
  select id into v_expense_posted_id from expenses
    where project_id = (select value from test_fixture_ids where key = 'project_a')
      and financial_status = 'posted' limit 1;

  perform assert_raises(
    format('delete from expenses where id = %L', v_expense_posted_id),
    'a POSTED expense cannot be deleted'
  );
  perform assert_raises(
    format('update expenses set amount_cents = 1 where id = %L', v_expense_posted_id),
    'a POSTED expense''s financial fields cannot be edited in place'
  );
  perform assert_raises(
    format('update expenses set financial_status = ''pending'' where id = %L', v_expense_posted_id),
    'a POSTED expense cannot move back to pending'
  );

  select id into v_expense_pending_id from expenses
    where project_id = (select value from test_fixture_ids where key = 'project_a')
      and financial_status = 'pending' limit 1;

  delete from expenses where id = v_expense_pending_id;
  perform assert_that(
    not exists (select 1 from expenses where id = v_expense_pending_id),
    'a PENDING expense should be deletable'
  );
  perform assert_that(
    exists (select 1 from audit_log where table_name = 'expenses' and record_id = v_expense_pending_id and action = 'delete'),
    'deleting a pending expense must still write an audit_log row'
  );

  update expenses set financial_status = 'void', publication_status = 'withdrawn' where id = v_expense_posted_id;
  perform assert_raises(
    format('update expenses set publication_status = ''ready'' where id = %L', v_expense_posted_id),
    'a VOID expense is immutable — no further changes at all'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 6 — Cross-project integrity (composite FK)
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

select assert_raises(
  format(
    'insert into expenses (project_id, cost_code_id, vendor_name, transaction_date, amount_cents) values (%L, %L, ''X'', ''2026-01-01'', 100)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_b')  -- belongs to project_b, mismatched on purpose
  ),
  'an expense with mismatched project_id/cost_code_id must be rejected by the composite FK'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 7 — Reversal magnitude guard
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

with new_row as (
  insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, source_type)
  select (select value from test_fixture_ids where key = 'project_a'),
         (select value from test_fixture_ids where key = 'cost_code_a'),
         'approved_change', 100000, 'change_order'
  returning id
)
insert into test_fixture_ids select 'original_id', id from new_row;

select assert_raises(
  format(
    'insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, source_type, reverses_entry_id) values (%L, %L, ''correction'', -150000, ''manual_correction'', %L)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a'),
    (select value from test_fixture_ids where key = 'original_id')
  ),
  'a reversal exceeding the original entry''s magnitude must be rejected unless flagged as an adjustment'
);

-- The same thing with is_adjustment = true must succeed.
insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, source_type, reverses_entry_id, is_adjustment)
select (select value from test_fixture_ids where key = 'project_a'),
       (select value from test_fixture_ids where key = 'cost_code_a'),
       'correction', -150000, 'manual_correction', (select value from test_fixture_ids where key = 'original_id'), true;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 8 — Self-escalation
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

select assert_raises(
  format('update profiles set role = ''admin'' where id = %L', (select value from test_fixture_ids where key = 'client_a')),
  'a user cannot change their own role, even to a role RLS might otherwise allow touching'
);

reset role;
select clear_test_user();

-- =====================================================================
-- If we reach this line, every assert_raises/assert_that above either
-- fired when expected or never fired when not expected — the whole
-- suite passed.
-- =====================================================================
select 'ALL PACKAGE 1 SQL/RLS TESTS PASSED' as result;
