# Package 1 — Data Model & Financial Engine

## What this fixes from the prototype

The Phase 1 prototype computed `contractorFee = totalActual × fee` with
no eligibility rules, and displayed `invoiced`, `paid`, and
`projectedFinal` as hardcoded arithmetic (`totalActual + fee - 800000`,
`- 1200000`, `+ 950000`) — numbers with no ledger behind them. This
package replaces that with:

- A real append-only budget ledger (`budget_ledger` table /
  `computeCategoryFinancials`) so revised estimate is always original +
  approved changes, never a typed-in number. Enforced append-only at
  the database level (trigger + revoked grants), not just by policy.
- A fee engine that respects per-cost-code eligibility and per-expense
  overrides (`fee.ts`), so contingency (for example) is correctly
  excluded from the fee basis instead of being taxed at 15% like
  everything else. Fee rounding follows one documented, tested policy
  (round once per category, round-half-away-from-zero) instead of an
  implicit `Math.round()`.
- A reconciliation check (`reconciliation.ts`) that verifies category
  totals sum to project totals to the cent, and fails loudly (with the
  exact expected vs. actual numbers) if they don't.
- A suggestion engine (`suggestions.ts`) that proposes — but never
  writes — possible over/under-budget forecasts, gated on an explicit,
  human-set `cost_code_status` field rather than inferred from absence
  of open commitments (a false-positive-prone heuristic flagged and
  fixed in `docs/PACKAGE_01_CORRECTIONS.md`).
- Trigger-based, centralized audit logging — not dependent on every
  future screen remembering to write an audit row.

See `docs/PACKAGE_01_CORRECTIONS.md` and `docs/PACKAGE_01_CORRECTIONS_V2.md`
for the full record of both review passes this package went through.
Round 2, in particular, changed the access-control model (org-wide
staff access, not project-membership-based — see the bootstrap note in
the schema), split expense financial_status from publication_status,
and replaced all percentage-based fee math with integer basis points
computed via BigInt.

## Files

```
schema/001_core_financial.sql        -- Postgres/Supabase migration (single source of truth)
tests/sql/package1_tests.sql         -- SQL/RLS test suite — WRITTEN, NOT EXECUTED (no local Postgres in this sandbox; run it yourself, see the file's own header for instructions)
packages/01-financial-engine/
  src/types.ts           -- shared types (Cents = integer, BasisPoints = integer, never float)
  src/money.ts           -- integer-cents-safe arithmetic, BigInt basis-point math, bigint/API helpers
  src/budget.ts          -- category & project rollups (THE rollup logic; actual cost = posted only)
  src/fee.ts             -- fee accrual, eligibility-aware, basis-point rounding
  src/reconciliation.ts  -- to-the-cent consistency checks
  src/suggestions.ts     -- pure suggestion engine (status-gated, no side effects)
  test/run.ts            -- runnable proof against corrected sample data (includes pending expenses)
  test/edge_cases.ts     -- 31 named checks: credits, refunds, pending/posted/void, basis-point
                            rounding (unusual rates, negative credits, large values), partial
                            commitments, forecast supersession, suggestion lifecycle, broken
                            reconciliation, bigint safety, cross-project note
```

## Running it

```
cd packages/01-financial-engine
npx tsc --noEmit                 # type-check
npx ts-node test/run.ts          # corrected sample-project walkthrough
npx ts-node test/edge_cases.ts   # 31 edge-case checks
```

All three commands were actually run this session and pass. For the SQL
suite:

```
# Against a real Supabase project, or a local Postgres via Docker —
# see the header of tests/sql/package1_tests.sql for both options.
psql "$DATABASE_URL" -f schema/001_core_financial.sql
psql "$DATABASE_URL" -f tests/sql/package1_tests.sql
```

This has NOT been run in this sandbox (no Postgres/Docker/network
available here) — see `docs/PACKAGE_01_CORRECTIONS_V2.md` for the full
disclosure.

## How this connects to Supabase later

1. Create a Supabase project, run `schema/001_core_financial.sql` in
   the SQL editor (or via `supabase db push` with it as a migration).
2. The TypeScript engine in `src/` takes plain arrays of rows shaped
   like the SQL tables — in the real app, those arrays come from
   Supabase queries (e.g. `select * from expenses where project_id =
   ...`), not from hardcoded sample data. `test/run.ts` shows the exact
   shape each function expects.
3. `is_org_admin()` / `is_project_client()` are `security definer` SQL
   functions referenced by the RLS policies — they read `auth.uid()`,
   which Supabase populates automatically from the logged-in user's JWT.
   No extra wiring needed beyond enabling Supabase Auth.

## What's NOT in this package

No UI. No invoices, change orders, selections, conversations, imports,
or vendor access — those are Packages 2–8. This package exists so every
later package computes financial numbers the same, correct way instead
of each screen inventing its own formula (which is exactly how the
prototype's numbers went wrong).
