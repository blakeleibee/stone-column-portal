-- =====================================================================
-- Stone Column Portal — P5.1 vendor-directory FIXES SQL/RLS test suite,
-- covering schema/021_vendor_directory_fixes.sql. Runs after
-- package_p5_1_vendor_directory_tests.sql (see
-- scripts/db/run-sql-tests.mjs's FILES list), reusing its 'vendor_x'
-- fixture directly.
--
-- Only Fix 1 (the concurrent primary-contact protection) is a schema-
-- level change; Fix 2 (stale headline-contact mirror) and Fix 3
-- (subcontract history misattribution) are both service-layer-only and
-- are covered by apps/web/test/vendor_service_unit.ts instead.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_contact_a uuid;
begin
  -- vendor_x_contact (from package_p5_1_vendor_directory_tests.sql) is
  -- already a non-archived primary contact for vendor_x. Inserting a
  -- SECOND non-archived primary contact for the same vendor must be
  -- rejected by vendor_contacts_one_primary_per_vendor.
  perform assert_that(
    (select count(*) from vendor_contacts
       where vendor_id = (select value from test_fixture_ids where key = 'vendor_x')
         and is_primary_bidding_contact and not is_archived) = 1,
    'exactly one non-archived primary contact exists for vendor_x before this test'
  );
end $$;

select assert_raises(
  format(
    'insert into vendor_contacts (vendor_id, name, is_primary_bidding_contact) values (%L, ''Second Primary Contact'', true)',
    (select value from test_fixture_ids where key = 'vendor_x')
  ),
  'a second non-archived primary contact for the same vendor must be rejected by vendor_contacts_one_primary_per_vendor'
);

-- A second primary contact for a DIFFERENT vendor is unaffected (the
-- index is scoped per vendor_id, not global).
do $$
declare
  v_contact_z uuid;
begin
  insert into vendor_contacts (vendor_id, name, is_primary_bidding_contact)
  values ((select value from test_fixture_ids where key = 'vendor_z'), 'Vendor Z Primary Contact', true)
  returning id into v_contact_z;
  insert into test_fixture_ids values ('vendor_z_contact', v_contact_z);

  perform assert_that(
    (select count(*) from vendor_contacts where id = v_contact_z) = 1,
    'a primary contact on a different vendor (vendor_z) is unaffected by vendor_x''s unique index entry'
  );
end $$;

-- An ARCHIVED contact that still carries a stale is_primary_bidding_contact
-- = true flag must not block a new live primary contact from being
-- created for the same vendor (the partial index's "not is_archived"
-- predicate excludes it).
do $$
declare
  v_archived_primary uuid;
  v_new_primary uuid;
begin
  insert into vendor_contacts (vendor_id, name, is_primary_bidding_contact, is_archived)
  values ((select value from test_fixture_ids where key = 'vendor_y'), 'Stale Archived Primary', true, true)
  returning id into v_archived_primary;

  insert into vendor_contacts (vendor_id, name, is_primary_bidding_contact)
  values ((select value from test_fixture_ids where key = 'vendor_y'), 'Fresh Live Primary', true)
  returning id into v_new_primary;

  perform assert_that(
    (select count(*) from vendor_contacts where id = v_new_primary) = 1,
    'a new live primary contact can be created even when an archived row on the same vendor still carries is_primary_bidding_contact = true'
  );
end $$;

reset role;
select clear_test_user();
