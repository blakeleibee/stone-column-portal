# Package 2 — App shell & responsive framework: notes

> **Round 2 correction pass**: see `docs/PACKAGE_02_CORRECTIONS_V2.md`
> for the fixture-removal refactor, admin/client view-model split,
> reconciliation fix, SQL hardening (migration 003), mobile nav
> completion, and preview-language correction. This file is the
> original round-1 background/context and is still accurate for what
> it covers, but the architecture it describes (a single
> `FinancialsScreen` importing the fixture directly) has since been
> replaced — read the corrections doc first.

## What this package is, concretely

Real component source (`packages/02-app-shell/src/`) intended to drop
into a Next.js app later, plus a Financials screen that imports the
Package 1 engine directly — proving mandate #5 (no duplicated formulas)
in actual, executed code, not just in a written promise.

## Disclosed placeholders (same honesty pattern as Package 1's SQL)

- **Icons**: no icon library is installed in this sandbox (no network
  to fetch `lucide-react`'s type declarations or verify it further,
  though the package itself is present globally). Nav items render as
  a monogram-circle placeholder (`IconPlaceholder` in `AppShell.tsx`).
  The real app swaps this for `lucide-react`, keyed off the `icon`
  string already in `nav/navigation.ts` — that config doesn't change.
- **Logo**: `src/assets/logo.svg` is a small placeholder SVG file — a
  real asset reference, not the ~22KB base64 string the original
  prototype embedded directly in JavaScript. Replace the file when the
  real transparent Stone Column logo is supplied; nothing else in the
  codebase needs to change (components reference the path, not inline
  data).
- **Router**: there is no real router in this package. Navigation is
  driven by simple props (`activeKey`/`onNavigate`) so `AppShell` is
  framework-agnostic today; wiring it to Next.js's App Router is a
  Package-3-or-later integration step, not a redesign.

## The interactive chat preview is a snapshot, not shipped code

The widget shown in this conversation embeds a **static JSON snapshot**
of real output from the Package 1 engine (computed once, via
`ts-node`, against the shared `fixtures/hawksRidge.ts` data, then
copied in as a JS object literal). It reproduces the same numbers for
demonstration purposes in a sandboxed chat widget that cannot import
local TypeScript modules — it is **not** the shipped code path, and it
intentionally contains **zero** financial formulas of its own (no
arithmetic beyond `Math.round` for cents→dollars display, which the
real `formatCents` also does). The actual, executed, shipped-intent
code is `packages/02-app-shell/src/screens/FinancialsScreen.tsx`, which
imports `computeAllCategoryFinancials` etc. directly from
`packages/01-financial-engine/src` — verified by `test/render_smoke.tsx`
(see Test Results in the main handoff message).

## TypeScript verification: what's real and what isn't

`packages/02-app-shell` has **no `tsc --noEmit` verification** — there
is no `@types/react` installed in this sandbox and no network to fetch
it, so `tsc` fails immediately with `Cannot find module 'react'`, not
because of any logic error in the components (confirmed: every error
`tsc` reports is `TS2307`/`TS7026`, both symptoms of the missing JSX
type declarations, not a real type mismatch in the component code).

What **is** real: `npx tsx test/render_smoke.tsx` actually transpiles
(via esbuild, bundled with the already-installed `tsx` tool) and
**executes** every component — `AppShell`, `FinancialsScreen`,
`BudgetTable` — through `react-dom/server`, and 12 assertions confirm
the rendered HTML contains the right nav items per role, the
client-preview banner, the reconciliation banner, and — critically —
the *exact* dollar figure the engine independently produces when called
a second time outside the component tree. That last check is the one
that actually matters for mandate #5: it doesn't just show a number, it
proves the number on screen and the number from calling the engine
directly are identical, which would fail immediately if the component
had silently hardcoded or recomputed anything.

This is the same class of disclosure as Package 1's SQL: something is
genuinely verified (execution, in this case), something specific is
not (full type-checking), and the two are not conflated.

## Vendor nav — deliberately absent, not forgotten

`nav/navigation.ts` defines `adminNav` and `clientNav` only. Vendor
navigation is Package 8 scope per the implementation plan, and Package
1's own SQL test suite already established "vendor sees nothing" as
today's correct, tested baseline (`tests/sql/package1_tests.sql`,
Section 3c). Adding a vendor nav config now with nothing behind it
would be more confusing than adding it when Package 8 actually needs
it.

## Package 1 dependency notes

- `FinancialsScreen.tsx` and `BudgetTable.tsx` import
  `packages/01-financial-engine/src` and
  `packages/01-financial-engine/fixtures/hawksRidge` via relative
  paths. This only works because both packages live in the same
  monorepo checkout with matching relative structure — a real Next.js
  app will need either a workspace/path-alias setup (e.g. `tsconfig`
  `paths`, or an actual npm workspace with `@stone-column/financial-
  engine` as a named dependency) to make this import ergonomic and
  resilient to directory moves. Not set up in this package — flagged
  here rather than silently assumed.
- The Round 3 hardening (`schema/002_committed_forecast_hardening.sql`)
  has **no functional UI depending on it yet** — Package 2 only reads
  `committed_costs`/`forecast_entries` (via the engine, for display),
  it doesn't create or edit them. Per the Package 2 mandate, this was
  still done now rather than deferred, precisely so no future package
  ever builds against the softer, unhardened behavior.
