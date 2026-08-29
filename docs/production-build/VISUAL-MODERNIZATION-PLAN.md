# Application-Wide Visual & Usability Modernization — Plan

**Status:** In progress, before P3.1 acceptance. Visual/CSS/component work only —
no functional, authorization, data, route, or architecture change of any kind.

## Audit finding

The design-token palette in `packages/02-app-shell/src/design/tokens.ts`
already matches the requested direction almost exactly (`paper` = warm
off-white, `ink` = charcoal, `sage` = muted olive primary, `gold` = brass/tan
accent, `line`/`shadow` already restrained). **The palette is not the
problem.** The problem is that every screen defines its own ad-hoc CSS
against those tokens independently (`sc-projects-input`, `sc-team-input`,
`sc-contact-form` input, `sc-bids-input`, etc. — 8+ near-duplicate input
styles across the codebase, each with slightly different padding, no
`:focus` treatment beyond the unstyled browser default outline, no hover/
active states, no shared button-hierarchy system beyond a one-off
`-primary` class per file). This is exactly "isolated page-specific
patches" — there is no shared component layer, only a shared token file.

## Direction

Keep every token value; add what's missing (focus-ring color, hover/active
states, a consistent elevation/shadow scale already partially present) and
**build a real shared UI primitive layer** at
`packages/02-app-shell/src/components/ui/`: `Button`, `TextInput`,
`Textarea`, `Select`, `Checkbox`, `FormField` (label + control + hint/error,
consistent spacing, never inline-packed), `FormGrid` (responsive
multi-column field grouping), `Card`, `PageHeader` (title + primary action,
consistent across every screen), `Badge`/`StatusBadge`, `Alert` (info/
success/warning/error), `Table`, `EmptyState`, `Tabs`, `ProgressBar`,
`ChecklistItem`, `MenuButton` (for grouping secondary actions instead of a
row of loose buttons). One shared stylesheet, injected once via `AppShell`,
not re-injected per component instance.

Every real/functional screen is migrated to use these primitives in place
of its own hand-rolled markup+CSS. **Preview-only screens (explicitly
labeled "Preview only" — Action Center, Conversations, Contacts fixture
screen, Selections, Documents/Updates, Schedule client tab) are not
individually redesigned** — they inherit the improved shell/nav/token
layer automatically since they render inside `AppShell`, but no bespoke
work is spent restyling their own fixture content, matching "do not
redesign unfinished features."

## Implementation boundary

**In scope:** `AppShell`, `ProjectSwitcher`, all `/admin/projects/*` screens
(list + create, setup, brief, site-info, pricing, contacts, team),
`AdminOverviewScreen`, `AdminFinancialsScreen`, `EstimateTable`,
`BudgetTable`, `ImportWizard`, `MappingProfileForm`, `BidPackageWorkspace`,
`NoProjectAccess`.

**Out of scope:** any change to a Server Action, service function, RPC,
migration, RLS policy, route path, or data shape. No new npm dependency
(no CSS framework/component library) — the existing hand-rolled
tokens + CSS-in-JS pattern continues, just consolidated and consistently
applied. No preview-only screen gets bespoke layout work.

## Create Project — specific fixes

- Homeowner/contact quick-add becomes its own visually separated card
  section using `FormGrid`, not packed inline.
- Four clear sections: Project identity → Homeowner → Location & concept →
  Staff assignment.
- "Save contact info" is confusing because the button implies a network
  write that doesn't happen yet (it's local capture, per the create-time
  sequencing design) — relabel to something honest about what it does
  ("Add to project" / "Use this contact"), and show a clear confirmation
  state once captured, not a button that looks like it silently succeeded.
- Cancel/Discard moves inside the form's own action row (bottom-right,
  next to Create), out of the page-level toolbar area where it currently
  reads as a filter/view control.

## Project list — specific fixes

- Each row: name, auto number, status badge, address, assigned staff,
  setup-progress indicator (reusing the same derived-checklist data the
  Setup screen already computes) — in one compact, scannable row, not a
  tall stacked card.
- One primary action per row (open/manage), secondary actions
  (status change, archive, etc.) collapsed into a `MenuButton`, not a row
  of equal-weight buttons.

## Process (executing all of this before returning for review, per instruction)

1. Audit — done above.
2. This document — the concise direction/boundary.
3. Implement: design-system foundation first, then Create Project and
   Project List (explicitly called out), then the remaining screens.
4. No redesign of unfinished features.
5. Regression: typecheck/test/build + route-smoke across every route, a
   real-browser role walkthrough (admin/staff).
6. Real-browser verification at desktop, tablet, and 390px mobile widths.
7. Independent review pass: consistency, usability, accessibility
   (contrast, focus, keyboard nav, labels), and unintended functional
   change.
8. Screenshots: shell, Projects list, Create Project, Setup, Overview,
   Team, Estimate, one mobile view.
9. Live server stays up. No merge, no `p3-complete`/P3.1 tag, no test-data
   deletion, no P5 resume, no financial/security architecture change,
   until owner approves the live result.
