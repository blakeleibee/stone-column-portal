# Corrections — Root Workspace, Financial Display Clarification, Mobile Layout

## 1. Real root npm workspace

Added at the repository root: `package.json` with a real `workspaces`
field (`packages/01-financial-engine`, `packages/02-app-shell`,
`apps/web`), delegating `typecheck`/`test`/`build`/`dev` scripts.

**Verified from this exact structure** (not claimed, run):
```
$ npm install                 -> fails: 403 on @types/react (same disclosed gap as every prior round)
$ npm run typecheck           -> runs across all 3 workspaces; 01 clean, 02 & apps/web fail on the same single missing package
$ npm run test                -> ALL 123 checks pass (31 + 47 + 45), across all 3 workspaces, from one command
$ npm run build               -> succeeds, produces apps/web/dist/{index.html,bundle.js,bundle.js.map,assets/}
$ npm run dev                 -> serves at http://127.0.0.1:5173, verified HTTP 200 on index.html, bundle.js, and assets/logo.jpg
```

**Why this actually fixes the resolution problem** (not just moves
files around): with a real npm workspace, `npm install` hoists shared
dependencies (React in particular) into a single root `node_modules` —
every workspace package resolves it via ordinary upward lookup. I
verified this structurally: consolidated every previously-scattered,
manually-vendored package (react, react-dom, esbuild, @esbuild binary,
@types/node) into exactly one root `node_modules`, removed all nested
per-package copies, and confirmed there is exactly one copy of React
anywhere in the tree — which is what a real `npm install` at the root
would also produce, and is the specific condition that prevents
"invalid hook call" errors (which happen when two different React
module instances end up in the same render tree).

**Still cannot produce a real root `package-lock.json`** — `npm
install` fails immediately on the registry (403), so there's nothing to
generate a genuine lockfile from. Not fabricated.

**README and `vercel.json` updated** for root-level install/build/dev,
replacing the old (broken) "`cd apps/web && npm install`" instruction.

## 2. The financial display "bug" — root-caused, and it wasn't in the app

I verified this directly against the real engine, independent of any UI:

```
Revised estimate:     $2,331,500.00
Actual cost:          $551,800.00
Committed cost:       $66,000.00
Forecast to complete: $121,000.00
Projected final:      $738,800.00   (= actual + committed + forecast, always >= actual)
```

**This is correct, and the real `AdminOverviewScreen.tsx` already reads
these exact values from `adminVM.totals`** (the real engine's output) —
there is no hardcoded number and no calculation bug anywhere in the
actual application.

**What you actually saw** ("$51,800" / "$38,800") was a rendering
defect in my hand-drawn SVG mockup image from the previous round, not
a screenshot of the app and not a reflection of any real computation.
Root cause, confirmed by inspection: the mockup specified
`font-family="Arial"`, which is **not installed** in this sandbox
(`fc-list` confirms — no Arial anywhere); the SVG rasterizer silently
substituted a different, wider fallback font, which threw off my
`text-anchor="end"`-positioned dollar figures enough to visually clip
their leading characters. I should have verified the font was actually
available before trusting my own width calculations — I hadn't, and
this round I did (checked `fc-list`, confirmed "DejaVu Sans" is
present, rebuilt both mockups using it, and switched from precisely-
calculated `text-anchor="end"` positioning to more generous, harder-to-
break box widths).

I want to be direct that this was a mistake in my illustrative image,
not a hedge — the real engine and the real component were never wrong,
and the underlying computation is shown explicitly above so this
doesn't have to be taken on faith.

## 3. Mobile layout at 390px (and 360px)

**One part of this was also a mockup-only artifact**: the real
`AppShell` topbar already sets `.sc-topbar-user { display: none; }` by
default, only becoming visible at >=768px — so "Signed in as ..." was
never actually rendered at mobile widths in the real component. My
mockup had drawn it in anyway, inconsistent with the real CSS. Verified
by reading the actual stylesheet, not assumed.

**Two things were real and are fixed in the actual component code**:

- **Preview banner text could wrap awkwardly at 360-390px.** The full
  string ("Client preview — Exit preview to return to your admin
  view.") is long enough to risk crowding the Exit button in a
  `justify-content: space-between` flex row at narrow widths. Fixed:
  the banner now shows a short "Client preview" label below 768px and
  the fuller sentence only at desktop widths, plus `min-width: 0` +
  `text-overflow: ellipsis` on the text span as a hard backstop.
- **The primary 3-stat row (Revised Estimate / Actual to Date /
  Projected Final) used a 2-column grid**, which — with 3 items —
  produces an asymmetric "2 items + 1 orphaned item in column 1" layout
  at mobile width rather than a stable grid. Fixed: it now uses the
  same single-column-on-mobile variant the second stat row
  (Invoiced/Payments/Balance) already used, in
  `ClientBudgetAndInvoicesScreen.tsx`.

**Reduced unnecessary header height**: `AppShell`'s topbar padding is
now `10px 16px` on mobile (was `14px 32px` everywhere), expanding back
to the roomier `14px 32px` only at the desktop breakpoint — shrinking
the stacked demo-strip + preview-banner + topbar chrome before content
starts, without touching any interactive element's touch-target size
(buttons remain >=44px via `touchTarget.minSize`, unchanged).

**All 123 tests re-run and passing** after these changes (unchanged
count, confirming nothing regressed).

## Preserved, unchanged

Restored original palette/logo/content, the `ScheduleRail`, Pending
Decisions, `ProjectWorkspace` content, the admin/client financial view-
model separation, real engine integration, client-safe data boundaries,
and the client-preview safeguards are all untouched by this round —
only the workspace tooling, two CSS fixes, and the mockup-generation
process changed.

## Corrected screenshots

Rebuilt using a font actually present in this sandbox (verified via
`fc-list` first this time) and the real, independently-verified engine
figures above. Still disclosed as hand-drawn SVG mockups, not literal
captures of the running app — no headless browser exists here to
produce real screenshots, same standing limitation as every prior
round.
