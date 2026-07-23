-- =====================================================================
-- Stone Column Portal — P1 auth/RBAC negative-path SQL test suite.
--
-- Runs after schema/001-010 (via scripts/db/run-sql-tests.mjs) against
-- a fresh PGlite instance. Uses the exact set_test_user()/clear_test_user()/
-- assert_that()/assert_raises()/test_fixture_ids conventions already
-- established in tests/sql/package1_tests.sql (that file defines these
-- helpers; this file assumes it already ran in the same session, since
-- the harness runs both files against the same PGlite instance in
-- sequence — see scripts/db/run-sql-tests.mjs's FILES list).
--
-- This file grows across Tasks 3-6 of the P1 implementation plan, one
-- section per new migration's RLS surface.
-- =====================================================================

-- =====================================================================
-- SECTION 1 (migration 007) — vendor identity
-- =====================================================================

-- Vendor A (already seeded as 'vendor_a' in package1_tests.sql, a
-- member of project_a only) can read their own project_members row.
select set_test_user((select value from test_fixture_ids where key = 'vendor_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from project_members
  where project_id = (select value from test_fixture_ids where key = 'project_a')
    and user_id = (select value from test_fixture_ids where key = 'vendor_a');
  perform assert_that(v_count = 1, 'vendor should see their own project_members row (already covered by project_members_self_read from 001)');

  perform assert_that(
    is_project_vendor((select value from test_fixture_ids where key = 'project_a')),
    'is_project_vendor() should return true for a vendor on their own project'
  );
  perform assert_that(
    not is_project_vendor((select value from test_fixture_ids where key = 'project_b')),
    'is_project_vendor() should return false for a project the vendor is not a member of'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 2 (migration 008) — project status transitions
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update projects set status = 'active' where id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(
    (select status from projects where id = (select value from test_fixture_ids where key = 'project_a')) = 'active',
    'draft -> active should be a valid project status transition'
  );
end $$;

select assert_raises(
  format(
    'update projects set status = %L where id = %L',
    'archived',
    (select value from test_fixture_ids where key = 'project_a')
  ),
  'active -> archived must be rejected (must go through closed_out first)'
);

reset role;
select clear_test_user();
