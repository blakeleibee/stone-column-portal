-- =====================================================================
-- Stone Column Portal — P5.2 final-review fix SQL test suite, covering
-- schema/029_vendor_bid_invitation_replay_reactivation_fix.sql.
-- Runs after every earlier P5.2 test file. Reused fixtures: 'admin',
-- 'project_a', 'cost_code_a' (from package1_tests.sql).
--
-- Proves the exact exploit the whole-package cross-phase security audit
-- found: before schema/029, a vendor whose vendor_members row staff had
-- just revoked could undo that revocation themselves by simply
-- revisiting their OWN original invitation link (a token that is never
-- itself revoked, expired early, or made single-use when membership is
-- revoked) — zero staff action required. Self-contained fixtures (a new
-- vendor company, a new vendor profile, a new bid package) rather than
-- reusing package_p5_2_vendor_bid_access_phase_a_tests.sql's fixtures,
-- so this file's pass/fail is never sensitive to exactly what state an
-- earlier file's own scenarios happened to leave its fixtures in.
-- =====================================================================

create temporary table if not exists test_fixture_tokens (key text primary key, value text);
grant select, insert, update, delete on test_fixture_tokens to authenticated, anon;

-- ---------------------------------------------------------------------
-- SECTION 1 — fixtures: one vendor company, one brand-new vendor
-- contact who accepts a real invitation end-to-end (exactly the
-- production accept_vendor_bid_invitation() path), one bid package.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_vendor uuid;
  v_bid_package uuid;
  v_invitation_id uuid;
  v_token text;
begin
  insert into vendors (org_id, name)
  select org_id, 'Zeta HVAC (final-review replay test)' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_vendor;
  insert into test_fixture_ids values ('p52fr_vendor', v_vendor);

  insert into bid_packages (project_id, cost_code_id, title, scope_description, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'HVAC Bid Package (P5.2 final-review replay test)', 'Full HVAC scope', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_bid_package;
  insert into test_fixture_ids values ('p52fr_bid_package', v_bid_package);

  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_bid_package, v_vendor);

  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
  select
    (select org_id from vendors where id = v_vendor),
    v_bid_package,
    v_vendor,
    'contact@zetahvac.example'
  returning id, token into v_invitation_id, v_token;

  insert into test_fixture_ids values ('p52fr_invitation_original', v_invitation_id);
  insert into test_fixture_tokens values ('p52fr_original_token', v_token);
end $$;

reset role;
select clear_test_user();

-- Brand-new person accepts, exactly like a real supabase.auth.signUp()
-- followed by accept_vendor_bid_invitation() — same shape as
-- package_p5_2_vendor_bid_access_phase_a_tests.sql's own Section 4.
do $$
declare
  v_new_person uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_new_person, 'contact@zetahvac.example');
  insert into test_fixture_ids values ('p52fr_user', v_new_person);
end $$;

select set_test_user((select value from test_fixture_ids where key = 'p52fr_user'));
set local role authenticated;

do $$
declare
  v_result record;
begin
  select * into v_result from accept_vendor_bid_invitation(
    (select value from test_fixture_tokens where key = 'p52fr_original_token'),
    'Zeta HVAC Contact'
  );
  perform assert_that(v_result.bid_package_id = (select value from test_fixture_ids where key = 'p52fr_bid_package'), 'setup: brand-new person successfully accepts the original invitation');
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p52fr_bid_package')) = 1,
    'setup: the newly-accepted vendor can read the bid package via ordinary RLS'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 2 — the exploit: staff revokes this person's membership
-- (exactly what bidService.ts's revokeVendorMember() does — see
-- schema/015's own vendor_members_identity_and_revocation trigger,
-- which requires revoked_by = the acting session's own auth.uid()),
-- then the revoked person replays their ORIGINAL, already-accepted
-- token. Before schema/029 this silently cleared revoked_at again with
-- zero further staff action; after schema/029 it must fail outright and
-- leave revoked_at untouched.
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update vendor_members set revoked_at = now(), revoked_by = (select value from test_fixture_ids where key = 'admin')
  where vendor_id = (select value from test_fixture_ids where key = 'p52fr_vendor')
    and profile_id = (select value from test_fixture_ids where key = 'p52fr_user');
end $$;

reset role;
select clear_test_user();

-- Sanity: revocation takes effect immediately (matches Phase A's own
-- Scenario 3), before the replay attempt even happens.
select set_test_user((select value from test_fixture_ids where key = 'p52fr_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p52fr_bid_package')) = 0,
    'revocation takes effect immediately — the revoked vendor loses bid package access before any replay attempt'
  );
end $$;

reset role;
select clear_test_user();

-- THE EXPLOIT ATTEMPT — replaying the same, already-accepted,
-- never-itself-revoked/expired original token as the now-revoked
-- person. schema/029's fix must reject this outright.
select set_test_user((select value from test_fixture_ids where key = 'p52fr_user'));
set local role authenticated;

select assert_raises(
  format(
    'select * from accept_vendor_bid_invitation(%L, null)',
    (select value from test_fixture_tokens where key = 'p52fr_original_token')
  ),
  'schema/029 fix: replaying the ORIGINAL already-accepted invitation token after revocation must be rejected, not silently reactivate the caller'
);

reset role;
select clear_test_user();

-- Confirm the failed replay left revoked_at untouched (not merely that
-- the RPC raised — the row itself must genuinely still be revoked, not
-- reactivated-then-re-revoked-by-something-else).
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select revoked_at from vendor_members where vendor_id = (select value from test_fixture_ids where key = 'p52fr_vendor') and profile_id = (select value from test_fixture_ids where key = 'p52fr_user')) is not null,
    'the failed replay attempt left vendor_members.revoked_at set — no silent reactivation occurred'
  );
end $$;

reset role;
select clear_test_user();

-- End-to-end confirmation via RLS (not just the raw column): the
-- revoked vendor still cannot read the bid package after the failed
-- replay — no side-channel reactivation happened.
select set_test_user((select value from test_fixture_ids where key = 'p52fr_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p52fr_bid_package')) = 0,
    'after the failed replay attempt, the revoked vendor still cannot read the bid package — the fix holds end-to-end, not just at the raw column'
  );
end $$;

reset role;
select clear_test_user();

-- ---------------------------------------------------------------------
-- SECTION 3 — the legitimate case the fix must NOT break: staff issuing
-- a genuinely NEW invitation (a fresh row, accepted_at null) to bring
-- the same, still-revoked person back. This is now the ONLY path back
-- from revocation other than bidService.ts's explicit
-- reactivateVendorMember() (the "Reactivate" button added alongside
-- this same fix in BidPackageWorkspace's Vendor Access panel).
-- ---------------------------------------------------------------------
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_new_invitation_id uuid;
  v_new_token text;
begin
  insert into bid_vendor_access_invitations (org_id, bid_package_id, vendor_id, email)
  select
    (select org_id from vendors where id = (select value from test_fixture_ids where key = 'p52fr_vendor')),
    (select value from test_fixture_ids where key = 'p52fr_bid_package'),
    (select value from test_fixture_ids where key = 'p52fr_vendor'),
    'contact@zetahvac.example'
  returning id, token into v_new_invitation_id, v_new_token;

  insert into test_fixture_ids values ('p52fr_invitation_reinvite', v_new_invitation_id);
  insert into test_fixture_tokens values ('p52fr_reinvite_token', v_new_token);
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'p52fr_user'));
set local role authenticated;

do $$
declare
  v_result record;
begin
  select * into v_result from accept_vendor_bid_invitation(
    (select value from test_fixture_tokens where key = 'p52fr_reinvite_token'),
    null
  );
  perform assert_that(v_result.bid_package_id = (select value from test_fixture_ids where key = 'p52fr_bid_package'), 'a genuinely NEW invitation (never before accepted) still successfully reactivates a revoked member');
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'p52fr_bid_package')) = 1,
    'end-to-end: access is restored via ordinary RLS once the new-invitation path reactivates the membership'
  );
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select revoked_at from vendor_members
     where vendor_id = (select value from test_fixture_ids where key = 'p52fr_vendor')
       and profile_id = (select value from test_fixture_ids where key = 'p52fr_user')) is null,
    'vendor_members.revoked_at is genuinely cleared by the legitimate new-invitation path'
  );
end $$;

reset role;
select clear_test_user();
