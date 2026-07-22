# Target Architecture

Defines the production architecture for the Stone Column Portal. This
is a destination description, not a work order — implementation is
sequenced in `PRODUCTION-ROADMAP.md`. Following review of the first
version of this document, the application-server-framework question
(§5) and the staff-permission-enforcement question
(`SECURITY-AND-PERMISSIONS-MATRIX.md`'s role-model gap) are now
**settled direction, not open decisions** — corrected below. What
remains genuinely open (Supabase plan/backup tier, monitoring
provider, e-signature provider, payment provider, invitation/
onboarding policy) is flagged inline where it comes up, and
consolidated in the PR description's executive summary.

## 1. Environments

Three environments, each a genuinely separate Supabase project and a
genuinely separate set of secrets — never the same project reused
with a "dev flag":

| Environment | Supabase project | Hosting | Purpose |
|---|---|---|---|
| **Local** | Supabase CLI local stack (`supabase start`, Dockerized Postgres) | Next.js dev server (adopted in P0 — see §5.1) | Schema iteration, migration authoring, day-to-day development. Disposable — reset freely. |
| **Preview/staging** | One shared Supabase project, OR one ephemeral project per PR if Supabase branching is available on the plan in use (owner decision — cost-dependent) | Vercel preview deployments (automatic per-PR, already how `vercel.json` is set up) | Reviewer verification before merge; the only place synthetic-but-realistic data should ever be seeded by hand. |
| **Production** | Dedicated Supabase project, never touched by CI except through reviewed migrations | Vercel production deployment | Real company/project/financial data. No sample/fixture data ever seeded here — see `DATA-MIGRATION-AND-FIXTURES.md`. |

Local and preview both run the exact same migration files as
production, applied through the exact same tool (`supabase db push` or
equivalent) — there is no "local-only" schema drift.

## 2. Authentication and session handling

**Supabase Auth**, per instruction, absent a documented reason not to
— and I found none: the schema is already built around
`auth.users`/`auth.uid()` (`profiles.id references auth.users(id)`,
every RLS policy and helper function calls `auth.uid()`), so Supabase
Auth is not an added dependency, it's the dependency the existing
schema was written for.

- Email/password + magic-link sign-in at minimum; SSO deferred (no
  current requirement for it).
- Session token handled entirely by `@supabase/supabase-js` on the
  client (Supabase's standard pattern — the anon key and Supabase URL
  are meant to be public; RLS is the real security boundary, not
  keeping the anon key secret).
- `bootstrap_organization()` (already written, unexecuted) is the
  sanctioned first-admin path. Production must gate it behind an
  invite code or manual approval before general signup is opened — the
  SQL file's own comment already flags this as a product decision
  outside the schema's scope; **P2 must decide and implement the
  gate**, not ship the function reachable by any signup.

## 3. Company, project, and role-based authorization

Existing schema pattern (org-scoped staff/admin via
`is_org_staff_for_org()`, project-scoped client via
`is_project_client()`) is sound and carries forward unchanged. Two
additions required, neither of which exists in the schema today:

- **`is_project_vendor(project_id)`** helper — the "vendor identity/
  RLS foundation" the old roadmap described as already built in
  Package 3 is **not actually in the schema** (see
  `PRODUCTION-READINESS-AUDIT.md`, Modules 12–13). P3 writes this
  helper and exactly one policy consuming it: a vendor can read their
  own `project_members` row, nothing else. **P3 does not add vendor
  policies to `expenses`, `budget_ledger`, `committed_costs`, or any
  other existing financial table** — those stay staff/client-only
  exactly as designed today. Each later package that genuinely needs
  vendor visibility into a specific table (P5's `bid_packages`/
  `bid_submissions`, P8's vendor-assigned selections, P9's
  vendor-relevant schedule dates, P11's full vendor portal surface)
  adds its own narrowly scoped vendor policy to that table, in that
  table's own migration — extending the P3 identity boundary, never
  introducing a new one, but also never granted more broadly than the
  specific table that package owns. Full detail and per-package
  attribution: `PRODUCTION-ROADMAP.md`, "Recommended change to the
  given package order" and the P3/P5 entries.
- **Authorized client decision-maker** concept — a new table (working
  name `project_decision_makers`: `project_id`, `contact_id`/`user_id`,
  `is_authorized`, `authority_scope` or similar) implementing the
  preserved Client Approval Rule:
  - A project may have multiple client contacts.
  - Authorized decision-makers are explicitly designated (not
    inferred from "is a client member").
  - Approval requirements are configurable per project and per record
    type (a separate `approval_requirements` concept, likely
    record-type-keyed, consumed by whichever package owns that record
    type — Change Orders, Selections, etc.).
  - Every approval record captures signer, authority, date, version,
    and the specific document/record approved.
  - A missing required signer or a disagreement between designated
    decision-makers produces a blocked/disputed state — **never**
    auto-resolved.
  - This lives in **P2** (per this task's own package scope), consumed
    by **P7**/**P8** when those record types exist.

`investor`/`lender` roles are a P12-scoped enum extension, not needed
before then.

## 4. PostgreSQL schema and row-level security

Carries forward `schema/001_core_financial.sql` through `005_*.sql`
essentially as-is — the design (append-only ledgers, supersede-not-edit
for commitments/forecasts, integer-cents/basis-points, `to
authenticated`-scoped policies, `security_invoker` client views,
SECURITY DEFINER helpers with explicit `search_path`) is exactly the
pattern a production system should use, and rewriting it would be pure
risk with no benefit. **The gap is execution, not design** — see P1.

Every new table added from P2 onward must follow the same conventions
already established:
- `project_id` (or transitively-scoped) column for RLS.
- RLS enabled + explicit `to authenticated` policies from the first
  migration that creates the table — never "add RLS later."
- A `log_audit()` trigger attached at creation time for any table
  holding an operational or financial record.
- Append-only / supersede patterns for anything financial; no
  destructive `UPDATE`/`DELETE` of posted financial fact.

## 5. Server-side mutation boundary and Supabase access patterns

**This repository currently has no server runtime.** `apps/web` is a
static SPA (esbuild bundle, no API routes, no edge functions). Every
mutation path envisioned for production needs *some* trusted execution
context that isn't the browser.

### 5.1 Application server framework — Next.js, adopted in P0

**Settled direction, corrected from the previous version of this
document:** adopt Next.js **during P0**, before P2's authentication
and any production workflow is built on top of the current esbuild
SPA. The previous draft framed this as an open "Option A vs. Option
B" owner decision deferrable to P4 — that framing is withdrawn. The
project should not deliberately defer the application server framework
and then incur a mid-production-build migration once real screens,
real auth, and real RLS-dependent UI already depend on the current
static-bundle setup. Next.js is also already the documented eventual
target (`docs/PACKAGE_02_NOTES.md`: "real component source... intended
to drop into a Next.js app later") — P0 is executing existing intent,
not introducing a new one.

This does **not** remove Postgres RPCs from the architecture. RPCs
(`SECURITY DEFINER` functions, the `bootstrap_organization()`/
`supersede_committed_cost()`/`supersede_forecast()` pattern already
established) remain the right mechanism for atomic, RLS-adjacent
database operations — a Next.js Route Handler calling an RPC is
normal and expected. What Next.js adds is the trusted execution
context Postgres functions cannot provide at all: QuickBooks file
parsing, e-signature webhooks, ACH/card webhooks, Microsoft Graph
calls, and — starting immediately — a real client/server component
boundary so the Supabase **service-role** key has a legitimate place
to live outside the browser bundle from day one, rather than being
deferred alongside the framework migration.

P0's revised scope (see `PRODUCTION-ROADMAP.md`) includes: migrating
the existing UI into Next.js **without a broad redesign** — the
approved visual language, navigation, financial logic, and
construction terminology carry forward unchanged, this is a hosting/
framework migration, not a product redesign; establishing the server/
client component boundary; updating `vercel.json`/deployment
configuration for a Next.js build; and route/rendering regression
tests proving every existing screen renders identically post-migration
(reusing the existing `render_smoke.tsx` assertions as the baseline
those regression tests must still satisfy).

### 5.2 Supabase access patterns — JWT vs. service-role, explicit rules

- **Ordinary user-originated server operations** (a logged-in user
  viewing their project's budget, submitting a selection preference,
  inviting a teammate) use that **user's own JWT**, forwarded to
  Supabase, and remain fully subject to RLS — a Route Handler acting
  on a user's behalf authenticates *as that user*, it does not
  silently escalate to a privileged client. This is the default and
  the common case for every package from P2 onward.
- **The Supabase service-role key is never the default database
  client for application routes.** It bypasses RLS entirely (per
  `schema/001_core_financial.sql`'s own comment: "these triggers fire
  for ANY role, including a service_role key that bypasses RLS
  entirely — RLS controls row visibility, not mutation rights") —
  using it as a general-purpose backend client would silently discard
  every RLS guarantee this schema was built around.
- **Service-role access is restricted to a narrow, enumerated set of
  cases:** verified external webhooks (e-signature, payment provider)
  where there is no end-user session to act as; background/scheduled
  jobs (compliance-expiration sweeps, calendar sync); environment
  provisioning (`bootstrap_organization()`'s own gated first-admin
  path); and privileged administrative operations that are explicitly
  designed to cross RLS boundaries (e.g., an Owner/Admin-only
  cross-project export). Nothing else.
- **Every service-role operation requires, without exception:**
  explicit authorization checked in code before the privileged action
  runs (never assumed from the caller's mere ability to reach the
  route), input validation as strict as any RLS-protected path would
  apply, least privilege (a service-role operation touches only the
  rows/tables its specific job requires, not a broad query), and audit
  logging — a service-role mutation is exactly the kind of action
  `log_audit()`'s trigger-based, un-bypassable logging exists to
  catch, and no service-role code path should be written in a way that
  could evade it (e.g., raw `COPY`/bulk operations that skip
  row-level triggers must be treated as a reviewed exception, not a
  convenience default).

## 6. Financial calculation ownership — explicit statement

Per instruction, stating plainly which calculations must run or be
verified server-side rather than trusting a browser-submitted value:

- **Never trust from the browser, ever, for persistence:** any
  `amount_cents` on a write to `expenses`, `budget_ledger`,
  `committed_costs`, `forecast_entries`, `fee_ledger`, and every future
  equivalent (`invoices`, `payments`, `change_orders`,
  `selections`). A client may *propose* a number in a form; the
  server-side function that inserts the row is what decides the
  authoritative value, re-deriving or re-validating it, never simply
  persisting whatever the request body says.
- **Must be independently re-computed server-side, never client-only:**
  category rollups (`computeCategoryFinancials`/`computeProjectTotals`
  today), fee accrual (`computeFeeAccrual`), and reconciliation
  (`reconcileProject`). The engine in `packages/01-financial-engine` is
  reusable **logic** — it should run again server-side (same pure
  functions, executed in a trusted context, e.g. a Postgres function
  written in the same spirit, or a Next.js API route importing the
  same package) as the number that's actually persisted/reported/
  invoiced. The browser's copy of the same computation is a
  presentation optimization, never the source of truth.
- **`getIndependentPostedActualCostCents`'s entire contract** — a
  genuinely separate SQL aggregate, not a call into the same rollup
  path — must be implemented as real SQL the day
  `SupabaseFinancialRepository` stops being a stub. This is not new
  guidance; it's enforcing a contract the codebase already wrote for
  itself and never fulfilled.
- **Approval authority** (who is allowed to approve a change order,
  selection, or draw) is never a client-submitted boolean — it's
  resolved server-side against `project_decision_makers` (§3) at the
  moment of approval, not cached client-side from an earlier page load.

## 7. Audit-event generation

Extend the existing `log_audit()` trigger pattern to every new
mutable table from P2 onward, with no exceptions for "this one's not
that sensitive" — `projects`/`project_members`/`project_fee_rules`
need this trigger attached in P3 (currently missing even though the
tables themselves exist). Audit rows are read via
`audit_log_staff_select` (already correctly scoped, unexecuted); no
production screen should need a *new* audit mechanism, only a UI that
queries the existing table once it's populated.

## 8. File metadata vs. durable file storage

Per instruction, OneDrive/SharePoint is the durable store once that
integration is implemented — Postgres holds metadata only. The schema
already has the right shape precedent on `expenses`
(`onedrive_item_id`, `onedrive_last_synced_at`); every future
`documents` table (Module 10) and any other file-bearing table should
follow the identical two-column pattern: an external item ID + a last-
synced timestamp, never a file payload or a raw byte blob in Postgres.

## 9. Integration boundaries

All of the following are **server-side only** integrations — credentials
never reach the browser bundle, and none are replaced with an
improvised custom implementation per instruction:

| Integration | Boundary |
|---|---|
| QuickBooks Desktop | File-based import (no live API from Desktop) — user exports a report, server-side parser reads it, no QuickBooks credentials involved at all. |
| OneDrive/SharePoint | Microsoft Graph API, server-side, when Module 10 is implemented. |
| E-signature provider | Server-side integration (provider TBD, chosen at P7 implementation time) — client never talks to the provider's API directly for anything that creates a legal signature. |
| ACH/card provider | Server-side integration (provider TBD, chosen at P6b implementation time) — webhooks verified server-side; client never receives or reports a "payment complete" state from its own fetch response alone. |
| Email/calendar | Microsoft Graph / Google Calendar, server-side, designated packages (P9 calendar sync, P10 email capture). |

## 10. Secrets and environment-variable handling

Currently: **zero** environment configuration exists in this
repository (confirmed by search — no `.env*` file anywhere). P0
establishes the pattern:

- `.env.example` (committed, no real values) documenting every
  variable name and which environment needs it.
- Public/client-safe values (Supabase URL, Supabase anon key) are
  genuinely public by Supabase's own design — RLS is the boundary, not
  secrecy of these two values.
- Everything else (Supabase **service role** key, e-signature API key,
  payment provider secret key, Microsoft Graph client secret) is
  server-side-only — never referenced in any file that ends up in the
  browser bundle, enforced by which runtime context can read it
  (Vercel server/edge environment variables, not `NEXT_PUBLIC_*`/
  client-exposed equivalents).
- Real secrets live in Vercel's/Supabase's own environment-variable
  stores per environment, never in the git repository, at any commit.

## 11. Logging, monitoring, and error reporting

None exists today. Minimum baseline for P0, using what's already
included at no extra cost before any paid add-on is decided:
- Vercel's built-in deployment/function logs and analytics.
- Supabase's built-in Postgres logs and dashboard.
- React error boundaries in the app shell (do not exist today — every
  screen currently assumes its data resolves; a thrown promise/render
  error has no fallback UI) so a single screen's failure doesn't blank
  the entire app.
- A dedicated error-reporting service (e.g. Sentry or equivalent) is
  recommended but **not assumed** — it has a cost/plan implication and
  is called out as an item worth an explicit decision rather than
  silently adopted.

## 12. Backup, recovery, export, and retention

Supabase's managed Postgres backups (frequency/retention depend on the
plan tier chosen — another cost-linked decision, not assumed here) are
the production database backup mechanism. Locally and in preview, the
recovery mechanism is deterministic: re-run `schema/*.sql` migrations
in order against a fresh instance — this is already how the repo is
structured (numbered forward migrations + matching `_down.sql`
rollbacks) and needs no new tooling, only the actual execution and
validation that P1 performs for the first time. Data export/retention
policy (Module 35) remains a P3-baseline/P14-full item per the existing
roadmap — unchanged by this transition.

## 13. Deployment and rollback strategy

- **App deploys:** Vercel. The existing `vercel.json`
  (`installCommand: npm install`, `buildCommand: npm run build`,
  `outputDirectory: apps/web/dist`) is updated in P0 for the Next.js
  build output as part of the §5.1 migration, not carried forward
  unchanged. Rollback = redeploy the previous Vercel deployment
  (instant, already Vercel's default behavior, unaffected by the
  framework migration).
- **Database migrations:** forward-only in production, matching the
  standing instruction already present in this repo's own SQL file
  headers ("Supabase/most teams treat migrations as forward-only in
  production — you don't roll back a shipped migration, you write a
  new one"). The `_down.sql` files that already exist are for
  local/CI reapply-cycle testing (`up → down → up`), **not** for
  reverting a migration that has already run against real data — doing
  that safely (if ever truly necessary) requires a hand-reviewed
  data-preserving script, not a mechanical `down.sql` run. This matches
  the instruction: never rewrite migration history that may already
  have been applied; fix forward with a new migration instead.
