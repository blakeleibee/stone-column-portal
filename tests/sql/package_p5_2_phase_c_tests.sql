-- =====================================================================
-- Stone Column Portal — P5.2 Phase C (vendor bid submission/revision
-- history, vendor-submitted Q&A, addendum acknowledgment) SQL/RLS test
-- suite, covering schema/026_vendor_bid_submission_revisions_qa_addenda.sql.
-- Runs after schema/001-026 and after every earlier test file, reusing
-- package_p5_2_vendor_bid_access_phase_a_tests.sql's own fixtures
-- exactly like package_p5_2_phase_b_tests.sql already does:
-- 'p522_vendor_gamma'/'p522_bid_package_gamma'/'p522_gamma_user'
-- (published, no due_at, bid_submissions row still status='invited' —
-- neither Phase A nor Phase B's tests ever recorded/submitted an amount
-- against it), 'p522_vendor_delta'/'p522_bid_package_delta'/
-- 'p522_delta_user' (same shape), 'p522_vendor_epsilon'/
-- 'p522_epsilon_user' (never invited to anything).
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1 — first submission via submit_bid_revision(): a real
-- vendor session submits its own bid for the first time.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
declare
  v_submission_id uuid;
  v_revision_id uuid;
begin
  select id into v_submission_id from bid_submissions
  where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')
    and vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_gamma');
  insert into test_fixture_ids values ('p52c_gamma_submission_id', v_submission_id);

  select submit_bid_revision(v_submission_id, 4200000, 'Base bid, per plans dated 2026-08-01.') into v_revision_id;
  insert into test_fixture_ids values ('p52c_gamma_revision_1_id', v_revision_id);

  perform assert_that(
    (select status from bid_submissions where id = v_submission_id) = 'submitted',
    'Section 1: submit_bid_revision() moves the submission to ''submitted'''
  );
  perform assert_that(
    (select amount_cents from bid_submissions where id = v_submission_id) = 4200000,
    'Section 1: bid_submissions.amount_cents mirrors the submitted amount'
  );
  perform assert_that(
    (select submitted_at from bid_submissions where id = v_submission_id) is not null,
    'Section 1: submitted_at is set'
  );
  perform assert_that(
    (select count(*) from bid_submission_revisions where bid_submission_id = v_submission_id) = 1,
    'Section 1: exactly one immutable revision row now exists'
  );
  perform assert_that(
    (select revision_number from bid_submission_revisions where id = v_revision_id) = 1,
    'Section 1: the first revision is numbered 1'
  );
  perform assert_that(
    (select submitted_by from bid_submission_revisions where id = v_revision_id) = (select value from test_fixture_ids where key = 'p522_gamma_user'),
    'Section 1: submitted_by is the real acting vendor session, not spoofable'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 2 — revision: the same vendor revises its own bid. Full
-- history preserved (never overwritten), current state (bid_submissions)
-- reflects only the latest.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
declare
  v_submission_id uuid := (select value from test_fixture_ids where key = 'p52c_gamma_submission_id');
  v_revision_2_id uuid;
begin
  select submit_bid_revision(v_submission_id, 3985000, 'Revised — value-engineered the flashing detail.') into v_revision_2_id;
  insert into test_fixture_ids values ('p52c_gamma_revision_2_id', v_revision_2_id);

  perform assert_that(
    (select amount_cents from bid_submissions where id = v_submission_id) = 3985000,
    'Section 2: bid_submissions now reflects the REVISED amount'
  );
  perform assert_that(
    (select count(*) from bid_submission_revisions where bid_submission_id = v_submission_id) = 2,
    'Section 2: the ORIGINAL revision row still exists — two total, never overwritten'
  );
  perform assert_that(
    (select amount_cents from bid_submission_revisions where id = (select value from test_fixture_ids where key = 'p52c_gamma_revision_1_id')) = 4200000,
    'Section 2: revision 1''s own amount is unchanged — a real immutable history, not a mutated row'
  );
  perform assert_that(
    (select revision_number from bid_submission_revisions where id = v_revision_2_id) = 2,
    'Section 2: revision numbers are real and sequential'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 3 — cross-vendor isolation: delta can neither read gamma's
-- revision history nor submit a revision against gamma's submission
-- (never for another vendor, per the owner's top-line requirement).
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_submission_revisions where bid_submission_id = (select value from test_fixture_ids where key = 'p52c_gamma_submission_id')) = 0,
    'Section 3: delta vendor reads ZERO of gamma''s revision rows — pricing isolation holds'
  );
end $$;

select assert_raises(
  format('select submit_bid_revision(%L, 100, null)', (select value from test_fixture_ids where key = 'p52c_gamma_submission_id')),
  'Section 3: delta vendor cannot submit a revision against gamma''s own bid_submissions row'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 4 — staff can see the full version history, not just the
-- latest amount.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_submission_revisions where bid_submission_id = (select value from test_fixture_ids where key = 'p52c_gamma_submission_id')) = 2,
    'Section 4: staff sees BOTH of gamma''s revisions, not merely the current row'
  );
  perform assert_that(
    (select array_agg(amount_cents order by revision_number) from bid_submission_revisions where bid_submission_id = (select value from test_fixture_ids where key = 'p52c_gamma_submission_id')) = array[4200000, 3985000]::bigint[],
    'Section 4: the full historical sequence of amounts is intact and correctly ordered'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 5 — cross-org isolation: org B admin sees nothing.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_submission_revisions where bid_submission_id = (select value from test_fixture_ids where key = 'p52c_gamma_submission_id')) = 0,
    'Section 5: org B admin sees zero of org A''s bid submission revisions'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 6 — a vendor cannot submit once the package is no longer
-- accepting bids: (a) package status is not 'published', (b) the
-- package's due date has passed. Two fresh packages so this section is
-- self-contained.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_cancelled_package uuid;
  v_past_due_package uuid;
  v_cancelled_submission_id uuid;
  v_past_due_submission_id uuid;
begin
  insert into bid_packages (project_id, cost_code_id, title, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'P5.2 Phase C — Cancelled Package', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_cancelled_package;
  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_cancelled_package, (select value from test_fixture_ids where key = 'p522_vendor_gamma'))
  returning id into v_cancelled_submission_id;
  update bid_packages set status = 'cancelled' where id = v_cancelled_package;
  insert into test_fixture_ids values ('p52c_cancelled_submission_id', v_cancelled_submission_id);

  insert into bid_packages (project_id, cost_code_id, title, status, due_at)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'P5.2 Phase C — Past-Due Package', 'published', now() - interval '1 day'
  from test_fixture_ids where key = 'project_a'
  returning id into v_past_due_package;
  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_past_due_package, (select value from test_fixture_ids where key = 'p522_vendor_gamma'))
  returning id into v_past_due_submission_id;
  insert into test_fixture_ids values ('p52c_past_due_submission_id', v_past_due_submission_id);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

select assert_raises(
  format('select submit_bid_revision(%L, 100000, null)', (select value from test_fixture_ids where key = 'p52c_cancelled_submission_id')),
  'Section 6a: a vendor cannot submit against a package that is no longer ''published'' (cancelled)'
);

select assert_raises(
  format('select submit_bid_revision(%L, 100000, null)', (select value from test_fixture_ids where key = 'p52c_past_due_submission_id')),
  'Section 6b: a vendor cannot submit against a package whose due date has passed'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 7 — a vendor cannot revise a submission that has already been
-- awarded/declined/withdrawn by staff (the "closed by outcome, not just
-- by package state" case) and cannot directly set its own status to
-- 'awarded'/'declined' via a raw UPDATE, bypassing submit_bid_revision()
-- entirely — the exact latent gap this migration's trigger closes.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  -- Staff directly marking delta's submission 'awarded' (simulating the
  -- real award_bid() outcome without needing a full committed_costs
  -- round trip here) — allowed, staff is unrestricted by the new trigger.
  update bid_submissions
  set status = 'submitted', amount_cents = 500000, submitted_at = now()
  where id = (select id from bid_submissions where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_delta') and vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_delta'));

  update bid_submissions
  set status = 'awarded'
  where id = (select id from bid_submissions where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_delta') and vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_delta'));

  perform assert_that(
    (select status from bid_submissions where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_delta') and vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_delta')) = 'awarded',
    'Section 7 setup: staff can still freely move a submission through invited -> submitted -> awarded, unrestricted'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

select assert_raises(
  format(
    'select submit_bid_revision(%L, 1, null)',
    (select id from bid_submissions where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_delta') and vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_delta'))
  ),
  'Section 7a: a vendor cannot revise a submission staff has already awarded'
);

reset role;
select clear_test_user();

-- 7b/7c: gamma acting on its OWN row (not delta's — a self-tampering
-- attempt, distinct from the cross-vendor tampering Section 3 already
-- covers). Gamma's own submission is still status='submitted' at this
-- point (Section 2's revision), so RLS's own USING clause
-- (is_vendor_member(vendor_id)) genuinely lets the row through — the
-- ONLY thing standing between a vendor and self-awarding its own bid is
-- this migration's new trigger.
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

select assert_raises(
  format(
    'update bid_submissions set status = ''awarded'' where id = %L',
    (select value from test_fixture_ids where key = 'p52c_gamma_submission_id')
  ),
  'Section 7b: a vendor session cannot directly set its own bid_submissions.status to ''awarded'' via a raw UPDATE'
);

select assert_raises(
  format(
    'update bid_submissions set status = ''declined'' where id = %L',
    (select value from test_fixture_ids where key = 'p52c_gamma_submission_id')
  ),
  'Section 7c: a vendor session cannot directly set its own bid_submissions.status to ''declined'' via a raw UPDATE'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 8 — vendor-submitted questions (wiring the previously-dormant
-- bid_questions_vendor_insert policy). Private by default (not
-- immediately broadcast to other vendors), invited-vendor-only,
-- own-package-only.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
declare
  v_question_id uuid;
begin
  -- recorded_by must be explicitly nulled here — its column DEFAULT is
  -- unconditionally auth.uid() (schema/015), which would otherwise
  -- populate it with the vendor's own uid and trip the existing
  -- bid_questions_recorded_by_self trigger's "vendor_submitted rows
  -- have no staff recorder" rule. The real service function
  -- (askVendorBidQuestion, bidService.ts) does the same.
  insert into bid_questions (bid_package_id, vendor_id, source, recorded_by, question_text, visible_to_all_vendors)
  values (
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    'vendor_submitted',
    null,
    'Is the flashing detail on sheet A-4 or A-5 the governing one?',
    false
  )
  returning id into v_question_id;
  insert into test_fixture_ids values ('p52c_gamma_question_id', v_question_id);

  perform assert_that(
    (select source from bid_questions where id = v_question_id) = 'vendor_submitted',
    'Section 8: the question is correctly attributed as vendor_submitted'
  );
  perform assert_that(
    (select recorded_by from bid_questions where id = v_question_id) is null,
    'Section 8: recorded_by is null for a vendor-submitted question (existing bid_questions_recorded_by_self trigger)'
  );
  perform assert_that(
    (select visible_to_all_vendors from bid_questions where id = v_question_id) = false,
    'Section 8: a vendor-submitted question is PRIVATE by default — not silently broadcast to competitors'
  );
end $$;

-- A vendor cannot force their own question to be immediately broadcast
-- to every other invited vendor, unmediated by staff.
select assert_raises(
  format(
    $sql$insert into bid_questions (bid_package_id, vendor_id, source, recorded_by, question_text, visible_to_all_vendors)
         values (%L, %L, 'vendor_submitted', null, 'Trying to broadcast my own question', true)$sql$,
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  ),
  'Section 8: a vendor cannot insert a vendor_submitted question with visible_to_all_vendors=true'
);

reset role;
select clear_test_user();

-- Epsilon (never invited to gamma's package) cannot ask a question on
-- it at all.
select set_test_user((select value from test_fixture_ids where key = 'p522_epsilon_user'));
set local role authenticated;

select assert_raises(
  format(
    $sql$insert into bid_questions (bid_package_id, vendor_id, source, recorded_by, question_text, visible_to_all_vendors)
         values (%L, %L, 'vendor_submitted', null, 'I was never invited to this package', false)$sql$,
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_epsilon')
  ),
  'Section 8: a vendor never invited to this package cannot ask a question on it'
);

reset role;
select clear_test_user();

-- Delta (invited to a DIFFERENT package) cannot read gamma's private
-- vendor-submitted question.
select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_questions where id = (select value from test_fixture_ids where key = 'p52c_gamma_question_id')) = 0,
    'Section 8: delta cannot read gamma''s private vendor-submitted question'
  );
end $$;

reset role;
select clear_test_user();

-- Staff can read and answer it; gamma then sees the answer.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_questions where id = (select value from test_fixture_ids where key = 'p52c_gamma_question_id')) = 1,
    'Section 8: staff can read the vendor-submitted question'
  );

  update bid_questions
  set answer_text = 'A-5 governs; A-4 is superseded.', answered_at = now(), answered_by = (select value from test_fixture_ids where key = 'admin')
  where id = (select value from test_fixture_ids where key = 'p52c_gamma_question_id');
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select answer_text from bid_questions where id = (select value from test_fixture_ids where key = 'p52c_gamma_question_id')) = 'A-5 governs; A-4 is superseded.',
    'Section 8: the asking vendor sees the staff answer to its own question'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 9 — addendum acknowledgment tracking.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_addendum_id uuid;
begin
  insert into bid_addenda (bid_package_id, title, body_text)
  values (
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    'Addendum 1 — Roof pitch correction',
    'The roof pitch on sheet A-3 is corrected from 6:12 to 8:12.'
  )
  returning id into v_addendum_id;
  insert into test_fixture_ids values ('p52c_gamma_addendum_id', v_addendum_id);
end $$;

reset role;
select clear_test_user();

-- Happy path: gamma (genuinely invited to this package) acknowledges.
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
declare
  v_ack_id uuid;
begin
  insert into bid_addendum_acknowledgments (bid_addendum_id, vendor_id)
  values (
    (select value from test_fixture_ids where key = 'p52c_gamma_addendum_id'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  )
  returning id into v_ack_id;
  insert into test_fixture_ids values ('p52c_gamma_ack_id', v_ack_id);

  perform assert_that(
    (select acknowledged_by from bid_addendum_acknowledgments where id = v_ack_id) = (select value from test_fixture_ids where key = 'p522_gamma_user'),
    'Section 9: acknowledged_by is the real acting session, not spoofable'
  );
  perform assert_that(
    (select acknowledged_at from bid_addendum_acknowledgments where id = v_ack_id) is not null,
    'Section 9: acknowledged_at is set'
  );
end $$;

-- Duplicate acknowledgment by the same vendor is rejected (the unique
-- constraint), not silently duplicated.
select assert_raises(
  format(
    'insert into bid_addendum_acknowledgments (bid_addendum_id, vendor_id) values (%L, %L)',
    (select value from test_fixture_ids where key = 'p52c_gamma_addendum_id'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  ),
  'Section 9: a vendor cannot acknowledge the same addendum twice'
);

reset role;
select clear_test_user();

-- Delta (invited only to a DIFFERENT package) cannot acknowledge
-- gamma's addendum for its OWN vendor_id (never invited to the package
-- that addendum belongs to)...
select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

select assert_raises(
  format(
    'insert into bid_addendum_acknowledgments (bid_addendum_id, vendor_id) values (%L, %L)',
    (select value from test_fixture_ids where key = 'p52c_gamma_addendum_id'),
    (select value from test_fixture_ids where key = 'p522_vendor_delta')
  ),
  'Section 9: delta cannot acknowledge an addendum on a package it was never invited to'
);

-- ...nor for gamma's vendor_id (impersonation attempt — never on behalf
-- of another vendor).
select assert_raises(
  format(
    'insert into bid_addendum_acknowledgments (bid_addendum_id, vendor_id) values (%L, %L)',
    (select value from test_fixture_ids where key = 'p52c_gamma_addendum_id'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  ),
  'Section 9: delta cannot acknowledge an addendum on behalf of gamma''s vendor_id'
);

do $$
begin
  perform assert_that(
    (select count(*) from bid_addendum_acknowledgments where id = (select value from test_fixture_ids where key = 'p52c_gamma_ack_id')) = 0,
    'Section 9: delta cannot even READ gamma''s acknowledgment row'
  );
end $$;

reset role;
select clear_test_user();

-- Staff sees the acknowledgment; org B admin sees nothing.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_addendum_acknowledgments where id = (select value from test_fixture_ids where key = 'p52c_gamma_ack_id')) = 1,
    'Section 9: staff can see the acknowledgment for their own org'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_addendum_acknowledgments where id = (select value from test_fixture_ids where key = 'p52c_gamma_ack_id')) = 0,
    'Section 9: org B admin sees zero acknowledgments belonging to org A'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 10 — permanence: bid_submission_revisions and
-- bid_addendum_acknowledgments can never be updated or deleted by
-- anyone, including staff.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

select assert_raises(
  format(
    'update bid_submission_revisions set amount_cents = 1 where id = %L',
    (select value from test_fixture_ids where key = 'p52c_gamma_revision_1_id')
  ),
  'Section 10: even staff cannot UPDATE a bid_submission_revisions row — permanent history'
);

select assert_raises(
  format(
    'delete from bid_submission_revisions where id = %L',
    (select value from test_fixture_ids where key = 'p52c_gamma_revision_1_id')
  ),
  'Section 10: even staff cannot DELETE a bid_submission_revisions row'
);

select assert_raises(
  format(
    'update bid_addendum_acknowledgments set acknowledged_at = now() where id = %L',
    (select value from test_fixture_ids where key = 'p52c_gamma_ack_id')
  ),
  'Section 10: even staff cannot UPDATE a bid_addendum_acknowledgments row'
);

select assert_raises(
  format(
    'delete from bid_addendum_acknowledgments where id = %L',
    (select value from test_fixture_ids where key = 'p52c_gamma_ack_id')
  ),
  'Section 10: even staff cannot DELETE a bid_addendum_acknowledgments row'
);

reset role;
select clear_test_user();
