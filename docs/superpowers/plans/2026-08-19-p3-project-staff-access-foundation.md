# P3 — Project & Staff Access Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design record (read first, authoritative for every "why"):**
`docs/production-build/P3-DESIGN.md`. Not yet owner-approved — do not
begin any task in this plan until the owner explicitly approves the
design AND says to begin implementation. This plan implements that
design exactly — 12 decisions, no redesign.

**Branch:** `p3-project-staff-access-foundation`, created from the tip
of `p5-commitments-bids-procurement` (commit `a3f0bdf`) — **not** from
`p4-complete`, which stays untouched at `930c6ef`. Off-device bundle
`stone-column-portal-20260819-pre-p3-project-staff-access.bundle`
(OneDrive) covers the pre-work state.

**Goal:** Real accessible-project list/selector/creation; a
`staff_function` authorization model closing the PM/Superintendent/
Accounting differentiation gap; a corrected audit-log RLS surface; and
every already-shipped P4/P5 screen and service rewired to use a real,
RLS-resolved selected project instead of a fixture or a first-row
shortcut.

## Global Constraints

- Money is always an integer number of cents. Never a float. (CLAUDE.md)
- No screen computes its own financial numbers. (CLAUDE.md)
- Never edit `schema/001`–`015` in place. All schema changes are
  additive, in `schema/016_project_staff_access_foundation.sql` (+
  down) only, mirrored into `supabase/migrations/`.
- `is_org_staff(project_id)` is modified in place — it is the single
  real boundary the rest of the schema already depends on. No parallel
  helper duplicates its role. (P3-DESIGN.md Decision 1)
- Every currently-active staff profile is backfilled to
  `staff_function = 'general'`, the unrestricted bucket — this
  migration must not regress any access that exists today. Only the
  audit-log fix (Decision 5) is a deliberate, named exception to that
  promise. (Decision 2, Decision 5)
- `is_financial_staff(project_id)` is swapped into the exact table
  list in Decision 4 — no more, no fewer, and `issued_documents`'s
  real current policy predicate must be re-confirmed against
  `schema/015` directly before writing the swap (do not assume the
  design doc's placeholder text is exact).
- Every mutation runs through the caller's own JWT-bearing Supabase
  client (RLS-scoped) via a Server Action — never service-role, never
  client-side browser calls to Supabase.
- Business logic lives in `packages/02-app-shell/src/services/`; any
  Server Action is a thin adapter.
- `create_project_with_defaults()` is the only way a project is
  created outside `scripts/db/seed.mjs` — atomic, admin-only,
  transaction-guaranteed no-partial-state.
- A default is not a boundary — `revoked_by` on
  `project_staff_assignments` must be unspoofable at the database
  itself, mirroring `vendor_members`'s own enforcement exactly.
  (Decision 11)
- `npm run typecheck` / `npm run test` / `npm run build` must pass
  after every task.
- Do not begin P5 Task 7. This plan ends with a merge back into
  `p5-commitments-bids-procurement` and a `p3-complete` tag, then
  stops.

---

### Task 1: Migration 016 — schema

**Files:**
- Create: `schema/016_project_staff_access_foundation.sql`
- Create: `schema/016_project_staff_access_foundation_down.sql`
- Create: `supabase/migrations/20260819000000_project_staff_access_foundation.sql` (mirror)

**Interfaces:** Produces type `staff_function`; table
`project_staff_assignments`; table `audit_financial_tables`; functions
`has_project_assignment(uuid)`, `is_financial_staff(uuid)`,
`is_financial_audit_table(text)`,
`enforce_project_staff_assignment_org_match()`,
`enforce_project_staff_assignment_identity_and_revocation()`,
`create_project_with_defaults(...)`; modified functions `is_org_staff(uuid)`;
modified policies `projects_staff_full_access`, every Decision-4-listed
table's staff policy, `audit_log` (3 new policies replacing
`audit_log_staff_select`).

- [ ] **Step 0: re-confirm the exact current `issued_documents` RLS
  policy text in `schema/015_commitments_bids_procurement.sql`** before
  writing anything else in this task — the design doc flags this as
  unverified. Grep `create policy.*issued_documents` and read the full
  predicate; add it to the Decision 4 swap list with its real,
  confirmed text, not a guess.

- [ ] **Step 1: `staff_function` enum, `profiles` column, backfill, constraint**

```sql
create type staff_function as enum ('project_manager', 'superintendent', 'accounting', 'general');

alter table profiles add column staff_function staff_function;

update profiles set staff_function = 'general'
  where role = 'staff' and staff_function is null;

alter table profiles add constraint staff_function_required_for_staff
  check (role <> 'staff' or staff_function is not null);
```

- [ ] **Step 2: `project_staff_assignments` table, RLS, revocation triggers, audit**

```sql
create table project_staff_assignments (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references projects(id) on delete cascade,
  profile_id   uuid not null references profiles(id),
  assigned_at  timestamptz not null default now(),
  assigned_by  uuid references profiles(id),
  revoked_at   timestamptz,
  revoked_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),

  constraint project_staff_assignments_unique_pair unique (project_id, profile_id)
);

alter table project_staff_assignments enable row level security;

-- Admin-only, deliberately NOT is_org_staff_for_org() -- a
-- project_manager/superintendent's entire access model is downstream
-- of this table, so if any org-wide staff account could write to it,
-- a restricted account could grant itself the exact access this
-- package exists to restrict. Found in independent review (Critical
-- finding A1) against an earlier draft that used is_org_staff_for_org.
create policy project_staff_assignments_admin_manage on project_staff_assignments
  for all to authenticated
  using (is_org_admin_for_org((select org_id from projects where id = project_id)))
  with check (is_org_admin_for_org((select org_id from projects where id = project_id)));

create or replace function public.enforce_project_staff_assignment_org_match() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_project_org uuid;
  v_profile_org uuid;
begin
  select org_id into v_project_org from projects where id = new.project_id;
  select org_id into v_profile_org from profiles where id = new.profile_id;
  if v_project_org is distinct from v_profile_org then
    raise exception 'Cannot assign profile % to project % — org mismatch (profile org %, project org %)',
      new.profile_id, new.project_id, v_profile_org, v_project_org;
  end if;
  return new;
end;
$$;

create trigger project_staff_assignments_org_match before insert or update on project_staff_assignments
  for each row execute function public.enforce_project_staff_assignment_org_match();

-- Mirrors enforce_vendor_member_identity_and_revocation() (schema/015)
-- exactly: identity immutable after insert; revoked_by must equal the
-- acting session's own auth.uid(), checked on both INSERT (an
-- already-revoked row) and UPDATE (either field changing); reactivation
-- (revoked_at cleared) also clears revoked_by.
create or replace function public.enforce_project_staff_assignment_identity_and_revocation() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- assigned_by provenance (independent review finding C3, same
    -- class of fix as bid_questions.recorded_by / bid_addenda.issued_by
    -- in P5 Revision 3 -- a default is not a boundary).
    if new.assigned_by is distinct from auth.uid() then
      raise exception 'project_staff_assignments.assigned_by must equal the acting session''s own auth.uid() (%) — got %.',
        auth.uid(), new.assigned_by;
    end if;
    if new.revoked_at is not null and new.revoked_by is distinct from auth.uid() then
      raise exception 'project_staff_assignments.revoked_by must equal the acting session''s own auth.uid() (%) when inserting an already-revoked row — got % (row %).',
        auth.uid(), new.revoked_by, new.id;
    end if;
    return new;
  end if;

  if new.project_id is distinct from old.project_id or new.profile_id is distinct from old.profile_id
     or new.assigned_by is distinct from old.assigned_by then
    raise exception 'project_staff_assignments.project_id/profile_id/assigned_by are immutable after insert (row %).', old.id;
  end if;

  if new.revoked_at is distinct from old.revoked_at or new.revoked_by is distinct from old.revoked_by then
    if new.revoked_at is not null then
      if new.revoked_by is distinct from auth.uid() then
        raise exception 'project_staff_assignments.revoked_by must equal the acting session''s own auth.uid() (%) — got % (row %).',
          auth.uid(), new.revoked_by, old.id;
      end if;
    else
      -- Reactivation: revoked_at cleared must also clear revoked_by.
      if new.revoked_by is not null then
        raise exception 'Reactivating project_staff_assignments row % must also clear revoked_by.', old.id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger project_staff_assignments_identity_and_revocation
  before insert or update on project_staff_assignments
  for each row execute function public.enforce_project_staff_assignment_identity_and_revocation();

create trigger audit_project_staff_assignments after insert or update or delete on project_staff_assignments
  for each row execute function public.log_audit();
```

- [ ] **Step 3: `has_project_assignment()` helper**

```sql
create or replace function public.has_project_assignment(p_project_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_staff_assignments
    where project_id = p_project_id and profile_id = auth.uid() and revoked_at is null
  );
$$;

revoke all on function public.has_project_assignment(uuid) from public;
grant execute on function public.has_project_assignment(uuid) to authenticated;
```

- [ ] **Step 4: `is_org_staff(project_id)` — modified in place (Decision 1)**

```sql
create or replace function public.is_org_staff(p_project_id uuid) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_role app_role;
  v_function staff_function;
begin
  select org_id into v_org_id from public.projects where id = p_project_id;
  if v_org_id is null or not public.is_org_staff_for_org(v_org_id) then
    return false;
  end if;

  select role, staff_function into v_role, v_function
  from public.profiles where id = auth.uid();

  if v_role = 'admin' then
    return true;
  end if;

  if v_function in ('project_manager', 'superintendent') then
    return public.has_project_assignment(p_project_id);
  end if;

  -- 'accounting', 'general', and legacy NULL (pre-migration, should not
  -- occur post-backfill) remain org-wide, matching today's behavior.
  return true;
end;
$$;
```

Diff this against the real current body in `schema/001` before
replacing — preserve the function's exact `language`/`security`/
`search_path` clauses; only the internal logic changes.

- [ ] **Step 5: `is_financial_staff()` helper + swap into the Decision 4 table list**

```sql
create or replace function public.is_financial_staff(p_project_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_org_staff(p_project_id)
    and coalesce(
      (select staff_function from public.profiles where id = auth.uid()),
      'general'
    ) <> 'superintendent';
$$;

revoke all on function public.is_financial_staff(uuid) from public;
grant execute on function public.is_financial_staff(uuid) to authenticated;
```

Then, for **every** policy in Decision 4's confirmed table list
(`project_fee_rules`, `cost_codes`, `budget_ledger`, `expenses`,
`committed_costs`, `forecast_entries`, `budget_suggestions`,
`fee_ledger`, `import_batches`, `import_rows`, `divisions`,
`project_financial_settings`, `credit_ledger`, `bid_packages`,
`bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`,
`material_order_line_items`, `issued_documents`), `drop policy` +
`create policy` with the identical name and predicate shape, replacing
`is_org_staff(...)` with `is_financial_staff(...)` — e.g.:

```sql
drop policy cost_codes_staff_full on cost_codes;
create policy cost_codes_staff_full on cost_codes
  for all to authenticated
  using (is_financial_staff(project_id)) with check (is_financial_staff(project_id));
```

Repeat identically (same drop/recreate shape, same policy name kept)
for every table in the list — including the multi-statement ones like
`budget_ledger_staff_select`/`budget_ledger_staff_insert` and the
subquery-based ones like `import_rows_staff_only`/
`material_order_line_items_staff_full_access`/
`bid_submissions_staff_full_access` (these three pass a *resolved*
project id, e.g. `is_financial_staff((select project_id from import_batches b where b.id = batch_id))`
— preserve each policy's existing project-id-resolution expression
exactly, only swap the outer function name).

- [ ] **Step 6: `projects_staff_full_access` split into command-specific
  policies (Decision 7a) — NOT a single `is_org_staff(id)` rewrite.**
  `schema/001_core_financial.sql` lines 84–89 document, in the same
  comment block that defines `is_org_staff()` itself, that this exact
  substitution was deliberately avoided for `projects`' own policy
  because "a self-join against the row currently being inserted is
  unreliable." Independent review confirmed this warning is real and
  specific to `INSERT`'s `WITH CHECK` evaluation — not to `SELECT`/
  `UPDATE`'s `USING` clause, which check an already-existing row.

```sql
drop policy projects_staff_full_access on projects;

-- SELECT: existing row, safe to use the assignment-aware helper.
create policy projects_staff_select on projects
  for select to authenticated
  using (is_org_staff(id));

-- INSERT: no self-join (org_id is a column on the incoming row
-- itself); also tightens creation to admin-only at the RLS layer
-- (Decision 7), not merely inside create_project_with_defaults().
create policy projects_staff_insert on projects
  for insert to authenticated
  with check (is_org_admin_for_org(org_id));

-- UPDATE: USING checks the existing row (safe, assignment-aware);
-- WITH CHECK deliberately avoids any self-referential subquery on
-- the new row image, per the same caution as INSERT above, even
-- though the original comment only names INSERT explicitly.
create policy projects_staff_update on projects
  for update to authenticated
  using (is_org_staff(id))
  with check (is_org_staff_for_org(org_id));
```

No `DELETE` policy is added — none existed before this package, and
projects are never hard-deleted in this system (`status='archived'` is
the terminal state). `projects_client_read` is untouched.

**This entire step must be verified against a real hosted Postgres
instance, not only PGlite**, before being considered done — this
codebase was already burned once (2026-08-06, `is_org_staff`'s own
history) by PGlite not enforcing something a real Postgres instance
does for this exact function/table pair. A PGlite-only green run is
not sufficient evidence here.

- [ ] **Step 7: `audit_financial_tables` registry + helper + audit_log policy rewrite**

```sql
create table audit_financial_tables (
  table_name text primary key
);

alter table audit_financial_tables enable row level security;
-- Deliberately no policies at all -- reachable only via the
-- SECURITY DEFINER helper below, same pattern as every other
-- helper-gated lookup in this schema.

insert into audit_financial_tables (table_name) values
  ('project_fee_rules'), ('cost_codes'), ('budget_ledger'), ('expenses'),
  ('committed_costs'), ('forecast_entries'), ('budget_suggestions'),
  ('fee_ledger'), ('import_batches'), ('import_rows'), ('divisions'),
  ('project_financial_settings'), ('credit_ledger'), ('bid_packages'),
  ('bid_submissions'), ('bid_questions'), ('bid_addenda'),
  ('material_orders'), ('material_order_line_items'), ('issued_documents');

create or replace function public.is_financial_audit_table(p_table_name text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.audit_financial_tables where table_name = p_table_name);
$$;

revoke all on function public.is_financial_audit_table(text) from public;
grant execute on function public.is_financial_audit_table(text) to authenticated;

drop policy audit_log_staff_select on audit_log;

create policy audit_log_admin_select on audit_log
  for select to authenticated
  using (
    project_id is not null
    and exists (
      select 1 from public.projects p
      where p.id = audit_log.project_id and public.is_org_admin_for_org(p.org_id)
    )
  );

create policy audit_log_accounting_financial_select on audit_log
  for select to authenticated
  using (
    project_id is not null
    and public.is_financial_audit_table(audit_log.table_name)
    and exists (
      select 1 from public.profiles pr
      join public.projects p on p.id = audit_log.project_id
      where pr.id = auth.uid() and pr.org_id = p.org_id
        and pr.role = 'staff' and pr.staff_function = 'accounting' and pr.is_active
    )
  );

create policy audit_log_pm_project_scoped_select on audit_log
  for select to authenticated
  using (
    project_id is not null
    and exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'staff'
        and pr.staff_function = 'project_manager' and pr.is_active
    )
    and public.has_project_assignment(audit_log.project_id)
  );
```

`audit_log_org_scoped_select` and `audit_log_vendor_members_staff_select`
are untouched — do not modify them.

- [ ] **Step 8: `create_project_with_defaults()` RPC**

```sql
create or replace function public.create_project_with_defaults(
  p_org_id uuid,
  p_name text,
  p_project_number text,
  p_address text,
  p_project_type text,
  p_pricing_model pricing_model,
  p_pricing_model_label text,
  p_fee_basis fee_basis,
  p_fee_basis_points integer default null,
  p_fee_fixed_amount_cents bigint default null,
  p_initial_staff_profile_ids uuid[] default '{}',
  p_initial_client_profile_ids uuid[] default '{}'
) returns uuid
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_staff_id uuid;
  v_client_id uuid;
begin
  if not is_org_admin_for_org(p_org_id) then
    raise exception 'Only an org admin may create a project.';
  end if;

  -- Clean, explicit validation before hitting project_fee_rules' raw
  -- fee_basis_amount_present CHECK constraint (independent review
  -- finding B4) -- matches this function's own admin-check style
  -- rather than surfacing an opaque constraint-violation error.
  if p_fee_basis = 'percentage' and (p_fee_basis_points is null or p_fee_fixed_amount_cents is not null) then
    raise exception 'fee_basis=percentage requires fee_basis_points and no fee_fixed_amount_cents.';
  end if;
  if p_fee_basis = 'fixed' and (p_fee_fixed_amount_cents is null or p_fee_basis_points is not null) then
    raise exception 'fee_basis=fixed requires fee_fixed_amount_cents and no fee_basis_points.';
  end if;

  insert into projects (org_id, name, project_number, address, project_type,
                         status, pricing_model, pricing_model_label, created_by)
  values (p_org_id, p_name, p_project_number, p_address, p_project_type,
          'draft', p_pricing_model, p_pricing_model_label, auth.uid())
  returning id into v_project_id;

  insert into project_fee_rules (project_id, fee_basis, fee_basis_points, fee_fixed_amount_cents, created_by)
  values (v_project_id, p_fee_basis, p_fee_basis_points, p_fee_fixed_amount_cents, auth.uid());

  perform apply_standard_cost_code_template(v_project_id);

  foreach v_staff_id in array p_initial_staff_profile_ids loop
    insert into project_staff_assignments (project_id, profile_id, assigned_by)
    values (v_project_id, v_staff_id, auth.uid());
  end loop;

  foreach v_client_id in array p_initial_client_profile_ids loop
    insert into project_members (project_id, user_id, member_role)
    values (v_project_id, v_client_id, 'client');
  end loop;

  return v_project_id;
end;
$$;

revoke all on function public.create_project_with_defaults(
  uuid, text, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
) from public;
grant execute on function public.create_project_with_defaults(
  uuid, text, text, text, text, pricing_model, text, fee_basis, integer, bigint, uuid[], uuid[]
) to authenticated;
```

Confirm `apply_standard_cost_code_template()`'s exact signature in
`schema/012_financial_master_data.sql` before finalizing this `perform`
call — the design doc's Research findings describe it as
`(project_id)` but re-verify directly.

- [ ] **Step 8a: note on `apply_standard_cost_code_template()`
  (schema/012)** — it has its own internal `is_org_staff(project_id)`
  gate, unrelated to the Decision 4 policy swap. After this migration
  a superintendent calling it directly on a project they're assigned
  to (non-financial `is_org_staff()` passes) would pass that internal
  gate and then hit a raw RLS-violation error on its first `divisions`/
  `cost_codes` insert (now `is_financial_staff`-gated). Not an
  authorization hole — `is_financial_staff` still correctly blocks the
  actual write — but a confusing failure mode. No fix required in this
  package (independent review finding A6); leave a one-line comment at
  the top of `create_project_with_defaults()` noting the RPC itself is
  never called by a superintendent in practice (admin-only per Decision 7),
  so this path is theoretical, not reachable through any sanctioned flow.

- [ ] **Step 9: write the down-migration** — reverse order: drop the
  RPC, drop the 3 new `audit_log` policies and restore
  `audit_log_staff_select`'s exact original body, drop
  `is_financial_audit_table`/`audit_financial_tables`, restore every
  Decision-4 table's policy to its exact pre-016 `is_org_staff(...)`
  form, restore `projects_staff_full_access` to
  `is_org_staff_for_org(org_id)`, drop `is_financial_staff`, restore
  `is_org_staff()` to its exact pre-016 body, drop
  `project_staff_assignments` (cascades its triggers), drop
  `has_project_assignment`, drop the `staff_function_required_for_staff`
  constraint and `staff_function` column, drop the `staff_function` type.

- [ ] **Step 10: mirror into `supabase/migrations/`**, byte-identical.

- [ ] **Verify:**
  - `npm run typecheck` clean.
  - **Apply `schema/016` as a single explicit transaction** (e.g.
    `psql -1 -f schema/016_project_staff_access_foundation.sql`, or
    the equivalent single-transaction flag for whatever apply
    mechanism `scripts/db/` uses) — not as autocommitted individual
    statements. This matters specifically for the `staff_function`
    backfill immediately followed by its `NOT NULL`-equivalent CHECK
    constraint (independent review finding B1): outside a single
    transaction, a concurrently-inserted `staff` profile between the
    two statements could make the `ADD CONSTRAINT` fail. Confirm
    whatever script/command runs this migration in Task 7's live
    application actually uses single-transaction semantics, not just
    in local testing.
  - Migration applies cleanly on top of 001–015.
  - Down-migration round-trips (up → down → up, no errors) **and**
    its result is diffed against a pre-016 baseline (independent
    review finding B3) — e.g. `pg_get_functiondef` on `is_org_staff`/
    `projects_staff_full_access`'s restored form, and `pg_policies`
    output for every Decision-4 table — not just "no errors during
    down," which cannot detect a byte-inexact restoration. Copy the
    original `CREATE POLICY`/`CREATE FUNCTION` statements verbatim
    from `schema/001`/`010`/`012`/`015` into the down-migration rather
    than reconstructing them from memory.
  - Every existing SQL test file still passes unmodified against the
    post-016 schema (run the full suite once here, before Task 2 adds
    new tests, as an early regression signal).

---

### Task 2: SQL tests

**Files:** Create `tests/sql/package_p3_project_staff_access_tests.sql`.

- [ ] Implement all 10 sections listed in `P3-DESIGN.md`'s "Tests"
  section verbatim (staff_function backfill/constraint;
  project_staff_assignments integrity/org-match/revocation-reactivation;
  is_org_staff behavior matrix including the revoked-assignment case;
  cross-organization; cross-project; cross-role
  (`is_financial_staff` vs. `is_org_staff` distinction); the
  `projects_staff_full_access` rewrite reaching the project list itself;
  audit log (all four function buckets, including the two
  zero-access cases); `create_project_with_defaults()` atomicity
  including a deliberately-forced failure leaving no orphaned
  `projects` row; full unmodified regression re-run of every existing
  SQL test file in the same suite invocation).
- [ ] **Verify:** full SQL suite (all files, `001`–`016` + every test
  file) passes together via `scripts/db/run-sql-tests.mjs`.

---

### Task 3: Service layer — project resolution and creation

**Files:**
- Create: `packages/02-app-shell/src/services/projectService.ts`
- Create: `apps/web/src/server/project/resolveSelectedProject.ts`
- Create: `apps/web/app/admin/projects/switchAction.ts`
- Create: `apps/web/app/admin/projects/createAction.ts`

**Interfaces:** `listAccessibleProjects(supabase, orgId, { includeArchived?: boolean })`,
`createProject(supabase, params)`, `assignStaffToProject(supabase, projectId, profileId)`,
`revokeStaffAssignment(supabase, assignmentId)`,
`reactivateStaffAssignment(supabase, assignmentId)`,
`resolveSelectedProject(supabase, orgId, cookieProjectId)`.

- [ ] **Step 1:** `projectService.ts` — every function takes the
  caller's `SupabaseClient` first, matching every other service file.
  `listAccessibleProjects` is a plain `select` — RLS (post-Task-1) is
  the only filter, never an application-level `.filter()` layered on
  top of it.
- [ ] **Step 2:** `resolveSelectedProject.ts` — reads the
  last-selected-project cookie (via Next.js `cookies()`), calls
  `listAccessibleProjects`, returns the cookie's project if it's in
  that real list, otherwise the list's first entry, otherwise `null`
  (org has zero accessible projects — callers render the existing
  "No projects yet" empty state, unchanged from today). This function
  becomes the **single** shared resolver every page in Task 5 calls.
- [ ] **Step 3:** `switchAction.ts` — Server Action: re-validates the
  submitted project id against a fresh `listAccessibleProjects()` call
  before setting the cookie (never trusts the client-submitted id
  blindly, per Decision 8).
- [ ] **Step 4:** `createAction.ts` — thin wrapper over `createProject`.
- [ ] **Verify:** `npm run typecheck` clean.

---

### Task 4: `/admin/projects` real list + `ProjectSwitcher` + no-access page

**Files:**
- Rewrite: `apps/web/app/admin/projects/page.tsx`
- Create: `packages/02-app-shell/src/components/ProjectSwitcher.tsx`
- Create: `packages/02-app-shell/src/components/NoProjectAccess.tsx`
- Modify: wherever `AppShell` renders its persistent header, to mount `ProjectSwitcher`

**Interfaces:** Consumes Task 3's `listAccessibleProjects`/`createProject`/`switchAction`.

- [ ] **Step 1:** Functional spec first (data flow / auth / states /
  mutations), matching the convention P5 Tasks 6/9 established for
  non-trivial new UI, since this is a from-scratch build with no
  existing precedent (confirmed in Research findings).
- [ ] **Step 2:** `/admin/projects` — real, searchable/filterable/
  sortable list of accessible projects, status badges, a separate
  "Completed / Archived" view (Decision 9), a "Create New Project"
  entry point (admin-only in the UI, `create_project_with_defaults`
  is the real gate regardless) opening the creation wizard (name,
  number, address, type, pricing model, fee terms, optional initial
  staff/client assignments — one submit).
- [ ] **Step 3:** `ProjectSwitcher` — current project name/status,
  dropdown/list of accessible active projects + archived link, mounted
  in the persistent app header so it's visible on every admin screen
  (`PRODUCT-VISION.md` §3).
- [ ] **Step 4:** `NoProjectAccess` — the explicit, shared no-access
  page (Decision 10), with a link back to the user's own accessible list.
- [ ] **Verify:** `npm run typecheck`/`test`/`build` clean; manual
  golden-path walkthrough (create a project, see it in the switcher,
  switch to it, hit a project you don't have access to directly by
  URL, confirm the no-access page).

---

### Task 5: Rewire existing screens to the resolved project

**Files:**
- Modify: `apps/web/app/admin/overview/page.tsx`
- Modify: `apps/web/app/admin/financials/page.tsx`
- Modify: `apps/web/app/admin/estimate/page.tsx`
- Modify: `apps/web/app/admin/bids/page.tsx`
- Modify: `apps/web/app/admin/import/page.tsx`
- Modify: `apps/web/src/screens/ProjectWorkspace.tsx`

**Interfaces:** Consumes Task 3's `resolveSelectedProject()`.

- [ ] **Step 1:** Replace every page's independently duplicated
  `firstProject` query (and `/admin/overview`'s/`/admin/projects`'s
  unconditional `loadAdminVM()` fixture call, per Research findings)
  with a single call to `resolveSelectedProject()`. `DEMO_MODE`
  behavior is preserved exactly as it is today for demo sessions —
  this task only touches the real (non-demo) path plus the two pages
  that were incorrectly ignoring `DEMO_MODE` entirely.
- [ ] **Step 2:** `ProjectWorkspace.tsx`'s header stops importing
  `projectMeta` from the fixture; takes the resolved real project as a
  prop and renders its actual name/address.
- [ ] **Step 3:** If no project is accessible at all, render the
  existing "No projects yet" empty state (already present in some
  pages per Research findings) — do not regress that case.
- [ ] **Verify:** `npm run typecheck`/`test`/`build` clean; manual
  check that each page shows the real switched project, not the
  fixture, in a real session; `apps/web/test/route_smoke.ts`'s new
  checks (Task 6 below) pass.

---

### Task 6: Team assignment screen + route_smoke coverage

**Files:**
- Create: minimal team-assignment screen reachable from a project's workspace (exact route TBD at implementation time — likely `apps/web/app/admin/projects/[id]/team/page.tsx`)
- Modify: `apps/web/test/route_smoke.ts`

**Interfaces:** Consumes Task 3's `assignStaffToProject`/`revokeStaffAssignment`/`reactivateStaffAssignment`.

- [ ] **Step 1:** Minimal screen: list current staff assignments
  (name, `staff_function`) and client/vendor `project_members` for the
  selected project; add/revoke/reactivate controls for staff
  assignments (Decision 11's lifecycle, mirroring the existing
  vendor-membership revoke/reactivate UI pattern from P5 Task 4/5).
- [ ] **Step 2:** `route_smoke.ts` — add `/admin/projects` coverage
  (unauthenticated redirect, nav entry rendered) matching the existing
  `/admin/bids`/`/admin/import` precedent; add a check that
  `/admin/overview`/`/admin/financials` no longer render the fixture
  project's name in a real session (Task 5's regression guard).
- [ ] **Verify:** `npm run typecheck`/`test`/`build` clean.

---

### Task 7: Final verification, regression, live migration check, merge, closeout

**Files:** None new — verification only.

- [ ] **Step 1:** Full regression: `npm ci`, `npm run typecheck`
  (all workspaces), `npm run test` (all workspaces — confirm total
  check count only grows), `npm run build`.
- [ ] **Step 2:** Apply migration 016 to the real hosted dev Supabase
  project, **as a single transaction** (see Task 1's Verify step —
  this is not optional given the backfill/constraint ordering hazard),
  confirming reachability first; report and stop if not reachable, per
  the standing owner instruction — no mock-data workaround. Run the
  new SQL test file plus every existing regression file against that
  live database — this is also the first real-Postgres verification of
  the Decision 7a `projects` policy split (Task 1 Step 6 flags this
  explicitly; PGlite alone is not sufficient evidence for this table).
- [ ] **Step 3:** Live spot-check: create a real project through the
  UI end-to-end; assign a test profile `staff_function='project_manager'`
  and confirm they cannot see a sibling project; assign
  `staff_function='superintendent'` and confirm zero financial-table
  and zero audit-log access; revoke an assignment and confirm access
  drops on the next request.
- [ ] **Step 4:** Owner preview, using `OWNER-PREVIEW-CHECKLIST.md` in
  full (this package is exactly the kind of foundational, security-
  relevant work that checklist exists for).
- [ ] **Step 5:** Once approved, merge `p3-project-staff-access-foundation`
  back into `p5-commitments-bids-procurement` (fast-forward — linear
  history) and tag `p3-complete` at that point.
- [ ] **Step 6:** Update the SDD ledger noting P3 complete and P5 Task 7
  now cleared to resume, pending the owner's explicit go-ahead.
- [ ] **Verify:** all of the above pass; owner sign-off obtained before
  P5 Task 7 begins.
