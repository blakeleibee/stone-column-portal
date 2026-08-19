# Package P3 — Project & Staff Access Foundation

**Status: Approved for implementation (2026-08-19).** Pulled forward
ahead of P5 Task 7 by explicit owner decision, after
`PRODUCT-VISION.md`/`PRODUCT-COMPLETENESS-MATRIX.md`/
`OWNER-PREVIEW-CHECKLIST.md` were approved in principle, independently
reviewed for authorization/migration risk (findings incorporated — see
below), and its two remaining open owner decisions resolved (see
"Owner decisions — resolved"). Implementation proceeds via the
companion plan and the subagent-driven-development process; P5 Task 7
remains blocked until P3 is complete and previewed. This document
**is** `PRODUCTION-ROADMAP.md`'s Package P3 ("Production project
foundation") — it supersedes that section's placeholder text with a
full exact-scope design, the same way `P1-DESIGN.md` etc. did for
their packages, and closes `PRODUCT-COMPLETENESS-MATRIX.md`'s Section
C gap #2 (no P2/P3 design doc existed) and Section E gap #1 (old
Package 3 naming). It deliberately does **not** take on old Package
3's thin-Leads/thin-Templates/backup-baseline scope, or roadmap P2's
invitations/decision-maker scope — see Exclusions.

**Working title match:** the owner named this interlude "Project &
Staff Access Foundation." That is this document's subtitle; the
package number is **P3**, because its core (real project CRUD/
lifecycle, team assignment, vendor-RLS-remainder) is exactly what
`PRODUCTION-ROADMAP.md` already reserved P3 for. The `staff_function`/
audit-log correction is a net-new addition to P3's scope, justified
directly by `SECURITY-AND-PERMISSIONS-MATRIX.md`'s own recommendation
that it land "no later than P3."

## Goal

Replace every fixture-bound or hardcoded project reference in the
running application with a real, RLS-backed accessible-project model:
create, list, select, and switch between real projects; assign staff
and clients to them; and correct the staff-role authorization gap
(`PM`/`Superintendent`/`Accounting` are all currently the undifferentiated
`staff` role) that today lets any staff account read every project's
full financial audit trail. `packages/01-financial-engine`,
`FINANCIAL-ARCHITECTURE.md`'s backbone, and every already-shipped P4/P5
table, RPC, and service function are used exactly as they are today —
this package changes **which project a screen loads and who is allowed
to load it**, never what the financial engine computes.

## Pre-work performed before this design (per owner instruction)

1. **Fresh off-device bundle**: `stone-column-portal-20260819-pre-p3-project-staff-access.bundle`
   (OneDrive, `--all` branches/tags), created and verified
   (`git bundle verify` — "records a complete history," 9 refs, tip
   `a3f0bdf`) before any P3 work began. Does not overwrite any prior
   bundle.
2. **Branch/commit strategy**: a new branch,
   `p3-project-staff-access-foundation`, was created from the current
   tip of `p5-commitments-bids-procurement` (`a3f0bdf`) — **not** from
   `p4-complete` — because this package must update P5 Tasks 1–6's
   already-shipped code (services, `BidPackageWorkspace`, `/admin/bids`)
   to use a real selected project, so it needs that code present.
   `p4-complete` (`930c6ef`) is untouched and stays exactly where it is.
   Once P3 is implemented, reviewed, and approved, this branch merges
   back into `p5-commitments-bids-procurement` (a fast-forward, since
   history is linear) before P5 Task 7 resumes there. A new tag,
   `p3-complete`, is added at that merge point, matching the existing
   `p0-complete`/`p1-complete`/`p2.1-complete`/`p4-complete` convention.
3. **Genuine owner decisions**: identified below (§ Decisions), each
   with a recommended default and the practical tradeoff, per standing
   product-development instructions.

## Research findings this design is built on

(Full detail available on request; summarized here so every schema/RLS
choice below is traceable.)

- `projects.status` (`draft|active|on_hold|closed_out|archived`)
  already exists with an enforced transition trigger
  (`enforce_project_status_transition`, schema/008) — archival is a
  real, terminal, already-guarded state. No new status mechanism
  needed.
- `project_members` is CHECK-constrained to `member_role in ('client','vendor')`
  only — by original, documented design, staff/admin access has always
  been **org-wide**, never per-project. That is exactly the gap this
  package closes for `project_manager`/`superintendent`; `project_members`
  itself is not touched.
- `is_org_staff(p_project_id)` is the single choke point roughly two
  dozen RLS policies already call. Modifying its body (not introducing
  a parallel helper) is what makes the new access model real everywhere
  at once, rather than real in some places and stale in others.
- `projects_staff_full_access` (the `projects` table's own staff
  policy) currently calls `is_org_staff_for_org(org_id)` **directly**,
  not `is_org_staff(project_id)` — it must be explicitly rewritten to
  call `is_org_staff(id)` instead, or none of this package's
  project-list scoping takes effect on the one table that matters most
  for it.
- The service layer (`packages/02-app-shell/src/services/*.ts`) is
  already fully `projectId`-parameterized — confirmed, no exceptions
  found. This package's UI work is about supplying the *right*
  `projectId` from a real selector, never about changing service
  signatures.
- Every current admin page independently re-implements the same
  `select id from projects where org_id = ... limit(1)` "first project"
  shortcut (`/admin/financials`, `/admin/estimate`, `/admin/bids`,
  `/admin/import`), with no shared helper. `/admin/overview` and
  `/admin/projects` are worse: they call `loadAdminVM()` **unconditionally**,
  ignoring `DEMO_MODE` entirely, so they render the fixture Hawks Ridge
  project even in a real authenticated session today — a standing bug
  this package fixes as a side effect of introducing a real resolver.
  `ProjectWorkspace.tsx`'s page header also hardcodes the fixture
  project's name/address regardless of mode — same fix.
  There is no `ProjectSwitcher`/`ProjectSelector` component or real
  `/admin/projects` list anywhere today — this is a from-scratch build.
- `apply_standard_cost_code_template(project_id)` (schema/012,
  `SECURITY INVOKER`, `is_org_staff`-gated, idempotent-guarded against
  re-seeding) is the existing, real RPC for populating a new project's
  113-code/7-division structure — this package's project-creation RPC
  calls it, never reimplements it.
- `project_fee_rules` requires `fee_basis` + exactly one of
  `fee_basis_points`/`fee_fixed_amount_cents` (CHECK-enforced);
  `retainage_basis_points` defaults to `0` (not required). This table
  having **zero** rows for a project is exactly the class of bug that
  produced the live `PGRST116` error during the P5 Task 6 preview —
  this package's atomic creation flow makes that class of bug
  structurally impossible going forward.

## Independent review findings (incorporated before this design is presented for approval)

This design and its companion plan were independently reviewed by a
fresh agent, specifically for authorization correctness and migration
risk, before being presented to the owner — per the owner's explicit
instruction. The review found **two Critical findings**, both now
fixed in this document (not deferred): (1) the original
`project_staff_assignments` management policy would have let *any*
org-wide staff member — including a restricted `project_manager`/
`superintendent` — grant themselves an assignment to a project they
had no business accessing, defeating the whole model; fixed by
restricting all writes to that table to admin sessions only (Decision 1,
now stated explicitly). (2) The original plan to rewrite
`projects_staff_full_access` as a single `FOR ALL using (is_org_staff(id))`
policy collided directly with an existing, deliberate comment in
`schema/001_core_financial.sql` (lines 84–89) warning that "a self-join
against the row currently being inserted is unreliable" for exactly
this table/function pair — the `projects` policy has always been split
from `is_org_staff()`'s general pattern for this reason. Fixed by
splitting the `projects` policy per command (Decision 1) rather than
overriding that documented precedent on an unverified assumption. Also
incorporated: tightened wording on acceptance criterion 5 (the audit-log
fix does not, and was never intended to, close the two untouched,
non-financial `orgs`/`profiles`/`vendor_members` audit policies — see
Decision 5); explicit single-transaction application note for the
migration (Task 1); a diff-based down-migration verification step
(Task 1); explicit provenance enforcement for `assigned_by`, matching
the `bid_questions.recorded_by`/`bid_addenda.issued_by` precedent
(Decision 11); and an explicit clean-error check in
`create_project_with_defaults()` for the fee-basis/amount combination
before it reaches the raw CHECK constraint.

## Decisions

1. **`is_org_staff(project_id)` is modified in place, not replaced by
   a parallel helper.** It is the one real boundary ~20 existing
   policies (P1, P2.1, P4, P5) already rely on. A parallel helper used
   by only *some* tables would create exactly the inconsistent,
   partially-enforced authorization surface this package exists to
   prevent. New behavior: `admin` → always true (org-wide, unchanged).
   `staff_function in ('accounting','general')` (or legacy `NULL`,
   pre-migration) → always true (org-wide, **unchanged** from today).
   `staff_function in ('project_manager','superintendent')` → true only
   if an active (non-revoked) `project_staff_assignments` row exists
   for that profile and project.

1a. **All writes to `project_staff_assignments` (create, revoke,
   reactivate) are restricted to admin sessions only — not merely
   org-wide staff.** Found necessary during independent review:
   `is_org_staff_for_org()` (the natural-looking predicate for a
   "staff can manage" policy) does not consult `staff_function` at
   all, so it would let a `project_manager` or `superintendent` —
   whose *entire* access model depends on this table — insert a fresh
   assignment row naming themselves and any project in their org,
   silently granting themselves the exact access this package exists
   to restrict. Assigning staff to a project is treated as an
   administrative act, matching Decision 7's admin-only project-
   creation gate — not something any staff account does to itself or
   to a peer.

2. **Default `staff_function` for every existing active staff profile,
   set by this migration's own backfill, is `'general'` — the
   unrestricted bucket.** This is the single most important safety
   property of this migration: **zero currently-shipped access
   regresses the moment this migration runs.** Nobody is locked out of
   anything they can do today. Restriction is strictly opt-in — the
   Owner/Admin must explicitly set a profile's `staff_function` to
   `'project_manager'` or `'superintendent'` and create assignment rows
   before that profile's access narrows at all. `role='staff'` profiles
   are required (via a CHECK constraint, added after the backfill) to
   carry a non-null `staff_function` from this migration forward — new
   staff profiles created after this package must specify one.

3. **"Restricted Superintendent access" is implemented for two
   concrete, named surfaces in this package — the accessible-project
   list/RLS (via Decision 1) and the audit log (via Decision 5) —
   and explicitly NOT by retrofitting a superintendent exclusion onto
   every individual financial table's RLS policy beyond what's listed
   in Decision 4.** Rationale: there is no Superintendent-facing
   screen anywhere in the product yet (Schedules/Daily Logs/RFIs are
   P9) — a Superintendent account today has no UI path to attempt
   financial access through at all, only a direct API/RPC call. Fully
   closing that residual channel is a bounded, separately reviewable
   piece of work (Decision 4 already does a meaningful, real subset of
   it) rather than a silent, incomplete promise. **This is presented
   to the owner as a decision, not asserted as obviously correct** —
   see the explicit tradeoff in "Owner decisions requiring sign-off"
   below.

4. **A second helper, `is_financial_staff(project_id)`, is introduced
   and swapped into the RLS policies of every genuinely
   dollar-bearing table** — `is_org_staff(project_id)` behavior, minus
   an explicit exclusion when `staff_function = 'superintendent'`.
   Exact table list (confirmed by direct grep of every current
   `is_org_staff(...)`-based policy in `schema/001`–`015`):
   `project_fee_rules`, `cost_codes`, `budget_ledger`, `expenses`,
   `committed_costs`, `forecast_entries`, `budget_suggestions`,
   `fee_ledger`, `import_batches`, `import_rows`, `divisions`,
   `project_financial_settings`, `credit_ledger`, `bid_packages`,
   `bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`,
   `material_order_line_items`, and `issued_documents` (this last one's
   exact current policy predicate must be re-confirmed directly against
   `schema/015` at implementation time — Task 1 below). **Deliberately
   excluded from this swap** (stay on plain `is_org_staff`, so they
   still narrow by project assignment per Decision 1 but are not
   Superintendent-blocked): `documents`, `project_members`,
   `project_clients` — none of these are dollar-bearing, and
   `SECURITY-AND-PERMISSIONS-MATRIX.md` does not list Superintendent as
   excluded from Documents. **Correction found during implementation
   review:** this list originally also excluded `projects` on the same
   "not dollar-bearing" reasoning, but `projects` actually carries two
   real dollar columns (`gmp_amount_cents`, `deposit_amount_cents`).
   `projects` stays off the `is_financial_staff` swap for `SELECT`/
   `INSERT` (Decision 7a already gives `SELECT` its own assignment-aware
   read and `INSERT` its own admin-only gate), but its `UPDATE` policy's
   `USING` clause uses `is_financial_staff(id)` specifically, closing
   the two-dollar-column write path a superintendent would otherwise
   have had. See Decision 7a.

5. **`audit_log`'s staff-facing SELECT policy is replaced with three
   narrower policies, implementing `SECURITY-AND-PERMISSIONS-MATRIX.md`'s
   own prescription exactly**: Admin — unchanged, org-wide. Accounting
   (`staff_function='accounting'`) — org-wide, but restricted to rows
   whose `table_name` is in a new `audit_financial_tables` registry
   (seeded with exactly the Decision 4 table list, extendable the same
   way the existing `source_type` registry is — a new financial table
   added by a future package adds one row here, not a policy rewrite).
   Project Manager (`staff_function='project_manager'`) — scoped to
   their assigned projects only (any table), via the same
   `project_staff_assignments` check as Decision 1. **Superintendent
   and unassigned/`'general'` staff get no policy at all — the
   platform's own established default (a role with no matching policy
   sees zero rows) does the rest.** This is a real behavior change for
   every currently-undifferentiated `staff` account (all backfilled to
   `'general'` per Decision 2) — today they can read the full org-wide
   audit trail; after this migration they read none of it until
   explicitly assigned `'accounting'` or `'project_manager'`. This is
   the one place Decision 2's "nothing regresses" promise is
   intentionally not extended, because the whole point of this fix is
   that today's blanket audit access is the bug.
   The two audit policies unrelated to project-scoped financial data
   (`audit_log_org_scoped_select` for `orgs`/`profiles` rows,
   `audit_log_vendor_members_staff_select`) are **not** touched by this
   package — they're administrative/identity audit trails, not
   financial ones, and narrowing them wasn't asked for.

6. **Project creation is a single `SECURITY INVOKER` RPC,
   `create_project_with_defaults(...)`, admin-only, that inserts the
   project row, its `project_fee_rules` row, calls
   `apply_standard_cost_code_template()`, and inserts any initial
   staff/client assignments — all inside one function body, so
   Postgres's own transaction semantics make "no partially configured
   project" automatic, the same pattern `award_bid()`/
   `commit_material_order()` already establish.** Every new project
   always gets the full 113-code standard template at creation — there
   is no "start blank" option. Pruning unused codes happens afterward
   through P4's existing Estimate UI (archive), never as a
   creation-time choice. This keeps the RPC's surface small and
   guarantees `project_fee_rules` can never again be silently absent
   for a real project (closing the exact bug class that produced the
   live `PGRST116` error during the P5 Task 6 preview).

7. **Project creation is restricted to `role='admin'`, enforced at the
   RLS layer on `projects`' own INSERT policy directly — not only
   inside `create_project_with_defaults()`.** A PM cannot self-provision
   a new project, because under Decision 1 a PM has no access to a
   project until explicitly assigned to it — a PM "creating" a project
   they then can't see would be a confusing dead end. Recommended
   default; flagged for owner confirmation below, since nothing the
   owner wrote explicitly named who may create a project. Enforcing it
   at the RLS layer (not only the RPC) matters because otherwise a
   direct `insert into projects (...)` bypassing the RPC entirely would
   still succeed for any staff account under the table's current
   INSERT policy — undermining Decision 6's "no partially configured
   project can be created" guarantee, which only holds if the RPC is
   the *only* viable path to a new row. Found during independent
   review; fixed here rather than left as a gap between "what the RPC
   checks" and "what the database actually allows."

7a. **The `projects` table's own RLS policy is split by command
   (`SELECT`/`INSERT`/`UPDATE`), not a single `FOR ALL` calling
   `is_org_staff(id)`.** `schema/001_core_financial.sql` (lines 84–89)
   explicitly documents why the original policy uses
   `is_org_staff_for_org(org_id)` directly on the incoming row rather
   than `is_org_staff(id)`: "a self-join against the row currently
   being inserted is unreliable." **This package initially misjudged
   the warning's scope** — treating it as specific to INSERT's `WITH
   CHECK` and assuming `SELECT`'s `USING` clause was safe, because a
   `SELECT` policy checks an already-existing, already-committed row
   in the ordinary case. That assumption missed that Postgres also
   evaluates the `SELECT` policy against the *in-flight* new row for
   any `INSERT ... RETURNING` — which `create_project_with_defaults()`
   itself uses — so the same self-join hazard reaches `SELECT` too,
   just one step removed from where the warning was written. Found
   during Task 1's implementation review (not the earlier design-stage
   review), reproduced empirically, and fixed before this package was
   considered complete: a new helper,
   `is_org_staff_for_project_row(p_org_id uuid, p_project_id uuid)`,
   takes `org_id` as a parameter straight off the row being checked
   (no query against `projects` at all) and reproduces `is_org_staff()`'s
   assignment-aware logic inline. Final shape: `SELECT`'s `USING`
   clause calls `is_org_staff_for_project_row(org_id, id)`; `INSERT`'s
   `WITH CHECK` uses `is_org_admin_for_org(org_id)` directly (per
   Decision 7); `UPDATE`'s `USING` clause uses `is_financial_staff(id)`
   (per the Decision 4 correction above — `is_org_staff(id)` alone
   would have left the two dollar columns on `projects` writable by an
   assigned superintendent) and its `WITH CHECK` uses
   `is_org_staff_for_org(org_id)` directly (no self-join, conservative
   — `org_id` cannot change on update in practice, but avoiding any
   self-referential subquery in a `WITH CHECK` clause entirely is the
   safer reading of the original author's warning). No `DELETE` policy
   is added — projects are never hard-deleted in this system
   (`status='archived'` is the terminal state), matching every table's
   own established archive-not-delete convention, and none existed
   before this package either.

8. **The last-selected project is stored in a plain cookie, set by a
   Server Action on every successful switch — never in `localStorage`,
   and never treated as an access grant.** Every page read re-resolves
   the cookie's project id against a live, RLS-scoped query for the
   *current* accessible-project list before using it; a cookie naming a
   project the user has lost access to (revoked assignment, or never
   had access, or a tampered value) silently falls back to the first
   entry in today's real accessible list, exactly as if no cookie were
   set — never an error, never a leak. A plain (non-`httpOnly`) cookie
   is sufficient since the value (a project UUID) grants nothing by
   itself; a `profiles.last_selected_project_id` column was considered
   and rejected as unnecessary schema surface for what is explicitly
   UI convenience state, per the owner's own framing.

9. **Archived projects are read-only for everyone who had access while
   the project was active — never write-eligible, and never listed by
   default alongside active projects.** The project selector shows
   "Active projects" (status `draft`/`active`/`on_hold`) by default,
   with a separate, explicit "Completed / Archived" view (any role
   that could access the project can still open it in that view) —
   matching `enforce_project_status_transition`'s own treatment of
   `archived` as terminal. Every write Server Action re-checks the
   project's current `status` server-side before proceeding (never
   trusts that the UI hid the edit control), so a stale tab pointed at
   a since-archived project cannot mutate it.

10. **Direct links to an inaccessible, revoked-access, or nonexistent
    project all render the same explicit "You don't have access to
    this project" page — never a raw error, never a silent fallback to
    a different project.** The distinction between "doesn't exist" and
    "exists but you can't see it" is deliberately not surfaced (RLS
    already returns zero rows for both cases identically — this is the
    standard information-hiding behavior every RLS-gated resource in
    this codebase already has, not new to this package).

11. **`project_staff_assignments` supports revocation via the exact
    `revoked_at`/`revoked_by` + identity/revocation-immutability
    trigger pattern P5 already established for `vendor_members`** —
    same shape, same anti-spoofing enforcement (`revoked_by` must equal
    the acting session's own `auth.uid()`), same reactivation semantics
    (clearing `revoked_at` also clears `revoked_by`). No new pattern
    invented; this package reuses an already-reviewed one. **`assigned_by`
    gets the same unspoofability treatment**: the identity/revocation
    trigger also rejects an INSERT whose `assigned_by` doesn't equal
    the acting `auth.uid()` — the same class of provenance-spoofing
    gap P5 Revision 3 closed for `bid_questions.recorded_by`/
    `bid_addenda.issued_by`, found and closed here during independent
    review rather than left as a known gap.

12. **This migration claims `schema/016`.** `P4.1-DESIGN.md`'s own
    plan (`docs/superpowers/plans/2026-08-15-p4.1-cost-code-breakdown.md`)
    provisionally named its own migration `schema/016_cost_code_children.sql`,
    but P4.1 was design-only and never implemented — no such file
    exists in the repository. Since this package is being implemented
    first, it takes the `016` slot. **When P4.1 is eventually approved
    and implemented, its plan's migration references must be renumbered
    to `schema/017` — a trivial, purely mechanical rename, flagged here
    so it isn't missed; P4.1's design content itself needs no change.**

## Owner decisions — resolved (2026-08-19)

**Approved as recommended:**
- **#2 below: project creation is admin-only.** Enforced both inside
  `create_project_with_defaults()` and at the RLS layer directly on
  `projects`' own INSERT policy (Decision 7/7a) — not merely a
  convention the RPC happens to follow.
- **#3 below: `staff_function='accounting'` may not create projects.**
  Same admin-only gate as #2, no separate carve-out. Accounting can be
  assigned to a project immediately after creation like any other
  initial team member.

**Not contested — proceeding with the stated recommended default:**
- **#1 below** was already resolved as "closed by Decision 4 + the
  Decision 1a fix" prior to this approval round; nothing further
  required.
- **#4 below** (initial team assignment optional at creation, not
  required) — proceeding with the recommended default since it wasn't
  raised; revisit if this turns out wrong once real usage starts.

The four items are preserved below exactly as originally presented,
for the record of what was decided and why.

## Owner decisions requiring sign-off (original presentation, now resolved above)

Presented as short, plain-language choices with a recommended default,
per standing product-development instructions.

1. **Does "restricted Superintendent access" need to close the
   residual direct-API channel to financial tables now, or can that
   wait until Superintendent has a real screen (P9)?**
   *Recommended default:* Decision 4 closes it now, for every table in
   its list, at the RLS layer directly. The independent review
   confirmed this holds for `is_financial_staff()` itself (finding A4:
   "confirmed clean"). It also found that the *adjacent* question —
   whether a restricted staff account could still expand its own
   access some other way — was not actually closed by Decision 4 alone:
   the `project_staff_assignments` write path itself was the gap (fixed
   by Decision 1a above). With that fix in place, this item is
   resolved as originally intended: recommend confirming
   `issued_documents`'s exact policy at implementation time (flagged
   in Decision 4) is the only remaining open item, not a deferred
   design gap.
2. **Who may create a new project — Admin only, or Admin + any
   `staff_function='project_manager'`?**
   *Recommended default:* Admin only (Decision 7). *Tradeoff:* a PM
   waiting on the Owner to create a project before they can start
   configuring an estimate, versus a PM being able to self-provision
   projects the Owner didn't know about yet. For a small company where
   the Owner is closely involved in every new job, Admin-only seems
   right; if Stone Column's actual workflow has PMs originating new
   jobs independently, this should flip before implementation.
3. **Should `'accounting'`-function staff be allowed to create
   projects (e.g., to pre-set up billing before a PM is assigned)?**
   *Recommended default:* no — same admin-only gate as Decision 7/#2
   above, for the same reason. Accounting can be assigned to a project
   immediately after creation like any other initial team member.
4. **Initial team assignment at creation time — required, or
   optional-then-added-later?**
   *Recommended default:* optional at creation (an empty project with
   no assignments is valid — it simply isn't visible to any PM/
   Superintendent until assigned, which is a safe, inert state, not a
   broken one), with assignment obviously and immediately available
   from the new project's own team screen right after creation.
   Requiring it at creation time would block the Owner from creating a
   project before deciding staffing, which seems like unnecessary
   friction for a small builder.

## Schema (migration `schema/016_project_staff_access_foundation.sql`)

- [ ] New enum `staff_function` (`'project_manager' | 'superintendent' | 'accounting' | 'general'`).
- [ ] `alter table profiles add column staff_function staff_function;`
      backfill every `role='staff'` row to `'general'`; then
      `alter table profiles add constraint staff_function_required_for_staff
      check (role <> 'staff' or staff_function is not null);`
- [ ] New table `project_staff_assignments` (`id`, `project_id` →
      `projects(id) on delete cascade`, `profile_id` → `profiles(id)`,
      `assigned_at`, `assigned_by`, `revoked_at`, `revoked_by`,
      `created_at`; `unique(project_id, profile_id)`), RLS-enabled,
      **admin-only** manage policy (`is_org_admin_for_org` via the
      project's org — not `is_org_staff_for_org`; see Decision 1a. A
      PM/superintendent must never be able to write their own row here,
      since their whole access model is downstream of this table).
- [ ] `enforce_project_staff_assignment_org_match()` (mirrors
      `enforce_vendor_member_org_match()`) and
      `enforce_project_staff_assignment_identity_and_revocation()`
      (mirrors `enforce_vendor_member_identity_and_revocation()`,
      extended to also require `assigned_by = auth.uid()` on INSERT —
      immutable `project_id`/`profile_id`; `revoked_by`/`assigned_by`
      must equal the acting `auth.uid()`; reactivation clears `revoked_by`).
- [ ] `audit_project_staff_assignments` trigger using `log_audit()`
      (has a real `project_id` column, so the standard trigger applies
      unmodified).
- [ ] New helper `has_project_assignment(p_project_id uuid) returns boolean`
      (SECURITY DEFINER, checks for an active row in
      `project_staff_assignments`).
- [ ] `create or replace function public.is_org_staff(p_project_id uuid)`
      — extended per Decision 1 (same signature, same callers, new
      internal logic).
- [ ] New helper `is_financial_staff(p_project_id uuid) returns boolean`
      (Decision 4).
- [ ] `alter policy`/`drop`+`create` pass swapping the Decision 4 table
      list's policies from `is_org_staff(...)` to `is_financial_staff(...)`
      — same predicate shape, only the function name changes.
- [ ] `projects_staff_full_access` (a single `FOR ALL` policy) is
      **dropped and replaced with three command-specific policies**
      (`projects_staff_select`, `projects_staff_insert`,
      `projects_staff_update`) per Decision 7a — not a single
      `is_org_staff(id)` rewrite. See Decision 7a for the exact
      predicate per command and why.
- [ ] New table `audit_financial_tables` (`table_name text primary key`),
      RLS-enabled with **no** policies (reachable only via the helper
      function below, matching the existing helper-function-gated
      pattern), seeded with the Decision 4 table list.
- [ ] New helper `is_financial_audit_table(p_table_name text) returns boolean`.
- [ ] `drop policy audit_log_staff_select on audit_log;` replaced with
      `audit_log_admin_select`, `audit_log_accounting_financial_select`,
      `audit_log_pm_project_scoped_select` (Decision 5). The two
      non-project-scoped audit policies are untouched.
- [ ] New RPC `create_project_with_defaults(p_name text, p_project_number text,
      p_address text, p_project_type text, p_pricing_model pricing_model,
      p_pricing_model_label text, p_fee_basis fee_basis, p_fee_basis_points int,
      p_fee_fixed_amount_cents bigint, p_initial_staff_profile_ids uuid[] default '{}',
      p_initial_client_profile_ids uuid[] default '{}') returns uuid`
      — `SECURITY INVOKER`, admin-only (`is_org_admin_for_org` check at
      the top), inserts `projects` (`status='draft'`), inserts
      `project_fee_rules`, calls `apply_standard_cost_code_template()`,
      loops `p_initial_staff_profile_ids` into `project_staff_assignments`
      (only meaningful for profiles with a restrictive `staff_function`;
      harmless no-op access-wise for `'general'`/`'accounting'`, but
      recorded for team-screen display either way), loops
      `p_initial_client_profile_ids` into `project_members`
      (`member_role='client'`). Returns the new project's id.
- [ ] Write `schema/016_project_staff_access_foundation_down.sql`
      (drops everything above in reverse order, restores
      `is_org_staff()`/`projects_staff_full_access`/`audit_log_staff_select`
      to their exact pre-016 bodies).
- [ ] Mirror into `supabase/migrations/20260819000000_project_staff_access_foundation.sql`.

## Server-side operations

- `packages/02-app-shell/src/services/projectService.ts` (new):
  `listAccessibleProjects(supabase, orgId, { includeArchived?: boolean })`
  — plain `select` against `projects`, relying entirely on the
  rewritten `projects_staff_full_access`/`projects_client_read` RLS to
  do the actual filtering (never an application-level filter layered
  on top — RLS is the only filter). `createProject(supabase, params)`
  — thin wrapper over `create_project_with_defaults`. `assignStaffToProject`/
  `revokeStaffAssignment`/`reactivateStaffAssignment` — thin wrappers
  over direct `project_staff_assignments` inserts/updates (RLS-gated,
  no RPC needed — same shape as `vendor_members`'s revoke/reactivate
  service functions from P5 Task 4/5).
- `apps/web/src/server/project/resolveSelectedProject.ts` (new,
  shared): the **single** place that reads the last-selected-project
  cookie, re-validates it against `listAccessibleProjects()`, and
  returns either that project or the first accessible one — replacing
  every page's independently duplicated `firstProject` query (Research
  findings). Used by `/admin/overview`, `/admin/financials`,
  `/admin/estimate`, `/admin/bids`, `/admin/import`, and the new
  `/admin/projects`.
- `apps/web/app/admin/projects/switchAction.ts` (new): Server Action
  setting the last-selected-project cookie after re-validating the
  target id is in the caller's real accessible list (never trusts the
  client-submitted id blindly).
- `apps/web/app/admin/projects/createAction.ts` (new): thin wrapper
  over `createProject`.

## UI

- **`ProjectSwitcher`** (new component, rendered in `AppShell`'s header
  so it's present on every admin screen per `PRODUCT-VISION.md` §3):
  shows the current project's name/status badge; opens a list of
  accessible active projects (grouped, with a "Completed / Archived"
  link) plus a "+ Create New Project" action (admin-only, hidden
  otherwise — but the underlying RPC is the real boundary regardless).
- **`/admin/projects`** rebuilt as the real project list (replacing its
  current fixture-`ProjectWorkspace` behavior): search/filter/sort by
  status, a card or row per accessible project, "Create New Project"
  entry point opening a short wizard (name, number, address, type,
  pricing model, fee terms, initial staff/client assignments — all in
  one submit calling `createProject`).
- **No-access page** (new, shared): the explicit "You don't have
  access to this project" state (Decision 10), with a link back to the
  user's own accessible-project list — never a dead end.
- Existing `/admin/overview`, `/admin/financials`, `/admin/estimate`,
  `/admin/bids`, `/admin/import` **rewired** to call
  `resolveSelectedProject()` instead of each page's own duplicated
  `firstProject` query or unconditional fixture load — this is the
  package's core "replace fixture-bound/hardcoded project context"
  requirement, satisfied by deleting duplicated logic, not adding more.
- `ProjectWorkspace.tsx`'s header stops importing `projectMeta` from
  the fixture and takes the resolved real project as a prop.
- A minimal **team-assignment screen** (staff `project_staff_assignments`
  + client/vendor `project_members`) reachable from the project's own
  workspace — satisfies "assign team members and clients" without
  building the fuller settings screen `PRODUCTION-ROADMAP.md`'s P3 text
  already scoped (contract-type editing, etc. — out of scope here, see
  Exclusions).

## Tests

`tests/sql/package_p3_project_staff_access_tests.sql` (new):
1. `staff_function` backfill + CHECK constraint (`'general'` on every
   existing staff row; a fresh `role='staff'` insert with no
   `staff_function` is rejected).
2. `project_staff_assignments` composite integrity + org-match guard
   (cross-org assignment rejected) + revocation/reactivation lifecycle,
   modeled directly on `vendor_members`'s own test section. **Explicitly
   including**: a `project_manager`/`superintendent`-function staff
   session attempting to `INSERT` a `project_staff_assignments` row
   naming themselves and a project they don't already have access to
   is rejected (the exact self-escalation path the independent review
   found and Decision 1a closes) — this is the single most important
   new test in this suite; a `general`/`accounting`-function staff
   session attempting the same is also rejected (admin-only, no
   exceptions); an `assigned_by` value not equal to the acting
   session's own `auth.uid()` is rejected on INSERT.
3. `is_org_staff()` behavior matrix: admin (always true); `'general'`/
   `'accounting'` (always true, org-wide, unchanged); `'project_manager'`/
   `'superintendent'` with an active assignment (true only for the
   assigned project, false for a sibling project in the same org);
   with a **revoked** assignment (false) — the explicit "revoked-
   assignment" test the owner asked for.
4. **Cross-organization**: a staff account in Org A, however
   configured, never passes `is_org_staff()`/`is_financial_staff()`
   for any Org B project — extends the exact test class already
   established in P1/P5.
5. **Cross-project**: a `'project_manager'` assigned to Project A only
   cannot read/write Project B's cost codes/budget ledger/bids, even
   though both projects are in their own org.
6. **Cross-role**: a `'superintendent'` assigned to Project A cannot
   read any Decision-4-listed financial table for Project A, even
   though `is_org_staff(A)` returns true for them (the exact
   `is_financial_staff` vs. `is_org_staff` distinction).
7. `projects` policy split (Decision 7a): the accessible-project list
   itself narrows/widens exactly per the matrix above for `SELECT`
   (not just the underlying financial tables) — proves Decision 1's
   fix actually reaches the table most directly tied to "accessible
   project list." A direct `INSERT` into `projects` by a non-admin
   staff session is rejected (Decision 7/5a); by an admin session with
   a mismatched `org_id` is rejected. This section must be verified
   against a real hosted Postgres instance, not only PGlite — the
   independent review notes this codebase was already burned once
   (2026-08-06) by PGlite not enforcing something a real Postgres
   instance does for this exact function/table pair.
8. Audit log: admin sees everything; `'accounting'` sees only
   Decision-4-listed tables' rows, org-wide; `'project_manager'` sees
   only their assigned projects' rows, any table; `'superintendent'`
   and `'general'` see **zero** audit rows — the explicit regression
   test proving the documented over-exposure bug is closed.
9. `create_project_with_defaults()`: a successful call produces a
   project + fee rule + full 113-code template + zero orphaned partial
   state; a deliberately-forced mid-function failure (e.g., an invalid
   `p_fee_basis`/amount combination) leaves **no** `projects` row at
   all (proves the transaction-atomicity claim, not just asserts it);
   a non-admin caller is rejected.
10. **Regression**: full, unmodified re-run of every existing SQL test
    file (`package_p1...` through `package_p5_commitments_bids_procurement_tests.sql`)
    in the same suite invocation — proves the `is_org_staff()`/
    `projects_staff_full_access`/audit-log rewrites break nothing
    already shipped, for every role/scenario those suites already
    cover.

`apps/web/test/route_smoke.ts`: extend with `/admin/projects` coverage
(unauthenticated redirect, nav entry rendered — matching the existing
`/admin/bids`/`/admin/import` precedent) and a new check that
`/admin/overview` and `/admin/financials` no longer render the fixture
project's name when a real, non-demo session with a real project is
used (closing the `DEMO_MODE`-bypass bug found in Research findings).

## Acceptance criteria

1. A real Admin/Owner account can create a new project through the UI,
   ending with a full cost-code template, a real fee rule, and (if
   selected) initial staff/client assignments — with no partial state
   possible even if a step is deliberately made to fail.
2. Every currently-implemented screen (`/admin/overview`,
   `/admin/financials`, `/admin/estimate`, `/admin/bids`, `/admin/import`)
   shows the actual selected real project's name/data, never the
   fixture, in a real (non-demo) session — and clearly displays which
   project that is.
3. Switching projects via `ProjectSwitcher` changes every figure on
   the next page load; the choice persists across a new page load via
   the cookie, but a revoked/inaccessible project named by a stale
   cookie value never grants anything — falls back safely.
4. A `'project_manager'`-function staff account assigned to Project A
   only cannot read or act on Project B's data through any path —
   proven by test, not review.
5. A `'superintendent'`-function staff account cannot read any
   Decision-4-listed financial table, or any *project-scoped* audit-log
   row (the three new policies in Decision 5), for any project, by
   default. (The two untouched, non-financial audit policies —
   `orgs`/`profiles` and `vendor_members` changes — remain org-wide
   staff-visible by deliberate, explicit exclusion; see Decision 5.
   This distinction is stated precisely here because the independent
   review found the original, looser wording would have overstated
   what's actually delivered.)
5a. No staff account other than an admin can write to
   `project_staff_assignments` — including attempting to assign
   themselves to a project they don't already have access to. No
   staff account other than an admin can insert a row into `projects`
   directly (bypassing `create_project_with_defaults()`).
6. Direct navigation to a project the current session cannot access
   (wrong org, revoked assignment, nonexistent id) always shows the
   explicit no-access page — never a raw error, never someone else's
   data.
7. `npm run typecheck`/`test`/`build` all pass; the full SQL suite
   (001–016 + every existing regression file) passes together.

## Dependencies

P1 (auth/RLS foundation), P2.1 (cost-code template data
`apply_standard_cost_code_template()` calls), P4 (Estimate UI, for
post-creation cost-code pruning), P5 Tasks 1–6 (services/screens this
package rewires to use the resolved project).

## Explicit exclusions

- **Invitations, sign-up, `bootstrap_organization()` gating,
  `DemoControls` removal** — `PRODUCTION-ROADMAP.md`'s remaining P2
  scope, untouched here; those flows already work well enough for this
  package's admin-creates-project/assigns-existing-profiles model,
  which never needs to invite someone new.
- **`project_decision_makers` / Client Approval Model implementation**
  — per the owner's explicit instruction, deferred until immediately
  before P7 (its first real consumer); `CLIENT-APPROVAL-MODEL.md`
  remains a documented design with nothing to enforce it yet.
- **Thin Leads intake, thin Company Templates, baseline backup/retention
  policy** — old Package 3's remaining named scope, explicitly not
  picked up here; `PRODUCT-COMPLETENESS-MATRIX.md` Section D already
  recommends these stay deferred to P14 (or a future decision on
  timing for the backup-baseline piece specifically) — not expanded
  into this already-focused package.
- **Full project settings screen** (contract-type editing beyond
  what's set at creation, GMP/deposit terms editing after creation,
  etc.) — a minimal creation wizard and a minimal team-assignment
  screen satisfy this package's stated requirements; a fuller settings
  UI is unnecessary scope for what was asked.
- **Closing the residual Superintendent direct-API financial-access
  channel beyond Decision 4's table list** — believed already closed
  by Decision 4 in full (see Owner decision #1's correction), but not
  independently re-audited against every non-financial table that
  might unexpectedly carry dollar amounts; flagged for the independent
  review pass below, not asserted as certain.
- **Schedules/Daily Logs/RFIs and any other P9 table** — don't exist
  yet; nothing here should be read as pre-building P9's Superintendent
  screens, only their eventual authorization foundation.
- **P5 Task 7 itself** — not started by this package; this package
  ends with a merge back into `p5-commitments-bids-procurement` and a
  `p3-complete` tag, then stops for the owner's explicit go-ahead to
  resume P5.
