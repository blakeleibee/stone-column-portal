# Package P0 — Next.js Migration & Production Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `apps/web`'s esbuild SPA into a Next.js App Router app with no visual or product redesign, establish the server/client component boundary, and lay the environment/secrets/CI/deployment scaffolding every later production package depends on — per `docs/production-build/PRODUCTION-ROADMAP.md`'s Package P0 and `docs/production-build/TARGET-ARCHITECTURE.md` §5.

**Architecture:** Every existing `AppShell` `activeKey` becomes a real Next.js route under `app/admin/<key>/` or `app/client/<key>/`. Two new client-side "chrome" components (`AdminChrome`, `ClientChrome`) own routing/navigation and wrap the unchanged `AppShell`/`DemoControls`. Data-fetching (the fixture repository calls) moves into `async` Server Component `page.tsx` files; anything with `useState`/`useEffect`/`onClick` in its own JSX gets a `"use client"` directive. No screen's visual output, copy, or component tree changes — only how it's served and routed.

**Tech Stack:** Next.js 14 (App Router) on top of the existing React 18.3.1 / TypeScript 5.9.3 stack. No new UI library, no CSS framework, no state-management library, no test framework (regression tests keep the existing plain-`tsx`-script-with-`check()`-helper convention already used by `render_smoke.tsx`).

## Global Constraints

- Money is always an integer number of cents. Never a float. (Not touched by this package — no new financial code.)
- No screen computes its own financial numbers — everything already routes through `packages/01-financial-engine`; this migration must not add a parallel calculation path.
- No new database tables, no auth, no real financial writes, no external service connections of any kind (`PRODUCTION-ROADMAP.md` P0 explicit exclusions).
- No product scope change, no new screens, no visual redesign — approved visual language (design tokens, `AppShell` chrome), navigation structure, financial logic, and construction terminology are preserved exactly (`PRODUCTION-ROADMAP.md` P0 acceptance criterion 6).
- Every mobile-facing screen is designed portrait-first. (Unchanged — no layout/CSS edits in this plan beyond adding `disabled` attributes and directives.)
- `.env.example` is the only tracked `.env*` file, ever.

### Documented behavior simplifications (call out explicitly, do not treat as bugs)

The original SPA's admin/staff/client role switcher (`DemoControls`) is explicitly labeled "not part of the real sign-in flow" — it is a demo-only affordance, not a screen or product feature. Converting it from in-memory React state to real URL routes requires two small, deliberate simplifications, both scoped to this demo control only (no real screen's content, copy, or behavior changes):

1. The **admin/staff cosmetic toggle** (which only changes the displayed name "Brent Leibee" vs. "Staff Member" and which `DemoControls` button is highlighted — it does not change any screen) is kept as local `useState` inside `AdminChrome`, defaulting to `"admin"`. It resets to `"admin"` if you navigate away to `/client/*` and back, instead of being remembered indefinitely. This only affects a demo-only cosmetic label, never a real screen.
2. **Exiting "Preview as Client" mode** always returns to `/admin/overview` (previously it returned to whatever admin `activeKey` was active before the preview started). This is because real distinct URLs, unlike in-memory state, don't carry an implicit "previous admin screen" without either a cookie or query param dedicated solely to this demo control — not worth adding for a demo-only affordance.

Both are noted here so a reviewer isn't surprised; if either simplification is judged unacceptable, flag it before merging rather than silently living with it.

---

### File structure this plan produces

```
apps/web/
  next.config.mjs                        (new)
  next-env.d.ts                          (new, Next-generated)
  tsconfig.json                          (rewritten for Next)
  package.json                           (deps/scripts rewritten)
  public/assets/logo.jpg                 (new, moved from packages/02-app-shell/src/assets)
  public/assets/logo.svg                 (new, moved from packages/02-app-shell/src/assets)
  app/
    layout.tsx                           (new — root layout)
    globals.css                          (new)
    error.tsx                            (new — root error boundary)
    page.tsx                             (new — redirects to /admin/overview)
    admin/
      overview/page.tsx                  (new)
      projects/page.tsx                  (new)
      action-center/page.tsx             (new)
      financials/page.tsx                (new)
      conversations/page.tsx             (new)
      contacts/page.tsx                  (new)
      settings/page.tsx                  (new)
    client/
      home/page.tsx                      (new)
      budget/page.tsx                    (new)
      schedule/page.tsx                  (new)
      selections/page.tsx                (new)
      messages/page.tsx                  (new)
      updates/page.tsx                   (new)
      documents/page.tsx                 (new)
  src/
    shell/
      AdminChrome.tsx                    (new — client component, routing + DemoControls wiring)
      ClientChrome.tsx                   (new — client component, routing + DemoControls wiring)
    data/
      loadViewModels.ts                  (new — server-only fixture-repository loader)
    screens/
      AdminOverviewScreen.tsx            (modified — "use client", drop onOpenProject prop)
      ClientHomeScreen.tsx               (modified — "use client", drop onGoToBudget prop)
      ProjectWorkspace.tsx               (modified — "use client", disable 2 dead-click buttons)
    demo/
      DemoControls.tsx                   (modified — "use client" only)
    App.tsx                              (deleted in Task 6 — superseded by AdminChrome/ClientChrome + real routes)
    main.tsx                             (deleted in Task 6 — superseded by app/layout.tsx + page.tsx)
  test/
    route_smoke.ts                       (new, replaces render_smoke.tsx)
  build.mjs                              (deleted)
  index.html                             (deleted)
  dev-dist/                              (deleted, was gitignored anyway)
packages/02-app-shell/src/components/AppShell.tsx  (modified — "use client" only)
scripts/
  check-fixture-boundaries.mjs           (new)
.env.example                             (new)
docs/production-build/
  ENVIRONMENTS-RUNBOOK.md                (new)
  P0-LOGGING-MONITORING.md               (new)
vercel.json                              (rewritten)
.github/workflows/ci.yml                 (two new steps)
CLAUDE.md                                (one line fixed: build output path)
```

---

### Route ↔ activeKey mapping (reference for every task below)

| Role | activeKey | Route | Screen rendered |
|---|---|---|---|
| admin | `overview` | `/admin/overview` | `AdminOverviewScreen` |
| admin | `projects` | `/admin/projects` | `ProjectWorkspace` (default tab) |
| admin | `action-center` | `/admin/action-center` | `ActionCenterScreen` |
| admin | `financials` | `/admin/financials` | `ProjectWorkspace initialTab="financials"` |
| admin | `conversations` | `/admin/conversations` | `ConversationsTab` |
| admin | `contacts` | `/admin/contacts` | `ContactsScreen` |
| admin | `settings` | `/admin/settings` | `PlaceholderScreen` |
| client | `home` | `/client/home` | `ClientHomeScreen` |
| client | `budget` | `/client/budget` | `ClientBudgetAndInvoicesScreen` |
| client | `schedule` | `/client/schedule` | `ScheduleClientTab` |
| client | `selections` | `/client/selections` | `SelectionsTab isClient` |
| client | `messages` | `/client/messages` | `ConversationsTab` |
| client | `updates` | `/client/updates` | `UpdatesTab isClient` |
| client | `documents` | `/client/documents` | `DocumentsTab isClient` |

`ProjectWorkspace`'s own internal tab bar (Overview/Financials/Schedule/Selections/Documents/Updates/Conversations, reached only via `/admin/projects` and `/admin/financials`) is **not** converted to routes in this package — it is unrelated internal component state that already existed before this migration and is out of scope for "AppShell's `activeKey`/`onNavigate` become real routes."

---

## Task 1: Environment scaffolding and required documentation

**Files:**
- Create: `.env.example`
- Create: `docs/production-build/ENVIRONMENTS-RUNBOOK.md`
- Create: `docs/production-build/P0-LOGGING-MONITORING.md`

**Interfaces:**
- Consumes: variable names from `TARGET-ARCHITECTURE.md` §10; environment table from §1; logging baseline from §11.
- Produces: nothing consumed by later tasks — this is a standalone documentation/scaffolding task satisfying P0 acceptance criteria 1, 2, and 4.

- [ ] **Step 1: Create `.env.example`**

```
# Stone Column Portal — environment variable template.
# Zero real values here, ever. Real secrets live in Vercel's/Supabase's
# own environment-variable stores per environment (local/preview/
# production — see docs/production-build/ENVIRONMENTS-RUNBOOK.md), never
# in this repository at any commit. See
# docs/production-build/TARGET-ARCHITECTURE.md §10 for the full rules.

# ---- Public / client-safe (safe to expose in the browser bundle) ----
# Supabase's own design: the project URL and anon key are meant to be
# public. RLS is the real security boundary, not secrecy of these two
# values (TARGET-ARCHITECTURE.md §2, §10). Not yet used by any code in
# this package (P0 has no Supabase connection) — reserved for P1+.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# ---- Server-only secrets (never referenced in client-bundled code) ----
# Bypasses RLS entirely. Restricted to the narrow cases in
# TARGET-ARCHITECTURE.md §5.2: verified webhooks, background jobs,
# environment provisioning, explicit admin cross-project operations.
SUPABASE_SERVICE_ROLE_KEY=

# E-signature provider (provider TBD at P7 implementation time — see
# TARGET-ARCHITECTURE.md §9).
ESIGNATURE_API_KEY=

# ACH/card payment provider (provider TBD at P6b implementation time —
# see TARGET-ARCHITECTURE.md §9).
PAYMENT_PROVIDER_SECRET_KEY=

# Microsoft Graph (OneDrive/SharePoint file storage §8, email/calendar
# sync §9). The client ID is not itself a secret but is required
# alongside the secret to authenticate.
MICROSOFT_GRAPH_CLIENT_ID=
MICROSOFT_GRAPH_CLIENT_SECRET=
MICROSOFT_GRAPH_TENANT_ID=
```

- [ ] **Step 2: Confirm `.gitignore` already protects real `.env*` files**

Run: `git check-ignore -v .env .env.local .env.production` (create empty test files first if needed, then delete them — do not commit them)
Expected: each path reported as ignored by the existing `.env` / `.env.*` / `!.env.example` rules in `.gitignore` (already present from the imported baseline — no `.gitignore` change needed in this task).

- [ ] **Step 3: Create `docs/production-build/ENVIRONMENTS-RUNBOOK.md`**

```markdown
# Environments Runbook

Operational companion to `TARGET-ARCHITECTURE.md` §1. That document
states *what* the three environments are; this document states *how*
to stand each one up and keep them wired correctly. No live Supabase
project exists yet as of this package (P0) — creating the first one is
P1's job. This runbook is the written procedure P1 follows.

## The three environments, restated precisely

| Environment | Supabase project | Hosting | Env vars live in |
|---|---|---|---|
| Local | Supabase CLI local stack (`supabase start`) | `next dev` (this package) | `.env.local` (gitignored, never committed) |
| Preview/staging | One shared Supabase project, or one ephemeral project per PR if branching is available on the plan in use | Vercel preview deployments (automatic per PR) | Vercel project's Preview environment variables |
| Production | Dedicated Supabase project | Vercel production deployment | Vercel project's Production environment variables |

**Never** the same Supabase project reused across two of these rows with
a "dev flag" distinguishing them — each is a genuinely separate project
with its own connection string, its own auth users, its own data.

## Standing rule

Local and preview both run the exact same migration files as production,
applied through the exact same tool (`supabase db push` or equivalent).
There is no environment-specific schema.

## What P1 does with this runbook

1. Run `supabase init` at the repo root (once).
2. Run `supabase start` to bring up the local Dockerized Postgres stack.
3. Apply `schema/001_core_financial.sql` through `005_*.sql` against it
   for the first time ever (this is P1's actual scope — see
   `PRODUCTION-ROADMAP.md`'s Package P1 section).
4. Create `.env.local` (gitignored) from `.env.example`, filled with the
   local stack's own URL/anon key (`supabase status` prints these).
5. Create the Preview Supabase project (or confirm branching is
   available on the current plan — a cost-linked decision flagged in
   `TARGET-ARCHITECTURE.md` §1, not assumed here) and set its
   corresponding variables in Vercel's Preview environment.
6. Create the Production Supabase project and set its variables in
   Vercel's Production environment. No sample/fixture data is ever
   seeded here (`DATA-MIGRATION-AND-FIXTURES.md`).

## What this package (P0) does NOT do

No live Supabase project of any kind is created in P0. `next dev` runs
today exactly as the old esbuild dev server did — against the fixture
repository (`FixtureFinancialRepository`), no environment variables
required to run it locally.
```

- [ ] **Step 4: Create `docs/production-build/P0-LOGGING-MONITORING.md`**

```markdown
# P0 Logging & Monitoring Baseline

Restates and confirms `TARGET-ARCHITECTURE.md` §11 as the adopted
baseline for this package, and states plainly what's code, what's
dashboard configuration, and what's still an open owner decision.

## What's implemented in code by this package

- A root React error boundary (`apps/web/app/error.tsx`) wraps every
  route — a single screen's thrown render error shows a fallback
  message with a "Try again" control, not a blank page. This closes the
  "no error states anywhere" gap `PRODUCTION-READINESS-AUDIT.md` flags.

## What's runtime configuration, not code (no action needed in this repo to enable)

- **Vercel's built-in deployment/function logs and analytics** — on by
  default for any Vercel project, including this one once the Next.js
  build deploys. Nothing to configure.
- **Supabase's built-in Postgres logs and dashboard** — available once
  a real Supabase project exists (P1). Nothing to configure today.

## Explicitly deferred — a genuine owner decision, not silently added or silently skipped

- A dedicated error-reporting service (e.g. Sentry or equivalent) is
  **recommended but not assumed**, per `TARGET-ARCHITECTURE.md` §11 —
  it has a cost/plan implication. This package does not add one. If/when
  it's added, it wraps the same `app/error.tsx` boundary already in
  place rather than replacing it.
```

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/production-build/ENVIRONMENTS-RUNBOOK.md docs/production-build/P0-LOGGING-MONITORING.md
git commit -m "P0: add .env.example, environments runbook, logging/monitoring baseline doc"
```

---

## Task 2: Install Next.js, remove esbuild tooling, scaffold config

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/next.config.mjs`
- Modify: `apps/web/tsconfig.json`
- Delete: `apps/web/build.mjs`, `apps/web/index.html`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a working `next dev` / `next build` toolchain every subsequent task's routes rely on.

- [ ] **Step 1: Install Next.js and drop esbuild**

```bash
npm install --workspace=apps/web next@14
npm uninstall --workspace=apps/web esbuild
npx next --version
```

Record the resolved version printed by `npx next --version` (expected `14.x.x`) — this is the version that ends up in `apps/web/package.json`'s `dependencies.next` after `npm install`.

- [ ] **Step 2: Add `@types/node` (needed for Next's generated tsconfig and `next.config.mjs`'s use of `node:path`/`node:url`)**

```bash
npm install --workspace=apps/web --save-dev @types/node@20
```

- [ ] **Step 3: Rewrite `apps/web/package.json` scripts and dependency list**

```json
{
  "name": "@stone-column/preview-app",
  "version": "0.1.0",
  "private": true,
  "description": "Stone Column Portal — browser-viewable interactive preview using the approved Package 2 AppShell, repositories, view models, and the Package 1 financial engine. Sample data only; no auth, no Supabase, no real credentials.",
  "scripts": {
    "dev": "next dev -p 5173 -H 127.0.0.1",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "test": "tsx test/route_smoke.ts"
  },
  "dependencies": {
    "next": "14.2.18",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "tsx": "4.16.2",
    "@types/node": "20.14.15",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0"
  },
  "engines": {
    "node": ">=18.17.0"
  }
}
```

(`engines.node` raised from `>=18.0.0` to `>=18.17.0` because Next.js 14 requires it — a mechanical consequence of adopting Next, not a scope-creep change. Replace `"next": "14.2.18"` with whatever exact version Step 1 actually resolved if it differs.)

- [ ] **Step 4: Create `apps/web/next.config.mjs`**

```js
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app imports packages/01-financial-engine and
  // packages/02-app-shell via relative paths that reach outside
  // apps/web's own directory (an npm-workspaces monorepo, not a
  // package-name import) — Next.js blocks that by default.
  experimental: {
    externalDir: true,
  },
  // Root package-lock.json lives two levels above apps/web; tell Next
  // explicitly where the monorepo root is instead of letting it guess.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // No linter is configured in this repo yet (see CLAUDE.md's standing
  // disclosure) — do not let `next build` block on an absent eslint
  // config or silently install one.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
```

- [ ] **Step 5: Delete the old esbuild entry points**

```bash
rm apps/web/build.mjs apps/web/index.html
```

- [ ] **Step 6: Run `next dev` once to let it generate `next-env.d.ts` and validate/patch `tsconfig.json`, then stop it**

```bash
cd apps/web
npx next dev -p 5173 -H 127.0.0.1
```

Expected: it prints a message about updating `tsconfig.json` (since `app/` doesn't exist yet, it may also warn about a missing `app` or `pages` directory — that's expected, later tasks create `app/`). Press Ctrl+C once it's running. Inspect the resulting `next-env.d.ts` and any `tsconfig.json` changes; if `tsconfig.json` wasn't auto-patched (some Next versions only patch it once `app/` exists), replace it manually with Step 7's content instead.

- [ ] **Step 7: Ensure `apps/web/tsconfig.json` matches Next's standard App Router shape**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", "app/**/*.ts", "app/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/next.config.mjs apps/web/tsconfig.json apps/web/next-env.d.ts package-lock.json
git rm apps/web/build.mjs apps/web/index.html
git commit -m "P0: install Next.js, remove esbuild toolchain, scaffold Next config"
```

(There is no committed working `app/` or `src` change yet at this point, so `next build`/`next dev` won't fully succeed until later tasks land — that's expected; this task only proves the toolchain installs and the config files are syntactically valid. Do not run `npm run build` as a gate for this task.)

---

## Task 3: Root layout, global styles, static assets, redirect page, error boundary

**Files:**
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/error.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/public/assets/logo.jpg`, `apps/web/public/assets/logo.svg`

**Interfaces:**
- Consumes: nothing.
- Produces: the app shell every route in Tasks 7–8 renders inside; the `/assets/logo.jpg` URL `AppShell.tsx` already references (`LOGO_SRC = "/assets/logo.jpg"`, unchanged).

- [ ] **Step 1: Copy the logo assets into `public/`**

```bash
mkdir -p apps/web/public/assets
cp packages/02-app-shell/src/assets/logo.jpg apps/web/public/assets/logo.jpg
cp packages/02-app-shell/src/assets/logo.svg apps/web/public/assets/logo.svg
```

(PowerShell equivalent: `New-Item -ItemType Directory -Force apps/web/public/assets; Copy-Item packages/02-app-shell/src/assets/logo.jpg apps/web/public/assets/logo.jpg; Copy-Item packages/02-app-shell/src/assets/logo.svg apps/web/public/assets/logo.svg`)

Next.js serves everything under `public/` at the site root automatically, so `/assets/logo.jpg` continues to resolve exactly as it did under the old `build.mjs`'s manual asset-copy step (deleted in Task 2) — no change needed in `AppShell.tsx`.

- [ ] **Step 2: Create `apps/web/app/globals.css`**

```css
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

- [ ] **Step 3: Create `apps/web/app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stone Column Portal — Preview",
  description: "Stone Column Custom Homes & Remodeling — internal operating platform preview.",
  robots: "noindex",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/error.tsx` (the required React error boundary — P0 acceptance criterion 3)**

```tsx
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif", color: "#8B7F6C" }}>
      <h1 style={{ fontSize: 18, marginBottom: 8, color: "#3A3A3A" }}>Something went wrong</h1>
      <p style={{ marginBottom: 16 }}>
        This screen hit an unexpected error. The rest of the portal is unaffected — try again, or navigate
        elsewhere from the menu.
      </p>
      <button onClick={() => reset()} style={{ padding: "8px 14px" }}>
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/web/app/page.tsx` (root redirect, matching the SPA's original default landing state)**

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/admin/overview");
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/layout.tsx apps/web/app/globals.css apps/web/app/error.tsx apps/web/app/page.tsx apps/web/public/assets/logo.jpg apps/web/public/assets/logo.svg
git commit -m "P0: add Next.js root layout, error boundary, redirect page, static assets"
```

---

## Task 4: Server-only view-model loader

**Files:**
- Create: `apps/web/src/data/loadViewModels.ts`

**Interfaces:**
- Consumes: `FixtureFinancialRepository`, `buildAdminFinancialsViewModel`, `buildClientBudgetViewModel`, `projectMeta` (all pre-existing, unchanged).
- Produces: `loadAdminVM(): Promise<AdminFinancialsViewModel>` and `loadClientVM(): Promise<ClientBudgetViewModel>`, consumed by every `page.tsx` in Tasks 7–8 and by `test/route_smoke.ts` in Task 10.

- [ ] **Step 1: Create the file**

```ts
import { FixtureFinancialRepository } from "../../../../packages/02-app-shell/src/data/fixtureFinancialRepository";
import { buildAdminFinancialsViewModel } from "../../../../packages/02-app-shell/src/viewmodels/buildAdminFinancialsViewModel";
import { buildClientBudgetViewModel } from "../../../../packages/02-app-shell/src/viewmodels/buildClientBudgetViewModel";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import type { AdminFinancialsViewModel, ClientBudgetViewModel } from "../../../../packages/02-app-shell/src/viewmodels/types";

const repo = new FixtureFinancialRepository();

export async function loadAdminVM(): Promise<AdminFinancialsViewModel> {
  return buildAdminFinancialsViewModel(projectMeta.id, repo);
}

export async function loadClientVM(): Promise<ClientBudgetViewModel> {
  return buildClientBudgetViewModel(projectMeta.id, repo);
}
```

- [ ] **Step 2: Verify it type-checks in isolation**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `loadViewModels.ts` (errors about missing `app/` files from earlier/later tasks not yet written are expected at this point and are not this step's concern).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/data/loadViewModels.ts
git commit -m "P0: add server-only fixture view-model loader for Next.js pages"
```

---

## Task 5: Client-side chrome components (routing + DemoControls wiring)

**Files:**
- Create: `apps/web/src/shell/AdminChrome.tsx`
- Create: `apps/web/src/shell/ClientChrome.tsx`

**Interfaces:**
- Consumes: `AppShell`, `DemoControls` (both get their `"use client"` directive added next, in Task 6 — the directive doesn't change either component's exported type, so building this task before that one is not a problem), `SampleDataTag`, `projectMeta`.
- Produces: `AdminChrome({ activeKey: string; children: ReactNode })` and `ClientChrome({ activeKey: string; children: ReactNode })`, consumed by every `page.tsx` in Tasks 7–8.

- [ ] **Step 1: Create `apps/web/src/shell/AdminChrome.tsx`**

```tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../../../packages/02-app-shell/src/components/AppShell";
import type { AppRole } from "../../../../packages/02-app-shell/src/nav/navigation";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { DemoControls } from "../demo/DemoControls";
import { SampleDataTag } from "../components/SampleDataTag";

const ADMIN_PATH: Record<string, string> = {
  overview: "/admin/overview",
  projects: "/admin/projects",
  "action-center": "/admin/action-center",
  financials: "/admin/financials",
  conversations: "/admin/conversations",
  contacts: "/admin/contacts",
  settings: "/admin/settings",
};

const CLIENT_HOME_PATH = "/client/home";
const CLIENT_PREVIEW_PATH = "/client/budget?preview=1";

export function AdminChrome({ activeKey, children }: { activeKey: string; children: React.ReactNode }) {
  const router = useRouter();
  const [subRole, setSubRole] = useState<"admin" | "staff">("admin");

  function handleNavigate(key: string) {
    const path = ADMIN_PATH[key];
    if (path) router.push(path);
  }

  function handleChangeRole(role: AppRole) {
    if (role === "client") {
      router.push(CLIENT_HOME_PATH);
    } else {
      setSubRole(role);
    }
  }

  function handlePreviewAsClient() {
    router.push(CLIENT_PREVIEW_PATH);
  }

  return (
    <div>
      <DemoControls
        role={subRole}
        onChangeRole={handleChangeRole}
        isPreviewingAsClient={false}
        onPreviewAsClient={handlePreviewAsClient}
      />
      <AppShell
        role={subRole}
        activeKey={activeKey}
        onNavigate={handleNavigate}
        userName={subRole === "admin" ? "Brent Leibee" : "Staff Member"}
        projectName={projectMeta.name}
      >
        <SampleDataTag />
        {children}
      </AppShell>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/shell/ClientChrome.tsx`**

```tsx
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "../../../../packages/02-app-shell/src/components/AppShell";
import type { AppRole } from "../../../../packages/02-app-shell/src/nav/navigation";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { DemoControls } from "../demo/DemoControls";

const CLIENT_PATH: Record<string, string> = {
  home: "/client/home",
  budget: "/client/budget",
  schedule: "/client/schedule",
  selections: "/client/selections",
  messages: "/client/messages",
  updates: "/client/updates",
  documents: "/client/documents",
};

const ADMIN_OVERVIEW_PATH = "/admin/overview";

export function ClientChrome({ activeKey, children }: { activeKey: string; children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPreviewingAsClient = searchParams.get("preview") === "1";
  const clientUserName = (projectMeta.clientNames ?? "Client").split(" & ")[0];

  function handleNavigate(key: string) {
    const path = CLIENT_PATH[key];
    if (!path) return;
    router.push(isPreviewingAsClient ? `${path}?preview=1` : path);
  }

  function handleChangeRole(role: AppRole) {
    if (role === "client") {
      if (isPreviewingAsClient) {
        router.push(CLIENT_PATH[activeKey] ?? CLIENT_PATH.home);
      }
      // else: already a genuine client view, no-op — matches the
      // original in-memory behavior of clicking the already-active role.
    } else {
      router.push(ADMIN_OVERVIEW_PATH);
    }
  }

  function handlePreviewAsClient() {
    router.push(`${CLIENT_PATH.budget}?preview=1`);
  }

  function handleExitPreview() {
    router.push(ADMIN_OVERVIEW_PATH);
  }

  return (
    <div>
      <DemoControls
        role="client"
        onChangeRole={handleChangeRole}
        isPreviewingAsClient={isPreviewingAsClient}
        onPreviewAsClient={handlePreviewAsClient}
      />
      <AppShell
        role="client"
        activeKey={activeKey}
        onNavigate={handleNavigate}
        userName={clientUserName}
        isPreviewingAsClient={isPreviewingAsClient}
        onExitPreview={handleExitPreview}
      >
        {children}
      </AppShell>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/shell/AdminChrome.tsx apps/web/src/shell/ClientChrome.tsx
git commit -m "P0: add AdminChrome/ClientChrome client components (real-route navigation)"
```

---

## Task 6: Convert interactive components to Client Components; disable dead-click controls

**Files:**
- Modify: `packages/02-app-shell/src/components/AppShell.tsx`
- Modify: `apps/web/src/demo/DemoControls.tsx`
- Modify: `apps/web/src/screens/AdminOverviewScreen.tsx`
- Modify: `apps/web/src/screens/ClientHomeScreen.tsx`
- Modify: `apps/web/src/screens/ProjectWorkspace.tsx`
- Delete: `apps/web/src/App.tsx`, `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AdminOverviewScreen({ adminVM })` (drops `onOpenProject`), `ClientHomeScreen({ clientVM })` (drops `onGoToBudget`) — both now navigate internally via `next/navigation`. Consumed by Tasks 7–8's `page.tsx` files, which must NOT pass the old callback props.

**Why the deletion belongs in this task, not a later one:** `apps/web/src/App.tsx` calls `<AdminOverviewScreen onOpenProject={...} adminVM={adminVM} />` and `<ClientHomeScreen onGoToBudget={...} clientVM={clientVM} />` with the exact props this task removes. `apps/web/tsconfig.json` (rewritten in Task 2) includes `src/**/*.tsx` in its typecheck scope, so the moment this task's Step 3/4 signature changes land, `App.tsx` starts failing `tsc --noEmit` with an excess-property error unless it is deleted in the same commit. `apps/web/src/main.tsx` (the old `createRoot(...).render(<App />)` entry point) has no purpose once `apps/web/app/layout.tsx`/`page.tsx` (Task 3) and `AdminChrome`/`ClientChrome` (Task 5) are the real entry points — delete it alongside `App.tsx` since it exists only to render it. Nothing else in the codebase imports either file: the only other reference, `apps/web/test/render_smoke.tsx`, is already orphaned as of Task 2 (its `test` script was repointed to the not-yet-created `test/route_smoke.ts`, so `render_smoke.tsx` is not run by `npm run test` and — since `apps/web/tsconfig.json`'s `include` list has no `test/**` entry — is not typechecked either; it is deleted for good in Task 10).

- [ ] **Step 1: Add `"use client"` to `packages/02-app-shell/src/components/AppShell.tsx`**

At the very top of the file, before the existing `import React...` line, add:

```tsx
"use client";

```

No other change to this file — its props, behavior, and the package-level `render_smoke.tsx` test (which renders it directly via `renderToStaticMarkup` outside any Next.js runtime, where directives are inert) are unaffected.

- [ ] **Step 2: Add `"use client"` to `apps/web/src/demo/DemoControls.tsx`**

At the very top of the file, before `import React...`, add:

```tsx
"use client";

```

No other change — its props are unchanged.

- [ ] **Step 3: Modify `apps/web/src/screens/AdminOverviewScreen.tsx` — add `"use client"`, drop `onOpenProject` prop, navigate internally**

At the top of the file, add `"use client";` as the first line, then add `import { useRouter } from "next/navigation";` alongside the existing imports.

Change:
```tsx
export function AdminOverviewScreen({ onOpenProject, adminVM }: { onOpenProject: () => void; adminVM: AdminFinancialsViewModel }) {
```
to:
```tsx
export function AdminOverviewScreen({ adminVM }: { adminVM: AdminFinancialsViewModel }) {
  const router = useRouter();
```

Change:
```tsx
<button className="sc-project-card" onClick={onOpenProject}>
```
to:
```tsx
<button className="sc-project-card" onClick={() => router.push("/admin/projects")}>
```

- [ ] **Step 4: Modify `apps/web/src/screens/ClientHomeScreen.tsx` — add `"use client"`, drop `onGoToBudget` prop, navigate internally (preserving `?preview=1`)**

At the top of the file, add `"use client";` as the first line, then add `import { useRouter, useSearchParams } from "next/navigation";` alongside the existing imports.

Change:
```tsx
export function ClientHomeScreen({ onGoToBudget, clientVM }: { onGoToBudget: () => void; clientVM: ClientBudgetViewModel }) {
```
to:
```tsx
export function ClientHomeScreen({ clientVM }: { clientVM: ClientBudgetViewModel }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPreviewingAsClient = searchParams.get("preview") === "1";
```

Change:
```tsx
<button className="sc-card sc-card--clickable" onClick={onGoToBudget}>
```
to:
```tsx
<button
  className="sc-card sc-card--clickable"
  onClick={() => router.push(isPreviewingAsClient ? "/client/budget?preview=1" : "/client/budget")}
>
```

- [ ] **Step 5: Modify `apps/web/src/screens/ProjectWorkspace.tsx` — add `"use client"`, disable the two dead-click controls**

At the top of the file, add `"use client";` as the first line.

Change (Selections tab — P0 acceptance criterion 5):
```tsx
<button className="sc-btn-primary sc-selection-approve-btn">Review &amp; Approve (preview)</button>
```
to:
```tsx
<button className="sc-btn-primary sc-selection-approve-btn" disabled>Review &amp; Approve (preview)</button>
```

Change (Documents tab — P0 acceptance criterion 5):
```tsx
<button className="sc-link-btn">Download</button>
```
to:
```tsx
<button className="sc-link-btn" disabled>Download</button>
```

- [ ] **Step 6: Delete the now-superseded SPA entry point**

```bash
git rm apps/web/src/App.tsx apps/web/src/main.tsx
```

`apps/web/app/layout.tsx` + `page.tsx` (Task 3) and `AdminChrome`/`ClientChrome` (Task 5) now own everything these two files did (rendering into `#root`, the admin/client routing switch). Confirm nothing else in the repo still imports either path before deleting:

```bash
grep -rn "from [\"'].*/App[\"']" apps/web/src apps/web/app 2>/dev/null
grep -rn "from [\"'].*/main[\"']" apps/web/src apps/web/app 2>/dev/null
```

Expected: no output (the only prior importer, `apps/web/test/render_smoke.tsx`, is deleted separately in Task 10 and is not part of `apps/web/src` or `apps/web/app`).

- [ ] **Step 7: Run typecheck to confirm the deletion didn't leave a dangling reference**

```bash
cd apps/web
npx tsc --noEmit
```

Expected: no errors referencing `App.tsx` or `main.tsx` (errors about `app/`/other files not yet created by later tasks are not this step's concern — Tasks 7–8 haven't run yet, so `next build`-level completeness isn't expected here, but `tsc --noEmit` against `src/**` should be clean for anything this task touched).

- [ ] **Step 8: Commit**

```bash
git add packages/02-app-shell/src/components/AppShell.tsx apps/web/src/demo/DemoControls.tsx apps/web/src/screens/AdminOverviewScreen.tsx apps/web/src/screens/ClientHomeScreen.tsx apps/web/src/screens/ProjectWorkspace.tsx
git commit -m "P0: mark interactive components client-only, disable dead-click controls, remove superseded SPA entry point"
```

---

## Task 7: Admin routes

**Files:**
- Create: `apps/web/app/admin/overview/page.tsx`
- Create: `apps/web/app/admin/projects/page.tsx`
- Create: `apps/web/app/admin/action-center/page.tsx`
- Create: `apps/web/app/admin/financials/page.tsx`
- Create: `apps/web/app/admin/conversations/page.tsx`
- Create: `apps/web/app/admin/contacts/page.tsx`
- Create: `apps/web/app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `AdminChrome` (Task 5), `loadAdminVM` (Task 4), the (now client) screen components (Task 6).
- Produces: the 7 admin routes listed in the route table above.

- [ ] **Step 1: `apps/web/app/admin/overview/page.tsx`**

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { AdminOverviewScreen } from "../../../src/screens/AdminOverviewScreen";
import { loadAdminVM } from "../../../src/data/loadViewModels";

export default async function AdminOverviewPage() {
  const adminVM = await loadAdminVM();
  return (
    <AdminChrome activeKey="overview">
      <AdminOverviewScreen adminVM={adminVM} />
    </AdminChrome>
  );
}
```

- [ ] **Step 2: `apps/web/app/admin/projects/page.tsx`**

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectWorkspace } from "../../../src/screens/ProjectWorkspace";
import { loadAdminVM } from "../../../src/data/loadViewModels";

export default async function AdminProjectsPage() {
  const adminVM = await loadAdminVM();
  return (
    <AdminChrome activeKey="projects">
      <ProjectWorkspace adminViewModel={adminVM} />
    </AdminChrome>
  );
}
```

- [ ] **Step 3: `apps/web/app/admin/action-center/page.tsx`**

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ActionCenterScreen } from "../../../src/screens/ActionCenterScreen";

export default function AdminActionCenterPage() {
  return (
    <AdminChrome activeKey="action-center">
      <ActionCenterScreen />
    </AdminChrome>
  );
}
```

- [ ] **Step 4: `apps/web/app/admin/financials/page.tsx`**

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectWorkspace } from "../../../src/screens/ProjectWorkspace";
import { loadAdminVM } from "../../../src/data/loadViewModels";

export default async function AdminFinancialsPage() {
  const adminVM = await loadAdminVM();
  return (
    <AdminChrome activeKey="financials">
      <ProjectWorkspace adminViewModel={adminVM} initialTab="financials" />
    </AdminChrome>
  );
}
```

- [ ] **Step 5: `apps/web/app/admin/conversations/page.tsx`**

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ConversationsTab } from "../../../src/screens/ProjectWorkspace";

export default function AdminConversationsPage() {
  return (
    <AdminChrome activeKey="conversations">
      <ConversationsTab />
    </AdminChrome>
  );
}
```

- [ ] **Step 6: `apps/web/app/admin/contacts/page.tsx`**

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ContactsScreen } from "../../../src/screens/ContactsScreen";

export default function AdminContactsPage() {
  return (
    <AdminChrome activeKey="contacts">
      <ContactsScreen />
    </AdminChrome>
  );
}
```

- [ ] **Step 7: `apps/web/app/admin/settings/page.tsx`**

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { PlaceholderScreen } from "../../../src/screens/PlaceholderScreen";

export default function AdminSettingsPage() {
  return (
    <AdminChrome activeKey="settings">
      <PlaceholderScreen
        title="Settings"
        description="Company profile, user management, cost-code library, and notification preferences."
        packageLabel="later package"
      />
    </AdminChrome>
  );
}
```

- [ ] **Step 8: Start the dev server and manually spot-check two routes**

```bash
cd apps/web
npx next dev -p 5173 -H 127.0.0.1
```

In another shell: `curl -s http://127.0.0.1:5173/admin/overview | grep -o "Hawks Ridge" ` and `curl -s http://127.0.0.1:5173/admin/financials | grep -o "Hawks Ridge"` — expected: both print `Hawks Ridge`. Stop the dev server (Ctrl+C) when done; the full automated version of this check is Task 10.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/admin
git commit -m "P0: add the 7 admin routes"
```

---

## Task 8: Client routes

**Files:**
- Create: `apps/web/app/client/home/page.tsx`
- Create: `apps/web/app/client/budget/page.tsx`
- Create: `apps/web/app/client/schedule/page.tsx`
- Create: `apps/web/app/client/selections/page.tsx`
- Create: `apps/web/app/client/messages/page.tsx`
- Create: `apps/web/app/client/updates/page.tsx`
- Create: `apps/web/app/client/documents/page.tsx`

**Interfaces:**
- Consumes: `ClientChrome` (Task 5), `loadClientVM` (Task 4), the (now client) screen components (Task 6), `ClientBudgetAndInvoicesScreen` (unchanged, from `packages/02-app-shell`).
- Produces: the 7 client routes listed in the route table above.

- [ ] **Step 1: `apps/web/app/client/home/page.tsx`**

```tsx
import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ClientHomeScreen } from "../../../src/screens/ClientHomeScreen";
import { loadClientVM } from "../../../src/data/loadViewModels";

export default async function ClientHomePage() {
  const clientVM = await loadClientVM();
  return (
    <ClientChrome activeKey="home">
      <ClientHomeScreen clientVM={clientVM} />
    </ClientChrome>
  );
}
```

- [ ] **Step 2: `apps/web/app/client/budget/page.tsx`**

```tsx
import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ClientBudgetAndInvoicesScreen } from "../../../../../packages/02-app-shell/src/screens/ClientBudgetAndInvoicesScreen";
import { loadClientVM } from "../../../src/data/loadViewModels";

export default async function ClientBudgetPage() {
  const clientVM = await loadClientVM();
  return (
    <ClientChrome activeKey="budget">
      <ClientBudgetAndInvoicesScreen viewModel={clientVM} />
    </ClientChrome>
  );
}
```

- [ ] **Step 3: `apps/web/app/client/schedule/page.tsx`**

```tsx
import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ScheduleClientTab } from "../../../src/screens/ScheduleClientTab";

export default function ClientSchedulePage() {
  return (
    <ClientChrome activeKey="schedule">
      <ScheduleClientTab />
    </ClientChrome>
  );
}
```

- [ ] **Step 4: `apps/web/app/client/selections/page.tsx`**

```tsx
import { ClientChrome } from "../../../src/shell/ClientChrome";
import { SelectionsTab } from "../../../src/screens/ProjectWorkspace";

export default function ClientSelectionsPage() {
  return (
    <ClientChrome activeKey="selections">
      <SelectionsTab isClient />
    </ClientChrome>
  );
}
```

- [ ] **Step 5: `apps/web/app/client/messages/page.tsx`**

```tsx
import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ConversationsTab } from "../../../src/screens/ProjectWorkspace";

export default function ClientMessagesPage() {
  return (
    <ClientChrome activeKey="messages">
      <ConversationsTab />
    </ClientChrome>
  );
}
```

- [ ] **Step 6: `apps/web/app/client/updates/page.tsx`**

```tsx
import { ClientChrome } from "../../../src/shell/ClientChrome";
import { UpdatesTab } from "../../../src/screens/ProjectWorkspace";

export default function ClientUpdatesPage() {
  return (
    <ClientChrome activeKey="updates">
      <UpdatesTab isClient />
    </ClientChrome>
  );
}
```

- [ ] **Step 7: `apps/web/app/client/documents/page.tsx`**

```tsx
import { ClientChrome } from "../../../src/shell/ClientChrome";
import { DocumentsTab } from "../../../src/screens/ProjectWorkspace";

export default function ClientDocumentsPage() {
  return (
    <ClientChrome activeKey="documents">
      <DocumentsTab isClient />
    </ClientChrome>
  );
}
```

- [ ] **Step 8: Manually spot-check the preview-as-client flow**

```bash
cd apps/web
npx next dev -p 5173 -H 127.0.0.1
```

In another shell: `curl -s "http://127.0.0.1:5173/client/budget?preview=1" | grep -o "Client preview"` — expected: prints `Client preview`. Then `curl -s "http://127.0.0.1:5173/client/budget" | grep -o "Client preview"` — expected: prints nothing (no banner without the query param). Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/client
git commit -m "P0: add the 7 client routes"
```

---

## Task 9: Fixture-import boundary CI script

**Files:**
- Create: `scripts/check-fixture-boundaries.mjs`

**Interfaces:**
- Consumes: `git ls-files` output.
- Produces: a script exiting non-zero if a fixture-only module is referenced outside its allowed boundary; wired into CI in Task 11.

- [ ] **Step 1: Write a deliberately-failing fixture first — a temporary violation file**

```bash
mkdir -p packages/01-financial-engine/src/tmp_violation_check
cat > packages/01-financial-engine/src/tmp_violation_check/leak.ts <<'EOF'
// Temporary file used only to prove check-fixture-boundaries.mjs
// actually catches a violation. Deleted in Step 4 of this task.
export const LEAK = "data/sampleContent";
EOF
```

- [ ] **Step 2: Write `scripts/check-fixture-boundaries.mjs`**

```js
#!/usr/bin/env node
// Fails if a fixture-only module (sample/demo data, or the fixture
// repository) is referenced from anywhere outside apps/web's own
// preview-app source tree or a test file. Extends the equivalent,
// smaller-scope check already enforced in
// packages/02-app-shell/test/render_smoke.tsx to the whole repo, per
// PRODUCTION-ROADMAP.md's Package P0 CI scope.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FORBIDDEN_SUBSTRINGS = ["fixtures/hawksRidge", "data/fixtureFinancialRepository", "data/sampleContent"];

// Files allowed to reference the above: the entire preview app (its
// whole purpose is demonstrating real logic against fixture data), any
// test file anywhere, and the fixture repository's own definition file
// (which legitimately imports the raw fixture data it wraps).
const ALLOWED_PATTERNS = [
  /^apps\/web\//,
  /\/test\//,
  /\.test\./,
  /packages\/02-app-shell\/src\/data\/fixtureFinancialRepository\.ts$/,
];

const trackedFiles = execSync("git ls-files -- '*.ts' '*.tsx'", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

const failures = [];

for (const file of trackedFiles) {
  if (ALLOWED_PATTERNS.some((pattern) => pattern.test(file))) continue;
  const content = readFileSync(file, "utf8");
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (content.includes(forbidden)) {
      failures.push(`${file} references "${forbidden}" outside its allowed boundary`);
    }
  }
}

if (failures.length > 0) {
  console.error("Fixture/demo data referenced outside its allowed boundary:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nFixture data (fixtures/hawksRidge, sampleContent, FixtureFinancialRepository) may only be " +
      "referenced from apps/web's own source tree or a test file. See PRODUCTION-ROADMAP.md's P0 CI scope."
  );
  process.exit(1);
}

console.log(`OK — checked ${trackedFiles.length} tracked TypeScript files, no fixture-boundary violations.`);
```

- [ ] **Step 3: Run it and confirm it catches the planted violation**

```bash
git add packages/01-financial-engine/src/tmp_violation_check/leak.ts
node scripts/check-fixture-boundaries.mjs
```

Expected: exits non-zero, prints a failure line naming `packages/01-financial-engine/src/tmp_violation_check/leak.ts`. (`git add` is required first — the script reads from `git ls-files`, which only lists tracked/staged files.)

- [ ] **Step 4: Delete the planted violation and confirm the script now passes clean**

```bash
git rm -r packages/01-financial-engine/src/tmp_violation_check
node scripts/check-fixture-boundaries.mjs
```

Expected: prints `OK — checked N tracked TypeScript files, no fixture-boundary violations.` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-fixture-boundaries.mjs
git commit -m "P0: add repo-wide fixture-import boundary check"
```

---

## Task 10: Route/rendering regression test (replaces `apps/web/test/render_smoke.tsx`)

**Files:**
- Create: `apps/web/test/route_smoke.ts`
- Delete: `apps/web/test/render_smoke.tsx`

**Interfaces:**
- Consumes: `loadAdminVM`/`loadClientVM` (Task 4), a running `next dev` server (started by the script itself).
- Produces: the acceptance-bar test for P0 acceptance criterion 8, run via `npm run test --workspace=apps/web` and CI.

- [ ] **Step 1: Write `apps/web/test/route_smoke.ts`**

```ts
/**
 * Route/rendering regression test for the Next.js migration (Package
 * P0). Starts a real `next dev` server and fetches every route
 * reachable today, asserting the same content the old esbuild-era
 * test/render_smoke.tsx asserted on via direct component rendering.
 * Run with `npx tsx test/route_smoke.ts`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAdminVM, loadClientVM } from "../src/data/loadViewModels";
import { formatCents } from "../../../packages/01-financial-engine/src/money";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, "..");
const PORT = Number(process.env.ROUTE_SMOKE_PORT) || 4310;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function isLabeledAsPreview(html: string): boolean {
  return html.includes("Preview only") || html.includes("Preview content");
}

function buttonTagFor(html: string, textFragment: string): string | null {
  const idx = html.indexOf(textFragment);
  if (idx === -1) return null;
  const openTagStart = html.lastIndexOf("<button", idx);
  const openTagEnd = html.indexOf(">", openTagStart);
  if (openTagStart === -1 || openTagEnd === -1) return null;
  return html.slice(openTagStart, openTagEnd + 1);
}

function startServer(): ChildProcess {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawn(cmd, ["next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/admin/overview`);
      if (res.status === 200) return;
    } catch {
      // server not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Next.js dev server did not become ready within ${timeoutMs}ms`);
}

async function getHtml(urlPath: string): Promise<{ status: number; html: string; location: string | null }> {
  const res = await fetch(`${BASE_URL}${urlPath}`, { redirect: "manual" });
  const html = await res.text();
  return { status: res.status, html, location: res.headers.get("location") };
}

async function main() {
  const server = startServer();
  server.stdout?.on("data", (d) => process.stdout.write(`[next dev] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[next dev] ${d}`));

  try {
    await waitForServer(60_000);

    const adminVM = await loadAdminVM();
    const clientVM = await loadClientVM();

    console.log("--- Root redirects to /admin/overview ---");
    const root = await getHtml("/");
    check("root path redirects", root.status === 307 || root.status === 308);
    check("root redirects to /admin/overview", (root.location ?? "").endsWith("/admin/overview"));

    console.log("\n--- Every admin route responds 200, correctly labeled ---");
    const adminPreviewRoutes = ["/admin/action-center", "/admin/conversations", "/admin/contacts", "/admin/settings"];
    for (const route of adminPreviewRoutes) {
      const { status, html } = await getHtml(route);
      check(`${route} responds 200`, status === 200);
      check(`${route} is labeled as preview content`, isLabeledAsPreview(html));
    }

    const overview = await getHtml("/admin/overview");
    check("/admin/overview responds 200", overview.status === 200);
    check("/admin/overview shows the project name", overview.html.includes("Hawks Ridge"));

    const projects = await getHtml("/admin/projects");
    check("/admin/projects responds 200", projects.status === 200);
    check("/admin/projects renders the project workspace tabs", projects.html.includes(">Financials<"));

    console.log("\n--- Financials figure comes from the real engine, not a hardcoded value ---");
    const financials = await getHtml("/admin/financials");
    check("/admin/financials responds 200", financials.status === 200);
    check(
      "admin Financials shows the engine's actual revised-estimate figure",
      financials.html.includes(formatCents(adminVM.totals.revisedEstimateCents))
    );
    check("admin Financials is NOT labeled preview (real engine data)", !isLabeledAsPreview(financials.html));

    console.log("\n--- Every client route responds 200, correctly labeled ---");
    const clientPreviewRoutes = ["/client/schedule", "/client/selections", "/client/messages", "/client/updates", "/client/documents"];
    for (const route of clientPreviewRoutes) {
      const { status, html } = await getHtml(route);
      check(`${route} responds 200`, status === 200);
      check(`${route} is labeled as preview content`, isLabeledAsPreview(html));
    }

    const home = await getHtml("/client/home");
    check("/client/home responds 200", home.status === 200);
    check("/client/home shows a welcome heading", home.html.includes("Welcome"));

    const budget = await getHtml("/client/budget");
    check("/client/budget responds 200", budget.status === 200);
    check(
      "client Budget shows the client-safe view model's actual revised-estimate figure",
      budget.html.includes(formatCents(clientVM.totals.revisedEstimateCents))
    );
    check(
      "client Budget screen does NOT show the admin-only fee-accrued figure",
      !budget.html.includes(formatCents(adminVM.feeSummary.feeAccruedCents))
    );
    check("client Budget is NOT labeled preview (real engine data)", !isLabeledAsPreview(budget.html));

    console.log("\n--- Dead-click controls are disabled, not silently clickable no-ops ---");
    const selections = await getHtml("/client/selections");
    const approveTag = buttonTagFor(selections.html, "Review &amp; Approve");
    check("Selections 'Review & Approve' button exists and is disabled", !!approveTag && approveTag.includes("disabled"));

    const documents = await getHtml("/client/documents");
    const downloadTag = buttonTagFor(documents.html, "Download");
    check("Documents 'Download' button exists and is disabled", !!downloadTag && downloadTag.includes("disabled"));

    console.log("\n--- Preview-as-client banner appears only with ?preview=1 ---");
    check("normal client Budget view has no preview banner", !budget.html.includes("Client preview"));
    const previewBudget = await getHtml("/client/budget?preview=1");
    check("preview view responds 200", previewBudget.status === 200);
    check("preview view shows the Client preview banner", previewBudget.html.includes("Client preview"));
    check("preview view shows an Exit preview control", previewBudget.html.includes("Exit preview"));
    check(
      "preview view does not overclaim ('reflects real client visibility rules' is NOT the banner text)",
      !previewBudget.html.includes("reflects real client visibility rules")
    );

    console.log(`\nroute_smoke.ts: all ${checks} checks passed.`);
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Delete the old direct-render test it replaces**

```bash
git rm apps/web/test/render_smoke.tsx
```

- [ ] **Step 3: Run the new test and confirm every check passes**

```bash
cd apps/web
npx tsx test/route_smoke.ts
```

Expected: every `ok — ...` line prints, ending with `route_smoke.ts: all N checks passed.` and exit code 0. If any check fails, fix the underlying route/component (do not weaken the assertion) before proceeding.

- [ ] **Step 4: Commit**

```bash
git add apps/web/test/route_smoke.ts
git commit -m "P0: replace render_smoke.tsx with a real route/rendering regression test"
```

---

## Task 11: `vercel.json` and CI workflow updates

**Files:**
- Modify: `vercel.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/check-fixture-boundaries.mjs` (Task 9).
- Produces: nothing consumed by later tasks — this is the deployment/CI-facing deliverable for P0 acceptance criteria on CI requirements and deployment configuration.

- [ ] **Step 1: Rewrite `vercel.json` for the Next.js build**

```json
{
  "framework": "nextjs",
  "installCommand": "npm ci",
  "buildCommand": "npm run build --workspace=apps/web",
  "outputDirectory": "apps/web/.next"
}
```

- [ ] **Step 2: Add the two new CI steps to `.github/workflows/ci.yml`**

Insert these two steps between the existing `Test` and `Build` steps:

```yaml
      - name: Verify no real .env files are tracked
        run: |
          if git ls-files | grep -E '^\.env(\..+)?$' | grep -vx '\.env\.example'; then
            echo "A real .env file is tracked in git! Remove it before merging." >&2
            exit 1
          fi

      - name: Check fixture-data import boundary
        run: node scripts/check-fixture-boundaries.mjs
```

The full file should read:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install (npm ci)
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm run test

      - name: Verify no real .env files are tracked
        run: |
          if git ls-files | grep -E '^\.env(\..+)?$' | grep -vx '\.env\.example'; then
            echo "A real .env file is tracked in git! Remove it before merging." >&2
            exit 1
          fi

      - name: Check fixture-data import boundary
        run: node scripts/check-fixture-boundaries.mjs

      - name: Build
        run: npm run build
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json .github/workflows/ci.yml
git commit -m "P0: update vercel.json and CI for the Next.js build"
```

---

## Task 12: Full verification pass and doc correction

**Files:**
- Modify: `CLAUDE.md` (one line)

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: the final, verified state of the P0 package.

- [ ] **Step 1: Fix the now-stale build-output path in `CLAUDE.md`**

In the `## Commands` section, change the exact line (6 spaces before the `#`):
```
npm run build      # production build of apps/web -> apps/web/dist/
```
to:
```
npm run build      # production build of apps/web -> apps/web/.next/
```

- [ ] **Step 2: Run the full verification suite from the repo root**

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

Expected: all four commands exit 0. Read the actual output of each — do not infer success from the diff alone (per `superpowers:verification-before-completion`).

- [ ] **Step 3: Manually run the dev server once and click through the golden path in a browser**

```bash
npm run dev
```

Open `http://127.0.0.1:5173` and confirm: it redirects to Overview; the sidebar/bottom-nav routes to every admin screen; "Preview as Client" shows the banner and Exit works; clicking "Client" in DemoControls shows the real client nav; the Selections "Review & Approve" and Documents "Download" buttons are visibly disabled (not clickable). Stop the server (Ctrl+C) when done.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "P0: fix build-output path in CLAUDE.md, final verification pass"
```

- [ ] **Step 5: Request code review**

Use the `superpowers:requesting-code-review` skill before opening a PR, per the P0 handoff document's specified workflow.
