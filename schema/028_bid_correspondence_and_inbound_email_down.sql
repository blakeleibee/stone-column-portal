-- =====================================================================
-- Stone Column Portal — Migration 028 ROLLBACK.
-- =====================================================================

drop trigger if exists audit_quarantined_inbound_messages on quarantined_inbound_messages;
drop trigger if exists quarantined_inbound_messages_no_delete on quarantined_inbound_messages;
drop trigger if exists quarantined_inbound_messages_review_self on quarantined_inbound_messages;
drop function if exists public.enforce_quarantined_inbound_message_review_self();
drop policy if exists quarantined_inbound_messages_staff_manage on quarantined_inbound_messages;
drop function if exists public.is_any_staff();
drop table if exists quarantined_inbound_messages;

drop trigger if exists audit_inbound_reply_tokens on inbound_reply_tokens;
drop trigger if exists inbound_reply_tokens_no_delete on inbound_reply_tokens;
drop policy if exists inbound_reply_tokens_staff_manage on inbound_reply_tokens;
drop table if exists inbound_reply_tokens;

drop policy if exists documents_vendor_read_via_entity_message on documents;
drop policy if exists documents_vendor_insert_via_bid_package on documents;

drop trigger if exists entity_message_attachments_no_delete on entity_message_attachments;
drop policy if exists entity_message_attachments_vendor_insert on entity_message_attachments;
drop policy if exists entity_message_attachments_vendor_read on entity_message_attachments;
drop policy if exists entity_message_attachments_staff_full_access on entity_message_attachments;
drop table if exists entity_message_attachments;

drop trigger if exists audit_entity_messages on entity_messages;
drop trigger if exists entity_messages_no_delete on entity_messages;
drop trigger if exists entity_messages_provenance on entity_messages;
drop function if exists public.enforce_entity_message_provenance();
drop policy if exists entity_messages_vendor_insert on entity_messages;
drop policy if exists entity_messages_vendor_read on entity_messages;
drop policy if exists entity_messages_staff_full_access on entity_messages;
drop table if exists entity_messages;
