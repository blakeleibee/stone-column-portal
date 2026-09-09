// Navigation config — Package 2 mandate: simplify and make role-aware.
// Vendor nav is intentionally NOT defined here yet (vendor portal is
// Package 8) — see docs/PACKAGE_02_NOTES.md for why that's a deliberate
// scope boundary, not an oversight.

export type AppRole = "admin" | "staff" | "client";

export interface NavItem {
  key: string;
  label: string;
  // Lucide icon name — resolved to an actual icon component where this
  // config is consumed (AppShell.tsx), kept as a string here so this
  // file has zero UI-library dependency of its own.
  icon: string;
  // Pre-Task-10 owner-preview correction: with 10 active projects, staff
  // must always be able to tell which sidebar entries are organization-
  // wide vs. scoped to whichever project the switcher currently has
  // selected. Optional and admin/staff-only for now — clientNav/
  // projectTabs/clientMoreNav don't set it, so AppShell renders those
  // exactly as before (a single ungrouped list) when this field is
  // absent. "overview" and "import" are project-scoped even though
  // their names don't make that obvious: both resolve the currently
  // selected project via resolveProjectAndSwitcherData() (confirmed in
  // apps/web/app/admin/overview/page.tsx and .../import/page.tsx), not
  // an org-wide listing.
  section?: "organization" | "project";
}

// Global admin/staff navigation (spec section 13).
//
// "estimate" and "import" (P4) were added after the fact during the P4
// final-review fix wave: both screens shipped in P4 with real routes
// (/admin/estimate, /admin/import) but no nav entry, making them
// unreachable from the running application except by typing the URL
// directly. Placed adjacent to "financials" since both are
// financial-data screens (real budget entry, and the QuickBooks import
// wizard that feeds it).
export const adminNav: NavItem[] = [
  { key: "overview", label: "Overview", icon: "LayoutDashboard", section: "project" },
  { key: "projects", label: "Projects", icon: "Building2", section: "organization" },
  { key: "action-center", label: "Action Center", icon: "ListChecks", section: "organization" },
  { key: "financials", label: "Financials", icon: "Wallet", section: "project" },
  { key: "estimate", label: "Estimate", icon: "Calculator", section: "project" },
  { key: "import", label: "Import", icon: "FileUp", section: "project" },
  // "bids" (P5, Task 6) — placed after estimate/import and before the
  // commitments/procurement entries later P5 tasks (7, 9) will add,
  // same rationale as the estimate/import comment above: a real route
  // (/admin/bids) needs a nav entry to be reachable at all.
  { key: "bids", label: "Bids", icon: "Gavel", section: "project" },
  // "commitments" (P5, Task 7) — same rationale as "bids" directly
  // above: /admin/commitments is a real route with no nav entry of its
  // own until this one is added, which is exactly the "shipped
  // unreachable except by typing the URL" gap the estimate/import/bids
  // comments in this file already warned future tasks not to repeat.
  { key: "commitments", label: "Commitments", icon: "ClipboardList", section: "project" },
  // "procurement" (P5, Task 9) — placed directly after "commitments",
  // same rationale as every P5 nav-entry comment above: /admin/procurement
  // is a real route (material_orders/material_order_line_items) with no
  // nav entry of its own until this one is added. Label reads "Material
  // Orders" (pre-Task-10 owner-preview correction) since this screen
  // doesn't yet represent the full procurement process (quote/bid
  // conversion, recurring orders, supplier catalogs — see
  // FINANCIAL-ARCHITECTURE.md's procurement-efficiency-features note);
  // the route/key/db objects are unchanged.
  { key: "procurement", label: "Material Orders", icon: "PackageSearch", section: "project" },
  { key: "conversations", label: "Conversations", icon: "MessagesSquare", section: "project" },
  { key: "contacts", label: "Contacts", icon: "Users", section: "organization" },
  // "vendors" (P5.1) — org-level, matching Projects/Contacts/Settings:
  // vendors are shared across every project in the org, not scoped to
  // whichever project the switcher currently has selected. Placed next
  // to "contacts" (the closest existing org-level directory-shaped
  // screen) rather than among the project-scoped bids/commitments/
  // procurement entries above, even though those screens are P5.1's
  // main consumers of the vendors table — this nav's own section
  // grouping is about WHERE a screen's data lives, not which other
  // screens happen to read from it.
  { key: "vendors", label: "Vendors", icon: "Truck", section: "organization" },
  { key: "settings", label: "Settings", icon: "Settings", section: "organization" },
];

// Inside-a-project tabs/compact menu (spec section 13).
export const projectTabs: NavItem[] = [
  { key: "overview", label: "Overview", icon: "LayoutDashboard" },
  { key: "scope", label: "Scope", icon: "FileText" },
  { key: "financials", label: "Financials", icon: "Wallet" },
  { key: "schedule", label: "Schedule", icon: "CalendarDays" },
  { key: "selections", label: "Selections", icon: "Palette" },
  { key: "updates", label: "Updates & Photos", icon: "Image" },
  { key: "files", label: "Files", icon: "Folder" },
  { key: "conversations", label: "Conversations", icon: "MessagesSquare" },
  { key: "closeout", label: "Closeout", icon: "CheckCircle2" },
];

// Homeowner (client) navigation — this is the one that must work
// beautifully as a mobile bottom nav (spec section 10). Kept short by
// design: 5 items max fits a bottom nav bar without crowding.
export const clientNav: NavItem[] = [
  { key: "home", label: "Home", icon: "Home" },
  { key: "budget", label: "Budget", icon: "Wallet" },
  { key: "schedule", label: "Schedule", icon: "CalendarDays" },
  { key: "selections", label: "Selections", icon: "Palette" },
  { key: "messages", label: "Messages", icon: "MessagesSquare" },
];

// Client screens that exist but don't fit in the 5-item bottom nav
// (reached via a secondary "More" sheet, not a 6th bottom-nav slot —
// spec explicitly warns against clipped/crowded mobile nav).
export const clientMoreNav: NavItem[] = [
  { key: "updates", label: "Updates & Photos", icon: "Image" },
  { key: "documents", label: "Documents", icon: "Folder" },
];

export function navForRole(role: AppRole): NavItem[] {
  switch (role) {
    case "admin":
    case "staff":
      return adminNav;
    case "client":
      return clientNav;
  }
}
