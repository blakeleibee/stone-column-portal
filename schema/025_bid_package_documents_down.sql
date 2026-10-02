-- =====================================================================
-- Stone Column Portal — Migration 025 ROLLBACK.
-- =====================================================================

drop policy if exists documents_vendor_read_via_bid_package on documents;

drop policy if exists audit_log_bid_package_documents_staff_select on audit_log;
drop trigger if exists audit_bid_package_documents on bid_package_documents;
drop trigger if exists bid_package_documents_no_delete on bid_package_documents;
drop trigger if exists bid_package_documents_integrity on bid_package_documents;
drop function if exists public.enforce_bid_package_document_integrity();
drop policy if exists bid_package_documents_vendor_read on bid_package_documents;
drop policy if exists bid_package_documents_staff_full_access on bid_package_documents;
drop table if exists bid_package_documents;

alter table documents
  drop column if exists superseded_by_id,
  drop column if exists version;
