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
  { key: "overview", label: "Overview", icon: "LayoutDashboard" },
  { key: "projects", label: "Projects", icon: "Building2" },
  { key: "action-center", label: "Action Center", icon: "ListChecks" },
  { key: "financials", label: "Financials", icon: "Wallet" },
  { key: "estimate", label: "Estimate", icon: "Calculator" },
  { key: "import", label: "Import", icon: "FileUp" },
  // "bids" (P5, Task 6) — placed after estimate/import and before the
  // commitments/procurement entries later P5 tasks (7, 9) will add,
  // same rationale as the estimate/import comment above: a real route
  // (/admin/bids) needs a nav entry to be reachable at all.
  { key: "bids", label: "Bids", icon: "Gavel" },
  { key: "conversations", label: "Conversations", icon: "MessagesSquare" },
  { key: "contacts", label: "Contacts", icon: "Users" },
  { key: "settings", label: "Settings", icon: "Settings" },
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
