-- =====================================================================
-- Stone Column Portal — Migration 026 ROLLBACK.
-- =====================================================================

drop trigger if exists audit_bid_addendum_acknowledgments on bid_addendum_acknowledgments;
drop function if exists public.log_audit_via_bid_addendum();
drop trigger if exists bid_addendum_acknowledgments_no_delete on bid_addendum_acknowledgments;
drop trigger if exists bid_addendum_acknowledgments_self on bid_addendum_acknowledgments;
drop function if exists public.enforce_bid_addendum_acknowledgment_self();
drop policy if exists bid_addendum_acknowledgments_vendor_insert on bid_addendum_acknowledgments;
drop policy if exists bid_addendum_acknowledgments_vendor_read on bid_addendum_acknowledgments;
drop policy if exists bid_addendum_acknowledgments_staff_read on bid_addendum_acknowledgments;
drop table if exists bid_addendum_acknowledgments;

drop policy if exists bid_questions_vendor_insert on bid_questions;
create policy bid_questions_vendor_insert on bid_questions
  for insert to authenticated
  with check (
    source = 'vendor_submitted'
    and vendor_id is not null
    and is_vendor_member(vendor_id)
    and exists (
      select 1 from bid_submissions bs
      where bs.bid_package_id = bid_questions.bid_package_id and bs.vendor_id = bid_questions.vendor_id
    )
  );

drop function if exists public.submit_bid_revision(uuid, bigint, text);

drop trigger if exists bid_submissions_vendor_revision_rules on bid_submissions;
drop function if exists public.enforce_bid_submission_vendor_revision_rules();

drop trigger if exists audit_bid_submission_revisions on bid_submission_revisions;
drop function if exists public.log_audit_via_bid_submission();
drop trigger if exists bid_submission_revisions_no_delete on bid_submission_revisions;
drop trigger if exists bid_submission_revisions_insert_rules on bid_submission_revisions;
drop function if exists public.enforce_bid_submission_revision_insert_rules();
drop policy if exists bid_submission_revisions_vendor_insert on bid_submission_revisions;
drop policy if exists bid_submission_revisions_vendor_read on bid_submission_revisions;
drop policy if exists bid_submission_revisions_staff_read on bid_submission_revisions;
drop table if exists bid_submission_revisions;

drop function if exists public.get_bid_submission_project_id(uuid);
