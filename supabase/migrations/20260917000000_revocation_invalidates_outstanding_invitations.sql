-- =====================================================================
-- Stone Column Portal — Migration 030: revoking a vendor contact must
-- invalidate that contact's outstanding bid-access invitations.
--
-- FINDING (independent external review of the P5.2 package, after
-- schema/029 had shipped and been verified). schema/029 closed the
-- original replay hole — a revoked contact replaying their own
-- ALREADY-ACCEPTED token to clear their own vendor_members.revoked_at —
-- by gating accept_vendor_bid_invitation()'s reactivating ON CONFLICT
-- branch on `v_invitation.accepted_at is null`.
--
-- That gate keys on the SPECIFIC invitation row being presented, not on
-- whether the contact is currently revoked. An invitation that has
-- never been accepted still satisfies `accepted_at is null`, so it
-- still reactivates a revoked member. Staff routinely issue more than
-- one invitation to the same contact — a re-send because the first
-- landed in spam, an invitation to a second bid package, a double
-- click. Any one of those, left unused in the contact's inbox, is a
-- live key that undoes their revocation:
--
--   1. Staff invite contact@example  (invitation #1)
--   2. Staff invite them again       (invitation #2 — never used)
--   3. Contact accepts #1, gains access
--   4. Staff revoke the contact
--   5. Contact opens #2 → schema/029's gate passes → revoked_at cleared
--
-- Zero staff action required. Same self-service privilege
-- re-escalation as the original finding, through a different door.
--
-- THE FIX. Revocation now invalidates every outstanding invitation
-- belonging to that contact at that vendor company, via an AFTER
-- trigger on vendor_members. Implemented in the database rather than in
-- bidService.revokeVendorMember() on purpose: revocation also happens
-- from checkpoint scripts and could happen from a future Server Action,
-- admin tool, or direct SQL, and the invariant "a revoked contact holds
-- no usable invitation" must not depend on the caller remembering.
--
-- WHAT ABOUT THE ALREADY-ACCEPTED INVITATION? It is deliberately left
-- alone. schema/022's own CHECK constraint
-- (bid_vendor_access_invitations_not_accepted_and_revoked) forbids a
-- row being simultaneously accepted and revoked, so "revoked" is not
-- representable for it. It does not need to be: schema/029's
-- `accepted_at is null` gate already makes it permanently unusable for
-- reactivation. Between the two mechanisms every invitation held by a
-- revoked contact is unusable — unaccepted ones because this migration
-- revokes them, accepted ones because of the 029 gate.
--
-- RESTORING ACCESS therefore requires a deliberate staff action, which
-- is the intended product rule: either the explicit "Reactivate" button
-- (bidService.reactivateVendorMember()), or issuing a genuinely NEW
-- invitation after the revocation. Both remain fully working.
--
-- Convention: this repo never edits an already-applied migration file.
-- schema/022 and schema/029 are left untouched; this is a NEW, additive
-- migration. No table or policy changes — one new trigger function and
-- one new trigger.
-- =====================================================================

create or replace function public.revoke_outstanding_vendor_invitations_on_member_revocation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  -- Only act on the transition into revoked. Reactivation (revoked_at
  -- back to null) must NOT resurrect anything: invitations revoked by a
  -- previous revocation stay revoked, so reactivation grants exactly
  -- the access the staff member intended and no dormant token comes
  -- back to life with it.
  if new.revoked_at is null or old.revoked_at is not null then
    return new;
  end if;

  select email into v_email from public.profiles where id = new.profile_id;
  if v_email is null then
    return new;
  end if;

  -- Scope: this contact's invitations at THIS vendor company. Matches
  -- the blast radius of the revocation itself — vendor_members is
  -- per (vendor_id, profile_id), and the staff-facing caption says the
  -- action ends this person's access for this vendor company.
  --
  -- `accepted_at is null` is required by schema/022's
  -- not_accepted_and_revoked CHECK constraint; already-accepted rows
  -- are handled by schema/029's gate instead (see header).
  update public.bid_vendor_access_invitations
  set revoked_at = now()
  where vendor_id = new.vendor_id
    and lower(email) = lower(v_email)
    and accepted_at is null
    and revoked_at is null;

  return new;
end;
$$;

comment on function public.revoke_outstanding_vendor_invitations_on_member_revocation() is
  'Migration 030: when a vendor_members row is revoked, revokes every unaccepted, unrevoked bid-access invitation for that contact at that vendor, so no unused token can silently undo the revocation. Accepted invitations are covered by schema/029''s accepted_at gate.';

create trigger vendor_members_revoke_outstanding_invitations
  after update on vendor_members
  for each row execute function public.revoke_outstanding_vendor_invitations_on_member_revocation();
