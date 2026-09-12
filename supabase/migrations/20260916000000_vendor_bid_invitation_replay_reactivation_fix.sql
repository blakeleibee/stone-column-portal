-- =====================================================================
-- Stone Column Portal — Migration 029: P5.2 final-review fix —
-- accept_vendor_bid_invitation() token-replay self-reactivation gap.
--
-- FINDING (whole-package cross-phase security audit, after Phases A–E
-- were each independently reviewed clean): accept_vendor_bid_
-- invitation()'s membership upsert —
--
--   insert into public.vendor_members (vendor_id, profile_id, is_primary)
--   values (v_invitation.vendor_id, auth.uid(), v_is_first_member)
--   on conflict (vendor_id, profile_id) do update
--     set revoked_at = null
--     where vendor_members.revoked_at is not null;
--
-- — reactivates a revoked vendor_members row every time this RPC
-- succeeds against a valid (unexpired, unrevoked) invitation TOKEN, with
-- no check that the token had already been used once before. The
-- original invitation email/link a vendor first accepted is never
-- itself revoked, expired early, or marked single-use when staff later
-- revokes that person's membership (revokeVendorMember() only ever
-- touches vendor_members.revoked_at — bid_vendor_access_invitations is
-- untouched). Concretely: staff revokes a vendor colleague through the
-- "Revoke" button in BidPackageWorkspace's Vendor Access panel; that
-- colleague still has their original invitation link sitting in their
-- inbox (up to 14 days old); revisiting that same link re-runs this RPC
-- — their profile/email/role checks all still pass unchanged — and the
-- ON CONFLICT branch above silently clears revoked_at again. Zero staff
-- action required: a revoked vendor can fully undo their own
-- revocation. This is a genuine self-service privilege re-escalation,
-- not a theoretical one — both the Revoke button and this accept path
-- are live, shipped, product-reachable surfaces on this branch.
--
-- THE FIX: restrict the reactivation branch to invitations that have
-- never been successfully accepted before (`v_invitation.accepted_at is
-- null`, read BEFORE this function's own closing UPDATE sets it). This
-- preserves the ONE legitimate case the original code's own comment
-- actually describes — staff creating a genuinely NEW invitation to
-- bring back a previously revoked colleague — since a brand-new
-- invitation row always starts with accepted_at null. It closes the
-- replay path because v_invitation.accepted_at is only ever null the
-- FIRST time a given token/row succeeds; replaying that same row a
-- second time (the exploit) always sees accepted_at already set and is
-- blocked. An explicit post-upsert check then raises a clear error
-- (rather than silently returning "success" while the caller remains
-- revoked under the hood) so a revoked vendor gets an honest message
-- instead of a confusing partial success. Reactivating an already-
-- revoked, already-once-accepted membership now has exactly one path:
-- bidService.ts's reactivateVendorMember(), called from a staff session
-- through BidPackageWorkspace's own Vendor Access panel (the same
-- final-review addition that first made "Revoke" a real button, not
-- just a live-checkpoint-script capability) — an explicit staff action,
-- never a token replay.
--
-- Convention: this repo never edits an already-applied migration file
-- (see schema/023's own doc comment). schema/022 and schema/023 are
-- left completely untouched; this is a NEW, additive migration that
-- re-defines the same function via `create or replace function`. No
-- table, policy, or trigger changes; nothing else about
-- accept_vendor_bid_invitation() (email verification, role check,
-- is_first_member logic, the audit trigger) changes.
-- =====================================================================

create or replace function public.accept_vendor_bid_invitation(p_token text, p_full_name text default null)
returns table(org_id uuid, bid_package_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation bid_vendor_access_invitations%rowtype;
  v_profile profiles%rowtype;
  v_auth_email text;
  v_is_first_member boolean;
begin
  if auth.uid() is null then
    raise exception 'accept_vendor_bid_invitation requires an authenticated caller.';
  end if;

  select * into v_invitation from public.bid_vendor_access_invitations
  where token = p_token and revoked_at is null and expires_at > now();

  if v_invitation.id is null then
    raise exception 'This vendor invitation is invalid, expired, or revoked.';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();

  if v_profile.id is not null then
    -- Case (a): an existing profile is accepting (either a colleague at
    -- an already-registered vendor company, or the same person
    -- accepting a second package's invitation). Anti-spoofing: the
    -- signed-in account's own email must match the invitation's,
    -- exactly like accept_invitation() implicitly relies on Supabase
    -- Auth's own signUp() email for the brand-new-profile case.
    if lower(v_profile.email) is distinct from lower(v_invitation.email) then
      raise exception 'This invitation was issued to a different email address than your signed-in account.';
    end if;
    if v_profile.role <> 'vendor' then
      raise exception 'Only a vendor-role account can accept a vendor bid invitation.';
    end if;
  else
    -- Case (b): brand-new person — the caller must already have called
    -- supabase.auth.signUp() so auth.uid() resolves, exactly mirroring
    -- accept_invitation()'s own ordering. Anti-spoofing (schema/023):
    -- verify the REAL, just-created auth account's own email matches
    -- the invitation's trusted email before creating anything bound to
    -- it — v_invitation.email is a trusted STORED value, but nothing
    -- before schema/023 confirmed the calling session actually owns
    -- that address. auth.users is readable here because this function
    -- is `security definer`.
    select email into v_auth_email from auth.users where id = auth.uid();
    if lower(v_auth_email) is distinct from lower(v_invitation.email) then
      raise exception 'This invitation was issued to a different email address than your signed-in account.';
    end if;

    if p_full_name is null or trim(p_full_name) = '' then
      raise exception 'Full name is required to create a new vendor account.';
    end if;
    insert into public.profiles (id, org_id, role, full_name, email)
    values (auth.uid(), v_invitation.org_id, 'vendor', trim(p_full_name), v_invitation.email);
  end if;

  -- is_primary: true only for the FIRST active member this vendor
  -- company ever gets — a reasonable default, never load-bearing for
  -- access itself (is_vendor_member() ignores is_primary entirely).
  select not exists (
    select 1 from public.vendor_members
    where vendor_id = v_invitation.vendor_id and revoked_at is null
  ) into v_is_first_member;

  -- Idempotent for an already-ACTIVE member (accepting a second
  -- invitation to the same vendor company, or re-clicking a still-valid
  -- link before it's ever been revoked, is a harmless no-op — the
  -- WHERE-less ON CONFLICT DO NOTHING semantics never apply here since
  -- there's always a targeted DO UPDATE below).
  --
  -- Migration 029 fix: reactivation (clearing a set revoked_at) is now
  -- gated on `v_invitation.accepted_at is null` in ADDITION to
  -- `vendor_members.revoked_at is not null` — i.e. this SPECIFIC
  -- invitation row must never have been successfully accepted before.
  -- A brand-new invitation (staff genuinely re-inviting a previously
  -- revoked colleague) always has accepted_at null here and reactivates
  -- normally; a REPLAY of an already-used token always has accepted_at
  -- already set (by this same function's own closing UPDATE, the first
  -- time it succeeded) and is blocked.
  insert into public.vendor_members (vendor_id, profile_id, is_primary)
  values (v_invitation.vendor_id, auth.uid(), v_is_first_member)
  on conflict (vendor_id, profile_id) do update
    set revoked_at = null
    where vendor_members.revoked_at is not null
      and v_invitation.accepted_at is null;

  -- Explicit, honest failure rather than a silent partial success: if
  -- the caller's membership is STILL revoked after the upsert above
  -- (the replay case, or any other state where revocation legitimately
  -- stands), tell them plainly instead of returning org_id/bid_package_id
  -- as if they now have access — they don't; every RLS policy in this
  -- domain still gates on is_vendor_member(), which checks this exact
  -- column.
  if exists (
    select 1 from public.vendor_members
    where vendor_id = v_invitation.vendor_id and profile_id = auth.uid() and revoked_at is not null
  ) then
    raise exception 'Your access to this vendor account has been revoked. Contact Stone Column Custom Homes & Remodeling for a new invitation.';
  end if;

  update public.bid_vendor_access_invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_invitation.id and accepted_at is null;

  org_id := v_invitation.org_id;
  bid_package_id := v_invitation.bid_package_id;
  return next;
end;
$$;

revoke all on function public.accept_vendor_bid_invitation(text, text) from public;
grant execute on function public.accept_vendor_bid_invitation(text, text) to authenticated;
