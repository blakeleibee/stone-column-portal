# Original Prototype vs. Current Preview — Comparison Inventory

Source of truth: the original prototype file itself
(`stone-column-portal__4_.jsx`, still on disk in this conversation,
1,121 lines), read in full — not memory, not the correction prompts
written about it.

## Navigation destinations

**Original ADMIN_NAV (9):** Overview, Projects, Budget & Expenses,
Schedule, Selections, Documents, Updates, Clients, Settings.
**Original CLIENT_NAV (7):** Overview, Budget, Expenses, Schedule,
Selections, Documents, Updates.

**Approved Package 2 adminNav (7):** Overview, Projects, Action Center,
Financials, Conversations, Contacts, Settings.
**Approved Package 2 clientNav (5) + clientMoreNav (2 via "More"):**
Home, Budget, Schedule, Selections, Messages · Updates & Photos,
Documents.

The Package 2 nav differs from the original **by design**, per the
master plan (Action Center/Conversations are master-spec additions;
the 7-item admin list and 5-item-plus-More client list are what makes
the mobile bottom nav/drawer work at all). This inventory doesn't
recommend reverting the approved nav *config* — but it does confirm
the *content* every destination leads to had been badly thinned out
relative to the original, which is what this round fixes.

## What existed in the original that had gone missing or been thinned

| Area | Original | Previous preview (before this round) | Status |
|---|---|---|---|
| Color palette | Exact sage (#6E7B5C) / gold (#AD8A4E) / brick (#A24A3B) / paper (#F7F4EE) / charcoal-navy ink (#22262B) | All-brown/stone monochrome, different hues entirely | Restored — tokens.ts now uses the original's exact hex values |
| Logo | Real photographic logo (extracted: 600x394 JPEG, gold wordmark on black) | SVG monogram placeholder | Restored — real logo extracted from the original file and wired in as a static asset |
| Sidebar | Dark ink background, logo at top, role switcher pinned at bottom | Light background, no role switcher in sidebar | Restored (dark sidebar, logo, original nav-item coloring); role switcher stays in the separate demo-only strip per the approved architecture's security requirement |
| Admin Overview | Project card + compact ScheduleRail, Pending Client Decisions card, Budget Snapshot (3 stats), Recently Imported (3 expenses), Unpublished counts | A single project card + button | Restored — all five original sections rebuilt, financial figures from the real engine |
| Financials/Budget table | 7 columns: Cost Code / Original Est. / Approved Changes / Revised Est. / Actual / Remaining Est. / Status badge, totals footer row | 6 columns, no status badge, no totals row | Restored — exact column set plus a presentation-only status classifier |
| Financials stats | StatMini row: Fee (15%), Invoiced, Payments, Balance Due | A generic summary card row | Restored — Fee Accrued (real), Invoiced/Payments/Balance clearly marked Preview (no Package 4 yet) |
| Client Budget disclosure banner | Sage-tinted cost-plus explanation banner | Missing entirely | Restored |
| Schedule | "Signature element" ScheduleRail (dot-and-line rail) + 15-phase list with date ranges | Blank coming-soon placeholder | Restored — real component, 15 sample phases, admin and client variants |
| Selections | 8 realistic sample selections: category/room/product/allowance/price/status/approver/notes, photo placeholder, approve button | Blank placeholder | Restored — all 8 restored verbatim from the original's own sample data |
| Documents | 6 sample documents with category/date/publish state | Blank placeholder | Restored |
| Updates & Photos | Narrative updates: title/date/3 photo placeholders/completed/next/concerns, publish toggle | Blank placeholder | Restored |
| Conversations | Not in the original (a master-spec addition) | Blank placeholder | Restored with a realistic sample thread list |
| Action Center | Not in the original (also a master-spec addition) | Blank placeholder | Restored with realistic grouped sample action items |
| Contacts/Clients | Client list with role badges | Blank placeholder | Restored |
| Client Home | Welcome header, ScheduleRail, Latest Update card, Contact card, Financial Summary, Needs Your Attention list | A single card + button | Restored — all five sections |

## Typography / spacing / density

- Fonts: original used Fraunces (display) + Inter (body) — the rebuild
  already had this right; unchanged.
- Density: the original's Card padding (22px), StatRow baseline-aligned
  label/value pairs, and compact table row heights are now matched.
- Status badges: original's pill badges (11px, 700 weight, 0.04em
  letter-spacing, uppercase) restored via a shared Badge component with
  the exact same tone mapping.

## What was NOT reverted, and why

- The "Viewing as" role switcher stays in a separate, clearly-labeled
  demo-only strip rather than folded back into the sidebar as a real
  product control. In the original it directly changed which
  (insecure, unauthenticated) data rendered — fine for a static
  prototype, but the approved architecture requires this to be
  visibly non-production, since real admin/client users are different
  authenticated sessions, not a toggle.
- Nav item lists (adminNav/clientNav/clientMoreNav) were not reverted
  to the original's 9-item/7-item lists — those are approved Package 2
  config; the content-richness problem was solved without touching
  them, via a ProjectWorkspace internal tab strip.
- Financial calculations were never copied from the original — the
  original's fee/invoiced/paid/projected-final numbers are exactly the
  bugs Package 1 fixed. Every restored number still comes from the
  real engine or is explicitly labeled Preview.
- Client-safe data separation was never weakened.

## A bug found and fixed while restoring this content

While adding a "Supporting Documentation" section to the shared,
approved AdminFinancialsScreen/ClientBudgetAndInvoicesScreen, I
initially hardcoded Hawks-Ridge-only document names directly into
those project-agnostic components. The existing cross-project
isolation test (render_smoke.tsx's "a different project produces
different output" check) caught this immediately. Fixed by removing
the hardcoded rows from the shared components (a generic "Preview —
Package 4/8" note instead) and keeping specific sample document
content only in the demo-app-scoped ProjectWorkspace/DocumentsTab.
