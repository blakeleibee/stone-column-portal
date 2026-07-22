# Stone Column Portal — Interactive Preview

A genuinely runnable, browser-viewable preview of the Stone Column
Portal, built from the **approved** Package 1 financial engine and
Package 2 app shell/repositories/view models — no new architecture, no
duplicated calculations, no authentication, no Supabase.

**Sample data only.** Hawks Ridge Residence is a fictional demo
project. No real client information, credentials, invoices, OneDrive
access, or Supabase secrets are used anywhere in this app.

## Setup (one command, from the REPOSITORY ROOT, not this directory)

```
npm install
```

Run from the repository root, not from inside `apps/web` — this app
imports source directly from `packages/01-financial-engine` and
`packages/02-app-shell`, and only a real npm workspace (configured at
the root — see the root `package.json`'s `workspaces` field) resolves
their shared dependencies (React in particular) correctly. See the root
`README.md` for the full explanation.

## Run (one command, from the repository root)

```
npm run dev
```

## Exact local URL

**http://localhost:5173**

The dev server (esbuild, no Vite needed) bundles `src/main.tsx` and
serves it with live rebuild on each request. Stop it with `Ctrl+C`.

## What you'll see

- A dark **"DEMO CONTROLS"** strip at the very top — Admin / Staff /
  Client buttons, and (for Admin/Staff) a **"Preview as Client"**
  button. This strip is deliberately styled to look nothing like the
  product itself, so it's never mistaken for real UI.
- Below it, the real, approved `AppShell` — sidebar nav on desktop,
  bottom nav + functional "More" sheet on mobile widths.
- **Financials** (Admin/Staff → Financials, or Projects → Financials
  tab) and **Budget & Invoices** (Client → Budget) are wired to the
  real Package 1 engine via the real Package 2 view-model builders and
  `FixtureFinancialRepository` — every number you see was computed by
  `computeAllCategoryFinancials`/`computeProjectTotals`/etc., not typed
  in by hand.
- Every other screen (Schedule, Selections, Documents, Updates &
  Photos, Conversations, Action Center, Contacts, Settings) is a
  polished, clearly-labeled **"Preview only — not yet functional"**
  placeholder — matching the visual language of the real screens, but
  never claiming to do something it doesn't.
- Clicking **"Preview as Client"** switches the shell to the client
  experience with a persistent **"Client preview"** banner and an
  **"Exit preview"** button — exactly the same `AppShell` props/
  behavior already reviewed and approved in Package 2.

## Testing it yourself at both required widths

- **Desktop**: just open http://localhost:5173 in a normal browser window.
- **~390px mobile**: open your browser's device toolbar (Chrome/Edge:
  `Cmd+Opt+I` / `F12` then the device-toolbar icon; Firefox: `Cmd+Opt+M`)
  and set a custom width of 390px, or pick an iPhone 12/13/14 preset
  (390x844). The bottom nav, "More" sheet, and card-based layouts are
  designed for exactly this width.

## Running the test suite

```
npx tsx test/render_smoke.tsx
```

Actually renders every admin/client screen, every placeholder, the
demo controls, and the full `AppShell` composition (including the
client preview banner and the mobile "More" sheet) via
`react-dom/server` — 45 checks as of this delivery.

## TypeScript verification

Run from the repository root (not this directory):

```
npm run typecheck
```

**Verified passing** (independent verification, real network access —
see the root `README.md` for the exact command results). This
sandbox's own development environment has no network access and could
not independently re-run this end-to-end itself — see
`docs/TYPESCRIPT_VERSION_FIX.md` for the specific reasoning behind the
version-pinning fix that made this pass.
The compiler configuration bug that previously broke this (an
`ignoreDeprecations` value only valid for this sandbox's TypeScript
6.0.3, not the workspace's now-pinned real 5.9.3) has been fixed and
every dependency is now pinned to an exact version rather than a range.

## Production build

```
npm run build
```

Outputs a static site to `dist/` (`index.html` + `bundle.js` +
sourcemap) — no server-side code, deployable anywhere that serves
static files.

## Deploying a temporary Vercel preview

This directory includes `vercel.json`, pre-configured for a static build:

```json
{
  "buildCommand": "node build.mjs --build",
  "outputDirectory": "dist",
  "framework": null,
  "installCommand": "npm install"
}
```

To create a temporary preview deployment:

```
cd apps/web
npx vercel          # first run: follow the prompts to link/create a project
npx vercel          # subsequent runs (without --prod) create a new PREVIEW URL, not production
```

`npx vercel` requires a Vercel account; it prints the preview URL
directly, e.g. `https://stone-column-preview-xxxx.vercel.app`.

**This was not deployed to Vercel from this sandbox** — no network
access here to reach Vercel's API. The configuration above is provided
so you can deploy it yourself in one command from a machine with
normal internet access.

## Architecture note — nothing new was invented

- `AppShell`, `BudgetTable`, `AdminFinancialsScreen`,
  `ClientBudgetAndInvoicesScreen`, `FixtureFinancialRepository`,
  `buildAdminFinancialsViewModel`, `buildClientBudgetViewModel`, and
  the Package 1 engine are all **imported directly** from
  `packages/02-app-shell` and `packages/01-financial-engine` — nothing
  in those approved packages was modified to build this preview.
- The only genuinely new code here is this app's entry point
  (`src/main.tsx`/`src/App.tsx`), the demo-only role switcher
  (`src/demo/DemoControls.tsx`), and the placeholder/overview screens
  needed to give every requested nav item somewhere to land
  (`src/screens/*.tsx`) — all of which render pre-built view models or
  static sample metadata, never re-deriving a financial figure.
- Admin/staff sidebar navigation is exactly `adminNav` from
  `packages/02-app-shell/src/nav/navigation.ts`, unmodified. That
  config has no separate top-level slots for Schedule/Selections/
  Documents/Updates & Photos (those were designed as **project-tab**
  content — see `projectTabs` in the same file — not global nav), so
  this preview surfaces them inside `ProjectWorkspace` (new, demo-app-
  only) rendered as ordinary page content when "Projects" is selected
  — not a second navigation shell, and not a change to `AppShell`'s
  own approved sidebar behavior.

## No real package-lock.json

Same reasoning as `packages/01-financial-engine/NOTE_ON_LOCKFILE.md`:
generating one requires resolving against the real npm registry to
compute genuine integrity hashes, and there is no network access in
this sandbox to do that (confirmed: `npm install --package-lock-only
--offline` fails with `ENOTCACHED` on `@types/react`, which was never
locally vendored here). Run `npm install` yourself with real network
access to generate and commit a real lockfile.
