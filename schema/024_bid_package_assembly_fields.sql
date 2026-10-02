-- =====================================================================
-- Stone Column Portal — Migration 024: P5.2 Phase B — bid package
-- assembly fields. See docs/production-build/P5-EXTENSION-PACKAGES-
-- DESIGN.md, Section 5, "P5.2" Part B. All new columns are direct,
-- nullable columns on the existing bid_packages table — per the design
-- doc's own reasoning, these are atomic per-package facts (inclusions,
-- exclusions, alternates, allowances, pricing-breakdown instructions,
-- schedule expectations, bid instructions, and a designated Stone
-- Column point of contact) that don't need independent versioning
-- beyond what the package row itself already has via bid_addenda for
-- anything that changes after publish.
--
-- No RLS policy change is needed for bid_packages itself:
-- bid_packages_staff_full_access / bid_packages_vendor_read (schema/015,
-- fixed schema/022) are row-level policies (`select *`-equivalent via
-- ordinary column access) — a vendor already invited to a package can
-- read every column on that row, these new ones included, the moment
-- they exist. What IS new here: stone_column_contact_id points at a
-- profiles row (a staff member), and profiles' own existing RLS
-- (profiles_select_self_or_org_staff, schema/001) does NOT let a vendor
-- session read an arbitrary staff profile — only their own row or (for
-- staff/admin) their whole org. A vendor needs to resolve this UUID to
-- a human-readable name/contact, so a new, narrowly scoped policy is
-- added below, following the EXACT precedent schema/022 already
-- established for cost_codes_vendor_read: a vendor may read a
-- profiles row if and only if it is the designated contact of a bid
-- package they are actually invited to — never a blanket "vendors can
-- read staff profiles" grant.
-- =====================================================================

alter table bid_packages
  add column inclusions text,
  add column exclusions text,
  add column alternates text,
  add column allowances text,
  add column pricing_breakdown_instructions text,
  add column schedule_expectations text,
  add column bid_instructions text,
  add column stone_column_contact_id uuid references profiles(id);

create policy profiles_vendor_read_bid_package_contact on profiles
  for select to authenticated
  using (
    exists (
      select 1 from bid_packages bp
      where bp.stone_column_contact_id = profiles.id
        and is_invited_vendor_for_bid_package(bp.id)
    )
  );
