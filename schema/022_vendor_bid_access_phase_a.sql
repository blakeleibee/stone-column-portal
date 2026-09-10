-- =====================================================================
-- Stone Column Portal — Migration 022: P5.2 Phase A — vendor bid access
-- RLS fix + first-access (magic-link) foundation.
-- See docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md, Section 5,
-- "P5.2 — Vendor Bid Access, Documents, Invitations & Correspondence,"
-- Part A. This migration implements ONLY Phase A of P5.2: the RLS
-- access-gap fix and the minimum real vendor-facing surface needed to
-- prove it end-to-end. Documents, bid submission/revision, Q&A UI,
-- correspondence, and email delivery are later phases — untouched here.
--
-- =====================================================================
-- THE CONFIRMED BUG
-- =====================================================================
-- bidService.ts's inviteVendor() only ever inserts a bid_submissions
-- row linking a VENDOR COMPANY to a bid package. It never creates a
-- project_members row for any PERSON. schema/007's is_project_vendor()
-- checks project_members (project_id, user_id=auth.uid(),
-- member_role='vendor') — a per-PERSON grant. schema/015's
-- bid_packages_vendor_read required BOTH is_project_vendor(project_id)
-- AND is_invited_vendor_for_bid_package(id). A real vendor session,
-- invited today, satisfies only the second condition and is denied
-- read access to the bid package itself.
--
-- =====================================================================
-- THE FIX: Option B (self-sufficient, transitive, no project_members
-- dependency) — chosen over Option A (have inviteVendor()/a future
-- vendor_members insert path also maintain project_members rows).
-- =====================================================================
-- Reasoning, confirmed against the actual schema (not assumed):
--
-- 1. schema/015's own is_invited_vendor_for_bid_package(p_bid_package_id)
--    ALREADY performs the exact transitive check the task's Option B
--    proposes inventing from scratch: vendor_members (active membership,
--    via is_vendor_member()) -> bid_submissions, filtered to the one
--    p_bid_package_id being evaluated. It has zero dependency on
--    project_members today. Since bid_packages_vendor_read's own USING
--    clause is evaluated once per candidate ROW (bid_packages.id IS
--    that row's id), calling is_invited_vendor_for_bid_package(id)
--    ALONE is already both necessary and sufficient — no new helper
--    function is needed; the correct "self-sufficient" helper already
--    exists and was simply being needlessly AND-ed with a broken one.
-- 2. This is not a novel pattern being trusted for the first time:
--    bid_questions_vendor_insert (schema/015, still dormant pre-P5.2)
--    already re-derives invitation status the identical way (an EXISTS
--    against bid_submissions filtered by bid_package_id AND vendor_id),
--    with zero reliance on project_members. Option B matches this
--    codebase's own established, already-shipped pattern; Option A
--    would introduce a second, parallel, DB-synchronized access model
--    alongside it.
-- 3. is_project_vendor() (schema/007) has EXACTLY ONE call site in the
--    entire schema — the very policy this migration fixes (confirmed
--    by direct grep across schema/). Removing it from
--    bid_packages_vendor_read leaves it fully defined, untouched, and
--    orphaned-but-harmless — exactly the instruction ("leave it and its
--    other call sites completely alone"), since there are no other
--    call sites to preserve.
-- 4. Option A's own stated risk (a new vendor_members row for an
--    ALREADY-invited company requires separately creating a
--    project_members row for that new person, forever, or they silently
--    have no access) simply does not exist under Option B: access is
--    computed live from vendor_members + bid_submissions + bid_packages
--    every time, so a brand-new employee of an already-invited vendor
--    company gets working access the instant their vendor_members row
--    exists — no second write path to keep in sync, ever.
--
-- =====================================================================
-- ADDITIONAL GAP FOUND DURING THE REQUIRED AUDIT OF THE OTHER FOUR
-- VENDOR-FACING POLICIES (bid_submissions_vendor_read/vendor_update,
-- bid_questions_vendor_read/vendor_insert, bid_addenda_vendor_read):
-- =====================================================================
-- - bid_submissions_vendor_read / bid_submissions_vendor_update: both
--   gate purely on is_vendor_member(vendor_id) — already self-sufficient,
--   no is_project_vendor() dependency, already correctly scoped (the ROW
--   itself is the specific vendor+package pairing). NO CHANGE.
-- - bid_addenda_vendor_read: already an EXISTS against bid_submissions
--   filtered by bid_addenda.bid_package_id — already self-sufficient
--   and already package-scoped. NO CHANGE.
-- - bid_questions_vendor_insert: already re-derives invitation via an
--   EXISTS against bid_submissions filtered by bid_package_id AND
--   vendor_id — already self-sufficient. NO CHANGE.
-- - bid_questions_vendor_read: a REAL, SEPARATE, and arguably WORSE gap
--   found here, unrelated to is_project_vendor(): its
--   `visible_to_all_vendors OR (vendor_id is not null and
--   is_vendor_member(vendor_id))` USING clause never checks that the
--   reading session is invited to THIS SPECIFIC bid_package_id at all.
--   A broadcast question (visible_to_all_vendors=true, the DEFAULT) is
--   therefore readable by ANY authenticated vendor session anywhere in
--   the org — even one invited to zero packages, or invited only to an
--   unrelated package in a different project — once a real vendor
--   session exists to exercise it (which this very migration is what
--   first makes possible). Dormant-but-real; fixed below by adding the
--   same is_invited_vendor_for_bid_package(bid_package_id) gate every
--   other vendor-visible row in this domain already requires, without
--   changing the broadcast-vs-private semantics of the OR itself.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fix 1: bid_packages_vendor_read — drop the broken is_project_vendor()
-- dependency. is_invited_vendor_for_bid_package(id) alone is already
-- the complete, correct, self-sufficient check.
-- ---------------------------------------------------------------------
drop policy bid_packages_vendor_read on bid_packages;

create policy bid_packages_vendor_read on bid_packages
  for select to authenticated
  using (is_invited_vendor_for_bid_package(bid_packages.id));

-- ---------------------------------------------------------------------
-- Fix 2: bid_questions_vendor_read — close the broadcast-question leak
-- found during the audit above. A vendor must be invited to THIS
-- package before either branch of the visibility OR can ever apply.
-- ---------------------------------------------------------------------
drop policy bid_questions_vendor_read on bid_questions;

create policy bid_questions_vendor_read on bid_questions
  for select to authenticated
  using (
    is_invited_vendor_for_bid_package(bid_questions.bid_package_id)
    and (
      visible_to_all_vendors
      or (vendor_id is not null and is_vendor_member(vendor_id))
    )
  );

-- ---------------------------------------------------------------------
-- Fix 3 (new, additive — required for Phase A's own vendor screen):
-- cost_codes has only staff and client read policies (schema/001,
-- schema/016) — no vendor policy exists at all. The Phase A vendor bid
-- screen must resolve bid_packages.cost_code_id to a human-readable
-- code (this codebase's own established convention: never show a raw
-- UUID to any user), so a vendor session needs to read exactly the
-- cost_codes row backing a package they're invited to — nothing more.
-- Scoped identically to the double-gate philosophy this domain already
-- uses everywhere else: only via an invited bid package, never a
-- blanket project-wide grant (a vendor still cannot read every cost
-- code on a project just because they're invited to one package on it).
-- ---------------------------------------------------------------------
create policy cost_codes_vendor_read on cost_codes
  for select to authenticated
  using (
    exists (
      select 1 from bid_packages bp
      where bp.project_id = cost_codes.project_id
        and bp.cost_code_id = cost_codes.id
        and is_invited_vendor_for_bid_package(bp.id)
    )
  );

-- =====================================================================
-- Vendor first-access (magic-link) foundation.
--
-- Reuses the SHAPE of the existing invitations table's magic-link
-- pattern (schema/009, staff/client onboarding) as its closest
-- precedent — token/expiry/revoke/accept-once — but as a DEDICATED,
-- bid-specific table rather than adding vendor/bid-package columns to
-- the shared `invitations` table, for two reasons: (1) `invitations`'
-- accept_invitation() RPC is an already-shipped, already-tested path
-- for staff/client onboarding that this phase must not risk regressing;
-- (2) P5-EXTENSION-PACKAGES-DESIGN.md's own future Part D names a
-- DIFFERENT, real-email-delivery table (`bid_invitation_emails`) for
-- this exact purpose — this table is this phase's explicit, temporary
-- stand-in for that (manual copy/paste token, no email), not a
-- permanent parallel mechanism Phase D has to reconcile against a
-- shared table's semantics. Phase D replaces/retires this table.
--
-- No RLS policy anywhere grants the invited party direct table access
-- — exactly matching invitations' own documented posture — acceptance
-- happens only through accept_vendor_bid_invitation() below.
-- =====================================================================
create table bid_vendor_access_invitations (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid not null references orgs(id),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  vendor_id      uuid not null references vendors(id),
  email          text not null,
  token          text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at     timestamptz not null default (now() + interval '14 days'),
  accepted_at    timestamptz,
  accepted_by    uuid references profiles(id),
  revoked_at     timestamptz,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),

  constraint bid_vendor_access_invitations_not_accepted_and_revoked
    check (accepted_at is null or revoked_at is null)
);

alter table bid_vendor_access_invitations enable row level security;

-- Defense in depth, mirroring vendor_members_org_match exactly: a
-- staff session can only ever select a vendor already scoped to their
-- own org (RLS on `vendors`), but this closes the gap at the DB level
-- too, not just via the UI's own vendor selector.
create or replace function public.enforce_bid_vendor_access_invitation_org_match() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_vendor_org uuid;
  v_package_org uuid;
begin
  select org_id into v_vendor_org from public.vendors where id = new.vendor_id;
  select p.org_id into v_package_org
  from public.bid_packages bp join public.projects p on p.id = bp.project_id
  where bp.id = new.bid_package_id;

  if v_vendor_org is distinct from v_package_org then
    raise exception 'Cannot invite vendor % to bid package % — org mismatch (vendor org %, package org %)',
      new.vendor_id, new.bid_package_id, v_vendor_org, v_package_org;
  end if;
  if new.org_id is distinct from v_vendor_org then
    raise exception 'bid_vendor_access_invitations.org_id (%) must match the invited vendor''s own org (%)',
      new.org_id, v_vendor_org;
  end if;
  return new;
end;
$$;

create trigger bid_vendor_access_invitations_org_match
  before insert or update on bid_vendor_access_invitations
  for each row execute function public.enforce_bid_vendor_access_invitation_org_match();

create policy bid_vendor_access_invitations_staff_manage on bid_vendor_access_invitations
  for all to authenticated
  using (is_org_staff(get_bid_package_project_id(bid_vendor_access_invitations.bid_package_id)))
  with check (is_org_staff(get_bid_package_project_id(bid_vendor_access_invitations.bid_package_id)));

create trigger audit_bid_vendor_access_invitations after insert or update on bid_vendor_access_invitations
  for each row execute function public.log_audit_via_bid_package();

-- ---------------------------------------------------------------------
-- accept_vendor_bid_invitation(): the one RPC covering BOTH first-access
-- shapes named in P5-EXTENSION-PACKAGES-DESIGN.md's P5.2 Part D /
-- Section 10: (a) an already-registered vendor profile (the invited
-- company already has a registered user — including this same person
-- accepting a SECOND package invitation) simply gets linked/confirmed,
-- no new profile created; (b) a brand-new person is walked through
-- Supabase Auth sign-up (already completed by the caller before this
-- RPC runs, mirroring accept_invitation()'s own division of labor) and
-- gets a real profile + vendor_members row created here.
--
-- Deliberately a NEW function, not a modification of accept_invitation()
-- — keeps the already-shipped staff/client onboarding path completely
-- untouched while this vendor-specific path adds its own fields
-- (vendor_id linkage, bid_package_id for post-accept redirect) that
-- don't belong on the generic RPC.
-- ---------------------------------------------------------------------
create or replace function public.accept_vendor_bid_invitation(p_token text, p_full_name text default null)
returns table(org_id uuid, bid_package_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation bid_vendor_access_invitations%rowtype;
  v_profile profiles%rowtype;
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
    -- accept_invitation()'s own ordering.
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

  -- Idempotent: accepting a second invitation to the same vendor
  -- company for an already-active member is a no-op here (ON CONFLICT
  -- DO NOTHING's WHERE-less branch below never fires for them because
  -- the row already exists and isn't revoked — the second, targeted
  -- DO UPDATE branch only reactivates a REVOKED membership, e.g. a
  -- staff member revoked someone and is now re-inviting them).
  insert into public.vendor_members (vendor_id, profile_id, is_primary)
  values (v_invitation.vendor_id, auth.uid(), v_is_first_member)
  on conflict (vendor_id, profile_id) do update
    set revoked_at = null
    where vendor_members.revoked_at is not null;

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
