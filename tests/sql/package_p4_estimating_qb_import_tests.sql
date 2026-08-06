-- =====================================================================
-- Stone Column Portal — P4 (Estimating & Budgeting UI + QuickBooks
-- Desktop Import) SQL/RLS test suite, covering schema/013_estimating_
-- and_qb_import.sql.
--
-- Runs after schema/001-013 and after package1_tests.sql /
-- package_p1_auth_tests.sql / package_p2_1_financial_master_data_tests.sql
-- (via scripts/db/run-sql-tests.mjs) against the same fresh PGlite
-- instance, reusing the set_test_user()/clear_test_user()/assert_that()/
-- assert_raises()/test_fixture_ids helpers already established in
-- tests/sql/package1_tests.sql.
--
-- Reused fixtures: 'admin' (org A's admin — package1_tests.sql has no
-- separate 'org_a'/'org_a_admin' key; 'admin' IS org A's admin, and org
-- A's own id is derived via `(select org_id from profiles where id =
-- admin)`, the same pattern package_p2_1_financial_master_data_tests.sql
-- SECTION 8 already uses), 'org_b_admin' (package_p1_auth_tests.sql),
-- 'project_a', 'cost_code_a' (package1_tests.sql SECTION 2).
--
-- NOTE on SECTION 2: cost_code_a already carries an 'original'
-- budget_ledger entry — package1_tests.sql SECTION 5 inserts it as the
-- 'ledger_1' fixture (amount_cents = 1000000). This test suite reuses
-- that existing row rather than re-seeding a first 'original' entry, so
-- SECTION 2 proves the guard by attempting a SECOND 'original' insert
-- directly.
-- =====================================================================

-- =====================================================================
-- SECTION 1 — import_mapping_profiles: RLS + cross-org isolation.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_profile_id uuid;
begin
  -- cost_code_match_strategy defaults to 'prefix', which requires
  -- cost_code_prefix_length to be set (import_mapping_profiles_
  -- prefix_length_required) — set it explicitly rather than relying on
  -- the default succeeding unconditionally.
  insert into import_mapping_profiles (org_id, name, column_mapping, cost_code_match_strategy, cost_code_prefix_length)
  select org_id, 'QB Standard', '{"item":"Item","vendor":"Name","amount":"Amount","date":"Date","memo":"Memo"}'::jsonb,
         'prefix', 4
  from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_profile_id;

  insert into test_fixture_ids values ('import_mapping_profile_qb_standard', v_profile_id);

  -- Captured now, while still authenticated as org A's own admin —
  -- profiles RLS means org_b_admin (used later in this section) cannot
  -- read admin's org_id at all, so this must be grabbed up front, the
  -- same way package_p1_auth_tests.sql captures 'org_b_id' while still
  -- authenticated as org_b_admin.
  insert into test_fixture_ids
  select 'org_a_id', org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  perform assert_that(
    (select count(*) from import_mapping_profiles where name = 'QB Standard') = 1,
    'org A admin can create a mapping profile'
  );
end $$;

-- A 'prefix' strategy without a prefix length must be rejected outright
-- (import_mapping_profiles_prefix_length_required) — a distinct
-- constraint from RLS, cheap to prove alongside the insert above.
select assert_raises(
  $sql$insert into import_mapping_profiles (org_id, name, column_mapping, cost_code_match_strategy)
       select org_id, 'Bad Strategy Profile', '{}'::jsonb, 'prefix'
       from profiles where id = (select value from test_fixture_ids where key = 'admin')$sql$,
  'a ''prefix'' cost_code_match_strategy without cost_code_prefix_length must be rejected'
);

reset role;
select clear_test_user();

-- Org B's admin must not see Org A's mapping profile at all.
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from import_mapping_profiles where name = 'QB Standard') = 0,
    'org B admin cannot see org A''s mapping profile'
  );
  perform assert_that(
    (select count(*) from import_mapping_profiles
      where id = (select value from test_fixture_ids where key = 'import_mapping_profile_qb_standard')) = 0,
    'org B admin cannot see org A''s mapping profile by id either'
  );
end $$;

-- Org B's admin must not be able to plant a profile under Org A's org_id
-- (the with check side of the same policy, not just the using side).
-- cost_code_match_strategy is set to 'manual_only' here specifically so
-- this insert's only possible failure reason is the RLS with-check, not
-- the unrelated prefix-length-required constraint exercised in SECTION 1
-- above.
select assert_raises(
  format(
    'insert into import_mapping_profiles (org_id, name, column_mapping, cost_code_match_strategy) values (%L, %L, %L::jsonb, ''manual_only'')',
    (select value from test_fixture_ids where key = 'org_a_id'),
    'Cross-Org Sneak',
    '{}'
  ),
  'org B admin cannot insert a mapping profile scoped to org A''s org_id'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 2 — single-original-per-cost-code guard: the trigger's
-- friendly error, plus confirmation the unique-index backstop exists.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

select assert_raises(
  format(
    'insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents) values (%L, %L, ''original'', 500000)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'a second original entry for the same cost code is rejected (cost_code_a already carries one via the ledger_1 fixture)'
);

-- The trigger above gives the friendly, non-race-condition error. The
-- migration also adds a unique partial index as the atomic backstop for
-- concurrent inserts (see schema/013's own comment) — a single-threaded
-- SQL test can't force the race, but it can and must confirm the index
-- itself actually exists, rather than just trusting the migration file.
do $$
begin
  perform assert_that(
    exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and tablename = 'budget_ledger'
        and indexname = 'budget_ledger_one_original_per_cost_code'
    ),
    'budget_ledger_one_original_per_cost_code index must exist as the atomic backstop for the single-original invariant'
  );
  perform assert_that(
    (select indexdef from pg_indexes
      where schemaname = 'public' and indexname = 'budget_ledger_one_original_per_cost_code') ilike 'create unique index%',
    'budget_ledger_one_original_per_cost_code must be a UNIQUE index, not just any index, to actually backstop the invariant'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 3 — budget_ledger_correction_requires_note.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

select assert_raises(
  format(
    'insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, note) values (%L, %L, ''correction'', 5000, null)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'a correction entry without a note is rejected'
);

do $$
declare v_correction_id uuid;
begin
  insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, note)
  values (
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a'),
    'correction', 5000, 'field measurement correction'
  )
  returning id into v_correction_id;

  perform assert_that(
    (select note from budget_ledger where id = v_correction_id) = 'field measurement correction',
    'a correction entry with a note is accepted and the note is stored as given'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 — import_batches / import_rows fixture setup, and the
-- confirm_import_batch() contract.
--
-- confirm_import_batch() is now implemented (schema/013, Task 10). The
-- plain table inserts below (an import_batches row and two import_rows)
-- also double as the fixtures SECTION 5 uses to prove audit visibility
-- on import_batches/import_rows. The confirm_import_batch() contract
-- assertions below were previously written correctly per the documented
-- contract but left commented out with a TODO(Task 10) marker, since the
-- function didn't exist yet; they are now reactivated and running for
-- real against the RPC's actual body.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_batch_id uuid;
  v_row_new_id uuid;
  v_row_unmatched_id uuid;
begin
  insert into import_batches (project_id, source_filename, report_type, mapping_profile_id, row_count, imported_by)
  values (
    (select value from test_fixture_ids where key = 'project_a'),
    'qb_item_detail_2026_08.csv',
    'Item Detail',
    (select value from test_fixture_ids where key = 'import_mapping_profile_qb_standard'),
    2,
    (select value from test_fixture_ids where key = 'admin')
  )
  returning id into v_batch_id;

  insert into test_fixture_ids values ('import_batch_a', v_batch_id);

  perform assert_that(
    (select status from import_batches where id = v_batch_id) = 'processing',
    'a newly inserted import_batches row defaults to status = processing'
  );

  -- __resolved_cost_code_id is included here (not part of the original
  -- Task 2 fixture) because confirm_import_batch() (Task 10) requires it
  -- to populate expenses.cost_code_id, which is NOT NULL and carries a
  -- composite FK to cost_codes(id, project_id) — this is exactly Task
  -- 9's settled normalized raw_data shape, resolved against the real
  -- cost_code_a fixture (which belongs to project_a, matching the batch).
  insert into import_rows (batch_id, row_number, raw_data, match_status)
  values (
    v_batch_id, 1,
    jsonb_build_object(
      'Item', '5070',
      'Name', 'ABC Cabinets',
      'Amount', '1200.00',
      'Date', '2026-08-01',
      'Memo', 'Kitchen cabinets',
      '__resolved_cost_code_id', (select value from test_fixture_ids where key = 'cost_code_a')
    ),
    'new'
  )
  returning id into v_row_new_id;
  insert into test_fixture_ids values ('import_row_new', v_row_new_id);

  insert into import_rows (batch_id, row_number, raw_data, match_status)
  values (
    v_batch_id, 2,
    '{"Item":"UNKNOWN-CODE","Name":"Mystery Vendor","Amount":"400.00","Date":"2026-08-02","Memo":"Unrecognized item"}'::jsonb,
    'unmatched'
  )
  returning id into v_row_unmatched_id;
  insert into test_fixture_ids values ('import_row_unmatched', v_row_unmatched_id);

  perform assert_that(
    (select count(*) from import_rows where batch_id = v_batch_id) = 2,
    'both import_rows fixture rows (new + unmatched) should be attached to the batch'
  );
end $$;

-- ---------------------------------------------------------------------
-- confirm_import_batch() contract (Task 10 — now implemented above in
-- schema/013_estimating_and_qb_import.sql). Confirms:
--   - it raises if any row is 'unmatched'/'error' and not excluded;
--   - on success, it creates pending expenses from 'new'/'changed' rows,
--     sets their import_batch_id, updates import_rows.matched_expense_id,
--     and sets import_batches.status = 'confirmed'.
-- ---------------------------------------------------------------------

select assert_raises(
  format('select confirm_import_batch(%L)', (select value from test_fixture_ids where key = 'import_batch_a')),
  'confirm_import_batch must raise while an unresolved unmatched row exists on the batch'
);

update import_rows set match_status = 'excluded'
  where id = (select value from test_fixture_ids where key = 'import_row_unmatched');

do $$
declare v_new_expense_count int;
begin
  perform confirm_import_batch((select value from test_fixture_ids where key = 'import_batch_a'));

  perform assert_that(
    (select status from import_batches where id = (select value from test_fixture_ids where key = 'import_batch_a')) = 'confirmed',
    'confirm_import_batch should set import_batches.status = confirmed once the unmatched row is excluded'
  );

  select count(*) into v_new_expense_count from expenses
    where import_batch_id = (select value from test_fixture_ids where key = 'import_batch_a')
      and financial_status = 'pending';
  perform assert_that(
    v_new_expense_count = 1,
    'confirm_import_batch should create exactly one pending expense for the single ''new'' row'
  );

  perform assert_that(
    (select matched_expense_id from import_rows where id = (select value from test_fixture_ids where key = 'import_row_new')) is not null,
    'confirm_import_batch should back-fill import_rows.matched_expense_id for the row it created an expense from'
  );

  perform assert_that(
    (select amount_cents from expenses
      where id = (select matched_expense_id from import_rows where id = (select value from test_fixture_ids where key = 'import_row_new'))) = 120000,
    'confirm_import_batch should convert raw_data->>''Amount'' (''1200.00'') to 120000 cents'
  );

  perform assert_that(
    (select cost_code_id from expenses
      where id = (select matched_expense_id from import_rows where id = (select value from test_fixture_ids where key = 'import_row_new')))
      = (select value from test_fixture_ids where key = 'cost_code_a'),
    'confirm_import_batch should read raw_data->>''__resolved_cost_code_id'' into the new expense''s cost_code_id'
  );

  perform assert_that(
    (select financial_status from expenses
      where id = (select matched_expense_id from import_rows where id = (select value from test_fixture_ids where key = 'import_row_new'))) = 'pending'
    and (select source_type from expenses
      where id = (select matched_expense_id from import_rows where id = (select value from test_fixture_ids where key = 'import_row_new'))) = 'quickbooks_import',
    'confirm_import_batch should create the expense as financial_status=pending, source_type=quickbooks_import'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 5 — audit visibility for the three new/altered tables: a real
-- insert produces a real, staff-readable audit_log row, queried
-- directly (not just "the trigger exists").
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  -- import_mapping_profiles: org-scoped (log_audit_no_project — NULL
  -- project_id), made readable by the audit_log_import_mapping_profiles_
  -- staff_select policy this task's schema/013 changes add (mirroring
  -- schema/012's audit_log_vendors_staff_select).
  perform assert_that(
    (select count(*) from audit_log
      where table_name = 'import_mapping_profiles'
        and record_id = (select value from test_fixture_ids where key = 'import_mapping_profile_qb_standard')
        and action = 'insert') = 1,
    'the import_mapping_profiles insert from SECTION 1 must produce exactly one staff-readable audit_log row'
  );

  -- import_batches: project-scoped, uses log_audit() directly — already
  -- covered by the pre-existing audit_log_staff_select policy.
  perform assert_that(
    (select count(*) from audit_log
      where table_name = 'import_batches'
        and record_id = (select value from test_fixture_ids where key = 'import_batch_a')
        and action = 'insert'
        and project_id = (select value from test_fixture_ids where key = 'project_a')) = 1,
    'the import_batches insert from SECTION 4 must produce exactly one staff-readable, project-scoped audit_log row'
  );

  -- import_rows: no direct project_id column — audited via
  -- log_audit_via_batch(), which resolves project_id through
  -- import_batches so the same audit_log_staff_select policy applies.
  perform assert_that(
    (select count(*) from audit_log
      where table_name = 'import_rows'
        and record_id = (select value from test_fixture_ids where key = 'import_row_new')
        and action = 'insert'
        and project_id = (select value from test_fixture_ids where key = 'project_a')) = 1,
    'the import_rows insert from SECTION 4 must produce exactly one staff-readable, project-scoped audit_log row'
  );
end $$;

reset role;
select clear_test_user();

-- Cross-org isolation on the audit trail itself: Org B's admin must not
-- see Org A's import_mapping_profiles audit row (the one genuinely new
-- RLS policy this task's schema changes add).
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from audit_log
      where table_name = 'import_mapping_profiles'
        and record_id = (select value from test_fixture_ids where key = 'import_mapping_profile_qb_standard')) = 0,
    'Org B admin must NOT see Org A''s import_mapping_profiles audit_log row'
  );
end $$;

reset role;
select clear_test_user();
