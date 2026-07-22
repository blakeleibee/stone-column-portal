# Package 2 — App shell & responsive framework

## What's here

```
src/
  design/tokens.ts       -- colors, spacing, typography, breakpoints
  assets/logo.svg        -- placeholder logo asset (real file, not base64-in-JS)
  nav/navigation.ts      -- role-based nav config (admin/staff, client, client "More")
  data/
    financialRepository.ts         -- the repository INTERFACE (production screens depend on this only)
    fixtureFinancialRepository.ts  -- Hawks Ridge sample data — previews/tests ONLY
    supabaseFinancialRepository.ts -- documented stub (no live Supabase project in this sandbox)
    previewGuard.ts                -- contract every future mutation must check during client preview
  viewmodels/
    types.ts                          -- AdminFinancialsViewModel / ClientBudgetViewModel
    buildAdminFinancialsViewModel.ts   -- the ONLY place that calls the full internal engine
    buildClientBudgetViewModel.ts      -- calls ONLY client-safe repository methods
  components/
    AppShell.tsx          -- responsive shell + functional mobile drawer + client "More" sheet
    BudgetTable.tsx        -- pure presentation; computes nothing
  screens/
    AdminFinancialsScreen.tsx           -- renders AdminFinancialsViewModel; no fixture/engine imports
    ClientBudgetAndInvoicesScreen.tsx   -- renders ClientBudgetViewModel; no internal fields in scope at all
test/
  render_smoke.tsx        -- ACTUALLY EXECUTED via `npx tsx` — 47 checks, see below
```

## Running it

```
npm run smoke       # tsx test/render_smoke.tsx — actually renders every component via react-dom/server
npm run typecheck   # tsc --noEmit — see docs/TYPESCRIPT_VERSION_FIX.md for the version-pinning fix
```

## Architecture, in one paragraph

A screen never imports a fixture or a data source directly. A
`FinancialRepository` (interface) is the only thing screens' *builder*
functions depend on — `buildAdminFinancialsViewModel` calls the full
Package 1 engine against whatever the repository returns and produces
an `AdminFinancialsViewModel`; `buildClientBudgetViewModel` calls only
the repository's client-safe methods and produces a `ClientBudgetViewModel`
that has no internal field *in its type*, not just hidden in its
rendering. `AdminFinancialsScreen`/`ClientBudgetAndInvoicesScreen` each
render exactly one of those view models and import nothing else
data-related. `FixtureFinancialRepository` is the only file that
imports the Hawks Ridge sample data — enforced by a grep-based test in
`render_smoke.tsx`, not just a naming convention.
