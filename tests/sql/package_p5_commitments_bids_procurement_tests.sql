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

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_vendor_acme_user_1 uuid := gen_random_uuid();
  v_vendor_acme_user_2 uuid := gen_random_uuid();
  v_vendor_b_user uuid := gen_random_uuid();
  v_second_vendor uuid;
  v_second_bid_package uuid;
  v_bid_submission_id uuid;
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  -- Two DIFFERENT people, same vendor business (vendor_acme).
  insert into profiles (id, org_id, role, full_name, email)
  values
    (v_vendor_acme_user_1, v_org_a_id, 'vendor', 'Acme Framing — Owner', 'owner@acmeframing.example'),
    (v_vendor_acme_user_2, v_org_a_id, 'vendor', 'Acme Framing — Estimator', 'estimator@acmeframing.example');
  insert into project_members (project_id, user_id, member_role)
  select value, v_vendor_acme_user_1, 'vendor' from test_fixture_ids where key = 'project_a';
  insert into project_members (project_id, user_id, member_role)
  select value, v_vendor_acme_user_2, 'vendor' from test_fixture_ids where key = 'project_a';
  insert into vendor_members (vendor_id, profile_id)
  values
    ((select value from test_fixture_ids where key = 'vendor_acme'), v_vendor_acme_user_1),
    ((select value from test_fixture_ids where key = 'vendor_acme'), v_vendor_acme_user_2);
  insert into test_fixture_ids values ('vendor_acme_user_1', v_vendor_acme_user_1);
  insert into test_fixture_ids values ('vendor_acme_user_2', v_vendor_acme_user_2);

  -- A second, unrelated vendor business, invited to a DIFFERENT package.
  insert into vendors (org_id, name) values (v_org_a_id, 'Beta Electric') returning id into v_second_vendor;
  insert into profiles (id, org_id, role, full_name, email)
  values (v_vendor_b_user, v_org_a_id, 'vendor', 'Beta Electric Contact', 'beta@example.com');
  insert into project_members (project_id, user_id, member_role)
  select value, v_vendor_b_user, 'vendor' from test_fixture_ids where key = 'project_a';
  insert into vendor_members (vendor_id, profile_id) values (v_second_vendor, v_vendor_b_user);
  insert into test_fixture_ids values ('vendor_b_user', v_vendor_b_user);

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
  insert into projects (org_id, name, project_number)
  select org_id, 'Second Project', 'P-002' from profiles where id = (select value from test_fixture_ids where key = 'admin')
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
select assert_raises(
  format(
    'update vendor_members set vendor_id = %L where vendor_id = %L and profile_id = %L',
    (select value from test_fixture_ids where key = 'vendor_acme'),
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
-- SECTION 8 — audit visibility summary test (simplified).
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
end $$;

reset role;
select clear_test_user();
