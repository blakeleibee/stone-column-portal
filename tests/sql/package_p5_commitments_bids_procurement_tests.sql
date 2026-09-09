-- =====================================================================
-- Stone Column Portal — P5 (Commitments, Bids, Procurement) SQL/RLS
-- test suite, covering schema/015_commitments_bids_procurement.sql
-- (Revision 3). Runs after schema/001-015 and after package1_tests.sql /
-- package_p1_auth_tests.sql / package_p4_estimating_qb_import_tests.sql.
-- Reused fixtures: 'admin', 'org_b_admin', 'project_a', 'cost_code_a'.
-- =====================================================================

-- =====================================================================
-- SECTION 1 — composite FK + staff RLS + cross-org isolation.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_bid_package_id uuid;
  v_material_order_id uuid;
  v_vendor_acme_id uuid;
  v_cost_code_a2 uuid;
begin
  insert into bid_packages (project_id, cost_code_id, title, scope_description)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Framing Bid Package', 'Full framing scope'
  from test_fixture_ids where key = 'project_a'
  returning id into v_bid_package_id;
  insert into test_fixture_ids values ('bid_package_a', v_bid_package_id);

  perform assert_that((select count(*) from bid_packages where id = v_bid_package_id) = 1, 'org A admin can create a bid package');

  -- A second real cost code on project_a, for the line-level allocation
  -- tests in Section 6 (Decision 2).
  insert into cost_codes (project_id, code)
  select value, '09-100' from test_fixture_ids where key = 'project_a'
  returning id into v_cost_code_a2;
  insert into test_fixture_ids values ('cost_code_a2', v_cost_code_a2);

  insert into vendors (org_id, name)
  select org_id, 'Acme Framing' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_vendor_acme_id;
  insert into test_fixture_ids values ('vendor_acme', v_vendor_acme_id);

  -- No cost_code_id at all on the order — proves Decision 2's
  -- "order-level default is optional" directly.
  insert into material_orders (project_id, vendor_id, order_number)
  select value, v_vendor_acme_id, 'PO-1001' from test_fixture_ids where key = 'project_a'
  returning id into v_material_order_id;
  insert into test_fixture_ids values ('material_order_a', v_material_order_id);

  perform assert_that((select count(*) from material_orders where id = v_material_order_id) = 1, 'org A admin can create a material order with no order-level cost code default');
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 0, 'org B admin cannot see org A''s bid package');
  perform assert_that((select count(*) from material_orders where id = (select value from test_fixture_ids where key = 'material_order_a')) = 0, 'org B admin cannot see org A''s material order');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 2 — vendor_members: org isolation (DB-enforced, not just
-- RLS), and all three required vendor isolation axes per
-- PRODUCTION-ROADMAP.md's vendor-RLS-sequencing rule item 5, extended
-- in this revision to include "two members, one vendor."
-- =====================================================================

-- Fixture profile creation for the three vendor-side test users below
-- must happen as the table owner, NOT under `set local role
-- authenticated`: profiles has no insert policy at all, and INSERT is
-- explicitly revoked from `authenticated`
-- (schema/001_core_financial.sql line 907 — "No insert/delete policy
-- for profiles at all — creation only happens via
-- bootstrap_organization() ... or an existing admin inviting a user
-- through a future server-side/RPC flow, never a direct client-side
-- insert"). Running this under role authenticated is exactly what
-- produced "permission denied for table profiles" here. Mirrors how
-- tests/sql/package1_tests.sql creates its own directly-inserted
-- fixture profiles (client_a/client_b/vendor_a/staff_a) outside any
-- role switch. Also inserts the auth.users row each profile requires
-- via its FK, which the previous attempt omitted entirely.
do $$
declare
  v_vendor_acme_user_1 uuid := gen_random_uuid();
  v_vendor_acme_user_2 uuid := gen_random_uuid();
  v_vendor_b_user uuid := gen_random_uuid();
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  insert into auth.users (id) values (v_vendor_acme_user_1), (v_vendor_acme_user_2), (v_vendor_b_user);

  -- Two DIFFERENT people, same vendor business (vendor_acme), plus one
  -- person for the unrelated second vendor business.
  insert into profiles (id, org_id, role, full_name, email)
  values
    (v_vendor_acme_user_1, v_org_a_id, 'vendor', 'Acme Framing — Owner', 'owner@acmeframing.example'),
    (v_vendor_acme_user_2, v_org_a_id, 'vendor', 'Acme Framing — Estimator', 'estimator@acmeframing.example'),
    (v_vendor_b_user, v_org_a_id, 'vendor', 'Beta Electric Contact', 'beta@example.com');

  insert into test_fixture_ids values ('vendor_acme_user_1', v_vendor_acme_user_1);
  insert into test_fixture_ids values ('vendor_acme_user_2', v_vendor_acme_user_2);
  insert into test_fixture_ids values ('vendor_b_user', v_vendor_b_user);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_second_vendor uuid;
  v_second_bid_package uuid;
  v_bid_submission_id uuid;
begin
  insert into project_members (project_id, user_id, member_role)
  select value, (select value from test_fixture_ids where key = 'vendor_acme_user_1'), 'vendor' from test_fixture_ids where key = 'project_a';
  insert into project_members (project_id, user_id, member_role)
  select value, (select value from test_fixture_ids where key = 'vendor_acme_user_2'), 'vendor' from test_fixture_ids where key = 'project_a';
  insert into vendor_members (vendor_id, profile_id)
  values
    ((select value from test_fixture_ids where key = 'vendor_acme'), (select value from test_fixture_ids where key = 'vendor_acme_user_1')),
    ((select value from test_fixture_ids where key = 'vendor_acme'), (select value from test_fixture_ids where key = 'vendor_acme_user_2'));

  -- A second, unrelated vendor business, invited to a DIFFERENT package.
  insert into vendors (org_id, name)
  select org_id, 'Beta Electric' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_second_vendor;
  insert into test_fixture_ids values ('vendor_beta', v_second_vendor);
  insert into project_members (project_id, user_id, member_role)
  select value, (select value from test_fixture_ids where key = 'vendor_b_user'), 'vendor' from test_fixture_ids where key = 'project_a';
  insert into vendor_members (vendor_id, profile_id) values (v_second_vendor, (select value from test_fixture_ids where key = 'vendor_b_user'));

  insert into bid_packages (project_id, cost_code_id, title, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a2'), 'Electrical Bid Package', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_second_bid_package;
  insert into test_fixture_ids values ('bid_package_electrical', v_second_bid_package);

  insert into bid_submissions (bid_package_id, vendor_id)
  values ((select value from test_fixture_ids where key = 'bid_package_a'), (select value from test_fixture_ids where key = 'vendor_acme'))
  returning id into v_bid_submission_id;
  insert into test_fixture_ids values ('bid_submission_a', v_bid_submission_id);

  insert into bid_submissions (bid_package_id, vendor_id) values (v_second_bid_package, v_second_vendor);

  update bid_packages set status = 'published' where id = (select value from test_fixture_ids where key = 'bid_package_a');
end $$;

-- Org-match trigger: reject linking org B's admin (a real, different-org
-- profile) to org A's vendor.
select assert_raises(
  format(
    'insert into vendor_members (vendor_id, profile_id) values (%L, %L)',
    (select value from test_fixture_ids where key = 'vendor_acme'),
    (select value from test_fixture_ids where key = 'org_b_admin')
  ),
  'linking a cross-org profile to a vendor must be rejected by enforce_vendor_member_org_match()'
);

reset role;
select clear_test_user();

-- A third project, to prove cross-project isolation independently of
-- cross-vendor isolation.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_project_b uuid;
  v_cost_code_b uuid;
begin
  insert into projects (org_id, name, project_number, pricing_model)
  select org_id, 'Second Project', 'P-002', 'fixed_price' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_project_b;
  insert into cost_codes (project_id, code) values (v_project_b, '06-100') returning id into v_cost_code_b;
  insert into bid_packages (project_id, cost_code_id, title, status) values (v_project_b, v_cost_code_b, 'Other Project Framing', 'published');
  insert into test_fixture_ids values ('project_b_id', v_project_b);
end $$;

reset role;
select clear_test_user();

-- Vendor acme, person 1.
select set_test_user((select value from test_fixture_ids where key = 'vendor_acme_user_1'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 1, 'vendor acme person 1 can see the bid package they are invited to');
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_electrical')) = 0, 'vendor acme person 1 (cross-vendor) sees nothing belonging to vendor B');
  perform assert_that((select count(*) from bid_packages where project_id = (select value from test_fixture_ids where key = 'project_b_id')) = 0, 'vendor acme person 1 (cross-project) sees nothing on a project they are not a member of');
end $$;

reset role;
select clear_test_user();

-- Vendor acme, person 2 — DIFFERENT auth identity, SAME vendor business:
-- must see exactly what person 1 sees (new required axis this revision).
select set_test_user((select value from test_fixture_ids where key = 'vendor_acme_user_2'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 1, 'vendor acme person 2 (different login, same vendor business) sees the same bid package as person 1');
  perform assert_that((select count(*) from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 1, 'vendor acme person 2 can read the shared bid_submissions row');
end $$;

reset role;
select clear_test_user();

-- Revocation test
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- Identity immutability: vendor_id/profile_id can never change post-insert.
-- Must target a GENUINELY different vendor_id (vendor_beta, not
-- vendor_acme again) — the trigger uses `is distinct from` against the
-- old value, so reassigning a column to its own current value is a
-- no-op that would never raise and would make this assertion vacuous.
select assert_raises(
  format(
    'update vendor_members set vendor_id = %L where vendor_id = %L and profile_id = %L',
    (select value from test_fixture_ids where key = 'vendor_beta'),
    (select value from test_fixture_ids where key = 'vendor_acme'),
    (select value from test_fixture_ids where key = 'vendor_acme_user_2')
  ),
  'reassigning vendor_members.vendor_id post-insert must be rejected'
);

-- Anti-spoofing: revoked_by must equal auth.uid() at the moment of revocation.
select assert_raises(
  format(
    'update vendor_members set revoked_at = now(), revoked_by = %L where vendor_id = %L and profile_id = %L',
    (select value from test_fixture_ids where key = 'org_b_admin'),
    (select value from test_fixture_ids where key = 'vendor_acme'),
    (select value from test_fixture_ids where key = 'vendor_acme_user_2')
  ),
  'revoking with revoked_by set to someone other than the acting session must be rejected'
);

-- Task 1 review round 1 fix, tested here: inserting an ALREADY-revoked
-- row with a forged revoked_by must be rejected too, not just an
-- update transition. A fresh, throwaway vendor/profile pair keeps this
-- independent of vendor_acme's fixtures.
--
-- The throwaway profile (and its auth.users row) must be created as
-- the table owner, NOT under `set local role authenticated` — same
-- reason as the Section 2 fixture setup above: profiles has no insert
-- policy and INSERT is revoked from authenticated entirely.
reset role;

do $$
declare
  v_throwaway_user uuid := gen_random_uuid();
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');
  insert into auth.users (id) values (v_throwaway_user);
  insert into profiles (id, org_id, role, full_name, email)
  values (v_throwaway_user, v_org_a_id, 'vendor', 'Throwaway', 'throwaway@example.com');
  insert into test_fixture_ids values ('throwaway_user', v_throwaway_user);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_throwaway_vendor uuid;
begin
  insert into vendors (org_id, name)
  select org_id, 'Throwaway Vendor' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_throwaway_vendor;

  perform assert_raises(
    format(
      'insert into vendor_members (vendor_id, profile_id, revoked_at, revoked_by) values (%L, %L, now(), %L)',
      v_throwaway_vendor, (select value from test_fixture_ids where key = 'throwaway_user'), (select value from test_fixture_ids where key = 'org_b_admin')
    ),
    'inserting an already-revoked vendor_members row with a forged revoked_by must be rejected'
  );
end $$;

-- Task 1 review round 1 fix, tested here: on an ALREADY-revoked row, an
-- update that changes ONLY revoked_by (leaving the already-set
-- revoked_at untouched) must still be checked, not silently skipped —
-- this is what "silently reattributing an already-recorded revocation"
-- means concretely. Needs its own already-revoked throwaway row, since
-- the fixture the row this test needs (revoked_at already non-null)
-- doesn't exist yet at this point in the file. Same profiles-insert
-- role constraint as above applies to this throwaway profile too.
reset role;

do $$
declare
  v_throwaway_user_2 uuid := gen_random_uuid();
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');
  insert into auth.users (id) values (v_throwaway_user_2);
  insert into profiles (id, org_id, role, full_name, email)
  values (v_throwaway_user_2, v_org_a_id, 'vendor', 'Throwaway 2', 'throwaway2@example.com');
  insert into test_fixture_ids values ('throwaway_user_2', v_throwaway_user_2);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_throwaway_vendor_2 uuid;
begin
  insert into vendors (org_id, name)
  select org_id, 'Throwaway Vendor 2' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_throwaway_vendor_2;
  insert into vendor_members (vendor_id, profile_id)
  values (v_throwaway_vendor_2, (select value from test_fixture_ids where key = 'throwaway_user_2'));

  -- Legitimate revoke first (passes the trigger, admin revoking their own action).
  update vendor_members set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where vendor_id = v_throwaway_vendor_2 and profile_id = (select value from test_fixture_ids where key = 'throwaway_user_2');

  insert into test_fixture_ids values ('throwaway_vendor_2', v_throwaway_vendor_2);
end $$;

select assert_raises(
  format(
    'update vendor_members set revoked_by = %L where vendor_id = %L and profile_id = %L',
    (select value from test_fixture_ids where key = 'org_b_admin'),
    (select value from test_fixture_ids where key = 'throwaway_vendor_2'),
    (select value from test_fixture_ids where key = 'throwaway_user_2')
  ),
  'reassigning revoked_by on an already-revoked row, with revoked_at left unchanged, must still be rejected'
);

-- The actual revoke
do $$
begin
  update vendor_members set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where vendor_id = (select value from test_fixture_ids where key = 'vendor_acme')
    and profile_id = (select value from test_fixture_ids where key = 'vendor_acme_user_2');

  perform assert_that(
    (select revoked_at from vendor_members where vendor_id = (select value from test_fixture_ids where key = 'vendor_acme') and profile_id = (select value from test_fixture_ids where key = 'vendor_acme_user_2')) is not null,
    'vendor acme person 2''s membership is now revoked'
  );
end $$;

reset role;
select clear_test_user();

-- Revoked person 2: must now see NOTHING
select set_test_user((select value from test_fixture_ids where key = 'vendor_acme_user_2'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 0,
    'a revoked vendor member loses access immediately — is_vendor_member() requires revoked_at is null'
  );
end $$;

reset role;
select clear_test_user();

-- Person 1, same vendor, still active: must be unaffected by person 2's revocation.
select set_test_user((select value from test_fixture_ids where key = 'vendor_acme_user_1'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 1,
    'revoking one member does not affect another active member of the same vendor'
  );
end $$;

reset role;
select clear_test_user();

-- Reactivate person 2
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update vendor_members set revoked_at = null
  where vendor_id = (select value from test_fixture_ids where key = 'vendor_acme')
    and profile_id = (select value from test_fixture_ids where key = 'vendor_acme_user_2');

  perform assert_that(
    (select revoked_by from vendor_members where vendor_id = (select value from test_fixture_ids where key = 'vendor_acme') and profile_id = (select value from test_fixture_ids where key = 'vendor_acme_user_2')) is null,
    'reactivating clears revoked_by along with revoked_at, so no stale attribution lingers'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'vendor_acme_user_2'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 1,
    'reactivating a membership restores access'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 3 — bid_questions: staff-recorded provenance cannot be
-- omitted or forged as vendor-originated.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_question_id uuid;
begin
  insert into bid_questions (bid_package_id, vendor_id, question_text)
  values (
    (select value from test_fixture_ids where key = 'bid_package_a'),
    (select value from test_fixture_ids where key = 'vendor_acme'),
    'Does the framing scope include the detached studio roof?'
  )
  returning id into v_question_id;
  insert into test_fixture_ids values ('bid_question_a', v_question_id);

  perform assert_that(
    (select source from bid_questions where id = v_question_id) = 'staff_recorded',
    'a plain staff insert defaults to source=staff_recorded'
  );
  perform assert_that(
    (select recorded_by from bid_questions where id = v_question_id) = (select value from test_fixture_ids where key = 'admin'),
    'recorded_by is populated from auth.uid() via column default on the ordinary case (no value supplied)'
  );
end $$;

-- bid_questions_staff_recorded_requires_recorder: explicitly forcing
-- recorded_by to null on a staff_recorded row must be rejected.
select assert_raises(
  format(
    $sql$insert into bid_questions (bid_package_id, vendor_id, question_text, source, recorded_by)
         values (%L, %L, 'test', 'staff_recorded', null)$sql$,
    (select value from test_fixture_ids where key = 'bid_package_a'),
    (select value from test_fixture_ids where key = 'vendor_acme')
  ),
  'a staff_recorded question with recorded_by forced to null must be rejected'
);

-- Revision 3 hardening: the actual spoofing case
select assert_raises(
  format(
    $sql$insert into bid_questions (bid_package_id, vendor_id, question_text, source, recorded_by)
         values (%L, %L, 'Spoofed question', 'staff_recorded', %L)$sql$,
    (select value from test_fixture_ids where key = 'bid_package_a'),
    (select value from test_fixture_ids where key = 'vendor_acme'),
    (select value from test_fixture_ids where key = 'org_b_admin')
  ),
  'inserting bid_questions with recorded_by explicitly set to a DIFFERENT user must be rejected — this is the actual spoofing case a default cannot catch'
);

-- Immutability: recorded_by/source can never be reassigned after insert
select assert_raises(
  format('update bid_questions set recorded_by = %L where id = %L', (select value from test_fixture_ids where key = 'org_b_admin'), (select value from test_fixture_ids where key = 'bid_question_a')),
  'reassigning bid_questions.recorded_by after insert must be rejected — provenance is set once'
);

-- Task 1 review fix: bid_addenda.issued_by has the identical spoofing/immutability protection
do $$
declare
  v_addendum_id uuid;
begin
  insert into bid_addenda (bid_package_id, title, body_text)
  values ((select value from test_fixture_ids where key = 'bid_package_a'), 'Clarification', 'Excludes permit fees.')
  returning id into v_addendum_id;
  insert into test_fixture_ids values ('bid_addendum_a', v_addendum_id);

  perform assert_that(
    (select issued_by from bid_addenda where id = v_addendum_id) = (select value from test_fixture_ids where key = 'admin'),
    'a plain staff insert defaults issued_by to auth.uid() on the ordinary case'
  );
end $$;

select assert_raises(
  format(
    $sql$insert into bid_addenda (bid_package_id, title, body_text, issued_by)
         values (%L, 'Spoofed addendum', 'test', %L)$sql$,
    (select value from test_fixture_ids where key = 'bid_package_a'),
    (select value from test_fixture_ids where key = 'org_b_admin')
  ),
  'inserting bid_addenda with issued_by explicitly set to a DIFFERENT user must be rejected'
);

select assert_raises(
  format('update bid_addenda set issued_by = %L where id = %L', (select value from test_fixture_ids where key = 'org_b_admin'), (select value from test_fixture_ids where key = 'bid_addendum_a')),
  'reassigning bid_addenda.issued_by after insert must be rejected'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 — award_bid(): unchanged behavior from Revision 1.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update bid_submissions set status = 'submitted', amount_cents = 4_500_000, submitted_at = now()
  where id = (select value from test_fixture_ids where key = 'bid_submission_a');

  perform assert_that(
    (select status from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 'submitted',
    'a properly-amounted submission is accepted'
  );
end $$;

do $$
declare
  v_committed_cost_id uuid;
begin
  select award_bid((select value from test_fixture_ids where key = 'bid_submission_a')) into v_committed_cost_id;
  insert into test_fixture_ids values ('committed_cost_from_award', v_committed_cost_id);

  perform assert_that((select status from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 'awarded', 'awarded submission moves to status awarded');
  perform assert_that((select status from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 'awarded', 'bid package moves to status awarded');
  perform assert_that((select source_type from committed_costs where id = v_committed_cost_id) = 'bid_award', 'the new committed_costs row is tagged source_type=bid_award');
  perform assert_that((select amount_cents from committed_costs where id = v_committed_cost_id) = 4_500_000, 'the committed_costs amount matches the awarded bid amount');
end $$;

select assert_raises(
  format('select award_bid(%L)', (select value from test_fixture_ids where key = 'bid_submission_a')),
  'awarding an already-awarded submission must be rejected'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 5 — material_order_line_items: project/order consistency and
-- the post-commit freeze (Decision 10).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- Cross-project line item must be rejected outright.
select assert_raises(
  format(
    $sql$insert into material_order_line_items (material_order_id, project_id, cost_code_id, description, quantity, unit_price_cents)
         values (%L, %L, %L, 'Mismatched project lumber', 10, 500)$sql$,
    (select value from test_fixture_ids where key = 'material_order_a'),
    (select value from test_fixture_ids where key = 'project_b_id'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'a line item whose project_id does not match its order''s project_id must be rejected'
);

do $$
declare
  v_line_item_1 uuid;
  v_line_item_2 uuid;
begin
  insert into material_order_line_items (material_order_id, project_id, cost_code_id, description, quantity, unit, unit_price_cents)
  select
    (select value from test_fixture_ids where key = 'material_order_a'),
    value,
    (select value from test_fixture_ids where key = 'cost_code_a'),
    '2x6 Lumber', 100, 'ea', 850
  from test_fixture_ids where key = 'project_a'
  returning id into v_line_item_1;
  insert into test_fixture_ids values ('material_order_line_a_framing', v_line_item_1);

  insert into material_order_line_items (material_order_id, project_id, cost_code_id, description, quantity, unit, unit_price_cents)
  select
    (select value from test_fixture_ids where key = 'material_order_a'),
    value,
    (select value from test_fixture_ids where key = 'cost_code_a2'),
    'Drywall Sheets', 40, 'ea', 1_200
  from test_fixture_ids where key = 'project_a'
  returning id into v_line_item_2;
  insert into test_fixture_ids values ('material_order_line_a_drywall', v_line_item_2);
end $$;

select assert_raises(
  format('update material_order_line_items set received_quantity = 150 where id = %L', (select value from test_fixture_ids where key = 'material_order_line_a_framing')),
  'received_quantity greater than quantity must be rejected'
);

-- =====================================================================
-- SECTION 6 — commit_material_order() with line items spanning two
-- cost codes (Decision 2's core behavior change), then confirming the
-- freeze trigger (Decision 10) actually engages post-commit. Continues
-- directly from Section 5 — still admin, still role authenticated.
-- =====================================================================

-- Rejects committing an order with zero line items — use a fresh order.
do $$
declare
  v_empty_order_id uuid;
begin
  insert into material_orders (project_id, vendor_id)
  select value, (select value from test_fixture_ids where key = 'vendor_acme') from test_fixture_ids where key = 'project_a'
  returning id into v_empty_order_id;

  perform assert_raises(
    format('select commit_material_order(%L)', v_empty_order_id),
    'committing a material order with no line items must be rejected'
  );
end $$;

-- Happy path: material_order_a has two line items on two different
-- cost codes (Section 5 above) — commit must produce TWO committed_costs
-- rows, correctly summed per code, sharing source_id. Revision 3: the
-- RPC returns the (cost_code_id, committed_cost_id) mapping directly —
-- this test asserts against that mapping, not merely "two rows exist."
do $$
declare
  v_mapping record;
  v_row_count integer;
  v_framing_committed_cost_id uuid;
  v_drywall_committed_cost_id uuid;
  v_mapping_count integer := 0;
begin
  for v_mapping in
    select * from commit_material_order((select value from test_fixture_ids where key = 'material_order_a'))
  loop
    v_mapping_count := v_mapping_count + 1;
    if v_mapping.cost_code_id = (select value from test_fixture_ids where key = 'cost_code_a') then
      v_framing_committed_cost_id := v_mapping.committed_cost_id;
    elsif v_mapping.cost_code_id = (select value from test_fixture_ids where key = 'cost_code_a2') then
      v_drywall_committed_cost_id := v_mapping.committed_cost_id;
    end if;
  end loop;

  perform assert_that(v_mapping_count = 2, 'committing an order with two cost codes returns exactly two (cost_code_id, committed_cost_id) mapping rows');
  perform assert_that(v_framing_committed_cost_id is not null, 'the mapping includes a row for the framing cost code');
  perform assert_that(v_drywall_committed_cost_id is not null, 'the mapping includes a row for the drywall cost code');
  perform assert_that(v_framing_committed_cost_id <> v_drywall_committed_cost_id, 'the two cost codes map to two DIFFERENT committed_costs rows, not the same one twice');

  select count(*) into v_row_count from committed_costs
  where source_type = 'material_order' and source_id = (select value from test_fixture_ids where key = 'material_order_a');
  perform assert_that(v_row_count = 2, 'both new rows share source_id = the material order''s id');

  perform assert_that(
    (select amount_cents from committed_costs where id = v_framing_committed_cost_id) = 100 * 850,
    'the committed_cost_id the mapping returned for the framing cost code sums only the framing line item (100 * 850)'
  );
  perform assert_that(
    (select amount_cents from committed_costs where id = v_drywall_committed_cost_id) = 40 * 1_200,
    'the committed_cost_id the mapping returned for the drywall cost code sums only the drywall line item (40 * 1200), not both'
  );

  perform assert_that(
    (select status from material_orders where id = (select value from test_fixture_ids where key = 'material_order_a')) = 'ordered',
    'committed material order moves to status ordered'
  );
end $$;

select assert_raises(
  format('select commit_material_order(%L)', (select value from test_fixture_ids where key = 'material_order_a')),
  'committing an already-ordered material order must be rejected'
);

-- Decision 10: the freeze trigger. Committed fields reject; a new line
-- item insert rejects; received_quantity/backordered still succeed.
select assert_raises(
  format('update material_order_line_items set quantity = 200 where id = %L', (select value from test_fixture_ids where key = 'material_order_line_a_framing')),
  'editing quantity on a line item of a non-draft order must be rejected'
);
select assert_raises(
  format(
    $sql$insert into material_order_line_items (material_order_id, project_id, cost_code_id, description, quantity, unit_price_cents)
         values (%L, %L, %L, 'Late addition', 5, 100)$sql$,
    (select value from test_fixture_ids where key = 'material_order_a'),
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'inserting a new line item on a non-draft order must be rejected'
);
select assert_raises(
  format('delete from material_order_line_items where id = %L', (select value from test_fixture_ids where key = 'material_order_line_a_framing')),
  'deleting a line item of a non-draft order must be rejected'
);

-- received_quantity = 30 (of 40 ordered): a genuine partial receipt —
-- the brief's original value of 60 exceeds the drywall line item's own
-- quantity (40) and would trip material_order_line_items_received_
-- not_over (received_quantity <= quantity) itself, which is not what
-- this test is checking (it belongs to Section 5's dedicated assertion
-- instead). backordered = true records that the remaining 10 units are
-- still outstanding.
do $$
begin
  update material_order_line_items set received_quantity = 30, backordered = true
  where id = (select value from test_fixture_ids where key = 'material_order_line_a_drywall');

  perform assert_that(
    (select backordered from material_order_line_items where id = (select value from test_fixture_ids where key = 'material_order_line_a_drywall')) = true,
    'received_quantity/backordered remain editable after commit — proves the freeze is scoped to committed fields only'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 7 — issue_document(): claim-old/insert-new/link versioning
-- (Decision 4), template_version recording (Revision 3), immutability,
-- and RLS for both document_type values.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_doc_v1 uuid;
  v_doc_v2 uuid;
begin
  select issue_document(
    'purchase_order',
    (select value from test_fixture_ids where key = 'material_order_a'),
    'PO-1001',
    '1',
    '{"vendor": "Acme Framing", "lineItems": [{"description": "2x6 Lumber", "costCode": "06-100"}]}'::jsonb
  ) into v_doc_v1;
  insert into test_fixture_ids values ('issued_document_v1', v_doc_v1);

  perform assert_that((select version from issued_documents where id = v_doc_v1) = 1, 'first issuance is version 1');
  perform assert_that((select template_version from issued_documents where id = v_doc_v1) = '1', 'the caller-supplied template_version is recorded on the row');
  perform assert_that((select superseded_at from issued_documents where id = v_doc_v1) is null, 'version 1 starts non-superseded');

  select issue_document(
    'purchase_order',
    (select value from test_fixture_ids where key = 'material_order_a'),
    'PO-1001',
    '1',
    '{"vendor": "Acme Framing", "lineItems": [{"description": "2x6 Lumber", "costCode": "06-100"}], "revisionNote": "corrected delivery address"}'::jsonb
  ) into v_doc_v2;
  insert into test_fixture_ids values ('issued_document_v2', v_doc_v2);

  perform assert_that((select version from issued_documents where id = v_doc_v2) = 2, 'a second issuance for the same source is version 2');
  perform assert_that((select superseded_by_id from issued_documents where id = v_doc_v1) = v_doc_v2, 'version 1 now points at version 2 as its successor');
  perform assert_that((select superseded_at from issued_documents where id = v_doc_v1) is not null, 'version 1 is now marked superseded');
  perform assert_that((select issued_by from issued_documents where id = v_doc_v1) = (select value from test_fixture_ids where key = 'admin'), 'issued_by is the actual authenticated session, not a parameter');
  -- version 1's template_version is untouched by superseding it — proving
  -- the historical row's own renderer selector survives, which is the
  -- whole point of recording it per-version rather than only on the
  -- latest row.
  perform assert_that((select template_version from issued_documents where id = v_doc_v1) = '1', 'superseding a document does not alter the superseded row''s own template_version');
end $$;

-- Task 1 review round 1 fix, tested here: a direct insert into
-- issued_documents that BYPASSES issue_document() entirely, with a
-- forged issued_by, must be rejected — not merely undetected until an
-- update. Uses material_order_a again (a fresh, distinct document_number
-- avoids the type/source/version unique constraint colliding with v1/v2
-- above).
select assert_raises(
  format(
    $sql$insert into issued_documents (document_type, source_id, document_number, version, template_version, issued_by, canonical_data)
         values ('purchase_order', %L, 'PO-FORGED', 99, '1', %L, '{}'::jsonb)$sql$,
    (select value from test_fixture_ids where key = 'material_order_a'),
    (select value from test_fixture_ids where key = 'org_b_admin')
  ),
  'a direct insert into issued_documents with issued_by forged to a different user must be rejected, even bypassing issue_document() entirely'
);

-- Immutability: a direct update to canonical_data must be rejected.
select assert_raises(
  format('update issued_documents set canonical_data = ''{}''::jsonb where id = %L', (select value from test_fixture_ids where key = 'issued_document_v2')),
  'directly editing canonical_data on an existing issued_documents row must be rejected'
);

-- Revision 3: template_version is protected by the same immutability
-- trigger as canonical_data — a snapshot's recorded renderer version
-- can never be silently changed after the fact either.
select assert_raises(
  format('update issued_documents set template_version = ''2'' where id = %L', (select value from test_fixture_ids where key = 'issued_document_v2')),
  'directly editing template_version on an existing issued_documents row must be rejected'
);

-- No delete, ever.
select assert_raises(
  format('delete from issued_documents where id = %L', (select value from test_fixture_ids where key = 'issued_document_v1')),
  'deleting an issued_documents row must be rejected'
);

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from issued_documents where id = (select value from test_fixture_ids where key = 'issued_document_v1')) = 0,
    'org B admin cannot see org A''s issued_documents row'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 8 — audit visibility: every new table's writes produce a
-- real, staff-readable audit_log row (same bar P4 set).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from audit_log where table_name = 'vendor_members') > 0, 'vendor_members writes produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'bid_packages' and record_id = (select value from test_fixture_ids where key = 'bid_package_a')) > 0, 'bid_packages insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'bid_submissions' and record_id = (select value from test_fixture_ids where key = 'bid_submission_a')) > 0, 'bid_submissions insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'bid_questions' and record_id = (select value from test_fixture_ids where key = 'bid_question_a')) > 0, 'bid_questions insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'material_orders' and record_id = (select value from test_fixture_ids where key = 'material_order_a')) > 0, 'material_orders insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'material_order_line_items' and record_id = (select value from test_fixture_ids where key = 'material_order_line_a_framing')) > 0, 'material_order_line_items insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'issued_documents' and record_id = (select value from test_fixture_ids where key = 'issued_document_v1')) > 0, 'issued_documents insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'issued_documents' and record_id = (select value from test_fixture_ids where key = 'issued_document_v1') and action = 'update') > 0, 'issued_documents supersession (the update to v1) produced its own separate readable audit_log row');
end $$;

reset role;
select clear_test_user();
