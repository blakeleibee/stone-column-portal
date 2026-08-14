drop function if exists public.issue_document(issued_document_type, uuid, text, text, jsonb);
drop function if exists public.commit_material_order(uuid);
drop function if exists public.award_bid(uuid);

drop trigger if exists audit_issued_documents on issued_documents;
drop function if exists public.log_audit_via_issued_document();
drop trigger if exists issued_documents_no_delete on issued_documents;
drop trigger if exists issued_documents_immutable on issued_documents;
drop function if exists public.enforce_issued_document_immutability();
drop table if exists issued_documents;
drop type if exists issued_document_type;

drop trigger if exists audit_material_order_line_items on material_order_line_items;
drop function if exists public.log_audit_via_material_order();
drop trigger if exists material_order_line_items_frozen_after_commit on material_order_line_items;
drop function if exists public.enforce_material_order_line_item_frozen_after_commit();
drop trigger if exists material_order_line_items_project_matches_order on material_order_line_items;
drop function if exists public.enforce_line_item_project_matches_order();
drop table if exists material_order_line_items;

drop trigger if exists audit_material_orders on material_orders;
drop table if exists material_orders;
drop type if exists material_order_status;

drop trigger if exists audit_bid_addenda on bid_addenda;
drop trigger if exists bid_addenda_issued_by_self on bid_addenda;
drop function if exists public.enforce_bid_addendum_issued_by_self();
drop table if exists bid_addenda;

drop trigger if exists audit_bid_questions on bid_questions;
drop trigger if exists bid_questions_recorded_by_self on bid_questions;
drop function if exists public.enforce_bid_question_recorded_by_self();
drop table if exists bid_questions;

drop trigger if exists audit_bid_submissions on bid_submissions;
drop function if exists public.log_audit_via_bid_package();
drop table if exists bid_submissions;
drop type if exists bid_submission_status;

drop trigger if exists audit_bid_packages on bid_packages;
drop table if exists bid_packages;
drop type if exists bid_package_status;

drop policy if exists audit_log_vendor_members_staff_select on audit_log;
drop trigger if exists audit_vendor_members on vendor_members;
drop trigger if exists vendor_members_no_delete on vendor_members;
drop trigger if exists vendor_members_identity_and_revocation on vendor_members;
drop function if exists public.enforce_vendor_member_identity_and_revocation();
drop trigger if exists vendor_members_org_match on vendor_members;
drop function if exists public.enforce_vendor_member_org_match();
drop function if exists public.is_vendor_member(uuid);
drop table if exists vendor_members;
