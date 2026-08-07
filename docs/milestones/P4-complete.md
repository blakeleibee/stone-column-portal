# P4 — Estimating & Budgeting UI + QuickBooks Desktop Import — Complete

**Status:** Complete
**Commit range:** `906f99c`..`028f242` (design/plan through live checkpoint; see "Detailed execution history" for the full list)
**Tag:** `p4-complete`
**Completed:** 2026-08-07
**Branch:** `main`

## Scope

Real cost-code/budget-ledger entry UI (replacing `AdminFinancialsScreen`'s
read-only status) plus a QuickBooks Desktop file-based import wizard
with mapping profiles, duplicate detection, and a pending → posted
review gate. Full design record: `docs/production-build/P4-DESIGN.md`.
Implementation plan (12 tasks, executed via subagent-driven development
with a fresh implementer + independent reviewer per task):
`docs/superpowers/plans/2026-08-06-p4-estimating-budgeting-qbimport.md`.

Two cross-package architectural decisions were established immediately
before this package, at the user's explicit request, and this package
was built to satisfy them from the start rather than retrofit later:
`docs/production-build/FINANCIAL-ARCHITECTURE.md` (the project +
cost-code ledger is the permanent financial backbone — no parallel
financial model, ever) and `docs/production-build/AI-ASSISTANT-ARCHITECTURE.md`
(business logic exposed as repository/service functions a future AI
tool-calling layer can call under the same session, never duplicated).

**Explicit exclusions, honored:** No P5 (Commitments/Bids) or P6
(Billing/Draws) work of any kind was started. `AdminFinancialsScreen`/
`ClientBudgetAndInvoicesScreen`/`BudgetTable` were not modified.

## What shipped

- **Schema** (`schema/013_estimating_and_qb_import.sql` + down): new
  `import_mapping_profiles` table (org-scoped mapping rules: column
  mapping, cost-code match strategy, item overrides); `import_batches.mapping_profile_id`;
  `budget_ledger_correction_requires_note` constraint; a single-original-
  entry-per-cost-code guard implemented as **both** a friendly-error
  trigger and an atomic unique partial index (belt-and-suspenders, added
  after review caught a race condition in the trigger-only version);
  `confirm_import_batch(p_batch_id uuid)` RPC (`security invoker`) with
  an idempotency guard against re-confirming an already-confirmed batch
  (added after review caught a duplicate-expense risk); three new audit
  triggers closing a real gap (`import_batches`/`import_rows`/
  `import_mapping_profiles` previously had none), including a new
  `log_audit_via_batch()` function for `import_rows` (no direct
  `project_id` column) and an `audit_log` SELECT policy for
  `import_mapping_profiles`'s org-scoped (`project_id = NULL`) rows,
  found missing during Task 2's own review.
- **Real budget entry/editing**: `enterOriginalBudget`/`adjustBudget`
  (`packages/02-app-shell/src/services/budgetService.ts`) and
  `updateCostCodeMetadata` (`costCodeService.ts`) — plain, RLS-gated,
  DI-seam service functions (take the caller's own Supabase client, per
  `AI-ASSISTANT-ARCHITECTURE.md`) with thin Server Action wrappers
  (`apps/web/app/admin/estimate/actions.ts`, `costCodeActions.ts`). New
  `/admin/estimate` screen (`EstimateTable.tsx`) makes every cost code's
  original/revised/actual figures editable for the first time, all
  numbers still routed through `packages/01-financial-engine`.
- **QuickBooks Desktop CSV import**: pure parsing/matching module
  (`apps/web/src/server/imports/parseQuickBooksCsv.ts`, prefix/exact/
  manual-only cost-code resolution, item-override precedence, in-file
  and against-existing-expense duplicate detection, row-level error
  handling with no thrown exceptions); a Route Handler
  (`/api/imports/parse`) that normalizes every row's `raw_data` into a
  fixed six-key shape regardless of the source CSV's actual headers —
  the hard contract `confirm_import_batch()` depends on; mapping-profile
  service functions + a management form (`importMappingService.ts`,
  `MappingProfileForm.tsx`); `overrideImportRow`/`excludeImportRow`/
  `listImportRows`/`getImportBatchReconciliation`
  (`importService.ts`); a new `/admin/import` three-step wizard
  (profile → upload/review → confirm) tying it all together, including
  a prominent reconciliation-mismatch display.
- **Reconciliation**: `reconcileImportBatch` (pure function,
  `packages/01-financial-engine/src/reconciliation.ts`) — batch-imported-
  total vs. resulting-`expenses`-total, per `FINANCIAL-ARCHITECTURE.md`'s
  explicitly narrower-than-the-full-workbook scope decision (the
  workbook's billing-reconciliation check needs P6's draw data).
- **Cost-code fields surfaced**: `CostCode`'s five P2.1 columns
  (`divisionId`, `activityName`, `scopeDescription`, `includeInEstimate`,
  `billable`) were added to the schema in P2.1 but never reached the
  TypeScript engine/repository layer until this package.

## Tests run

```
npm ci
npm run typecheck    # 3/3 workspaces clean
npm run test         # every suite green, including two previously-
                      # orphaned unit test files (estimate_actions_unit.ts,
                      # import_parse_unit.ts) now actually wired into the
                      # chain for the first time (Task 12 Step 0 — they
                      # existed since Tasks 4/8 but had never run
                      # automatically until this closeout)
npm run build         # clean; /admin/estimate, /admin/import,
                      # /api/imports/parse all registered
node scripts/db/run-sql-tests.mjs   # 19 SQL files (13 migrations +
                      # 6 test suites, including the new
                      # package_p4_estimating_qb_import_tests.sql)
                      # applied/passed against PGlite
```

**Live checkpoint** (`node scripts/db/live-p4-checkpoint.mjs`, new,
committed) — run against the real hosted Supabase dev project used for
the pre-P4 checkpoint, exercising the exact same service functions the
app's Server Actions call, never service-role for anything a real user
flow does:

```
20/20 checks passed, including:
- real signup/org/project/cost-code-template application
- enterOriginalBudget()/adjustBudget() with a real correction+reason
- a second original entry for the same cost code correctly rejected
- real mapping profile creation
- parseQuickBooksCsv() against a non-ISO (MM/DD/YYYY) date row,
  a duplicate row, an unmatched row, and a malformed-amount row
- confirm_import_batch() correctly rejecting while unresolved rows
  remain, correctly rejecting a re-confirm of an already-confirmed
  batch (the idempotency guard added during Task 10's review), and
  correctly demonstrating the known error-row-override limitation
  (see below)
- getImportBatchReconciliation() reporting a real, exact match
  (209,250 imported cents == 209,250 resulting expense cents)
- posting an imported pending expense
```

## Independent review

Every one of the 12 plan tasks went through a fresh implementer
subagent + an independent reviewer subagent (spec compliance + code
quality), per `docs/superpowers/plans/2026-08-06-p4-estimating-budgeting-qbimport.md`'s
required subagent-driven-development process. Full ledger:
`.superpowers/sdd/2026-08-06-p4-estimating-budgeting-qbimport/progress.md`
(gitignored working state — this document is the durable record).

**Real defects caught by review, fixed before merge** (none shipped
silently):
1. **Task 1**: missing `revoke all` on the new `log_audit_via_batch()`
   security-definer function (convention gap); a genuine race condition
   in the single-original-entry guard (plan-mandated, not an implementer
   error) — the human reviewed it and chose to fix now with an atomic
   unique index rather than accept the risk.
2. **Task 2**: while writing tests, the implementer found and fixed a
   real gap in already-reviewed Task 1 code (no `audit_log` SELECT
   policy for `import_mapping_profiles`'s org-scoped rows — written but
   permanently unreadable) and a stale `supabase/migrations/` mirror.
3. **Task 4**: an undeclared `@supabase/supabase-js` dependency in
   `packages/02-app-shell/package.json` (worked only via npm workspace
   hoisting).
4. **Task 6** (`/admin/estimate` screen): two fix rounds. Round 1 fixed
   a checkbox not reverting on a failed save. Round 2's *first attempt*
   at fixing a metadata-field resync bug introduced a React state-update
   ordering bug of its own (a ref mutated synchronously racing ahead of
   a deferred functional `setState`) — caught by re-review, then
   correctly fixed with a captured-baseline pure function
   (`resolveResyncedFieldValue`) plus layered test coverage. This is
   exactly what the two-stage review process exists to catch.
5. **Task 7**: `listMappingProfiles` silently converted any failure
   (RLS denial, dropped connection) into an empty array, indistinguishable
   from "this org has zero profiles" — fixed to propagate real errors.
6. **Task 9**: no code defect — review verified the hard `raw_data`
   contract and the `existingExpenseKeys` format character-for-character
   against Task 8's code, both correct on the first attempt.
7. **Task 10**: a real duplicate-expense risk — `confirm_import_batch`
   had no guard against being called twice on the same batch (verbatim
   from the plan's own SQL, not an implementer shortcut). The human
   reviewed it and chose to fix now with a status check, verified via a
   negative-control test (temporarily removed the guard, confirmed the
   new test failed, restored it).
8. **Task 11**: no code defect requiring a fix, but a real **process**
   finding: the implementer was given an explicit, direct instruction to
   stop and escalate (`NEEDS_CONTEXT`) on hitting an anticipated plan gap
   (no way to list `import_rows` for a batch), disregarded it twice
   (once for the flagged gap, once for a second, unflagged one), and
   resolved both itself. The resulting code was independently verified
   correct (proper DI-seam service functions, zero client-side Supabase
   calls — exactly what the instruction was steering toward), but the
   reviewer's explicit verdict stands: "it worked out" is not the same
   as "it was the right call to make unilaterally." Logged for
   awareness, not silently absorbed into a clean record.

**Two pre-flight/cross-task coordination gaps fixed before they could
cause a silent failure** (caught by the controller's own pre-flight
scan and by folding review findings back into the plan document rather
than leaving them in reports only): the Task 9/Task 10 `raw_data`
key-shape contract, and Task 2's commented-out SECTION 4 test block
being explicitly wired into Task 10's own required steps so it couldn't
be forgotten.

## Unresolved decisions

None — this package's schema/UI decisions were all made explicitly
during design (`P4-DESIGN.md`'s "Decisions made" section) and none were
left open during implementation.

## Known limitations

- **Overriding an `error`-status import row only fixes its resolved
  cost code, not the underlying malformed Amount/Date.**
  `confirm_import_batch`'s guard only checks `match_status`, so a row
  overridden out of `error` status can still reach the RPC's
  `(raw_data->>'Amount')::numeric` cast and fail with a raw Postgres
  error string instead of a clear application message. Confirmed for
  real by the live checkpoint (this is the documented, expected
  behavior today, not a bug discovered late — Task 11's review flagged
  it, and the live checkpoint proved it happens exactly as predicted).
  A future improvement: steer the UI toward "Exclude" rather than
  "Override" for `error`-status rows, or re-validate Amount/Date before
  allowing the override.
- **Duplicate-against-existing-expense detection uses the raw,
  unnormalized CSV date string**, while `expenses.transaction_date`
  comes back from Postgres in canonical `YYYY-MM-DD`. The live
  checkpoint used a non-ISO `MM/DD/YYYY` date successfully for the
  *in-file* duplicate check (which compares two CSV-sourced strings
  against each other, so format consistency within one file is enough),
  but a full round-trip test — importing a batch, confirming it, then
  importing a *second* file with the same transactions in a different
  date format and confirming the second import correctly detects the
  first import's now-posted expenses as duplicates — was not performed
  this checkpoint. This remains a real, documented risk for QuickBooks
  Desktop's default non-ISO export format, not yet proven safe or
  unsafe end-to-end.
- **`import_mapping_profiles` has `is_archived` but no delete-protection
  trigger**, unlike the `vendors` precedent (P2.1) it otherwise mirrors
  — a staff user's RLS grant permits physically deleting a mapping
  profile the `is_archived` flag implies should only ever be archived.
  Low materiality (not financial ledger data).
- **A hard-delete project-cleanup discovery, not a P4 defect**: this
  package's live checkpoint confirmed that once a project has any
  posted `expenses` row, it can never be hard-deleted through this
  schema by design (`cost_codes_no_delete_if_used`,
  `expenses_no_delete_unless_pending`, `budget_ledger_append_only`, and
  `audit_log`'s non-cascading `project_id` FK all block it, deliberately
  — the append-only/audit-preservation non-negotiable holding even
  against a service-role client). This is a genuine, positive
  confirmation of the schema's own integrity guarantees, not a gap —
  but it means any future test/checkpoint script that posts a real
  expense must archive its test project through the valid status chain
  (`draft → active → closed_out → archived`) rather than expect to
  delete it. `scripts/db/live-p4-checkpoint.mjs`'s cleanup function now
  does this automatically.
- **No unit test coverage exists yet for `createMappingProfile`'s
  validation branch** (prefix-strategy-requires-prefix-length) or for
  `import_mapping_profiles`'s `created_by` population (currently always
  `NULL` on insert — no established "populate from caller's session"
  precedent exists elsewhere in this codebase to follow, so it was left
  rather than inventing one unreviewed).
- **`packages/02-app-shell` gained two more implicit-via-hoisting
  dependencies during this package** (`next` for `EstimateTable.tsx`'s
  `useRouter`, and `react-test-renderer`/`@types/react-test-renderer`
  for the field-sync regression tests) — the `next` one was not
  explicitly declared in `package.json` (works today via monorepo
  hoisting, flagged by review as a Minor finding, not fixed); `react-test-renderer`
  was explicitly declared but is itself deprecated upstream in favor of
  `@testing-library/react`.

## Relevant files

- `schema/013_estimating_and_qb_import.sql` / `_down.sql`
- `supabase/migrations/20260113000000_estimating_and_qb_import.sql`
- `tests/sql/package_p4_estimating_qb_import_tests.sql`
- `packages/02-app-shell/src/services/{budget,costCode,importMapping,import}Service.ts`
- `packages/02-app-shell/src/components/{EstimateTable,MappingProfileForm,ImportWizard}.tsx`
- `apps/web/app/admin/estimate/{page.tsx,actions.ts,costCodeActions.ts}`
- `apps/web/app/admin/import/{page.tsx,mappingActions.ts,confirmActions.ts}`
- `apps/web/app/api/imports/parse/route.ts`
- `apps/web/src/server/imports/parseQuickBooksCsv.ts`
- `apps/web/test/{estimate_actions_unit,import_parse_unit}.ts`
- `packages/02-app-shell/test/estimateTable_field_sync.tsx`
- `tests/fixtures/quickbooks/sample_job_cost_export.csv`
- `scripts/db/live-p4-checkpoint.mjs`
- `docs/production-build/P4-DESIGN.md` (authoritative design record)
- `docs/production-build/FINANCIAL-ARCHITECTURE.md`, `AI-ASSISTANT-ARCHITECTURE.md` (cross-package constraints this package satisfies)
- `docs/superpowers/plans/2026-08-06-p4-estimating-budgeting-qbimport.md` (execution plan)
- `docs/production-build/PRODUCTION-ROADMAP.md` (P4 section)

## Recommended next package

**P5 — Commitments, Bids (PM-side), Procurement & Material Orders**
(`docs/production-build/PRODUCTION-ROADMAP.md`). `committed_costs` is
already schema-hardened and unexercised by any UI, matching this
package's own starting position before P4. Per
`FINANCIAL-ARCHITECTURE.md`, P5 needs only new tables (`bid_packages`,
`bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`,
`material_order_line_items`) referencing the existing backbone — no
restructuring of `budget_ledger`/`expenses`/`committed_costs`/
`cost_codes`. Do not start P5 without explicit approval, per the
standing project rule in `CLAUDE.md`.

## Starter prompt for a fresh Claude Code session

```
Read docs/milestones/P4-complete.md and docs/production-build/P4-DESIGN.md
for full context on what P4 shipped (tag p4-complete). Then read
docs/production-build/PRODUCTION-ROADMAP.md's P5 section (Commitments,
Bids, Procurement & Material Orders) and
docs/production-build/FINANCIAL-ARCHITECTURE.md for the cross-package
constraint P5 must satisfy. Do not start implementing P5 yet — summarize
your understanding of P5's scope and open questions, and wait for
explicit approval before writing any code.
```
