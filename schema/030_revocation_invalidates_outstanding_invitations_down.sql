-- =====================================================================
-- Down migration for 030_revocation_invalidates_outstanding_invitations.
--
-- Drops the trigger and its function, returning the database to
-- schema/029 behavior. NOTE: this does NOT un-revoke invitations the
-- trigger already revoked while it was installed — those rows stay
-- revoked, which is the safe direction (a rollback must never hand a
-- revoked contact a working token back). Re-inviting is the intended
-- way to restore access to any contact affected by that.
-- =====================================================================

drop trigger if exists vendor_members_revoke_outstanding_invitations on vendor_members;
drop function if exists public.revoke_outstanding_vendor_invitations_on_member_revocation();
