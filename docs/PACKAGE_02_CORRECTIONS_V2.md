# Package 2 — Corrections, Round 2

Item-by-item record of the review pass. All 11 items addressed; two of
them (4 and 5) surfaced a real ordering bug in my own new SQL while
fixing them, caught before it could ship — see item 4 below.

## 1. Fixture removed from production components

New `src/data/` + `src/viewmodels/` layers:
- `FinancialRepository` (interface) — the only thing screens'
  view-model builders depend on.
- `FixtureFinancialRepository` — the ONE file in this package allowed
  to import `fixtures/hawksRidge`. Enforced by a grep-based test, not
  just convention: `render_smoke.tsx` reads the actual source text of
  every screen/component file and asserts none of them contain
  `fixtures/hawksRidge` or `data/fixtureFinancialRepository`.
- `SupabaseFinancialRepository` — a documented stub (throws with a
  clear message + the intended Supabase query as a comment on every
  method). Not functional — no live Supabase project exists in this
  sandbox — but it proves the interface is implementable by something
  other than the fixture, and gives Package 3+ the exact query shape to
  fill in rather than inventing it under time pressure.
- `buildAdminFinancialsViewModel` / `buildClientBudgetViewModel` — the
  only two places that call the engine (full internal surface, and
  client-safe-only surface, respectively).

`AdminFinancialsScreen` and `ClientBudgetAndInvoicesScreen` (replacing
the old single `FinancialsScreen`) each take an already-built view
model as their only data prop.

## 2. Admin/client visibility split

Two separate screens, two separate view model **types** (not one type
with optional/hidden fields):

- `AdminFinancialsViewModel` — full `CategoryFinancials[]`, fee summary,
  reconciliation report, suggestions.
- `ClientBudgetViewModel` — original/approved/revised estimate,
  published-actual-cost, invoices (empty until Package 4), invoice
  summary (total/paid/balance), and visibility flags
  (`showVendorNames`/`showSupportingInvoices`, read from a new
  `getClientVisibilitySettings()` repository method mirroring the
  spec's per-project client-visibility defaults). **No** fee accrual,
  reconciliation, suggestions, or per-category internal status
  anywhere in the type — `render_smoke.tsx` asserts this with
  `!("feeSummary" in clientVM)` etc., a type/shape check, not just "the
  rendered HTML happens not to mention it this time."

**Deliberate, disclosed decision on "Projected Final":** the master
spec lists it as client-visible, but Package 1's data model has no
client-safe forecast/projection concept — `committed_costs` and
`forecast_entries` are both internal-only by RLS design. Fabricating a
"projected final" for the client view model from internal data would
smuggle internal figures in through a back door. Left out, with the
reasoning in `buildClientBudgetViewModel.ts`'s header comment, as an
open product question for a later package rather than solved by
quietly reusing internal numbers.

## 3. Reconciliation no longer compares a number to itself

**The bug:** `reconcileProject(categories, totals.actualCostCents)` —
`totals` was `computeProjectTotals(categories)`, so this was passing
categories' own derived sum back in as the "control total." Always
passes, proves nothing.

**The fix:** `FinancialRepository.getIndependentPostedActualCostCents()`
— a method whose contract explicitly forbids implementing it by
calling the engine's rollup functions. The fixture implementation sums
the raw expense array directly (bypassing `computeAllCategoryFinancials`'s
grouping entirely); a real repository would run a standalone `SELECT
SUM(amount_cents) ... WHERE financial_status = 'posted'` query.
`buildAdminFinancialsViewModel` passes this independent value into
`reconcileProject`, not the category-derived total.

**Drill-down, not a placeholder:** `AdminFinancialsScreen`'s
`ReconciliationPanel` now lists every `report.issues[]` entry
individually (scope, message, expected vs. actual, formatted) instead
of a static "see drill-down" message.

**Tested:** `render_smoke.tsx` constructs a repository whose
independent total is genuinely correct (passes) and one that's off by
exactly one cent (fails, with the 1-cent discrepancy actually reported).

## 4. Forecast hardening SQL test — fixed, and a self-caught bug along the way

**The original bug:** the test inserted two simultaneously-active
`forecast_entries` rows for the same cost code before superseding the
first — which 001's own partial unique index
(`forecast_entries_one_active_per_cost_code`) would reject immediately
on the second insert. Fixed by adding `superseded_by_id` to
`forecast_entries` (schema/003) and a `supersede_forecast()` RPC that
does validate → claim old → insert new → link, atomically.

**A bug in my own first draft of that RPC, caught before shipping it:**
my first version inserted the new forecast row, THEN updated the old
row to `superseded_at = now(), superseded_by_id = new_id` in one final
statement. That ordering is exactly wrong given the partial unique
index — inserting the new row while the old one still had
`superseded_at IS NULL` would itself violate the same index the RPC is
supposed to respect (both rows would momentarily look "active" for the
same cost code). Fixed by claiming the old row first
(`superseded_at = now()` alone), then inserting, then linking — three
statements instead of two, with `forecast_entries_superseded_by_
implies_at` deliberately written as one-directional (`superseded_by_id
implies superseded_at`, not the reverse) so the necessary intermediate
state (claimed but not yet linked) is valid. Documented inline in
`schema/003_status_transitions_and_supersede_rpcs.sql`.

Updated SQL test (`tests/sql/committed_forecast_hardening_tests.sql`):
asserts the naive double-insert is rejected, then exercises the RPC
correctly, then asserts a THIRD insert attempt (after the replacement
exists) is also rejected — proving the protection is ongoing, not a
one-time check that only fires on the very first violation.

## 5. Committed-cost status transitions tightened

`committed_cost_status` enum (`open`/`fulfilled`/`cancelled`/
`superseded`) replaces the free-text column. A new trigger
(`enforce_committed_cost_status_transition`) enforces: only `open` can
transition anywhere; `fulfilled`/`cancelled`/`superseded` are terminal
(reject any further status change, including back to `open`);
superseding requires both `superseded_at` and `superseded_by_id`
together; the replacement referenced by `superseded_by_id` must itself
be currently `open` (this is what actually prevents a supersede cycle
— every link in a chain must point to a genuinely fresh row, not one
that's already terminal/superseded itself). A composite FK
(`(superseded_by_id, cost_code_id) references committed_costs(id,
cost_code_id)`) keeps the replacement in the same cost code, same
pattern as `budget_ledger`'s reversal FK.

**The test previously superseded a commitment that was already
`fulfilled`, and treated that as valid.** Reviewed and decided: no —
fulfilled is terminal, this should be rejected, and now is (both
`assert_raises` for superseding-a-fulfilled-commitment and for
reverting a terminal status back to `open`).

`supersede_committed_cost()` RPC — validate → insert replacement →
link, atomically, `SECURITY INVOKER` (doesn't need to bypass RLS; the
caller already has ordinary staff access to insert/update
`committed_costs`).

## 6. Mobile navigation completed

`clientMoreNav` was defined in `navigation.ts` but never rendered
anywhere — Updates & Photos and Documents were unreachable on mobile.
The admin/staff menu button had no `onClick` at all. Both fixed with
real `useState`-backed overlays in `AppShell.tsx`: a client "More"
bottom sheet and an admin/staff navigation drawer, both with:
- Real open/close handlers (button clicks, backdrop click, Escape key)
- `role="dialog"`, `aria-modal="true"`, `aria-label`
- Focus moves into the overlay on open (to its close button) and back
  to the trigger button on close
- `aria-expanded`/`aria-haspopup` on the trigger buttons

**Disclosed test gap:** no headless browser or jsdom exists in this
sandbox (confirmed — no cached Playwright Chromium binary, no network
to fetch one), so the click-to-open interaction itself isn't simulated
end-to-end. `AppShell` gained two test-only props
(`initialDrawerOpen`/`initialMoreSheetOpen`, default `false`, no
production effect) so `render_smoke.tsx` can render the *open* state
directly via SSR and verify the right content becomes reachable and
the right ARIA attributes appear — real coverage of "is the content
there once open," not of "does the click actually toggle it," which is
a few lines of `onClick={...}` directly reviewable in `AppShell.tsx`.

## 7. Client-preview language and required flow corrected

Banner text changed from "data shown reflects real client visibility
rules" (a claim this component cannot back up on its own) to "Client
preview" (accurate regardless of how the data was actually sourced).
The full required flow (admin stays authenticated as admin, selects a
project to preview, fetches through the same client-safe path,
mutations blocked, persistent banner, obvious exit) is documented in
`AppShell.tsx`'s prop comment and `docs/PACKAGE_02_NOTES.md` — most of
it isn't implementable yet (no real auth session, no project picker,
no mutating UI to block) but is written down as a contract rather than
left implicit. Item 7's mutation-blocking requirement specifically is
addressed by `previewGuard.ts` (see item 9 below).

## 8. Unstable list keys fixed

`SuggestionViewItem.key`, computed once in
`buildAdminFinancialsViewModel` as `${costCodeId}:${sourceType}:
${direction}` — deterministic given the engine emits at most one
`'over'` and one `'under'` suggestion per category per call. Both
`AdminFinancialsScreen` and `BudgetTable` use `.key`, never `.map((s,
i) => ...)`. Documented as a placeholder for the real
`budget_suggestions.id` once suggestions are persisted (Package 3).

## 9. Component tests now verify architecture, not just text

`render_smoke.tsx` (47 checks, up from 12) adds, per the review's list:
grep-based no-fixture-import checks on every screen/component file; a
second, entirely independent in-memory repository (`TestProjectBRepository`)
proving the builders/screens are genuinely parameterized (different
project name, different totals, zero Hawks Ridge strings anywhere in
the output); direct type-shape assertions that internal fields are
literally absent from the client view model (not just unrendered);
the reconciliation pass/fail-by-one-cent pair; client "More" sheet and
admin drawer open-state content checks; active-page `aria-current`
count; and a `previewGuard` contract test. `formatCents` is now
imported from the engine everywhere a dollar figure needs comparing,
replacing the previous manual `cents / 100` division.

## 10. TypeScript verification

`package.json` now lists `@types/react`/`@types/react-dom` (`^19.0.0`)
alongside `react`/`react-dom` — not installable here (no network), but
present and version-matched for whoever runs `npm install` with real
network access. `npm run typecheck` (`tsc --noEmit`) is added as a
script now, even though it doesn't currently pass — it's the gate this
package is NOT claiming to have passed, and should be required before
any "production-ready" label per the standing instruction. No lockfile
is generated (same reasoning as Package 1's `NOTE_ON_LOCKFILE.md`:
fabricating one without network access to compute real integrity
hashes would be worse than omitting it).

## 11. Delivery packaging

This handoff's file tree is presented preserving the actual repository
directory structure (see the file list in the main response), and a
single archive is also provided preserving that structure, rather than
a flattened/re-nested one.

## Test Results

```
$ cd packages/01-financial-engine && npm run typecheck && npx ts-node test/run.ts && npx ts-node test/edge_cases.ts
(clean) / all assertions passed / all 31 checks passed — unaffected by this round

$ cd packages/02-app-shell && npx tsx test/render_smoke.tsx
render_smoke.tsx: all 47 checks passed.
```

`schema/003_status_transitions_and_supersede_rpcs.sql` and the updated
`tests/sql/committed_forecast_hardening_tests.sql`: written, reasoned
through carefully (including the self-caught ordering bug above), same
disclosed **not executed** status as all other SQL in this project.

## Known limitations (carried forward + new)

- `tsc --noEmit` still doesn't run for Package 2 (no `@types/react`
  available offline).
- No headless browser/jsdom — click-simulation tests are structural
  (open-state rendering), not literal click-event tests.
- `SupabaseFinancialRepository` is a documented stub, not a working
  implementation — there is no live Supabase project to connect to.
- "Projected Final" is absent from the client view model by design,
  pending a real product decision (see item 2).
- All Package 1 SQL/RLS gates from prior rounds remain unchanged and
  still unexecuted against a real database — this round adds
  `schema/003_...sql` to that same disclosed-but-unverified list.
