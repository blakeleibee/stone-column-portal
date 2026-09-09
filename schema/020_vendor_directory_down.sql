-- =====================================================================
-- Stone Column Portal — Migration 020 ROLLBACK.
-- Reverses schema/020_vendor_directory.sql.
-- =====================================================================

drop trigger if exists vendor_document_access_log_self_insert_trigger on vendor_document_access_log;
drop function if exists public.enforce_vendor_document_access_log_self();

drop table if exists vendor_document_access_log;

drop policy if exists audit_log_vendor_documents_staff_select on audit_log;

drop trigger if exists vendor_documents_no_delete on vendor_documents;
drop trigger if exists audit_vendor_documents on vendor_documents;
drop policy if exists vendor_documents_category_gated on vendor_documents;
drop trigger if exists vendor_documents_org_match on vendor_documents;
drop function if exists public.enforce_vendor_document_org_match();

drop table if exists vendor_documents;

revoke execute on function public.is_accounting_or_admin_staff_for_org(uuid) from authenticated;
drop function if exists public.is_accounting_or_admin_staff_for_org(uuid);

drop policy if exists audit_log_vendor_contacts_staff_select on audit_log;

drop trigger if exists vendor_contacts_no_delete on vendor_contacts;
drop trigger if exists audit_vendor_contacts on vendor_contacts;
drop policy if exists vendor_contacts_staff_only on vendor_contacts;

drop table if exists vendor_contacts;

drop trigger if exists vendors_merge_no_chain on vendors;
drop function if exists public.enforce_vendor_merge_no_chain();

alter table vendors drop constraint if exists vendors_merged_implies_archived;

alter table vendors
  drop column if exists merged_into_vendor_id,
  drop column if exists payment_terms,
  drop column if exists preferred_communication_method,
  drop column if exists service_area,
  drop column if exists trades,
  drop column if exists website,
  drop column if exists legal_name;
