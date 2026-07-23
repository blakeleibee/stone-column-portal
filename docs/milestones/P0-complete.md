# P0 — Complete

**Status:** Complete
**Verified commit:** `54f05a3`
**Tag:** `p0-complete`
**Completed:** 2026-07-22

## Scope

Migrate `apps/web`'s existing esbuild single-page app into a Next.js 14
App Router application, with **no product or visual scope change** —
same design tokens, `AppShell` chrome, navigation, financial logic, and
construction terminology — establishing the server/client component
boundary, environment/secrets scaffolding, and CI updates every later
production package depends on. Full scope: `PRODUCTION-ROADMAP.md`'s
"Package P0" section (superseded content now summarized here; see
that file's current state for the live pointer).

Explicit exclusions (all honored): no new database tables, no auth, no
real financial writes, no external service connections, no new
screens, no visual redesign.

## Acceptance criteria — final status

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `.env.example` exists, documents every §10 variable, zero real values, only tracked `.env*` file | Met | `.env.example` present; CI step fails the build if any other `.env*` file is tracked |
| 2 | Local/preview/production documented as three genuinely separate Supabase projects | Met | `docs/production-build/ENVIRONMENTS-RUNBOOK.md` |
| 3 | React error boundary wraps the app shell | Met | `apps/web/app/error.tsx` |
| 4 | Structured logging/monitoring plan written | Met | `docs/production-build/P0-LOGGING-MONITORING.md` |
| 5 | Preview-only labels reconfirmed; the two dead-click controls visibly disabled | Met | `disabled` attribute + `:disabled { opacity: .5; cursor: not-allowed }` on Selections "Review & Approve" and Documents "Download" |
| 6 | UI migrated to Next.js with no broad redesign, everything preserved exactly | Met | All 14 routes render the unchanged screen components; one regression (sample-data banner missing on client routes) found by final review and fixed — see below |
| 7 | Server/client component boundary established | Met | Fixture loading only in async Server Component `page.tsx` files via `loadViewModels.ts`; every interactive component carries `"use client"` |
| 8 | Route/rendering regression tests pass | Met | `apps/web/test/route_smoke.ts` — 41/41 checks against a real `next dev` server |

## Verified commands (from a clean install, at `54f05a3`)

```
npm ci
npm run typecheck   # 3/3 workspaces clean
npm run test        # financial-engine: run.ts + edge_cases.ts (31/31) all pass
                     # app-shell: render_smoke.tsx 47/47 pass
                     # preview-app: route_smoke.ts 41/41 pass
npm run build        # 9 static routes (○) + 7 dynamic routes (ƒ), builds clean
```

## What shipped

- `apps/web` fully on Next.js 14 App Router: 14 real URL routes (7
  admin, 7 client) replacing the old SPA's in-memory `activeKey`
  state, with a root layout, global styles, and a root error boundary.
- Server/client boundary: fixture-repository data-fetching lives only
  in async Server Component `page.tsx` files (via a shared
  `loadViewModels.ts` helper); every component with `useState`,
  `onClick`, or `next/navigation` hooks is an explicit Client
  Component.
- Two new client "chrome" components (`AdminChrome`, `ClientChrome`)
  replace the old SPA's role-switch state with real navigation,
  including the "Preview as Client" flow now driven by a `?preview=1`
  query parameter instead of in-memory state.
- The two previously-clickable-but-non-functional buttons (Selections
  "Review & Approve", Documents "Download") are now visibly disabled.
- `.env.example`, an environments runbook, and a logging/monitoring
  baseline doc establish the secrets/environment scaffolding every
  later package depends on.
- A repo-wide CI check prevents fixture/demo data from being imported
  outside the demo app's own source tree.
- The old direct-component-render test (`render_smoke.tsx`) is
  replaced by a real HTTP-based regression test
  (`apps/web/test/route_smoke.ts`) that starts an actual `next dev`
  server and asserts on genuine HTTP responses across all 14 routes
  plus the root redirect.
- `vercel.json` and CI updated for the Next.js build.

## Significant regressions found and fixed during execution

Each of the following was caught by task-level or whole-branch review
(not shipped silently), fixed, and independently re-verified before
being counted as done:

- **Missing entry-point cleanup**: the old `App.tsx`/`main.tsx` were
  never explicitly deleted in the original plan; leaving them in place
  after screen-component prop signatures changed would have broken
  `tsc --noEmit`. Caught during execution, added to the task that
  changed those signatures, verified clean.
- **Dead-click buttons not visibly disabled**: a bare `disabled`
  attribute was invisible because the buttons' CSS set explicit
  `background`/`color` that override the browser's default disabled
  dimming. Fixed with explicit `:disabled { opacity: .5; cursor:
  not-allowed }` rules.
- **Windows process-spawn/kill issues** in the new HTTP-based
  regression test: Node 24 on Windows rejects spawning `.cmd` files
  without `shell: true` (a real Node security-hardening change), and a
  bare `.kill()` left the actual `next dev` process orphaned. Fixed
  with a platform-gated `shell`/`taskkill` branch; verified to leave
  Linux/CI behavior unchanged.
- **Windows shell-quoting bug** in the fixture-boundary CI script:
  single-quoted `git ls-files` arguments silently matched zero files
  under `cmd.exe`, which would have made the CI gate a no-op. Fixed
  with double quotes (correct on both `cmd.exe` and POSIX shells).
- **`next build` failure**: all 7 `/client/*` routes failed static
  prerendering because `useSearchParams()` was called without a
  Suspense boundary — invisible under `next dev`, only surfaced by a
  real production build. Fixed by marking the `/client/*` route group
  dynamically rendered (`apps/web/app/client/layout.tsx`, `export
  const dynamic = "force-dynamic"`), the semantically correct fix
  since these routes read a per-request `?preview=1` query parameter
  that was never a static-generation candidate.
- **Ungitignored build output**: `apps/web/.next/` was untracked but
  not excluded in `.gitignore`, risking an accidental commit. Fixed.
- **Sample-data disclosure regression**: the final whole-branch review
  found `<SampleDataTag />` (the "this is a fictional demo project"
  banner) was wired into the new `AdminChrome` but never added to
  `ClientChrome`, silently dropping the disclosure from all 7 client
  routes — a real content regression against this project's
  non-negotiable that demo data must never be mistaken for real. Fixed
  and covered by a new regression-test assertion.

## Detailed execution history

The full task-by-task execution ledger (12 tasks, each with its own
implementer/reviewer subagent pair, fix rounds, and commit SHAs) lived
at `.superpowers/sdd/progress.md` during execution — that file is
gitignored scratch state, not part of this repository's committed
history. This document is the durable record of what happened and why
it matters; the ledger itself is not preserved.

## Next milestone

P1 — see `PRODUCTION-ROADMAP.md`'s current "Package P1" section (now
the active package as of this milestone's completion).
