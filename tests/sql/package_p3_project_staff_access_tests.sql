-- =====================================================================
-- Stone Column Portal — P3 (Project & Staff Access Foundation) SQL/RLS
-- test suite, covering schema/016_project_staff_access_foundation.sql.
--
-- Runs LAST in scripts/db/run-sql-tests.mjs's FILES list, after every
-- other schema file and every other test file (including
-- committed_forecast_hardening_tests.sql, which depends on an exact,
-- fragile trace of forecast_entries state on cost_code_a/cost_code_b).
-- Deliberately placed last, and deliberately creates a brand-new
-- sibling project ('project_c') rather than reusing package1_tests.sql's
-- own 'project_b'/'project_b_id' fixtures for its cross-project
-- negative-access assertions, so nothing in this file can perturb any
-- earlier file's fixture state.
--
-- Reused fixtures: 'admin', 'org_b_admin', 'org_b_id', 'project_a',
-- 'cost_code_a', 'ledger_1', 'client_a', 'staff_a', 'project_org_b',
-- 'bid_package_a' (from package1_tests.sql / package_p1_auth_tests.sql /
-- package_p5_commitments_bids_procurement_tests.sql).
--
-- New fixtures created by this file: 'pm_a' / 'super_a' / 'accounting_a'
-- (staff_function = project_manager / superintendent / accounting,
-- org A), 'pm_throwaway' / 'throwaway_pm_2' (revocation-lifecycle-only,
-- never referenced after Section 3), 'project_c' / 'cost_code_c' /
-- 'bid_package_c' (a second org-A project, used as "Project B" for
-- every cross-project assertion), 'project_new_via_rpc'
-- (create_project_with_defaults() success case, Section 9).
-- =====================================================================

-- =====================================================================
-- SECTION 1 — staff_function backfill + CHECK constraint.
--
-- JUDGMENT CALL (see task-2-report.md "Judgment calls"): migration 016's
-- own backfill UPDATE ("set staff_function='general' where role='staff'
-- and staff_function is null") runs as part of the linear migration
-- chain BEFORE any test file — including this one — has created a
-- single profiles row. There is no pre-existing 'staff' row in this
-- harness for the backfill to have acted on, and there is no way to
-- reconstruct "a staff row that predates the migration" later in the
-- same replay, since the CHECK constraint below is already permanently
-- active by the time any fixture is created. This section instead
-- proves the two things that ARE verifiable here: (a) re-running the
-- backfill statement verbatim today is a safe no-op (0 rows), and (b)
-- the invariant the backfill exists to guarantee — no role='staff'
-- profile anywhere has a null staff_function — holds for a staff
-- profile that predates THIS file (staff_a, from package1_tests.sql)
-- and is actively enforced going forward by the CHECK constraint
-- itself, tested directly against a fresh insert.
-- =====================================================================

do $$
declare
  v_affected int;
begin
  update profiles set staff_function = 'general'
    where role = 'staff' and staff_function is null;
  get diagnostics v_affected = row_count;
  perform assert_that(v_affected = 0, 're-running migration 016''s own backfill UPDATE verbatim is a no-op — no role=staff profile anywhere has a null staff_function');

  perform assert_that(
    (select staff_function from profiles where id = (select value from test_fixture_ids where key = 'staff_a')) = 'general',
    'staff_a (created in package1_tests.sql, after migration 016 already ran) carries a non-null staff_function, consistent with the backfill''s default'
  );
end $$;

-- Fresh role='staff' insert with staff_function omitted (NULL) must be
-- rejected by staff_function_required_for_staff. Done as the table
-- owner (profiles has no INSERT policy for `authenticated` at all — see
-- the Section 2 fixture-creation note below), so the CHECK constraint
-- is what fails here, not an unrelated permission-denied error.
do $$
declare
  v_nofunction_user uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_nofunction_user);
  insert into test_fixture_ids values ('nofunction_user', v_nofunction_user);
end $$;

select assert_raises(
  format(
    $sql$insert into profiles (id, org_id, role, full_name, email) values (%L, %L, 'staff', 'No Function Staff', 'nofunction@example.com')$sql$,
    (select value from test_fixture_ids where key = 'nofunction_user'),
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin'))
  ),
  'a fresh role=staff profile insert with no staff_function must be rejected by staff_function_required_for_staff'
);

-- =====================================================================
-- SECTION 2 SETUP — new staff profiles (project_manager/superintendent/
-- accounting), a second org-A project ("project_c", standing in for
-- "Project B" in every cross-project assertion below), and the
-- legitimate admin-performed assignments pm_a/super_a rely on for the
-- rest of this file.
-- =====================================================================

do $$
declare
  v_pm_a uuid := gen_random_uuid();
  v_super_a uuid := gen_random_uuid();
  v_accounting_a uuid := gen_random_uuid();
  v_pm_throwaway uuid := gen_random_uuid();
  v_throwaway_pm_2 uuid := gen_random_uuid();
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  insert into auth.users (id) values (v_pm_a), (v_super_a), (v_accounting_a), (v_pm_throwaway), (v_throwaway_pm_2);

  insert into profiles (id, org_id, role, full_name, email, staff_function)
  values
    (v_pm_a, v_org_a_id, 'staff', 'PM Alice', 'pm-alice@example.com', 'project_manager'),
    (v_super_a, v_org_a_id, 'staff', 'Super Sam', 'super-sam@example.com', 'superintendent'),
    (v_accounting_a, v_org_a_id, 'staff', 'Acct Amy', 'acct-amy@example.com', 'accounting'),
    (v_pm_throwaway, v_org_a_id, 'staff', 'PM Throwaway', 'pm-throwaway@example.com', 'project_manager'),
    (v_throwaway_pm_2, v_org_a_id, 'staff', 'PM Throwaway 2', 'pm-throwaway-2@example.com', 'project_manager');

  insert into test_fixture_ids values
    ('pm_a', v_pm_a), ('super_a', v_super_a), ('accounting_a', v_accounting_a),
    ('pm_throwaway', v_pm_throwaway), ('throwaway_pm_2', v_throwaway_pm_2);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_project_c uuid;
  v_cost_code_c uuid;
  v_bid_package_c uuid;
begin
  insert into projects (org_id, name, project_number, pricing_model)
  select org_id, 'Project C (P3 fixture)', 'P3-C-001', 'fixed_price'
  from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_project_c;
  insert into test_fixture_ids values ('project_c', v_project_c);

  insert into cost_codes (project_id, code) values (v_project_c, '01-100') returning id into v_cost_code_c;
  insert into test_fixture_ids values ('cost_code_c', v_cost_code_c);

  insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, source_type)
  values (v_project_c, v_cost_code_c, 'original', 200000, 'initial_setup');

  insert into bid_packages (project_id, cost_code_id, title, scope_description)
  values (v_project_c, v_cost_code_c, 'Project C Bid Package', 'Test scope for cross-project isolation')
  returning id into v_bid_package_c;
  insert into test_fixture_ids values ('bid_package_c', v_bid_package_c);

  -- pm_a and super_a are scoped ONLY to project_a for the rest of this
  -- file — never assigned to project_c — the fixed state every later
  -- section's "assigned project only" assertions depend on.
  insert into project_staff_assignments (project_id, profile_id, assigned_by)
  values
    ((select value from test_fixture_ids where key = 'project_a'), (select value from test_fixture_ids where key = 'pm_a'), (select value from test_fixture_ids where key = 'admin')),
    ((select value from test_fixture_ids where key = 'project_a'), (select value from test_fixture_ids where key = 'super_a'), (select value from test_fixture_ids where key = 'admin'));

  perform assert_that(
    (select count(*) from project_staff_assignments where project_id = (select value from test_fixture_ids where key = 'project_a') and profile_id = (select value from test_fixture_ids where key = 'pm_a')) = 1,
    'admin can assign pm_a to project_a'
  );
  perform assert_that(
    (select count(*) from project_staff_assignments where project_id = (select value from test_fixture_ids where key = 'project_a') and profile_id = (select value from test_fixture_ids where key = 'super_a')) = 1,
    'admin can assign super_a to project_a'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 2 — project_staff_assignments: composite integrity, org-match
-- guard (both directions), assigned_by anti-spoofing, self-escalation
-- (Decision 1a — the most important test in this suite), identity
-- immutability, and the revocation/reactivation lifecycle, modeled
-- directly on vendor_members' own test section
-- (package_p5_commitments_bids_procurement_tests.sql Section 2).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- 2.1 Composite integrity: duplicate (project_id, profile_id) pair.
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by) values (%L, %L, %L)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'pm_a'),
    (select value from test_fixture_ids where key = 'admin')
  ),
  'a duplicate (project_id, profile_id) assignment pair must be rejected by project_staff_assignments_unique_pair'
);

-- 2.2 Org-match guard, both directions.
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by) values (%L, %L, %L)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'org_b_admin'),
    (select value from test_fixture_ids where key = 'admin')
  ),
  'assigning an org-B profile to an org-A project must be rejected by enforce_project_staff_assignment_org_match()'
);
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by) values (%L, %L, %L)',
    (select value from test_fixture_ids where key = 'project_org_b'),
    (select value from test_fixture_ids where key = 'pm_a'),
    (select value from test_fixture_ids where key = 'admin')
  ),
  'assigning an org-A profile to an org-B project must be rejected by enforce_project_staff_assignment_org_match() (the mirror direction)'
);

-- 2.3 assigned_by anti-spoofing on INSERT: the acting session is admin
-- (passes RLS), but forges assigned_by to a different user entirely.
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by) values (%L, %L, %L)',
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'accounting_a'),
    (select value from test_fixture_ids where key = 'org_b_admin')
  ),
  'an assigned_by value not equal to the acting session''s own auth.uid() must be rejected on INSERT, even when the acting session (admin) otherwise passes RLS'
);
select assert_that(
  (select count(*) from project_staff_assignments
     where project_id = (select value from test_fixture_ids where key = 'project_c')
       and profile_id = (select value from test_fixture_ids where key = 'accounting_a')) = 0,
  'the forged-assigned_by insert attempt above did not create a row'
);

reset role;
select clear_test_user();

-- 2.4 Self-escalation (Decision 1a) — the single most important new
-- test in this suite. project_staff_assignments_admin_manage is
-- admin-only with NO org-wide-staff carve-out, so EVERY staff_function
-- must be rejected attempting to insert a row naming themselves and a
-- project they don't already have access to (project_c). assigned_by
-- is set to the acting session's own id in each case so the failure
-- specifically demonstrates the admin-only RLS gate, not an incidental
-- assigned_by-mismatch failure.
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by) values (%L, %L, %L)',
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'pm_a'),
    (select value from test_fixture_ids where key = 'pm_a')
  ),
  'a project_manager-function staff session naming themselves + a project they do not already have access to must be rejected — the exact self-escalation path the independent review found and Decision 1a closes'
);
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'super_a'));
set local role authenticated;
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by) values (%L, %L, %L)',
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'super_a'),
    (select value from test_fixture_ids where key = 'super_a')
  ),
  'a superintendent-function staff session naming themselves + a project they do not already have access to must also be rejected — the same self-escalation path, same fix'
);
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'accounting_a'));
set local role authenticated;
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by) values (%L, %L, %L)',
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'accounting_a'),
    (select value from test_fixture_ids where key = 'accounting_a')
  ),
  'an accounting-function staff session attempting the same self-assignment is also rejected — admin-only, no exceptions, even for a function that already has org-wide is_org_staff() access'
);
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'staff_a'));
set local role authenticated;
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by) values (%L, %L, %L)',
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'staff_a'),
    (select value from test_fixture_ids where key = 'staff_a')
  ),
  'a general-function staff session attempting the same self-assignment is also rejected — admin-only, no exceptions'
);
reset role;
select clear_test_user();

-- 2.5 Identity immutability: project_id/profile_id/assigned_by can
-- never change after insert.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
select assert_raises(
  format(
    'update project_staff_assignments set project_id = %L where project_id = %L and profile_id = %L',
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'pm_a')
  ),
  'reassigning project_staff_assignments.project_id post-insert must be rejected'
);

-- 2.6 Revocation/reactivation lifecycle, on a dedicated throwaway pair
-- (pm_throwaway/project_c) so pm_a's/super_a's real project_a
-- assignments — which every later section in this file depends on
-- staying active — are never touched.
do $$
begin
  insert into project_staff_assignments (project_id, profile_id, assigned_by)
  values (
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'pm_throwaway'),
    (select value from test_fixture_ids where key = 'admin')
  );
  perform assert_that(
    (select count(*) from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_c')
         and profile_id = (select value from test_fixture_ids where key = 'pm_throwaway')) = 1,
    'admin can assign pm_throwaway to project_c (throwaway fixture for the revocation lifecycle test)'
  );
end $$;

-- Anti-spoofing on UPDATE: revoked_by must equal the acting session.
select assert_raises(
  format(
    'update project_staff_assignments set revoked_at = now(), revoked_by = %L where project_id = %L and profile_id = %L',
    (select value from test_fixture_ids where key = 'org_b_admin'),
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'pm_throwaway')
  ),
  'revoking with revoked_by set to someone other than the acting session must be rejected'
);

-- Anti-spoofing on INSERT of an already-revoked row: a fresh pair
-- (throwaway_pm_2/project_c), inserted pre-revoked with a forged
-- revoked_by, must be rejected — not merely undetected until an update.
select assert_raises(
  format(
    'insert into project_staff_assignments (project_id, profile_id, assigned_by, revoked_at, revoked_by) values (%L, %L, %L, now(), %L)',
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'throwaway_pm_2'),
    (select value from test_fixture_ids where key = 'admin'),
    (select value from test_fixture_ids where key = 'org_b_admin')
  ),
  'inserting an already-revoked project_staff_assignments row with a forged revoked_by must be rejected'
);

-- The actual (legitimate) revoke.
do $$
begin
  update project_staff_assignments set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where project_id = (select value from test_fixture_ids where key = 'project_c')
    and profile_id = (select value from test_fixture_ids where key = 'pm_throwaway');

  perform assert_that(
    (select revoked_at from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_c')
         and profile_id = (select value from test_fixture_ids where key = 'pm_throwaway')) is not null,
    'pm_throwaway''s project_c assignment is now revoked'
  );
end $$;

-- On an already-revoked row, reassigning ONLY revoked_by (revoked_at
-- left unchanged) must still be rejected, not silently skipped.
select assert_raises(
  format(
    'update project_staff_assignments set revoked_by = %L where project_id = %L and profile_id = %L',
    (select value from test_fixture_ids where key = 'org_b_admin'),
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'pm_throwaway')
  ),
  'reassigning revoked_by on an already-revoked row, with revoked_at left unchanged, must still be rejected'
);

-- Reactivation: unlike vendor_members' identical-in-spirit trigger
-- (schema/015 enforce_vendor_member_identity_and_revocation, which
-- auto-clears revoked_by via `new.revoked_by := null` when revoked_at
-- is cleared), project_staff_assignments'
-- enforce_project_staff_assignment_identity_and_revocation ONLY
-- validates — it raises "must also clear revoked_by" if the caller
-- doesn't clear it themselves, rather than clearing it for them. This
-- is a real divergence from 016's own header comment ("Mirrors
-- enforce_vendor_member_identity_and_revocation() ... exactly"),
-- confirmed by actually running this test against both triggers — see
-- task-2-report.md "Judgment calls / concerns". Testing the ACTUAL
-- shipped behavior here (both columns cleared explicitly in the same
-- statement), not the behavior the comment claims.
do $$
begin
  update project_staff_assignments set revoked_at = null, revoked_by = null
  where project_id = (select value from test_fixture_ids where key = 'project_c')
    and profile_id = (select value from test_fixture_ids where key = 'pm_throwaway');

  perform assert_that(
    (select revoked_by from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_c')
         and profile_id = (select value from test_fixture_ids where key = 'pm_throwaway')) is null,
    'reactivating (both revoked_at and revoked_by explicitly cleared in the same statement) leaves revoked_by null'
  );
end $$;

-- Regression proof of the divergence itself: clearing ONLY revoked_at
-- (as vendor_members' own equivalent test does, relying on that
-- trigger's auto-clear) is REJECTED here, not silently accepted —
-- confirms this is a real, currently-shipped behavioral difference
-- from vendor_members, not a one-off mistake in this test file. Uses
-- throwaway_pm_2 with a FRESH legitimate insert + revoke (its earlier
-- use above was only a REJECTED forged-revoked_by insert attempt,
-- which rolled back and left no row at all — a plain UPDATE against
-- that nonexistent row would silently affect 0 rows and never raise,
-- making the assert_raises below vacuous).
do $$
begin
  insert into project_staff_assignments (project_id, profile_id, assigned_by)
  values (
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'throwaway_pm_2'),
    (select value from test_fixture_ids where key = 'admin')
  );
  update project_staff_assignments set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where project_id = (select value from test_fixture_ids where key = 'project_c')
    and profile_id = (select value from test_fixture_ids where key = 'throwaway_pm_2');

  perform assert_that(
    (select count(*) from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_c')
         and profile_id = (select value from test_fixture_ids where key = 'throwaway_pm_2')
         and revoked_at is not null) = 1,
    'throwaway_pm_2 now has a genuinely revoked project_c assignment row, set up for the reactivation-divergence proof below'
  );
end $$;

select assert_raises(
  format(
    'update project_staff_assignments set revoked_at = null where project_id = %L and profile_id = %L',
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'throwaway_pm_2')
  ),
  'clearing ONLY revoked_at (leaving revoked_by set) is rejected — project_staff_assignments'' trigger does NOT auto-clear revoked_by on reactivation the way vendor_members'' trigger does, despite migration 016''s own comment claiming to mirror it exactly'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 3 — is_org_staff() behavior matrix: admin (always true);
-- accounting/general (always true, org-wide, unchanged); project_manager/
-- superintendent with an active assignment (true only for the assigned
-- project, false for a sibling project in the same org); with a
-- REVOKED assignment (false) — the explicit test the owner asked for.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
do $$
begin
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_a')), 'admin: is_org_staff(project_a) = true');
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_c')), 'admin: is_org_staff(project_c) = true (org-wide, unaffected by any assignment)');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'accounting_a'));
set local role authenticated;
do $$
begin
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_a')), 'accounting-function staff: is_org_staff(project_a) = true, org-wide, unchanged');
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_c')), 'accounting-function staff: is_org_staff(project_c) = true, org-wide, unchanged, no assignment needed');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'staff_a'));
set local role authenticated;
do $$
begin
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_a')), 'general-function staff: is_org_staff(project_a) = true, org-wide, unchanged');
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_c')), 'general-function staff: is_org_staff(project_c) = true, org-wide, unchanged');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
begin
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_a')), 'project_manager assigned to project_a: is_org_staff(project_a) = true');
  perform assert_that(not is_org_staff((select value from test_fixture_ids where key = 'project_c')), 'project_manager assigned to project_a ONLY: is_org_staff of a sibling project in the same org = false');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'super_a'));
set local role authenticated;
do $$
begin
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_a')), 'superintendent assigned to project_a: is_org_staff(project_a) = true');
  perform assert_that(not is_org_staff((select value from test_fixture_ids where key = 'project_c')), 'superintendent assigned to project_a ONLY: is_org_staff of a sibling project in the same org = false');
end $$;
reset role;
select clear_test_user();

-- Revoked-assignment case: revoke pm_throwaway's (already reactivated
-- in Section 2) project_c assignment again, then confirm is_org_staff()
-- flips to false. Uses the throwaway fixture, never touching pm_a's/
-- super_a's own real assignments that every later section depends on
-- staying active.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
do $$
begin
  update project_staff_assignments set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where project_id = (select value from test_fixture_ids where key = 'project_c')
    and profile_id = (select value from test_fixture_ids where key = 'pm_throwaway');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'pm_throwaway'));
set local role authenticated;
do $$
begin
  perform assert_that(
    not is_org_staff((select value from test_fixture_ids where key = 'project_c')),
    'a REVOKED project_manager assignment: is_org_staff() returns false, even though an active assignment for this exact (project, profile) pair existed moments ago'
  );
end $$;
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 — Cross-organization: a staff account in Org A, however
-- configured, never passes is_org_staff()/is_financial_staff() for any
-- Org B project. Extends the exact test class already established in
-- P1 (package_p1_auth_tests.sql Section 5) / P5.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
begin
  perform assert_that(not is_org_staff((select value from test_fixture_ids where key = 'project_org_b')), 'pm_a (org A, project_manager function) never passes is_org_staff() for an org-B project');
  perform assert_that(not is_financial_staff((select value from test_fixture_ids where key = 'project_org_b')), 'pm_a (org A) never passes is_financial_staff() for an org-B project either');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_org_b')) = 0, 'pm_a cannot see org B''s project row via projects RLS');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'super_a'));
set local role authenticated;
do $$
begin
  perform assert_that(not is_org_staff((select value from test_fixture_ids where key = 'project_org_b')), 'super_a (org A, superintendent function) never passes is_org_staff() for an org-B project');
  perform assert_that(not is_financial_staff((select value from test_fixture_ids where key = 'project_org_b')), 'super_a (org A) never passes is_financial_staff() for an org-B project either');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_org_b')) = 0, 'super_a cannot see org B''s project row via projects RLS');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'accounting_a'));
set local role authenticated;
do $$
begin
  perform assert_that(not is_org_staff((select value from test_fixture_ids where key = 'project_org_b')), 'accounting_a (org A, org-wide within org A) never passes is_org_staff() for an org-B project');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_org_b')) = 0, 'accounting_a cannot see org B''s project row via projects RLS');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'staff_a'));
set local role authenticated;
do $$
begin
  perform assert_that(not is_org_staff((select value from test_fixture_ids where key = 'project_org_b')), 'staff_a (org A, general function, org-wide within org A) never passes is_org_staff() for an org-B project');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_org_b')) = 0, 'staff_a cannot see org B''s project row via projects RLS');
end $$;
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 5 — Cross-project: a 'project_manager' assigned to Project A
-- only cannot read/write Project B's (project_c's) cost codes/budget
-- ledger/bids, even though both projects are in their own org.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
begin
  -- Positive: pm_a's own assigned project (project_a).
  perform assert_that((select count(*) from cost_codes where id = (select value from test_fixture_ids where key = 'cost_code_a')) = 1, 'pm_a can read project_a''s own cost code (assigned project)');
  perform assert_that((select count(*) from budget_ledger where id = (select value from test_fixture_ids where key = 'ledger_1')) = 1, 'pm_a can read project_a''s own budget_ledger row (assigned project)');
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 1, 'pm_a can read project_a''s own bid package (assigned project)');

  -- Negative: project_c, a sibling project in the same org pm_a is NOT assigned to.
  perform assert_that((select count(*) from cost_codes where id = (select value from test_fixture_ids where key = 'cost_code_c')) = 0, 'pm_a assigned to project_a ONLY cannot read project_c''s cost code');
  perform assert_that((select count(*) from budget_ledger where project_id = (select value from test_fixture_ids where key = 'project_c')) = 0, 'pm_a assigned to project_a ONLY cannot read project_c''s budget ledger');
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_c')) = 0, 'pm_a assigned to project_a ONLY cannot read project_c''s bid package');
end $$;

select assert_raises(
  format(
    'insert into cost_codes (project_id, code) values (%L, %L)',
    (select value from test_fixture_ids where key = 'project_c'),
    'PM-DENIED'
  ),
  'pm_a cannot WRITE a new cost code to project_c either — is_financial_staff(project_c) is false for an unassigned project'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 6 — Cross-role: a 'superintendent' assigned to Project A
-- cannot read any Decision-4-listed financial table for Project A, even
-- though is_org_staff(A) returns true for them — the exact
-- is_financial_staff vs. is_org_staff distinction.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'super_a'));
set local role authenticated;
do $$
begin
  perform assert_that(is_org_staff((select value from test_fixture_ids where key = 'project_a')), 'superintendent assigned to project_a: is_org_staff(project_a) = true (re-confirmed here for direct contrast with is_financial_staff below)');
  perform assert_that(not is_financial_staff((select value from test_fixture_ids where key = 'project_a')), 'superintendent assigned to project_a: is_financial_staff(project_a) = false — the exact is_financial_staff vs. is_org_staff distinction this migration introduces');

  perform assert_that((select count(*) from cost_codes where id = (select value from test_fixture_ids where key = 'cost_code_a')) = 0, 'a superintendent CANNOT read project_a''s cost codes, despite is_org_staff(project_a) being true for them');
  perform assert_that((select count(*) from budget_ledger where id = (select value from test_fixture_ids where key = 'ledger_1')) = 0, 'a superintendent CANNOT read project_a''s budget_ledger, despite is_org_staff(project_a) being true for them');
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 0, 'a superintendent CANNOT read project_a''s bid packages, despite is_org_staff(project_a) being true for them');
end $$;
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 7 — projects policy split (projects_staff_select /
-- projects_staff_insert / projects_staff_update, replacing the old
-- single projects_staff_full_access policy): the accessible-project
-- list itself narrows/widens exactly per the matrix above for SELECT,
-- not just the underlying financial tables. A direct INSERT into
-- projects by a non-admin staff session is rejected; by an admin
-- session with a mismatched org_id is rejected. An assigned
-- superintendent cannot UPDATE projects.gmp_amount_cents/
-- deposit_amount_cents, a real dollar-bearing column on this table
-- closed during Task 1's review.
-- =====================================================================

-- 7.1 projects_staff_select: pm_a sees exactly one project (their one assignment).
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
declare v_total int;
begin
  select count(*) into v_total from projects;
  perform assert_that(v_total = 1, 'pm_a (assigned to exactly one project) sees exactly ONE row via projects_staff_select, regardless of how many other projects exist in the org');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_a')) = 1, 'pm_a sees project_a (their assigned project)');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_c')) = 0, 'pm_a does not see project_c (unassigned sibling project)');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'super_a'));
set local role authenticated;
do $$
begin
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_a')) = 1, 'super_a sees project_a (their assigned project) via projects_staff_select');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_c')) = 0, 'super_a does not see project_c (unassigned sibling project)');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'accounting_a'));
set local role authenticated;
do $$
begin
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_a')) = 1, 'accounting-function staff sees project_a (org-wide, no assignment needed)');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_c')) = 1, 'accounting-function staff ALSO sees project_c (org-wide reach, unlike project_manager/superintendent)');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'staff_a'));
set local role authenticated;
do $$
begin
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_a')) = 1, 'general-function staff sees project_a (org-wide)');
  perform assert_that((select count(*) from projects where id = (select value from test_fixture_ids where key = 'project_c')) = 1, 'general-function staff ALSO sees project_c (org-wide reach)');
end $$;
reset role;
select clear_test_user();

-- 7.2 projects_staff_insert: non-admin staff rejected.
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
select assert_raises(
  format(
    'insert into projects (org_id, name, project_number, pricing_model) values (%L, %L, %L, %L)',
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'pm_a')),
    'PM Direct Insert Attempt', 'P3-PMDIRECT-001', 'fixed_price'
  ),
  'a direct INSERT into projects by a non-admin staff session (project_manager function) must be rejected by projects_staff_insert (admin-only)'
);
reset role;
select clear_test_user();

-- 7.3 projects_staff_insert: admin session, mismatched org_id rejected.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
select assert_raises(
  format(
    'insert into projects (org_id, name, project_number, pricing_model) values (%L, %L, %L, %L)',
    (select value from test_fixture_ids where key = 'org_b_id'),
    'Admin Wrong Org Attempt', 'P3-BADORG-001', 'fixed_price'
  ),
  'an admin session inserting a project with an org_id that does not match their own profile''s org must be rejected by projects_staff_insert'
);

-- 7.4 projects_staff_update USING is_financial_staff(id): an assigned
-- superintendent cannot update gmp_amount_cents/deposit_amount_cents.
do $$
begin
  update projects set gmp_enabled = true, gmp_amount_cents = 500000, deposit_amount_cents = 100000
  where id = (select value from test_fixture_ids where key = 'project_a');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'super_a'));
set local role authenticated;
do $$
declare
  v_gmp_before bigint; v_gmp_after bigint; v_deposit_before bigint; v_deposit_after bigint;
begin
  select gmp_amount_cents, deposit_amount_cents into v_gmp_before, v_deposit_before
    from projects where id = (select value from test_fixture_ids where key = 'project_a');

  update projects set gmp_amount_cents = 999999999 where id = (select value from test_fixture_ids where key = 'project_a');
  update projects set deposit_amount_cents = 999999999 where id = (select value from test_fixture_ids where key = 'project_a');

  select gmp_amount_cents, deposit_amount_cents into v_gmp_after, v_deposit_after
    from projects where id = (select value from test_fixture_ids where key = 'project_a');

  perform assert_that(v_gmp_before = v_gmp_after, 'an assigned superintendent CANNOT update projects.gmp_amount_cents — RLS silently blocks the write (projects_staff_update USING is_financial_staff, which excludes superintendent), 0 rows affected rather than an error');
  perform assert_that(v_deposit_before = v_deposit_after, 'an assigned superintendent CANNOT update projects.deposit_amount_cents either, same is_financial_staff gate');
end $$;
reset role;
select clear_test_user();

-- Positive contrast: pm_a (also assigned to project_a, but NOT
-- superintendent) CAN update the same dollar-bearing column — proves
-- the exclusion is specific to the superintendent function, not "any
-- assigned staff."
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
declare v_deposit_after bigint;
begin
  update projects set deposit_amount_cents = 250000 where id = (select value from test_fixture_ids where key = 'project_a');
  select deposit_amount_cents into v_deposit_after from projects where id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(v_deposit_after = 250000, 'an assigned project_manager (NOT superintendent) CAN update projects.deposit_amount_cents — is_financial_staff() excludes ONLY superintendent, confirming the exclusion is function-specific');
end $$;
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 8 — Audit log: admin sees everything; 'accounting' sees only
-- Decision-4-listed tables' rows, org-wide; 'project_manager' sees only
-- their assigned projects' rows, any table; 'superintendent' and
-- 'general' see zero PROJECT-SCOPED audit rows — the explicit
-- regression test proving the documented over-exposure bug is closed.
--
-- JUDGMENT CALL: "zero audit rows" is tested here as "zero rows where
-- project_id matches a real project" (project_a), not "zero rows from
-- the whole table." audit_log_org_scoped_select (schema/006) and its
-- siblings audit_log_vendors_staff_select (schema/012)/
-- audit_log_vendor_members_staff_select (schema/015)/
-- audit_log_import_mapping_profiles_staff_select (schema/013) are
-- explicitly untouched by migration 016 (see its own Step 7 comment)
-- and remain org-wide for ANY staff/admin role regardless of
-- staff_function — a superintendent or general-function staff member
-- can still see their own profile's/org's project_id-IS-NULL audit
-- rows via those pre-existing policies. That is out of scope for this
-- migration; what 016 actually controls is project-scoped (project_id
-- IS NOT NULL) visibility, which is exactly what this section proves
-- is now zero for those two functions.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
do $$
begin
  perform assert_that((select count(*) from audit_log where project_id = (select value from test_fixture_ids where key = 'project_a')) > 0, 'admin sees audit_log rows for project_a (everything, own org)');
  perform assert_that((select count(*) from audit_log where project_id = (select value from test_fixture_ids where key = 'project_c')) > 0, 'admin sees audit_log rows for project_c too (everything, own org)');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'accounting_a'));
set local role authenticated;
do $$
begin
  perform assert_that((select count(*) from audit_log where table_name = 'cost_codes' and project_id = (select value from test_fixture_ids where key = 'project_a')) > 0, 'accounting sees a Decision-4-listed table''s (cost_codes) rows for project_a');
  perform assert_that((select count(*) from audit_log where table_name = 'cost_codes' and project_id = (select value from test_fixture_ids where key = 'project_c')) > 0, 'accounting sees the SAME financial table''s rows for project_c too — org-wide, no project_staff_assignments needed');
  perform assert_that((select count(*) from audit_log where table_name = 'projects' and record_id = (select value from test_fixture_ids where key = 'project_a')) = 0, 'accounting does NOT see a non-financial table (projects itself is not in audit_financial_tables), even for a project in their own org');
  perform assert_that((select count(*) from audit_log where table_name = 'project_staff_assignments') = 0, 'accounting sees zero project_staff_assignments audit rows anywhere — not a Decision-4-listed financial table');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
begin
  perform assert_that((select count(*) from audit_log where table_name = 'project_staff_assignments' and project_id = (select value from test_fixture_ids where key = 'project_a')) > 0, 'project_manager sees a NON-financial table''s (project_staff_assignments) rows for their assigned project — proves "any table", not just Decision-4-listed ones');
  perform assert_that((select count(*) from audit_log where project_id = (select value from test_fixture_ids where key = 'project_c')) = 0, 'project_manager sees ZERO audit_log rows for project_c — not their assigned project');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'super_a'));
set local role authenticated;
do $$
begin
  perform assert_that(
    (select count(*) from audit_log where project_id = (select value from test_fixture_ids where key = 'project_a')) = 0,
    'a superintendent sees ZERO project-scoped audit_log rows, even for their own assigned project — the explicit regression test proving the documented over-exposure bug (any staff, any function, org-wide project-scoped audit visibility) is closed'
  );
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'staff_a'));
set local role authenticated;
do $$
begin
  perform assert_that(
    (select count(*) from audit_log where project_id = (select value from test_fixture_ids where key = 'project_a')) = 0,
    'a general-function staff member also sees ZERO project-scoped audit_log rows, same regression proof as superintendent above'
  );
end $$;
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 9 — create_project_with_defaults(): a successful call
-- produces a project + fee rule + full 113-code template + zero
-- orphaned partial state; a deliberately-forced mid-function failure
-- leaves NO projects row at all; a non-admin caller is rejected.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_org_id uuid;
  v_new_project_id uuid;
  v_division_count int;
  v_cost_code_count int;
  v_fee_rule_count int;
  v_assignment_count int;
  v_member_count int;
begin
  select org_id into v_org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  select create_project_with_defaults(
    v_org_id, 'P3 New Project', 'P3-NEW-001', '123 Test St', 'New Build',
    'fixed_price'::pricing_model, 'Fixed Price',
    'percentage'::fee_basis, 1500, null,
    array[(select value from test_fixture_ids where key = 'pm_a')],
    array[(select value from test_fixture_ids where key = 'client_a')]
  ) into v_new_project_id;

  insert into test_fixture_ids values ('project_new_via_rpc', v_new_project_id);

  perform assert_that(v_new_project_id is not null, 'create_project_with_defaults returns a new project id');

  select count(*) into v_division_count from divisions where project_id = v_new_project_id;
  perform assert_that(v_division_count = 7, 'the new project gets exactly the 7 standard divisions');

  select count(*) into v_cost_code_count from cost_codes where project_id = v_new_project_id;
  perform assert_that(v_cost_code_count = 113, 'the new project gets the full 113-code standard template');

  select count(*) into v_fee_rule_count from project_fee_rules where project_id = v_new_project_id;
  perform assert_that(v_fee_rule_count = 1, 'exactly one project_fee_rules row is created');

  select count(*) into v_assignment_count from project_staff_assignments
    where project_id = v_new_project_id and profile_id = (select value from test_fixture_ids where key = 'pm_a');
  perform assert_that(v_assignment_count = 1, 'the initial staff profile id produces a project_staff_assignments row');

  perform assert_that(
    (select assigned_by from project_staff_assignments where project_id = v_new_project_id and profile_id = (select value from test_fixture_ids where key = 'pm_a'))
      = (select value from test_fixture_ids where key = 'admin'),
    'assigned_by on the RPC-created assignment is the actual calling admin, not a parameter'
  );

  select count(*) into v_member_count from project_members
    where project_id = v_new_project_id and user_id = (select value from test_fixture_ids where key = 'client_a') and member_role = 'client';
  perform assert_that(v_member_count = 1, 'the initial client profile id produces a project_members row');
end $$;

-- Pre-insert validation failure (fee_basis/amount mismatch): the
-- function's own explicit checks raise BEFORE any insert, so this
-- cheaply proves "no orphaned row" but not mid-transaction rollback —
-- see the mid-function failure test below for that.
select assert_raises(
  format(
    $sql$select create_project_with_defaults(%L, 'Bad Fee Project', 'P3-BADFEE-001', null, null, 'fixed_price'::pricing_model, null, 'percentage'::fee_basis, 1500, 5000, '{}'::uuid[], '{}'::uuid[])$sql$,
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin'))
  ),
  'fee_basis=percentage with BOTH fee_basis_points and fee_fixed_amount_cents supplied must be rejected before any row is written'
);
select assert_that(
  (select count(*) from projects where project_number = 'P3-BADFEE-001') = 0,
  'the fee-basis-validation failure leaves no projects row at all'
);

-- Mid-function failure: an org-mismatched initial staff profile id
-- passes every one of the function's own explicit checks and reaches
-- the project_staff_assignments insert loop only AFTER the projects
-- row, the project_fee_rules row, and the full 7-division/113-cost-code
-- template have already been inserted inside this same call. The
-- org-match trigger then raises, proving the whole call rolls back
-- atomically — not merely that validation happened to run first.
select assert_raises(
  format(
    $sql$select create_project_with_defaults(%L, 'Orphan Test Project', 'P3-ORPHAN-001', null, null, 'fixed_price'::pricing_model, null, 'percentage'::fee_basis, 1000, null, array[%L]::uuid[], '{}'::uuid[])$sql$,
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin')),
    (select value from test_fixture_ids where key = 'org_b_admin')
  ),
  'assigning an org-B profile as initial staff must fail deep inside the function (after the projects/fee_rules/cost-code-template inserts already ran) via the org-match trigger'
);
select assert_that(
  (select count(*) from projects where project_number = 'P3-ORPHAN-001') = 0,
  'the mid-function failure (org-mismatched staff assignment) leaves NO projects row — the whole call rolled back atomically, including the already-inserted fee rule and 7-division/113-cost-code template, not just the failing insert'
);

reset role;
select clear_test_user();

-- Non-admin caller rejected.
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
select assert_raises(
  format(
    $sql$select create_project_with_defaults(%L, 'PM Attempt', 'P3-PM-001', null, null, 'fixed_price'::pricing_model, null, 'percentage'::fee_basis, 1000, null, '{}'::uuid[], '{}'::uuid[])$sql$,
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'pm_a'))
  ),
  'a non-admin staff caller (project_manager function) cannot call create_project_with_defaults()'
);
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 10 — Regression: this file is registered as the LAST entry
-- in scripts/db/run-sql-tests.mjs's FILES list, so the runner's single
-- invocation already re-runs every prior schema file and every prior
-- SQL test file (package1_tests.sql through
-- package_p5_commitments_bids_procurement_tests.sql and
-- committed_forecast_hardening_tests.sql) unmodified, in the same
-- PGlite session, before this file executes — proving the
-- is_org_staff()/audit-log rewrites in migration 016 break nothing
-- already shipped. There is no separate SQL in this file for that
-- requirement; it's a property of the FILES list + exit-non-zero-on-
-- first-failure behavior of scripts/db/run-sql-tests.mjs itself.
-- =====================================================================

select 'ALL PACKAGE P3 SQL/RLS TESTS PASSED' as result;
