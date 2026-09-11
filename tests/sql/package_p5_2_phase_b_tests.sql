-- =====================================================================
-- Stone Column Portal — P5.2 Phase B (bid package assembly fields +
-- document control) SQL/RLS test suite, covering
-- schema/024_bid_package_assembly_fields.sql and
-- schema/025_bid_package_documents.sql. Runs after schema/001-025 and
-- after every earlier test file, including
-- package_p5_2_vendor_bid_access_phase_a_tests.sql — this file
-- deliberately REUSES that file's own vendor/package fixtures
-- ('p522_vendor_gamma'/'p522_bid_package_gamma'/'p522_gamma_user',
-- 'p522_vendor_delta'/'p522_bid_package_delta'/'p522_delta_user',
-- 'p522_vendor_epsilon'/'p522_epsilon_user') rather than recreating an
-- equivalent set from scratch, so this suite is real proof the new
-- Phase B surface composes correctly with the exact vendor-access model
-- Phase A already fixed and proved, not a parallel fixture universe
-- that happens to also pass.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1 — bid package assembly fields + the new
-- profiles_vendor_read_bid_package_contact policy.
-- ---------------------------------------------------------------------

-- A second org-A staff profile, distinct from 'admin', used as gamma's
-- designated point of contact so this suite can prove isolation between
-- two DIFFERENT contacts on two DIFFERENT packages (not merely "a
-- vendor can read some profile"). Table-owner insert, same reasoning as
-- package_p5_2_vendor_bid_access_phase_a_tests.sql's own profile
-- fixtures: profiles has no insert policy at all.
do $$
declare
  v_contact_2_user uuid := gen_random_uuid();
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  insert into auth.users (id) values (v_contact_2_user);
  insert into profiles (id, org_id, role, full_name, email, staff_function)
  values (v_contact_2_user, v_org_a_id, 'staff', 'Gamma Package Contact', 'gamma.contact@stonecolumn.example', 'general');

  insert into test_fixture_ids values ('p52b_contact_staff_2', v_contact_2_user);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update bid_packages
  set inclusions = 'All labor, material, and equipment for full roof replacement.',
      exclusions = 'Permit fees, dumpster rental.',
      bid_instructions = 'Submit a single lump-sum price by the due date.',
      stone_column_contact_id = (select value from test_fixture_ids where key = 'p52b_contact_staff_2')
  where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma');

  update bid_packages
  set stone_column_contact_id = (select value from test_fixture_ids where key = 'admin')
  where id = (select value from test_fixture_ids where key = 'p522_bid_package_delta');

  perform assert_that(
    (select inclusions from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma'))
      = 'All labor, material, and equipment for full roof replacement.',
    'staff can set/read the new assembly-field columns directly'
  );
end $$;

reset role;
select clear_test_user();

-- gamma vendor: can read its OWN package's assembly fields (row-level
-- RLS already covers every column) and can resolve its OWN package's
-- contact profile — but NOT delta's contact.
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select inclusions from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma'))
      = 'All labor, material, and equipment for full roof replacement.',
    'invited vendor can read the new assembly-field columns on its own invited package'
  );
  perform assert_that(
    (select count(*) from profiles where id = (select value from test_fixture_ids where key = 'p52b_contact_staff_2')) = 1,
    'profiles_vendor_read_bid_package_contact: gamma vendor can resolve its OWN package''s designated contact to a real profile row'
  );
  perform assert_that(
    (select count(*) from profiles where id = (select value from test_fixture_ids where key = 'admin')) = 0,
    'profiles_vendor_read_bid_package_contact: gamma vendor CANNOT resolve delta''s contact (admin) — scoped per invited package, not a blanket staff-profile grant'
  );
end $$;

reset role;
select clear_test_user();

-- delta vendor: mirror image.
select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from profiles where id = (select value from test_fixture_ids where key = 'admin')) = 1,
    'profiles_vendor_read_bid_package_contact: delta vendor can resolve its own package''s contact (admin)'
  );
  perform assert_that(
    (select count(*) from profiles where id = (select value from test_fixture_ids where key = 'p52b_contact_staff_2')) = 0,
    'profiles_vendor_read_bid_package_contact: delta vendor cannot resolve gamma''s contact'
  );
end $$;

reset role;
select clear_test_user();

-- epsilon vendor (never invited to anything in this project): neither
-- contact is resolvable.
select set_test_user((select value from test_fixture_ids where key = 'p522_epsilon_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from profiles where id in (
      (select value from test_fixture_ids where key = 'admin'),
      (select value from test_fixture_ids where key = 'p52b_contact_staff_2')
    )) = 0,
    'profiles_vendor_read_bid_package_contact: a vendor invited to nothing resolves neither contact'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 2 — bid_package_documents + documents' new vendor-read policy
-- + versioning/immutability.
-- ---------------------------------------------------------------------

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_doc_plans uuid;
  v_doc_internal uuid;
  v_doc_delta uuid;
  v_project_a uuid;
begin
  select value into v_project_a from test_fixture_ids where key = 'project_a';

  insert into documents (project_id, uploaded_by, file_name, mime_type, size_bytes, storage_key)
  values (v_project_a, (select value from test_fixture_ids where key = 'admin'), 'Roof Plan Set.pdf', 'application/pdf', 100000, 'bid-package-documents/p52b/plans-v1.pdf')
  returning id into v_doc_plans;
  insert into test_fixture_ids values ('p52b_doc_plans', v_doc_plans);

  insert into documents (project_id, uploaded_by, file_name, mime_type, size_bytes, storage_key)
  values (v_project_a, (select value from test_fixture_ids where key = 'admin'), 'Internal Cost Notes.pdf', 'application/pdf', 5000, 'bid-package-documents/p52b/internal-v1.pdf')
  returning id into v_doc_internal;
  insert into test_fixture_ids values ('p52b_doc_internal', v_doc_internal);

  insert into documents (project_id, uploaded_by, file_name, mime_type, size_bytes, storage_key)
  values (v_project_a, (select value from test_fixture_ids where key = 'admin'), 'Plumbing Spec.pdf', 'application/pdf', 20000, 'bid-package-documents/p52b/delta-v1.pdf')
  returning id into v_doc_delta;
  insert into test_fixture_ids values ('p52b_doc_delta', v_doc_delta);

  insert into bid_package_documents (bid_package_id, document_id, internal_only, category)
  values ((select value from test_fixture_ids where key = 'p522_bid_package_gamma'), v_doc_plans, false, 'plans');
end $$;

-- (Split into a second block: the plans link's own id is looked up
-- fresh here by its known (bid_package_id, document_id) pair, rather
-- than threaded through as a variable across blocks.)
do $$
declare
  v_link_plans uuid;
  v_link_internal uuid;
  v_link_delta uuid;
begin
  select id into v_link_plans from bid_package_documents
  where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')
    and document_id = (select value from test_fixture_ids where key = 'p52b_doc_plans');
  insert into test_fixture_ids values ('p52b_link_plans', v_link_plans);

  insert into bid_package_documents (bid_package_id, document_id, internal_only, category)
  values ((select value from test_fixture_ids where key = 'p522_bid_package_gamma'), (select value from test_fixture_ids where key = 'p52b_doc_internal'), true, 'reference')
  returning id into v_link_internal;
  insert into test_fixture_ids values ('p52b_link_internal', v_link_internal);

  insert into bid_package_documents (bid_package_id, document_id, internal_only, category)
  values ((select value from test_fixture_ids where key = 'p522_bid_package_delta'), (select value from test_fixture_ids where key = 'p52b_doc_delta'), false, 'specifications')
  returning id into v_link_delta;
  insert into test_fixture_ids values ('p52b_link_delta', v_link_delta);

  perform assert_that(
    (select count(*) from bid_package_documents where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 2,
    'staff sees BOTH links (internal and non-internal) on gamma''s package — staff full access is not internal_only-gated'
  );
end $$;

reset role;
select clear_test_user();

-- gamma vendor: sees the non-internal link/document, NOT the
-- internal-only one, on its OWN package.
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_package_documents where id = (select value from test_fixture_ids where key = 'p52b_link_plans')) = 1,
    'gamma vendor can read the non-internal-only bid_package_documents link on its own invited package'
  );
  perform assert_that(
    (select count(*) from documents where id = (select value from test_fixture_ids where key = 'p52b_doc_plans')) = 1,
    'documents_vendor_read_via_bid_package: gamma vendor can read the underlying documents row for a non-internal link'
  );
  perform assert_that(
    (select count(*) from bid_package_documents where id = (select value from test_fixture_ids where key = 'p52b_link_internal')) = 0,
    'gamma vendor CANNOT read the internal_only link on its own package'
  );
  perform assert_that(
    (select count(*) from documents where id = (select value from test_fixture_ids where key = 'p52b_doc_internal')) = 0,
    'documents_vendor_read_via_bid_package: gamma vendor cannot read the underlying documents row of an internal_only-linked document either'
  );
  perform assert_that(
    (select count(*) from bid_package_documents where id = (select value from test_fixture_ids where key = 'p52b_link_delta')) = 0,
    'gamma vendor cannot read delta''s (a DIFFERENT package''s) document link, even though it is non-internal'
  );
  perform assert_that(
    (select count(*) from documents where id = (select value from test_fixture_ids where key = 'p52b_doc_delta')) = 0,
    'gamma vendor cannot read delta''s underlying document row either — never blanket project-document access'
  );
end $$;

reset role;
select clear_test_user();

-- delta vendor: mirror image — can read its own non-internal document,
-- cannot read gamma's anything.
select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_package_documents where id = (select value from test_fixture_ids where key = 'p52b_link_delta')) = 1,
    'delta vendor can read its own non-internal-only document link'
  );
  perform assert_that(
    (select count(*) from documents where id = (select value from test_fixture_ids where key = 'p52b_doc_delta')) = 1,
    'delta vendor can read its own underlying document row'
  );
  perform assert_that(
    (select count(*) from bid_package_documents where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 0,
    'delta vendor sees zero of gamma''s document links, internal or not'
  );
  perform assert_that(
    (select count(*) from documents where id in (
      (select value from test_fixture_ids where key = 'p52b_doc_plans'),
      (select value from test_fixture_ids where key = 'p52b_doc_internal')
    )) = 0,
    'delta vendor cannot read either of gamma''s underlying document rows'
  );
end $$;

reset role;
select clear_test_user();

-- epsilon vendor (invited to nothing in this project): sees nothing at all.
select set_test_user((select value from test_fixture_ids where key = 'p522_epsilon_user'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from bid_package_documents) = 0, 'epsilon vendor (invited to nothing) reads zero bid_package_documents rows');
  perform assert_that((select count(*) from documents where id in (
      (select value from test_fixture_ids where key = 'p52b_doc_plans'),
      (select value from test_fixture_ids where key = 'p52b_doc_internal'),
      (select value from test_fixture_ids where key = 'p52b_doc_delta')
    )) = 0, 'epsilon vendor reads zero of the fixture documents rows');
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- Versioning: a "replace" creates a NEW documents row + a NEW
-- bid_package_documents row; the OLD link is never repointed — this IS
-- the "published snapshot" guarantee, proven directly at the DB level.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_doc_plans_v2 uuid;
  v_link_plans_v2 uuid;
begin
  insert into documents (project_id, uploaded_by, file_name, mime_type, size_bytes, storage_key, version)
  select project_id, uploaded_by, file_name, mime_type, size_bytes, 'bid-package-documents/p52b/plans-v2.pdf', 2
  from documents where id = (select value from test_fixture_ids where key = 'p52b_doc_plans')
  returning id into v_doc_plans_v2;
  insert into test_fixture_ids values ('p52b_doc_plans_v2', v_doc_plans_v2);

  update documents set superseded_by_id = v_doc_plans_v2 where id = (select value from test_fixture_ids where key = 'p52b_doc_plans');

  insert into bid_package_documents (bid_package_id, document_id, internal_only, category)
  values ((select value from test_fixture_ids where key = 'p522_bid_package_gamma'), v_doc_plans_v2, false, 'plans')
  returning id into v_link_plans_v2;
  insert into test_fixture_ids values ('p52b_link_plans_v2', v_link_plans_v2);

  perform assert_that(
    (select document_id from bid_package_documents where id = (select value from test_fixture_ids where key = 'p52b_link_plans'))
      = (select value from test_fixture_ids where key = 'p52b_doc_plans'),
    'the ORIGINAL bid_package_documents link still points at the ORIGINAL (now-superseded) document version, unchanged — an already-published package''s links are a permanent snapshot by construction'
  );
  perform assert_that(
    (select version from documents where id = (select value from test_fixture_ids where key = 'p52b_doc_plans_v2')) = 2,
    'the new document row is version 2'
  );
end $$;

-- Immutability trigger: the OLD link's document_id/bid_package_id can
-- never be repointed via UPDATE — a replace MUST go through a new row.
select assert_raises(
  format('update bid_package_documents set document_id = %L where id = %L',
    (select value from test_fixture_ids where key = 'p52b_doc_plans_v2'),
    (select value from test_fixture_ids where key = 'p52b_link_plans')),
  'bid_package_documents.document_id is immutable after insert — repointing an existing link must be rejected'
);
select assert_raises(
  format('update bid_package_documents set bid_package_id = %L where id = %L',
    (select value from test_fixture_ids where key = 'p522_bid_package_delta'),
    (select value from test_fixture_ids where key = 'p52b_link_plans')),
  'bid_package_documents.bid_package_id is immutable after insert'
);

-- created_by anti-spoofing: cannot insert a link claiming a different
-- profile as its creator than the acting session's own auth.uid().
select assert_raises(
  format('insert into bid_package_documents (bid_package_id, document_id, internal_only, category, created_by) values (%L, %L, false, %L, %L)',
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p52b_doc_plans_v2'),
    'photos',
    (select value from test_fixture_ids where key = 'p52b_contact_staff_2')),
  'bid_package_documents.created_by must equal the inserting session''s own auth.uid() — an explicit different value must be rejected'
);

-- Delete-block: even staff cannot delete a bid_package_documents row —
-- archive/supersede only, matching every other permanent record in
-- this domain.
select assert_raises(
  format('delete from bid_package_documents where id = %L', (select value from test_fixture_ids where key = 'p52b_link_internal')),
  'bid_package_documents rows can never be deleted, even by staff — reject_delete()'
);

reset role;
select clear_test_user();

-- gamma vendor now sees BOTH the original and the new version's links
-- (both are real, non-internal, non-deleted rows) — the UI's job is to
-- present these as version history, not the RLS layer's.
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_package_documents where id in (
      (select value from test_fixture_ids where key = 'p52b_link_plans'),
      (select value from test_fixture_ids where key = 'p52b_link_plans_v2')
    )) = 2,
    'gamma vendor can read both the original and the newly-linked version-2 document link'
  );
end $$;

reset role;
select clear_test_user();

-- Cross-org isolation, unchanged: org B admin sees none of this.
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from bid_package_documents) = 0, 'org B admin sees zero bid_package_documents rows');
  perform assert_that(
    (select count(*) from documents where id in (
      (select value from test_fixture_ids where key = 'p52b_doc_plans'),
      (select value from test_fixture_ids where key = 'p52b_doc_plans_v2'),
      (select value from test_fixture_ids where key = 'p52b_doc_internal'),
      (select value from test_fixture_ids where key = 'p52b_doc_delta')
    )) = 0,
    'org B admin sees zero of org A''s new documents rows'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 3 — addenda/Q&A isolation regression, with REAL rows present
-- alongside real documents/assembly data (P5.2 Phase B's own explicit
-- verification requirement: confirm Phase A's fix still holds once
-- there is real surrounding data to query against, not just the
-- original narrow fixture set).
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_question_id uuid;
  v_addendum_id uuid;
begin
  insert into bid_questions (bid_package_id, question_text, answer_text, answered_at)
  values (
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    'Does the plan set include the revised elevation?',
    'Yes, Roof Plan Set.pdf (linked above) is the current revision.',
    now()
  )
  returning id into v_question_id;
  insert into test_fixture_ids values ('p52b_question_gamma', v_question_id);

  insert into bid_addenda (bid_package_id, title, body_text)
  values (
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    'Addendum 1 — Revised Plan Set',
    'A revised plan set (version 2) has been posted to this package''s documents.'
  )
  returning id into v_addendum_id;
  insert into test_fixture_ids values ('p52b_addendum_gamma', v_addendum_id);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_questions where id = (select value from test_fixture_ids where key = 'p52b_question_gamma')) = 1,
    'gamma vendor can read the new question+answer on its own package'
  );
  perform assert_that(
    (select count(*) from bid_addenda where id = (select value from test_fixture_ids where key = 'p52b_addendum_gamma')) = 1,
    'gamma vendor can read the new addendum on its own package'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_questions where id = (select value from test_fixture_ids where key = 'p52b_question_gamma')) = 0,
    'Phase A isolation regression: delta vendor still cannot read gamma''s question, with real documents/assembly data now present too'
  );
  perform assert_that(
    (select count(*) from bid_addenda where id = (select value from test_fixture_ids where key = 'p52b_addendum_gamma')) = 0,
    'Phase A isolation regression: delta vendor still cannot read gamma''s addendum'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_epsilon_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_questions where id = (select value from test_fixture_ids where key = 'p52b_question_gamma')) = 0,
    'epsilon vendor (invited to nothing) cannot read gamma''s question'
  );
  perform assert_that(
    (select count(*) from bid_addenda where id = (select value from test_fixture_ids where key = 'p52b_addendum_gamma')) = 0,
    'epsilon vendor cannot read gamma''s addendum'
  );
end $$;

reset role;
select clear_test_user();
