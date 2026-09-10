-- =====================================================================
-- Stone Column Portal — Migration 021 ROLLBACK.
-- Reverses schema/021_vendor_directory_fixes.sql.
-- =====================================================================

drop index if exists vendor_contacts_one_primary_per_vendor;
