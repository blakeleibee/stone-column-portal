-- =====================================================================
-- Stone Column Portal — Migration 023 ROLLBACK.
-- Restores accept_vendor_bid_invitation() to its exact schema/022 body
-- (brand-new-signup path with no email-verification check). No table,
-- policy, or trigger changes to reverse — this migration only replaced
-- one function body.
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
