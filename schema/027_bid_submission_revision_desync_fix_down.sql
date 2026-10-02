-- =====================================================================
-- Stone Column Portal — Migration 027 ROLLBACK.
-- =====================================================================

drop trigger if exists bid_submission_revisions_mirror_into_submission on bid_submission_revisions;
drop function if exists public.mirror_bid_submission_revision_into_submission();
