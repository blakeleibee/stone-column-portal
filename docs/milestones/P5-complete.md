# P5 — Commitments, Bids (PM-side), Procurement & Material Orders — Complete

**Status:** Complete (including P5.0 and P5's own Task 11, folded into this same closeout)
**Commit range:** `32e0a8f`..`9ccc3c0` (Task 1 through Task 11), with P3/P3.1's own work interleaved and merged in at `ea3ca8b` (see "What shipped" below for why the range isn't purely linear); `66ca862`..`<this doc's own commit>` is this closeout itself
**Tag:** `p5-complete`
**Completed:** 2026-09-09
**Branch:** `main` (merged from `p5-commitments-bids-procurement`)

## Scope

Real UI for `committed_costs` (schema-hardened since P1, never exercised by any screen before this package); PM-facing bid packages (create, publish, invite, record submissions, award, Q&A, addenda); PM-facing material orders (create, line items with per-line cost-code allocation, commit, receive, backorder); versioned, immutable PO/subcontract PDF issuance. Full design record: `docs/production-build/P5-DESIGN.md` (Revision 3). Implementation plan (12 tasks): `docs/superpowers/plans/2026-08-14-p5-commitments-bids-procurement.md`.

**Two mid-package corrections became their own small packages, folded into this same closeout rather than left as a separate future item:**
- **P5.0 (Project-Context Write-Safety)** — a live owner preview after Task 10 found that a shared project-selection function silently defaulted to whichever project sorted first alphabetically whenever nothing was explicitly chosen. This wasn't just a display gap: it meant a create action could land under a project nobody chose. Fixed before Task 11/12 ran, so P5's own final verification wasn't itself run against a session with the same defect live.
- **Task 11 and Task 12**, originally scheduled to run consecutively at the end of the plan, were resequenced to run immediately after P5.0 rather than after four newly-proposed follow-on packages (P5.1–P5.4, see below) — an owner sequencing decision, not a scope change.

**Explicit exclusions, honored throughout:** no vendor-facing UI of any kind (RLS is built and tested — see Known limitations — but no screen renders to a `vendor`-role session); no P4.1 (cost-code children) work of any kind, despite repeated adjacent opportunity; no P6 (Billing/Draws) work.

## What shipped

- **Schema** (`schema/015_commitments_bids_procurement.sql` + down, `schema/016_project_staff_access_foundation.sql`'s RLS swap to `is_financial_staff()`): `bid_packages`, `bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`, `material_order_line_items`, `vendor_members`, `issued_documents`. RPCs: `award_bid()` (single commitment + auto-decline every sibling submission), `commit_material_order()` (one `committed_costs` row per distinct cost code among a multi-cost-code order's line items, returned as an explicit mapping — never assumed from row count alone), `issue_document()` (claim-old/insert-new/link versioning, immutable after insert). Anti-spoofing triggers on `vendor_members` (org-match, `revoked_by` must equal the acting session's own `auth.uid()`) and `bid_questions` (`recorded_by` must equal the acting session's own `auth.uid()` for staff-recorded rows). `is_invited_vendor_for_bid_package()`/`is_vendor_member()` helpers extend P3's vendor-identity foundation without redefining it.
- **Bid packages** (`packages/02-app-shell/src/services/bidService.ts`, `BidPackageWorkspace.tsx`, `/admin/bids`): create/publish/invite/record-submission/award/ask-answer-question/issue-addendum, all real persisted operations. "Issue Subcontract" (originally a Task-6 placeholder correctly deferred pending Task 8's service and Task 10's PDF route) is now fully wired: real issue/reissue, version state re-fetched on every load, a working PDF link.
- **Commitments** (`CommitmentsTable.tsx`, `/admin/commitments`): groups multi-cost-code material-order commitments under one caption by `sourceId`, resolves cost codes to human-readable codes, shows vendor/source/amount/status.
- **Material orders** (`procurementService.ts`, `documentIssuanceService.ts`, `MaterialOrderWorkspace.tsx`, `/admin/procurement`): create/add-line-item (cost code required per line, never inherited from an optional order-level default)/commit/receive/backorder. Post-commit line items are frozen except `received_quantity`/`backordered` — enforced at the database level, verified directly (Step 3 below).
- **PDF issuance** (`packages/02-app-shell/src/pdf/*`, `apps/web/app/api/{bids/[bidPackageId]/subcontract-pdf,procurement/material-orders/[id]/pdf}/*`): `@react-pdf/renderer` (exact-pinned `3.4.5` — 4.x is ESM-only and breaks under this repo's `tsx`-run tests), a template-version-keyed renderer registry so a historical version always renders under the exact template that produced it, Node runtime, clean 403/404/500 JSON on auth failure/missing record/render failure.
- **P5.0** (`apps/web/src/server/project/{resolveSelectedProject,assertProjectAccess}.ts`, `NoProjectSelected.tsx`): no silent first-project fallback; an explicit "select a project" state on every affected screen; server-side re-validation of the target project before `createBidPackage`/`createMaterialOrder`/`enterOriginalBudget`/`adjustBudget` ever write; the target project named directly on create buttons; a more prominent current-project header.
- **Task 11** (`actionCenterQueries.ts`): `getOverdueBidPackages()`, `getBackorderedMaterialLineItems()` — real, RLS-scoped, registration-only (no live screen wiring, per the task's own title).
- **Navigation/mobile fixes along the way**: Organization-vs-Current-Project sidebar grouping (small, owner-requested pre-Task-10 correction); Bids/Material Orders two-column layout now stacks cleanly at 390px (two compounding root causes: a missing `flex-direction: column` breakpoint, and `align-items: flex-start` silently switching from a harmless vertical-alignment property to a width-constraining one once stacked — plus a third, narrower flexbox min-width issue in the detail header, all found via empirical browser measurement, not assumption).

## Tests run

Final state, from a fresh `npm ci`, 2026-09-09:

```
npm ci                # clean install, no lockfile drift
npm run typecheck     # 3/3 workspaces clean
npm run test          # 26 suites, every one green, including:
                      #   - action_center_queries_unit.ts (14, new)
                      #   - resolveSelectedProject_unit.ts (9, new)
                      #   - bidPackageWorkspace.tsx (16), materialOrderWorkspace.tsx (39)
                      #   - commitmentsTable_grouping.tsx (13)
                      #   - pdf_routes_integration.ts (18)
                      #   - procurement_actions_unit.ts (17), route_smoke.ts (66)
                      #   - every P3/P3.1/P4 suite, unregressed
npm run build         # clean; 27/27 routes generated, both PDF routes
                      # present, both write-safety-guarded actions present
```

## Live checkpoint

Extended `scripts/db/live-p5-task9-checkpoint.mjs`'s pattern (a fresh, real signup → real org/project/cost-codes, run against the real hosted dev Supabase project, never service-role for anything a real user flow does) with new coverage for `vendor_members`, `issued_documents` versioning/supersession, and `award_bid()`'s single-commitment/auto-decline behavior:

```
41/41 checks passed, including:
- vendor_members insert, org-match trigger, revoke/reactivate, revoked_by anti-spoof, no-hard-delete
- issued_documents second version + supersession chain, both carrying template_version
- award_bid(): exactly one committed_costs row, sibling submission auto-declined
- commit_material_order(): two-cost-code order producing two committed_costs rows,
  correctly paired via the RPC's own returned mapping
```

**Full manual golden-path re-walk**, against real hosted dev, real authenticated sessions throughout (never service-role for a user-flow check) — every scenario Revision 3's design specified:

```
84/84 real assertions passed across 7 scenarios:
1. Bid package -> 2 vendors -> 2 submissions -> award -> sibling auto-decline: PASS
   (exactly 1 committed_costs row; the sibling submission's status is 'declined')
2. Material order, 2 cost codes, RPC mapping, /admin/commitments grouping: PASS
   (direct RPC call verified row-by-row against the DB; the real repository/
   grouping function /admin/commitments actually uses collapses both into one group)
3. Post-commit edit rejection / received_quantity+backordered still writable /
   getBackorderedMaterialLineItems (Task 11) returns the correct costCodeId: PASS
4. PO issued twice, versioning, ?version=1 still correct after live data changed: PASS
   (real HTTP against a real running dev server; V1=2115 bytes, V2=2269 bytes --
   distinct rendered content, confirmed via the frozen canonical_data snapshot
   and the route's own version-dispatch code path)
5. Second real vendor login on the same vendors.id, identical reads, revoke
   (immediate loss of access for the revoked member only), reactivate
   (access returns): PASS
6. bid_questions.recorded_by spoofing (a different real user's id): rejected
   verbatim by the trigger: PASS
7. A real client-role session AND a real vendor-role session hitting either
   PDF route: clean 403 JSON, never a 500, for both roles: PASS
```

Every one of the twelve acceptance criteria in `P5-DESIGN.md` Revision 3 has direct, real evidence from this pass — not inferred from unit tests alone.

## Independent review

Every task went through the same subagent-driven-development process established since P4: a fresh implementer, an independent adversarial reviewer, and a fix-and-re-verify loop when the reviewer found something real.

**Real defects found and fixed, by task:**
1. **Task 1** (migration 015): three actor-provenance spoofing gaps (fixed before Task 2 began — `vendor_members.revoked_by`, `bid_questions.recorded_by`, a third provenance field), an RLS recursion between `bid_packages` and `bid_submissions` (broken by restructuring the policy, not by weakening it).
2. **Task 6** (`/admin/bids`): a style-tag hydration mismatch, found during the owner's own live preview of the screen (the same `<style dangerouslySetInnerHTML>` vs. raw `<style>{...}</style>` class of bug found and fixed repeatedly across this whole engagement).
3. **Task 7** (`/admin/commitments`): zero defects found.
4. **Task 8** (material order + document issuance services): zero implementation defects; two test-coverage gaps (`commitMaterialOrder` had no dedicated test; an over-quantity rejection test wasn't actually asserting the write was skipped) — both fixed, re-verified.
5. **Task 9** (`/admin/procurement`): zero confirmed defects; three minor/plausible notes logged and deliberately deferred (a dead unused type, expected live-checkpoint-script residue matching P4's own precedent, one untested display path), matching this plan's own established "log minors, don't chase every one" convention.
6. **Task 10** (PDF routes + Issue Subcontract/PO-link wiring): one real, moderate-severity defect — `MaterialOrderWorkspace`'s issued-PO state was populated only inline after a successful issue click, and reset to `null` on every reselect, so the "Purchase Order issued" banner and PDF link silently vanished on navigating away and back or reloading the page, and the button never relabeled to "Reissue," risking a confused admin silently creating a duplicate PO version. Fixed by mirroring `BidPackageWorkspace`'s already-correct pattern (re-fetch issuance state on every load, not just post-click). Everything else — the react-pdf version pin, the `route.ts`/`handler.ts` split (verified empirically required by Next.js's build-time route-type validation, not unnecessary), the dependency-injection test seam, the Buffer/Uint8Array handling — passed adversarial review cleanly on the first pass.
7. **Mobile-stacking fix** (post-Task-10 owner preview): the reviewer's own empirical measurement (not just reading the stylesheet) found the real, layered root cause was two compounding issues, not one — caught and fixed in a second pass after the first fix alone only partially closed the gap.
8. **P5.0**: zero defects. Independent review included a real attempt to write into a project the acting session didn't own — rejected both by the new application-level check and, independently, by the database's own row-level security, confirming genuine defense-in-depth rather than a single point of protection.
9. **Task 11**: zero defects. Independent review deliberately broke each function's filter logic one at a time and confirmed the corresponding test actually failed, proving the tests are real rather than tautological.

**No defect shipped silently** — every finding above was fixed and re-verified before its task was accepted.

## Unresolved decisions

None from P5's own design — every schema/UI decision was made explicitly during Revision 3 and none were left open during implementation. Four follow-on packages (P5.1–P5.4) were proposed, independently reviewed, and owner-approved during this same period, in response to a live owner preview's feedback — see `docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md`. They are **not** part of P5's own scope or acceptance criteria; P5 is complete independent of whether they're ever built.

## Known limitations

- **No vendor-facing UI exercise of the new RLS until P5.2/P11** — though revocation/reactivation, anti-spoofing, and the invited-vendor double-gate are real, callable, and directly tested against real hosted data (see the live checkpoint above), no screen anywhere calls them from an actual `vendor`-role session yet. A real, latent gap was also found and documented (not fixed in P5, since no vendor UI exists to trigger it): `inviteVendor()` never creates the `project_members` row `is_project_vendor()` requires, so a real vendor session invited today would currently be denied read access to the bid package itself. This is scoped as P5.2's own first fix (`P5-EXTENSION-PACKAGES-DESIGN.md` Section 5, Part A) — it must land before any vendor-facing screen ships, not before P5 itself closes.
- **No persisted PDF bytes, only canonical-data snapshots plus `template_version`** — P5's reproducibility guarantee is content/layout-equivalent, not byte-identical (Decision 4). A future package that needs a permanently-stored rendered file (e.g., for an external audit trail requiring the exact original bytes) needs new work, not a P5 extension.
- **Single-cost-code-per-bid-package** (Decision 1, unchanged) and **single-award-per-package** (Decision 6, unchanged) — both deliberate v1 simplifications, not defects.
- ~~No mechanism to end a `vendor_members` link~~ — **closed.** Revoke/reactivate is real, trigger-enforced, and directly verified in this closeout's live checkpoint (Step 2 above).
- **Checkpoint-script residue in hosted dev, same known class as `live-p4-checkpoint.mjs`'s own documented limitation**: this closeout's extended checkpoint script left one org/project/admin-user behind in hosted dev (`auth.admin.deleteUser` failed silently) — harmless noise, not a data-integrity issue, and not cleaned up here, consistent with how P4's own equivalent residue was handled (documented, not chased). A future checkpoint-script cleanup pass across all packages' scripts, not just P5's, would be the right place to fix this class of issue once, not per-package.
- **Two near-identically-named test projects exist in the hosted dev org** ("CDP Smoke Test `<timestamp>`" x2) — a data-hygiene artifact from this package's own live verification work, not a code defect (P5.0 fixes the *application* behavior that made this confusing; the duplicate-named test data itself is still there). Worth a manual cleanup pass whenever hosted dev's test data is next groomed, not urgent.
- **P5.1–P5.4 remain fully unbuilt** — vendor directory/onboarding, real vendor-facing bidding, material-order collaboration/documents, and deeper financial cross-navigation are all designed and approved but not started. See `docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md` for the full design and the owner's six final decisions on email provider, sensitive-document handling, inbound-email correspondence routing, and material-order vendor-visibility UX.

## Relevant files

- `schema/015_commitments_bids_procurement.sql` / `_down.sql`, `schema/016_project_staff_access_foundation.sql` (RLS swap to `is_financial_staff()`)
- `tests/sql/` — migration 015's SQL/RLS test suite
- `packages/02-app-shell/src/services/{bidService,procurementService,documentIssuanceService,committedCostService,actionCenterQueries}.ts`
- `packages/02-app-shell/src/pdf/{MaterialOrderPdf,SubcontractPdf,pdfRenderer,templateVersions}.tsx`
- `packages/02-app-shell/src/components/{BidPackageWorkspace,MaterialOrderWorkspace,CommitmentsTable,NoProjectSelected}.tsx`
- `apps/web/app/admin/{bids,commitments,procurement}/*`
- `apps/web/app/api/{bids/[bidPackageId]/subcontract-pdf,procurement/material-orders/[id]/pdf}/*`
- `apps/web/src/server/project/{resolveSelectedProject,assertProjectAccess,resolveProjectAndSwitcherData}.ts`
- `apps/web/test/{procurement_actions_unit,pdf_routes_integration,resolveSelectedProject_unit,route_smoke}.ts`
- `packages/02-app-shell/test/{commitmentsTable_grouping,materialOrderWorkspace,bidPackageWorkspace,action_center_queries_unit}.tsx`
- `scripts/db/live-p5-task9-checkpoint.mjs` (this closeout's own extended checkpoint was scratch-only, per the established "never commit a one-off verification script" convention — the committed script remains Task 9's; a future package extending live-checkpoint coverage further should follow the same pattern this closeout used)
- `docs/production-build/P5-DESIGN.md` (authoritative design record, Revision 3)
- `docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md` (P5.0–P5.4, owner-approved, not yet built except P5.0/Task 11 which are folded into this closeout)
- `docs/production-build/FINANCIAL-ARCHITECTURE.md`, `AI-ASSISTANT-ARCHITECTURE.md` (cross-package constraints this package satisfies)
- `docs/superpowers/plans/2026-08-14-p5-commitments-bids-procurement.md` (execution plan, all 12 tasks)
- `docs/production-build/PRODUCTION-ROADMAP.md` (P5, P5.0–P5.4, P11 sections)

## Recommended next package

**P5.1 — Vendor Directory & Onboarding** (`docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md`, Section 5), per the owner-approved sequence — not P6. Org-level vendor management (company/legal name, active/inactive, trades, contacts, compliance documents, payment terms, notes, history, duplicate detection) closes a real, high-priority gap: today there is no way to create a vendor anywhere in the running application. P5.1 has no dependency on P5.2/P5.3/P5.4 and is foundational for all three. Do not start P5.1 without explicit approval, per the standing project rule in `CLAUDE.md`.

## Starter prompt for a fresh Claude Code session

```
Read docs/milestones/P5-complete.md (tag p5-complete) for full context
on what P5, P5.0, and P5's own Task 11 shipped. Then read
docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md in full --
Section 5's "P5.1 -- Vendor Directory & Onboarding" subsection is the
approved design for the next package, and Section 9 records the
owner's six final decisions on the packages after it (email provider,
sensitive-document handling, inbound-email correspondence, material-
order vendor-visibility UX) for later context. Do not start
implementing P5.1 yet -- summarize your understanding of its scope and
confirm the plan before writing any code.
```
