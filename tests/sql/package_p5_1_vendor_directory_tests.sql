-- =====================================================================
-- Stone Column Portal — P5.1 (Vendor Directory & Onboarding) SQL/RLS
-- test suite, covering schema/020_vendor_directory.sql. Runs after
-- every prior migration and every prior SQL test file (see
-- scripts/db/run-sql-tests.mjs's FILES list) — in particular after
-- package_p3_project_staff_access_tests.sql, whose 'accounting_a'/
-- 'pm_a'/'super_a' staff fixtures (staff_function =
-- accounting/project_manager/superintendent, all org A) this file
-- reuses directly rather than re-creating equivalent fixtures. Also
-- reuses 'admin' (org A admin) and 'org_b_admin' (org B admin, a
-- different org entirely) from package1_tests.sql /
-- package_p1_auth_tests.sql.
-- =====================================================================

-- =====================================================================
-- SECTION 1 — vendors: new columns, merge invariants (DB-enforced, not
-- just service-layer).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_vendor_x uuid;
  v_vendor_y uuid;
  v_vendor_z uuid;
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  insert into vendors (org_id, name, legal_name, website, trades, service_area, preferred_communication_method, payment_terms)
  values (v_org_a_id, 'Vendor X Plumbing', 'Vendor X Plumbing LLC', 'https://vendorx.example', array['plumbing'], 'Metro area', 'email', 'Net 30')
  returning id into v_vendor_x;
  insert into test_fixture_ids values ('vendor_x', v_vendor_x);

  insert into vendors (org_id, name) values (v_org_a_id, 'Vendor Y Plumbing (duplicate)') returning id into v_vendor_y;
  insert into test_fixture_ids values ('vendor_y', v_vendor_y);

  insert into vendors (org_id, name) values (v_org_a_id, 'Vendor Z Electric') returning id into v_vendor_z;
  insert into test_fixture_ids values ('vendor_z', v_vendor_z);

  perform assert_that(
    (select trades from vendors where id = v_vendor_x) = array['plumbing'],
    'vendors.trades round-trips as a text[] column'
  );
end $$;

-- Merged-but-not-archived must be rejected at the DB level (the
-- vendors_merged_implies_archived CHECK constraint), independent of
-- whatever the service layer does — a direct write that tries to set
-- merged_into_vendor_id without is_archived=true is exactly the kind of
-- inconsistent state the constraint exists to make impossible.
select assert_raises(
  format(
    'update vendors set merged_into_vendor_id = %L where id = %L',
    (select value from test_fixture_ids where key = 'vendor_z'),
    (select value from test_fixture_ids where key = 'vendor_y')
  ),
  'merging a vendor without also archiving it must be rejected by vendors_merged_implies_archived'
);

-- A correctly-formed merge (merged_into_vendor_id + is_archived together)
-- succeeds.
do $$
begin
  update vendors
    set merged_into_vendor_id = (select value from test_fixture_ids where key = 'vendor_x'),
        is_archived = true
    where id = (select value from test_fixture_ids where key = 'vendor_y');

  perform assert_that(
    (select merged_into_vendor_id from vendors where id = (select value from test_fixture_ids where key = 'vendor_y'))
      = (select value from test_fixture_ids where key = 'vendor_x'),
    'a correctly-formed merge (merged_into_vendor_id + is_archived together) succeeds'
  );
end $$;

-- No self-merge.
select assert_raises(
  format(
    'update vendors set merged_into_vendor_id = %L, is_archived = true where id = %L',
    (select value from test_fixture_ids where key = 'vendor_z'),
    (select value from test_fixture_ids where key = 'vendor_z')
  ),
  'a vendor cannot be merged into itself'
);

-- No merge chains: vendor_z attempting to merge into vendor_y (which is
-- ALREADY merged into vendor_x) must be rejected — the design requires
-- resolving to the ultimate survivor in one hop only.
select assert_raises(
  format(
    'update vendors set merged_into_vendor_id = %L, is_archived = true where id = %L',
    (select value from test_fixture_ids where key = 'vendor_y'),
    (select value from test_fixture_ids where key = 'vendor_z')
  ),
  'merging into an already-merged vendor (a merge chain) must be rejected'
);

-- Unmerge (clearing both columns together) reverses cleanly and is not
-- re-validated by the no-chain trigger (which only fires when
-- merged_into_vendor_id is being newly set, not cleared).
do $$
begin
  update vendors set merged_into_vendor_id = null, is_archived = false
    where id = (select value from test_fixture_ids where key = 'vendor_y');

  perform assert_that(
    (select merged_into_vendor_id from vendors where id = (select value from test_fixture_ids where key = 'vendor_y')) is null,
    'unmerge clears merged_into_vendor_id'
  );
  perform assert_that(
    (select is_archived from vendors where id = (select value from test_fixture_ids where key = 'vendor_y')) = false,
    'unmerge clears is_archived'
  );
end $$;

reset role;
select clear_test_user();

-- Cross-org merge target must be rejected (org-mismatch branch of
-- enforce_vendor_merge_no_chain) — a vendor in org B, merged "into" org
-- A's vendor_x.
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
declare
  v_vendor_org_b uuid;
  v_org_b_id uuid;
begin
  select org_id into v_org_b_id from profiles where id = (select value from test_fixture_ids where key = 'org_b_admin');
  insert into vendors (org_id, name) values (v_org_b_id, 'Org B Vendor') returning id into v_vendor_org_b;
  insert into test_fixture_ids values ('vendor_org_b', v_vendor_org_b);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- org_b's vendor is invisible to org A's admin (existing vendors RLS,
-- unchanged) -- the merge-target lookup inside
-- enforce_vendor_merge_no_chain runs SECURITY DEFINER so it can still
-- resolve the org mismatch even though the row itself is outside RLS
-- visibility; either way the write must fail.
select assert_raises(
  format(
    'update vendors set merged_into_vendor_id = %L, is_archived = true where id = %L',
    (select value from test_fixture_ids where key = 'vendor_org_b'),
    (select value from test_fixture_ids where key = 'vendor_z')
  ),
  'merging into a vendor from a different org must be rejected'
);

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 2 — vendor_contacts: staff-wide access, delete-blocked,
-- cross-org isolation.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_contact_id uuid;
begin
  insert into vendor_contacts (vendor_id, name, title, email, is_primary_bidding_contact)
  values ((select value from test_fixture_ids where key = 'vendor_x'), 'Pat Plumber', 'Owner', 'pat@vendorx.example', true)
  returning id into v_contact_id;
  insert into test_fixture_ids values ('vendor_x_contact', v_contact_id);

  perform assert_that((select count(*) from vendor_contacts where id = v_contact_id) = 1, 'org A admin can create a vendor contact');
end $$;

select assert_raises(
  format('delete from vendor_contacts where id = %L', (select value from test_fixture_ids where key = 'vendor_x_contact')),
  'vendor_contacts delete must be rejected by reject_delete()'
);

reset role;
select clear_test_user();

-- A general org-A staff member (pm_a, staff_function = project_manager
-- -- NOT accounting) can read/manage vendor_contacts -- this table has
-- no category-based restriction, unlike vendor_documents' w9 rows below.
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from vendor_contacts where id = (select value from test_fixture_ids where key = 'vendor_x_contact')) = 1,
    'ordinary org A staff (pm_a, not accounting) can read a vendor contact -- no category restriction on this table'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from vendor_contacts where id = (select value from test_fixture_ids where key = 'vendor_x_contact')) = 0,
    'org B admin cannot see org A''s vendor contact'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 3 — vendor_documents: the category-conditional W-9 gate.
-- Every assertion in this section is the exact scenario
-- P5-EXTENSION-PACKAGES-DESIGN.md Section 13/the implementation brief
-- requires direct SQL-level proof for.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_w9_id uuid;
  v_coi_id uuid;
begin
  insert into vendor_documents (vendor_id, org_id, category, status, storage_key)
  select
    (select value from test_fixture_ids where key = 'vendor_x'),
    org_id,
    'w9',
    'received',
    'vendors/vendor-x/w9-v1.pdf'
  from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_w9_id;
  insert into test_fixture_ids values ('vendor_x_w9', v_w9_id);

  insert into vendor_documents (vendor_id, org_id, category, status, storage_key)
  select
    (select value from test_fixture_ids where key = 'vendor_x'),
    org_id,
    'certificate_of_insurance',
    'verified',
    'vendors/vendor-x/coi-v1.pdf'
  from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_coi_id;
  insert into test_fixture_ids values ('vendor_x_coi', v_coi_id);

  perform assert_that((select count(*) from vendor_documents where id = v_w9_id) = 1, 'org A admin (implicitly admin => accounting-or-admin gate) can insert a w9 row');
  perform assert_that((select count(*) from vendor_documents where id = v_coi_id) = 1, 'org A admin can insert a certificate_of_insurance row');
end $$;

-- org_id must mirror the parent vendor's own org — inserting a
-- deliberately mismatched org_id must be rejected by
-- enforce_vendor_document_org_match, independent of any RLS check.
select assert_raises(
  format(
    'insert into vendor_documents (vendor_id, org_id, category, status) values (%L, %L, ''license'', ''missing'')',
    (select value from test_fixture_ids where key = 'vendor_x'),
    (select org_id from profiles where id = (select value from test_fixture_ids where key = 'org_b_admin'))
  ),
  'vendor_documents.org_id mismatched against its vendor_id''s real org must be rejected'
);

-- Status vocabulary: the CHECK constraint enforces exactly the six
-- values the owner specified, nothing else.
select assert_raises(
  format(
    'insert into vendor_documents (vendor_id, org_id, category, status) select %L, org_id, ''license'', ''bogus_status'' from profiles where id = %L',
    (select value from test_fixture_ids where key = 'vendor_x'),
    (select value from test_fixture_ids where key = 'admin')
  ),
  'an out-of-vocabulary status value must be rejected by the CHECK constraint'
);

select assert_raises(
  format('delete from vendor_documents where id = %L', (select value from test_fixture_ids where key = 'vendor_x_w9')),
  'vendor_documents delete must be rejected by reject_delete()'
);

reset role;
select clear_test_user();

-- Non-accounting, non-admin staff (pm_a): can read the COI row, CANNOT
-- read the w9 row.
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from vendor_documents where id = (select value from test_fixture_ids where key = 'vendor_x_coi')) = 1,
    'non-accounting staff (pm_a) CAN read a certificate_of_insurance vendor_documents row'
  );
  perform assert_that(
    (select count(*) from vendor_documents where id = (select value from test_fixture_ids where key = 'vendor_x_w9')) = 0,
    'non-accounting, non-admin staff (pm_a) CANNOT read a category=''w9'' vendor_documents row'
  );
end $$;

-- Non-accounting staff also cannot INSERT a w9 row.
select assert_raises(
  format(
    'insert into vendor_documents (vendor_id, org_id, category, status) select %L, org_id, ''w9'', ''received'' from profiles where id = %L',
    (select value from test_fixture_ids where key = 'vendor_x'),
    (select value from test_fixture_ids where key = 'pm_a')
  ),
  'non-accounting, non-admin staff cannot INSERT a category=''w9'' row'
);

reset role;
select clear_test_user();

-- Accounting-role staff (accounting_a, staff_function = 'accounting',
-- role = 'staff' -- NOT admin) CAN read the w9 row: proves the gate is
-- staff_function-based, not merely role='admin'-based.
select set_test_user((select value from test_fixture_ids where key = 'accounting_a'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from vendor_documents where id = (select value from test_fixture_ids where key = 'vendor_x_w9')) = 1,
    'accounting-role staff (accounting_a) CAN read a category=''w9'' vendor_documents row'
  );
end $$;

reset role;
select clear_test_user();

-- Staff from a different org entirely (org_b_admin) cannot read either
-- category, regardless of role.
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from vendor_documents where id = (select value from test_fixture_ids where key = 'vendor_x_coi')) = 0,
    'a staff member from a different org cannot read a certificate_of_insurance row'
  );
  perform assert_that(
    (select count(*) from vendor_documents where id = (select value from test_fixture_ids where key = 'vendor_x_w9')) = 0,
    'a staff member from a different org cannot read a w9 row either'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 4 — vendor_document_access_log: accounting/admin-only SELECT,
-- self-attribution anti-spoofing (trigger, not just RLS WITH CHECK --
-- same defense-in-depth precedent as vendor_members.revoked_by /
-- bid_questions.recorded_by, schema/015).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'accounting_a'));
set local role authenticated;

do $$
declare
  v_log_id uuid;
begin
  insert into vendor_document_access_log (vendor_document_id, accessed_by, action)
  values (
    (select value from test_fixture_ids where key = 'vendor_x_w9'),
    (select value from test_fixture_ids where key = 'accounting_a'),
    'downloaded'
  )
  returning id into v_log_id;
  insert into test_fixture_ids values ('vendor_x_w9_access_log_1', v_log_id);

  perform assert_that((select count(*) from vendor_document_access_log where id = v_log_id) = 1, 'accounting staff can insert a self-attributed access log row');
end $$;

-- Spoofing accessed_by (pretending the download was someone else's)
-- must be rejected by the trigger, not merely by RLS.
select assert_raises(
  format(
    'insert into vendor_document_access_log (vendor_document_id, accessed_by, action) values (%L, %L, ''downloaded'')',
    (select value from test_fixture_ids where key = 'vendor_x_w9'),
    (select value from test_fixture_ids where key = 'admin')
  ),
  'vendor_document_access_log.accessed_by must equal the inserting session''s own auth.uid() -- spoofing another user must be rejected'
);

reset role;
select clear_test_user();

-- Non-accounting staff cannot read the access log (even for a document
-- they themselves are denied from reading in the first place).
select set_test_user((select value from test_fixture_ids where key = 'pm_a'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from vendor_document_access_log where id = (select value from test_fixture_ids where key = 'vendor_x_w9_access_log_1')) = 0,
    'non-accounting staff cannot read vendor_document_access_log rows'
  );
end $$;

reset role;
select clear_test_user();

-- Accounting staff CAN read the log.
select set_test_user((select value from test_fixture_ids where key = 'accounting_a'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from vendor_document_access_log where id = (select value from test_fixture_ids where key = 'vendor_x_w9_access_log_1')) = 1,
    'accounting staff can read vendor_document_access_log rows'
  );
end $$;

reset role;
select clear_test_user();

-- =====================================================================
-- SECTION 5 — vendors delete-block (the third table this migration
-- adds delete-blocking behavior around, alongside vendor_contacts/
-- vendor_documents above -- vendors' own reject_delete trigger
-- predates this migration, schema/012, but re-confirmed here as part
-- of this package's required verification list).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

select assert_raises(
  format('delete from vendors where id = %L', (select value from test_fixture_ids where key = 'vendor_z')),
  'vendors delete must be rejected by reject_delete()'
);

reset role;
select clear_test_user();
