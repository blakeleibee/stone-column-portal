-- =====================================================================
-- Stone Column Portal — Migration 022 ROLLBACK.
-- Reverses schema/022_vendor_bid_access_phase_a.sql: drops the new
-- vendor-invitation table/RPC/trigger, drops the new cost_codes vendor
-- policy, and restores bid_packages_vendor_read/bid_questions_vendor_read
-- to their exact pre-022 bodies (schema/015).
-- =====================================================================

revoke execute on function public.accept_vendor_bid_invitation(text, text) from authenticated;
drop function if exists public.accept_vendor_bid_invitation(text, text);

drop trigger if exists audit_bid_vendor_access_invitations on bid_vendor_access_invitations;
drop trigger if exists bid_vendor_access_invitations_org_match on bid_vendor_access_invitations;
drop function if exists public.enforce_bid_vendor_access_invitation_org_match();
drop policy if exists bid_vendor_access_invitations_staff_manage on bid_vendor_access_invitations;
drop table if exists bid_vendor_access_invitations;

drop policy if exists cost_codes_vendor_read on cost_codes;

drop policy if exists bid_questions_vendor_read on bid_questions;
create policy bid_questions_vendor_read on bid_questions
  for select to authenticated
  using (
    visible_to_all_vendors
    or (vendor_id is not null and is_vendor_member(vendor_id))
  );

drop policy if exists bid_packages_vendor_read on bid_packages;
create policy bid_packages_vendor_read on bid_packages
  for select to authenticated
  using (is_project_vendor(project_id) and is_invited_vendor_for_bid_package(bid_packages.id));
