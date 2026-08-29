-- =====================================================================
-- Stone Column Portal — P3.1 (Project Intake & Employee Handoff) SQL/RLS
-- test suite, covering schema/018_project_intake_and_handoff.sql.
--
-- Runs LAST in scripts/db/run-sql-tests.mjs's FILES list, immediately
-- after package_p3_project_status_reversible_lifecycle_tests.sql — same
-- isolation discipline that file's own header documents: creates its
-- own brand-new throwaway rows/projects rather than reusing another
-- file's fixtures for anything this file itself mutates.
--
-- Reused fixtures: 'admin' (org A admin), 'org_b_admin'/'org_b_id'
-- (org B), 'pm_a' (org A, staff_function=project_manager, assigned to
-- 'project_a' ONLY), 'project_a'/'project_c' (both org A —
-- package_p3_project_staff_access_tests.sql), 'project_org_b' (org B —
-- package_p1_auth_tests.sql), 'client_a' (a real member of project_a).
-- New fixtures created by this file: 'project_numbering_x'/
-- '_numbering_y' (generate_project_number()/create_project_with_
-- defaults() sequencing), 'project_legacy' (pre-migration-format
-- project_number fixture).
--
-- CONCURRENCY DISCLOSURE: design §1's atomicity claim for
-- generate_project_number()'s `INSERT ... ON CONFLICT DO UPDATE ...
-- RETURNING` idiom is a property of a single atomic SQL statement
-- taking a row-level lock — genuinely true regardless of how many
-- concurrent sessions call it, on any real Postgres. This harness
-- (PGlite, one single connection, no thread/second-session capability —
-- same constraint every other test file in this suite already lives
-- with; none of them simulate genuine concurrent transactions either)
-- cannot literally exercise two overlapping transactions. What Section 1
-- below DOES prove: the exact same statement, called twice in
-- sequence, produces distinct, sequential values with no gap and no
-- repeat — the correctness of the increment logic itself, which is the
-- part a bug could actually hide in (e.g. a non-atomic
-- SELECT-then-INSERT race). The atomic-statement claim itself is a
-- property of Postgres's ON CONFLICT DO UPDATE semantics, not of this
-- test.
-- =====================================================================

-- =====================================================================
-- SECTION 1 — generate_project_number() / project_number_counters:
-- sequential numbering, year-scoping, and format.
-- =====================================================================

-- NOTE: this first block runs WITHOUT `set local role authenticated`
-- (same convention package1_tests.sql's own Section 9 documents) —
-- project_number_counters has NO policies at all for `authenticated`
-- (schema/018 Step 1, matching audit_financial_tables' precedent), so a
-- direct seed INSERT into it must run as the unrestricted table owner,
-- not the authenticated role. generate_project_number() itself is
-- SECURITY DEFINER and takes no auth.uid()-derived input, so calling it
-- from either role context is equally valid — this block simply never
-- switches roles at all.
select set_test_user((select value from test_fixture_ids where key = 'admin'));

do $$
declare
  v_org_id uuid;
  v_current_year int := extract(year from now())::int;
  v_num_1 text;
  v_num_2 text;
  v_seq_1 int;
  v_seq_2 int;
begin
  select org_id into v_org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  -- Year-scoping: seed a PRIOR year's counter row for the same org with
  -- a deliberately distinct next_number, so a bug that ignored the year
  -- column (e.g. keying only off org_id) would visibly cross-contaminate.
  insert into project_number_counters (org_id, year, next_number) values (v_org_id, v_current_year - 1, 500);

  v_num_1 := generate_project_number(v_org_id);
  v_num_2 := generate_project_number(v_org_id);

  perform assert_that(v_num_1 <> v_num_2, 'two sequential generate_project_number() calls for the same org/year produce distinct numbers');
  perform assert_that(v_num_1 like 'SC-' || v_current_year::text || '-%', 'the generated number matches the SC-YYYY-### format for the current year');

  v_seq_1 := split_part(v_num_1, '-', 3)::int;
  v_seq_2 := split_part(v_num_2, '-', 3)::int;
  perform assert_that(v_seq_2 = v_seq_1 + 1, 'the second call''s sequence is exactly one greater than the first — sequential, not merely distinct');

  perform assert_that(
    (select next_number from project_number_counters where org_id = v_org_id and year = v_current_year - 1) = 500,
    'the seeded PRIOR-year counter row is completely untouched by two calls scoped to the current year — proves year-scoping, not just org-scoping'
  );
end $$;

-- End-to-end via the RPC (the plan's explicit bullet): two sequential
-- create_project_with_defaults() calls for the same org produce two
-- distinct, sequential project_number values on the resulting rows —
-- not just at the helper level above, but actually wired through.
-- Also doubles as the "no pricing model at all" success case: called
-- with only 4 positional args, relying on every pricing/fee param's new
-- default of NULL. From here on this section runs as the real
-- `authenticated` role (create_project_with_defaults() needs auth.uid()
-- to resolve is_org_admin_for_org()).
set local role authenticated;
do $$
declare
  v_org_id uuid;
  v_project_x uuid;
  v_project_y uuid;
  v_number_x text;
  v_number_y text;
  v_seq_x int;
  v_seq_y int;
begin
  select org_id into v_org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  select create_project_with_defaults(v_org_id, 'P3.1 Numbering Test X', null, null) into v_project_x;
  select create_project_with_defaults(v_org_id, 'P3.1 Numbering Test Y', null, null) into v_project_y;
  insert into test_fixture_ids values ('project_numbering_x', v_project_x), ('project_numbering_y', v_project_y);

  select project_number into v_number_x from projects where id = v_project_x;
  select project_number into v_number_y from projects where id = v_project_y;

  perform assert_that(v_number_x is not null and v_number_y is not null, 'both RPC-created projects get a generated project_number, even with no pricing model supplied');
  perform assert_that(v_number_x <> v_number_y, 'two sequential create_project_with_defaults() calls for the same org produce distinct project numbers');

  v_seq_x := split_part(v_number_x, '-', 3)::int;
  v_seq_y := split_part(v_number_y, '-', 3)::int;
  perform assert_that(v_seq_y = v_seq_x + 1, 'the second project''s sequence number is exactly one greater than the first''s');

  perform assert_that(
    (select count(*) from project_fee_rules where project_id = v_project_x) = 0,
    'a project created with no pricing model at all succeeds and has ZERO project_fee_rules rows'
  );
  perform assert_that(
    (select pricing_model from projects where id = v_project_x) is null,
    'projects.pricing_model is genuinely NULL ("to be determined"), not defaulted to some value'
  );
end $$;

-- Unsupported-but-otherwise-valid pricing model + fee data: the
-- project_fee_rules insert is skipped entirely (not rejected, not
-- silently coerced) — the conditional-insert judgment call this
-- migration makes explicit.
do $$
declare
  v_org_id uuid;
  v_project_id uuid;
begin
  select org_id into v_org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  select create_project_with_defaults(
    v_org_id, 'P3.1 Unsupported Pricing Test', null, null,
    'fixed_price'::pricing_model, 'Fixed Price (TBD)',
    'percentage'::fee_basis, 1000, null
  ) into v_project_id;

  perform assert_that(
    (select count(*) from project_fee_rules where project_id = v_project_id) = 0,
    'create_project_with_defaults() with an unsupported pricing_model (fixed_price) but otherwise-valid fee data skips the project_fee_rules insert entirely, rather than raising or inserting anyway'
  );
  perform assert_that(
    (select pricing_model from projects where id = v_project_id) = 'fixed_price',
    'projects.pricing_model is still set to the caller-supplied value even when no matching fee rule is created'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 2 — pre-existing (pre-migration) project_number values are
-- left completely unchanged, and a freshly generated number never
-- collides with a legacy-format one.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_org_id uuid;
  v_legacy_project_id uuid;
  v_new_number text;
begin
  select org_id into v_org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  insert into projects (org_id, name, project_number, pricing_model)
  values (v_org_id, 'Legacy Format Project', 'LEGACY-0007', null)
  returning id into v_legacy_project_id;
  insert into test_fixture_ids values ('project_legacy', v_legacy_project_id);

  perform assert_that(
    (select project_number from projects where id = v_legacy_project_id) = 'LEGACY-0007',
    'a pre-existing, arbitrary-format project_number is left completely unchanged by this migration'
  );

  v_new_number := generate_project_number(v_org_id);
  perform assert_that(v_new_number <> 'LEGACY-0007', 'a freshly generated project number never collides with the pre-existing legacy-format one');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 3 — set_project_fee_terms(): admin-only, supersede (not
-- update-in-place) semantics, unsupported-pricing-model rejection.
-- =====================================================================

-- 3.1 Non-admin caller rejected, even against a project they can see
-- and are assigned to (mirrors package_p3_project_status_reversible_
-- lifecycle_tests.sql's own change_project_status() non-admin proof).
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
select assert_raises(
  format(
    $sql$select set_project_fee_terms(%L, 'cost_plus_percentage'::pricing_model, 'percentage'::fee_basis, 1000, null, 'Cost-Plus (10%%)')$sql$,
    (select value from test_fixture_ids where key = 'project_a')
  ),
  'set_project_fee_terms() rejects a non-admin caller (project_manager pm_a), even against a project they can see and are assigned to'
);
reset role;
select clear_test_user();

-- 3.2 Admin success path: insert-when-none-exists, then supersede (not
-- update-in-place) on a second call — project_fee_rules' own
-- append-only, effective-dated design (schema/001) preserved.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
do $$
declare
  v_project_id uuid := (select value from test_fixture_ids where key = 'project_numbering_x');
  v_total_rows int;
  v_active_rows int;
begin
  perform assert_that(
    (select count(*) from project_fee_rules where project_id = v_project_id) = 0,
    'project_numbering_x starts with zero fee rule rows (created with no pricing model, Section 1)'
  );

  perform set_project_fee_terms(v_project_id, 'cost_plus_percentage'::pricing_model, 'percentage'::fee_basis, 1200, null, 'Cost-Plus (12%)');

  perform assert_that(
    (select count(*) from project_fee_rules where project_id = v_project_id) = 1,
    'set_project_fee_terms() inserts exactly one fee rule row when none existed yet'
  );
  perform assert_that(
    (select pricing_model from projects where id = v_project_id) = 'cost_plus_percentage',
    'set_project_fee_terms() updates projects.pricing_model'
  );
  perform assert_that(
    (select pricing_model_label from projects where id = v_project_id) = 'Cost-Plus (12%)',
    'set_project_fee_terms() updates projects.pricing_model_label together with the fee terms, never drifting apart'
  );

  -- Second call: different terms entirely — must supersede, not mutate.
  perform set_project_fee_terms(v_project_id, 'cost_plus_fixed_fee'::pricing_model, 'fixed'::fee_basis, null, 750000, 'Cost-Plus (Fixed $7,500)');

  select count(*) into v_total_rows from project_fee_rules where project_id = v_project_id;
  select count(*) into v_active_rows from project_fee_rules where project_id = v_project_id and effective_to is null;

  perform assert_that(v_total_rows = 2, 'the historical fee rule row is preserved (2 total rows) — a second call INSERTs a new row rather than UPDATEing the first in place');
  perform assert_that(v_active_rows = 1, 'exactly one CURRENT (effective_to is null) fee rule row after the second call — the first was superseded (effective_to set), not left as a second dangling "active" row');
  perform assert_that(
    (select pricing_model from projects where id = v_project_id) = 'cost_plus_fixed_fee',
    'the second call updates pricing_model again, together with the new fee terms'
  );
end $$;

-- 3.3 Unsupported pricing_model rejected outright — this function
-- always writes a fee rule row, unlike create_project_with_defaults()'s
-- conditional insert, so an unsupported model must fail loudly rather
-- than silently skip (it has nothing to skip; not writing anything at
-- all would violate the RPC's own contract of "sets terms").
select assert_raises(
  format(
    $sql$select set_project_fee_terms(%L, 'fixed_price'::pricing_model, 'percentage'::fee_basis, 1000, null, null)$sql$,
    (select value from test_fixture_ids where key = 'project_numbering_y')
  ),
  'set_project_fee_terms() rejects an unsupported pricing_model (fixed_price) outright'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 — project_briefs / project_site_info: staff without a
-- matching project assignment cannot read another org's rows (nor an
-- unassigned sibling project's rows in their own org); inserts succeed
-- without error (proves the log_audit_project_settings() fix — an
-- earlier draft using log_audit() would crash here on INSERT with
-- "record 'new' has no field 'id'", since these tables have no id
-- column at all).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
do $$
begin
  insert into project_briefs (project_id, summary, approx_square_footage, target_budget_low_cents, target_budget_high_cents)
  values ((select value from test_fixture_ids where key = 'project_a'), 'Project A brief summary for P3.1 tests.', 3200, 80000000, 95000000);
  insert into project_briefs (project_id, summary)
  values ((select value from test_fixture_ids where key = 'project_c'), 'Project C brief summary for P3.1 tests.');

  insert into project_site_info (project_id, full_address, survey_status)
  values ((select value from test_fixture_ids where key = 'project_a'), '1 Test Way', 'requested');
  insert into project_site_info (project_id, full_address)
  values ((select value from test_fixture_ids where key = 'project_c'), '2 Test Way');

  perform assert_that(
    (select count(*) from project_briefs where project_id = (select value from test_fixture_ids where key = 'project_a')) = 1,
    'project_briefs insert for project_a succeeded without error'
  );
  perform assert_that(
    (select count(*) from project_site_info where project_id = (select value from test_fixture_ids where key = 'project_a')) = 1,
    'project_site_info insert for project_a succeeded without error'
  );
  perform assert_that(
    (select count(*) from audit_log where table_name = 'project_briefs' and project_id = (select value from test_fixture_ids where key = 'project_a')) > 0,
    'the project_briefs insert wrote an audit_log row via log_audit_project_settings() — proves the audit-trigger fix (NOT log_audit(), which would crash on this project_id-keyed, no-id-column table) actually works, not merely that the insert happened to succeed'
  );
  perform assert_that(
    (select count(*) from audit_log where table_name = 'project_site_info' and project_id = (select value from test_fixture_ids where key = 'project_a')) > 0,
    'the project_site_info insert wrote an audit_log row via log_audit_project_settings() too'
  );

  -- UPDATE also fires the same trigger cleanly (log_audit_project_settings()
  -- is shared insert/update/delete, not insert-only).
  update project_briefs set summary = 'Updated Project A brief summary for P3.1 tests.'
  where project_id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(
    (select count(*) from audit_log where table_name = 'project_briefs' and project_id = (select value from test_fixture_ids where key = 'project_a')) > 1,
    'updating project_briefs also fires log_audit_project_settings() without error'
  );
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;
do $$
begin
  insert into project_briefs (project_id, summary)
  values ((select value from test_fixture_ids where key = 'project_org_b'), 'Org B project brief summary for P3.1 tests.');
end $$;
reset role;
select clear_test_user();

-- pm_a: assigned to project_a ONLY (package_p3_project_staff_access_tests.sql).
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
begin
  perform assert_that(
    (select count(*) from project_briefs where project_id = (select value from test_fixture_ids where key = 'project_a')) = 1,
    'pm_a can read project_briefs for their own assigned project (project_a)'
  );
  perform assert_that(
    (select count(*) from project_briefs where project_id = (select value from test_fixture_ids where key = 'project_c')) = 0,
    'pm_a assigned to project_a ONLY cannot read project_c''s project_briefs row — an unassigned sibling project in the SAME org'
  );
  perform assert_that(
    (select count(*) from project_briefs where project_id = (select value from test_fixture_ids where key = 'project_org_b')) = 0,
    'pm_a (org A) cannot read an org-B project''s project_briefs row at all'
  );
  perform assert_that(
    (select count(*) from project_site_info where project_id = (select value from test_fixture_ids where key = 'project_c')) = 0,
    'pm_a assigned to project_a ONLY cannot read project_c''s project_site_info row either'
  );
end $$;
select assert_raises(
  format(
    'insert into project_briefs (project_id, summary) values (%L, %L)',
    (select value from test_fixture_ids where key = 'project_c'),
    'Attempted write by unassigned pm_a'
  ),
  'pm_a cannot WRITE a project_briefs row for project_c either — is_org_staff(project_c) is false for an unassigned project'
);
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 5 — client session gets ZERO rows from either table (no
-- client-read RLS policy exists in this migration — see schema/018's
-- Step 6/7 comments; client-facing exposure of client_facing_notes
-- (gated on client_facing_notes_published) and the unconditional
-- exclusion of internal_notes are Task 2 repository-layer concerns).
--
-- DEFERRED TO TASK 2 (per the Task 1 brief's own instruction, noted
-- here rather than silently skipped): "a client-role session's
-- repository-level read of project_briefs never includes
-- internal_notes" cannot be tested in this file — there is no
-- service/repository read function yet (Task 2 hasn't run). Since this
-- migration adds no client-read RLS policy at all for project_briefs,
-- the assertion below (zero rows, period) is the strongest statement
-- provable at the schema layer today; the column-level omission proof
-- belongs in Task 2's own test suite once getProjectBrief()-style
-- repository functions exist.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;
do $$
begin
  perform assert_that(
    (select count(*) from project_briefs where project_id = (select value from test_fixture_ids where key = 'project_a')) = 0,
    'a client session (client_a, a real member of project_a) gets ZERO project_briefs rows — no client-read RLS policy exists in this migration'
  );
  perform assert_that(
    (select count(*) from project_site_info where project_id = (select value from test_fixture_ids where key = 'project_a')) = 0,
    'a client session gets ZERO project_site_info rows either, same reasoning'
  );
end $$;
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 6 — generate_project_number() cross-tenant rejection (FIX
-- ROUND: independent review empirically reproduced a client-role user
-- from Org A directly calling generate_project_number(org_B_id) and
-- successfully advancing Org B's counter, with zero relationship to
-- Org B — this section is the regression proof that gap is closed).
-- =====================================================================

-- 6.1 A staff session with no relationship to the target org at all
-- (org_b_admin, org B) cannot advance org A's counter.
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;
select assert_raises(
  format(
    $sql$select generate_project_number(%L)$sql$,
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin'))
  ),
  'generate_project_number() rejects a caller with no relationship to the target org (org_b_admin calling for org A) — the cross-tenant griefing vector independent review found and reproduced'
);
reset role;
select clear_test_user();

-- 6.2 A client-role session cannot call it even for their OWN org —
-- is_org_staff_for_org() requires role IN (admin, staff), and client_a
-- is neither.
select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;
select assert_raises(
  format(
    $sql$select generate_project_number(%L)$sql$,
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin'))
  ),
  'generate_project_number() rejects a client-role session even for their OWN org — is_org_staff_for_org() requires role in (admin, staff), not just "some relationship to this org"'
);
reset role;
select clear_test_user();

-- 6.3 Positive contrast: a non-admin STAFF session (pm_a,
-- staff_function=project_manager) can still generate a number for their
-- own org — the fix's gate is org-staff-membership, not admin-only;
-- create_project_with_defaults() itself remains separately admin-gated,
-- so this doesn't reopen project creation to non-admins, only confirms
-- the helper's own narrower fix didn't overshoot into breaking its
-- sanctioned caller.
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
declare
  v_org_id uuid;
  v_number text;
begin
  select org_id into v_org_id from profiles where id = (select value from test_fixture_ids where key = 'pm_a');
  v_number := generate_project_number(v_org_id);
  perform assert_that(v_number is not null and v_number like 'SC-%', 'a non-admin staff session (project_manager function) can still generate a project number for their own org — the fix restricts to org membership, not admin-only');
end $$;
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 7 — project_fee_rules_one_active_per_project: the hard
-- database-level guarantee (FIX ROUND: added alongside the
-- set_project_fee_terms() row-lock fix as defense in depth) that at
-- most one row per project can ever have effective_to IS NULL, proven
-- directly against the table — independent of set_project_fee_terms()'s
-- own locking, so this holds even against a hypothetical future bug
-- that bypassed the RPC's locking entirely.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
do $$
declare
  v_project_id uuid;
begin
  select create_project_with_defaults(
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin')),
    'P3.1 Duplicate Active Fee Rule Test', null, null
  ) into v_project_id;
  insert into test_fixture_ids values ('project_dup_fee_rule', v_project_id);

  insert into project_fee_rules (project_id, fee_basis, fee_basis_points, created_by)
  values (v_project_id, 'percentage', 1000, (select value from test_fixture_ids where key = 'admin'));

  perform assert_that(
    (select count(*) from project_fee_rules where project_id = v_project_id and effective_to is null) = 1,
    'the first active fee rule row for project_dup_fee_rule inserts cleanly'
  );
end $$;

select assert_raises(
  format(
    $sql$insert into project_fee_rules (project_id, fee_basis, fee_basis_points, created_by) values (%L, 'percentage'::fee_basis, 1500, %L)$sql$,
    (select value from test_fixture_ids where key = 'project_dup_fee_rule'),
    (select value from test_fixture_ids where key = 'admin')
  ),
  'a SECOND fee rule row with effective_to IS NULL for the same project is rejected outright by project_fee_rules_one_active_per_project — the hard DB-level guarantee behind the set_project_fee_terms() race-condition fix, proven independent of that RPC''s own row-lock'
);

do $$
begin
  perform assert_that(
    (select count(*) from project_fee_rules where project_id = (select value from test_fixture_ids where key = 'project_dup_fee_rule') and effective_to is null) = 1,
    'still exactly one active row after the rejected second-insert attempt — the constraint failed the attempt cleanly, not partially'
  );
end $$;
reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 8 — project_staff_assignments_self_select (schema/019, added
-- during Task 9's implementation, not part of the original schema/018
-- migration). design §8's "Your assignment" Overview card needs a
-- non-admin staff session (pm_a/super_a — the actual audience of a
-- handoff note) to read their OWN project_staff_assignments row's
-- handoff columns; project_staff_assignments_admin_manage (schema/016)
-- is admin-only for SELECT too, so without this additive self-read
-- policy the card is non-functional for that audience. This section
-- proves the fix is scoped exactly as narrowly as claimed: a caller
-- sees their own row (including a revoked one), never a project
-- teammate's row, and the pre-existing admin-only visibility into
-- EVERY row is completely unaffected.
-- =====================================================================

-- 8.1 / 8.2 / 8.3 — pm_a (assigned to project_a) can read their own
-- project_a row, cannot read super_a's project_a row (same project,
-- different profile_id — proves this is self-scoped, not
-- project-scoped), and an unfiltered query against project_a returns
-- exactly their one row, not both.
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
begin
  perform assert_that(
    (select count(*) from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_a')
         and profile_id = (select value from test_fixture_ids where key = 'pm_a')) = 1,
    'pm_a can read their OWN project_staff_assignments row for project_a via the new self-select policy'
  );
  perform assert_that(
    (select priority from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_a')
         and profile_id = (select value from test_fixture_ids where key = 'pm_a')) = 'normal',
    'pm_a''s self-read includes the new handoff columns (priority defaults to normal) — not just id/project_id'
  );
  perform assert_that(
    (select count(*) from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_a')
         and profile_id = (select value from test_fixture_ids where key = 'super_a')) = 0,
    'pm_a CANNOT read super_a''s project_staff_assignments row, even for the SAME project — the self-select policy is scoped to profile_id = auth.uid(), not project_id'
  );
  perform assert_that(
    (select count(*) from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_a')) = 1,
    'an unfiltered query against project_a''s assignments returns exactly pm_a''s own one row for this session, not both real rows (pm_a + super_a) — confirms the self-select policy does not grant project-wide visibility'
  );
end $$;
reset role;
select clear_test_user();

-- 8.4 — Regression: admin's pre-existing, unaffected visibility into
-- EVERY project_a assignment row (both pm_a's and super_a's), proving
-- the new permissive policy only ADDS a narrow self-read path and
-- leaves project_staff_assignments_admin_manage's own admin-only
-- reach completely intact.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;
do $$
begin
  perform assert_that(
    (select count(*) from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_a')) = 2,
    'admin still sees BOTH project_a assignment rows (pm_a + super_a) — project_staff_assignments_admin_manage is unaffected by the new self-select policy'
  );
end $$;

-- 8.5 — A caller may also self-read their own REVOKED row (their own
-- historical record) — the policy is deliberately not restricted to
-- `revoked_at is null` (see schema/019's own comment on why: no
-- cross-user exposure, "active assignment only" is an application-layer
-- filter, not an RLS concern). Uses a fresh, disposable assignment
-- (pm_a on project_c) so nothing pm_a's/super_a's real project_a rows
-- depend on elsewhere is touched.
do $$
begin
  insert into project_staff_assignments (project_id, profile_id, assigned_by)
  values (
    (select value from test_fixture_ids where key = 'project_c'),
    (select value from test_fixture_ids where key = 'pm_a'),
    (select value from test_fixture_ids where key = 'admin')
  );
  update project_staff_assignments set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where project_id = (select value from test_fixture_ids where key = 'project_c')
    and profile_id = (select value from test_fixture_ids where key = 'pm_a');
end $$;
reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;
do $$
begin
  perform assert_that(
    (select revoked_at from project_staff_assignments
       where project_id = (select value from test_fixture_ids where key = 'project_c')
         and profile_id = (select value from test_fixture_ids where key = 'pm_a')) is not null,
    'pm_a can self-read their OWN revoked project_staff_assignments row (project_c) too — the self-select policy is not restricted to active rows, by design'
  );
end $$;
reset role;
select clear_test_user();

select 'ALL PACKAGE P3.1 PROJECT INTAKE AND HANDOFF SQL/RLS TESTS PASSED' as result;
