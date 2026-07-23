-- =====================================================================
-- Stone Column Portal — Migration 009: invitations.
--
-- No email delivery in this package (no email-provider credential
-- available/chosen) -- an admin generates the row, copies the token
-- into a link, and sends it manually. accept_invitation() is the
-- SECURITY DEFINER RPC an invited (already Supabase-Auth-signed-up)
-- user calls once, mirroring bootstrap_organization()'s pattern:
-- narrowly scoped, self-escalation-proof, cannot be re-run.
--
-- Requires pgcrypto for gen_random_bytes() (the token default below).
-- Real Supabase projects have pgcrypto available/enabled already; this
-- statement is a no-op there and only does real work against a bare
-- Postgres/PGlite test target (see tests/sql/000_bare_postgres_bootstrap.sql
-- for the equivalent uuid-ossp bootstrapping this schema already
-- depends on from migration 001).
-- =====================================================================

create extension if not exists pgcrypto;

create table invitations (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references orgs(id),
  project_id  uuid references projects(id),
  email       text not null,
  role        app_role not null,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references profiles(id),
  revoked_at  timestamptz,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),

  constraint invitations_role_valid check (role in ('staff', 'client', 'vendor')),
  constraint invitations_not_accepted_and_revoked check (accepted_at is null or revoked_at is null)
);

alter table invitations enable row level security;

-- Staff/admin can manage (create/view/revoke) invitations for their
-- own org only. No policy grants the invited party direct table
-- access at all -- acceptance goes through the RPC below, exactly
-- like bootstrap_organization() bypasses the (deliberately absent)
-- direct-insert policies on orgs/profiles.
create policy invitations_staff_manage on invitations
  for all to authenticated
  using (is_org_staff_for_org(org_id))
  with check (is_org_staff_for_org(org_id));

create trigger audit_invitations after insert or update on invitations
  for each row execute function public.log_audit();

create or replace function public.accept_invitation(p_token text, p_full_name text) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'accept_invitation requires an authenticated caller.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This account already has a profile and cannot accept another invitation.';
  end if;

  select * into v_invitation from public.invitations
  where token = p_token and accepted_at is null and revoked_at is null and expires_at > now();

  if v_invitation.id is null then
    raise exception 'This invitation is invalid, expired, already accepted, or revoked.';
  end if;

  insert into public.profiles (id, org_id, role, full_name, email)
  values (auth.uid(), v_invitation.org_id, v_invitation.role, p_full_name, v_invitation.email);

  if v_invitation.project_id is not null then
    insert into public.project_members (project_id, user_id, member_role)
    values (v_invitation.project_id, auth.uid(), v_invitation.role);
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_invitation.id;

  return v_invitation.org_id;
end;
$$;

revoke all on function public.accept_invitation(text, text) from public;
grant execute on function public.accept_invitation(text, text) to authenticated;
