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

-- =====================================================================
-- SECTION 3 (migration 009) — invitations
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_org_id uuid;
  v_invitation_id uuid;
begin
  select org_id into v_org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  insert into invitations (org_id, email, role)
  values (v_org_id, 'new-staff@example.com', 'staff')
  returning id into v_invitation_id;

  insert into test_fixture_ids values ('invitation_staff', v_invitation_id);

  perform assert_that(
    (select count(*) from invitations where id = v_invitation_id) = 1,
    'admin should be able to create an invitation in their own org'
  );
end $$;

-- A staff invitation scoped to a project must be rejected outright (would
-- otherwise fail atomically inside accept_invitation() later, since
-- project_members.member_role only allows 'client'/'vendor' -- see
-- invitations_staff_not_project_scoped). Run while still admin/authenticated
-- in their own org so the only thing that can reject this insert is the
-- new CHECK constraint, not RLS.
select assert_raises(
  format(
    'insert into invitations (org_id, project_id, email, role) values (%L, %L, %L, %L)',
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin')),
    (select value from test_fixture_ids where key = 'project_a'),
    'new-staff-scoped@example.com',
    'staff'
  ),
  'a staff invitation must not be scoped to a project (invitations_staff_not_project_scoped)'
);

reset role;
select clear_test_user();

-- A client (non-staff) must not be able to see the org's invitations at all.
select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from invitations;
  perform assert_that(v_count = 0, 'a non-staff user should see zero invitations via RLS');
end $$;

reset role;
select clear_test_user();

-- accept_invitation() end-to-end: a brand-new auth user, never before
-- seen, accepts the staff invitation created above.
select set_test_user(gen_random_uuid());
insert into auth.users (id) select current_setting('app.current_test_user')::uuid;
insert into test_fixture_ids values ('new_staff_user', current_setting('app.current_test_user')::uuid);
set local role authenticated;

do $$
declare
  v_token text;
  v_result_org uuid;
begin
  reset role;
  select token into v_token from invitations where id = (select value from test_fixture_ids where key = 'invitation_staff');
  set local role authenticated;

  select accept_invitation(v_token, 'New Staff Person') into v_result_org;
  perform assert_that(v_result_org is not null, 'accept_invitation should succeed for a valid, unexpired, unaccepted token');
  perform assert_that(
    (select role from profiles where id = (select value from test_fixture_ids where key = 'new_staff_user')) = 'staff',
    'accepting the invitation should create a profile with the invited role'
  );
end $$;

-- Re-running the same token must fail (already accepted).
select assert_raises(
  format('select accept_invitation(%L, %L)', (select token from invitations where id = (select value from test_fixture_ids where key = 'invitation_staff')), 'Someone Else'),
  'accept_invitation must reject a token that was already accepted'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 (migration 010) — documents
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_doc_id uuid;
begin
  insert into documents (project_id, uploaded_by, file_name, mime_type, size_bytes, category, storage_key, is_published_to_client)
  values (
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'admin'),
    'contract.pdf', 'application/pdf', 102400, 'contract', 'local/project_a/contract.pdf', false
  ) returning id into v_doc_id;
  insert into test_fixture_ids values ('document_unpublished', v_doc_id);

  insert into documents (project_id, uploaded_by, file_name, mime_type, size_bytes, category, storage_key, is_published_to_client)
  values (
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'admin'),
    'floor-plan.pdf', 'application/pdf', 51200, 'plans', 'local/project_a/floor-plan.pdf', true
  ) returning id into v_doc_id;
  insert into test_fixture_ids values ('document_published', v_doc_id);
end $$;

reset role;
select clear_test_user();

-- Client A (a member of project_a) sees only the published document.
select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from documents;
  perform assert_that(v_count = 1, 'client should see exactly one document (the published one)');

  select count(*) into v_count from documents where id = (select value from test_fixture_ids where key = 'document_unpublished');
  perform assert_that(v_count = 0, 'client must not see the unpublished document');
end $$;

reset role;
select clear_test_user();

-- Vendor A (also a member of project_a) sees zero documents -- no
-- vendor policy exists on this table yet, by design.
select set_test_user((select value from test_fixture_ids where key = 'vendor_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from documents;
  perform assert_that(v_count = 0, 'vendor should see zero documents (no vendor policy on this table in P1)');
end $$;

reset role;
select clear_test_user();
