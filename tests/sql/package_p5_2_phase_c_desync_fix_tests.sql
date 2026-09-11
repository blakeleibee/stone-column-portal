-- =====================================================================
-- Stone Column Portal — P5.2 Phase C follow-up fix test suite, covering
-- schema/027_bid_submission_revision_desync_fix.sql. Reuses
-- package_p5_2_phase_b_tests.sql's own fixtures exactly like
-- package_p5_2_phase_c_tests.sql already does: 'p522_vendor_gamma'/
-- 'p522_bid_package_gamma'/'p522_gamma_user'.
--
-- Confirms the fix an independent security review found necessary:
-- schema/026 alone let a vendor INSERT directly into
-- bid_submission_revisions (bypassing submit_bid_revision() entirely),
-- leaving bid_submissions' current-state row permanently out of sync
-- with the "permanent" revision it just created. schema/027's new
-- AFTER INSERT trigger closes this by mirroring ANY inserted revision
-- into bid_submissions, regardless of entry path.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
declare
  v_submission_id uuid;
  v_direct_revision_id uuid;
begin
  select id into v_submission_id from bid_submissions
  where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')
    and vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_gamma');
  insert into test_fixture_ids values ('p52cd_gamma_submission_id', v_submission_id);

  perform assert_that(
    (select status from bid_submissions where id = v_submission_id) in ('invited', 'submitted'),
    'Setup: gamma''s submission starts invited/submitted (still open) before this test''s direct insert'
  );

  -- THE REGRESSION CASE: a vendor session inserts directly into
  -- bid_submission_revisions, bypassing submit_bid_revision() entirely
  -- (no RPC call at all) -- exactly what an independent review
  -- confirmed live against hosted dev succeeds under schema/026 alone
  -- and leaves bid_submissions stale.
  insert into bid_submission_revisions (bid_submission_id, amount_cents, notes)
  values (v_submission_id, 777700, 'Direct insert, bypassing submit_bid_revision()')
  returning id into v_direct_revision_id;
  insert into test_fixture_ids values ('p52cd_gamma_direct_revision_id', v_direct_revision_id);

  perform assert_that(
    (select amount_cents from bid_submission_revisions where id = v_direct_revision_id) = 777700,
    'The direct-insert revision row itself exists with the real amount'
  );

  -- THE FIX: bid_submissions must now reflect this revision immediately
  -- -- no separate UPDATE statement was issued by this test, only the
  -- raw INSERT above. schema/026 alone would leave amount_cents/status
  -- exactly as they were before this insert (the desync); schema/027's
  -- trigger must make this pass.
  perform assert_that(
    (select amount_cents from bid_submissions where id = v_submission_id) = 777700,
    'schema/027 fix: bid_submissions.amount_cents is mirrored from a DIRECT insert, not only via submit_bid_revision()'
  );
  perform assert_that(
    (select status from bid_submissions where id = v_submission_id) = 'submitted',
    'schema/027 fix: bid_submissions.status becomes ''submitted'' from a DIRECT insert too'
  );
  perform assert_that(
    (select notes from bid_submissions where id = v_submission_id) = 'Direct insert, bypassing submit_bid_revision()',
    'schema/027 fix: bid_submissions.notes mirrors the direct-insert revision''s own notes'
  );
  perform assert_that(
    (select submitted_at from bid_submission_revisions where id = v_direct_revision_id) = (select submitted_at from bid_submissions where id = v_submission_id),
    'schema/027 fix: bid_submissions.submitted_at exactly matches the mirrored revision''s own submitted_at'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- The real, intended path (submit_bid_revision()) still behaves
-- identically after schema/027 -- its own explicit mirroring UPDATE is
-- now redundant with the trigger but must remain harmless (idempotent,
-- same values), not a regression or a double-effect bug.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
declare
  v_submission_id uuid := (select value from test_fixture_ids where key = 'p52cd_gamma_submission_id');
  v_rpc_revision_id uuid;
begin
  select submit_bid_revision(v_submission_id, 850000, 'Via the real RPC, after the desync fix.') into v_rpc_revision_id;

  perform assert_that(
    (select amount_cents from bid_submissions where id = v_submission_id) = 850000,
    'submit_bid_revision() still correctly updates bid_submissions after schema/027 (trigger + explicit UPDATE agree, not a double-apply bug)'
  );
  -- package_p5_2_phase_c_tests.sql already created 2 revisions for this
  -- same submission (4200000, 3985000) before this file ran; this file
  -- adds exactly 2 more (the direct-insert one, then this RPC one) -- 4
  -- total, never a phantom extra row from the trigger firing twice.
  perform assert_that(
    (select count(*) from bid_submission_revisions where bid_submission_id = v_submission_id) = 4,
    'Exactly four revisions exist total across both test files -- no phantom extra row from the trigger firing twice'
  );
end $$;

reset role;
select clear_test_user();
