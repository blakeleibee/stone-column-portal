-- =====================================================================
-- Stone Column Portal — SQL/RLS test suite for
-- schema/017_project_status_reversible_lifecycle.sql (P3 owner-preview
-- round 2, Task D1): the four newly-allowed project status transitions
-- (closed_out->active, active->archived, archived->active,
-- archived->closed_out) and the new change_project_status() RPC.
--
-- Runs LAST in scripts/db/run-sql-tests.mjs's FILES list, immediately
-- after package_p3_project_staff_access_tests.sql. Deliberately creates
-- its own brand-new throwaway projects (never reuses 'project_a' or
-- 'project_c') so nothing here can perturb any earlier file's fixture
-- state or status assumptions — same isolation discipline
-- package_p3_project_staff_access_tests.sql's own header documents for
-- its own 'project_c' fixture.
--
-- Reused fixtures: 'admin' (org A admin), 'pm_a' (org A, staff_function
-- = project_manager, assigned to 'project_a' only — created in
-- package_p3_project_staff_access_tests.sql).
-- New fixtures created by this file: 'project_lifecycle_a' (raw
-- trigger-level transition coverage), 'project_lifecycle_b' (invalid-
-- transition regression coverage), 'project_lifecycle_c' (RPC-driven
-- full-cycle coverage).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- ---------------------------------------------------------------------
-- SECTION 1 — trigger-level coverage of the four newly-allowed
-- transitions, driven by plain UPDATEs (not the RPC) so this section
-- proves the trigger itself, independent of change_project_status().
-- Starts from a fresh project ('project_lifecycle_a', default
-- status='draft') and walks it through every existing transition it
-- needs to reach each new one, asserting the row's status after each
-- step.
-- ---------------------------------------------------------------------
do $$
declare
  v_project_id uuid;
begin
  insert into projects (org_id, name, project_number, pricing_model)
  select org_id, 'Lifecycle Project A', 'P3-LIFECYCLE-A-001', 'fixed_price'
  from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_project_id;
  insert into test_fixture_ids values ('project_lifecycle_a', v_project_id);

  -- draft -> active (pre-existing, sanity only)
  update projects set status = 'active' where id = v_project_id;
  perform assert_that((select status from projects where id = v_project_id) = 'active', 'draft -> active still succeeds unchanged');

  -- active -> closed_out (pre-existing, needed to reach closed_out)
  update projects set status = 'closed_out' where id = v_project_id;
  perform assert_that((select status from projects where id = v_project_id) = 'closed_out', 'active -> closed_out still succeeds unchanged');

  -- closed_out -> active (NEW)
  update projects set status = 'active' where id = v_project_id;
  perform assert_that((select status from projects where id = v_project_id) = 'active', 'NEW: closed_out -> active succeeds');

  -- active -> archived (NEW, direct)
  update projects set status = 'archived' where id = v_project_id;
  perform assert_that((select status from projects where id = v_project_id) = 'archived', 'NEW: active -> archived succeeds directly');

  -- archived -> active (NEW, the reversibility fix)
  update projects set status = 'active' where id = v_project_id;
  perform assert_that((select status from projects where id = v_project_id) = 'active', 'NEW: archived -> active succeeds (reversibility fix)');

  -- active -> archived again, then archived -> closed_out (NEW)
  update projects set status = 'archived' where id = v_project_id;
  update projects set status = 'closed_out' where id = v_project_id;
  perform assert_that((select status from projects where id = v_project_id) = 'closed_out', 'NEW: archived -> closed_out succeeds');

  -- closed_out -> archived (pre-existing, unchanged) — confirms the
  -- widened condition didn't accidentally drop this original transition.
  update projects set status = 'archived' where id = v_project_id;
  perform assert_that((select status from projects where id = v_project_id) = 'archived', 'closed_out -> archived still succeeds unchanged');
end $$;

-- ---------------------------------------------------------------------
-- SECTION 2 — regression: widening the allowed set must not have
-- opened anything broader than the four named transitions. Two
-- deliberately-still-invalid transitions, each on its own fresh
-- project: draft -> archived (skips the entire lifecycle) and
-- on_hold -> archived (explicitly NOT one of the four new transitions
-- per this migration's own brief).
-- ---------------------------------------------------------------------
do $$
declare
  v_project_id uuid;
begin
  insert into projects (org_id, name, project_number, pricing_model)
  select org_id, 'Lifecycle Project B', 'P3-LIFECYCLE-B-001', 'fixed_price'
  from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_project_id;
  insert into test_fixture_ids values ('project_lifecycle_b', v_project_id);
end $$;

select assert_raises(
  format(
    $sql$update projects set status = 'archived' where id = %L$sql$,
    (select value from test_fixture_ids where key = 'project_lifecycle_b')
  ),
  'draft -> archived directly must still be rejected — widening the allowed set did not open a skip-the-lifecycle path'
);

do $$
declare
  v_project_id uuid := (select value from test_fixture_ids where key = 'project_lifecycle_b');
begin
  -- draft -> active -> on_hold (both pre-existing) to reach on_hold.
  update projects set status = 'active' where id = v_project_id;
  update projects set status = 'on_hold' where id = v_project_id;
  perform assert_that((select status from projects where id = v_project_id) = 'on_hold', 'setup: project_lifecycle_b reaches on_hold via pre-existing transitions');
end $$;

select assert_raises(
  format(
    $sql$update projects set status = 'archived' where id = %L$sql$,
    (select value from test_fixture_ids where key = 'project_lifecycle_b')
  ),
  'on_hold -> archived must still be rejected — this migration deliberately does not add it (not one of the four named transitions)'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 3 — a non-admin caller is rejected on BOTH write paths:
-- change_project_status() itself, AND a raw UPDATE straight against
-- `projects` that bypasses the RPC entirely (the actual bypass an
-- independent review empirically proved against this migration's first
-- draft — see the FIX ROUND 1 comment below).
--
-- pm_a (staff_function=project_manager, assigned to 'project_a' only —
-- package_p3_project_staff_access_tests.sql) targets 'project_a', a
-- project pm_a genuinely CAN see, so this specifically exercises the
-- admin check itself, not the earlier "project not visible at all"
-- branch. Rejected regardless of whether the target status/current
-- status pairing would otherwise be a valid transition — the admin
-- check runs before the transition-validity check either way.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;

select assert_raises(
  format(
    $sql$select change_project_status(%L, 'archived'::project_status)$sql$,
    (select value from test_fixture_ids where key = 'project_a')
  ),
  'change_project_status() rejects a non-admin caller (project_manager pm_a), even against a project they can see and are assigned to'
);

-- FIX ROUND 1 (independent review, empirically proven against the
-- pre-fix state of this migration): the actual regression test that
-- would have caught the real bypass — a non-admin caller issuing a raw
-- UPDATE directly against `projects`, bypassing change_project_status()
-- entirely (exactly how a PostgREST caller does
-- supabase.from("projects").update(...) — no RPC involved at all), used
-- to SUCCEED even though the RPC above correctly rejected the same
-- caller. Root cause: projects_staff_update's RLS policy (schema/016
-- lines 522-525, already deployed, pre-dating this migration) is
-- `using (is_financial_staff(id))` — admits any non-superintendent
-- staff (pm_a included, assigned to project_a), not just admins — so
-- RLS alone let this UPDATE statement through. Only the admin check now
-- inside enforce_project_status_transition() (schema/017 FIX ROUND 1)
-- stops it, which is why this is a trigger-level rejection proof, not
-- an RLS-policy-level one — RLS still legitimately allows pm_a to
-- UPDATE non-status columns on project_a.
select assert_raises(
  format(
    $sql$update projects set status = 'archived' where id = %L$sql$,
    (select value from test_fixture_ids where key = 'project_a')
  ),
  'a non-admin caller (project_manager pm_a) issuing a raw UPDATE directly against projects — bypassing change_project_status() entirely — is also rejected: the real authorization boundary is the trigger, not the RPC'
);

select assert_that(
  (select status from projects where id = (select value from test_fixture_ids where key = 'project_a')) = 'active',
  'project_a''s status is unchanged after the rejected raw-UPDATE bypass attempt above'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 4 — a real admin drives a project through the full new cycle
-- specifically via change_project_status(), not a raw UPDATE: this is
-- the RPC's own success path, proving it delegates correctly to the
-- trigger for every step (existing AND new transitions) rather than
-- only being exercised at the trigger level (Section 1) or the
-- rejection level (Section 3).
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_project_id uuid;
begin
  insert into projects (org_id, name, project_number, pricing_model)
  select org_id, 'Lifecycle Project C', 'P3-LIFECYCLE-C-001', 'fixed_price'
  from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_project_id;
  insert into test_fixture_ids values ('project_lifecycle_c', v_project_id);

  perform assert_that((select status from projects where id = v_project_id) = 'draft', 'project_lifecycle_c starts in draft');

  perform change_project_status(v_project_id, 'active'::project_status);
  perform assert_that((select status from projects where id = v_project_id) = 'active', 'RPC: draft -> active');

  perform change_project_status(v_project_id, 'archived'::project_status);
  perform assert_that((select status from projects where id = v_project_id) = 'archived', 'RPC: active -> archived');

  perform change_project_status(v_project_id, 'active'::project_status);
  perform assert_that((select status from projects where id = v_project_id) = 'active', 'RPC: archived -> active');

  perform change_project_status(v_project_id, 'closed_out'::project_status);
  perform assert_that((select status from projects where id = v_project_id) = 'closed_out', 'RPC: active -> closed_out');

  perform change_project_status(v_project_id, 'archived'::project_status);
  perform assert_that((select status from projects where id = v_project_id) = 'archived', 'RPC: closed_out -> archived — full cycle draft->active->archived->active->closed_out->archived completed entirely through change_project_status()');
end $$;

reset role;
select clear_test_user();

select 'ALL PACKAGE P3 PROJECT STATUS REVERSIBLE LIFECYCLE SQL/RLS TESTS PASSED' as result;
