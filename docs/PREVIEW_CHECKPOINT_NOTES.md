# Interactive Preview Checkpoint — Notes

## What's genuinely real vs. what's a visual proxy

**Genuinely real, verified by actually running it:**
- `apps/web/` is a real, runnable app. `npm install && npm run dev`
  starts a real esbuild dev server at `http://127.0.0.1:5173`, verified
  with `curl` against both `/` and `/bundle.js`.
- `npm run build` produces a real, syntax-checked production bundle.
- `npx tsx test/render_smoke.tsx` — 45 checks, all passing — actually
  renders every admin/client screen, every placeholder, the real
  financial figures, and the mobile More sheet via `react-dom/server`.
- The app imports the approved `AppShell`, `FixtureFinancialRepository`,
  `buildAdminFinancialsViewModel`, `buildClientBudgetViewModel`,
  `AdminFinancialsScreen`, and `ClientBudgetAndInvoicesScreen` directly
  from `packages/02-app-shell` and `packages/01-financial-engine` — no
  copies, no reimplementation.

**A visual proxy, not a real screenshot:** the interactive widget shown
in this conversation mirrors the real app's design and behavior, but it
is hand-built HTML/CSS for the chat surface — it is NOT a captured
screenshot of the actual running `localhost:5173` app. This sandbox has
no headless browser (confirmed: no cached Playwright/Chromium binary,
no network to fetch one), so no tool exists here to literally
photograph the real app's rendered pixels. The real app is the
authoritative artifact; the widget is a stand-in for visual review
until you run it yourself.

## Real bugs found and fixed while building this

1. Relative import path depth: every new file's cross-package import
   was off by one directory level (`../../02-app-shell/...` instead of
   `../../../packages/02-app-shell/...`), traced and fixed file by file
   by counting exact directory depth from each file to the `packages/`
   root.
2. Duplicate React instances: after vendoring `react`/`react-dom` into
   both `apps/web/node_modules/` and the repo root (to satisfy Node's
   upward module resolution from files under `packages/`), the app
   crashed with React's classic "Invalid hook call" error — two
   separate copies of React loaded simultaneously. Fixed by keeping
   only the repo-root copy, resolvable via standard upward
   `node_modules` search from anywhere in the monorepo.
3. A bug in my own test, not the app: the test initially checked for a
   `"schedule"` placeholder as a top-level `AdminContent` case — but
   `AdminActiveKey` never included `"schedule"`/`"selections"` at all;
   those placeholders live inside `ProjectWorkspace`'s internal tabs by
   design. Fixed the test to check the correct key sets for each layer,
   and added a test-only `initialTab` prop to `ProjectWorkspace` (same
   pattern as `AppShell`'s `initialDrawerOpen`/`initialMoreSheetOpen`)
   so each internal tab's content is actually verified.
4. HTML entity escaping: `"Updates & Photos"` renders as `"Updates
   &amp; Photos"` in React's output — a test comparing against the
   unescaped string failed even though the app was correct.

## Architecture decisions made for this checkpoint only

- `ProjectWorkspace` (new, demo-app-only): the approved `AppShell` only
  ever renders `adminNav`'s 7 fixed items for admin/staff — it has no
  mechanism to display `projectTabs` at the top level. Rather than
  modify the frozen `AppShell`/`navigation.ts` to inject a different
  nav source, Schedule/Selections/Documents/Updates & Photos/
  Conversations are surfaced as an in-page tab strip rendered when
  "Projects" is selected — ordinary page content, not a shell change.
- Demo controls strip: visually and structurally separate (dark
  background, explicit "DEMO CONTROLS — not part of the real sign-in
  flow" label) from the real `AppShell` chrome below it, so nobody
  mistakes it for product UI.
- `AdminContent`/`ClientContent` exported from `App.tsx`: purely so the
  test file can exercise every screen directly — `App.tsx`'s top-level
  `useEffect`-driven async loading can't be exercised via
  `renderToStaticMarkup` (React doesn't run effects during SSR at all,
  standard behavior, not a sandbox limitation), so testing the actual
  content requires bypassing that loading wrapper.

## Known limitations carried into this checkpoint

- All Package 1 SQL/RLS (migrations 001–005) remains designed but
  unverified against a real PostgreSQL/Supabase instance — unchanged,
  load-bearing caveat, per your own conditional approval of Package 2.
- `npm run typecheck` for `apps/web` doesn't pass here, for the exact
  same single reason as Package 2 (`@types/react`/`@types/react-dom`
  unavailable without network) — every error individually categorized,
  none unexplained.
- No real `package-lock.json` — `npm install` didn't complete against
  the real registry in this sandbox (confirmed with a fresh attempt).
- No genuine screenshots — no headless browser available; see above.
- `SupabaseFinancialRepository` remains a documented, non-functional
  stub (this preview deliberately requires neither Supabase nor auth).
