-- =====================================================================
-- Stone Column Portal — P5.2 Phase A (Vendor Bid Access) SQL/RLS test
-- suite, covering schema/022_vendor_bid_access_phase_a.sql. Runs after
-- schema/001-022 and after every earlier test file, including
-- package_p5_commitments_bids_procurement_tests.sql and
-- package_p5_1_vendor_directory_fixes_tests.sql.
-- Reused fixtures: 'admin', 'org_b_admin', 'project_a', 'cost_code_a',
-- 'cost_code_a2'.
--
-- Deliberately does NOT reuse package_p5_commitments_bids_procurement_
-- tests.sql's own vendor_acme/bid_package_a fixtures — that file's
-- Section 2 setup manually inserts project_members rows for its vendor
-- test users as part of proving vendor_members isolation directly, which
-- would silently mask exactly the bug this migration fixes (a real
-- inviteVendor() call never creates a project_members row). Every
-- fixture below is deliberately built the way production code actually
-- builds it — a vendor_members row and a bid_submissions row, NEVER a
-- project_members row — so a passing test here is real proof the fix
-- works, not an artifact of test setup papering over the gap.
-- =====================================================================

-- test_fixture_ids (from package1_tests.sql) is uuid-valued only —
-- magic-link tokens are plain text, so this file needs its own small
-- session-scoped fixture table for them, following the exact same
-- shape/grant pattern.
create temporary table test_fixture_tokens (key text primary key, value text);
grant select, insert, update, delete on test_fixture_tokens to authenticated, anon;

-- ---------------------------------------------------------------------
-- SECTION 1 — fixtures: three vendor companies, three vendor sessions,
-- two bid packages in the SAME project, invited to different companies.
-- No project_members row is ever created for any of these profiles.
-- ---------------------------------------------------------------------

-- Fixture profile creation must happen as the table owner, not under
-- `set local role authenticated` — profiles has no insert policy at all
-- (see package_p5_commitments_bids_procurement_tests.sql's own Section 2
-- comment for the full explanation; same constraint applies here).
do $$
declare
  v_gamma_user uuid := gen_random_uuid();
  v_delta_user uuid := gen_random_uuid();
  v_epsilon_user uuid := gen_random_uuid();
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  insert into auth.users (id) values (v_gamma_user), (v_delta_user), (v_epsilon_user);

  insert into profiles (id, org_id, role, full_name, email)
  values
    (v_gamma_user, v_org_a_id, 'vendor', 'Gamma Roofing Contact', 'contact@gammaroofing.example'),
    (v_delta_user, v_org_a_id, 'vendor', 'Delta Plumbing Contact', 'contact@deltaplumbing.example'),
    (v_epsilon_user, v_org_a_id, 'vendor', 'Epsilon Electric Contact', 'contact@epsilonelectric.example');

  insert into test_fixture_ids values ('p522_gamma_user', v_gamma_user);
  insert into test_fixture_ids values ('p522_delta_user', v_delta_user);
  insert into test_fixture_ids values ('p522_epsilon_user', v_epsilon_user);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_vendor_gamma uuid;
  v_vendor_delta uuid;
  v_vendor_epsilon uuid;
  v_bid_package_gamma uuid;
  v_bid_package_delta uuid;
begin
  insert into vendors (org_id, name)
  select org_id, 'Gamma Roofing' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_vendor_gamma;
  insert into test_fixture_ids values ('p522_vendor_gamma', v_vendor_gamma);

  insert into vendors (org_id, name)
  select org_id, 'Delta Plumbing' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_vendor_delta;
  insert into test_fixture_ids values ('p522_vendor_delta', v_vendor_delta);

  -- Epsilon Electric: a real vendor company that will NEVER be invited
  -- to any bid package in project_a — proves the "never invited to
  -- anything in this project" scenario independently of cross-vendor
  -- isolation between gamma/delta.
  insert into vendors (org_id, name)
  select org_id, 'Epsilon Electric' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_vendor_epsilon;
  insert into test_fixture_ids values ('p522_vendor_epsilon', v_vendor_epsilon);

  -- vendor_members ONLY — no project_members row, exactly matching what
  -- accept_vendor_bid_invitation() actually creates in production.
  insert into vendor_members (vendor_id, profile_id)
  values
    (v_vendor_gamma, (select value from test_fixture_ids where key = 'p522_gamma_user')),
    (v_vendor_delta, (select value from test_fixture_ids where key = 'p522_delta_user')),
    (v_vendor_epsilon, (select value from test_fixture_ids where key = 'p522_epsilon_user'));

  insert into bid_packages (project_id, cost_code_id, title, scope_description, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Roofing Bid Package (P5.2 Phase A)', 'Full roofing scope', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_bid_package_gamma;
  insert into test_fixture_ids values ('p522_bid_package_gamma', v_bid_package_gamma);

  insert into bid_packages (project_id, cost_code_id, title, scope_description, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a2'), 'Plumbing Bid Package (P5.2 Phase A)', 'Full plumbing scope', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_bid_package_delta;
  insert into test_fixture_ids values ('p522_bid_package_delta', v_bid_package_delta);

  -- The one and only production-equivalent write: bid_submissions
  -- (what inviteVendor() actually does today), nothing else.
  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_bid_package_gamma, v_vendor_gamma);
  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_bid_package_delta, v_vendor_delta);

  -- A broadcast question on the gamma package, for the bid_questions
  -- leak-closure test below.
  insert into bid_questions (bid_package_id, question_text)
  values (v_bid_package_gamma, 'What is the expected start date?');
  insert into test_fixture_ids values (
    'p522_broadcast_question',
    (select id from bid_questions where bid_package_id = v_bid_package_gamma and question_text = 'What is the expected start date?')
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 2 — the four required scenarios, proven with NO
-- project_members row ever created for any of these profiles.
-- ---------------------------------------------------------------------

-- Scenario 1: a real vendor session with an active vendor_members row
-- and an active bid_submissions row CAN read the bid_packages row it
-- was invited to.
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 1,
    'Scenario 1: gamma vendor (vendor_members + bid_submissions, NO project_members row) can read the bid package it was invited to'
  );
  perform assert_that(
    (select title from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 'Roofing Bid Package (P5.2 Phase A)',
    'the readable row is genuinely the correct package, not merely a nonzero count'
  );
  -- cost_codes_vendor_read: can resolve the package's own cost code...
  perform assert_that(
    (select count(*) from cost_codes where id = (select cost_code_id from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma'))) = 1,
    'gamma vendor can resolve its own invited package''s cost code to a human-readable row (cost_codes_vendor_read)'
  );
end $$;

-- Scenario 2: a vendor from a DIFFERENT company, even invited to a
-- DIFFERENT package in the SAME project, cannot read a package it
-- wasn't invited to (both directions).
do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_delta')) = 0,
    'Scenario 2: gamma vendor cannot read delta''s package, even though both are in the same project'
  );
  -- ...but cannot resolve a cost code belonging only to a package it
  -- was never invited to (double-gate, not a blanket project grant).
  perform assert_that(
    (select count(*) from cost_codes where id = (select value from test_fixture_ids where key = 'cost_code_a2')) = 0,
    'gamma vendor cannot resolve delta''s cost code — cost_codes_vendor_read is scoped per invited package, not project-wide'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_delta')) = 1,
    'Scenario 2 (reverse direction): delta vendor can read its own invited package'
  );
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 0,
    'Scenario 2 (reverse direction): delta vendor cannot read gamma''s package'
  );
end $$;

reset role;
select clear_test_user();

-- Scenario 4: a vendor whose company was never invited to ANY bid
-- package in the project cannot read anything in that project.
select set_test_user((select value from test_fixture_ids where key = 'p522_epsilon_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where project_id = (select value from test_fixture_ids where key = 'project_a')) = 0,
    'Scenario 4: epsilon vendor (never invited to anything) sees zero bid_packages rows anywhere in the project'
  );
  perform assert_that(
    (select count(*) from bid_questions where id = (select value from test_fixture_ids where key = 'p522_broadcast_question')) = 0,
    'bid_questions_vendor_read fix: an uninvited vendor cannot read a broadcast question either — closes the leak the audit found'
  );
end $$;

reset role;
select clear_test_user();

-- bid_questions_vendor_read fix, positive case: the INVITED vendor can
-- still read the broadcast question exactly as before.
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_questions where id = (select value from test_fixture_ids where key = 'p522_broadcast_question')) = 1,
    'bid_questions_vendor_read fix: the invited vendor still reads the broadcast question on its own package'
  );
end $$;

reset role;
select clear_test_user();

-- bid_questions_vendor_read fix, negative case: delta (invited to a
-- DIFFERENT package in the SAME project) must NOT read gamma's
-- broadcast question — this is the exact leak scenario the audit found.
select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_questions where id = (select value from test_fixture_ids where key = 'p522_broadcast_question')) = 0,
    'bid_questions_vendor_read fix: a vendor invited only to a DIFFERENT package in the same project cannot read another package''s broadcast question'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- Scenario 3: a vendor whose vendor_members row is revoked loses access
-- IMMEDIATELY, and regains it on reactivation.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update vendor_members set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_gamma')
    and profile_id = (select value from test_fixture_ids where key = 'p522_gamma_user');
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 0,
    'Scenario 3: revoking the vendor_members row removes bid_packages access immediately, with no other change'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update vendor_members set revoked_at = null
  where vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_gamma')
    and profile_id = (select value from test_fixture_ids where key = 'p522_gamma_user');
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 1,
    'Scenario 3 (reactivation): reactivating the vendor_members row restores access'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 3 — is_project_vendor() itself is untouched: cross-org
-- isolation still holds via the ordinary org-scoped RLS on bid_packages
-- (org B admin cannot see any of this org's data at all).
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 0,
    'org B admin still cannot see org A''s bid package after this migration'
  );
  perform assert_that(
    (select count(*) from bid_vendor_access_invitations) = 0,
    'org B admin sees zero bid_vendor_access_invitations rows — staff-manage policy is org/project scoped'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 — bid_vendor_access_invitations: staff-only table access,
-- org-match trigger, and accept_vendor_bid_invitation() end-to-end for
-- both first-access shapes.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- Happy path: staff creates a real invitation for a brand-new vendor
-- contact (case (b): no existing profile).
do $$
declare
  v_invitation_id uuid;
  v_token text;
begin
  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
  select
    (select org_id from vendors where id = (select value from test_fixture_ids where key = 'p522_vendor_gamma')),
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    'newcontact@gammaroofing.example'
  returning id, token into v_invitation_id, v_token;

  insert into test_fixture_ids values ('p522_invitation_new_person', v_invitation_id);
  insert into test_fixture_tokens values ('p522_invitation_new_person_token', v_token);

  perform assert_that(v_token is not null and length(v_token) > 0, 'a real, non-empty magic-link token is generated on insert');
end $$;

-- Org-mismatch rejection: inviting vendor_gamma (org A) to a
-- fabricated bid_package_id that resolves to a different org must fail.
-- Reuses the existing cross-org fixtures (org_b_admin/project_b_id are
-- NOT usable here since project_b_id belongs to org A too — org A has
-- no second org to mismatch against in these fixtures without creating
-- one, so this asserts the narrower but still real invariant: org_id
-- explicitly set to something OTHER than the vendor's real org is
-- rejected outright, independent of the bid package.
select assert_raises(
  format(
    $sql$insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
         values (%L, %L, %L, 'mismatch@example.com')$sql$,
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'org_b_admin')),
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  ),
  'inserting a bid_vendor_access_invitations row with org_id not matching the vendor''s real org must be rejected'
);

reset role;
select clear_test_user();

-- No vendor session can read the invitations table directly — matches
-- invitations' own "no policy grants the invited party direct table
-- access" posture exactly.
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_vendor_access_invitations where id = (select value from test_fixture_ids where key = 'p522_invitation_new_person')) = 0,
    'a vendor session cannot read bid_vendor_access_invitations directly — acceptance only happens through the RPC'
  );
end $$;

reset role;
select clear_test_user();

-- Case (b): brand-new person accepting. Simulates the real flow: the
-- app calls supabase.auth.signUp() first (here: a fresh auth.users row
-- created directly, as the table owner, then set_test_user() makes it
-- the acting session), THEN calls accept_vendor_bid_invitation().
do $$
declare
  v_new_person uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_new_person);
  insert into test_fixture_ids values ('p522_new_person', v_new_person);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'p522_new_person'));
set local role authenticated;

do $$
declare
  v_result record;
begin
  select * into v_result from accept_vendor_bid_invitation(
    (select value from test_fixture_tokens where key = 'p522_invitation_new_person_token'),
    'Newly Onboarded Gamma Employee'
  );

  perform assert_that(v_result.bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma'), 'accept_vendor_bid_invitation returns the correct bid_package_id for redirect');
  perform assert_that(
    (select role from profiles where id = (select value from test_fixture_ids where key = 'p522_new_person')) = 'vendor',
    'a brand-new profile is created with role=vendor'
  );
  perform assert_that(
    (select count(*) from vendor_members where vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_gamma') and profile_id = (select value from test_fixture_ids where key = 'p522_new_person') and revoked_at is null) = 1,
    'a real, active vendor_members row now links the new profile to the invited vendor company'
  );
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 1,
    'end-to-end proof: the brand-new vendor session, having only just accepted, can now read the bid package via ordinary RLS (no special-casing)'
  );
end $$;

reset role;
select clear_test_user();

-- Re-running accept_vendor_bid_invitation with the SAME (now-accepted)
-- token, as the SAME already-onboarded profile, is a deliberate
-- idempotent no-op — not an error. This matters in practice: a vendor
-- who clicks the same magic link twice (e.g. a stale browser tab) must
-- not be met with a confusing failure, and must not end up with a
-- duplicated vendor_members row.
select set_test_user((select value from test_fixture_ids where key = 'p522_new_person'));
set local role authenticated;

do $$
declare
  v_result record;
  v_member_count integer;
begin
  select * into v_result from accept_vendor_bid_invitation(
    (select value from test_fixture_tokens where key = 'p522_invitation_new_person_token'),
    'Second Attempt'
  );
  perform assert_that(v_result.bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma'), 'accepting the same already-accepted token again is idempotent, not an error');

  select count(*) into v_member_count from vendor_members
  where vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_gamma')
    and profile_id = (select value from test_fixture_ids where key = 'p522_new_person');
  perform assert_that(v_member_count = 1, 're-accepting the same token does not duplicate the vendor_members row');
end $$;

reset role;
select clear_test_user();

-- Case (a): an EXISTING vendor profile (delta''s own contact) accepting
-- a SECOND invitation issued to a DIFFERENT vendor company than the one
-- it's already a member of must be rejected on role/email grounds if
-- mismatched, but accepting an invitation issued to the SAME company it
-- already belongs to (e.g. a second bid package) must succeed as a
-- no-op-on-membership, idempotent confirmation.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_second_gamma_package uuid;
  v_invitation_existing_id uuid;
  v_token_existing text;
begin
  insert into bid_packages (project_id, cost_code_id, title, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Second Roofing Package (P5.2 Phase A)', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_second_gamma_package;
  insert into test_fixture_ids values ('p522_bid_package_gamma_2', v_second_gamma_package);

  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_second_gamma_package, (select value from test_fixture_ids where key = 'p522_vendor_gamma'));

  -- Invite the SAME already-registered gamma_user to this new package.
  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
  select
    (select org_id from vendors where id = (select value from test_fixture_ids where key = 'p522_vendor_gamma')),
    v_second_gamma_package,
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    'contact@gammaroofing.example'
  returning id, token into v_invitation_existing_id, v_token_existing;

  insert into test_fixture_ids values ('p522_invitation_existing_person', v_invitation_existing_id);
  insert into test_fixture_tokens values ('p522_invitation_existing_person_token', v_token_existing);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
declare
  v_result record;
  v_member_count integer;
begin
  select * into v_result from accept_vendor_bid_invitation(
    (select value from test_fixture_tokens where key = 'p522_invitation_existing_person_token'),
    null
  );

  perform assert_that(v_result.bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma_2'), 'case (a): an existing profile accepting a second invitation gets the NEW package''s id back for redirect');

  select count(*) into v_member_count from vendor_members
  where vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_gamma')
    and profile_id = (select value from test_fixture_ids where key = 'p522_gamma_user');
  perform assert_that(v_member_count = 1, 'case (a): accepting a second invitation for an already-active member does not duplicate the vendor_members row');

  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma_2')) = 1,
    'case (a): the existing vendor session can now read the second package too'
  );
end $$;

reset role;
select clear_test_user();

-- Email mismatch: a signed-in profile trying to accept an invitation
-- issued to a DIFFERENT email must be rejected outright.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_mismatch_package uuid;
  v_mismatch_invitation_id uuid;
  v_mismatch_token text;
begin
  insert into bid_packages (project_id, cost_code_id, title, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Mismatch Test Package', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_mismatch_package;

  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_mismatch_package, (select value from test_fixture_ids where key = 'p522_vendor_gamma'));

  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
  select
    (select org_id from vendors where id = (select value from test_fixture_ids where key = 'p522_vendor_gamma')),
    v_mismatch_package,
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    'someone-else-entirely@example.com'
  returning id, token into v_mismatch_invitation_id, v_mismatch_token;

  insert into test_fixture_tokens values ('p522_invitation_mismatch_token', v_mismatch_token);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

select assert_raises(
  format(
    'select * from accept_vendor_bid_invitation(%L, null)',
    (select value from test_fixture_tokens where key = 'p522_invitation_mismatch_token')
  ),
  'an existing profile accepting an invitation issued to a DIFFERENT email must be rejected'
);

reset role;
select clear_test_user();

-- Revoked/expired token rejection.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_revoked_package uuid;
  v_revoked_invitation_id uuid;
  v_revoked_token text;
begin
  insert into bid_packages (project_id, cost_code_id, title, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Revoked Invitation Test Package', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_revoked_package;

  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_revoked_package, (select value from test_fixture_ids where key = 'p522_vendor_gamma'));

  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email, revoked_at)
  select
    (select org_id from vendors where id = (select value from test_fixture_ids where key = 'p522_vendor_gamma')),
    v_revoked_package,
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    'contact@gammaroofing.example',
    now()
  returning id, token into v_revoked_invitation_id, v_revoked_token;

  insert into test_fixture_tokens values ('p522_invitation_revoked_token', v_revoked_token);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

select assert_raises(
  format(
    'select * from accept_vendor_bid_invitation(%L, null)',
    (select value from test_fixture_tokens where key = 'p522_invitation_revoked_token')
  ),
  'a revoked invitation token must be rejected'
);

select assert_raises(
  'select * from accept_vendor_bid_invitation(''not-a-real-token-at-all'', null)',
  'a nonexistent token must be rejected'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 5 — audit visibility for the new table.
-- =====================================================================
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from audit_log where table_name = 'bid_vendor_access_invitations' and record_id = (select value from test_fixture_ids where key = 'p522_invitation_new_person')) > 0,
    'bid_vendor_access_invitations insert produced a readable audit_log row'
  );
end $$;

reset role;
select clear_test_user();
