-- =====================================================================
-- Stone Column Portal — Migration 007: vendor identity helper.
--
-- Mirrors is_project_client() from 001 exactly, checking member_role =
-- 'vendor' instead of 'client'. This is the vendor-identity foundation
-- TARGET-ARCHITECTURE.md §3 describes: future packages (P5's
-- bid_packages/bid_submissions, etc.) call this in their OWN new
-- policies. No policy on any existing table is added here.
--
-- Vendor self-read of their own project_members row is ALREADY covered
-- by the existing project_members_self_read policy from 001 (it checks
-- user_id = auth.uid() regardless of member_role) -- verified by this
-- migration's own test in tests/sql/package_p1_auth_tests.sql rather
-- than assumed.
-- =====================================================================

create or replace function public.is_project_vendor(p_project_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id
      and user_id = auth.uid()
      and member_role = 'vendor'
  );
$$;

revoke all on function public.is_project_vendor(uuid) from public;
grant execute on function public.is_project_vendor(uuid) to authenticated;
