-- =====================================================================
-- Stone Column Portal — Migration 027: P5.2 Phase C follow-up fix —
-- close the bid_submission_revisions / bid_submissions desync gap.
-- schema/026 untouched (create-or-replace / new trigger only, matching
-- schema/023's own established "new file, prior migration untouched"
-- follow-up-fix convention).
-- =====================================================================
-- THE GAP: schema/026's bid_submission_revisions_vendor_insert RLS
-- policy allows a vendor to INSERT a revision row directly (subject
-- only to is_vendor_member(vendor_id) + the enforce_bid_submission_
-- revision_insert_rules trigger's business rules: own submission,
-- submission still invited/submitted, package still accepting bids).
-- submit_bid_revision() was documented as "the one real vendor-facing
-- write path," but nothing actually forced a caller through it —
-- schema/026's own doc comment even anticipated a caller "writing to
-- the tables directly" and asserted the two triggers already covered
-- "is this allowed." They do cover that. They do NOT cover the second
-- half of the versioning design's own stated invariant: bid_submissions'
-- current-state columns must always mirror the LATEST revision.
-- submit_bid_revision() upholds that invariant with its own explicit
-- second UPDATE statement — a direct INSERT bypasses that statement
-- entirely, leaving a permanent, immutable revision row (e.g. a
-- 999999-cent "revision") that bid_submissions never reflects (status
-- stays 'invited'/'submitted' at its PRIOR amount). Confirmed live
-- against hosted dev by an independent reviewer: a real vendor session,
-- invited to a real package, POSTs a raw PostgREST insert directly to
-- bid_submission_revisions and it succeeds, while bid_submissions is
-- left completely unchanged — exactly the desync schema/026's own
-- design-decision comment should have closed but didn't.
--
-- Staff's own "Vendors & submissions" table (BidPackageWorkspace.tsx)
-- renders sub.revisions directly from getBidPackageDetail()'s embed —
-- a phantom revision row like this would show up in a staff member's
-- history view for a vendor whose bid_submissions row still says
-- 'invited', an inconsistent, confusing state with no product meaning
-- (a "revision" of a bid that, per the current-state row, was never
-- actually submitted).
--
-- THE FIX: rather than trying to force every future caller through
-- submit_bid_revision() (impossible to do cleanly under RLS + a
-- SECURITY INVOKER RPC — there is no way for a boolean USING/WITH CHECK
-- clause to tell "called via the RPC" apart from "called directly";
-- both execute as the exact same session with the exact same
-- privileges), this migration makes the mirroring invariant hold
-- UNCONDITIONALLY, regardless of how a bid_submission_revisions row
-- came to exist — a new AFTER INSERT trigger on bid_submission_revisions
-- itself performs the same mirroring UPDATE submit_bid_revision()
-- already does, every time, for every row, no matter which path
-- created it. This is the exact same "the real invariant lives in a
-- trigger, not in which entry point happened to be used" philosophy
-- schema/026's own header comment already argues for everywhere else in
-- this migration (enforce_bid_submission_vendor_revision_rules,
-- enforce_bid_submission_revision_insert_rules) — this fix simply
-- finishes applying it to the one place schema/026 itself missed.
--
-- Deliberately NOT security definer: this trigger fires only on
-- bid_submission_revisions INSERT, which only a vendor session can ever
-- trigger (schema/026 grants bid_submission_revisions INSERT to no
-- staff policy at all — staff-recorded submissions go through
-- recordBidSubmission()/award_bid() against bid_submissions directly,
-- never through this table). Running as invoker means the mirroring
-- UPDATE below is itself still fully subject to bid_submissions' own
-- RLS (bid_submissions_vendor_update) and
-- enforce_bid_submission_vendor_revision_rules — both of which already
-- permit exactly this: a vendor moving their OWN, still-open submission
-- to status='submitted'. No new privilege is introduced; this closes a
-- consistency gap, not an access gap.
-- =====================================================================
create or replace function public.mirror_bid_submission_revision_into_submission() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update bid_submissions
  set status = 'submitted', amount_cents = new.amount_cents, notes = new.notes, submitted_at = new.submitted_at
  where id = new.bid_submission_id;

  return new;
end;
$$;

create trigger bid_submission_revisions_mirror_into_submission
  after insert on bid_submission_revisions
  for each row execute function public.mirror_bid_submission_revision_into_submission();
