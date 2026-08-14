# P5 — Commitments, Bids (PM-side), Procurement & Material Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the existing, schema-hardened-but-never-used `committed_costs` table for real writes for the first time, and add the vendor-quote/procurement mechanism (`bid_packages`, `bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`, `material_order_line_items`) that feeds it — without creating any new, disconnected financial table.

**Architecture:** Every commitment-creating write (`award_bid()`, `commit_material_order()`) inserts into the *existing* `committed_costs` table via the composite `(cost_code_id, project_id)` FK spine, registering a new `source_type`. A later amount change reuses the *existing* `supersede_committed_cost()` RPC (schema/003) — P5 adds zero new "how does a commitment change" concept. Mutations are Next.js Server Actions using the caller's own RLS-scoped Supabase client (never service-role); the two places needing cross-row atomicity (`award_bid`, `commit_material_order`) are `security invoker` Postgres RPCs, same reasoning as the existing `supersede_committed_cost`. Business logic (validation + the write) lives in plain service functions under `packages/02-app-shell/src/services/`; the Server Action that calls it is a thin adapter only.

**Tech Stack:** Next.js 14 App Router (Server Actions + Route Handlers), Supabase Postgres/RLS, `packages/01-financial-engine` (pure TS), `@react-pdf/renderer` (new dependency, server-side PDF generation).

**Design record (read first, authoritative for every "why"):** `docs/production-build/P5-DESIGN.md`.

## Global Constraints

- Money is always an integer number of cents. Never a float. (CLAUDE.md)
- No screen computes its own financial numbers — everything goes through `packages/01-financial-engine`. (CLAUDE.md)
- Nothing is silently overwritten, merged, or recalculated. Corrections are new ledger rows with a reason, not edits — a commitment amount change is always `supersede_committed_cost()`, never an `update` on `committed_costs.amount_cents`. (CLAUDE.md)
- Never edit `schema/001`–`014` in place. All P5 schema changes are additive, in a new `schema/015_*.sql` (+ down) file only, mirrored into `supabase/migrations/`.
- Every mutation runs through the caller's own JWT-bearing Supabase client (RLS-scoped) via a Server Action — never a client-side browser call to Supabase, never the service-role client. (TARGET-ARCHITECTURE.md §5.2)
- Business logic (validation + the write) lives in a plain service function under `packages/02-app-shell/src/services/`; the Server Action that calls it is a thin adapter only — parse input, call the service function, shape the result. (TARGET-ARCHITECTURE.md §14, AI-ASSISTANT-ARCHITECTURE.md)
- `npm run typecheck` / `npm run test` / `npm run build` must pass after every task.
- No vendor-facing UI (P11 scope) — every vendor RLS policy is built and tested here but no page in this plan is ever rendered to a vendor session.
- `ActionCenterScreen.tsx` stays fixture-driven/preview-only in this plan — P5 registers the two new Action Center *conditions* as tested service functions, it does not wire the real screen (no package before P5 has done this for any prior event either; wiring the live screen is out of this package's scope per `PRODUCTION-ROADMAP.md`'s own pattern).
- Do not begin P6 work of any kind.

---

### Task 1: Migration 015 — schema

**Files:**
- Create: `schema/015_commitments_bids_procurement.sql`
- Create: `schema/015_commitments_bids_procurement_down.sql`
- Create: `supabase/migrations/20260814000000_commitments_bids_procurement.sql` (mirror, per existing dual-directory practice)

**Interfaces:**
- Produces: types `bid_package_status`, `bid_submission_status`, `material_order_status`; tables `bid_packages`, `bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`, `material_order_line_items`; column `vendors.profile_id`; functions `award_bid(uuid) returns uuid`, `commit_material_order(uuid) returns uuid`; trigger functions `log_audit_via_bid_package()`, `log_audit_via_material_order()`.

- [ ] **Step 1: Write `schema/015_commitments_bids_procurement.sql`**

```sql
-- =====================================================================
-- Stone Column Portal — Migration 015: commitments, bids (PM-side),
-- procurement & material orders. See docs/production-build/P5-DESIGN.md
-- for full rationale.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vendor identity extension: links an internal vendors record to the
-- actual login/session identity is_project_vendor() checks. Nullable —
-- populated for real only once P11 ships an invitation flow.
-- ---------------------------------------------------------------------
alter table vendors
  add column profile_id uuid references profiles(id);

-- ---------------------------------------------------------------------
-- Bid packages: one per (cost_code_id, project_id), per P5-DESIGN.md
-- Decision 1.
-- ---------------------------------------------------------------------
create type bid_package_status as enum ('draft', 'published', 'awarded', 'cancelled');

create table bid_packages (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid not null references projects(id) on delete cascade,
  cost_code_id      uuid not null,
  title             text not null,
  scope_description text,
  due_at            timestamptz,
  status            bid_package_status not null default 'draft',
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),

  constraint bid_packages_cost_code_project_fk
    foreign key (cost_code_id, project_id) references cost_codes(id, project_id)
);

alter table bid_packages enable row level security;

create policy bid_packages_staff_full_access on bid_packages
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

create policy bid_packages_vendor_read on bid_packages
  for select to authenticated
  using (
    is_project_vendor(project_id)
    and exists (
      select 1 from bid_submissions bs
      join vendors v on v.id = bs.vendor_id
      where bs.bid_package_id = bid_packages.id and v.profile_id = auth.uid()
    )
  );

create trigger audit_bid_packages after insert or update or delete on bid_packages
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Bid submissions: also the invitee record. A vendor is "invited" by
-- inserting a row with status='invited' and no amount; updated in place
-- to 'submitted' when staff records what the vendor quoted. This
-- pre-commitment staging is not the append-only ledger itself (that's
-- committed_costs, reached only via award_bid()), so in-place update
-- here does not violate the ledger's append-only rule.
-- ---------------------------------------------------------------------
create type bid_submission_status as enum ('invited', 'submitted', 'awarded', 'declined', 'withdrawn');

create table bid_submissions (
  id             uuid primary key default uuid_generate_v4(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  vendor_id      uuid not null references vendors(id),
  status         bid_submission_status not null default 'invited',
  amount_cents   bigint,
  notes          text,
  submitted_at   timestamptz,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),

  constraint bid_submissions_one_per_vendor_per_package unique (bid_package_id, vendor_id),
  constraint bid_submissions_amount_set_when_submitted
    check (status = 'invited' or amount_cents is not null),
  constraint bid_submissions_amount_nonnegative check (amount_cents is null or amount_cents >= 0)
);

alter table bid_submissions enable row level security;

create policy bid_submissions_staff_full_access on bid_submissions
  for all to authenticated
  using (
    is_org_staff((select project_id from bid_packages where id = bid_submissions.bid_package_id))
  )
  with check (
    is_org_staff((select project_id from bid_packages where id = bid_submissions.bid_package_id))
  );

create policy bid_submissions_vendor_read on bid_submissions
  for select to authenticated
  using (vendor_id in (select id from vendors where profile_id = auth.uid()));

create policy bid_submissions_vendor_update on bid_submissions
  for update to authenticated
  using (vendor_id in (select id from vendors where profile_id = auth.uid()))
  with check (vendor_id in (select id from vendors where profile_id = auth.uid()));

create or replace function public.log_audit_via_bid_package() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from bid_packages
  where id = coalesce(new.bid_package_id, old.bid_package_id);

  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, before_data, after_data)
  values (
    v_project_id,
    tg_table_name,
    case tg_op when 'DELETE' then old.id else new.id end,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.log_audit_via_bid_package() from public;

create trigger audit_bid_submissions after insert or update or delete on bid_submissions
  for each row execute function public.log_audit_via_bid_package();

-- ---------------------------------------------------------------------
-- Bid questions: staff-authored Q&A record in P5 (no vendor session
-- exists to ask directly yet — P11 adds that UI against this same
-- table/policy set, zero schema change).
-- ---------------------------------------------------------------------
create table bid_questions (
  id             uuid primary key default uuid_generate_v4(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  vendor_id      uuid references vendors(id),
  question_text  text not null,
  answer_text    text,
  asked_at       timestamptz not null default now(),
  answered_by    uuid references profiles(id),
  answered_at    timestamptz,
  visible_to_all_vendors boolean not null default true,

  constraint bid_questions_answer_requires_answered_at
    check (answer_text is null or answered_at is not null)
);

alter table bid_questions enable row level security;

create policy bid_questions_staff_full_access on bid_questions
  for all to authenticated
  using (is_org_staff((select project_id from bid_packages where id = bid_questions.bid_package_id)))
  with check (is_org_staff((select project_id from bid_packages where id = bid_questions.bid_package_id)));

create policy bid_questions_vendor_read on bid_questions
  for select to authenticated
  using (
    visible_to_all_vendors
    or vendor_id in (select id from vendors where profile_id = auth.uid())
  );

create policy bid_questions_vendor_insert on bid_questions
  for insert to authenticated
  with check (
    vendor_id in (select id from vendors where profile_id = auth.uid())
    and exists (
      select 1 from bid_submissions bs
      join vendors v on v.id = bs.vendor_id
      where bs.bid_package_id = bid_questions.bid_package_id and v.profile_id = auth.uid()
    )
  );

create trigger audit_bid_questions after insert or update or delete on bid_questions
  for each row execute function public.log_audit_via_bid_package();

-- ---------------------------------------------------------------------
-- Bid addenda: staff-issued updates to a published package.
-- ---------------------------------------------------------------------
create table bid_addenda (
  id             uuid primary key default uuid_generate_v4(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  title          text not null,
  body_text      text not null,
  revised_due_at timestamptz,
  issued_by      uuid references profiles(id),
  issued_at      timestamptz not null default now()
);

alter table bid_addenda enable row level security;

create policy bid_addenda_staff_full_access on bid_addenda
  for all to authenticated
  using (is_org_staff((select project_id from bid_packages where id = bid_addenda.bid_package_id)))
  with check (is_org_staff((select project_id from bid_packages where id = bid_addenda.bid_package_id)));

create policy bid_addenda_vendor_read on bid_addenda
  for select to authenticated
  using (
    exists (
      select 1 from bid_submissions bs
      join vendors v on v.id = bs.vendor_id
      where bs.bid_package_id = bid_addenda.bid_package_id and v.profile_id = auth.uid()
    )
  );

create trigger audit_bid_addenda after insert or update or delete on bid_addenda
  for each row execute function public.log_audit_via_bid_package();

-- ---------------------------------------------------------------------
-- Material orders: one per (cost_code_id, project_id), same reasoning
-- as bid_packages. No vendor policy — procurement is internal only.
-- ---------------------------------------------------------------------
create type material_order_status as enum ('draft', 'ordered', 'partially_received', 'received', 'cancelled');

create table material_orders (
  id                   uuid primary key default uuid_generate_v4(),
  project_id           uuid not null references projects(id) on delete cascade,
  cost_code_id         uuid not null,
  vendor_id            uuid references vendors(id),
  order_number         text,
  status               material_order_status not null default 'draft',
  ordered_at           timestamptz,
  expected_delivery_at timestamptz,
  notes                text,
  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now(),

  constraint material_orders_cost_code_project_fk
    foreign key (cost_code_id, project_id) references cost_codes(id, project_id)
);

alter table material_orders enable row level security;

create policy material_orders_staff_full_access on material_orders
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

create trigger audit_material_orders after insert or update or delete on material_orders
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Material order line items: per-line receiving/backorder tracking, per
-- P5-DESIGN.md Decision 6.
-- ---------------------------------------------------------------------
create table material_order_line_items (
  id                 uuid primary key default uuid_generate_v4(),
  material_order_id uuid not null references material_orders(id) on delete cascade,
  description        text not null,
  quantity           numeric not null,
  unit               text,
  unit_price_cents   bigint not null,
  received_quantity  numeric not null default 0,
  backordered        boolean not null default false,
  created_at         timestamptz not null default now(),

  constraint material_order_line_items_quantity_positive check (quantity > 0),
  constraint material_order_line_items_unit_price_nonnegative check (unit_price_cents >= 0),
  constraint material_order_line_items_received_nonnegative check (received_quantity >= 0),
  constraint material_order_line_items_received_not_over check (received_quantity <= quantity)
);

alter table material_order_line_items enable row level security;

create policy material_order_line_items_staff_full_access on material_order_line_items
  for all to authenticated
  using (
    is_org_staff((select project_id from material_orders where id = material_order_line_items.material_order_id))
  )
  with check (
    is_org_staff((select project_id from material_orders where id = material_order_line_items.material_order_id))
  );

create or replace function public.log_audit_via_material_order() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from material_orders
  where id = coalesce(new.material_order_id, old.material_order_id);

  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, before_data, after_data)
  values (
    v_project_id,
    tg_table_name,
    case tg_op when 'DELETE' then old.id else new.id end,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.log_audit_via_material_order() from public;

create trigger audit_material_order_line_items after insert or update or delete on material_order_line_items
  for each row execute function public.log_audit_via_material_order();

-- ---------------------------------------------------------------------
-- award_bid(): claims a submitted bid, inserts the FIRST committed_costs
-- row for it (source_type='bid_award'), declines siblings, closes the
-- package. security invoker — caller already has direct RLS access to
-- every table touched; this exists purely for cross-row atomicity, same
-- reasoning as supersede_committed_cost() (schema/003).
-- ---------------------------------------------------------------------
create or replace function public.award_bid(p_bid_submission_id uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_submission bid_submissions%rowtype;
  v_package bid_packages%rowtype;
  v_committed_cost_id uuid;
begin
  select * into v_submission from bid_submissions where id = p_bid_submission_id for update;
  if not found then
    raise exception 'Bid submission % not found', p_bid_submission_id;
  end if;
  if v_submission.status <> 'submitted' then
    raise exception 'Bid submission % must be in status ''submitted'' to award (currently %)',
      p_bid_submission_id, v_submission.status;
  end if;

  select * into v_package from bid_packages where id = v_submission.bid_package_id for update;

  insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, source_type, source_id)
  select bp.project_id, bp.cost_code_id, v.name, v_submission.amount_cents, 'bid_award', v_submission.id
  from bid_packages bp join vendors v on v.id = v_submission.vendor_id
  where bp.id = v_package.id
  returning id into v_committed_cost_id;

  update bid_submissions set status = 'awarded' where id = v_submission.id;
  update bid_submissions set status = 'declined'
    where bid_package_id = v_package.id and id <> v_submission.id and status = 'submitted';
  update bid_packages set status = 'awarded' where id = v_package.id;

  return v_committed_cost_id;
end;
$$;

revoke all on function public.award_bid(uuid) from public;
grant execute on function public.award_bid(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- commit_material_order(): claims a draft order, sums its line items,
-- inserts the FIRST committed_costs row for it
-- (source_type='material_order'). Same atomicity reasoning as award_bid.
-- ---------------------------------------------------------------------
create or replace function public.commit_material_order(p_material_order_id uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_order material_orders%rowtype;
  v_total bigint;
  v_vendor_name text;
  v_committed_cost_id uuid;
begin
  select * into v_order from material_orders where id = p_material_order_id for update;
  if not found then
    raise exception 'Material order % not found', p_material_order_id;
  end if;
  if v_order.status <> 'draft' then
    raise exception 'Material order % must be in status ''draft'' to commit (currently %)',
      p_material_order_id, v_order.status;
  end if;

  select coalesce(sum(quantity * unit_price_cents), 0)::bigint into v_total
  from material_order_line_items where material_order_id = v_order.id;
  if v_total = 0 then
    raise exception 'Material order % has no line items to commit', p_material_order_id;
  end if;

  select name into v_vendor_name from vendors where id = v_order.vendor_id;

  insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, source_type, source_id)
  values (v_order.project_id, v_order.cost_code_id, v_vendor_name, v_total, 'material_order', v_order.id)
  returning id into v_committed_cost_id;

  update material_orders set status = 'ordered', ordered_at = now() where id = v_order.id;

  return v_committed_cost_id;
end;
$$;

revoke all on function public.commit_material_order(uuid) from public;
grant execute on function public.commit_material_order(uuid) to authenticated;
```

- [ ] **Step 2: Write `schema/015_commitments_bids_procurement_down.sql`**

```sql
drop function if exists public.commit_material_order(uuid);
drop function if exists public.award_bid(uuid);

drop trigger if exists audit_material_order_line_items on material_order_line_items;
drop function if exists public.log_audit_via_material_order();
drop table if exists material_order_line_items;

drop trigger if exists audit_material_orders on material_orders;
drop table if exists material_orders;
drop type if exists material_order_status;

drop trigger if exists audit_bid_addenda on bid_addenda;
drop table if exists bid_addenda;

drop trigger if exists audit_bid_questions on bid_questions;
drop table if exists bid_questions;

drop trigger if exists audit_bid_submissions on bid_submissions;
drop function if exists public.log_audit_via_bid_package();
drop table if exists bid_submissions;
drop type if exists bid_submission_status;

drop trigger if exists audit_bid_packages on bid_packages;
drop table if exists bid_packages;
drop type if exists bid_package_status;

alter table vendors drop column if exists profile_id;
```

- [ ] **Step 3: Mirror both files into `supabase/migrations/20260814000000_commitments_bids_procurement.sql`**

Concatenate the up-migration body from Step 1 into this single timestamped file, matching the existing 001–014 mirroring convention (check `supabase/migrations/` naming for the 014 mirror's exact timestamp-increment convention and follow it exactly).

- [ ] **Step 4: Run migration 015 against the ephemeral PGlite test harness to confirm it applies cleanly**

Run: `node scripts/db/run-sql-tests.mjs` (after also completing Task 2's addition to `FILES`, since an empty test file addition is still required for this step to be meaningful — if doing Steps 1-3 in isolation first, temporarily add just `schema/015_commitments_bids_procurement.sql` to `FILES` to confirm it applies, then proceed to Task 2 for the real test file)
Expected: migration applies with no errors.

- [ ] **Step 5: Commit**

```bash
git add schema/015_commitments_bids_procurement.sql schema/015_commitments_bids_procurement_down.sql supabase/migrations/20260814000000_commitments_bids_procurement.sql
git commit -m "feat(P5): migration 015 — commitments, bids, procurement schema"
```

---

### Task 2: SQL tests for migration 015

**Files:**
- Create: `tests/sql/package_p5_commitments_bids_procurement_tests.sql`
- Modify: `scripts/db/run-sql-tests.mjs` (add `schema/015_commitments_bids_procurement.sql` and `tests/sql/package_p5_commitments_bids_procurement_tests.sql` to `FILES`, positioned after the P4 entries)

**Interfaces:**
- Consumes: `set_test_user`/`clear_test_user`/`assert_that`/`assert_raises`/`test_fixture_ids` helpers (`tests/sql/package1_tests.sql`); fixtures `admin`, `org_b_admin`, `project_a`, `cost_code_a` (reused, per P4's own precedent).
- Produces: a new vendor-session fixture (`vendor_a_profile`, `vendor_a_record`) other future test files may reuse.

- [ ] **Step 1: Add migration + test file to `scripts/db/run-sql-tests.mjs`'s `FILES` array**

```js
// after "schema/014_import_amount_canonicalization_and_audit_attribution.sql"
"schema/015_commitments_bids_procurement.sql",
// after "tests/sql/package_p4_estimating_qb_import_tests.sql"
"tests/sql/package_p5_commitments_bids_procurement_tests.sql",
```

- [ ] **Step 2: Write `tests/sql/package_p5_commitments_bids_procurement_tests.sql` — Section 1 (composite-FK + staff RLS + cross-org isolation)**

```sql
-- =====================================================================
-- Stone Column Portal — P5 (Commitments, Bids, Procurement) SQL/RLS
-- test suite, covering schema/015_commitments_bids_procurement.sql.
-- Runs after schema/001-015 and after package1_tests.sql /
-- package_p1_auth_tests.sql / package_p4_estimating_qb_import_tests.sql
-- (via scripts/db/run-sql-tests.mjs), reusing the set_test_user()/
-- clear_test_user()/assert_that()/assert_raises()/test_fixture_ids
-- helpers already established in tests/sql/package1_tests.sql.
--
-- Reused fixtures: 'admin' (org A's admin), 'org_b_admin'
-- (package_p1_auth_tests.sql), 'project_a', 'cost_code_a'
-- (package1_tests.sql SECTION 2).
-- =====================================================================

-- =====================================================================
-- SECTION 1 — bid_packages/material_orders: composite FK + staff RLS +
-- cross-org isolation.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_bid_package_id uuid;
  v_material_order_id uuid;
  v_vendor_id uuid;
begin
  insert into bid_packages (project_id, cost_code_id, title, scope_description)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Framing Bid Package', 'Full framing scope'
  from test_fixture_ids where key = 'project_a'
  returning id into v_bid_package_id;
  insert into test_fixture_ids values ('bid_package_a', v_bid_package_id);

  perform assert_that(
    (select count(*) from bid_packages where id = v_bid_package_id) = 1,
    'org A admin can create a bid package'
  );

  insert into vendors (org_id, name)
  select org_id, 'Acme Framing' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_vendor_id;
  insert into test_fixture_ids values ('vendor_a', v_vendor_id);

  insert into material_orders (project_id, cost_code_id, vendor_id, order_number)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), v_vendor_id, 'PO-1001'
  from test_fixture_ids where key = 'project_a'
  returning id into v_material_order_id;
  insert into test_fixture_ids values ('material_order_a', v_material_order_id);

  perform assert_that(
    (select count(*) from material_orders where id = v_material_order_id) = 1,
    'org A admin can create a material order'
  );

  insert into test_fixture_ids
  select 'org_a_id', org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 0,
    'org B admin cannot see org A''s bid package'
  );
  perform assert_that(
    (select count(*) from material_orders where id = (select value from test_fixture_ids where key = 'material_order_a')) = 0,
    'org B admin cannot see org A''s material order'
  );
end $$;

reset role;
select clear_test_user();
```

- [ ] **Step 3: Run to verify Section 1 passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: all assertions pass, no errors.

- [ ] **Step 4: Append Section 2 — vendor RLS, both required isolation axes**

```sql
-- =====================================================================
-- SECTION 2 — vendor RLS. First real exercise of is_project_vendor()
-- through an actual policy (schema/007 reserved it for this).
-- Both required axes per PRODUCTION-ROADMAP.md's vendor-RLS-sequencing
-- rule item 5: cross-project AND cross-vendor isolation.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_vendor_a_user uuid := gen_random_uuid();
  v_vendor_b_user uuid := gen_random_uuid();
  v_bid_submission_a uuid;
  v_second_bid_package uuid;
  v_second_vendor uuid;
begin
  -- Give vendor_a a real profile + project_members row + vendors.profile_id link.
  insert into profiles (id, org_id, role, full_name, email)
  select v_vendor_a_user, org_id, 'vendor', 'Acme Framing Contact', 'acme@example.com'
  from profiles where id = (select value from test_fixture_ids where key = 'admin');
  insert into project_members (project_id, user_id, member_role)
  select value, v_vendor_a_user, 'vendor' from test_fixture_ids where key = 'project_a';
  update vendors set profile_id = v_vendor_a_user
  where id = (select value from test_fixture_ids where key = 'vendor_a');
  insert into test_fixture_ids values ('vendor_a_user', v_vendor_a_user);

  -- A second vendor on the SAME project, invited to a DIFFERENT package —
  -- proves cross-vendor isolation, not just cross-project.
  insert into vendors (org_id, name)
  select org_id, 'Beta Electric' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_second_vendor;
  insert into profiles (id, org_id, role, full_name, email)
  select v_vendor_b_user, org_id, 'vendor', 'Beta Electric Contact', 'beta@example.com'
  from profiles where id = (select value from test_fixture_ids where key = 'admin');
  insert into project_members (project_id, user_id, member_role)
  select value, v_vendor_b_user, 'vendor' from test_fixture_ids where key = 'project_a';
  update vendors set profile_id = v_vendor_b_user where id = v_second_vendor;
  insert into test_fixture_ids values ('vendor_b_user', v_vendor_b_user);

  insert into bid_packages (project_id, cost_code_id, title, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Electrical Bid Package', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_second_bid_package;
  insert into test_fixture_ids values ('bid_package_electrical', v_second_bid_package);

  -- vendor_a is invited to bid_package_a only; vendor_b to the electrical package only.
  insert into bid_submissions (bid_package_id, vendor_id)
  values ((select value from test_fixture_ids where key = 'bid_package_a'), (select value from test_fixture_ids where key = 'vendor_a'))
  returning id into v_bid_submission_a;
  insert into test_fixture_ids values ('bid_submission_a', v_bid_submission_a);

  insert into bid_submissions (bid_package_id, vendor_id)
  values (v_second_bid_package, v_second_vendor);

  update bid_packages set status = 'published' where id = (select value from test_fixture_ids where key = 'bid_package_a');
end $$;

reset role;
select clear_test_user();

-- Cross-project isolation: create a second project's bid package, confirm
-- vendor_a (only a member of project_a) sees nothing on it.
select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_project_b uuid;
  v_cost_code_b uuid;
begin
  insert into projects (org_id, name, project_number)
  select org_id, 'Second Project', 'P-002' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_project_b;
  insert into cost_codes (project_id, code, name)
  values (v_project_b, '06-100', 'Framing')
  returning id into v_cost_code_b;
  insert into bid_packages (project_id, cost_code_id, title, status)
  values (v_project_b, v_cost_code_b, 'Other Project Framing', 'published');
  insert into test_fixture_ids values ('project_b_id', v_project_b);
end $$;

reset role;
select clear_test_user();

-- Vendor A's own session.
select set_test_user((select value from test_fixture_ids where key = 'vendor_a_user'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 1,
    'vendor A can see the bid package they are invited to'
  );
  perform assert_that(
    (select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_electrical')) = 0,
    'vendor A (cross-vendor) sees nothing belonging to vendor B on the same project'
  );
  perform assert_that(
    (select count(*) from bid_packages where project_id = (select value from test_fixture_ids where key = 'project_b_id')) = 0,
    'vendor A (cross-project) sees nothing on a project they are not a member of'
  );
  perform assert_that(
    (select count(*) from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 1,
    'vendor A can read their own bid_submissions row'
  );
end $$;

reset role;
select clear_test_user();
```

- [ ] **Step 5: Run to verify Section 2 passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: all four vendor-isolation assertions pass.

- [ ] **Step 6: Append Section 3 — constraints, `award_bid()`, `commit_material_order()`**

```sql
-- =====================================================================
-- SECTION 3 — constraints, award_bid(), commit_material_order().
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- bid_submissions_one_per_vendor_per_package
select assert_raises(
  $sql$insert into bid_submissions (bid_package_id, vendor_id)
       values (
         (select value from test_fixture_ids where key = 'bid_package_a'),
         (select value from test_fixture_ids where key = 'vendor_a')
       )$sql$,
  'a second invite of the same vendor to the same bid package must be rejected'
);

-- bid_submissions_amount_set_when_submitted
select assert_raises(
  $sql$update bid_submissions set status = 'submitted'
       where id = (select value from test_fixture_ids where key = 'bid_submission_a')$sql$,
  'submitting a bid without an amount must be rejected'
);

do $$
begin
  update bid_submissions set status = 'submitted', amount_cents = 4_500_000, submitted_at = now()
  where id = (select value from test_fixture_ids where key = 'bid_submission_a');

  perform assert_that(
    (select status from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 'submitted',
    'a properly-amounted submission is accepted'
  );
end $$;

-- award_bid(): reject a non-'submitted' submission first.
do $$
declare
  v_second_submission_id uuid;
begin
  select id into v_second_submission_id from bid_submissions
  where bid_package_id = (select value from test_fixture_ids where key = 'bid_package_electrical');

  perform assert_raises(
    format('select award_bid(%L)', v_second_submission_id),
    'awarding a submission still in status ''invited'' must be rejected'
  );
end $$;

-- award_bid(): happy path.
do $$
declare
  v_committed_cost_id uuid;
  v_pkg_status bid_package_status;
begin
  select award_bid((select value from test_fixture_ids where key = 'bid_submission_a')) into v_committed_cost_id;
  insert into test_fixture_ids values ('committed_cost_from_award', v_committed_cost_id);

  perform assert_that(
    (select status from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 'awarded',
    'awarded submission moves to status awarded'
  );
  perform assert_that(
    (select status from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 'awarded',
    'bid package moves to status awarded'
  );
  perform assert_that(
    (select source_type from committed_costs where id = v_committed_cost_id) = 'bid_award',
    'the new committed_costs row is tagged source_type=bid_award'
  );
  perform assert_that(
    (select amount_cents from committed_costs where id = v_committed_cost_id) = 4_500_000,
    'the committed_costs amount matches the awarded bid amount'
  );
end $$;

-- award_bid(): re-awarding the same (now-awarded) submission is rejected.
select assert_raises(
  format('select award_bid(%L)', (select value from test_fixture_ids where key = 'bid_submission_a')),
  'awarding an already-awarded submission must be rejected'
);

-- material_order_line_items_received_not_over
do $$
declare
  v_line_item_id uuid;
begin
  insert into material_order_line_items (material_order_id, description, quantity, unit, unit_price_cents)
  values ((select value from test_fixture_ids where key = 'material_order_a'), '2x6 Lumber', 100, 'ea', 850)
  returning id into v_line_item_id;
  insert into test_fixture_ids values ('material_order_line_a', v_line_item_id);

  perform assert_raises(
    format('update material_order_line_items set received_quantity = 150 where id = %L', v_line_item_id),
    'received_quantity greater than quantity must be rejected'
  );
end $$;

-- commit_material_order(): rejects an order with zero line items.
do $$
declare
  v_empty_order_id uuid;
begin
  insert into material_orders (project_id, cost_code_id, vendor_id)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), (select value from test_fixture_ids where key = 'vendor_a')
  from test_fixture_ids where key = 'project_a'
  returning id into v_empty_order_id;

  perform assert_raises(
    format('select commit_material_order(%L)', v_empty_order_id),
    'committing a material order with no line items must be rejected'
  );
end $$;

-- commit_material_order(): happy path.
do $$
declare
  v_committed_cost_id uuid;
begin
  select commit_material_order((select value from test_fixture_ids where key = 'material_order_a')) into v_committed_cost_id;

  perform assert_that(
    (select status from material_orders where id = (select value from test_fixture_ids where key = 'material_order_a')) = 'ordered',
    'committed material order moves to status ordered'
  );
  perform assert_that(
    (select source_type from committed_costs where id = v_committed_cost_id) = 'material_order',
    'the new committed_costs row is tagged source_type=material_order'
  );
  perform assert_that(
    (select amount_cents from committed_costs where id = v_committed_cost_id) = 100 * 850,
    'the committed_costs amount matches the sum of line items (quantity * unit_price_cents)'
  );
end $$;

-- commit_material_order(): rejects committing a non-draft order (already ordered above).
select assert_raises(
  format('select commit_material_order(%L)', (select value from test_fixture_ids where key = 'material_order_a')),
  'committing an already-ordered material order must be rejected'
);

reset role;
select clear_test_user();
```

- [ ] **Step 7: Run to verify Section 3 passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: all constraint/RPC assertions pass.

- [ ] **Step 8: Append Section 4 — audit visibility**

```sql
-- =====================================================================
-- SECTION 4 — audit visibility: every new/altered table produces a
-- real, staff-readable audit_log row (same bar P4 set).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from audit_log where table_name = 'bid_packages'
      and record_id = (select value from test_fixture_ids where key = 'bid_package_a')) > 0,
    'bid_packages insert produced a readable audit_log row'
  );
  perform assert_that(
    (select count(*) from audit_log where table_name = 'bid_submissions'
      and record_id = (select value from test_fixture_ids where key = 'bid_submission_a')) > 0,
    'bid_submissions insert produced a readable audit_log row'
  );
  perform assert_that(
    (select count(*) from audit_log where table_name = 'material_orders'
      and record_id = (select value from test_fixture_ids where key = 'material_order_a')) > 0,
    'material_orders insert produced a readable audit_log row'
  );
  perform assert_that(
    (select count(*) from audit_log where table_name = 'material_order_line_items'
      and record_id = (select value from test_fixture_ids where key = 'material_order_line_a')) > 0,
    'material_order_line_items insert produced a readable audit_log row'
  );
end $$;

reset role;
select clear_test_user();
```

- [ ] **Step 9: Run full P5 test file + full existing suite together**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: every file in `FILES` (000 through the new P5 test file) passes, including `committed_forecast_hardening_tests.sql` still passing unchanged (proves `supersede_committed_cost()` is unaffected by the new writes).

- [ ] **Step 10: Commit**

```bash
git add tests/sql/package_p5_commitments_bids_procurement_tests.sql scripts/db/run-sql-tests.mjs
git commit -m "test(P5): SQL/RLS test suite for migration 015"
```

---

### Task 3: Extend `CommittedCost` type + repository mapping for vendor/source display

**Files:**
- Modify: `packages/01-financial-engine/src/types.ts` (`CommittedCost` interface)
- Modify: `packages/02-app-shell/src/data/supabaseFinancialRepository.ts` (`getCommittedCosts` mapping)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CommittedCost.vendorName?: string`, `CommittedCost.sourceType?: string`, `CommittedCost.sourceId?: string` — optional, display-only fields the financial engine's own math never reads (mirrors `Expense.vendorName`, which is not a `computeCategoryFinancials` input either). Consumed by Task 7's `/admin/commitments` screen.

- [ ] **Step 1: Add the three optional fields to `CommittedCost` in `packages/01-financial-engine/src/types.ts`**

```typescript
export interface CommittedCost {
  id: ID;
  projectId: ID;
  costCodeId: ID;
  amountCents: Cents;
  status: "open" | "fulfilled" | "cancelled";
  supersededAt?: ISODate | null;   // set when partially invoiced / replaced by a new row
  supersededById?: ID | null;
  vendorName?: string;             // display-only, mirrors Expense.vendorName — not a computeCategoryFinancials input
  sourceType?: string;             // e.g. "bid_award" | "material_order" — display-only provenance
  sourceId?: ID;                   // e.g. the awarding bid_submissions.id or committing material_orders.id
}
```

- [ ] **Step 2: Run typecheck to confirm the additive change compiles everywhere `CommittedCost` is constructed**

Run: `npm run typecheck`
Expected: PASS — the new fields are optional, so `hawksRidge.committedCosts`'s existing fixture row (`{ id: "cm1", ... status: "open" }`, no vendor/source fields) still satisfies the type with no fixture change required.

- [ ] **Step 3: Extend `getCommittedCosts` in `supabaseFinancialRepository.ts` to map the new columns**

```typescript
  async getCommittedCosts(projectId: string) {
    const { data, error } = await this.client.from("committed_costs").select("*").eq("project_id", projectId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      costCodeId: row.cost_code_id,
      amountCents: row.amount_cents,
      status: row.status,
      supersededAt: row.superseded_at,
      supersededById: row.superseded_by_id,
      vendorName: row.vendor_name ?? undefined,
      sourceType: row.source_type ?? undefined,
      sourceId: row.source_id ?? undefined,
    }));
  }
```

- [ ] **Step 4: Run typecheck + existing financial-engine unit tests to confirm no regression**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/01-financial-engine/src/types.ts packages/02-app-shell/src/data/supabaseFinancialRepository.ts
git commit -m "feat(P5): surface committed_costs vendor/source fields for display"
```

---

### Task 4: Bid package service functions + thin Server Actions

**Files:**
- Create: `packages/02-app-shell/src/services/bidService.ts`
- Create: `apps/web/app/admin/bids/actions.ts`

**Interfaces:**
- Consumes: `SupabaseClient` (injected, caller's own session).
- Produces: `createBidPackage`, `publishBidPackage`, `inviteVendor`, `listBidPackages`, `getBidPackageDetail` — consumed by Task 6's `/admin/bids` screen.

- [ ] **Step 1: Write `packages/02-app-shell/src/services/bidService.ts` (package-management half)**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BidPackageRow {
  id: string;
  projectId: string;
  costCodeId: string;
  title: string;
  scopeDescription: string | null;
  dueAt: string | null;
  status: "draft" | "published" | "awarded" | "cancelled";
  createdAt: string;
}

function mapBidPackage(row: any): BidPackageRow {
  return {
    id: row.id,
    projectId: row.project_id,
    costCodeId: row.cost_code_id,
    title: row.title,
    scopeDescription: row.scope_description,
    dueAt: row.due_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listBidPackages(supabase: SupabaseClient, projectId: string): Promise<BidPackageRow[]> {
  const { data, error } = await supabase.from("bid_packages").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapBidPackage);
}

export async function createBidPackage(
  supabase: SupabaseClient,
  projectId: string,
  costCodeId: string,
  title: string,
  scopeDescription?: string,
  dueAt?: string
) {
  if (!title.trim()) {
    return { error: "Title is required." };
  }
  const { data, error } = await supabase
    .from("bid_packages")
    .insert({ project_id: projectId, cost_code_id: costCodeId, title: title.trim(), scope_description: scopeDescription ?? null, due_at: dueAt ?? null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

export async function publishBidPackage(supabase: SupabaseClient, bidPackageId: string) {
  const { error } = await supabase.from("bid_packages").update({ status: "published" }).eq("id", bidPackageId).eq("status", "draft");
  if (error) return { error: error.message };
  return {};
}
```

- [ ] **Step 2: Append the invite/detail read functions to the same file**

```typescript
export interface BidSubmissionRow {
  id: string;
  bidPackageId: string;
  vendorId: string;
  vendorName: string;
  status: "invited" | "submitted" | "awarded" | "declined" | "withdrawn";
  amountCents: number | null;
  notes: string | null;
  submittedAt: string | null;
}

export interface BidPackageDetail extends BidPackageRow {
  submissions: BidSubmissionRow[];
}

export async function inviteVendor(supabase: SupabaseClient, bidPackageId: string, vendorId: string) {
  const { error } = await supabase.from("bid_submissions").insert({ bid_package_id: bidPackageId, vendor_id: vendorId });
  if (error) return { error: error.message };
  return {};
}

export async function getBidPackageDetail(supabase: SupabaseClient, bidPackageId: string): Promise<BidPackageDetail | null> {
  const { data: pkgRow, error: pkgError } = await supabase.from("bid_packages").select("*").eq("id", bidPackageId).maybeSingle();
  if (pkgError) throw pkgError;
  if (!pkgRow) return null;

  const { data: subRows, error: subError } = await supabase
    .from("bid_submissions")
    .select("id, bid_package_id, vendor_id, status, amount_cents, notes, submitted_at, vendors(name)")
    .eq("bid_package_id", bidPackageId);
  if (subError) throw subError;

  return {
    ...mapBidPackage(pkgRow),
    submissions: (subRows ?? []).map((row: any) => ({
      id: row.id,
      bidPackageId: row.bid_package_id,
      vendorId: row.vendor_id,
      vendorName: row.vendors?.name ?? "Unknown vendor",
      status: row.status,
      amountCents: row.amount_cents,
      notes: row.notes,
      submittedAt: row.submitted_at,
    })),
  };
}
```

- [ ] **Step 3: Write thin Server Actions in `apps/web/app/admin/bids/actions.ts`**

```typescript
"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  createBidPackage as createBidPackageService,
  publishBidPackage as publishBidPackageService,
  inviteVendor as inviteVendorService,
} from "../../../../../packages/02-app-shell/src/services/bidService";

export async function createBidPackage(projectId: string, costCodeId: string, title: string, scopeDescription?: string, dueAt?: string) {
  const supabase = await createServerSupabaseClient();
  return createBidPackageService(supabase, projectId, costCodeId, title, scopeDescription, dueAt);
}

export async function publishBidPackage(bidPackageId: string) {
  const supabase = await createServerSupabaseClient();
  return publishBidPackageService(supabase, bidPackageId);
}

export async function inviteVendor(bidPackageId: string, vendorId: string) {
  const supabase = await createServerSupabaseClient();
  return inviteVendorService(supabase, bidPackageId, vendorId);
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/02-app-shell/src/services/bidService.ts apps/web/app/admin/bids/actions.ts
git commit -m "feat(P5): bid package service functions + Server Actions"
```

---

### Task 5: Bid submission recording + award service functions + thin Server Actions

**Files:**
- Modify: `packages/02-app-shell/src/services/bidService.ts` (append)
- Create: `apps/web/app/admin/bids/submissionActions.ts`

**Interfaces:**
- Consumes: `BidSubmissionRow` (Task 4).
- Produces: `recordBidSubmission`, `awardBid`, `askBidQuestion`, `answerBidQuestion`, `issueBidAddendum` — consumed by Task 6.

- [ ] **Step 1: Append to `packages/02-app-shell/src/services/bidService.ts`**

```typescript
export async function recordBidSubmission(supabase: SupabaseClient, bidSubmissionId: string, amountCents: number, notes?: string) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return { error: "Amount must be a whole number of cents, zero or greater." };
  }
  const { error } = await supabase
    .from("bid_submissions")
    .update({ status: "submitted", amount_cents: amountCents, notes: notes ?? null, submitted_at: new Date().toISOString() })
    .eq("id", bidSubmissionId)
    .eq("status", "invited");
  if (error) return { error: error.message };
  return {};
}

export async function awardBid(supabase: SupabaseClient, bidSubmissionId: string) {
  const { data, error } = await supabase.rpc("award_bid", { p_bid_submission_id: bidSubmissionId });
  if (error) return { error: error.message };
  return { committedCostId: data as string };
}

export async function askBidQuestion(supabase: SupabaseClient, bidPackageId: string, vendorId: string, questionText: string) {
  if (!questionText.trim()) return { error: "Question text is required." };
  const { error } = await supabase.from("bid_questions").insert({ bid_package_id: bidPackageId, vendor_id: vendorId, question_text: questionText.trim() });
  if (error) return { error: error.message };
  return {};
}

export async function answerBidQuestion(supabase: SupabaseClient, bidQuestionId: string, answerText: string) {
  if (!answerText.trim()) return { error: "Answer text is required." };
  const { error } = await supabase
    .from("bid_questions")
    .update({ answer_text: answerText.trim(), answered_at: new Date().toISOString() })
    .eq("id", bidQuestionId);
  if (error) return { error: error.message };
  return {};
}

export async function issueBidAddendum(supabase: SupabaseClient, bidPackageId: string, title: string, bodyText: string, revisedDueAt?: string) {
  if (!title.trim() || !bodyText.trim()) return { error: "Title and body are required." };
  const { error } = await supabase
    .from("bid_addenda")
    .insert({ bid_package_id: bidPackageId, title: title.trim(), body_text: bodyText.trim(), revised_due_at: revisedDueAt ?? null });
  if (error) return { error: error.message };
  if (revisedDueAt) {
    const { error: dueDateError } = await supabase.from("bid_packages").update({ due_at: revisedDueAt }).eq("id", bidPackageId);
    if (dueDateError) return { error: dueDateError.message };
  }
  return {};
}
```

- [ ] **Step 2: Write thin Server Actions in `apps/web/app/admin/bids/submissionActions.ts`**

```typescript
"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  recordBidSubmission as recordBidSubmissionService,
  awardBid as awardBidService,
  askBidQuestion as askBidQuestionService,
  answerBidQuestion as answerBidQuestionService,
  issueBidAddendum as issueBidAddendumService,
} from "../../../../../packages/02-app-shell/src/services/bidService";

export async function recordBidSubmission(bidSubmissionId: string, amountCents: number, notes?: string) {
  const supabase = await createServerSupabaseClient();
  return recordBidSubmissionService(supabase, bidSubmissionId, amountCents, notes);
}

export async function awardBid(bidSubmissionId: string) {
  const supabase = await createServerSupabaseClient();
  return awardBidService(supabase, bidSubmissionId);
}

export async function askBidQuestion(bidPackageId: string, vendorId: string, questionText: string) {
  const supabase = await createServerSupabaseClient();
  return askBidQuestionService(supabase, bidPackageId, vendorId, questionText);
}

export async function answerBidQuestion(bidQuestionId: string, answerText: string) {
  const supabase = await createServerSupabaseClient();
  return answerBidQuestionService(supabase, bidQuestionId, answerText);
}

export async function issueBidAddendum(bidPackageId: string, title: string, bodyText: string, revisedDueAt?: string) {
  const supabase = await createServerSupabaseClient();
  return issueBidAddendumService(supabase, bidPackageId, title, bodyText, revisedDueAt);
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/02-app-shell/src/services/bidService.ts apps/web/app/admin/bids/submissionActions.ts
git commit -m "feat(P5): bid submission recording + award service functions"
```

---

### Task 6: `/admin/bids` screen

**Files:**
- Create: `apps/web/app/admin/bids/page.tsx`
- Create: `packages/02-app-shell/src/components/BidPackageList.tsx`
- Create: `packages/02-app-shell/src/components/BidPackageDetail.tsx`

**Interfaces:**
- Consumes: `listBidPackages`, `getBidPackageDetail`, `createBidPackage`, `publishBidPackage`, `inviteVendor`, `recordBidSubmission`, `awardBid`, `askBidQuestion`, `answerBidQuestion`, `issueBidAddendum` (Tasks 4–5); `repo.getCostCodes` (existing `FinancialRepository`).
- Produces: nothing consumed by later tasks (leaf screen).

- [ ] **Step 1: Write `packages/02-app-shell/src/components/BidPackageList.tsx`**

```tsx
"use client";

import React from "react";
import { colors, spacing, typography } from "../design/tokens";
import type { BidPackageRow } from "../services/bidService";

export function BidPackageList({ packages, onSelect }: { packages: BidPackageRow[]; onSelect: (id: string) => void }) {
  return (
    <div className="sc-bid-list">
      {packages.map((p) => (
        <button key={p.id} className="sc-bid-list-row" onClick={() => onSelect(p.id)}>
          <span className="sc-bid-list-title">{p.title}</span>
          <span className="sc-bid-list-status" data-status={p.status}>{p.status}</span>
        </button>
      ))}
      {packages.length === 0 && <p className="sc-bid-list-empty">No bid packages yet.</p>}
      <style>{`
        .sc-bid-list { display: flex; flex-direction: column; gap: 6px; }
        .sc-bid-list-row { display: flex; justify-content: space-between; align-items: center; padding: ${spacing.sm}; border: 1px solid ${colors.line}; border-radius: 8px; background: ${colors.white}; text-align: left; font-size: 13px; }
        .sc-bid-list-title { color: ${colors.ink}; }
        .sc-bid-list-status { font-size: 11px; text-transform: uppercase; color: ${colors.stoneDark}; }
        .sc-bid-list-empty { font-size: 13px; color: ${colors.stoneDark}; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Write `packages/02-app-shell/src/components/BidPackageDetail.tsx`**

```tsx
"use client";

import React, { useState, useTransition } from "react";
import { colors, spacing } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { BidPackageDetail as BidPackageDetailData } from "../services/bidService";

export function BidPackageDetail({
  detail,
  onPublish,
  onAward,
  onRecordSubmission,
}: {
  detail: BidPackageDetailData;
  onPublish: () => Promise<void>;
  onAward: (bidSubmissionId: string) => Promise<void>;
  onRecordSubmission: (bidSubmissionId: string, amountCents: number, notes?: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>({});

  return (
    <div className="sc-bid-detail">
      <div className="sc-bid-detail-head">
        <h2>{detail.title}</h2>
        <span data-status={detail.status}>{detail.status}</span>
      </div>
      {detail.status === "draft" && (
        <button disabled={pending} onClick={() => startTransition(onPublish)}>Publish</button>
      )}
      <table className="sc-bid-detail-table">
        <thead>
          <tr><th>Vendor</th><th>Status</th><th>Amount</th><th>Action</th></tr>
        </thead>
        <tbody>
          {detail.submissions.map((s) => (
            <tr key={s.id}>
              <td>{s.vendorName}</td>
              <td>{s.status}</td>
              <td>{s.amountCents != null ? formatCents(s.amountCents) : "—"}</td>
              <td>
                {s.status === "invited" && (
                  <>
                    <input
                      type="number"
                      placeholder="Amount ($)"
                      value={draftAmounts[s.id] ?? ""}
                      onChange={(e) => setDraftAmounts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    />
                    <button
                      disabled={pending}
                      onClick={() =>
                        startTransition(() => onRecordSubmission(s.id, Math.round(Number(draftAmounts[s.id] ?? "0") * 100)))
                      }
                    >
                      Record
                    </button>
                  </>
                )}
                {s.status === "submitted" && (
                  <button disabled={pending} onClick={() => startTransition(() => onAward(s.id))}>Award</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`
        .sc-bid-detail-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: ${spacing.sm}; }
        .sc-bid-detail-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sc-bid-detail-table th, .sc-bid-detail-table td { border-bottom: 1px solid ${colors.line}; padding: 8px; text-align: left; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Write `apps/web/app/admin/bids/page.tsx`**

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { listBidPackages } from "../../../../../packages/02-app-shell/src/services/bidService";
import { BidPackageList } from "../../../../../packages/02-app-shell/src/components/BidPackageList";

/**
 * "First project" convention, same as /admin/estimate and /admin/import.
 * Real-backend-only, no demo-mode fallback — bid_packages has no fixture
 * equivalent, matching /admin/import's own precedent for import_batches.
 */
export default async function AdminBidsPage() {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();

  const { data: firstProject } = await supabase.from("projects").select("id").eq("org_id", user.orgId).limit(1).maybeSingle();

  if (!firstProject) {
    return (
      <AdminChrome activeKey="bids" isDemoMode={isDemoMode()}>
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  const packages = await listBidPackages(supabase, firstProject.id);

  return (
    <AdminChrome activeKey="bids" isDemoMode={isDemoMode()}>
      <div style={{ padding: 24 }}>
        <h1>Bid Packages</h1>
        <BidPackageListClient initialPackages={packages} projectId={firstProject.id} />
      </div>
    </AdminChrome>
  );
}
```

Note: `BidPackageListClient` is a small client-component wrapper (co-located in the same file's directory) that holds `useState` for the selected package id, fetches detail via a Route Handler or a client-callable Server Action wrapper, and renders `BidPackageList`/`BidPackageDetail`/the create-package form, wiring the Task 4/5 Server Actions to their respective buttons — same shape as `ImportWizard.tsx` wraps `packages/02-app-shell/src/components/*` around the Task-4/5 Server Actions for `/admin/import`. Write it as `packages/02-app-shell/src/components/BidPackageWorkspace.tsx`, following `ImportWizard.tsx`'s exact state-management pattern (local `useState` for selected id + form fields, `startTransition` around each Server Action call, re-fetch detail after a mutating action completes).

- [ ] **Step 4: Add `"bids"` to `AdminChrome`'s nav key type and nav list**

Modify `apps/web/src/shell/AdminChrome.tsx`: add `{ key: "bids", label: "Bids" }` alongside the existing `estimate`/`import` entries, following that file's existing array literal shape exactly (read the file first — Task 6 implementer must open it to match the exact existing entry shape before adding a new one).

- [ ] **Step 5: Start the dev server and manually verify the golden path in a browser**

Run: `npm run dev`, navigate to `/admin/bids` as a logged-in admin/staff user, create a bid package, invite a vendor, record a submission, award it, and confirm the resulting `committed_costs` row appears (cross-check against Task 7's `/admin/commitments` screen once that task is done, or a direct Supabase query in the interim).

- [ ] **Step 6: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/admin/bids packages/02-app-shell/src/components/BidPackageList.tsx packages/02-app-shell/src/components/BidPackageDetail.tsx packages/02-app-shell/src/components/BidPackageWorkspace.tsx apps/web/src/shell/AdminChrome.tsx
git commit -m "feat(P5): /admin/bids screen"
```

---

### Task 7: `/admin/commitments` screen

**Files:**
- Create: `apps/web/app/admin/commitments/page.tsx`
- Create: `apps/web/app/admin/commitments/actions.ts`
- Create: `packages/02-app-shell/src/components/CommitmentsTable.tsx`

**Interfaces:**
- Consumes: `repo.getCommittedCosts` (existing `FinancialRepository`, now returning `vendorName`/`sourceType`/`sourceId` per Task 3); existing `supersede_committed_cost` RPC (schema/003, unmodified).
- Produces: nothing consumed by later tasks (leaf screen).

- [ ] **Step 1: Write the thin Server Action wrapping the existing RPC in `apps/web/app/admin/commitments/actions.ts`**

```typescript
"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";

export async function supersedeCommittedCost(
  oldCommittedCostId: string,
  newAmountCents: number,
  newVendorName?: string
) {
  if (!Number.isInteger(newAmountCents) || newAmountCents < 0) {
    return { error: "Amount must be a whole number of cents, zero or greater." };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("supersede_committed_cost", {
    p_old_id: oldCommittedCostId,
    p_new_amount_cents: newAmountCents,
    p_new_vendor_name: newVendorName ?? null,
  });
  if (error) return { error: error.message };
  return { newCommittedCostId: data as string };
}
```

- [ ] **Step 2: Write `packages/02-app-shell/src/components/CommitmentsTable.tsx`**

```tsx
"use client";

import React, { useState, useTransition } from "react";
import { colors, spacing } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { CommittedCost } from "../../../01-financial-engine/src/types";

export function CommitmentsTable({
  committedCosts,
  onSupersede,
}: {
  committedCosts: CommittedCost[];
  onSupersede: (oldId: string, newAmountCents: number, newVendorName?: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftAmount, setDraftAmount] = useState("");

  const openRows = committedCosts.filter((c) => c.status === "open");

  return (
    <table className="sc-commitments-table">
      <thead>
        <tr><th>Vendor</th><th>Source</th><th>Amount</th><th>Status</th><th>Action</th></tr>
      </thead>
      <tbody>
        {openRows.map((c) => (
          <tr key={c.id}>
            <td>{c.vendorName ?? "—"}</td>
            <td>{c.sourceType ?? "manual"}</td>
            <td>{formatCents(c.amountCents)}</td>
            <td>{c.status}</td>
            <td>
              {editingId === c.id ? (
                <>
                  <input type="number" placeholder="New amount ($)" value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)} />
                  <button
                    disabled={pending}
                    onClick={() => startTransition(() => onSupersede(c.id, Math.round(Number(draftAmount) * 100), c.vendorName))}
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <button onClick={() => { setEditingId(c.id); setDraftAmount(""); }}>Supersede</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      <style>{`
        .sc-commitments-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sc-commitments-table th, .sc-commitments-table td { border-bottom: 1px solid ${colors.line}; padding: 8px; text-align: left; }
      `}</style>
    </table>
  );
}
```

- [ ] **Step 3: Write `apps/web/app/admin/commitments/page.tsx`**

Follows `/admin/estimate/page.tsx`'s exact `getRepository()`/demo-mode pattern (this screen DOES have a fixture equivalent — `hawksRidge.committedCosts` — unlike `/admin/bids`/`/admin/procurement`, so it keeps the demo-mode fallback):

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { projectMeta as demoProjectMeta } from "../../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { CommitmentsTable } from "../../../../../packages/02-app-shell/src/components/CommitmentsTable";
import { supersedeCommittedCost } from "./actions";

export default async function AdminCommitmentsPage() {
  const user = await requireRole(["admin", "staff"]);
  const demo = isDemoMode();
  const supabase = demo ? null : await createServerSupabaseClient();
  const repo = getRepository(supabase);

  const projectId = demo
    ? demoProjectMeta.id
    : (await supabase!.from("projects").select("id").eq("org_id", user.orgId).limit(1).maybeSingle()).data?.id;

  if (!projectId) {
    return (
      <AdminChrome activeKey="commitments" isDemoMode={demo}>
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  const committedCosts = await repo.getCommittedCosts(projectId);

  return (
    <AdminChrome activeKey="commitments" isDemoMode={demo}>
      <div style={{ padding: 24 }}>
        <h1>Commitments</h1>
        <CommitmentsTable committedCosts={committedCosts} onSupersede={async (id, amt, vendor) => { await supersedeCommittedCost(id, amt, vendor); }} />
      </div>
    </AdminChrome>
  );
}
```

- [ ] **Step 4: Add `"commitments"` to `AdminChrome`'s nav**

Same as Task 6 Step 4, add `{ key: "commitments", label: "Commitments" }`.

- [ ] **Step 5: Start the dev server and manually verify**

Run: `npm run dev`, navigate to `/admin/commitments`, confirm the `committed_costs` row created by Task 6's award test appears, click "Supersede," enter a new amount, confirm a NEW row appears with the old row showing `status=superseded` (query directly or extend the table to show superseded rows too if useful for manual verification — the component as written only lists `open` rows by design, matching the screen's job of showing active commitments).

- [ ] **Step 6: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/admin/commitments packages/02-app-shell/src/components/CommitmentsTable.tsx apps/web/src/shell/AdminChrome.tsx
git commit -m "feat(P5): /admin/commitments screen, wiring supersede_committed_cost to real UI"
```

---

### Task 8: Material order + line item service functions + thin Server Actions

**Files:**
- Create: `packages/02-app-shell/src/services/procurementService.ts`
- Create: `apps/web/app/admin/procurement/actions.ts`

**Interfaces:**
- Consumes: `SupabaseClient`.
- Produces: `createMaterialOrder`, `addMaterialOrderLineItem`, `commitMaterialOrder`, `recordReceivedQuantity`, `listMaterialOrders`, `getMaterialOrderDetail` — consumed by Task 9.

- [ ] **Step 1: Write `packages/02-app-shell/src/services/procurementService.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MaterialOrderRow {
  id: string;
  projectId: string;
  costCodeId: string;
  vendorId: string | null;
  orderNumber: string | null;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  orderedAt: string | null;
  expectedDeliveryAt: string | null;
}

export interface MaterialOrderLineItemRow {
  id: string;
  materialOrderId: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceCents: number;
  receivedQuantity: number;
  backordered: boolean;
}

export interface MaterialOrderDetail extends MaterialOrderRow {
  lineItems: MaterialOrderLineItemRow[];
}

function mapOrder(row: any): MaterialOrderRow {
  return {
    id: row.id,
    projectId: row.project_id,
    costCodeId: row.cost_code_id,
    vendorId: row.vendor_id,
    orderNumber: row.order_number,
    status: row.status,
    orderedAt: row.ordered_at,
    expectedDeliveryAt: row.expected_delivery_at,
  };
}

function mapLineItem(row: any): MaterialOrderLineItemRow {
  return {
    id: row.id,
    materialOrderId: row.material_order_id,
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPriceCents: row.unit_price_cents,
    receivedQuantity: Number(row.received_quantity),
    backordered: row.backordered,
  };
}

export async function listMaterialOrders(supabase: SupabaseClient, projectId: string): Promise<MaterialOrderRow[]> {
  const { data, error } = await supabase.from("material_orders").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapOrder);
}

export async function createMaterialOrder(
  supabase: SupabaseClient,
  projectId: string,
  costCodeId: string,
  vendorId?: string,
  orderNumber?: string,
  notes?: string
) {
  const { data, error } = await supabase
    .from("material_orders")
    .insert({ project_id: projectId, cost_code_id: costCodeId, vendor_id: vendorId ?? null, order_number: orderNumber ?? null, notes: notes ?? null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

export async function addMaterialOrderLineItem(
  supabase: SupabaseClient,
  materialOrderId: string,
  description: string,
  quantity: number,
  unit: string | undefined,
  unitPriceCents: number
) {
  if (!description.trim()) return { error: "Description is required." };
  if (!(quantity > 0)) return { error: "Quantity must be greater than zero." };
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) return { error: "Unit price must be a whole number of cents, zero or greater." };
  const { error } = await supabase
    .from("material_order_line_items")
    .insert({ material_order_id: materialOrderId, description: description.trim(), quantity, unit: unit ?? null, unit_price_cents: unitPriceCents });
  if (error) return { error: error.message };
  return {};
}

export async function commitMaterialOrder(supabase: SupabaseClient, materialOrderId: string) {
  const { data, error } = await supabase.rpc("commit_material_order", { p_material_order_id: materialOrderId });
  if (error) return { error: error.message };
  return { committedCostId: data as string };
}

export async function getMaterialOrderDetail(supabase: SupabaseClient, materialOrderId: string): Promise<MaterialOrderDetail | null> {
  const { data: orderRow, error: orderError } = await supabase.from("material_orders").select("*").eq("id", materialOrderId).maybeSingle();
  if (orderError) throw orderError;
  if (!orderRow) return null;

  const { data: lineRows, error: lineError } = await supabase.from("material_order_line_items").select("*").eq("material_order_id", materialOrderId);
  if (lineError) throw lineError;

  return { ...mapOrder(orderRow), lineItems: (lineRows ?? []).map(mapLineItem) };
}

/** Updates one line item's received_quantity/backordered flag, then
 *  recomputes and persists the parent order's status: 'received' when
 *  every line is fully received, 'partially_received' when some but not
 *  all lines are fully received, unchanged otherwise. Two round trips
 *  (read all lines, then write the parent status) — acceptable here
 *  since this is staff-triggered, low-frequency, single-row UI action,
 *  not a hot path. */
export async function recordReceivedQuantity(
  supabase: SupabaseClient,
  lineItemId: string,
  receivedQuantity: number,
  markBackordered?: boolean
) {
  if (receivedQuantity < 0) return { error: "Received quantity cannot be negative." };

  const { data: lineRow, error: lineReadError } = await supabase
    .from("material_order_line_items")
    .select("material_order_id, quantity")
    .eq("id", lineItemId)
    .single();
  if (lineReadError) return { error: lineReadError.message };
  if (receivedQuantity > Number(lineRow.quantity)) {
    return { error: "Received quantity cannot exceed the ordered quantity." };
  }

  const { error: updateError } = await supabase
    .from("material_order_line_items")
    .update({ received_quantity: receivedQuantity, backordered: markBackordered ?? false })
    .eq("id", lineItemId);
  if (updateError) return { error: updateError.message };

  const { data: allLines, error: allLinesError } = await supabase
    .from("material_order_line_items")
    .select("quantity, received_quantity")
    .eq("material_order_id", lineRow.material_order_id);
  if (allLinesError) return { error: allLinesError.message };

  const allReceived = (allLines ?? []).every((l: any) => Number(l.received_quantity) >= Number(l.quantity));
  const someReceived = (allLines ?? []).some((l: any) => Number(l.received_quantity) > 0);
  const newStatus = allReceived ? "received" : someReceived ? "partially_received" : undefined;

  if (newStatus) {
    const { error: statusError } = await supabase
      .from("material_orders")
      .update({ status: newStatus })
      .eq("id", lineRow.material_order_id)
      .in("status", ["ordered", "partially_received"]);
    if (statusError) return { error: statusError.message };
  }

  return {};
}
```

- [ ] **Step 2: Write thin Server Actions in `apps/web/app/admin/procurement/actions.ts`**

```typescript
"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  createMaterialOrder as createMaterialOrderService,
  addMaterialOrderLineItem as addMaterialOrderLineItemService,
  commitMaterialOrder as commitMaterialOrderService,
  recordReceivedQuantity as recordReceivedQuantityService,
} from "../../../../../packages/02-app-shell/src/services/procurementService";

export async function createMaterialOrder(projectId: string, costCodeId: string, vendorId?: string, orderNumber?: string, notes?: string) {
  const supabase = await createServerSupabaseClient();
  return createMaterialOrderService(supabase, projectId, costCodeId, vendorId, orderNumber, notes);
}

export async function addMaterialOrderLineItem(materialOrderId: string, description: string, quantity: number, unit: string | undefined, unitPriceCents: number) {
  const supabase = await createServerSupabaseClient();
  return addMaterialOrderLineItemService(supabase, materialOrderId, description, quantity, unit, unitPriceCents);
}

export async function commitMaterialOrder(materialOrderId: string) {
  const supabase = await createServerSupabaseClient();
  return commitMaterialOrderService(supabase, materialOrderId);
}

export async function recordReceivedQuantity(lineItemId: string, receivedQuantity: number, markBackordered?: boolean) {
  const supabase = await createServerSupabaseClient();
  return recordReceivedQuantityService(supabase, lineItemId, receivedQuantity, markBackordered);
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/02-app-shell/src/services/procurementService.ts apps/web/app/admin/procurement/actions.ts
git commit -m "feat(P5): material order + line item service functions"
```

---

### Task 9: `/admin/procurement` screen

**Files:**
- Create: `apps/web/app/admin/procurement/page.tsx`
- Create: `packages/02-app-shell/src/components/MaterialOrderWorkspace.tsx`

**Interfaces:**
- Consumes: `listMaterialOrders`, `getMaterialOrderDetail`, `createMaterialOrder`, `addMaterialOrderLineItem`, `commitMaterialOrder`, `recordReceivedQuantity` (Task 8).
- Produces: nothing consumed by later tasks (leaf screen).

- [ ] **Step 1: Write `packages/02-app-shell/src/components/MaterialOrderWorkspace.tsx`**

Following `BidPackageWorkspace.tsx`'s (Task 6) exact pattern — local `useState` for selected order id and form fields, `startTransition` around each Server Action, list + detail view with a line-item entry form, a per-line "Record Received" control (number input + optional backorder checkbox), and a "Commit" button visible only when `status === 'draft'` and at least one line item exists.

```tsx
"use client";

import React, { useState, useTransition } from "react";
import { colors, spacing } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { MaterialOrderRow, MaterialOrderDetail } from "../services/procurementService";

export function MaterialOrderWorkspace({
  orders,
  loadDetail,
  onCreate,
  onAddLineItem,
  onCommit,
  onRecordReceived,
}: {
  orders: MaterialOrderRow[];
  loadDetail: (id: string) => Promise<MaterialOrderDetail | null>;
  onCreate: (costCodeId: string, vendorId: string | undefined, orderNumber: string | undefined) => Promise<void>;
  onAddLineItem: (orderId: string, description: string, quantity: number, unit: string | undefined, unitPriceCents: number) => Promise<void>;
  onCommit: (orderId: string) => Promise<void>;
  onRecordReceived: (lineItemId: string, receivedQuantity: number, markBackordered?: boolean) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MaterialOrderDetail | null>(null);

  async function select(id: string) {
    setSelectedId(id);
    setDetail(await loadDetail(id));
  }

  const lineItemTotal = (li: { quantity: number; unitPriceCents: number }) => li.quantity * li.unitPriceCents;
  const orderTotal = detail ? detail.lineItems.reduce((sum, li) => sum + lineItemTotal(li), 0) : 0;

  return (
    <div className="sc-procurement">
      <div className="sc-procurement-list">
        {orders.map((o) => (
          <button key={o.id} onClick={() => select(o.id)} data-active={o.id === selectedId}>
            {o.orderNumber ?? o.id.slice(0, 8)} — {o.status}
          </button>
        ))}
      </div>
      {detail && (
        <div className="sc-procurement-detail">
          <h2>{detail.orderNumber ?? detail.id}</h2>
          <p>Status: {detail.status}</p>
          <table>
            <thead><tr><th>Description</th><th>Qty</th><th>Received</th><th>Unit Price</th><th>Line Total</th><th>Backordered</th></tr></thead>
            <tbody>
              {detail.lineItems.map((li) => (
                <tr key={li.id}>
                  <td>{li.description}</td>
                  <td>{li.quantity} {li.unit}</td>
                  <td>{li.receivedQuantity}</td>
                  <td>{formatCents(li.unitPriceCents)}</td>
                  <td>{formatCents(lineItemTotal(li))}</td>
                  <td>{li.backordered ? "Yes" : "No"}</td>
                </tr>
              ))}
              <tr><td colSpan={4}><strong>Total</strong></td><td><strong>{formatCents(orderTotal)}</strong></td><td /></tr>
            </tbody>
          </table>
          {detail.status === "draft" && detail.lineItems.length > 0 && (
            <button disabled={pending} onClick={() => startTransition(async () => { await onCommit(detail.id); await select(detail.id); })}>
              Commit Order
            </button>
          )}
        </div>
      )}
      <style>{`
        .sc-procurement { display: grid; grid-template-columns: 220px 1fr; gap: ${spacing.md}; }
        .sc-procurement-list { display: flex; flex-direction: column; gap: 4px; }
        .sc-procurement-list button { text-align: left; padding: 8px; border: 1px solid ${colors.line}; border-radius: 6px; background: ${colors.white}; }
        .sc-procurement-list button[data-active="true"] { border-color: ${colors.sage}; }
        .sc-procurement-detail table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sc-procurement-detail th, .sc-procurement-detail td { border-bottom: 1px solid ${colors.line}; padding: 6px; text-align: left; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Write `apps/web/app/admin/procurement/page.tsx`**

Same real-backend-only, no-demo-fallback shape as Task 6's `/admin/bids/page.tsx` (material orders have no fixture equivalent either):

```tsx
import { AdminChrome } from "../../../src/shell/AdminChrome";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { listMaterialOrders } from "../../../../../packages/02-app-shell/src/services/procurementService";

export default async function AdminProcurementPage() {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();

  const { data: firstProject } = await supabase.from("projects").select("id").eq("org_id", user.orgId).limit(1).maybeSingle();

  if (!firstProject) {
    return (
      <AdminChrome activeKey="procurement" isDemoMode={isDemoMode()}>
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  const orders = await listMaterialOrders(supabase, firstProject.id);

  return (
    <AdminChrome activeKey="procurement" isDemoMode={isDemoMode()}>
      <div style={{ padding: 24 }}>
        <h1>Procurement</h1>
        {/* MaterialOrderWorkspaceClient: a small client-component wrapper
            binding the Task 8 Server Actions to MaterialOrderWorkspace's
            props, same shape as BidPackageWorkspace's own page wiring. */}
      </div>
    </AdminChrome>
  );
}
```

- [ ] **Step 3: Add `"procurement"` to `AdminChrome`'s nav**

Same as Task 6 Step 4.

- [ ] **Step 4: Start the dev server and manually verify**

Run: `npm run dev`, navigate to `/admin/procurement`, create a material order, add two line items, commit it, confirm a `committed_costs` row appears on `/admin/commitments` with `sourceType='material_order'` and the correct summed amount, then record a partial receive on one line and confirm the order's status becomes `partially_received` and the line shows as backordered when marked.

- [ ] **Step 5: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/admin/procurement packages/02-app-shell/src/components/MaterialOrderWorkspace.tsx apps/web/src/shell/AdminChrome.tsx
git commit -m "feat(P5): /admin/procurement screen"
```

---

### Task 10: PO/subcontract PDF Route Handlers

**Files:**
- Modify: `package.json` (root or `apps/web/package.json`, matching wherever `csv-parse` was added for P4 — add `@react-pdf/renderer`)
- Create: `packages/02-app-shell/src/pdf/MaterialOrderPdf.tsx`
- Create: `packages/02-app-shell/src/pdf/SubcontractPdf.tsx`
- Create: `apps/web/app/api/procurement/material-orders/[id]/pdf/route.ts`
- Create: `apps/web/app/api/bids/[bidPackageId]/subcontract-pdf/route.ts`

**Interfaces:**
- Consumes: `getMaterialOrderDetail` (Task 8), `getBidPackageDetail` (Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the dependency**

Run: `npm install @react-pdf/renderer` (from whichever `package.json` P4's `csv-parse` install targeted — check `git log -p` for the P4 commit that added `csv-parse` to confirm the exact workspace before running this).

- [ ] **Step 2: Write `packages/02-app-shell/src/pdf/MaterialOrderPdf.tsx`**

```tsx
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { MaterialOrderDetail } from "../services/procurementService";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  title: { fontSize: 16, marginBottom: 12 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ccc", paddingVertical: 4 },
  cell: { flex: 1 },
});

export function MaterialOrderPdf({ detail, vendorName }: { detail: MaterialOrderDetail; vendorName: string }) {
  const total = detail.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPriceCents, 0);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Purchase Order {detail.orderNumber ?? detail.id}</Text>
        <Text>Vendor: {vendorName}</Text>
        <View style={styles.row}>
          <Text style={styles.cell}>Description</Text>
          <Text style={styles.cell}>Qty</Text>
          <Text style={styles.cell}>Unit Price</Text>
          <Text style={styles.cell}>Total</Text>
        </View>
        {detail.lineItems.map((li) => (
          <View style={styles.row} key={li.id}>
            <Text style={styles.cell}>{li.description}</Text>
            <Text style={styles.cell}>{li.quantity} {li.unit}</Text>
            <Text style={styles.cell}>{formatCents(li.unitPriceCents)}</Text>
            <Text style={styles.cell}>{formatCents(li.quantity * li.unitPriceCents)}</Text>
          </View>
        ))}
        <Text style={{ marginTop: 12 }}>Total: {formatCents(total)}</Text>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: Write `packages/02-app-shell/src/pdf/SubcontractPdf.tsx`**

```tsx
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { BidPackageDetail } from "../services/bidService";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  title: { fontSize: 16, marginBottom: 12 },
});

export function SubcontractPdf({ detail, awardedVendorName, amountCents }: { detail: BidPackageDetail; awardedVendorName: string; amountCents: number }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Subcontract Agreement — {detail.title}</Text>
        <Text>Awarded to: {awardedVendorName}</Text>
        <Text>Contract amount: {formatCents(amountCents)}</Text>
        <Text style={{ marginTop: 12 }}>Scope: {detail.scopeDescription ?? "See attached scope of work."}</Text>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 4: Write `apps/web/app/api/procurement/material-orders/[id]/pdf/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireRole } from "../../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../../src/server/supabase/serverClient";
import { getMaterialOrderDetail } from "../../../../../../../../packages/02-app-shell/src/services/procurementService";
import { MaterialOrderPdf } from "../../../../../../../../packages/02-app-shell/src/pdf/MaterialOrderPdf";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const detail = await getMaterialOrderDetail(supabase, params.id);
  if (!detail) return NextResponse.json({ error: "Material order not found" }, { status: 404 });

  const { data: vendorRow } = detail.vendorId
    ? await supabase.from("vendors").select("name").eq("id", detail.vendorId).maybeSingle()
    : { data: null };

  const buffer = await renderToBuffer(React.createElement(MaterialOrderPdf, { detail, vendorName: vendorRow?.name ?? "Unknown vendor" }));
  return new NextResponse(buffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="po-${detail.orderNumber ?? detail.id}.pdf"` } });
}
```

- [ ] **Step 5: Write `apps/web/app/api/bids/[bidPackageId]/subcontract-pdf/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireRole } from "../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { getBidPackageDetail } from "../../../../../../../packages/02-app-shell/src/services/bidService";
import { SubcontractPdf } from "../../../../../../../packages/02-app-shell/src/pdf/SubcontractPdf";

export async function GET(_req: NextRequest, { params }: { params: { bidPackageId: string } }) {
  await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const detail = await getBidPackageDetail(supabase, params.bidPackageId);
  if (!detail) return NextResponse.json({ error: "Bid package not found" }, { status: 404 });

  const awarded = detail.submissions.find((s) => s.status === "awarded");
  if (!awarded) return NextResponse.json({ error: "No awarded submission for this bid package yet" }, { status: 409 });

  const buffer = await renderToBuffer(
    React.createElement(SubcontractPdf, { detail, awardedVendorName: awarded.vendorName, amountCents: awarded.amountCents ?? 0 })
  );
  return new NextResponse(buffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="subcontract-${detail.id}.pdf"` } });
}
```

- [ ] **Step 6: Manually verify both routes**

Run: `npm run dev`, hit `/api/procurement/material-orders/<a committed order's id>/pdf` and `/api/bids/<an awarded package's id>/subcontract-pdf` directly in a browser, confirm each downloads/renders a valid PDF with the correct numbers.

- [ ] **Step 7: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json packages/02-app-shell/src/pdf apps/web/app/api/procurement apps/web/app/api/bids
git commit -m "feat(P5): PO/subcontract PDF generation"
```

---

### Task 11: Action Center condition functions (registration only, no live screen wiring)

**Files:**
- Create: `packages/02-app-shell/src/services/actionCenterQueries.ts`
- Create: `packages/02-app-shell/test/action_center_queries_unit.ts`

**Interfaces:**
- Consumes: `SupabaseClient`.
- Produces: `getOverdueBidPackages(supabase, projectId)`, `getBackorderedMaterialLineItems(supabase, projectId)` — pure read functions any future package can call once a real Action Center screen exists (no such screen exists yet, per this plan's Global Constraints — `ActionCenterScreen.tsx` is untouched by this task).

- [ ] **Step 1: Write `packages/02-app-shell/src/services/actionCenterQueries.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OverdueBidPackage {
  id: string;
  title: string;
  dueAt: string;
}

/** A published bid package past its due date with no awarded submission
 *  yet — PRODUCTION-ROADMAP.md's "Unapproved changes past expected
 *  timeframe" event for P5. Computed on read, no new event-storage table
 *  — matches how the roadmap describes every other package's Action
 *  Center events. */
export async function getOverdueBidPackages(supabase: SupabaseClient, projectId: string): Promise<OverdueBidPackage[]> {
  const { data, error } = await supabase
    .from("bid_packages")
    .select("id, title, due_at")
    .eq("project_id", projectId)
    .eq("status", "published")
    .lt("due_at", new Date().toISOString());
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, title: row.title, dueAt: row.due_at }));
}

export interface BackorderedLineItem {
  id: string;
  materialOrderId: string;
  description: string;
}

/** Any line item flagged backordered on an order not yet fully received
 *  — the roadmap's "backordered material" event for P5. */
export async function getBackorderedMaterialLineItems(supabase: SupabaseClient, projectId: string): Promise<BackorderedLineItem[]> {
  const { data, error } = await supabase
    .from("material_order_line_items")
    .select("id, material_order_id, description, material_orders!inner(project_id, status)")
    .eq("backordered", true)
    .eq("material_orders.project_id", projectId)
    .neq("material_orders.status", "received");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, materialOrderId: row.material_order_id, description: row.description }));
}
```

- [ ] **Step 2: Write `packages/02-app-shell/test/action_center_queries_unit.ts`**

Follows `import_parse_unit.ts`'s "fast, no server" style — since both functions are thin Supabase-client queries with no business logic beyond the filter shape, this test asserts the query builder is called with the correct filter arguments against a minimal mock client (mirrors any existing mock-Supabase-client pattern already used by another `*_unit.ts` test in this package — check `apps/web/test/import_parse_unit.ts` and `packages/02-app-shell/test/` for the established mock shape before writing this, to avoid inventing a second, inconsistent mocking approach).

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { getOverdueBidPackages, getBackorderedMaterialLineItems } from "../src/services/actionCenterQueries";

test("getOverdueBidPackages filters to published status and due_at in the past", async () => {
  const calls: any[] = [];
  const mockClient: any = {
    from(table: string) {
      calls.push({ table });
      const builder: any = {
        select: (cols: string) => { calls.push({ select: cols }); return builder; },
        eq: (col: string, val: unknown) => { calls.push({ eq: [col, val] }); return builder; },
        lt: (col: string, val: unknown) => { calls.push({ lt: [col, val] }); return Promise.resolve({ data: [], error: null }); },
      };
      return builder;
    },
  };
  await getOverdueBidPackages(mockClient, "project-1");
  assert.deepEqual(calls.find((c) => c.eq)?.eq, ["project_id", "project-1"]);
  assert.ok(calls.some((c) => c.eq?.[0] === "status" && c.eq?.[1] === "published"));
});

test("getBackorderedMaterialLineItems filters to backordered=true and excludes received orders", async () => {
  const calls: any[] = [];
  const mockClient: any = {
    from(table: string) {
      calls.push({ table });
      const builder: any = {
        select: (cols: string) => { calls.push({ select: cols }); return builder; },
        eq: (col: string, val: unknown) => { calls.push({ eq: [col, val] }); return builder; },
        neq: (col: string, val: unknown) => { calls.push({ neq: [col, val] }); return Promise.resolve({ data: [], error: null }); },
      };
      return builder;
    },
  };
  await getBackorderedMaterialLineItems(mockClient, "project-1");
  assert.ok(calls.some((c) => c.eq?.[0] === "backordered" && c.eq?.[1] === true));
  assert.ok(calls.some((c) => c.neq?.[0] === "material_orders.status" && c.neq?.[1] === "received"));
});
```

- [ ] **Step 3: Add the new test file to whichever `npm run test` step already runs `import_parse_unit.ts`**

Modify the relevant `package.json` test script or test-runner glob (check how `import_parse_unit.ts` was registered in P4's Task 8/CI section and add this file the same way).

- [ ] **Step 4: Run the test**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/02-app-shell/src/services/actionCenterQueries.ts packages/02-app-shell/test/action_center_queries_unit.ts package.json
git commit -m "feat(P5): Action Center condition queries (unapproved bid packages, backordered material)"
```

---

### Task 12: Full verification, live checkpoint extension, milestone closeout, handoff

**Files:**
- Create: `docs/milestones/P5-complete.md`
- Modify: `docs/production-build/PRODUCTION-ROADMAP.md` (mark P5 complete, matching the exact header-note style already used for P0–P4)

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: the closeout record and starter prompt for P6, mirroring `docs/milestones/P4-complete.md`'s exact structure and final "Starter prompt for a fresh Claude Code session" section.

- [ ] **Step 1: Run the full verification suite from a clean install**

Run: `npm ci && npm run typecheck && npm run test && npm run build`
Expected: all pass, matching P4's own acceptance-criteria bar (item 7).

- [ ] **Step 2: Apply migration 015 to the real hosted dev Supabase project and re-run the live checkpoint script**

Follow the exact procedure `docs/production-build/PRE-P4-CHECKPOINT.md`/P4's own live-checkpoint step used for migrations 001–014, extended to include 015. Confirm the checkpoint script's assertion count increases to reflect the new tables/RPCs it now also exercises (mirrors P4's "27/27" checkpoint-count reporting).

- [ ] **Step 3: Manually re-walk the full golden path end-to-end against the real hosted dev project (not demo mode)**

Create a bid package → invite two vendors → record two submissions → award one → confirm exactly one `committed_costs` row exists and the other submission shows `declined`. Separately, create a material order → add line items → commit it → confirm a second `committed_costs` row exists with the correct summed amount → record a partial receive on one line, mark it backordered → confirm `getBackorderedMaterialLineItems` (Task 11) returns it. Generate both PDFs (Task 10) against this real data and confirm they render correctly.

- [ ] **Step 4: Write `docs/milestones/P5-complete.md`**

Follow `docs/milestones/P4-complete.md`'s exact structure: final acceptance-criteria status (checked against `P5-DESIGN.md`'s own acceptance criteria list), verified commands run, significant findings during execution (if any — e.g., anything Task 2's testing surfaced that wasn't anticipated in the design), known limitations section (at minimum: no vendor-facing UI exercise of the new RLS policies until P11; no document/file persistence for generated PDFs or received bid files, per Decision 3; single-cost-code-per-package/order limitation, per Decision 1; single-award-per-package limitation, per Decision 5 — carry these forward exactly as flagged, don't silently drop them), and a final "**Starter prompt for a fresh Claude Code session**" section for P6 (Client Billing: Draws, Payments, Retainage), read `docs/production-build/PRODUCTION-ROADMAP.md`'s P6 section and `FINANCIAL-ARCHITECTURE.md`'s P6 framing (the `invoice_lines`-never-a-`billed`-column-on-`expenses` governing convention) before summarizing scope and waiting for approval — same shape as P4-complete.md's own P5 starter prompt.

- [ ] **Step 5: Update `docs/production-build/PRODUCTION-ROADMAP.md`'s status line**

Add "**P5 (Commitments, Bids, Procurement & Material Orders) complete** (`p5-complete` tag) — see `docs/production-build/P5-DESIGN.md` and `docs/milestones/P5-complete.md`." to the same running status paragraph at the top of the file, following the exact sentence pattern already used for P0–P4, and update "**The next package is P5**" to "**The next package is P6**."

- [ ] **Step 6: Tag the milestone**

```bash
git add docs/milestones/P5-complete.md docs/production-build/PRODUCTION-ROADMAP.md
git commit -m "docs: P5 milestone complete — commitments, bids, procurement"
git tag p5-complete
```

- [ ] **Step 7: Report closeout summary**

Report to the user: final acceptance-criteria status, verified command output, the live-checkpoint result, and explicitly restate every "Known limitation" from Step 4 — do not let any of them go unmentioned, matching P4's own closeout discipline.
