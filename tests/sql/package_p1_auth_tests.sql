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

-- =====================================================================
-- SECTION 5 — cross-organization staff isolation, PROVEN via real RLS
-- queries, not asserted via a mocked client.
--
-- Every fixture in package1_tests.sql and Sections 1-4 above belongs to
-- exactly ONE organization: bootstrap_organization() rejects a second
-- call by the same already-profiled user (see package1_tests.sql
-- Section 1), so that file never actually exercises a second org. That
-- left "staff cannot read another org's projects" -- the single most
-- important multi-tenant security property in this whole schema --
-- proven only by authorization_unit.ts's requireOrganizationAccess()
-- check against a fake/mocked Supabase client, never by an actual
-- query against real Postgres RLS.
--
-- This section bootstraps a genuinely SEPARATE Org B via a brand-new,
-- never-before-seen auth user (the same pattern already used in
-- SECTION 3 above for the new invited staff member), creates a project
-- and an invitation entirely owned by Org B, and proves isolation in
-- both directions via set_test_user() + `set local role authenticated`
-- -- the same real-RLS pattern as every other assertion in this file.
-- =====================================================================

select set_test_user(gen_random_uuid());
insert into auth.users (id) select current_setting('app.current_test_user')::uuid;
insert into test_fixture_ids values ('org_b_admin', current_setting('app.current_test_user')::uuid);

select bootstrap_organization('Org B', 'Org B Admin', 'orgb-admin@example.com') as new_org_id;

insert into test_fixture_ids
select 'org_b_id', org_id from profiles where id = (select value from test_fixture_ids where key = 'org_b_admin');

with new_row as (
  insert into projects (org_id, name, project_number, pricing_model)
  select org_id, 'Org B Project', 'OB-001', 'cost_plus_percentage'
  from profiles where id = (select value from test_fixture_ids where key = 'org_b_admin')
  returning id
)
insert into test_fixture_ids select 'project_org_b', id from new_row;

do $$
declare v_invitation_id uuid;
begin
  insert into invitations (org_id, email, role)
  select org_id, 'orgb-newstaff@example.com', 'staff'
  from profiles where id = (select value from test_fixture_ids where key = 'org_b_admin')
  returning id into v_invitation_id;

  insert into test_fixture_ids values ('invitation_org_b', v_invitation_id);
end $$;

select clear_test_user();

-- Org A's admin must NOT see Org B's project, and a full count must
-- not include it.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_count int; v_total int;
begin
  select count(*) into v_count from projects
  where id = (select value from test_fixture_ids where key = 'project_org_b');
  perform assert_that(v_count = 0, 'Org A admin must NOT see Org B''s project by id');

  select count(*) into v_total from projects;
  perform assert_that(v_total = 2, 'Org A admin''s total project count must be exactly the 2 Org-A projects, not 3');

  select count(*) into v_count from invitations
  where id = (select value from test_fixture_ids where key = 'invitation_org_b');
  perform assert_that(v_count = 0, 'Org A admin must NOT see Org B''s invitation');
end $$;

reset role;
select clear_test_user();

-- Org A's staff (distinct fixture from admin) must ALSO not see Org
-- B's project -- is_org_staff_for_org covers both roles, so both must
-- be proven, not just admin.
select set_test_user((select value from test_fixture_ids where key = 'staff_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from projects
  where id = (select value from test_fixture_ids where key = 'project_org_b');
  perform assert_that(v_count = 0, 'Org A staff must NOT see Org B''s project by id');

  select count(*) into v_count from invitations
  where id = (select value from test_fixture_ids where key = 'invitation_org_b');
  perform assert_that(v_count = 0, 'Org A staff must NOT see Org B''s invitation');
end $$;

reset role;
select clear_test_user();

-- Org B's admin must NOT see Org A's projects or invitations, in
-- either direction (the mirror image of the assertions above).
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
declare v_count int; v_total int;
begin
  select count(*) into v_count from projects
  where id in (
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'project_b')
  );
  perform assert_that(v_count = 0, 'Org B admin must NOT see either of Org A''s projects');

  select count(*) into v_total from projects;
  perform assert_that(v_total = 1, 'Org B admin should see exactly 1 project (their own), not Org A''s 2');

  select count(*) into v_count from invitations
  where id = (select value from test_fixture_ids where key = 'invitation_staff');
  perform assert_that(v_count = 0, 'Org B admin must NOT see Org A''s invitation');

  select count(*) into v_total from invitations;
  perform assert_that(v_total = 1, 'Org B admin should see exactly 1 invitation (their own org''s), not Org A''s');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 6 (migration 011) — sum_posted_expenses() is actually
-- invoked with a real value and asserted against a hand-computed
-- expectation (M-1 from the final whole-branch review: nothing
-- previously called this RPC at all).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_sum bigint;
begin
  -- project_b has no expenses anywhere else in this fixture set, so
  -- the expected sum is exactly this one posted expense's amount.
  insert into expenses (project_id, cost_code_id, vendor_name, transaction_date, amount_cents, financial_status, publication_status, posted_by, posted_at)
  values (
    (select value from test_fixture_ids where key = 'project_b'),
    (select value from test_fixture_ids where key = 'cost_code_b'),
    'Sum Check Vendor', '2026-06-10', 42500, 'posted', 'internal',
    (select value from test_fixture_ids where key = 'admin'), now()
  );

  -- A pending (not posted) expense of a much larger amount must be
  -- excluded from the sum -- proves the function filters on
  -- financial_status, not just project_id.
  insert into expenses (project_id, cost_code_id, vendor_name, transaction_date, amount_cents, financial_status, publication_status)
  values (
    (select value from test_fixture_ids where key = 'project_b'),
    (select value from test_fixture_ids where key = 'cost_code_b'),
    'Not Yet Posted Vendor', '2026-06-11', 999999, 'pending', 'internal'
  );

  select sum_posted_expenses((select value from test_fixture_ids where key = 'project_b')) into v_sum;
  perform assert_that(
    v_sum = 42500,
    'sum_posted_expenses(project_b) should equal the single posted expense''s amount (42500), excluding the 999999 pending one'
  );
end $$;

reset role;
select clear_test_user();
