# P4 — Estimating & Budgeting UI + QuickBooks Desktop Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the existing `budget_ledger`/`cost_codes`/`expenses`/`import_batches`/`import_rows` schema for real writes for the first time — real budget entry/editing UI, and a QuickBooks Desktop CSV import wizard with mapping profiles, duplicate detection, and a pending-review gate — without creating any new, disconnected financial table.

**Architecture:** Every new write goes through the *existing* `(cost_code_id, project_id)` composite-FK spine. Mutations are Next.js Server Actions using the caller's own RLS-scoped Supabase client (never service-role); the one place needing cross-row atomicity (confirming an import batch) is a `security invoker` Postgres RPC. File parsing is a pure, unit-testable TypeScript module called from a server Route Handler — never parsed in the browser.

**Tech Stack:** Next.js 14 App Router (Server Actions + Route Handlers), Supabase Postgres/RLS, `packages/01-financial-engine` (pure TS), `csv-parse` (new dependency, CSV parsing).

**Design record (read first, authoritative for every "why"):** `docs/production-build/P4-DESIGN.md`.

**Amendment (2026-08-06, before any task was executed):** per
`TARGET-ARCHITECTURE.md` §14 / `docs/production-build/AI-ASSISTANT-ARCHITECTURE.md`,
every mutation this plan builds is now split into a plain service
function (validation + the actual write) plus a thin Server Action
adapter, instead of the logic living directly in the Server Action.
This affects Tasks 4, 5, 7, and 10 below — each now creates its
function in `packages/02-app-shell/src/services/` (a new directory)
first, then a thin Server Action in `apps/web/app/...` that imports and
calls it. The function bodies/signatures described in those tasks are
otherwise unchanged; only the file they live in and the one-line
Server Action wrapper are new relative to the original draft of this
plan.

## Global Constraints

- Money is always an integer number of cents. Never a float. (CLAUDE.md)
- No screen computes its own financial numbers — everything goes through `packages/01-financial-engine`. (CLAUDE.md)
- Nothing is silently overwritten, merged, or recalculated. Corrections are new ledger rows with a reason, not edits. (CLAUDE.md)
- Never edit `schema/001`–`012` in place. All P4 schema changes are additive, in a new `schema/013_*.sql` (+ down) file only.
- Every mutation runs through the caller's own JWT-bearing Supabase client (RLS-scoped) via a Server Action — never a client-side browser call to Supabase, never the service-role client. (TARGET-ARCHITECTURE.md §5.2)
- Business logic (validation + the write) lives in a plain service function under `packages/02-app-shell/src/services/`; the Server Action that calls it is a thin adapter only — parse input, call the service function, shape the result. (TARGET-ARCHITECTURE.md §14, AI-ASSISTANT-ARCHITECTURE.md)
- `npm run typecheck` / `npm run test` / `npm run build` must pass after every task.
- Do not begin P5 or P6 work of any kind.

---

### Task 1: Migration 013 — schema

**Files:**
- Create: `schema/013_estimating_and_qb_import.sql`
- Create: `schema/013_estimating_and_qb_import_down.sql`

**Interfaces:**
- Produces: table `import_mapping_profiles` (columns per below); `import_batches.mapping_profile_id` column; trigger `enforce_single_original_budget_entry` on `budget_ledger`; constraint `budget_ledger_correction_requires_note`; trigger function `log_audit_via_batch()`; triggers `audit_import_batches`, `audit_import_rows`, `audit_import_mapping_profiles`.

- [ ] **Step 1: Write `schema/013_estimating_and_qb_import.sql`**

```sql
-- =====================================================================
-- Stone Column Portal — Migration 013: estimating & QuickBooks import.
-- See docs/production-build/P4-DESIGN.md for full rationale.
-- =====================================================================

create table import_mapping_profiles (
  id                        uuid primary key default uuid_generate_v4(),
  org_id                    uuid not null references orgs(id),
  name                      text not null,
  column_mapping            jsonb not null,
  cost_code_match_strategy  text not null default 'prefix',
  cost_code_prefix_length   integer,
  item_overrides            jsonb not null default '{}'::jsonb,
  is_archived               boolean not null default false,
  created_by                uuid references profiles(id),
  created_at                timestamptz not null default now(),
  constraint import_mapping_profiles_strategy_valid
    check (cost_code_match_strategy in ('prefix', 'exact', 'manual_only')),
  constraint import_mapping_profiles_prefix_length_required
    check (cost_code_match_strategy <> 'prefix' or cost_code_prefix_length is not null),
  unique (org_id, name)
);

alter table import_batches
  add column mapping_profile_id uuid references import_mapping_profiles(id);

alter table budget_ledger
  add constraint budget_ledger_correction_requires_note
    check (entry_type <> 'correction' or note is not null);

create or replace function public.enforce_single_original_budget_entry() returns trigger
language plpgsql
as $$
begin
  if new.entry_type = 'original' and exists (
    select 1 from public.budget_ledger
    where cost_code_id = new.cost_code_id and entry_type = 'original'
  ) then
    raise exception 'Cost code % already has an original budget entry — use an adjustment (correction) instead.', new.cost_code_id;
  end if;
  return new;
end;
$$;

create trigger enforce_single_original_budget_entry
  before insert on budget_ledger
  for each row execute function public.enforce_single_original_budget_entry();

alter table import_mapping_profiles enable row level security;

create policy import_mapping_profiles_staff_only on import_mapping_profiles
  for all to authenticated
  using (is_org_staff_for_org(org_id))
  with check (is_org_staff_for_org(org_id));

-- Resolves project_id through import_batches for tables (like
-- import_rows) that don't carry project_id directly, mirroring
-- log_audit_no_project()/log_audit_self_scoped() from schema/006.
create or replace function public.log_audit_via_batch() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_row_id uuid := coalesce(new.id, old.id);
begin
  select project_id into v_project_id from public.import_batches
  where id = coalesce(new.batch_id, old.batch_id);

  insert into public.audit_log (project_id, table_name, row_id, action, actor_id, before_data, after_data)
  values (
    v_project_id,
    tg_table_name,
    v_row_id,
    tg_op,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_import_batches after insert or update on import_batches
  for each row execute function public.log_audit();

create trigger audit_import_rows after insert or update on import_rows
  for each row execute function public.log_audit_via_batch();

create trigger audit_import_mapping_profiles after insert or update on import_mapping_profiles
  for each row execute function public.log_audit_no_project();
```

Before writing this file for real: read `schema/006_audit_triggers_orgs_profiles_projects.sql` in full to confirm the exact column list/signature of `audit_log` and the exact bodies of `log_audit_no_project()`/`log_audit_self_scoped()` — copy their real structure into `log_audit_via_batch()` above rather than guessing the `audit_log` insert's column list.

- [ ] **Step 2: Write `schema/013_estimating_and_qb_import_down.sql`**

Drop everything Step 1 created, in reverse dependency order: triggers first, then the trigger functions, then the RLS policy, then `alter table ... drop constraint`, then `alter table import_batches drop column mapping_profile_id`, then `drop table import_mapping_profiles`. Match the exact reverse-order style already used by `schema/012_financial_master_data_down.sql`.

- [ ] **Step 3: Regenerate the `supabase/migrations/` mirror**

Run the loop documented in `docs/production-build/ENVIRONMENTS-RUNBOOK.md` (adds `20260113000000_estimating_and_qb_import.sql`).

- [ ] **Step 4: Commit**

```bash
git add schema/013_estimating_and_qb_import.sql schema/013_estimating_and_qb_import_down.sql supabase/migrations/20260113000000_estimating_and_qb_import.sql
git commit -m "P4: migration 013 — import_mapping_profiles, budget_ledger guards, import audit triggers"
```

---

### Task 2: SQL tests for migration 013

**Files:**
- Create: `tests/sql/package_p4_estimating_qb_import_tests.sql`
- Modify: `scripts/db/run-sql-tests.mjs` (add `013_estimating_and_qb_import.sql` and the new test file to the `FILES` array, in order, after `012` and after `package_p2_1_financial_master_data_tests.sql`)

**Interfaces:**
- Consumes: `set_test_user(uuid)`, `clear_test_user()`, `assert_that(condition, message)`, `assert_raises(sql, message)`, `test_fixture_ids` table, `org_b_admin` fixture — all from `tests/sql/package1_tests.sql` and `tests/sql/package_p1_auth_tests.sql`.

- [ ] **Step 1: Write the test file**, following `tests/sql/package_p2_1_financial_master_data_tests.sql`'s exact header/section style. Required sections and their real assertions:

```sql
-- SECTION 1: import_mapping_profiles RLS + cross-org isolation
select set_test_user((select value from test_fixture_ids where key = 'org_a_admin'));
insert into import_mapping_profiles (org_id, name, column_mapping)
values ((select value from test_fixture_ids where key = 'org_a'), 'QB Standard',
        '{"item":"Item","vendor":"Name","amount":"Amount","date":"Date","memo":"Memo"}'::jsonb);
select assert_that(
  (select count(*) from import_mapping_profiles where name = 'QB Standard') = 1,
  'org A admin can create a mapping profile'
);
select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
select assert_that(
  (select count(*) from import_mapping_profiles where name = 'QB Standard') = 0,
  'org B admin cannot see org A''s mapping profile'
);

-- SECTION 2: single-original-per-cost-code guard
select set_test_user((select value from test_fixture_ids where key = 'org_a_admin'));
insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents)
values ((select value from test_fixture_ids where key = 'project_a'),
        (select value from test_fixture_ids where key = 'cost_code_a'), 'original', 500000);
select assert_raises(
  format('insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents) values (%L, %L, ''original'', 100)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')),
  'a second original entry for the same cost code is rejected'
);

-- SECTION 3: correction-requires-note
select assert_raises(
  format('insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, note) values (%L, %L, ''correction'', 5000, null)',
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')),
  'a correction entry without a note is rejected'
);
insert into budget_ledger (project_id, cost_code_id, entry_type, amount_cents, note)
values ((select value from test_fixture_ids where key = 'project_a'),
        (select value from test_fixture_ids where key = 'cost_code_a'), 'correction', 5000, 'field measurement correction');
select assert_that(true, 'a correction entry with a note is accepted');

-- SECTION 4: confirm_import_batch() happy path + blocked path
-- (insert an import_batches row + two import_rows: one 'new', one 'unmatched';
--  assert confirm_import_batch raises because of the unmatched row;
--  mark the unmatched row 'excluded'; assert confirm_import_batch now
--  succeeds, creates exactly one pending expense for the 'new' row,
--  and sets import_batches.status = 'confirmed'.)

-- SECTION 5: audit visibility for the three new/altered tables
-- (as org A admin, confirm a real, readable audit_log row exists for
--  the import_mapping_profiles insert from SECTION 1, the import_batches
--  insert from SECTION 4, and an import_rows insert — query audit_log
--  directly, don't just assert the trigger exists.)
```

Write every assertion above with real, runnable SQL against this repo's actual fixture IDs (check `tests/sql/package1_tests.sql`'s SECTION 2 for the exact `test_fixture_ids` keys already seeded — `project_a`, `cost_code_a`, `org_a`, `org_a_admin`, `org_b_admin` — reuse them, don't re-seed).

- [ ] **Step 2: Add both new files to `scripts/db/run-sql-tests.mjs`'s `FILES` array**, in this order: `...012_financial_master_data.sql`, `013_estimating_and_qb_import.sql`, `package1_tests.sql`, `package_p1_auth_tests.sql`, `package_p2_1_financial_master_data_tests.sql`, `package_p4_estimating_qb_import_tests.sql`, `committed_forecast_hardening_tests.sql`.

- [ ] **Step 3: Run and verify**

Run: `npm run test:db`
Expected: `18 SQL files applied/passed against PGlite.` (17 existing + 1 new migration; the new test file runs as part of the same count if `run-sql-tests.mjs` counts test files separately — confirm against its actual reporting, don't just assume the number).

- [ ] **Step 4: Commit**

```bash
git add tests/sql/package_p4_estimating_qb_import_tests.sql scripts/db/run-sql-tests.mjs
git commit -m "P4: SQL tests for migration 013"
```

---

### Task 3: Extend the financial engine's `CostCode` type + repository mapping

**Files:**
- Modify: `packages/01-financial-engine/src/types.ts` (the `CostCode` interface)
- Modify: `packages/02-app-shell/src/data/supabaseFinancialRepository.ts` (`getCostCodes`)
- Modify: `packages/02-app-shell/src/data/fixtureFinancialRepository.ts` if it constructs `CostCode` objects (keep the fixture's fake data valid against the new required/optional fields)
- Test: `packages/01-financial-engine/test/edge_cases.ts` or wherever `CostCode` fixtures are built for engine tests — confirm they still typecheck

**Interfaces:**
- Produces: `CostCode` now includes `divisionId: string | null`, `activityName: string | null`, `scopeDescription: string | null`, `includeInEstimate: boolean`, `billable: boolean` (camelCase, matching every other field in this interface).

- [ ] **Step 1: Add the five fields to the `CostCode` interface** in `types.ts`, matching the exact column set confirmed in `schema/012_financial_master_data.sql` (`division_id`, `activity_name`, `scope_description`, `include_in_estimate`, `billable`).

- [ ] **Step 2: Update `getCostCodes` in `supabaseFinancialRepository.ts`** to select and map all five new columns (snake_case from Postgres → camelCase on the returned object), following the exact mapping style already used for `feeEligible`/`isArchived` in that same method.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. If any other file constructs a `CostCode` object literal (e.g. fixture data, engine tests), TypeScript will now flag it as missing the five new required fields — fix each one with real values (fixtures: `true`/`null` as sensible defaults matching the DB column defaults; do not make the new fields optional in the interface just to avoid touching fixtures).

- [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: all existing suites still pass (this task changes no financial logic, only shape).

- [ ] **Step 5: Commit**

```bash
git add packages/01-financial-engine/src/types.ts packages/02-app-shell/src/data/supabaseFinancialRepository.ts packages/02-app-shell/src/data/fixtureFinancialRepository.ts
git commit -m "P4: surface P2.1 cost-code fields (division, activity, scope, estimate/billable flags) through the engine and repository"
```

---

### Task 4: Budget entry service functions + thin Server Actions

**Files:**
- Create: `packages/02-app-shell/src/services/budgetService.ts`
- Create: `apps/web/app/admin/estimate/actions.ts`
- Test: `apps/web/test/estimate_actions_unit.ts` (new — same DI-seam style as `authorization_unit.ts`, not a live-server test)

**Interfaces:**
- Produces (`budgetService.ts`, framework-agnostic — takes the caller's already-authenticated Supabase client as a parameter, exactly like `authorization_unit.ts`'s DI-seam precedent, rather than constructing one internally, so a future AI tool-calling layer can call these with its own request's client): `enterOriginalBudget(supabase: SupabaseClient, projectId: string, costCodeId: string, amountCents: number, note?: string): Promise<{ error?: string }>`, `adjustBudget(supabase: SupabaseClient, projectId: string, costCodeId: string, deltaCents: number, reason: string): Promise<{ error?: string }>`.
- Produces (`actions.ts`, thin Server Actions with the same names and signatures minus the `supabase` parameter — they construct it via `createServerSupabaseClient()` and pass it through).

- [ ] **Step 1: Write `packages/02-app-shell/src/services/budgetService.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function enterOriginalBudget(
  supabase: SupabaseClient,
  projectId: string,
  costCodeId: string,
  amountCents: number,
  note?: string
) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return { error: "Amount must be a whole number of cents, zero or greater." };
  }
  const { error } = await supabase.from("budget_ledger").insert({
    project_id: projectId,
    cost_code_id: costCodeId,
    entry_type: "original",
    amount_cents: amountCents,
    note: note ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function adjustBudget(
  supabase: SupabaseClient,
  projectId: string,
  costCodeId: string,
  deltaCents: number,
  reason: string
) {
  if (!Number.isInteger(deltaCents) || deltaCents === 0) {
    return { error: "Adjustment must be a non-zero whole number of cents." };
  }
  if (!reason.trim()) {
    return { error: "A reason is required for every budget adjustment." };
  }
  const { error } = await supabase.from("budget_ledger").insert({
    project_id: projectId,
    cost_code_id: costCodeId,
    entry_type: "correction",
    amount_cents: deltaCents,
    note: reason,
  });
  return error ? { error: error.message } : {};
}
```

- [ ] **Step 2: Write the thin `actions.ts`**

```ts
"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { enterOriginalBudget as enterOriginalBudgetService, adjustBudget as adjustBudgetService } from "@stone-column/app-shell/services/budgetService";

export async function enterOriginalBudget(projectId: string, costCodeId: string, amountCents: number, note?: string) {
  const supabase = await createServerSupabaseClient();
  return enterOriginalBudgetService(supabase, projectId, costCodeId, amountCents, note);
}

export async function adjustBudget(projectId: string, costCodeId: string, deltaCents: number, reason: string) {
  const supabase = await createServerSupabaseClient();
  return adjustBudgetService(supabase, projectId, costCodeId, deltaCents, reason);
}
```

Confirm the exact package-import path (`@stone-column/app-shell/...` above is illustrative) against how `apps/web` already imports from `packages/02-app-shell` elsewhere (check `apps/web/app/admin/financials/page.tsx`'s existing imports) — use that same resolved path/alias, don't introduce a second import convention.

- [ ] **Step 3: Write `estimate_actions_unit.ts`** covering the input-validation branches that don't need a real database (negative amount, zero-delta adjustment, empty reason) by calling `budgetService.ts`'s functions directly with a minimal fake `SupabaseClient` stub — real assertions, following `authorization_unit.ts`'s plain `assert`/console-report style, no test framework.

- [ ] **Step 4: Run**

Run: `tsx apps/web/test/estimate_actions_unit.ts`
Expected: all checks print `ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/02-app-shell/src/services/budgetService.ts apps/web/app/admin/estimate/actions.ts apps/web/test/estimate_actions_unit.ts
git commit -m "P4: budget entry service functions + thin Server Actions (enterOriginalBudget, adjustBudget)"
```

---

### Task 5: Cost code metadata service function + thin Server Action

**Files:**
- Create: `packages/02-app-shell/src/services/costCodeService.ts`
- Create: `apps/web/app/admin/estimate/costCodeActions.ts`

**Interfaces:**
- Produces (`costCodeService.ts`, same DI-seam shape as Task 4's `budgetService.ts`): `updateCostCodeMetadata(supabase: SupabaseClient, costCodeId: string, patch: { activityName?: string; scopeDescription?: string; includeInEstimate?: boolean; billable?: boolean }): Promise<{ error?: string }>`.
- Produces (`costCodeActions.ts`, thin wrapper, same shape as Task 4's `actions.ts`): `updateCostCodeMetadata(costCodeId, patch)` — constructs the server client, delegates to the service function.

- [ ] **Step 1: Write `costCodeService.ts`** — plain RLS-gated `.update()` on `cost_codes`, mapping the camelCase patch keys to their snake_case columns (`activity_name`, `scope_description`, `include_in_estimate`, `billable`) before the update call; only include keys actually present in `patch`. Follow Task 4's exact `budgetService.ts` shape (function takes `supabase` as its first parameter, does not construct one).

- [ ] **Step 2: Write the thin `costCodeActions.ts`** — same wrapper shape as Task 4's `actions.ts`: construct `createServerSupabaseClient()`, call the service function, return its result.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/02-app-shell/src/services/costCodeService.ts apps/web/app/admin/estimate/costCodeActions.ts
git commit -m "P4: cost code metadata service function + thin Server Action"
```

---

### Task 6: `/admin/estimate` screen

**Files:**
- Create: `apps/web/app/admin/estimate/page.tsx` (Server Component — fetches cost codes + budget ledger for "the first project," same pattern as `apps/web/app/admin/financials/page.tsx`)
- Create: `packages/02-app-shell/src/components/EstimateTable.tsx` (Client Component — the mutation-capable table; deliberately separate from `BudgetTable`, per `P4-DESIGN.md`'s decision not to overload that component)
- Create: `packages/02-app-shell/src/components/EstimateTable.test-ids.ts` if the existing component-testing convention uses one (check `BudgetTable.tsx`'s neighbors for a sibling `.test-ids.ts`/similar file first — follow whatever pattern exists, don't invent a new one)

**Interfaces:**
- Consumes: `CategoryFinancials[]` (existing, from `computeAllCategoryFinancials`), `enterOriginalBudget`/`adjustBudget` (Task 4), `updateCostCodeMetadata` (Task 5).
- Produces: `EstimateTableProps { categories: CategoryFinancials[]; costCodes: CostCode[]; projectId: string }`.

- [ ] **Step 1: Read `apps/web/app/admin/financials/page.tsx` and `packages/02-app-shell/src/components/BudgetTable.tsx` in full first** — this task's page/component must match their exact Server/Client Component boundary style (data fetching only in the `page.tsx`'s async function; `"use client"` at the top of `EstimateTable.tsx`).

- [ ] **Step 2: Write `page.tsx`** — same `firstProject` query as `admin/financials/page.tsx`, then fetch `cost_codes` and `budget_ledger` for that project (via `SupabaseFinancialRepository.getCostCodes`/`getBudgetLedger`, not a raw ad hoc query — reuse the existing repository methods, don't duplicate their queries), compute `categories` via `computeAllCategoryFinancials`, pass everything to `<EstimateTable />`.

- [ ] **Step 3: Write `EstimateTable.tsx`** — one row per cost code showing `code`, `activityName`, `originalEstimateCents`/`revisedEstimateCents` (formatted via `formatCents` from the engine, never a local formatter), and:
  - If no original entry exists for that cost code (i.e., `originalEstimateCents === 0 && approvedChangesCents === 0` is not a reliable signal — pass an explicit `hasOriginalEntry: boolean` per cost code from the page instead of inferring it from zero, since a legitimate original entry of exactly 0 cents is valid): show an "Enter Original" button opening an inline amount input, calling `enterOriginalBudget`.
  - If an original entry exists: show an "Adjust" button opening an inline signed-amount + required-reason input, calling `adjustBudget`.
  - Inline-editable `activityName`/`scopeDescription` text fields and `includeInEstimate`/`billable` checkboxes, calling `updateCostCodeMetadata` on blur/change.
  - After any successful action, call `router.refresh()` (Next.js App Router's re-fetch, not local state mutation) so the displayed numbers always come from a fresh server read — never optimistically compute a new total client-side.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, sign in as a real staff user against the real hosted dev project (from the pre-P4 checkpoint), navigate to `/admin/estimate`, enter an original budget for one cost code, confirm it appears correctly on `/admin/financials`. Enter a second original for the same code, confirm the clear rejection message appears. Adjust it, confirm revised total updates on both screens.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/estimate/page.tsx packages/02-app-shell/src/components/EstimateTable.tsx
git commit -m "P4: /admin/estimate screen — real budget entry and editing"
```

---

### Task 7: Mapping profile service functions + thin Server Actions + minimal management UI

**Files:**
- Create: `packages/02-app-shell/src/services/importMappingService.ts`
- Create: `apps/web/app/admin/import/mappingActions.ts`
- Create: `packages/02-app-shell/src/components/MappingProfileForm.tsx`

**Interfaces:**
- Produces (`importMappingService.ts`, same DI-seam shape as Task 4's `budgetService.ts`): `createMappingProfile(supabase: SupabaseClient, orgId: string, input: { name: string; columnMapping: Record<string,string>; strategy: 'prefix'|'exact'|'manual_only'; prefixLength?: number }): Promise<{ error?: string; id?: string }>`, `listMappingProfiles(supabase: SupabaseClient, orgId: string): Promise<MappingProfile[]>` (add a matching `MappingProfile` type alongside these functions — not in the financial engine, since mapping profiles aren't a financial-calculation concern).
- Produces (`mappingActions.ts`, thin wrappers, same shape as Task 4's `actions.ts`).

- [ ] **Step 1: Write `importMappingService.ts`** — plain RLS-gated insert/select on `import_mapping_profiles`, validating `strategy === 'prefix' implies prefixLength is set` in code too (defense in depth on top of the DB constraint, matching this codebase's existing pattern of validating in both places, e.g. `bootstrapFirstAdmin`'s invite-code check). Follow Task 4's exact DI-seam shape.

- [ ] **Step 2: Write the thin `mappingActions.ts`** — same wrapper shape as Task 4's `actions.ts`.

- [ ] **Step 3: Write `MappingProfileForm.tsx`** — a simple form: profile name, five column-mapping text inputs (item/vendor/amount/date/memo — labeled as "which CSV column header contains the ___"), a strategy selector, prefix-length number input (shown only when strategy is `prefix`).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/02-app-shell/src/services/importMappingService.ts apps/web/app/admin/import/mappingActions.ts packages/02-app-shell/src/components/MappingProfileForm.tsx
git commit -m "P4: QuickBooks import mapping profile service functions + thin actions + form"
```

---

### Task 8: CSV parsing/matching pure module + unit tests + fixtures

**Files:**
- Create: `apps/web/src/server/imports/parseQuickBooksCsv.ts`
- Create: `apps/web/test/import_parse_unit.ts`
- Create: `tests/fixtures/quickbooks/sample_job_cost_export.csv`
- Modify: `apps/web/package.json` (add `csv-parse` dependency) or root `package.json` if that's where `apps/web`'s other runtime deps live — check first, follow whatever's already established for `@supabase/supabase-js`.

**Interfaces:**
- Produces:
  ```ts
  export interface ParsedImportRow {
    rowNumber: number;
    rawData: Record<string, string>;
    resolvedCostCodeId: string | null;
    matchStatus: "new" | "changed" | "duplicate" | "unmatched" | "error";
    errorMessage?: string;
  }
  export interface MatchContext {
    mappingProfile: { columnMapping: Record<string,string>; costCodeMatchStrategy: string; costCodePrefixLength: number | null; itemOverrides: Record<string,string> };
    projectCostCodes: { id: string; code: string }[];
    existingExpenseKeys: Set<string>; // "vendorName|transactionDate|amountCents|costCodeId"
  }
  export function parseQuickBooksCsv(fileContents: string, context: MatchContext): ParsedImportRow[];
  ```

- [ ] **Step 1: Add `csv-parse` as a dependency**

Run: `npm install csv-parse --workspace=apps/web` (confirm this is the correct workspace flag by checking how `@supabase/supabase-js` was originally added — match its exact placement).

- [ ] **Step 2: Write `parseQuickBooksCsv.ts`**

```ts
import { parse } from "csv-parse/sync";

export interface ParsedImportRow {
  rowNumber: number;
  rawData: Record<string, string>;
  resolvedCostCodeId: string | null;
  matchStatus: "new" | "changed" | "duplicate" | "unmatched" | "error";
  errorMessage?: string;
}

export interface MatchContext {
  mappingProfile: {
    columnMapping: Record<string, string>;
    costCodeMatchStrategy: string;
    costCodePrefixLength: number | null;
    itemOverrides: Record<string, string>;
  };
  projectCostCodes: { id: string; code: string }[];
  existingExpenseKeys: Set<string>;
}

function resolveCostCodeId(itemValue: string, ctx: MatchContext): string | null {
  const override = ctx.mappingProfile.itemOverrides[itemValue];
  if (override) {
    return ctx.projectCostCodes.find((c) => c.code === override)?.id ?? null;
  }
  if (ctx.mappingProfile.costCodeMatchStrategy === "exact") {
    return ctx.projectCostCodes.find((c) => c.code === itemValue.trim())?.id ?? null;
  }
  if (ctx.mappingProfile.costCodeMatchStrategy === "prefix") {
    const len = ctx.mappingProfile.costCodePrefixLength ?? 4;
    const prefix = itemValue.trim().slice(0, len);
    return ctx.projectCostCodes.find((c) => c.code === prefix)?.id ?? null;
  }
  return null; // 'manual_only' — always requires a human to assign
}

export function parseQuickBooksCsv(fileContents: string, ctx: MatchContext): ParsedImportRow[] {
  const records: Record<string, string>[] = parse(fileContents, {
    columns: true,
    skip_empty_lines: true,
  });

  const seenInFile = new Set<string>();
  const { item, vendor, amount, date } = ctx.mappingProfile.columnMapping;

  return records.map((raw, index) => {
    const rowNumber = index + 1;
    const itemValue = raw[item] ?? "";
    const vendorValue = raw[vendor] ?? "";
    const dateValue = raw[date] ?? "";
    const amountRaw = raw[amount] ?? "";
    const amountCents = Math.round(parseFloat(amountRaw.replace(/[^0-9.-]/g, "")) * 100);

    if (!Number.isFinite(amountCents) || !dateValue) {
      return {
        rowNumber,
        rawData: raw,
        resolvedCostCodeId: null,
        matchStatus: "error",
        errorMessage: `Row ${rowNumber}: could not parse amount or date.`,
      };
    }

    const resolvedCostCodeId = resolveCostCodeId(itemValue, ctx);
    const key = `${vendorValue}|${dateValue}|${amountCents}|${resolvedCostCodeId}`;

    if (ctx.existingExpenseKeys.has(key) || seenInFile.has(key)) {
      return { rowNumber, rawData: raw, resolvedCostCodeId, matchStatus: "duplicate" };
    }
    seenInFile.add(key);

    if (!resolvedCostCodeId) {
      return { rowNumber, rawData: raw, resolvedCostCodeId: null, matchStatus: "unmatched" };
    }

    return { rowNumber, rawData: raw, resolvedCostCodeId, matchStatus: "new" };
  });
}
```

- [ ] **Step 3: Create the sample fixture CSV**

```
Item,Name,Memo,Date,Amount
5010,ABC Framing LLC,Rough framing labor,2026-06-01,12500.00
5010 - Lumber,XYZ Lumber Supply,Framing lumber package,2026-06-03,8420.50
9999-SPECIAL,Unknown Vendor,Unrecognized item code,2026-06-04,300.00
5010,ABC Framing LLC,Rough framing labor,2026-06-01,12500.00
5030,Bad Row Vendor,Malformed amount,2026-06-05,not-a-number
```

(Row 1: prefix-matches `5010`. Row 2: prefix `5010 ` — tests that prefix matching trims correctly against a code with trailing text. Row 3: no plausible prefix match — `unmatched`, unless a fixture project cost code list includes `9999`, in which case rename this row's item to something with no real match, e.g. `ZZZZ`. Row 4: exact duplicate of row 1 — `duplicate`. Row 5: malformed amount — `error`.)

- [ ] **Step 4: Write `import_parse_unit.ts`**

Real assertions (`assert_that`-style, matching `authorization_unit.ts`) covering: prefix match resolves correctly, item override takes precedence over prefix match, exact-strategy match, in-file duplicate detected, duplicate-against-existing-expense detected, unmatched item produces `unmatched` not a thrown error, malformed amount produces `error` with a row number in the message, `manual_only` strategy never auto-resolves even with a plausible prefix.

- [ ] **Step 5: Run**

Run: `tsx apps/web/test/import_parse_unit.ts`
Expected: all checks print `ok`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/imports/parseQuickBooksCsv.ts apps/web/test/import_parse_unit.ts tests/fixtures/quickbooks/sample_job_cost_export.csv apps/web/package.json package-lock.json
git commit -m "P4: QuickBooks CSV parsing/matching module, unit tests, sample fixture"
```

---

### Task 9: Import parse Route Handler

**Files:**
- Create: `apps/web/app/api/imports/parse/route.ts`

**Interfaces:**
- Consumes: `parseQuickBooksCsv` (Task 8).
- Produces: `POST /api/imports/parse` — multipart form fields `file`, `projectId`, `mappingProfileId`. Returns `{ batchId: string, rowCounts: Record<ParsedImportRow["matchStatus"], number> }` or `{ error: string }`.

- [ ] **Step 1: Read `apps/web/app/api/documents/[id]/route.ts` first** — this is the one existing Route Handler in the codebase; match its exact style for extracting the authenticated Supabase client and returning `NextResponse` errors.

- [ ] **Step 2: Write `route.ts`** — parses the multipart body, loads the mapping profile and the project's cost codes (via existing RLS-scoped queries, not service role), loads existing `expenses` keys for duplicate-context (project-scoped, `financial_status <> 'void'`), calls `parseQuickBooksCsv`. For each returned `ParsedImportRow`, **do not store `row.rawData` verbatim** — its keys are whatever the source CSV's own headers were (per the mapping profile's `columnMapping`, which can point at any header name). Instead build a normalized object with fixed keys, using the mapping profile's `columnMapping` to pull each value out of `row.rawData`:
  ```ts
  const normalized = {
    Item: row.rawData[mappingProfile.columnMapping.item],
    Name: row.rawData[mappingProfile.columnMapping.vendor],
    Memo: row.rawData[mappingProfile.columnMapping.memo],
    Date: row.rawData[mappingProfile.columnMapping.date],
    Amount: row.rawData[mappingProfile.columnMapping.amount],
    __resolved_cost_code_id: row.resolvedCostCodeId,
  };
  ```
  Insert one `import_batches` row (`status: 'ready_for_review'`, `mapping_profile_id`) and one `import_rows` row per result (`raw_data: normalized`, `match_status: row.matchStatus`). **This exact five-fixed-key-plus-`__resolved_cost_code_id` shape is a hard contract with Task 10's `confirm_import_batch` RPC**, which reads `raw_data->>'Name'`/`'Date'`/`'Memo'`/`'Amount'`/`'__resolved_cost_code_id'` verbatim — those two tasks must not disagree on this shape.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, use a REST client (or a temporary curl command) to POST the sample fixture CSV from Task 8 to `/api/imports/parse` against the real hosted dev project with a real staff session cookie, confirm the returned `rowCounts` match the fixture's expected breakdown (1 `new`... wait, both row 1 and row 2 should resolve, so recompute the real expected counts from the actual fixture content once Task 8's fixture is finalized) and that `import_rows` rows exist in the database with correct `match_status` values.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/imports/parse/route.ts
git commit -m "P4: QuickBooks import parse Route Handler"
```

---

### Task 10: `confirm_import_batch` RPC + service function/thin Server Action + reconciliation check

**Files:**
- Modify: `schema/013_estimating_and_qb_import.sql` (add the RPC — this migration hasn't been applied to any real environment yet at this point in the plan if tasks are executed in order before Task 1's migration is pushed live, so amending it here is still "additive to an unshipped migration," not a rewrite of history; if Task 1 was already pushed to the real hosted dev project by the time this task runs, add the RPC in a NEW `schema/014_confirm_import_batch.sql` instead — check `supabase db query --linked "select * from supabase_migrations.schema_migrations"` first to decide which applies)
- Create: `packages/02-app-shell/src/services/importService.ts` (also destined to hold Task 11's `overrideImportRow`/`excludeImportRow` — one service file per domain, not one per screen)
- Create: `apps/web/app/admin/import/confirmActions.ts`
- Modify: `packages/01-financial-engine/src/reconciliation.ts` (add the batch-level check)

**Interfaces:**
- Produces (SQL): `confirm_import_batch(p_batch_id uuid) returns void`.
- Produces (`importService.ts`, same DI-seam shape as Task 4's `budgetService.ts`): `confirmImportBatch(supabase: SupabaseClient, batchId: string): Promise<{ error?: string }>` — thin even at the service-function level here, since the real logic lives in the RPC, not in TypeScript; the service function's whole job is calling `supabase.rpc('confirm_import_batch', { p_batch_id: batchId })` and shaping the error. It still lives in `importService.ts`, not directly in the Server Action, so it's consistent with every other mutation in this plan and equally callable by a future AI tool.
- Produces (`confirmActions.ts`, thin wrapper, same shape as Task 4's `actions.ts`).
- Produces (engine): `reconcileImportBatch(importedTotalCents: number, resultingExpensesTotalCents: number): { matches: boolean; differenceCents: number }` (pure function, engine-owned per CLAUDE.md's "no screen computes its own financial numbers").

- [ ] **Step 1: Write the RPC**

```sql
create or replace function public.confirm_import_batch(p_batch_id uuid) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_project_id uuid;
  v_unresolved_count integer;
begin
  select project_id into v_project_id from import_batches where id = p_batch_id;

  select count(*) into v_unresolved_count from import_rows
  where batch_id = p_batch_id and match_status in ('unmatched', 'error');
  if v_unresolved_count > 0 then
    raise exception 'Batch % has % unresolved row(s) — resolve or exclude them before confirming.', p_batch_id, v_unresolved_count;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and match_status in ('new', 'changed') loop
    insert into expenses (
      project_id, cost_code_id, vendor_name, transaction_date, description_internal,
      amount_cents, financial_status, source_type, import_batch_id
    ) values (
      v_project_id,
      (v_row.raw_data->>'__resolved_cost_code_id')::uuid,
      v_row.raw_data->>'Name',
      (v_row.raw_data->>'Date')::date,
      v_row.raw_data->>'Memo',
      round((v_row.raw_data->>'Amount')::numeric * 100)::bigint,
      'pending',
      'quickbooks_import',
      p_batch_id
    ) returning id into strict v_row.matched_expense_id;

    update import_rows set matched_expense_id = v_row.matched_expense_id where id = v_row.id;
  end loop;

  update import_batches set status = 'confirmed' where id = p_batch_id;
end;
$$;

revoke all on function public.confirm_import_batch(uuid) from public;
grant execute on function public.confirm_import_batch(uuid) to authenticated;
```

The `raw_data->>'Name'`/`'Date'`/`'Memo'`/`'Amount'`/`'__resolved_cost_code_id'` keys above are the fixed, normalized shape Task 9's Route Handler now writes (settled there, not a per-task choice) — this RPC is header-agnostic by construction, it never sees the source CSV's actual column names.

- [ ] **Step 2: Write `confirmImportBatch` in `importService.ts`, then a thin `confirmActions.ts` wrapper** — the service function calls the `confirm_import_batch` RPC via the `supabase` client passed to it, returning `{ error: error.message }` on failure; the Server Action constructs `createServerSupabaseClient()` and delegates, same shape as every prior task's wrapper.

- [ ] **Step 3: Write `reconcileImportBatch` in `reconciliation.ts`**

```ts
export function reconcileImportBatch(importedTotalCents: number, resultingExpensesTotalCents: number) {
  return {
    matches: importedTotalCents === resultingExpensesTotalCents,
    differenceCents: resultingExpensesTotalCents - importedTotalCents,
  };
}
```

- [ ] **Step 4: Run the SQL tests again** (this RPC is covered by Task 2's SECTION 4 — go back and confirm those assertions pass against the real RPC body now that it's written for real, not the placeholder description).

Run: `npm run test:db`
Expected: PASS, including SECTION 4/5 of `package_p4_estimating_qb_import_tests.sql`.

- [ ] **Step 5: Commit**

```bash
git add schema/013_estimating_and_qb_import.sql packages/02-app-shell/src/services/importService.ts apps/web/app/admin/import/confirmActions.ts packages/01-financial-engine/src/reconciliation.ts
git commit -m "P4: confirm_import_batch RPC, service function/thin Server Action, batch reconciliation check"
```

---

### Task 11: `/admin/import` wizard UI

**Files:**
- Create: `apps/web/app/admin/import/page.tsx`
- Create: `packages/02-app-shell/src/components/ImportWizard.tsx`

**Interfaces:**
- Consumes: `listMappingProfiles`/`createMappingProfile` (Task 7), the parse Route Handler (Task 9), `confirmImportBatch` (Task 10), `reconcileImportBatch` (Task 10).

- [ ] **Step 1: Write `page.tsx`** — Server Component, same "first project" fetch as `/admin/estimate`, loads existing mapping profiles for the org, passes to `<ImportWizard />`.

- [ ] **Step 2: Write `ImportWizard.tsx`** — three-step client component:
  1. Profile step: `<MappingProfileForm />` (Task 7) or select an existing profile.
  2. Upload step: a file input posting to `/api/imports/parse`; on response, fetch and display `import_rows` for the returned `batchId`, grouped by `matchStatus`, with a per-row cost-code override `<select>` (writing directly to `import_rows.raw_data.__resolved_cost_code_id` and flipping `match_status` to `'changed'`) and a per-row "Exclude" button (sets `match_status = 'excluded'`). Both actions follow this plan's standard split: `overrideImportRow(supabase, rowId: string, costCodeId: string): Promise<{error?:string}>` and `excludeImportRow(supabase, rowId: string): Promise<{error?:string}>` as service functions in `importService.ts` (Task 10 already reserves this file for them), each with a thin same-name wrapper added to `confirmActions.ts`.
  3. Confirm step: shows counts per `matchStatus`, disables "Confirm Import" while any `unmatched`/`error` row remains un-excluded, calls `confirmImportBatch` on click, then displays the `reconcileImportBatch` result (imported total vs. resulting expenses total) — if `!matches`, show the difference prominently, don't hide it.

- [ ] **Step 3: Manual verification**

Run `npm run dev` against the real hosted dev project. Walk the full wizard end to end with the Task 8 sample fixture: create a profile, upload the file, override the unmatched row to a real cost code, exclude nothing, confirm, verify the resulting `pending` expenses appear (query the database directly or check `/admin/estimate`'s underlying data), then post one of them (existing action) and confirm it now appears in `/admin/financials`'s `actualCostCents`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/admin/import/page.tsx packages/02-app-shell/src/components/ImportWizard.tsx apps/web/app/admin/import/confirmActions.ts
git commit -m "P4: /admin/import QuickBooks wizard — upload, review, confirm, reconciliation"
```

---

### Task 12: Full verification, live checkpoint extension, milestone closeout, handoff

**Files:**
- Modify: `docs/production-build/PRODUCTION-ROADMAP.md` (mark P4 complete, point at the milestone doc, per P0/P1/P2.1's exact precedent)
- Create: `docs/milestones/P4-complete.md`
- Create: `docs/production-build/P4-HANDOFF.md` (only if this plan is executed across multiple sessions — otherwise skip, per this project's own established practice of writing handoffs only when actually needed)

- [ ] **Step 1: Run the full suite**

Run: `npm ci && npm run typecheck && npm run test && npm run build`
Expected: all green, from a clean install.

- [ ] **Step 2: Apply migration 013 (and 014 if Task 10 split it out) to the real hosted dev project**

```
cp schema/013_estimating_and_qb_import.sql supabase/migrations/20260113000000_estimating_and_qb_import.sql
supabase.cmd db push --dry-run --linked   # review first
```

Then hand the actual `supabase.cmd db push --linked --yes` to the user's own terminal, per this session's established pattern (the auto-mode classifier blocks live-database-mutating commands run directly by the agent) — do not attempt to run it directly; ask the user to run it and report back the output, exactly as happened for migrations 001-012.

- [ ] **Step 3: Extend or re-run the live checkpoint**

Either extend `scripts/db/live-auth-checkpoint.mjs`'s sibling pattern with a new `scripts/db/live-p4-checkpoint.mjs` (real budget entry, real import parse+confirm, real reconciliation check, against the live project, with full cleanup) or, if time-constrained, perform the manual verification from Tasks 6/9/11 one more time against the now-fully-migrated real project and document the exact commands/results — either way, this package's milestone doc must contain real evidence, not "should work," matching every prior milestone's bar.

- [ ] **Step 4: Write `docs/milestones/P4-complete.md`**, following `P2.1-complete.md`'s exact structure (Status/Verified commit/Tag, Scope, What shipped, Tests run, Independent review, Unresolved decisions, Known limitations, Relevant files, Recommended next package, Starter prompt for a fresh session).

- [ ] **Step 5: Update `PRODUCTION-ROADMAP.md`'s P4 section** to `**Status: Complete.**` with the tag/commit, matching the exact phrasing pattern used for P0/P1/P2.1's status lines.

- [ ] **Step 6: Tag and final commit**

```bash
git add docs/milestones/P4-complete.md docs/production-build/PRODUCTION-ROADMAP.md
git commit -m "docs: close out P4 milestone"
git tag p4-complete
```

- [ ] **Step 7: Stop for approval** — do not begin P5 or P6. Report the milestone doc's location and summary to the user and wait.

---

## Self-review notes (completed during plan authoring, not a step for the implementer)

- **Spec coverage check against the user's P4 requirements:** real budget entry/editing → Tasks 4, 6. Original/revised tracking → Task 1 (guard trigger), 4 (actions), design doc §"Decisions made" #2. Scope descriptions → Task 5 (already a P2.1 column, just needed an editor). Estimate-visible/billable flags → Task 5 (ditto). QuickBooks file import → Tasks 8, 9. Import mapping profiles → Tasks 1, 7. Duplicate detection → Task 8 (`existingExpenseKeys` + in-file check). Pending review before posting → Task 10's RPC (`financial_status: 'pending'`) + existing posting action (unchanged). Import exception handling → Task 8/9 (`unmatched`/`error` statuses) + Task 10 (RPC blocks confirm). Audit history → Task 1 (three new/extended audit triggers). Reconciliation reporting → Task 10/11 (`reconcileImportBatch`). One ledger centered on project+cost code → the design doc's opening section, honored by every task reusing the existing composite-FK tables, never a new one.
- **Known open seam flagged during authoring, not resolved here:** Task 10 Step 1's note about `raw_data`'s key normalization must be resolved consistently between Tasks 9 and 10 during execution — flagged explicitly rather than silently picking one and hoping the other task agrees, since a fresh subagent implementing Task 9 won't see Task 10's file otherwise.
- **AI-readiness retrofit (2026-08-06 amendment):** Tasks 4, 5, 7, and 10 were revised after initial authoring to split each mutation into a plain, DI-seam-style service function under `packages/02-app-shell/src/services/` plus a thin Server Action wrapper, per `TARGET-ARCHITECTURE.md` §14 / `AI-ASSISTANT-ARCHITECTURE.md` — added before any task was executed, so this is a plan revision, not a mid-implementation scope change. Verified every mutation task got the same treatment: `budgetService.ts` (Task 4), `costCodeService.ts` (Task 5), `importMappingService.ts` (Task 7), `importService.ts` (Tasks 10 and 11's row-level actions). Task 9's Route Handler was left as-is — file parsing is a Route Handler concern per `TARGET-ARCHITECTURE.md` §5.1, not a repository/service call, so it isn't part of this pattern.
