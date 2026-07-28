-- =====================================================================
-- Stone Column Portal — P2.1 (Financial Master Data & Project Setup)
-- SQL/RLS test suite.
--
-- Runs after schema/001-012 (via scripts/db/run-sql-tests.mjs) against
-- a fresh PGlite instance, reusing the set_test_user()/clear_test_user()/
-- assert_that()/assert_raises()/test_fixture_ids helpers and fixtures
-- already established in tests/sql/package1_tests.sql and
-- tests/sql/package_p1_auth_tests.sql (both run earlier in the same
-- PGlite session — see scripts/db/run-sql-tests.mjs's FILES list).
--
-- Reused fixtures: 'admin', 'staff_a', 'client_a', 'client_b', 'vendor_a',
-- 'project_a', 'project_b', 'org_b_admin', 'project_org_b'.
-- =====================================================================

-- =====================================================================
-- SECTION 1 — templates are global reference data, readable by any
-- authenticated user, matching the exact workbook counts (7 divisions,
-- 113 cost codes) verified in docs/production-build/WORKBOOK-GAP-ANALYSIS.md.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_division_count int; v_code_count int;
begin
  select count(*) into v_division_count from division_templates;
  perform assert_that(v_division_count = 7, 'division_templates should contain exactly the 7 workbook divisions');

  select count(*) into v_code_count from cost_code_templates;
  perform assert_that(v_code_count = 113, 'cost_code_templates should contain exactly the 113 workbook cost codes');

  perform assert_that(
    (select billable from cost_code_templates where code = '7082') = false,
    'template 7082 (Sales Commission) must be billable=false, reproduced exactly from the workbook'
  );
  perform assert_that(
    (select include_in_estimate from cost_code_templates where code = '7082') = true,
    'template 7082 must still be include_in_estimate=true (the flagged Include=Yes/Billable=No combination)'
  );
  perform assert_that(
    (select billable from cost_code_templates where code = '9999') = false,
    'template 9999 (Transfer WIP to CGS) must be billable=false, reproduced exactly from the workbook'
  );
  perform assert_that(
    (select activity_name from cost_code_templates where code = '5070') = 'Cabinets - Sub',
    'template 5070 activity name must match the workbook exactly (the example used in the approved request)'
  );
end $$;

-- Templates are read-only via RLS even for staff/admin.
select assert_raises(
  $sql$insert into division_templates (name, sort_order) values ('Made Up Division', 999)$sql$,
  'authenticated users (even none granted insert) cannot write division_templates — no insert policy, and INSERT is revoked outright'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 2 — apply_standard_cost_code_template(): staff-only, applies
-- the full template once, rejects being re-applied, rejects for a
-- non-staff caller.
-- =====================================================================

-- A client must not be able to apply the template to their own project.
select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

select assert_raises(
  format('select apply_standard_cost_code_template(%L)', (select value from test_fixture_ids where key = 'project_a')),
  'a client must not be able to apply the standard cost-code template (staff-only)'
);

reset role;
select clear_test_user();

-- Staff (admin) applies the template to project_a for real.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform apply_standard_cost_code_template((select value from test_fixture_ids where key = 'project_a'));
end $$;

do $$
declare
  v_division_count int;
  v_code_count int;
  v_cabinets_id uuid;
  v_cabinets_division text;
begin
  select count(*) into v_division_count from divisions
    where project_id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(v_division_count = 7, 'project_a should now have exactly 7 divisions');

  -- project_a already had one hand-created cost code ('Framing', from
  -- package1_tests.sql) before the template was applied — the template
  -- adds 113 more, for 114 total, proving apply_standard_cost_code_template
  -- coexists with pre-existing ad hoc cost codes rather than requiring
  -- an empty cost_codes table.
  select count(*) into v_code_count from cost_codes
    where project_id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(v_code_count = 114, 'project_a should have 113 templated + 1 pre-existing (cost_code_a) = 114 cost codes');

  select cc.id, d.name into v_cabinets_id, v_cabinets_division
  from cost_codes cc join divisions d on d.id = cc.division_id
  where cc.project_id = (select value from test_fixture_ids where key = 'project_a') and cc.code = '5070';

  perform assert_that(v_cabinets_id is not null, 'templated cost code 5070 should exist on project_a');
  perform assert_that(v_cabinets_division = 'Interior Finishes', 'templated cost code 5070 should be linked to the Interior Finishes division');

  perform assert_that(
    (select billable from cost_codes where project_id = (select value from test_fixture_ids where key = 'project_a') and code = '9999') = false,
    'templated cost code 9999 should carry billable=false onto the real project row'
  );

  insert into test_fixture_ids select 'cost_code_5070', v_cabinets_id;
end $$;

-- Re-applying to the same project must be rejected outright (no merge/
-- upsert semantics — see the function's own comment in schema/012).
select assert_raises(
  format('select apply_standard_cost_code_template(%L)', (select value from test_fixture_ids where key = 'project_a')),
  'apply_standard_cost_code_template must reject being re-applied to a project that already has divisions'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 3 — divisions / cost_codes RLS (client read, cross-project isolation)
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from divisions
    where project_id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(v_count = 7, 'Client A should see all 7 divisions on their own project');

  select count(*) into v_count from divisions
    where project_id = (select value from test_fixture_ids where key = 'project_b');
  perform assert_that(v_count = 0, 'Client A must NOT see project_b''s divisions');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 — vendors: org-scoped master data, staff-only, isolated
-- across orgs (reusing org_b_admin from package_p1_auth_tests.sql).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_vendor_id uuid;
begin
  insert into vendors (org_id, name, contact_name, email, phone)
  select org_id, 'ABC Plumbing', 'Pat Vendor', 'pat@abcplumbing.example', '555-0100'
  from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_vendor_id;

  insert into test_fixture_ids values ('vendor_abc_plumbing', v_vendor_id);

  perform assert_that(
    (select count(*) from vendors where id = v_vendor_id) = 1,
    'admin should be able to create a vendor in their own org'
  );
end $$;

select assert_raises(
  format('delete from vendors where id = %L', (select value from test_fixture_ids where key = 'vendor_abc_plumbing')),
  'vendors must never be hard-deleted, even by admin — archive via is_archived instead (vendors_no_delete)'
);

reset role;
select clear_test_user();

-- A client must see zero vendors (no client policy on this table).
select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from vendors;
  perform assert_that(v_count = 0, 'client should see zero vendors — internal record-keeping only, no client policy exists');
end $$;

reset role;
select clear_test_user();

-- Org B's admin must not see Org A's vendor at all.
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from vendors
    where id = (select value from test_fixture_ids where key = 'vendor_abc_plumbing');
  perform assert_that(v_count = 0, 'Org B admin must NOT see Org A''s vendor');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 5 — project_financial_settings: staff-only, deposit basis-
-- points range enforced, numbering counters default correctly.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  insert into project_financial_settings (project_id, deposit_basis_points, estimate_number_prefix, invoice_number_prefix)
  values ((select value from test_fixture_ids where key = 'project_a'), 4000, 'EST-', 'INV-');

  perform assert_that(
    (select next_estimate_number from project_financial_settings where project_id = (select value from test_fixture_ids where key = 'project_a')) = 1,
    'next_estimate_number should default to 1, matching the workbook''s starting Estimate # convention'
  );
  perform assert_that(
    (select next_draw_number from project_financial_settings where project_id = (select value from test_fixture_ids where key = 'project_a')) = 1,
    'next_draw_number should default to 1, matching the workbook''s Current Draw Number field'
  );
end $$;

select assert_raises(
  format('insert into project_financial_settings (project_id, deposit_basis_points) values (%L, 10001)', (select value from test_fixture_ids where key = 'project_b')),
  'deposit_basis_points must be rejected above 10000 (100%) — project_financial_settings_deposit_range'
);

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from project_financial_settings;
  perform assert_that(v_count = 0, 'client should see zero rows in project_financial_settings (staff-only)');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 6 — project_clients: staff manages, the project's own client
-- can read their own project's contact rows, not another project's.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_contact_id uuid;
begin
  insert into project_clients (project_id, full_name, email, phone, is_primary)
  values ((select value from test_fixture_ids where key = 'project_a'), 'Jamie Homeowner', 'jamie@example.com', '555-0200', true)
  returning id into v_contact_id;

  insert into test_fixture_ids values ('project_a_client_contact', v_contact_id);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from project_clients
    where project_id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(v_count = 1, 'Client A should see the one billing contact on their own project');

  select count(*) into v_count from project_clients
    where project_id = (select value from test_fixture_ids where key = 'project_b');
  perform assert_that(v_count = 0, 'Client A must NOT see project_b''s billing contact rows');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 7 — credit_ledger: append-only, entry_type constrained,
-- reversal referencing works, staff-only visibility.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_deposit_id uuid;
begin
  insert into credit_ledger (project_id, entry_type, amount_cents, note)
  values ((select value from test_fixture_ids where key = 'project_a'), 'deposit_received', 500000, 'Initial deposit')
  returning id into v_deposit_id;

  insert into test_fixture_ids values ('credit_ledger_deposit', v_deposit_id);
end $$;

select assert_raises(
  $sql$insert into credit_ledger (project_id, entry_type, amount_cents) values ((select value from test_fixture_ids where key = 'project_a'), 'not_a_real_type', 100)$sql$,
  'credit_ledger entry_type must be constrained to the known set (credit_ledger_entry_type_valid)'
);

select assert_raises(
  format('update credit_ledger set amount_cents = 1 where id = %L', (select value from test_fixture_ids where key = 'credit_ledger_deposit')),
  'credit_ledger must be append-only — UPDATE is rejected even for staff/admin'
);

select assert_raises(
  format('delete from credit_ledger where id = %L', (select value from test_fixture_ids where key = 'credit_ledger_deposit')),
  'credit_ledger must be append-only — DELETE is rejected even for staff/admin'
);

do $$
declare v_reversal_id uuid;
begin
  insert into credit_ledger (project_id, entry_type, amount_cents, reverses_entry_id, is_adjustment, note)
  values (
    (select value from test_fixture_ids where key = 'project_a'), 'reversal_adjustment', -500000,
    (select value from test_fixture_ids where key = 'credit_ledger_deposit'), false, 'Correcting a mis-keyed deposit'
  )
  returning id into v_reversal_id;

  perform assert_that(v_reversal_id is not null, 'a reversal_adjustment row referencing the original deposit should insert successfully');
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'client_a'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from credit_ledger;
  perform assert_that(v_count = 0, 'client should see zero credit_ledger rows (staff-only; may carry internal notes)');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 8 — orgs billing identity: admin can update their own org;
-- staff (non-admin) cannot; a different org's admin cannot.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update orgs set payable_to_name = 'Stone Column Properties, LLC.', billing_phone = '404-867-7890'
  where id = (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin'));

  perform assert_that(
    (select payable_to_name from orgs where id = (select org_id from profiles where id = (select value from test_fixture_ids where key = 'admin'))) = 'Stone Column Properties, LLC.',
    'org admin should be able to set their own org''s billing identity'
  );
end $$;

reset role;
select clear_test_user();

-- staff (role='staff', not 'admin') must NOT be able to update org
-- billing identity — RLS silently blocks (0 rows), same pattern as the
-- profiles self-escalation test in package1_tests.sql Section 3b.
select set_test_user((select value from test_fixture_ids where key = 'staff_a'));
set local role authenticated;

do $$
declare v_before text; v_after text;
begin
  select billing_phone into v_before from orgs where id = (select org_id from profiles where id = (select value from test_fixture_ids where key = 'staff_a'));
  update orgs set billing_phone = '555-9999' where id = (select org_id from profiles where id = (select value from test_fixture_ids where key = 'staff_a'));
  select billing_phone into v_after from orgs where id = (select org_id from profiles where id = (select value from test_fixture_ids where key = 'staff_a'));
  perform assert_that(v_before = v_after, 'staff (not admin) must NOT be able to update org billing identity');
end $$;

reset role;
select clear_test_user();

-- Org B's admin must not be able to update Org A's billing identity.
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
declare v_before text; v_after text;
declare v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');
  select billing_phone into v_before from orgs where id = v_org_a_id;
  update orgs set billing_phone = '000-000-0000' where id = v_org_a_id;
  select billing_phone into v_after from orgs where id = v_org_a_id;
  perform assert_that(v_before = v_after, 'Org B admin must NOT be able to update Org A''s billing identity');
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 9 — audit trail: confirm the new tables' inserts are actually
-- captured, readable by staff, for the same project — not just that the
-- trigger exists.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from audit_log
    where table_name = 'divisions' and project_id = (select value from test_fixture_ids where key = 'project_a');
  perform assert_that(v_count = 7, 'audit_log should have one insert row per division created by apply_standard_cost_code_template');

  select count(*) into v_count from audit_log
    where table_name = 'vendors' and record_id = (select value from test_fixture_ids where key = 'vendor_abc_plumbing');
  perform assert_that(v_count = 1, 'audit_log should have captured the vendor insert (org-scoped, project_id IS NULL)');
end $$;

reset role;
select clear_test_user();
