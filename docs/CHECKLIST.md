# Completed / Remaining Checklist

## Package 1 — Data model & financial engine (Round 3: self-verification of Round 2)

### Round 3 additions (see docs/PACKAGE_01_CORRECTIONS_V3.md for full detail)
- [x] Fixed a real logic bug in `enforce_reversal_magnitude()`: the
      magnitude check never included the new row's own amount (a
      `BEFORE INSERT` trigger's `SELECT` against its own table can't see
      the row being inserted), so a single lone over-magnitude reversal
      would have passed silently — only a *second* one would ever have
      been caught.
- [x] Fixed a missing sign/direction check in the same trigger: a
      same-signed "reversal" (not actually reversing anything) wasn't
      rejected before, only magnitude was checked.
- [x] Added a `staff`-role RLS test distinct from `admin` (org-wide
      project visibility parity, but rejected from updating another
      user's profile — only `admin` can)
- [x] Added a `Vendor A` RLS test (sees nothing except their own
      `project_members` row — today's correct baseline, pinned down as
      a regression test for Package 8)
- [x] Added `package.json` pinned to verified-working tool versions;
      documented honestly why no `package-lock.json` is included
      (fabricating one with invented integrity hashes would be worse
      than omitting it)
- [x] Added `schema/001_core_financial_down.sql` (full rollback) and a
      documented `up → down → up` reapply test procedure
- [x] Found and fixed a role-creation ordering bug while writing the
      above: `001`'s own `create policy ... to authenticated` requires
      the `authenticated` role to exist at `CREATE POLICY` time, not
      just at query time — split environment setup into
      `tests/sql/000_bare_postgres_bootstrap.sql`, which must run
      *before* the schema migration on bare Postgres
- [x] TypeScript re-run after all changes: `npm run typecheck` clean,
      `npm test` — `run.ts` all assertions pass, `edge_cases.ts` all 31
      checks pass (unchanged this round — none of the above touch the
      engine)

## Round 2 (independent SQL/TS review) — see docs/PACKAGE_01_CORRECTIONS_V2.md

### Completed
- [x] Fixed `audit_log`'s RLS policy (`using (true)` with no `to`
      clause exposed every row to any authenticated user); every policy
      in the schema now explicitly scoped `to authenticated`
- [x] Enabled RLS on `orgs` and `profiles` (previously not enabled at
      all), with self/org-staff/org-admin scoping and a trigger blocking
      role/org/active-status self-escalation
- [x] Split `expenses.status` into `financial_status` (pending/posted/
      void — the only thing that affects money) and `publication_status`
      (internal/ready/published/withdrawn — client visibility only)
- [x] Database-enforced expense state machine: pending→posted→void only,
      posted financial fields frozen, void fully immutable, delete only
      while pending
- [x] Reviewed every financially-relevant table for destructive delete;
      added supersede/archive/void patterns and delete-blocking triggers
      throughout, with delete-still-audited for the one legitimate case
      (pending expenses)
- [x] Replaced floating-point fee percentage with integer basis points
      (`fee_basis_points`, denominator 10,000) and exact BigInt
      round-half-away-from-zero arithmetic — no float touches money math
      anywhere
- [x] Cross-project referential integrity via composite foreign keys —
      enforced by Postgres itself, not a trigger
- [x] Hardened every `SECURITY DEFINER` function: explicit
      `search_path`, schema-qualified references, `EXECUTE` revoked from
      `PUBLIC` and re-granted only to `authenticated`
- [x] Client-safe views (`client_expense_view`, `client_budget_view`)
      with `security_invoker = true`, excluding internal notes/source
      metadata/correction reasons
- [x] Reversal-integrity constraints on `budget_ledger`/`fee_ledger`
- [x] Safe bootstrap RPC (`bootstrap_organization`) solving the RLS
      chicken-and-egg problem by making staff access org-wide instead of
      `project_members`-based
- [x] Added missing schema validation constraints
- [x] Complete SQL/RLS test suite (`tests/sql/package1_tests.sql`) —
      written, reasoned through carefully, **not executed** (no local
      Postgres/Docker/network in this sandbox)

### Known limitations / explicitly deferred (carried forward, still true)
- [ ] `committed_costs`/`forecast_entries` supersede pattern still not
      trigger-enforced against direct amount edits — Package 4
- [ ] Vendor RLS entirely unbuilt (Package 8) — now at least has a
      regression-test baseline (Round 3)
- [ ] No invoice/draw table yet
- [ ] No change_orders table yet
- [ ] **SQL/RLS has never been executed against a real database.** This
      is the load-bearing caveat for this entire package.

## Package 2 — App shell & responsive framework

**Consolidated as of the third correction round** (previous drafts of
this section, across three review rounds, accumulated stale claims —
e.g. a "12 checks" count and a single `FinancialsScreen` that no longer
exist. This section describes the CURRENT implementation only. Full
round-by-round history: `docs/PACKAGE_02_NOTES.md`,
`docs/PACKAGE_02_CORRECTIONS_V2.md`, `docs/PACKAGE_02_CORRECTIONS_V3.md`.)

### Architecture
- [x] `FinancialRepository` interface — the only thing screens'
      view-model builders depend on
- [x] `FixtureFinancialRepository` — the ONE file allowed to import
      `fixtures/hawksRidge`, enforced by a grep-based test
- [x] `SupabaseFinancialRepository` — documented, non-functional stub
      (no live Supabase project in this sandbox)
- [x] `buildAdminFinancialsViewModel` — the only place that calls the
      full internal Package 1 engine
- [x] `buildClientBudgetViewModel` — calls ONLY client-safe repository
      methods; the resulting `ClientBudgetViewModel` type has no
      internal field (fee/reconciliation/suggestions/status) at all
- [x] `AdminFinancialsScreen` / `ClientBudgetAndInvoicesScreen` — two
      separate screens, two separate view-model types, each rendering
      exactly one; neither imports a fixture or the engine's
      calculation functions directly (only `formatCents`, which is
      formatting, not calculation)
- [x] Reconciliation uses an independently-sourced control total
      (`getIndependentPostedActualCostCents`, deliberately NOT derived
      by calling the engine's own rollup functions) — tested to
      actually fail on a 1-cent discrepancy, not just pass by construction
- [x] Reconciliation drill-down renders every actual issue, not a
      placeholder message
- [x] Stable, deterministic suggestion keys (`costCodeId:sourceType:
      direction`), not array indexes
- [x] `previewGuard.ts` — `assertNotPreviewing()` contract for future
      mutation-blocking during client preview (no mutating UI exists
      yet to wire it to)
- [x] Preview banner says "Client preview" — not a claim about real
      visibility rules this component can't back up on its own

### Navigation & responsive shell
- [x] Design tokens, real mobile-first breakpoints, logo as a real SVG
      asset (not base64-in-JS), role-based nav config
- [x] Functional client "More" bottom sheet (reaches Updates & Photos /
      Documents, previously unreachable) and functional admin/staff
      mobile drawer (previously a button with no handler at all) — both
      with real open/close/Escape/backdrop-click behavior, ARIA
      (`role="dialog"`, `aria-modal`, `aria-expanded`, `aria-label`),
      and focus movement in on open / back to trigger on close

### Database (schema/)
- [x] `002_committed_forecast_hardening.sql` — core-field immutability
      triggers for `committed_costs`/`forecast_entries`/
      `budget_suggestions`
- [x] `003_status_transitions_and_supersede_rpcs.sql` — committed-cost
      status enum + valid-transition trigger, forecast supersede
      lineage, atomic `supersede_committed_cost()`/`supersede_forecast()`
      RPCs (a real ordering bug in the first draft of the forecast RPC
      was caught and fixed before shipping — see
      `docs/PACKAGE_02_CORRECTIONS_V2.md` item 4)
- [x] `004_committed_cost_insert_guard_and_forecast_lineage_lock.sql` —
      closed the INSERT-time bypass on `committed_costs` (a row could
      previously be inserted directly as `status='superseded'`) and
      locked terminal-row/superseded-forecast lineage against further
      mutation
- [x] `005_forecast_commit_time_lineage_consistency.sql` — a
      `DEFERRABLE INITIALLY DEFERRED` constraint trigger closing the
      last gap: 004's triggers only fired when a row was ALREADY
      superseded, so a direct `UPDATE ... SET superseded_at = now()`
      (touching only that one field) on an ACTIVE forecast passed every
      check and could commit permanently half-superseded. The new
      trigger enforces "both fields null, or both set" at commit time —
      deliberately re-querying the row fresh rather than trusting its
      own captured `NEW`, specifically because `supersede_forecast()`
      updates the same row twice before commit and a naive version
      would incorrectly fail on the RPC's own legitimate intermediate
      state (reasoned through carefully; see the file's header comment
      for the exact failure mode this design avoids)
- [x] `committed_forecast_hardening_tests.sql` — updated to actually
      exercise the RPCs and assert the previously-untested rejection
      cases; a genuine test-setup bug (a competing "forecast_3" insert
      that would itself have been rejected by the one-active-per-cost-
      code index) was found and fixed, and the file's header now
      contains a full per-cost-code active-forecast trace proving no
      ordinary INSERT in the file ever creates two simultaneously-
      active forecasts for the same cost code

### TypeScript verification
- [x] `@types/node` vendored into `packages/02-app-shell/node_modules/`
      from an already-present copy on disk (ts-node's own bundled
      dependency, version 25.6.0) — no network fetch involved, and this
      directory is excluded from the delivered archive (`node_modules`
      is not meant to be committed; `package.json` pins the version a
      real `npm install` should resolve to)
- [x] `tsconfig.json` explicit `"types": ["node"]`
- [x] `test/render_smoke.tsx` converted from `React.createElement(...)`
      calls to real JSX — the correct root-cause fix for a `children`-
      typing incompatibility, not a suppression
- [ ] **`tsc --noEmit` still does not fully pass** — every remaining
      error (267 lines, individually reviewed) traces to the single
      missing `@types/react`/`@types/react-dom` package, which cannot
      be fetched without network access in this sandbox. See "Test
      results" below for the exact command and a categorized summary
      of what's left.
- [x] No `any`, no `@ts-ignore`, no blanket suppressions anywhere in
      this package (the one place that previously used `any` was
      replaced with a proper type guard, `hasStatusField`)

### Tests actually executed (most recent run)
- Package 1 (`packages/01-financial-engine`): `npm run typecheck`
  (clean), `npx ts-node test/run.ts` (all assertions pass), `npx
  ts-node test/edge_cases.ts` (31 checks pass) — unaffected by any
  Package 2 change
- Package 2 (`packages/02-app-shell`): `npx tsx test/render_smoke.tsx`
  — **47 checks, all pass**
- Package 2: `npx tsc --noEmit` — **does not fully pass**; see Known
  limitations

### Known limitations
- [ ] `tsc --noEmit` blocked solely on missing `@types/react`/
      `@types/react-dom` (no network access in this sandbox to fetch
      them) — this is the one remaining gate before "production-ready"
      per the standing instruction
- [ ] No real npm lockfile — generating one without hitting the real
      npm registry would mean fabricating integrity hashes, which is
      worse than omitting the file (same reasoning as Package 1's
      `NOTE_ON_LOCKFILE.md`)
- [ ] No headless browser/jsdom in this sandbox — mobile-nav "open"
      tests are structural (SSR render of the open state via test-only
      props), not literal click-event simulation
- [ ] `committed_costs`/`forecast_entries` core-field immutability
      (002) and status-transition enforcement (003) are both SQL,
      written and reasoned through carefully, but **never executed**
      against a real Postgres — this remains the load-bearing caveat
      for the database layer, same as Package 1
- [ ] `SupabaseFinancialRepository` remains a documented, non-functional
      stub
- [ ] "Projected Final" is intentionally absent from the client view
      model pending a real product decision (no client-safe forecast
      source exists in the data model yet)
- [ ] No real router — `AppShell` takes `activeKey`/`onNavigate` props;
      Next.js App Router wiring happens once this is a real Next.js project
- [ ] Icons remain a monogram placeholder, not `lucide-react`
- [ ] Cross-package imports work because both packages share one
      checkout; a real monorepo needs an npm workspace or `tsconfig`
      path alias

## Packages 3–8

Not started. See `IMPLEMENTATION_PLAN.md`.
