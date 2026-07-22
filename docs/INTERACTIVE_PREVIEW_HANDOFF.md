# Interactive Preview — Handoff Notes

## What this is

`apps/web/` — a real, runnable browser app (esbuild-bundled React,
served via `npm run dev`) built entirely from the **approved** Package
1 engine and Package 2 `AppShell`/repositories/view models. No new
architecture; the only new code is the app's entry point, the demo-only
role switcher, and placeholder/overview screens.

## Setup / start (exact, tested)

```
cd apps/web
npm install
npm run dev
```

**URL: http://localhost:5173**

Both commands and the resulting server were actually run in this
sandbox (not just written) — see "What was actually verified" below.

## Coverage against the request

**Admin/staff**: Overview/dashboard, Financials (real engine), Action
Center (placeholder), Conversations (placeholder), Contacts/Settings
(placeholder) are all direct `AppShell` nav items. Schedule/Selections/
Documents/Updates & Photos are surfaced inside a `ProjectWorkspace`
component (see architecture note below) rather than as `AppShell` top-
level items, since `adminNav` (the approved, frozen nav config) doesn't
have separate slots for those — they were designed as project-tab
content (`projectTabs`) from the start.

**Client**: Home, Budget & Invoices (real client-safe view model),
Schedule/Selections (placeholder) are direct nav items. Messages
(placeholder) stands in for "Conversations" — that's the client nav's
actual approved label. Updates & Photos / Documents are reachable via
the already-functional mobile "More" sheet (unchanged from Package 2).

**Demo controls**: Admin/Staff/Client switch, "Preview as Client",
persistent "Client preview" banner (language corrected per your prior
review — no longer claims to reflect real visibility rules), "Exit
preview", sample-data labeling on every screen showing fixture data, no
authentication/Supabase anywhere.

## What was actually verified (not just written)

```
$ cd apps/web && npm run dev
Stone Column Portal preview running at http://127.0.0.1:5173

$ curl -o /dev/null -w "%{http_code}" http://localhost:5173/
200
$ curl -o /dev/null -w "%{http_code}" http://localhost:5173/bundle.js
200

$ node build.mjs --build
dist/bundle.js      235.7kb
Production build complete -> dist/

$ node --check dist/bundle.js
(valid syntax, no output)

$ npx tsx test/render_smoke.tsx
render_smoke.tsx (preview app): all 45 checks passed.
```

The 45 checks include: every admin/client active key rendering without
throwing; the Financials/Budget screens showing the engine's actual
computed figures (cross-checked against calling the engine
independently); the client Budget screen NOT showing the admin-only
fee-accrued figure; every placeholder screen carrying the "Preview
only" label; the `ProjectWorkspace`'s internal tabs (including a
test-only `initialTab` prop, added for the same reason `AppShell`
already has `initialDrawerOpen`/`initialMoreSheetOpen` — no browser
here to click through tabs); the demo controls' role/preview-button
logic; the full `AppShell` + client-preview-banner composition; and the
mobile "More" sheet reaching Updates & Photos/Documents.

A real, genuine bug was found and fixed during this work: every
cross-package import in the new app initially had the wrong relative
path depth (one level short in `src/screens/`/`src/demo/`, one level
short in `src/App.tsx` itself) — esbuild's first build attempt failed
immediately with "Could not resolve" errors, which is exactly the
signal that caught it. Fixed by tracing exact directory depth from each
file to the `packages/` root.

## What was NOT achieved, disclosed plainly

- **`npx tsc --noEmit` does not pass in this sandbox.** Every one of
  386 error lines was individually categorized by TypeScript error code
  (`TS2322`, `TS7006`, `TS7016`, `TS7026`) and all four trace to the
  same single missing package as Package 2's own gap: no
  `@types/react`/`@types/react-dom` available without network access
  here (re-confirmed: still 403 from the npm registry). `package.json`
  lists both at compatible versions for when real network access is
  available.
- **No real `package-lock.json`.** Attempted `npm install
  --package-lock-only --offline`; failed with `ENOTCACHED` on
  `@types/react` specifically (react/react-dom/esbuild ARE vendored
  locally in this sandbox from already-present copies, but
  `@types/react` never was, since it doesn't exist anywhere on this
  machine). Fabricating a lockfile with invented integrity hashes would
  be actively worse than omitting it — same reasoning as Package 1's
  `NOTE_ON_LOCKFILE.md`.
- **No actual screenshots (PNG/image files).** There is no headless
  browser, Playwright browser binary, or jsdom in this sandbox
  (previously confirmed, re-confirmed again this round) — nothing here
  can rasterize the real running app into a pixel image. I attempted to
  provide an in-chat interactive Visualizer artifact as a substitute
  visual review, but the Visualizer tool itself was unresponsive (timed
  out twice) at the time of this delivery and I did not want to keep
  retrying against its own guidance not to. **The real, runnable app at
  http://localhost:5173 (via `npm run dev`) is the actual visual review
  artifact for this checkpoint** — please run it and view it directly;
  that is more faithful than any mockup I could produce anyway, since
  it's the literal approved components, not a re-creation of them.
- **Vercel deployment was not performed** — no network access from
  this sandbox to reach Vercel's API. `vercel.json` is provided and
  syntactically valid; deployment instructions are in
  `apps/web/README.md`.

## Files added

```
apps/web/
  index.html
  package.json, tsconfig.json, vercel.json
  build.mjs                    -- esbuild dev-server + production build script
  README.md                    -- setup/start/deploy instructions
  src/
    main.tsx, App.tsx
    demo/DemoControls.tsx
    screens/
      PlaceholderScreen.tsx, AdminOverviewScreen.tsx,
      ProjectWorkspace.tsx, ClientHomeScreen.tsx
  test/render_smoke.tsx        -- 45 executed checks
```

Nothing under `packages/01-financial-engine` or `packages/02-app-shell`
was modified.
