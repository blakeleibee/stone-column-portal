-- =====================================================================
-- Stone Column Portal — Migration 024 ROLLBACK.
-- =====================================================================

drop policy if exists profiles_vendor_read_bid_package_contact on profiles;

alter table bid_packages
  drop column if exists inclusions,
  drop column if exists exclusions,
  drop column if exists alternates,
  drop column if exists allowances,
  drop column if exists pricing_breakdown_instructions,
  drop column if exists schedule_expectations,
  drop column if exists bid_instructions,
  drop column if exists stone_column_contact_id;
