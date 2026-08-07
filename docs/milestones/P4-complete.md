# P4 — Estimating & Budgeting UI + QuickBooks Desktop Import — Complete

**Status:** Complete
**Commit range:** `906f99c`..`6b8c988` (design/plan through the final whole-branch review's last fix round; see `.superpowers/sdd/2026-08-06-p4-estimating-budgeting-qbimport/progress.md` for the complete ledger)
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
  (`packages/02-app-shell/src/imports/parseQuickBooksCsv.ts` — moved
  here from `apps/web/src/server/imports/` by the final-review fix wave
  below, prefix/exact/
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

Final state, after the whole-branch review's fix rounds, re-run clean
from a fresh `npm ci`:

```
npm ci
npm run typecheck    # 3/3 workspaces clean
npm run test         # every suite green, including two previously-
                      # orphaned unit test files (estimate_actions_unit.ts,
                      # import_parse_unit.ts, 23/23) now actually wired into
                      # the chain for the first time (Task 12 Step 0 — they
                      # existed since Tasks 4/8 but had never run
                      # automatically until this closeout), and
                      # apps/web/test/route_smoke.ts now also covering
                      # /admin/estimate and /admin/import (added during the
                      # final review's fix wave, once nav-wiring made them
                      # reachable)
npm run build         # clean; /admin/estimate, /admin/import,
                      # /api/imports/parse all registered
node scripts/db/run-sql-tests.mjs   # 20 SQL files (14 migrations +
                      # 6 test suites — schema/014 added during the final
                      # review's fix wave) applied/passed against PGlite
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

### Final whole-branch review (after all 12 tasks merged)

Dispatched on the most capable available model specifically to catch
cross-task integration issues no single task's reviewer could see.
Found no Critical issues — every architectural constraint
(`FINANCIAL-ARCHITECTURE.md`'s backbone, `AI-ASSISTANT-ARCHITECTURE.md`'s
DI-seam pattern) held under inspection, and a repo-wide grep confirmed
zero P5/P6 scope creep. It found one genuine, serious cross-task defect
per-task review structurally could not have caught:

- **`Amount` was parsed three incompatible ways across three files**
  (the CSV parser stripped currency symbols/commas before converting to
  cents; the confirm RPC cast the raw string straight to `numeric`,
  which throws on `"$1,250.00"`; the reconciliation function did
  `Number()` on the same string, silently producing `NaN` → 0). This
  would have failed on QuickBooks Desktop's own default export format —
  a format neither the fixture data nor the live checkpoint had
  exercised. Fixed by canonicalizing `Amount` into signed integer cents
  exactly once (the Route Handler), with every downstream reader using
  that same value. A parenthesized-negative parsing bug
  (QuickBooks' credit-amount convention) was fixed at the same time.

Three more Important findings, all fixed in the same pass: the import
Route Handler was the one mutation path without a DI-seam service
function (extracted into `stageImportBatch()`, at the human's explicit
choice over documenting it as an exception — this required relocating
`parseQuickBooksCsv.ts` into `packages/02-app-shell` since packages may
never depend on `apps/web`); `/admin/estimate` and `/admin/import` had
no navigation entry and were unreachable from the running app; the
import Route Handler could resolve an item to an archived cost code
that the wizard's own dropdown would then have no option for.

**The fix wave's own re-review** (per the process's one-fix-wave,
one-scoped-re-review cap) found two further Important issues in the
fix itself: the import review screen displaying raw integer cents
instead of formatted dollars, and the new migration's `Amount`-format
change having no documentation of its (narrow, currently unreachable)
blast radius on any pre-existing staged data. Per the review process's
adjudication rule, these were presented to the human rather than
absorbed into an unbounded third round; the human chose one more small,
targeted fix rather than deferring — both were resolved and verified
clean by a final scoped re-review before this milestone was tagged.

## Unresolved decisions

None — this package's schema/UI decisions were all made explicitly
during design (`P4-DESIGN.md`'s "Decisions made" section) and none were
left open during implementation.

## Final-review fix wave (post-completion)

Before tagging `p4-complete`, a whole-branch final review across all 12
merged tasks found five real defects that had shipped clean through
every individual task review (each defect was invisible from within any
single task's diff — all five were only visible once the whole package
was read as one unit). Fixed in one pass; full detail, the exact
Amount-canonicalization approach taken and why, and test output:
`.superpowers/sdd/2026-08-06-p4-estimating-budgeting-qbimport/final-review-fix-report.md`.

1. **`Amount` was parsed three incompatible ways** across
   `parseQuickBooksCsv.ts`, `confirm_import_batch()`, and
   `getImportBatchReconciliation()` — the RPC's version threw outright
   on QuickBooks' own common currency-formatted export values
   (`"$1,250.00"`), and a parenthesized-negative credit (`"(500.00)"`)
   silently lost its sign in all three. Fixed by canonicalizing Amount
   exactly ONCE, in `parseQuickBooksCsv()`
   (now `packages/02-app-shell/src/imports/parseQuickBooksCsv.ts`), into
   a signed integer number of cents (`ParsedImportRow.amountCents`);
   every writer/reader downstream (`stageImportBatch()`,
   `confirm_import_batch()` per schema/014,
   `getImportBatchReconciliation()`) now stores/reads that one canonical
   value, never re-parsing a decimal string. `schema/014_import_
   amount_canonicalization_and_audit_attribution.sql` updates the RPC
   (a new migration, not an amendment to 013, since 013 had already been
   applied to the hosted dev project this session).
2. **The `/api/imports/parse` Route Handler's ~120 lines of business
   logic had no service function** — the one mutation path in P4 that
   didn't follow the DI-seam pattern every other task used. Extracted
   into `stageImportBatch()`
   (`packages/02-app-shell/src/services/importService.ts`); the Route
   Handler is now a thin adapter (parse multipart body, authenticate,
   call the service, return JSON). This also required moving
   `parseQuickBooksCsv.ts` itself from `apps/web` into
   `packages/02-app-shell` — it's pure, dependency-free logic a
   packages-layer service function needs, and `packages/*` must never
   depend on `apps/web` (the reverse direction).
3. **`/admin/estimate` and `/admin/import` were unreachable from the
   running application** — no nav entry, and both rendered with
   `activeKey="financials"` (highlighting the wrong tab). Added real nav
   entries (`adminNav` in `packages/02-app-shell/src/nav/navigation.ts`,
   `ADMIN_PATH` in `apps/web/src/shell/AdminChrome.tsx`) with correct
   `activeKey`s, and both routes to `apps/web/test/route_smoke.ts`.
4. **The Route Handler's cost-codes query had no `is_archived` filter**,
   so an item could auto-resolve to an archived cost code the wizard's
   override `<select>` (fed from the repository's own
   `is_archived = false`-filtered `getCostCodes()`) had no matching
   `<option>` for. Fixed by adding the same filter to
   `stageImportBatch()`'s query.
5. **`import_batches.imported_by` and `expenses.created_by` were never
   populated** on the import path. Fixed: the Route Handler now passes
   its already-resolved acting user's id into `stageImportBatch()` for
   `imported_by`; `confirm_import_batch()` (schema/014) now sets
   `created_by = auth.uid()` on the expenses it creates.

## Known limitations

- **Overriding an `error`-status import row only fixes its resolved
  cost code, not the underlying malformed Amount/Date.**
  `confirm_import_batch`'s guard only checks `match_status`, so a row
  overridden out of `error` status can still reach the RPC's
  `(raw_data->>'Amount')::bigint` cast (schema/014 — previously
  `::numeric`, changed by the final-review Amount-canonicalization fix
  above; either way, an unparseable source value fails this cast) and
  fail with a raw Postgres error string instead of a clear application
  message. Confirmed for real by the live checkpoint (this is the
  documented, expected behavior today, not a bug discovered late — Task
  11's review flagged it, and the live checkpoint proved it happens
  exactly as predicted). A future improvement: steer the UI toward
  "Exclude" rather than "Override" for `error`-status rows, or
  re-validate Amount/Date before allowing the override.
- **schema/014's Amount-format change has a narrow, currently-unreachable
  silent-corruption edge case, not fixed with a runtime guard.**
  `import_rows.raw_data->>'Amount'` meant a raw CSV decimal-dollar
  string (e.g. `"1200.00"`) before schema/014, and means an
  already-computed signed-integer-cents string (e.g. `"120000"`) after.
  A pre-migration row that was a bare integer with no decimal point
  (e.g. `"1200"` — unusual but possible from a QuickBooks export) would,
  if confirmed post-migration, silently cast to 1,200 cents instead of
  $1,200.00 via `confirm_import_batch`'s `::bigint` cast — a 100x error.
  Any old-format value with a decimal point instead fails that cast
  loudly and safely (bigint's input syntax rejects decimal points), so
  this is genuinely narrow. No runtime format-version detection was
  added: this is P4's first ship (no real Stone Column usage exists
  yet), the only known `import_rows` data anywhere is the dev
  checkpoint's own already-confirmed test batch, and
  `confirm_import_batch`'s idempotency guard (added during Task 10's
  review) already blocks that specific batch from ever being
  re-confirmed — building a detection mechanism for a risk that's
  currently unreachable was judged not worth the added complexity. See
  the comment directly above `confirm_import_batch` in
  `schema/014_import_amount_canonicalization_and_audit_attribution.sql`
  for the full note; re-validate this assumption before ever
  resurrecting/re-staging pre-migration `import_rows` for confirmation.
- ~~Duplicate-against-existing-expense detection uses the raw,
  unnormalized CSV date string~~ — **fixed in a post-closeout pass.**
  `parseQuickBooksCsv.ts` now has a `parseQuickBooksDate()` function,
  following the exact pattern already established by
  `parseAmountToCents()`: the ONE place Date is ever parsed from a
  source file's own formatting, recognizing strict ISO (`YYYY-MM-DD`)
  and QuickBooks Desktop's default `MM/DD/YYYY`/`M/D/YYYY` export
  convention, with real calendar validation (rejects month 13, day 32,
  Feb 30th, etc. — not just a regex shape match), returning a canonical
  `YYYY-MM-DD` string or `null`. `ParsedImportRow.canonicalDate` carries
  this value; the duplicate-detection key construction and
  `stageImportBatch()`'s persisted `raw_data.Date` both use it instead of
  the raw CSV string, and a row whose date fails to parse now produces
  `matchStatus: 'error'` with a message that distinguishes an amount
  failure from a date failure. `confirm_import_batch()`'s
  `(raw_data->>'Date')::date` cast in schema/014 needed no change:
  Postgres's ISO date-input parsing is unambiguous regardless of the
  session's `DateStyle`, verified directly against a real Postgres
  instance (`'2026-08-15'::date` and `'08/15/2026'::date` both resolve
  to August 15 under the default `ISO, MDY` `DateStyle`, but under `ISO,
  DMY` the ISO-formatted literal still resolves to August 15 while the
  slash-formatted one throws — proving only the ISO form is
  order-independent), so no new migration was needed. Regression
  coverage: `apps/web/test/import_parse_unit.ts` (ISO vs. `MM/DD/YYYY`
  resolving identically, in-file cross-format duplicates, invalid
  calendar dates rejected, a simulated cross-batch/cross-format
  duplicate against a canonical `existingExpenseKeys` entry, and a
  negative control proving a genuinely different date is NOT flagged a
  duplicate). The live checkpoint
  (`scripts/db/live-p4-checkpoint.mjs`) now proves the cross-batch
  scenario end-to-end against the real hosted dev project: it stages and
  confirms one batch with an ISO date (posting a real `expenses` row
  with a real `transaction_date`), then stages a second, separate batch
  reporting the same underlying transaction with its date written in
  `MM/DD/YYYY` — and confirms that row is now correctly flagged
  `duplicate` against the real posted expense, with a same-vendor/
  same-amount/different-date row in the same batch correctly staying
  `new` as a negative control. All 27/27 live checkpoint checks passed
  against the real hosted Supabase dev project.
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
- `schema/014_import_amount_canonicalization_and_audit_attribution.sql` / `_down.sql` (final-review fix wave)
- `supabase/migrations/20260113000000_estimating_and_qb_import.sql`
- `supabase/migrations/20260114000000_import_amount_canonicalization_and_audit_attribution.sql` (final-review fix wave)
- `tests/sql/package_p4_estimating_qb_import_tests.sql`
- `packages/02-app-shell/src/services/{budget,costCode,importMapping,import}Service.ts` (`importService.ts` now also exports `stageImportBatch()`, added in the final-review fix wave)
- `packages/02-app-shell/src/imports/parseQuickBooksCsv.ts` (moved here from `apps/web/src/server/imports/` in the final-review fix wave, so a packages-layer service function can call it without `packages/*` depending on `apps/web`)
- `packages/02-app-shell/src/nav/navigation.ts` (`adminNav` gained `estimate`/`import` entries in the final-review fix wave)
- `packages/02-app-shell/src/components/{EstimateTable,MappingProfileForm,ImportWizard}.tsx`
- `apps/web/app/admin/estimate/{page.tsx,actions.ts,costCodeActions.ts}`
- `apps/web/app/admin/import/{page.tsx,mappingActions.ts,confirmActions.ts}`
- `apps/web/app/api/imports/parse/route.ts` (thin adapter as of the final-review fix wave)
- `apps/web/src/shell/AdminChrome.tsx` (`ADMIN_PATH` gained `estimate`/`import` entries in the final-review fix wave)
- `apps/web/test/{estimate_actions_unit,import_parse_unit,route_smoke}.ts`
- `packages/02-app-shell/test/estimateTable_field_sync.tsx`
- `tests/fixtures/quickbooks/sample_job_cost_export.csv`
- `scripts/db/live-p4-checkpoint.mjs`
- `.superpowers/sdd/2026-08-06-p4-estimating-budgeting-qbimport/final-review-fix-report.md` (final-review fix wave — full detail)
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
