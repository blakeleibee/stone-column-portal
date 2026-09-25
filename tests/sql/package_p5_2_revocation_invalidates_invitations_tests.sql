-- =====================================================================
-- Stone Column Portal — P5.2 post-external-review fix SQL test suite,
-- covering schema/030_revocation_invalidates_outstanding_invitations.sql.
--
-- BACKGROUND. schema/029 closed the ORIGINAL replay hole: a revoked
-- vendor contact replaying their own ALREADY-ACCEPTED invitation token
-- could silently clear their own vendor_members.revoked_at. It did so
-- by gating the reactivating ON CONFLICT branch on
-- `v_invitation.accepted_at is null`.
--
-- THE REMAINING HOLE (found by an independent external review of the
-- P5.2 package, after schema/029 shipped). That gate keys on the
-- SPECIFIC invitation row being replayed, not on the contact's
-- revocation. So an invitation that has NEVER been accepted still
-- satisfies `accepted_at is null` and still reactivates a revoked
-- member. Staff routinely issue more than one invitation to the same
-- contact — a re-send because the first went to spam, an invitation to
-- a second bid package, a duplicate click. Concretely:
--
--   1. Staff invite contact@example (invitation #1).
--   2. Staff invite the same contact again (invitation #2) — never used.
--   3. The contact accepts #1 and gets access.
--   4. Staff revoke that contact.
--   5. The contact opens invitation #2 — still sitting in their inbox,
--      never accepted, unexpired, unrevoked — and schema/029's gate
--      passes, silently clearing revoked_at. Zero staff action.
--
-- Same self-service privilege re-escalation as the original finding,
-- reached through a different door.
--
-- THE FIX (schema/030): revocation is made to invalidate EVERY
-- outstanding invitation belonging to that contact at that vendor
-- company — accepted or not — via a database trigger on vendor_members,
-- so it holds no matter who performs the revocation (Server Action,
-- checkpoint script, or a direct SQL update like the one below).
-- Restoring access therefore requires a deliberate new staff action:
-- either the explicit "Reactivate" button, or issuing a genuinely NEW
-- invitation after the revocation.
--
-- Self-contained fixtures, same convention as
-- package_p5_2_final_review_replay_reactivation_fix_tests.sql. Reused
-- fixtures: 'admin', 'project_a', 'cost_code_a' (package1_tests.sql).
-- =====================================================================

create temporary table if not exists test_fixture_tokens (key text primary key, value text);
grant select, insert, update, delete on test_fixture_tokens to authenticated, anon;

-- ---------------------------------------------------------------------
-- SECTION 1 — fixtures: one vendor company, one bid package, and TWO
-- outstanding invitations issued to the SAME contact email. Only the
-- first is ever accepted; the second stays unused throughout.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_vendor uuid;
  v_bid_package uuid;
  v_invitation_one uuid;
  v_token_one text;
  v_invitation_two uuid;
  v_token_two text;
  v_org uuid;
begin
  insert into vendors (org_id, name)
  select org_id, 'Omega Glazing (revocation-invalidates-invitations test)' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id, org_id into v_vendor, v_org;
  insert into test_fixture_ids values ('p52ri_vendor', v_vendor);

  insert into bid_packages (project_id, cost_code_id, title, scope_description, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Glazing Bid Package (revocation-invalidates-invitations test)', 'Storefront glazing scope', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_bid_package;
  insert into test_fixture_ids values ('p52ri_bid_package', v_bid_package);

  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_bid_package, v_vendor);

  -- Invitation #1 — the one that actually gets accepted.
  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
  values (v_org, v_bid_package, v_vendor, 'contact@omegaglazing.example')
  returning id, token into v_invitation_one, v_token_one;
  insert into test_fixture_ids values ('p52ri_invitation_one', v_invitation_one);
  insert into test_fixture_tokens values ('p52ri_token_one', v_token_one);

  -- Invitation #2 — a second, entirely legitimate invitation to the
  -- SAME contact (a re-send, or an invite to another package). Never
  -- accepted. This is the token the exploit uses.
  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
  values (v_org, v_bid_package, v_vendor, 'contact@omegaglazing.example')
  returning id, token into v_invitation_two, v_token_two;
  insert into test_fixture_ids values ('p52ri_invitation_two', v_invitation_two);
  insert into test_fixture_tokens values ('p52ri_token_two', v_token_two);
end $$;

reset role;
select clear_test_user();

do $$
declare
  v_new_person uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_new_person, 'contact@omegaglazing.example');
  insert into test_fixture_ids values ('p52ri_user', v_new_person);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'p52ri_user'));
set local role authenticated;

do $$
declare
  v_result record;
begin
  select * into v_result from accept_vendor_bid_invitation(
    (select value from test_fixture_tokens where key = 'p52ri_token_one'),
    'Omega Glazing Contact'
  );
  perform assert_that(v_result.bid_package_id = (select value from test_fixture_ids where key = 'p52ri_bid_package'), 'setup: the contact accepts invitation #1 and gains access');
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 2 — staff revoke the contact. Revocation must now invalidate
-- EVERY outstanding invitation for that contact at that vendor, so no
-- unused token is left lying around that can undo the revocation.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update vendor_members set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where vendor_id = (select value from test_fixture_ids where key = 'p52ri_vendor')
    and profile_id = (select value from test_fixture_ids where key = 'p52ri_user');
end $$;

do $$
begin
  perform assert_that(
    (select revoked_at from bid_vendor_access_invitations where id = (select value from test_fixture_ids where key = 'p52ri_invitation_two')) is not null,
    'schema/030: revoking the contact also revokes their UNUSED outstanding invitation #2'
  );
  -- The already-ACCEPTED invitation #1 is deliberately NOT marked
  -- revoked: bid_vendor_access_invitations_not_accepted_and_revoked
  -- (schema/022) forbids a row being both accepted and revoked, so
  -- "revoked" is not even representable for it. It is made unusable by
  -- schema/029's `accepted_at is null` gate instead — asserted
  -- end-to-end in Section 3 below, which is the assertion that actually
  -- matters. Between the two mechanisms, EVERY invitation belonging to
  -- a revoked contact is unusable: unaccepted ones by revocation,
  -- accepted ones by the accepted_at gate.
  perform assert_that(
    (select accepted_at from bid_vendor_access_invitations where id = (select value from test_fixture_ids where key = 'p52ri_invitation_one')) is not null
    and (select revoked_at from bid_vendor_access_invitations where id = (select value from test_fixture_ids where key = 'p52ri_invitation_one')) is null,
    'the already-ACCEPTED invitation #1 stays accepted-and-unrevoked, because the not_accepted_and_revoked CHECK constraint makes "revoked" unrepresentable for it'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 3 — THE EXPLOIT: the revoked contact opens the never-used
-- invitation #2. Before schema/030 this passed schema/029's
-- `accepted_at is null` gate and silently reactivated them.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'p52ri_user'));
set local role authenticated;

select assert_raises(
  format(
    'select * from accept_vendor_bid_invitation(%L, null)',
    (select value from test_fixture_tokens where key = 'p52ri_token_two')
  ),
  'schema/030 fix: a revoked contact accepting their still-UNUSED second invitation must be rejected, not silently reactivate them'
);

reset role;
select clear_test_user();

-- The old schema/029 case must still hold too — replaying the ORIGINAL,
-- already-accepted token stays blocked.
select set_test_user((select value from test_fixture_ids where key = 'p52ri_user'));
set local role authenticated;

select assert_raises(
  format(
    'select * from accept_vendor_bid_invitation(%L, null)',
    (select value from test_fixture_tokens where key = 'p52ri_token_one')
  ),
  'schema/029 regression: replaying the ORIGINAL already-accepted token after revocation is still rejected'
);

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select revoked_at from vendor_members
     where vendor_id = (select value from test_fixture_ids where key = 'p52ri_vendor')
       and profile_id = (select value from test_fixture_ids where key = 'p52ri_user')) is not null,
    'after BOTH failed acceptance attempts, vendor_members.revoked_at is still set — no silent reactivation by either token'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p52ri_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p52ri_bid_package')) = 0,
    'end-to-end via RLS: after both failed attempts the revoked contact still cannot read the bid package'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 4 — the deliberate staff action that MUST still work: after
-- the revocation, staff issue a genuinely NEW invitation. That is an
-- explicit staff decision to restore access, so it must succeed.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_new_invitation uuid;
  v_new_token text;
begin
  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
  select
    (select org_id from vendors where id = (select value from test_fixture_ids where key = 'p52ri_vendor')),
    (select value from test_fixture_ids where key = 'p52ri_bid_package'),
    (select value from test_fixture_ids where key = 'p52ri_vendor'),
    'contact@omegaglazing.example'
  returning id, token into v_new_invitation, v_new_token;
  insert into test_fixture_ids values ('p52ri_invitation_new', v_new_invitation);
  insert into test_fixture_tokens values ('p52ri_token_new', v_new_token);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p52ri_user'));
set local role authenticated;

do $$
declare
  v_result record;
begin
  select * into v_result from accept_vendor_bid_invitation(
    (select value from test_fixture_tokens where key = 'p52ri_token_new'),
    null
  );
  perform assert_that(v_result.bid_package_id = (select value from test_fixture_ids where key = 'p52ri_bid_package'), 'a genuinely NEW invitation issued AFTER the revocation still restores access — the deliberate staff path is preserved');
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p52ri_bid_package')) = 1,
    'end-to-end: access is genuinely restored via RLS through the new-invitation path'
  );
end $$;

reset role;
select clear_test_user();
