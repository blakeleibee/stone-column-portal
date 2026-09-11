-- =====================================================================
-- Stone Column Portal — P5.2 Phase D (bid correspondence, inbound-email
-- routing) SQL/RLS test suite, covering
-- schema/028_bid_correspondence_and_inbound_email.sql. Runs after
-- schema/001-028 and after every earlier test file, reusing
-- package_p5_2_vendor_bid_access_phase_a_tests.sql's own fixtures:
-- 'p522_vendor_gamma'/'p522_gamma_user', 'p522_vendor_delta'/
-- 'p522_delta_user' (both real vendor companies with active
-- vendor_members), 'p522_bid_package_gamma' (published, in project_a).
--
-- SECTION 1 adds the ONE new fixture every other package-P5.2 test file
-- deliberately never built: inviting a SECOND vendor (delta) to the
-- SAME bid package (gamma's own package) — required specifically to
-- reproduce the exact class of bug this migration's RLS closes (two
-- vendors both satisfying is_invited_vendor_for_bid_package() for the
-- SAME package, which is not by itself sufficient to prove "this row is
-- MINE"). Every scenario below that matters is proven with gamma and
-- delta BOTH invited to bid_package_gamma, never on separate packages.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1 — fixture: delta also invited to bid_package_gamma.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  insert into bid_submissions (bid_package_id, vendor_id)
  values (
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_delta')
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 2 — staff composes an outbound message to gamma; staff can
-- read it; org B staff cannot.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_message_id uuid;
begin
  insert into entity_messages (bid_package_id, vendor_id, direction, sender, recipient, subject, body, sent_at, delivery_status, created_by)
  values (
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    'outbound', 'notify@notify.stonecolumn.com', 'contact@gammaroofing.example',
    'Bid package invitation', 'You have been invited to bid.', now(), 'sent', auth.uid()
  )
  returning id into v_message_id;
  insert into test_fixture_ids values ('p52d_gamma_message_1', v_message_id);

  perform assert_that(
    (select count(*) from entity_messages where id = v_message_id) = 1,
    'Section 2: staff can insert and immediately read an outbound message'
  );
end $$;

-- Staff cannot set direction/sent_at/received_at into a contradictory
-- shape — the CHECK constraint, not RLS, is what rejects this.
select assert_raises(
  format(
    'insert into entity_messages (bid_package_id, vendor_id, direction, sender, recipient, body, received_at, created_by) values (%L, %L, ''outbound'', ''a@b.com'', ''c@d.com'', ''bad'', now(), %L)',
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    (select value from test_fixture_ids where key = 'admin')
  ),
  'Section 2: an outbound message with received_at set violates entity_messages_direction_timestamps'
);

-- created_by must equal the inserting staff session's own auth.uid().
select assert_raises(
  format(
    'insert into entity_messages (bid_package_id, vendor_id, direction, sender, recipient, body, created_by) values (%L, %L, ''outbound'', ''a@b.com'', ''c@d.com'', ''spoof'', %L)',
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    (select value from test_fixture_ids where key = 'p522_gamma_user')
  ),
  'Section 2: created_by must equal the inserting staff session''s own auth.uid(), not an arbitrary profile'
);

reset role;
select clear_test_user();

-- Org B staff (a different org entirely) cannot see the message at all.
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

select assert_that(
  (select count(*) from entity_messages where id = (select value from test_fixture_ids where key = 'p52d_gamma_message_1')) = 0,
  'Section 2: a staff session from a different org cannot read another org''s entity_messages row'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 3 — THE CORE OWNERSHIP-SCOPING REGRESSION TEST. Gamma and
-- delta are BOTH invited to bid_package_gamma (Section 1). Gamma can
-- read its own thread; delta — invited to the very same package — must
-- see NOTHING from gamma's thread. This is the exact scenario
-- is_invited_vendor_for_bid_package(bid_package_id) ALONE would have
-- gotten wrong (it would return true for BOTH vendors on this package,
-- proving nothing about which row belongs to which vendor).
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

select assert_that(
  (select count(*) from entity_messages where id = (select value from test_fixture_ids where key = 'p52d_gamma_message_1')) = 1,
  'Section 3: vendor gamma can read its own message'
);

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

select assert_that(
  (select count(*) from entity_messages where id = (select value from test_fixture_ids where key = 'p52d_gamma_message_1')) = 0,
  'Section 3 (CORE FIX): vendor delta, invited to the SAME bid package as gamma, cannot read gamma''s private message'
);

select assert_that(
  (select count(*) from entity_messages where bid_package_id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma')) = 0,
  'Section 3 (CORE FIX): vendor delta''s query for the whole package''s correspondence still returns zero rows — none of them are delta''s own'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 4 — vendor-composed inbound (portal) messages, and the
-- vendor-side write boundaries.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

do $$
declare
  v_reply_id uuid;
begin
  insert into entity_messages (bid_package_id, vendor_id, direction, sender, recipient, body)
  values (
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    'inbound', 'contact@gammaroofing.example', 'notify@notify.stonecolumn.com', 'Thanks, we will submit by Friday.'
  )
  returning id into v_reply_id;
  insert into test_fixture_ids values ('p52d_gamma_reply_1', v_reply_id);

  perform assert_that(
    (select created_by from entity_messages where id = v_reply_id) is null,
    'Section 4: a vendor-composed message has created_by forced null'
  );
end $$;

-- Vendor cannot impersonate another vendor's thread on the same package.
select assert_raises(
  format(
    'insert into entity_messages (bid_package_id, vendor_id, direction, sender, recipient, body) values (%L, %L, ''inbound'', ''x@y.com'', ''z@w.com'', ''impersonation attempt'')',
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_delta')
  ),
  'Section 4: vendor gamma cannot insert a message under vendor delta''s vendor_id, even on a package both are invited to'
);

-- Vendor cannot claim direction='outbound'.
select assert_raises(
  format(
    'insert into entity_messages (bid_package_id, vendor_id, direction, sender, recipient, body) values (%L, %L, ''outbound'', ''x@y.com'', ''z@w.com'', ''spoofed outbound'')',
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  ),
  'Section 4: a vendor session cannot mark its own portal message as ''outbound'''
);

-- Vendor cannot set created_by to itself.
select assert_raises(
  format(
    'insert into entity_messages (bid_package_id, vendor_id, direction, sender, recipient, body, created_by) values (%L, %L, ''inbound'', ''x@y.com'', ''z@w.com'', ''spoofed provenance'', %L)',
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma'),
    (select value from test_fixture_ids where key = 'p522_gamma_user')
  ),
  'Section 4: a vendor session cannot set created_by on its own inserted row'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 5 — entity_messages is genuinely append-only: no UPDATE, no
-- DELETE, for anyone, at the table-privilege level (not merely RLS).
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

select assert_raises(
  format('update entity_messages set body = ''edited'' where id = %L', (select value from test_fixture_ids where key = 'p52d_gamma_message_1')),
  'Section 5: even staff cannot UPDATE an entity_messages row — UPDATE is revoked at the table-privilege level'
);

select assert_raises(
  format('delete from entity_messages where id = %L', (select value from test_fixture_ids where key = 'p52d_gamma_message_1')),
  'Section 5: even staff cannot DELETE an entity_messages row'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 6 — entity_message_attachments: same ownership scoping as
-- entity_messages itself, proven with the same gamma/delta pairing.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_project_id uuid;
  v_document_id uuid;
  v_attachment_id uuid;
begin
  select project_id into v_project_id from bid_packages where id = (select value from test_fixture_ids where key = 'p522_bid_package_gamma');

  insert into documents (project_id, uploaded_by, file_name, mime_type, size_bytes, storage_key)
  values (v_project_id, auth.uid(), 'invitation-scope.pdf', 'application/pdf', 1024, 'entity-message-attachments/test/invitation-scope.pdf')
  returning id into v_document_id;

  insert into entity_message_attachments (entity_message_id, document_id)
  values ((select value from test_fixture_ids where key = 'p52d_gamma_message_1'), v_document_id)
  returning id into v_attachment_id;
  insert into test_fixture_ids values ('p52d_gamma_attachment_1', v_attachment_id);
  insert into test_fixture_ids values ('p52d_gamma_attachment_document_1', v_document_id);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

select assert_that(
  (select count(*) from entity_message_attachments where id = (select value from test_fixture_ids where key = 'p52d_gamma_attachment_1')) = 1,
  'Section 6: vendor gamma can read the attachment on its own message'
);

select assert_that(
  (select count(*) from documents where id = (select value from test_fixture_ids where key = 'p52d_gamma_attachment_document_1')) = 1,
  'Section 6: vendor gamma can read the underlying documents row via documents_vendor_read_via_entity_message'
);

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

select assert_that(
  (select count(*) from entity_message_attachments where id = (select value from test_fixture_ids where key = 'p52d_gamma_attachment_1')) = 0,
  'Section 6 (CORE FIX): vendor delta cannot read the attachment on gamma''s message'
);

select assert_that(
  (select count(*) from documents where id = (select value from test_fixture_ids where key = 'p52d_gamma_attachment_document_1')) = 0,
  'Section 6 (CORE FIX): vendor delta cannot read the underlying documents row either'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 7 — inbound_reply_tokens: staff-manage only, zero vendor
-- access of any kind (a vendor never needs to read its own token row —
-- it is embedded directly in outbound emails, never surfaced in-app).
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_token_id uuid;
  v_token text;
begin
  insert into inbound_reply_tokens (bid_package_id, vendor_id)
  values (
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  )
  returning id, token into v_token_id, v_token;
  insert into test_fixture_ids values ('p52d_gamma_reply_token_id', v_token_id);
  insert into test_fixture_tokens values ('p52d_gamma_reply_token', v_token);

  perform assert_that(v_token is not null and length(v_token) > 0, 'Section 7: a reply token is generated automatically');
end $$;

-- One token per (bid_package, vendor) pair — a second insert for the
-- same pair violates the unique constraint.
select assert_raises(
  format(
    'insert into inbound_reply_tokens (bid_package_id, vendor_id) values (%L, %L)',
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  ),
  'Section 7: inbound_reply_tokens_unique_pair rejects a second token for the same (bid_package, vendor) pair'
);

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

select assert_that(
  (select count(*) from inbound_reply_tokens where id = (select value from test_fixture_ids where key = 'p52d_gamma_reply_token_id')) = 0,
  'Section 7: a vendor session has zero access to inbound_reply_tokens, including its own thread''s token'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 8 — revocation reaches entity_messages RLS live, with no
-- second write path to keep in sync (same philosophy as schema/022's
-- own is_invited_vendor_for_bid_package() — access is recomputed from
-- vendor_members on every read). This is the DB-level fact the inbound-
-- webhook's application-level "since-revoked vendor" check (Section 9)
-- ultimately relies on: once revoked, the vendor session itself loses
-- read access to its own prior thread, exactly like a revoked reply
-- token must stop resolving.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

update vendor_members set revoked_at = now(), revoked_by = auth.uid()
where vendor_id = (select value from test_fixture_ids where key = 'p522_vendor_gamma');

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p522_gamma_user'));
set local role authenticated;

select assert_that(
  (select count(*) from entity_messages where id = (select value from test_fixture_ids where key = 'p52d_gamma_message_1')) = 0,
  'Section 8: once vendor gamma''s membership is revoked, its own session immediately loses read access to its prior thread'
);

select assert_raises(
  format(
    'insert into entity_messages (bid_package_id, vendor_id, direction, sender, recipient, body) values (%L, %L, ''inbound'', ''x@y.com'', ''z@w.com'', ''should be rejected'')',
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_gamma')
  ),
  'Section 8: a revoked vendor session cannot insert a new message into its former thread either'
);

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 9 — quarantined_inbound_messages: staff-visible only, zero
-- vendor access of any kind.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_org_a_id uuid;
  v_quarantine_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  insert into quarantined_inbound_messages (reason, raw_payload, org_id, bid_package_id, vendor_id)
  values (
    'sender_mismatch', '{"from": "someone-else@example.com"}'::jsonb, v_org_a_id,
    (select value from test_fixture_ids where key = 'p522_bid_package_gamma'),
    (select value from test_fixture_ids where key = 'p522_vendor_delta')
  )
  returning id into v_quarantine_id;
  insert into test_fixture_ids values ('p52d_quarantine_1', v_quarantine_id);

  -- A fully unattributable row — org_id null, exactly the
  -- unmatched_token/signature_invalid/malformed_payload case.
  insert into quarantined_inbound_messages (reason, raw_payload)
  values ('unmatched_token', '{"token": "not-a-real-token"}'::jsonb)
  returning id into v_quarantine_id;
  insert into test_fixture_ids values ('p52d_quarantine_unattributed', v_quarantine_id);

  perform assert_that(
    (select count(*) from quarantined_inbound_messages) = 2,
    'Section 9: staff can insert quarantine rows, both attributed and fully unattributable'
  );
end $$;

-- resolution/reviewed_by/reviewed_at must be all-null or all-set together.
select assert_raises(
  format('update quarantined_inbound_messages set resolution = ''discarded'' where id = %L', (select value from test_fixture_ids where key = 'p52d_quarantine_1')),
  'Section 9: resolution cannot be set without reviewed_by/reviewed_at (quarantined_inbound_messages_resolution_pairing)'
);

do $$
begin
  update quarantined_inbound_messages
  set resolution = 'discarded', reviewed_by = auth.uid(), reviewed_at = now()
  where id = (select value from test_fixture_ids where key = 'p52d_quarantine_1');

  perform assert_that(
    (select resolution from quarantined_inbound_messages where id = (select value from test_fixture_ids where key = 'p52d_quarantine_1')) = 'discarded',
    'Section 9: a properly-paired resolution update succeeds'
  );
end $$;

reset role;
select clear_test_user();

-- The fully-unattributable row (org_id null) is visible to ANY staff
-- session, per this migration's own documented tradeoff — proven here
-- with org_b_admin (a genuinely different org).
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

select assert_that(
  (select count(*) from quarantined_inbound_messages where id = (select value from test_fixture_ids where key = 'p52d_quarantine_unattributed')) = 1,
  'Section 9: a fully-unattributable (org_id null) quarantine row is visible to staff at ANY org — the documented tradeoff'
);

select assert_that(
  (select count(*) from quarantined_inbound_messages where id = (select value from test_fixture_ids where key = 'p52d_quarantine_1')) = 0,
  'Section 9: an org-A-attributed quarantine row is NOT visible to org B staff'
);

reset role;
select clear_test_user();

-- A vendor session (even the one the quarantined message concerns) has
-- zero access to this table under any circumstance.
select set_test_user((select value from test_fixture_ids where key = 'p522_delta_user'));
set local role authenticated;

select assert_that(
  (select count(*) from quarantined_inbound_messages) = 0,
  'Section 9: a vendor session has zero access to quarantined_inbound_messages, even for a row naming its own vendor_id'
);

reset role;
select clear_test_user();
