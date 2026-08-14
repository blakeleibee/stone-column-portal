# P5 — Commitments, Bids (PM-side), Procurement & Material Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2** of this plan, matching `docs/production-build/P5-DESIGN.md` Revision 2. Supersedes Revision 1 in place (not preserved inline — see git history). Changes from Revision 1: material orders allocate cost at the line level, not the order level; vendor identity is a `vendor_members` junction, not a `vendors.profile_id` column; issuing a PO/subcontract creates an immutable versioned `issued_documents` snapshot; staff-recorded bid Q&A carries explicit author/source provenance; Tasks 6 and 9 are now functional specifications (data flow, auth, states, mutations, tests) rather than inlined component code, per explicit instruction.

**Goal:** Activate the existing, schema-hardened-but-never-used `committed_costs` table for real writes for the first time, and add the vendor-quote/procurement mechanism (`bid_packages`, `bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`, `material_order_line_items`, `vendor_members`, `issued_documents`) that feeds it — without creating any new, disconnected financial table.

**Architecture:** Every commitment-creating write (`award_bid()`, `commit_material_order()`) inserts into the *existing* `committed_costs` table via the composite `(cost_code_id, project_id)` FK spine, registering a new `source_type`. `commit_material_order()` groups a material order's line items by their own `cost_code_id` and inserts one `committed_costs` row per distinct code — a material order is not single-cost-code the way a bid package is. A later commitment-amount change reuses the *existing* `supersede_committed_cost()` RPC. Vendor identity for RLS purposes is resolved through a `vendor_members` many-to-many junction (a vendor business may have several authenticated people), not a single profile column, with a DB-level trigger (not just RLS) rejecting cross-org links. Issuing a PO or subcontract calls a new `issue_document()` RPC that snapshots canonical JSON data into an immutable, versioned `issued_documents` row, modeled directly on `supersede_committed_cost()`'s claim-old/insert-new/link shape — the rendered PDF bytes are still never stored, only the data needed to reproduce them. Mutations are Next.js Server Actions using the caller's own RLS-scoped Supabase client (never service-role); cross-row-atomic operations (`award_bid`, `commit_material_order`, `issue_document`) are `security invoker` Postgres RPCs.

**Tech Stack:** Next.js 14.2.35 App Router (Server Actions + Route Handlers, Node.js runtime explicitly declared for PDF routes), React 18.3.1, Supabase Postgres/RLS, `packages/01-financial-engine` (pure TS), `@react-pdf/renderer` (new dependency, exact-pinned, server-side only).

**Design record (read first, authoritative for every "why"):** `docs/production-build/P5-DESIGN.md` (Revision 2).

## Global Constraints

- Money is always an integer number of cents. Never a float. (CLAUDE.md)
- No screen computes its own financial numbers — everything goes through `packages/01-financial-engine`. (CLAUDE.md)
- Nothing is silently overwritten, merged, or recalculated. Corrections are new ledger rows with a reason, not edits — a commitment amount change is always `supersede_committed_cost()`; a PO/subcontract change after issuance is always a new `issued_documents` version, never an edit to an existing one. (CLAUDE.md, P5-DESIGN.md Decision 4)
- Never edit `schema/001`–`014` in place. All P5 schema changes are additive, in a new `schema/015_*.sql` (+ down) file only, mirrored into `supabase/migrations/`.
- Every mutation runs through the caller's own JWT-bearing Supabase client (RLS-scoped) via a Server Action — never a client-side browser call to Supabase, never the service-role client. (TARGET-ARCHITECTURE.md §5.2)
- Business logic (validation + the write) lives in a plain service function under `packages/02-app-shell/src/services/`; the Server Action that calls it is a thin adapter only.
- A material order's authoritative cost-code allocation lives on its line items, never on the order itself — `material_orders.cost_code_id` is a UI convenience default only, read by nothing that touches money. (P5-DESIGN.md Decision 2)
- Vendor identity for any new RLS policy is resolved via `is_vendor_member(vendor_id)`, never by inlining a direct column comparison — this is the one helper every vendor-facing policy in this plan must call. (P5-DESIGN.md Decision 3)
- Any value that identifies *who did something* on a server-enforced record (`issued_by`, `recorded_by`) is derived from the authenticated session server-side (an RPC's internal `auth.uid()`, or a column `default auth.uid()`) — never accepted as a client-suppliable parameter. (P5-DESIGN.md Decisions 4, 8)
- `@react-pdf/renderer` is imported only inside a Route Handler/service file that runs under `export const runtime = "nodejs"` — never in a client component, never under the Edge runtime. (P5-DESIGN.md Decision 9)
- `npm run typecheck` / `npm run test` / `npm run build` must pass after every task.
- No vendor-facing UI (P11 scope) — every vendor RLS policy is built and tested here but no page in this plan is ever rendered to a vendor session.
- `ActionCenterScreen.tsx` stays fixture-driven/preview-only in this plan — P5 registers the two new Action Center *conditions* as tested service functions, it does not wire the real screen.
- Do not begin P6 work of any kind.

---

### Task 1: Migration 015 — schema

**Files:**
- Create: `schema/015_commitments_bids_procurement.sql`
- Create: `schema/015_commitments_bids_procurement_down.sql`
- Create: `supabase/migrations/20260814000000_commitments_bids_procurement.sql` (mirror)

**Interfaces:**
- Produces: types `bid_package_status`, `bid_submission_status`, `material_order_status`, `issued_document_type`; tables `vendor_members`, `bid_packages`, `bid_submissions`, `bid_questions`, `bid_addenda`, `material_orders`, `material_order_line_items`, `issued_documents`; functions `is_vendor_member(uuid) returns boolean`, `award_bid(uuid) returns uuid`, `commit_material_order(uuid) returns setof uuid`, `issue_document(issued_document_type, uuid, text, jsonb) returns uuid`; trigger functions `enforce_vendor_member_org_match()`, `log_audit_via_bid_package()`, `log_audit_via_material_order()`, `enforce_line_item_project_matches_order()`, `enforce_material_order_line_item_frozen_after_commit()`, `enforce_issued_document_immutability()`, `log_audit_via_issued_document()`.

- [ ] **Step 1: Write `schema/015_commitments_bids_procurement.sql` — vendor identity**

```sql
-- =====================================================================
-- Stone Column Portal — Migration 015: commitments, bids (PM-side),
-- procurement & material orders. See docs/production-build/P5-DESIGN.md
-- (Revision 2) for full rationale.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vendor identity: a many-to-many junction, not a single column, so
-- more than one authenticated person can represent one vendor business.
-- Every isolation axis is DB-enforced, not just RLS-shaped.
-- ---------------------------------------------------------------------
create table vendor_members (
  id          uuid primary key default uuid_generate_v4(),
  vendor_id   uuid not null references vendors(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),

  constraint vendor_members_unique_pair unique (vendor_id, profile_id)
);

alter table vendor_members enable row level security;

create or replace function public.enforce_vendor_member_org_match() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_vendor_org uuid;
  v_profile_org uuid;
begin
  select org_id into v_vendor_org from vendors where id = new.vendor_id;
  select org_id into v_profile_org from profiles where id = new.profile_id;
  if v_vendor_org is distinct from v_profile_org then
    raise exception 'Cannot link profile % to vendor % — org mismatch (profile org %, vendor org %)',
      new.profile_id, new.vendor_id, v_profile_org, v_vendor_org;
  end if;
  return new;
end;
$$;

create trigger vendor_members_org_match before insert or update on vendor_members
  for each row execute function public.enforce_vendor_member_org_match();

create or replace function public.is_vendor_member(p_vendor_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.vendor_members
    where vendor_id = p_vendor_id and profile_id = auth.uid()
  );
$$;
revoke all on function public.is_vendor_member(uuid) from public;
grant execute on function public.is_vendor_member(uuid) to authenticated;

create policy vendor_members_staff_full_access on vendor_members
  for all to authenticated
  using (is_org_staff_for_org((select org_id from vendors where id = vendor_members.vendor_id)))
  with check (is_org_staff_for_org((select org_id from vendors where id = vendor_members.vendor_id)));

create policy vendor_members_self_read on vendor_members
  for select to authenticated
  using (profile_id = auth.uid());

create trigger vendor_members_no_delete before delete on vendor_members
  for each row execute function public.reject_delete();
revoke delete on vendor_members from authenticated, anon;

create trigger audit_vendor_members after insert or update on vendor_members
  for each row execute function public.log_audit_no_project();

create policy audit_log_vendor_members_staff_select on audit_log
  for select to authenticated
  using (
    table_name = 'vendor_members'
    and exists (
      select 1 from vendor_members vm
      join vendors v on v.id = vm.vendor_id
      where vm.id = audit_log.record_id and is_org_staff_for_org(v.org_id)
    )
  );
```

- [ ] **Step 2: Append `bid_packages`/`bid_submissions`**

```sql
-- ---------------------------------------------------------------------
-- Bid packages: one per (cost_code_id, project_id) — a per-trade
-- scope, per P5-DESIGN.md Decision 1.
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
      where bs.bid_package_id = bid_packages.id and is_vendor_member(bs.vendor_id)
    )
  );

create trigger audit_bid_packages after insert or update on bid_packages
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Bid submissions: also the invitee record — an 'invited' row is how a
-- vendor is invited, updated in place to 'submitted' once staff records
-- what they quoted. Pre-response staging, not the append-only ledger
-- itself (that's committed_costs, reached only via award_bid()).
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
  using (is_org_staff((select project_id from bid_packages where id = bid_submissions.bid_package_id)))
  with check (is_org_staff((select project_id from bid_packages where id = bid_submissions.bid_package_id)));

create policy bid_submissions_vendor_read on bid_submissions
  for select to authenticated
  using (is_vendor_member(vendor_id));

create policy bid_submissions_vendor_update on bid_submissions
  for update to authenticated
  using (is_vendor_member(vendor_id))
  with check (is_vendor_member(vendor_id));

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
    v_project_id, tg_table_name,
    case tg_op when 'DELETE' then old.id else new.id end,
    lower(tg_op), auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.log_audit_via_bid_package() from public;

create trigger audit_bid_submissions after insert or update on bid_submissions
  for each row execute function public.log_audit_via_bid_package();
```

- [ ] **Step 3: Append `bid_questions` (with Decision 8's provenance fields) and `bid_addenda`**

```sql
-- ---------------------------------------------------------------------
-- Bid questions: staff-recorded in P5, with structural provenance so a
-- staff entry can never be mistaken for the vendor's own words.
-- ---------------------------------------------------------------------
create table bid_questions (
  id             uuid primary key default uuid_generate_v4(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  vendor_id      uuid references vendors(id),
  source         text not null default 'staff_recorded'
    check (source in ('staff_recorded', 'vendor_submitted')),
  recorded_by    uuid references profiles(id) default auth.uid(),
  question_text  text not null,
  asked_at       timestamptz not null default now(),
  answer_text    text,
  answered_by    uuid references profiles(id),
  answered_at    timestamptz,
  visible_to_all_vendors boolean not null default true,

  constraint bid_questions_answer_requires_answered_at
    check (answer_text is null or answered_at is not null),
  constraint bid_questions_staff_recorded_requires_recorder
    check (source <> 'staff_recorded' or recorded_by is not null)
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
    or (vendor_id is not null and is_vendor_member(vendor_id))
  );

-- Dormant until P11: no vendor session exists in P5 to exercise this
-- insert path, but the policy is correct and tested now (source is
-- forced to 'vendor_submitted' by the WITH CHECK, never
-- 'staff_recorded' — a vendor can never insert a row that looks
-- staff-authored).
create policy bid_questions_vendor_insert on bid_questions
  for insert to authenticated
  with check (
    source = 'vendor_submitted'
    and vendor_id is not null
    and is_vendor_member(vendor_id)
    and exists (
      select 1 from bid_submissions bs
      where bs.bid_package_id = bid_questions.bid_package_id and bs.vendor_id = bid_questions.vendor_id
    )
  );

create trigger audit_bid_questions after insert or update on bid_questions
  for each row execute function public.log_audit_via_bid_package();

-- ---------------------------------------------------------------------
-- Bid addenda: inherently staff-issued — no impersonation risk, no
-- source/recorded_by fields needed (issued_by already exists).
-- ---------------------------------------------------------------------
create table bid_addenda (
  id             uuid primary key default uuid_generate_v4(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  title          text not null,
  body_text      text not null,
  revised_due_at timestamptz,
  issued_by      uuid references profiles(id) default auth.uid(),
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
      where bs.bid_package_id = bid_addenda.bid_package_id and is_vendor_member(bs.vendor_id)
    )
  );

create trigger audit_bid_addenda after insert or update on bid_addenda
  for each row execute function public.log_audit_via_bid_package();
```

- [ ] **Step 4: Append `material_orders`/`material_order_line_items` (Decision 2's line-level cost-code allocation, Decision 10's post-commit freeze)**

```sql
-- ---------------------------------------------------------------------
-- Material orders: cost_code_id here is an OPTIONAL convenience
-- default for pre-filling new line items in the UI — never read by
-- commit_material_order() or any reconciliation query. The
-- authoritative allocation lives on material_order_line_items below.
-- No vendor policy — procurement is internal only.
-- ---------------------------------------------------------------------
create type material_order_status as enum ('draft', 'ordered', 'partially_received', 'received', 'cancelled');

create table material_orders (
  id                   uuid primary key default uuid_generate_v4(),
  project_id           uuid not null references projects(id) on delete cascade,
  cost_code_id         uuid,
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

create trigger audit_material_orders after insert or update on material_orders
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Material order line items: the AUTHORITATIVE cost-code allocation
-- (Decision 2). project_id is denormalized here (not derivable through
-- material_order_id alone without a join) so the exact same composite
-- FK pattern the rest of the backbone uses applies here too, and
-- enforced to match its parent order by a trigger, not merely trusted
-- from the service layer.
-- ---------------------------------------------------------------------
create table material_order_line_items (
  id                 uuid primary key default uuid_generate_v4(),
  material_order_id uuid not null references material_orders(id) on delete cascade,
  project_id         uuid not null,
  cost_code_id       uuid not null,
  description        text not null,
  quantity           numeric not null,
  unit               text,
  unit_price_cents   bigint not null,
  received_quantity  numeric not null default 0,
  backordered        boolean not null default false,
  created_at         timestamptz not null default now(),

  constraint material_order_line_items_cost_code_project_fk
    foreign key (cost_code_id, project_id) references cost_codes(id, project_id),
  constraint material_order_line_items_quantity_positive check (quantity > 0),
  constraint material_order_line_items_unit_price_nonnegative check (unit_price_cents >= 0),
  constraint material_order_line_items_received_nonnegative check (received_quantity >= 0),
  constraint material_order_line_items_received_not_over check (received_quantity <= quantity)
);

alter table material_order_line_items enable row level security;

create policy material_order_line_items_staff_full_access on material_order_line_items
  for all to authenticated
  using (is_org_staff((select project_id from material_orders where id = material_order_line_items.material_order_id)))
  with check (is_org_staff((select project_id from material_orders where id = material_order_line_items.material_order_id)));

create or replace function public.enforce_line_item_project_matches_order() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_project_id uuid;
begin
  select project_id into v_order_project_id from material_orders where id = new.material_order_id;
  if new.project_id is distinct from v_order_project_id then
    raise exception 'material_order_line_items.project_id (%) must match its parent material_orders.project_id (%) for order %',
      new.project_id, v_order_project_id, new.material_order_id;
  end if;
  return new;
end;
$$;

create trigger material_order_line_items_project_matches_order
  before insert or update on material_order_line_items
  for each row execute function public.enforce_line_item_project_matches_order();

-- Decision 10: closes a real gap Revision 1's acceptance criteria
-- claimed but never enforced. Committed-fields freeze once the order
-- leaves 'draft'; received_quantity/backordered stay editable always
-- (receiving only happens AFTER an order is placed).
create or replace function public.enforce_material_order_line_item_frozen_after_commit() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_status material_order_status;
begin
  if tg_op = 'INSERT' then
    select status into v_order_status from material_orders where id = new.material_order_id;
    if v_order_status <> 'draft' then
      raise exception 'Cannot add a new line item to material order % — order is no longer draft (status=%). Line items are frozen once committed.',
        new.material_order_id, v_order_status;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    select status into v_order_status from material_orders where id = old.material_order_id;
    if v_order_status <> 'draft' then
      raise exception 'Cannot delete material_order_line_items row % — order % is no longer draft (status=%).',
        old.id, old.material_order_id, v_order_status;
    end if;
    return old;
  end if;

  -- UPDATE
  select status into v_order_status from material_orders where id = old.material_order_id;
  if v_order_status <> 'draft' and (
    new.description is distinct from old.description or
    new.quantity is distinct from old.quantity or
    new.unit is distinct from old.unit or
    new.unit_price_cents is distinct from old.unit_price_cents or
    new.cost_code_id is distinct from old.cost_code_id or
    new.project_id is distinct from old.project_id or
    new.material_order_id is distinct from old.material_order_id
  ) then
    raise exception 'Cannot edit committed fields of material_order_line_items row % — order % is no longer draft (status=%). Only received_quantity/backordered may change after commit.',
      old.id, old.material_order_id, v_order_status;
  end if;
  return new;
end;
$$;

create trigger material_order_line_items_frozen_after_commit
  before insert or update or delete on material_order_line_items
  for each row execute function public.enforce_material_order_line_item_frozen_after_commit();

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
    v_project_id, tg_table_name,
    case tg_op when 'DELETE' then old.id else new.id end,
    lower(tg_op), auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.log_audit_via_material_order() from public;

create trigger audit_material_order_line_items after insert or update on material_order_line_items
  for each row execute function public.log_audit_via_material_order();
```

- [ ] **Step 5: Append `issued_documents` (Decision 4)**

```sql
-- ---------------------------------------------------------------------
-- Issued documents: an immutable, versioned snapshot created only when
-- a PO/subcontract is actually issued (not on every preview render).
-- canonical_data is metadata (JSON), never the rendered PDF bytes —
-- same "never a blob" philosophy as documents (schema/010).
-- ---------------------------------------------------------------------
create type issued_document_type as enum ('purchase_order', 'subcontract');

create table issued_documents (
  id               uuid primary key default uuid_generate_v4(),
  document_type    issued_document_type not null,
  source_id        uuid not null, -- material_orders.id or bid_packages.id, per document_type
  document_number  text not null,
  version          integer not null default 1,
  issued_at        timestamptz not null default now(),
  issued_by        uuid references profiles(id),
  canonical_data   jsonb not null,
  superseded_at    timestamptz,
  superseded_by_id uuid references issued_documents(id),
  created_at       timestamptz not null default now(),

  constraint issued_documents_type_source_version_unique unique (document_type, source_id, version)
);

alter table issued_documents enable row level security;

create policy issued_documents_staff_full_access on issued_documents
  for all to authenticated
  using (
    case document_type
      when 'purchase_order' then is_org_staff((select project_id from material_orders where id = issued_documents.source_id))
      when 'subcontract' then is_org_staff((select project_id from bid_packages where id = issued_documents.source_id))
    end
  )
  with check (
    case document_type
      when 'purchase_order' then is_org_staff((select project_id from material_orders where id = issued_documents.source_id))
      when 'subcontract' then is_org_staff((select project_id from bid_packages where id = issued_documents.source_id))
    end
  );

create or replace function public.enforce_issued_document_immutability() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.canonical_data is distinct from old.canonical_data
    or new.document_number is distinct from old.document_number
    or new.version is distinct from old.version
    or new.document_type is distinct from old.document_type
    or new.source_id is distinct from old.source_id
    or new.issued_at is distinct from old.issued_at
    or new.issued_by is distinct from old.issued_by
  then
    raise exception 'Issued document % is immutable — only superseded_at/superseded_by_id may ever change', old.id;
  end if;
  return new;
end;
$$;

create trigger issued_documents_immutable before update on issued_documents
  for each row execute function public.enforce_issued_document_immutability();

create trigger issued_documents_no_delete before delete on issued_documents
  for each row execute function public.reject_delete();
revoke delete on issued_documents from authenticated, anon;

create or replace function public.log_audit_via_issued_document() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_document_type issued_document_type;
  v_source_id uuid;
  v_project_id uuid;
begin
  if tg_op = 'DELETE' then
    v_document_type := old.document_type; v_source_id := old.source_id;
  else
    v_document_type := new.document_type; v_source_id := new.source_id;
  end if;

  v_project_id := case v_document_type
    when 'purchase_order' then (select project_id from material_orders where id = v_source_id)
    when 'subcontract' then (select project_id from bid_packages where id = v_source_id)
  end;

  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, before_data, after_data)
  values (
    v_project_id, tg_table_name,
    case tg_op when 'DELETE' then old.id else new.id end,
    lower(tg_op), auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.log_audit_via_issued_document() from public;

create trigger audit_issued_documents after insert or update on issued_documents
  for each row execute function public.log_audit_via_issued_document();
```

- [ ] **Step 6: Append the RPCs — `award_bid()` (unchanged shape), `commit_material_order()` (rewritten for line-level allocation), `issue_document()`**

```sql
-- ---------------------------------------------------------------------
-- award_bid(): unchanged from Revision 1. Bid packages stay single-
-- cost-code (Decision 1), so this RPC still produces exactly one
-- committed_costs row.
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
-- commit_material_order(): REWRITTEN for Decision 2. Groups line items
-- by their OWN cost_code_id (never the order's optional default) and
-- inserts one committed_costs row per distinct code, all sharing
-- source_id = the order's id — the same multi-row-per-event shape
-- FINANCIAL-ARCHITECTURE.md already documents for change_order.
-- ---------------------------------------------------------------------
create or replace function public.commit_material_order(p_material_order_id uuid)
returns setof uuid
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_order material_orders%rowtype;
  v_vendor_name text;
  v_line record;
  v_committed_cost_id uuid;
  v_line_item_count integer;
begin
  select * into v_order from material_orders where id = p_material_order_id for update;
  if not found then
    raise exception 'Material order % not found', p_material_order_id;
  end if;
  if v_order.status <> 'draft' then
    raise exception 'Material order % must be in status ''draft'' to commit (currently %)',
      p_material_order_id, v_order.status;
  end if;

  select count(*) into v_line_item_count from material_order_line_items where material_order_id = v_order.id;
  if v_line_item_count = 0 then
    raise exception 'Material order % has no line items to commit', p_material_order_id;
  end if;

  select name into v_vendor_name from vendors where id = v_order.vendor_id;

  for v_line in
    select cost_code_id, sum(quantity * unit_price_cents)::bigint as total_cents
    from material_order_line_items
    where material_order_id = v_order.id
    group by cost_code_id
  loop
    insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, source_type, source_id)
    values (v_order.project_id, v_line.cost_code_id, v_vendor_name, v_line.total_cents, 'material_order', v_order.id)
    returning id into v_committed_cost_id;
    return next v_committed_cost_id;
  end loop;

  update material_orders set status = 'ordered', ordered_at = now() where id = v_order.id;

  return;
end;
$$;

revoke all on function public.commit_material_order(uuid) from public;
grant execute on function public.commit_material_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- issue_document(): new (Decision 4). Models supersede_committed_cost()'s
-- exact claim-old/insert-new/link shape. issued_by is ALWAYS auth.uid(),
-- never a caller-supplied parameter, so an issuance record can never be
-- forged to claim a different issuer.
-- ---------------------------------------------------------------------
create or replace function public.issue_document(
  p_document_type issued_document_type,
  p_source_id uuid,
  p_document_number text,
  p_canonical_data jsonb
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_prior_id uuid;
  v_prior_version integer;
  v_new_id uuid;
begin
  select id, version into v_prior_id, v_prior_version
  from issued_documents
  where document_type = p_document_type and source_id = p_source_id and superseded_at is null
  order by version desc limit 1
  for update;

  insert into issued_documents (document_type, source_id, document_number, version, issued_by, canonical_data)
  values (p_document_type, p_source_id, p_document_number, coalesce(v_prior_version, 0) + 1, auth.uid(), p_canonical_data)
  returning id into v_new_id;

  if v_prior_id is not null then
    update issued_documents set superseded_at = now(), superseded_by_id = v_new_id where id = v_prior_id;
  end if;

  return v_new_id;
end;
$$;

revoke all on function public.issue_document(issued_document_type, uuid, text, jsonb) from public;
grant execute on function public.issue_document(issued_document_type, uuid, text, jsonb) to authenticated;
```

- [ ] **Step 7: Write `schema/015_commitments_bids_procurement_down.sql`**

```sql
drop function if exists public.issue_document(issued_document_type, uuid, text, jsonb);
drop function if exists public.commit_material_order(uuid);
drop function if exists public.award_bid(uuid);

drop trigger if exists audit_issued_documents on issued_documents;
drop function if exists public.log_audit_via_issued_document();
drop trigger if exists issued_documents_no_delete on issued_documents;
drop trigger if exists issued_documents_immutable on issued_documents;
drop function if exists public.enforce_issued_document_immutability();
drop table if exists issued_documents;
drop type if exists issued_document_type;

drop trigger if exists audit_material_order_line_items on material_order_line_items;
drop function if exists public.log_audit_via_material_order();
drop trigger if exists material_order_line_items_frozen_after_commit on material_order_line_items;
drop function if exists public.enforce_material_order_line_item_frozen_after_commit();
drop trigger if exists material_order_line_items_project_matches_order on material_order_line_items;
drop function if exists public.enforce_line_item_project_matches_order();
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

drop policy if exists audit_log_vendor_members_staff_select on audit_log;
drop trigger if exists audit_vendor_members on vendor_members;
drop trigger if exists vendor_members_no_delete on vendor_members;
drop trigger if exists vendor_members_org_match on vendor_members;
drop function if exists public.enforce_vendor_member_org_match();
drop function if exists public.is_vendor_member(uuid);
drop table if exists vendor_members;
```

- [ ] **Step 8: Mirror into `supabase/migrations/20260814000000_commitments_bids_procurement.sql`**

Concatenate the up-migration body from Steps 1–6 into this single timestamped file, matching the existing dual-directory mirroring convention (check the 014 mirror's exact naming/format before writing this one).

- [ ] **Step 9: Run migration 015 against the ephemeral PGlite test harness**

Run: `node scripts/db/run-sql-tests.mjs` (after temporarily adding `schema/015_commitments_bids_procurement.sql` to `FILES` if Task 2 hasn't added the real test file yet).
Expected: migration applies with no errors.

- [ ] **Step 10: Commit**

```bash
git add schema/015_commitments_bids_procurement.sql schema/015_commitments_bids_procurement_down.sql supabase/migrations/20260814000000_commitments_bids_procurement.sql
git commit -m "feat(P5): migration 015 — commitments, bids, procurement schema (line-level cost codes, vendor_members, issued_documents)"
```

---

### Task 2: SQL tests for migration 015

**Files:**
- Create: `tests/sql/package_p5_commitments_bids_procurement_tests.sql`
- Modify: `scripts/db/run-sql-tests.mjs` (add both new files to `FILES`, after the P4 entries)

**Interfaces:**
- Consumes: `set_test_user`/`clear_test_user`/`assert_that`/`assert_raises`/`test_fixture_ids` helpers; fixtures `admin`, `org_b_admin`, `project_a`, `cost_code_a`.
- Produces: a second cost-code fixture (`cost_code_a2`, on `project_a`) so cross-cost-code material order tests have two real codes to allocate against; two vendor-session fixtures (`vendor_a_user_1`, `vendor_a_user_2`) linked to the same vendor via `vendor_members`, proving "two members, one business."

- [ ] **Step 1: Add both files to `scripts/db/run-sql-tests.mjs`'s `FILES` array**

```js
// after "schema/014_import_amount_canonicalization_and_audit_attribution.sql"
"schema/015_commitments_bids_procurement.sql",
// after "tests/sql/package_p4_estimating_qb_import_tests.sql"
"tests/sql/package_p5_commitments_bids_procurement_tests.sql",
```

- [ ] **Step 2: Section 1 — composite FK + staff RLS + cross-org isolation (bid_packages, material_orders, issued_documents)**

```sql
-- =====================================================================
-- Stone Column Portal — P5 (Commitments, Bids, Procurement) SQL/RLS
-- test suite, covering schema/015_commitments_bids_procurement.sql
-- (Revision 2). Runs after schema/001-015 and after package1_tests.sql /
-- package_p1_auth_tests.sql / package_p4_estimating_qb_import_tests.sql.
-- Reused fixtures: 'admin', 'org_b_admin', 'project_a', 'cost_code_a'.
-- =====================================================================

-- =====================================================================
-- SECTION 1 — composite FK + staff RLS + cross-org isolation.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_bid_package_id uuid;
  v_material_order_id uuid;
  v_vendor_id uuid;
  v_cost_code_a2 uuid;
begin
  insert into bid_packages (project_id, cost_code_id, title, scope_description)
  select value, (select value from test_fixture_ids where key = 'cost_code_a'), 'Framing Bid Package', 'Full framing scope'
  from test_fixture_ids where key = 'project_a'
  returning id into v_bid_package_id;
  insert into test_fixture_ids values ('bid_package_a', v_bid_package_id);

  perform assert_that((select count(*) from bid_packages where id = v_bid_package_id) = 1, 'org A admin can create a bid package');

  -- A second real cost code on project_a, for the line-level allocation
  -- tests in Section 6 (Decision 2).
  insert into cost_codes (project_id, code, name)
  select value, '09-100', 'Drywall' from test_fixture_ids where key = 'project_a'
  returning id into v_cost_code_a2;
  insert into test_fixture_ids values ('cost_code_a2', v_cost_code_a2);

  insert into vendors (org_id, name)
  select org_id, 'Acme Framing' from profiles where id = (select value from test_fixture_ids where key = 'admin')
  returning id into v_vendor_id;
  insert into test_fixture_ids values ('vendor_a', v_vendor_id);

  -- No cost_code_id at all on the order — proves Decision 2's
  -- "order-level default is optional" directly.
  insert into material_orders (project_id, vendor_id, order_number)
  select value, v_vendor_id, 'PO-1001' from test_fixture_ids where key = 'project_a'
  returning id into v_material_order_id;
  insert into test_fixture_ids values ('material_order_a', v_material_order_id);

  perform assert_that((select count(*) from material_orders where id = v_material_order_id) = 1, 'org A admin can create a material order with no order-level cost code default');

  insert into test_fixture_ids
  select 'org_a_id', org_id from profiles where id = (select value from test_fixture_ids where key = 'admin');
end $$;

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 0, 'org B admin cannot see org A''s bid package');
  perform assert_that((select count(*) from material_orders where id = (select value from test_fixture_ids where key = 'material_order_a')) = 0, 'org B admin cannot see org A''s material order');
end $$;

reset role;
select clear_test_user();
```

- [ ] **Step 3: Run to verify Section 1 passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: PASS.

- [ ] **Step 4: Section 2 — `vendor_members`: org-match trigger, `is_vendor_member()`, all three vendor isolation axes**

```sql
-- =====================================================================
-- SECTION 2 — vendor_members: org isolation (DB-enforced, not just
-- RLS), and all three required vendor isolation axes per
-- PRODUCTION-ROADMAP.md's vendor-RLS-sequencing rule item 5, extended
-- in this revision to include "two members, one vendor."
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_vendor_a_user_1 uuid := gen_random_uuid();
  v_vendor_a_user_2 uuid := gen_random_uuid();
  v_vendor_b_user uuid := gen_random_uuid();
  v_second_vendor uuid;
  v_second_bid_package uuid;
  v_org_a_id uuid;
begin
  select org_id into v_org_a_id from profiles where id = (select value from test_fixture_ids where key = 'admin');

  -- Two DIFFERENT people, same vendor business (vendor_a).
  insert into profiles (id, org_id, role, full_name, email)
  values
    (v_vendor_a_user_1, v_org_a_id, 'vendor', 'Acme Framing — Owner', 'owner@acmeframing.example'),
    (v_vendor_a_user_2, v_org_a_id, 'vendor', 'Acme Framing — Estimator', 'estimator@acmeframing.example');
  insert into project_members (project_id, user_id, member_role)
  select value, v_vendor_a_user_1, 'vendor' from test_fixture_ids where key = 'project_a';
  insert into project_members (project_id, user_id, member_role)
  select value, v_vendor_a_user_2, 'vendor' from test_fixture_ids where key = 'project_a';
  insert into vendor_members (vendor_id, profile_id)
  values
    ((select value from test_fixture_ids where key = 'vendor_a'), v_vendor_a_user_1),
    ((select value from test_fixture_ids where key = 'vendor_a'), v_vendor_a_user_2);
  insert into test_fixture_ids values ('vendor_a_user_1', v_vendor_a_user_1);
  insert into test_fixture_ids values ('vendor_a_user_2', v_vendor_a_user_2);

  -- A second, unrelated vendor business, invited to a DIFFERENT package.
  insert into vendors (org_id, name) values (v_org_a_id, 'Beta Electric') returning id into v_second_vendor;
  insert into profiles (id, org_id, role, full_name, email)
  values (v_vendor_b_user, v_org_a_id, 'vendor', 'Beta Electric Contact', 'beta@example.com');
  insert into project_members (project_id, user_id, member_role)
  select value, v_vendor_b_user, 'vendor' from test_fixture_ids where key = 'project_a';
  insert into vendor_members (vendor_id, profile_id) values (v_second_vendor, v_vendor_b_user);
  insert into test_fixture_ids values ('vendor_b_user', v_vendor_b_user);

  insert into bid_packages (project_id, cost_code_id, title, status)
  select value, (select value from test_fixture_ids where key = 'cost_code_a2'), 'Electrical Bid Package', 'published'
  from test_fixture_ids where key = 'project_a'
  returning id into v_second_bid_package;
  insert into test_fixture_ids values ('bid_package_electrical', v_second_bid_package);

  insert into bid_submissions (bid_package_id, vendor_id)
  values ((select value from test_fixture_ids where key = 'bid_package_a'), (select value from test_fixture_ids where key = 'vendor_a'));
  insert into test_fixture_ids
  select 'bid_submission_a', id from bid_submissions where bid_package_id = (select value from test_fixture_ids where key = 'bid_package_a');

  insert into bid_submissions (bid_package_id, vendor_id) values (v_second_bid_package, v_second_vendor);

  update bid_packages set status = 'published' where id = (select value from test_fixture_ids where key = 'bid_package_a');
end $$;

-- Org-match trigger: reject linking org B's admin (a real, different-org
-- profile) to org A's vendor.
select assert_raises(
  format(
    'insert into vendor_members (vendor_id, profile_id) values (%L, %L)',
    (select value from test_fixture_ids where key = 'vendor_a'),
    (select value from test_fixture_ids where key = 'org_b_admin')
  ),
  'linking a cross-org profile to a vendor must be rejected by enforce_vendor_member_org_match()'
);

reset role;
select clear_test_user();

-- A third project, to prove cross-project isolation independently of
-- cross-vendor isolation.
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
  insert into cost_codes (project_id, code, name) values (v_project_b, '06-100', 'Framing') returning id into v_cost_code_b;
  insert into bid_packages (project_id, cost_code_id, title, status) values (v_project_b, v_cost_code_b, 'Other Project Framing', 'published');
  insert into test_fixture_ids values ('project_b_id', v_project_b);
end $$;

reset role;
select clear_test_user();

-- Vendor A, person 1.
select set_test_user((select value from test_fixture_ids where key = 'vendor_a_user_1'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 1, 'vendor A person 1 can see the bid package they are invited to');
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_electrical')) = 0, 'vendor A person 1 (cross-vendor) sees nothing belonging to vendor B');
  perform assert_that((select count(*) from bid_packages where project_id = (select value from test_fixture_ids where key = 'project_b_id')) = 0, 'vendor A person 1 (cross-project) sees nothing on a project they are not a member of');
end $$;

reset role;
select clear_test_user();

-- Vendor A, person 2 — DIFFERENT auth identity, SAME vendor business:
-- must see exactly what person 1 sees (new required axis this revision).
select set_test_user((select value from test_fixture_ids where key = 'vendor_a_user_2'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 1, 'vendor A person 2 (different login, same vendor business) sees the same bid package as person 1');
  perform assert_that((select count(*) from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 1, 'vendor A person 2 can read the shared bid_submissions row');
end $$;

reset role;
select clear_test_user();
```

- [ ] **Step 5: Run to verify Section 2 passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: PASS, including the org-match rejection and all three isolation-axis assertions.

- [ ] **Step 6: Section 3 — `bid_questions` provenance (Decision 8)**

```sql
-- =====================================================================
-- SECTION 3 — bid_questions: staff-recorded provenance cannot be
-- omitted or forged as vendor-originated.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_question_id uuid;
begin
  insert into bid_questions (bid_package_id, vendor_id, question_text)
  values (
    (select value from test_fixture_ids where key = 'bid_package_a'),
    (select value from test_fixture_ids where key = 'vendor_a'),
    'Does the framing scope include the detached studio roof?'
  )
  returning id into v_question_id;
  insert into test_fixture_ids values ('bid_question_a', v_question_id);

  perform assert_that(
    (select source from bid_questions where id = v_question_id) = 'staff_recorded',
    'a plain staff insert defaults to source=staff_recorded'
  );
  perform assert_that(
    (select recorded_by from bid_questions where id = v_question_id) = (select value from test_fixture_ids where key = 'admin'),
    'recorded_by is populated from auth.uid() via column default, not a client-supplied value'
  );
end $$;

-- bid_questions_staff_recorded_requires_recorder: explicitly forcing
-- recorded_by to null on a staff_recorded row must be rejected.
select assert_raises(
  format(
    $sql$insert into bid_questions (bid_package_id, vendor_id, question_text, source, recorded_by)
         values (%L, %L, 'test', 'staff_recorded', null)$sql$,
    (select value from test_fixture_ids where key = 'bid_package_a'),
    (select value from test_fixture_ids where key = 'vendor_a')
  ),
  'a staff_recorded question with recorded_by forced to null must be rejected'
);

reset role;
select clear_test_user();
```

- [ ] **Step 7: Run to verify Section 3 passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: PASS.

- [ ] **Step 8: Section 4 — `award_bid()` (unchanged behavior, re-verified against the new vendor_members-based RLS)**

```sql
-- =====================================================================
-- SECTION 4 — award_bid(): unchanged behavior from Revision 1,
-- re-verified now that vendor RLS resolves through vendor_members.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  update bid_submissions set status = 'submitted', amount_cents = 4_500_000, submitted_at = now()
  where id = (select value from test_fixture_ids where key = 'bid_submission_a');

  perform assert_that(
    (select status from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 'submitted',
    'a properly-amounted submission is accepted'
  );
end $$;

do $$
declare
  v_committed_cost_id uuid;
begin
  select award_bid((select value from test_fixture_ids where key = 'bid_submission_a')) into v_committed_cost_id;
  insert into test_fixture_ids values ('committed_cost_from_award', v_committed_cost_id);

  perform assert_that((select status from bid_submissions where id = (select value from test_fixture_ids where key = 'bid_submission_a')) = 'awarded', 'awarded submission moves to status awarded');
  perform assert_that((select status from bid_packages where id = (select value from test_fixture_ids where key = 'bid_package_a')) = 'awarded', 'bid package moves to status awarded');
  perform assert_that((select source_type from committed_costs where id = v_committed_cost_id) = 'bid_award', 'the new committed_costs row is tagged source_type=bid_award');
  perform assert_that((select amount_cents from committed_costs where id = v_committed_cost_id) = 4_500_000, 'the committed_costs amount matches the awarded bid amount');
end $$;

select assert_raises(
  format('select award_bid(%L)', (select value from test_fixture_ids where key = 'bid_submission_a')),
  'awarding an already-awarded submission must be rejected'
);

reset role;
select clear_test_user();
```

- [ ] **Step 9: Section 5 — `enforce_line_item_project_matches_order()` and the post-commit freeze trigger**

```sql
-- =====================================================================
-- SECTION 5 — material_order_line_items: project/order consistency and
-- the post-commit freeze (Decision 10).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

-- Cross-project line item must be rejected outright.
select assert_raises(
  format(
    $sql$insert into material_order_line_items (material_order_id, project_id, cost_code_id, description, quantity, unit_price_cents)
         values (%L, %L, %L, 'Mismatched project lumber', 10, 500)$sql$,
    (select value from test_fixture_ids where key = 'material_order_a'),
    (select value from test_fixture_ids where key = 'project_b_id'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'a line item whose project_id does not match its order''s project_id must be rejected'
);

do $$
declare
  v_line_item_1 uuid;
  v_line_item_2 uuid;
begin
  insert into material_order_line_items (material_order_id, project_id, cost_code_id, description, quantity, unit, unit_price_cents)
  select
    (select value from test_fixture_ids where key = 'material_order_a'),
    value,
    (select value from test_fixture_ids where key = 'cost_code_a'),
    '2x6 Lumber', 100, 'ea', 850
  from test_fixture_ids where key = 'project_a'
  returning id into v_line_item_1;
  insert into test_fixture_ids values ('material_order_line_a_framing', v_line_item_1);

  insert into material_order_line_items (material_order_id, project_id, cost_code_id, description, quantity, unit, unit_price_cents)
  select
    (select value from test_fixture_ids where key = 'material_order_a'),
    value,
    (select value from test_fixture_ids where key = 'cost_code_a2'),
    'Drywall Sheets', 40, 'ea', 1_200
  from test_fixture_ids where key = 'project_a'
  returning id into v_line_item_2;
  insert into test_fixture_ids values ('material_order_line_a_drywall', v_line_item_2);
end $$;

select assert_raises(
  format('update material_order_line_items set received_quantity = 150 where id = %L', (select value from test_fixture_ids where key = 'material_order_line_a_framing')),
  'received_quantity greater than quantity must be rejected'
);
```

- [ ] **Step 10: Run to verify Section 5 (first half) passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: PASS.

- [ ] **Step 11: Section 6 — `commit_material_order()` across two cost codes, then verify the freeze trigger**

```sql
-- =====================================================================
-- SECTION 6 — commit_material_order() with line items spanning two
-- cost codes (Decision 2's core behavior change), then confirming the
-- freeze trigger (Decision 10) actually engages post-commit.
-- =====================================================================

-- Rejects committing an order with zero line items — use a fresh order.
do $$
declare
  v_empty_order_id uuid;
begin
  insert into material_orders (project_id, vendor_id)
  select value, (select value from test_fixture_ids where key = 'vendor_a') from test_fixture_ids where key = 'project_a'
  returning id into v_empty_order_id;

  perform assert_raises(
    format('select commit_material_order(%L)', v_empty_order_id),
    'committing a material order with no line items must be rejected'
  );
end $$;

-- Happy path: material_order_a has two line items on two different
-- cost codes (Step 9 above) — commit must produce TWO committed_costs
-- rows, correctly summed per code, sharing source_id.
do $$
declare
  v_ids uuid[];
  v_id uuid;
  v_row_count integer;
begin
  select array_agg(id) into v_ids from commit_material_order((select value from test_fixture_ids where key = 'material_order_a'));

  perform assert_that(array_length(v_ids, 1) = 2, 'committing an order with two cost codes produces exactly two committed_costs rows');

  select count(*) into v_row_count from committed_costs
  where source_type = 'material_order' and source_id = (select value from test_fixture_ids where key = 'material_order_a');
  perform assert_that(v_row_count = 2, 'both new rows share source_id = the material order''s id');

  perform assert_that(
    (select amount_cents from committed_costs where cost_code_id = (select value from test_fixture_ids where key = 'cost_code_a')
      and source_id = (select value from test_fixture_ids where key = 'material_order_a')) = 100 * 850,
    'the framing-cost-code row sums only the framing line item (100 * 850)'
  );
  perform assert_that(
    (select amount_cents from committed_costs where cost_code_id = (select value from test_fixture_ids where key = 'cost_code_a2')
      and source_id = (select value from test_fixture_ids where key = 'material_order_a')) = 40 * 1_200,
    'the drywall-cost-code row sums only the drywall line item (40 * 1200), not both'
  );

  perform assert_that(
    (select status from material_orders where id = (select value from test_fixture_ids where key = 'material_order_a')) = 'ordered',
    'committed material order moves to status ordered'
  );
end $$;

select assert_raises(
  format('select commit_material_order(%L)', (select value from test_fixture_ids where key = 'material_order_a')),
  'committing an already-ordered material order must be rejected'
);

-- Decision 10: the freeze trigger. Committed fields reject; a new line
-- item insert rejects; received_quantity/backordered still succeed.
select assert_raises(
  format('update material_order_line_items set quantity = 200 where id = %L', (select value from test_fixture_ids where key = 'material_order_line_a_framing')),
  'editing quantity on a line item of a non-draft order must be rejected'
);
select assert_raises(
  format(
    $sql$insert into material_order_line_items (material_order_id, project_id, cost_code_id, description, quantity, unit_price_cents)
         values (%L, %L, %L, 'Late addition', 5, 100)$sql$,
    (select value from test_fixture_ids where key = 'material_order_a'),
    (select value from test_fixture_ids where key = 'project_a'),
    (select value from test_fixture_ids where key = 'cost_code_a')
  ),
  'inserting a new line item on a non-draft order must be rejected'
);
select assert_raises(
  format('delete from material_order_line_items where id = %L', (select value from test_fixture_ids where key = 'material_order_line_a_framing')),
  'deleting a line item of a non-draft order must be rejected'
);

do $$
begin
  update material_order_line_items set received_quantity = 60, backordered = true
  where id = (select value from test_fixture_ids where key = 'material_order_line_a_drywall');

  perform assert_that(
    (select backordered from material_order_line_items where id = (select value from test_fixture_ids where key = 'material_order_line_a_drywall')) = true,
    'received_quantity/backordered remain editable after commit — proves the freeze is scoped to committed fields only'
  );
end $$;

reset role;
select clear_test_user();
```

- [ ] **Step 12: Run to verify Section 6 passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: PASS — this is the core behavior change of this revision; verify carefully before proceeding.

- [ ] **Step 13: Section 7 — `issue_document()`: versioning, supersession, immutability, cross-org RLS**

```sql
-- =====================================================================
-- SECTION 7 — issue_document(): claim-old/insert-new/link versioning
-- (Decision 4), immutability, and RLS for both document_type values.
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
declare
  v_doc_v1 uuid;
  v_doc_v2 uuid;
begin
  select issue_document(
    'purchase_order',
    (select value from test_fixture_ids where key = 'material_order_a'),
    'PO-1001',
    '{"vendor": "Acme Framing", "lineItems": [{"description": "2x6 Lumber", "costCode": "06-100"}]}'::jsonb
  ) into v_doc_v1;
  insert into test_fixture_ids values ('issued_document_v1', v_doc_v1);

  perform assert_that((select version from issued_documents where id = v_doc_v1) = 1, 'first issuance is version 1');
  perform assert_that((select superseded_at from issued_documents where id = v_doc_v1) is null, 'version 1 starts non-superseded');

  select issue_document(
    'purchase_order',
    (select value from test_fixture_ids where key = 'material_order_a'),
    'PO-1001',
    '{"vendor": "Acme Framing", "lineItems": [{"description": "2x6 Lumber", "costCode": "06-100"}], "revisionNote": "corrected delivery address"}'::jsonb
  ) into v_doc_v2;
  insert into test_fixture_ids values ('issued_document_v2', v_doc_v2);

  perform assert_that((select version from issued_documents where id = v_doc_v2) = 2, 'a second issuance for the same source is version 2');
  perform assert_that((select superseded_by_id from issued_documents where id = v_doc_v1) = v_doc_v2, 'version 1 now points at version 2 as its successor');
  perform assert_that((select superseded_at from issued_documents where id = v_doc_v1) is not null, 'version 1 is now marked superseded');
  perform assert_that((select issued_by from issued_documents where id = v_doc_v1) = (select value from test_fixture_ids where key = 'admin'), 'issued_by is the actual authenticated session, not a parameter');
end $$;

-- Immutability: a direct update to canonical_data must be rejected.
select assert_raises(
  format('update issued_documents set canonical_data = ''{}''::jsonb where id = %L', (select value from test_fixture_ids where key = 'issued_document_v2')),
  'directly editing canonical_data on an existing issued_documents row must be rejected'
);

-- No delete, ever.
select assert_raises(
  format('delete from issued_documents where id = %L', (select value from test_fixture_ids where key = 'issued_document_v1')),
  'deleting an issued_documents row must be rejected'
);

reset role;
select clear_test_user();

select set_test_user((select value from test_fixture_ids where key = 'org_b_admin'));
set local role authenticated;

do $$
begin
  perform assert_that(
    (select count(*) from issued_documents where id = (select value from test_fixture_ids where key = 'issued_document_v1')) = 0,
    'org B admin cannot see org A''s issued_documents row'
  );
end $$;

reset role;
select clear_test_user();
```

- [ ] **Step 14: Run to verify Section 7 passes**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: PASS.

- [ ] **Step 15: Section 8 — audit visibility across all seven new tables**

```sql
-- =====================================================================
-- SECTION 8 — audit visibility: every new table's writes produce a
-- real, staff-readable audit_log row (same bar P4 set).
-- =====================================================================

select set_test_user((select value from test_fixture_ids where key = 'admin'));
set local role authenticated;

do $$
begin
  perform assert_that((select count(*) from audit_log where table_name = 'vendor_members') > 0, 'vendor_members writes produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'bid_packages' and record_id = (select value from test_fixture_ids where key = 'bid_package_a')) > 0, 'bid_packages insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'bid_submissions' and record_id = (select value from test_fixture_ids where key = 'bid_submission_a')) > 0, 'bid_submissions insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'bid_questions' and record_id = (select value from test_fixture_ids where key = 'bid_question_a')) > 0, 'bid_questions insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'material_orders' and record_id = (select value from test_fixture_ids where key = 'material_order_a')) > 0, 'material_orders insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'material_order_line_items' and record_id = (select value from test_fixture_ids where key = 'material_order_line_a_framing')) > 0, 'material_order_line_items insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'issued_documents' and record_id = (select value from test_fixture_ids where key = 'issued_document_v1')) > 0, 'issued_documents insert produced a readable audit_log row');
  perform assert_that((select count(*) from audit_log where table_name = 'issued_documents' and record_id = (select value from test_fixture_ids where key = 'issued_document_v1') and action = 'update') > 0, 'issued_documents supersession (the update to v1) produced its own separate readable audit_log row');
end $$;

reset role;
select clear_test_user();
```

- [ ] **Step 16: Run the full P5 test file + full existing suite together**

Run: `node scripts/db/run-sql-tests.mjs`
Expected: every file in `FILES` passes, including `committed_forecast_hardening_tests.sql` unchanged (`supersede_committed_cost()` unaffected by the new writes).

- [ ] **Step 17: Commit**

```bash
git add tests/sql/package_p5_commitments_bids_procurement_tests.sql scripts/db/run-sql-tests.mjs
git commit -m "test(P5): SQL/RLS test suite for migration 015 (line-level cost codes, vendor_members, issued_documents)"
```

---

### Task 3: Extend `CommittedCost` type + repository mapping for vendor/source display

**Unchanged from Revision 1** — `sourceId` already tolerates multiple `committed_costs` rows sharing one value (it was never modeled as unique), so Decision 2's multi-row-per-order behavior needs no type change here.

**Files:**
- Modify: `packages/01-financial-engine/src/types.ts` (`CommittedCost` interface)
- Modify: `packages/02-app-shell/src/data/supabaseFinancialRepository.ts` (`getCommittedCosts` mapping)

**Interfaces:**
- Produces: `CommittedCost.vendorName?: string`, `CommittedCost.sourceType?: string`, `CommittedCost.sourceId?: string`.

- [ ] **Step 1: Add the three optional fields to `CommittedCost` in `packages/01-financial-engine/src/types.ts`**

```typescript
export interface CommittedCost {
  id: ID;
  projectId: ID;
  costCodeId: ID;
  amountCents: Cents;
  status: "open" | "fulfilled" | "cancelled";
  supersededAt?: ISODate | null;
  supersededById?: ID | null;
  vendorName?: string;   // display-only, mirrors Expense.vendorName
  sourceType?: string;   // e.g. "bid_award" | "material_order"
  sourceId?: ID;         // NOT unique — a material order may back several rows sharing one sourceId
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — additive/optional, no fixture change required.

- [ ] **Step 3: Extend `getCommittedCosts` in `supabaseFinancialRepository.ts`**

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

- [ ] **Step 4: Run typecheck + existing financial-engine unit tests**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/01-financial-engine/src/types.ts packages/02-app-shell/src/data/supabaseFinancialRepository.ts
git commit -m "feat(P5): surface committed_costs vendor/source fields for display"
```

---

### Task 4: Bid package service functions + thin Server Actions

**Unchanged from Revision 1** — no field/behavior in `bidService.ts`'s package-management half (`createBidPackage`, `publishBidPackage`, `inviteVendor`, `listBidPackages`, `getBidPackageDetail`) depends on vendor identity resolution or line-level cost codes; those are RLS-side and material-order-side changes respectively. Implement exactly as Revision 1 specified:

**Files:**
- Create: `packages/02-app-shell/src/services/bidService.ts`
- Create: `apps/web/app/admin/bids/actions.ts`

- [ ] **Step 1: Write `listBidPackages`, `createBidPackage`, `publishBidPackage` in `packages/02-app-shell/src/services/bidService.ts`**

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
  if (!title.trim()) return { error: "Title is required." };
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

- [ ] **Step 2: Append `inviteVendor`, `getBidPackageDetail`**

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

### Task 5: Bid submission recording + award + Q&A/addenda service functions

**Revised from Revision 1:** `askBidQuestion` no longer accepts or sets `recorded_by` — it is populated automatically by the column's own `default auth.uid()` (Decision 8), so the service function must NOT include it in the insert payload (passing an explicit value would defeat the anti-spoofing point of the default).

**Files:**
- Modify: `packages/02-app-shell/src/services/bidService.ts` (append)
- Create: `apps/web/app/admin/bids/submissionActions.ts`

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

export interface BidQuestionRow {
  id: string;
  bidPackageId: string;
  vendorId: string | null;
  source: "staff_recorded" | "vendor_submitted";
  recordedBy: string | null;
  questionText: string;
  askedAt: string;
  answerText: string | null;
  answeredAt: string | null;
}

/** source is always 'staff_recorded' here (P5 has no vendor session to
 *  submit directly) and recorded_by is intentionally OMITTED from the
 *  insert payload — the column's own `default auth.uid()` populates it
 *  from the actual authenticated session, never a value this function
 *  could be tricked into passing on someone else's behalf. */
export async function askBidQuestion(supabase: SupabaseClient, bidPackageId: string, vendorId: string, questionText: string) {
  if (!questionText.trim()) return { error: "Question text is required." };
  const { error } = await supabase
    .from("bid_questions")
    .insert({ bid_package_id: bidPackageId, vendor_id: vendorId, question_text: questionText.trim(), source: "staff_recorded" });
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

export async function listBidQuestions(supabase: SupabaseClient, bidPackageId: string): Promise<BidQuestionRow[]> {
  const { data, error } = await supabase.from("bid_questions").select("*").eq("bid_package_id", bidPackageId).order("asked_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    bidPackageId: row.bid_package_id,
    vendorId: row.vendor_id,
    source: row.source,
    recordedBy: row.recorded_by,
    questionText: row.question_text,
    askedAt: row.asked_at,
    answerText: row.answer_text,
    answeredAt: row.answered_at,
  }));
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
git commit -m "feat(P5): bid submission recording, award, and provenance-carrying Q&A"
```

---

### Task 6: `/admin/bids` screen — functional specification

**Per explicit instruction, this task is a specification for the implementer to build from, not inlined component code.** The implementer opens `packages/02-app-shell/src/components/ImportWizard.tsx` and `apps/web/app/admin/import/page.tsx` first — P4's closest analog for "a multi-entity, real-backend-only admin screen with no fixture path" — and follows its concrete patterns (local `useState` for selection/form fields, `startTransition` wrapping every Server Action call, re-fetch-after-mutation, inline error text sourced from a Server Action's `{ error }` return) while implementing everything below.

**Files:**
- Create: `apps/web/app/admin/bids/page.tsx`
- Create: `packages/02-app-shell/src/components/BidPackageWorkspace.tsx` (single client component owning list + detail + all forms — do not split into `BidPackageList`/`BidPackageDetail` as separate files; one cohesive component matching `ImportWizard.tsx`'s own single-file-per-workflow shape)
- Modify: `apps/web/src/shell/AdminChrome.tsx` (add nav entry)

**Interfaces:**
- Consumes: `listBidPackages`, `getBidPackageDetail`, `listBidQuestions` (Task 4/5, read); `createBidPackage`, `publishBidPackage`, `inviteVendor`, `recordBidSubmission`, `awardBid`, `askBidQuestion`, `answerBidQuestion`, `issueBidAddendum` (Task 4/5, Server Actions); `issueSubcontract` (Task 8's `documentIssuanceService.ts`, Server Action); `repo.getCostCodes` (existing `FinancialRepository`); a vendor picker needs a list of the org's `vendors` (new, small `listVendors(supabase, orgId)` read helper — add to `bidService.ts` in this task, not a separate task, since it exists purely to support this screen's invite form: `select id, name from vendors where org_id = $1 and is_archived = false order by name`).

**Authorization:**
- Page-level: `requireRole(["admin", "staff"])` in `page.tsx`, same as every other `/admin/*` page — redirects unauthenticated users to `/login`, throws `AuthorizationError` for a wrong-role authenticated user (caught by the framework's default error boundary for a Server Component, same as every existing `/admin/*` page — no new handling needed here, unlike the PDF Route Handlers in Task 10 which must catch it explicitly since Route Handlers have no such boundary).
- Defense in depth: every mutation below is still gated by RLS on the underlying tables regardless of what the page's own `requireRole` check does — a bug in the page-level check cannot itself grant a write that RLS wouldn't otherwise allow.
- This screen is **staff/admin only, no client or vendor role ever reaches it** — there is no client-visible variant of this screen in P5 (bids are internal procurement, not something a homeowner client sees).

**Navigation:**
- URL: `/admin/bids`.
- Add `{ key: "bids", label: "Bids" }` to `AdminChrome`'s nav array, positioned after `estimate`/`import` and before `commitments`/`procurement` (open `AdminChrome.tsx` first to match its exact existing entry shape — do not guess the object shape).
- No breadcrumb/back-link needed — this is a top-level nav destination, same flat structure as `/admin/estimate`.

**Data flow:**
1. `page.tsx` (Server Component): `requireRole` → resolve "first project" (same `projects` query pattern as `/admin/estimate`/`/admin/import`) → `listBidPackages(supabase, projectId)` + `repo.getCostCodes(projectId)` + `listVendors(supabase, orgId)`, all in parallel via `Promise.all` → passes the three arrays plus `projectId` as props into `BidPackageWorkspace` (client component).
2. `BidPackageWorkspace` holds `selectedBidPackageId` in `useState`. Selecting a package from the list triggers a fetch of `getBidPackageDetail` + `listBidQuestions` for that id — since these are plain async service functions, not currently exposed as Server Actions, this task adds two thin read-only Server Actions (`getBidPackageDetail`, `listBidQuestions`) in `apps/web/app/admin/bids/actions.ts` alongside the existing write ones, called from a `useEffect`/`startTransition` on selection change (mirrors how `/admin/import`'s wizard re-fetches `import_rows` after each step).
3. Every mutating action (create, publish, invite, record submission, award, ask/answer question, issue addendum, issue subcontract) is: call the Server Action inside `startTransition` → on `{ error }`, display it inline near the triggering control (do not use a global toast/alert — matches no existing `/admin/*` screen using one) → on success, re-fetch the detail (Step 2's fetch) so the UI reflects the new DB state rather than hand-rolling an optimistic local update (this repo has no existing optimistic-update pattern to extend; re-fetch-after-mutation is P4's own established approach in `/admin/import`).

**Loading/error/empty states (each named explicitly — implementer must handle all of them, not just the happy path):**
- **Page-level empty:** no project exists for the org yet → the exact `<p>No projects yet for this organization.</p>` message `/admin/import/page.tsx` already uses, inside `AdminChrome`, for consistency.
- **List-level empty:** zero bid packages yet → "No bid packages yet. Create one to get started." with the create-package form still visible/usable.
- **List-level loading:** none needed — the list is server-fetched before first paint (Server Component), so there's no client-side list-loading spinner state to build.
- **Detail-level loading:** selecting a package shows a lightweight inline "Loading…" in the detail pane while the `getBidPackageDetail`/`listBidQuestions` fetch is in flight (`useTransition`'s `pending` flag drives this — no separate loading state variable needed).
- **Detail-level error:** the selected package's detail fetch fails (network/RLS-denied edge case) → inline error text in the detail pane, with a "Retry" control that re-runs the same fetch; does not clear the list.
- **Detail-level empty (no submissions yet):** a freshly-created, unpublished package's detail shows "No vendors invited yet" instead of an empty table with just headers.
- **Mutation errors:** every Server Action's `{ error }` string is rendered inline next to the control that triggered it (the amount input for `recordBidSubmission`, the invite button for `inviteVendor`, etc.) — never swallowed, never only logged to the console.
- **Award confirmation:** awarding is irreversible-in-effect (creates a real `committed_costs` row and declines every sibling submission) — the Award button requires a confirmation step (a simple "Are you sure?" inline disclosure before the actual call fires, not a browser `confirm()` dialog, matching this repo having no existing use of `window.confirm` anywhere) before calling `awardBid`.

**Mutations (enumerate every one, its trigger, and its visible effect):**
| Action | Trigger | Visible effect on success |
|---|---|---|
| `createBidPackage` | "Create Package" form submit | New row appears at the top of the list, auto-selected |
| `publishBidPackage` | "Publish" button (draft only) | Status badge updates to `published` |
| `inviteVendor` | "Invite" button next to a vendor picker | New `invited` row appears in the submissions table |
| `recordBidSubmission` | "Record" button next to an amount input, per invited row | Row's status updates to `submitted`, amount displayed |
| `awardBid` | "Award" button (submitted rows only), behind the confirmation step above | That row → `awarded`; every sibling `submitted` row → `declined`; package status → `awarded`; a note pointing at `/admin/commitments` for the resulting row |
| `askBidQuestion` | "Log Question" form submit | New entry in the Q&A log, tagged "Recorded by [staff name]" (Decision 8 — never rendered as if the vendor typed it) |
| `answerBidQuestion` | "Answer" inline form per unanswered question | Question row shows the answer text + answered timestamp |
| `issueBidAddendum` | "Issue Addendum" form submit | New entry in the addenda list; if a revised due date was given, the package's due date updates visibly |
| `issueSubcontract` (Task 8) | "Issue Subcontract" button, visible only once a submission is `awarded` | Opens/links the subcontract PDF (Task 10); a second click after any underlying change creates a new version, and the UI must show "Version 2 issued — view previous version" once that happens |

**Regression tests (what must NOT break as a result of adding this screen):**
- `AdminChrome`'s existing nav entries (`estimate`, `import`, and any others) still render and route correctly — a snapshot/smoke test asserting the nav array's prior entries are all still present, not just the new one.
- `/admin/estimate` and `/admin/import` still build and typecheck unaffected — this task touches no file either of those pages import.
- `npm run build`'s existing route count (currently used as an acceptance-criteria checkpoint per prior packages' closeout docs) increases by exactly the routes this task adds, with no unrelated route disappearing.

- [ ] **Step 1: Implement `packages/02-app-shell/src/components/BidPackageWorkspace.tsx`** per the Data flow / Loading-error-empty / Mutations tables above, following `ImportWizard.tsx`'s concrete state-management idioms.

- [ ] **Step 2: Implement `apps/web/app/admin/bids/page.tsx`** per the Data flow section above, following `/admin/import/page.tsx`'s exact "first project, no demo fallback" shape.

- [ ] **Step 3: Add the two read-only Server Actions (`getBidPackageDetail`, `listBidQuestions`) and `listVendors` to the relevant files** per the Data flow section.

- [ ] **Step 4: Add `"bids"` nav entry to `AdminChrome.tsx`** per the Navigation section — read the file first to match its exact existing entry shape.

- [ ] **Step 5: Start the dev server and manually walk every state enumerated above**

Run: `npm run dev`. Walk, in order: empty list → create package → publish → invite two vendors → record both submissions → confirm the award confirmation step appears → award one → confirm the other auto-declines → log a question (confirm "Recorded by" attribution renders, never looking vendor-authored) → answer it → issue an addendum with a revised due date (confirm the package's due date visibly updates) → trigger at least one deliberate error (e.g., submit an amount as negative) and confirm it renders inline, not silently.

- [ ] **Step 6: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/admin/bids packages/02-app-shell/src/components/BidPackageWorkspace.tsx apps/web/src/shell/AdminChrome.tsx packages/02-app-shell/src/services/bidService.ts
git commit -m "feat(P5): /admin/bids screen"
```

---

### Task 7: `/admin/commitments` screen

**Minor revision from Revision 1:** the table now groups rows sharing a `sourceId` (a material order that produced several `committed_costs` rows, per Decision 2) so staff see "these N rows are one order," not N unrelated-looking entries. Otherwise unchanged.

**Files:**
- Create: `apps/web/app/admin/commitments/page.tsx`
- Create: `apps/web/app/admin/commitments/actions.ts`
- Create: `packages/02-app-shell/src/components/CommitmentsTable.tsx`

- [ ] **Step 1: Write the thin Server Action wrapping the existing RPC in `apps/web/app/admin/commitments/actions.ts`**

```typescript
"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";

export async function supersedeCommittedCost(oldCommittedCostId: string, newAmountCents: number, newVendorName?: string) {
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

- [ ] **Step 2: Write `packages/02-app-shell/src/components/CommitmentsTable.tsx`, grouping by `sourceId` when `sourceType === "material_order"`**

```tsx
"use client";

import React, { useState, useTransition } from "react";
import { colors, spacing } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { CommittedCost } from "../../../01-financial-engine/src/types";

function groupRows(rows: CommittedCost[]): { key: string; rows: CommittedCost[] }[] {
  const groups = new Map<string, CommittedCost[]>();
  for (const row of rows) {
    const key = row.sourceType === "material_order" && row.sourceId ? row.sourceId : row.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.entries()).map(([key, rows]) => ({ key, rows }));
}

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
  const groups = groupRows(openRows);

  return (
    <div className="sc-commitments">
      {groups.map((group) => (
        <table className="sc-commitments-table" key={group.key}>
          {group.rows.length > 1 && (
            <caption>Material order {group.key.slice(0, 8)} — {group.rows.length} cost codes</caption>
          )}
          <thead>
            <tr><th>Vendor</th><th>Cost Code</th><th>Source</th><th>Amount</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {group.rows.map((c) => (
              <tr key={c.id}>
                <td>{c.vendorName ?? "—"}</td>
                <td>{c.costCodeId}</td>
                <td>{c.sourceType ?? "manual"}</td>
                <td>{formatCents(c.amountCents)}</td>
                <td>{c.status}</td>
                <td>
                  {editingId === c.id ? (
                    <>
                      <input type="number" placeholder="New amount ($)" value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)} />
                      <button disabled={pending} onClick={() => startTransition(() => onSupersede(c.id, Math.round(Number(draftAmount) * 100), c.vendorName))}>Confirm</button>
                    </>
                  ) : (
                    <button onClick={() => { setEditingId(c.id); setDraftAmount(""); }}>Supersede</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <style>{`
        .sc-commitments-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: ${spacing.md}; }
        .sc-commitments-table caption { text-align: left; font-size: 11px; color: ${colors.stoneDark}; padding-bottom: 4px; }
        .sc-commitments-table th, .sc-commitments-table td { border-bottom: 1px solid ${colors.line}; padding: 8px; text-align: left; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Write `apps/web/app/admin/commitments/page.tsx`** — unchanged from Revision 1's shape (keeps the demo-mode fallback, since `hawksRidge.committedCosts` is a real fixture):

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

- [ ] **Step 5: Manually verify, including the multi-row grouping**

Run: `npm run dev`, navigate to `/admin/commitments` after Task 2's Section 6 test data (or a real UI-driven equivalent) has committed a two-cost-code material order — confirm both resulting rows render grouped under one caption, not as two unrelated entries.

- [ ] **Step 6: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/admin/commitments packages/02-app-shell/src/components/CommitmentsTable.tsx apps/web/src/shell/AdminChrome.tsx
git commit -m "feat(P5): /admin/commitments screen, grouping multi-cost-code material order commitments"
```

---

### Task 8: Material order + line item service functions + document issuance service

**Substantially revised from Revision 1:** cost code is now a required per-line-item parameter, not inherited from the order; `commitMaterialOrder` returns an array; a new `documentIssuanceService.ts` implements Decision 4.

**Files:**
- Create: `packages/02-app-shell/src/services/procurementService.ts`
- Create: `packages/02-app-shell/src/services/documentIssuanceService.ts`
- Create: `apps/web/app/admin/procurement/actions.ts`

**Interfaces:**
- Consumes: `SupabaseClient`; `getBidPackageDetail` (Task 4, for `issueSubcontract`'s canonical data).
- Produces: `createMaterialOrder`, `addMaterialOrderLineItem`, `commitMaterialOrder`, `recordReceivedQuantity`, `listMaterialOrders`, `getMaterialOrderDetail` (consumed by Task 9); `issuePurchaseOrder`, `issueSubcontract`, `getLatestIssuedDocument`, `getIssuedDocumentVersion` (consumed by Tasks 6, 9, 10).

- [ ] **Step 1: Write `packages/02-app-shell/src/services/procurementService.ts` — types and read functions**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MaterialOrderRow {
  id: string;
  projectId: string;
  defaultCostCodeId: string | null; // convenience default only — never authoritative, see Decision 2
  vendorId: string | null;
  orderNumber: string | null;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  orderedAt: string | null;
  expectedDeliveryAt: string | null;
}

export interface MaterialOrderLineItemRow {
  id: string;
  materialOrderId: string;
  costCodeId: string; // authoritative allocation for this line — Decision 2
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
    defaultCostCodeId: row.cost_code_id,
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
    costCodeId: row.cost_code_id,
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

export async function getMaterialOrderDetail(supabase: SupabaseClient, materialOrderId: string): Promise<MaterialOrderDetail | null> {
  const { data: orderRow, error: orderError } = await supabase.from("material_orders").select("*").eq("id", materialOrderId).maybeSingle();
  if (orderError) throw orderError;
  if (!orderRow) return null;

  const { data: lineRows, error: lineError } = await supabase.from("material_order_line_items").select("*").eq("material_order_id", materialOrderId);
  if (lineError) throw lineError;

  return { ...mapOrder(orderRow), lineItems: (lineRows ?? []).map(mapLineItem) };
}
```

- [ ] **Step 2: Append the write functions, with cost code now required per line item**

```typescript
export async function createMaterialOrder(
  supabase: SupabaseClient,
  projectId: string,
  defaultCostCodeId?: string,
  vendorId?: string,
  orderNumber?: string,
  notes?: string
) {
  const { data, error } = await supabase
    .from("material_orders")
    .insert({ project_id: projectId, cost_code_id: defaultCostCodeId ?? null, vendor_id: vendorId ?? null, order_number: orderNumber ?? null, notes: notes ?? null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

/** costCodeId is REQUIRED — Decision 2 made the order-level cost code
 *  an optional UI convenience only. The caller (Task 9's screen)
 *  pre-fills its input from the order's defaultCostCodeId but must
 *  always pass an explicit, possibly-overridden value here. */
export async function addMaterialOrderLineItem(
  supabase: SupabaseClient,
  materialOrderId: string,
  projectId: string,
  costCodeId: string,
  description: string,
  quantity: number,
  unit: string | undefined,
  unitPriceCents: number
) {
  if (!costCodeId) return { error: "A cost code is required for every line item." };
  if (!description.trim()) return { error: "Description is required." };
  if (!(quantity > 0)) return { error: "Quantity must be greater than zero." };
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) return { error: "Unit price must be a whole number of cents, zero or greater." };
  const { error } = await supabase.from("material_order_line_items").insert({
    material_order_id: materialOrderId,
    project_id: projectId,
    cost_code_id: costCodeId,
    description: description.trim(),
    quantity,
    unit: unit ?? null,
    unit_price_cents: unitPriceCents,
  });
  if (error) return { error: error.message };
  return {};
}

/** Returns an ARRAY — Decision 2 means one order may now back several
 *  committed_costs rows, one per distinct cost code among its lines. */
export async function commitMaterialOrder(supabase: SupabaseClient, materialOrderId: string) {
  const { data, error } = await supabase.rpc("commit_material_order", { p_material_order_id: materialOrderId });
  if (error) return { error: error.message };
  return { committedCostIds: (data as string[] | null) ?? [] };
}

export async function recordReceivedQuantity(supabase: SupabaseClient, lineItemId: string, receivedQuantity: number, markBackordered?: boolean) {
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

- [ ] **Step 3: Run typecheck for `procurementService.ts` in isolation**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Write `packages/02-app-shell/src/services/documentIssuanceService.ts` (Decision 4)**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMaterialOrderDetail } from "./procurementService";
import { getBidPackageDetail } from "./bidService";

export type IssuedDocumentType = "purchase_order" | "subcontract";

export interface IssuedDocumentRow {
  id: string;
  documentType: IssuedDocumentType;
  sourceId: string;
  documentNumber: string;
  version: number;
  issuedAt: string;
  issuedBy: string | null;
  canonicalData: unknown;
  supersededAt: string | null;
  supersededById: string | null;
}

function mapIssuedDocument(row: any): IssuedDocumentRow {
  return {
    id: row.id,
    documentType: row.document_type,
    sourceId: row.source_id,
    documentNumber: row.document_number,
    version: row.version,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by,
    canonicalData: row.canonical_data,
    supersededAt: row.superseded_at,
    supersededById: row.superseded_by_id,
  };
}

export async function getLatestIssuedDocument(supabase: SupabaseClient, documentType: IssuedDocumentType, sourceId: string): Promise<IssuedDocumentRow | null> {
  const { data, error } = await supabase
    .from("issued_documents")
    .select("*")
    .eq("document_type", documentType)
    .eq("source_id", sourceId)
    .is("superseded_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapIssuedDocument(data) : null;
}

export async function getIssuedDocumentVersion(supabase: SupabaseClient, documentType: IssuedDocumentType, sourceId: string, version: number): Promise<IssuedDocumentRow | null> {
  const { data, error } = await supabase
    .from("issued_documents")
    .select("*")
    .eq("document_type", documentType)
    .eq("source_id", sourceId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw error;
  return data ? mapIssuedDocument(data) : null;
}

/** Builds the canonical snapshot from LIVE data at the moment of
 *  issuance, then hands it to issue_document() to freeze. Every field
 *  the PDF template (Task 10) needs must be present here — anything
 *  missing here is unrecoverable later, since post-issuance the
 *  snapshot, not the live tables, is authoritative for this version. */
export async function issuePurchaseOrder(supabase: SupabaseClient, materialOrderId: string, documentNumber?: string) {
  const order = await getMaterialOrderDetail(supabase, materialOrderId);
  if (!order) return { error: "Material order not found." };
  if (order.lineItems.length === 0) return { error: "Cannot issue a PO with no line items." };

  const { data: vendorRow } = order.vendorId ? await supabase.from("vendors").select("name").eq("id", order.vendorId).maybeSingle() : { data: null };

  const canonicalData = {
    materialOrderId: order.id,
    orderNumber: order.orderNumber,
    vendorName: vendorRow?.name ?? "Unknown vendor",
    lineItems: order.lineItems.map((li) => ({
      description: li.description,
      costCodeId: li.costCodeId,
      quantity: li.quantity,
      unit: li.unit,
      unitPriceCents: li.unitPriceCents,
      lineTotalCents: li.quantity * li.unitPriceCents,
    })),
    totalCents: order.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPriceCents, 0),
  };

  const { data, error } = await supabase.rpc("issue_document", {
    p_document_type: "purchase_order",
    p_source_id: materialOrderId,
    p_document_number: documentNumber ?? order.orderNumber ?? materialOrderId.slice(0, 8),
    p_canonical_data: canonicalData,
  });
  if (error) return { error: error.message };
  return { issuedDocumentId: data as string };
}

/** Validates the package is actually awarded BEFORE calling
 *  issue_document() — issuing a subcontract for a bid that was never
 *  awarded is a service-layer validation error, not merely a disabled
 *  UI button (the button being disabled doesn't stop a direct call). */
export async function issueSubcontract(supabase: SupabaseClient, bidPackageId: string, documentNumber?: string) {
  const detail = await getBidPackageDetail(supabase, bidPackageId);
  if (!detail) return { error: "Bid package not found." };
  const awarded = detail.submissions.find((s) => s.status === "awarded");
  if (!awarded) return { error: "This bid package has no awarded submission yet." };

  const canonicalData = {
    bidPackageId: detail.id,
    title: detail.title,
    scopeDescription: detail.scopeDescription,
    costCodeId: detail.costCodeId,
    awardedVendorName: awarded.vendorName,
    amountCents: awarded.amountCents,
  };

  const { data, error } = await supabase.rpc("issue_document", {
    p_document_type: "subcontract",
    p_source_id: bidPackageId,
    p_document_number: documentNumber ?? `SUB-${bidPackageId.slice(0, 8)}`,
    p_canonical_data: canonicalData,
  });
  if (error) return { error: error.message };
  return { issuedDocumentId: data as string };
}
```

- [ ] **Step 5: Write thin Server Actions in `apps/web/app/admin/procurement/actions.ts`**

```typescript
"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  createMaterialOrder as createMaterialOrderService,
  addMaterialOrderLineItem as addMaterialOrderLineItemService,
  commitMaterialOrder as commitMaterialOrderService,
  recordReceivedQuantity as recordReceivedQuantityService,
} from "../../../../../packages/02-app-shell/src/services/procurementService";
import { issuePurchaseOrder as issuePurchaseOrderService } from "../../../../../packages/02-app-shell/src/services/documentIssuanceService";

export async function createMaterialOrder(projectId: string, defaultCostCodeId?: string, vendorId?: string, orderNumber?: string, notes?: string) {
  const supabase = await createServerSupabaseClient();
  return createMaterialOrderService(supabase, projectId, defaultCostCodeId, vendorId, orderNumber, notes);
}

export async function addMaterialOrderLineItem(materialOrderId: string, projectId: string, costCodeId: string, description: string, quantity: number, unit: string | undefined, unitPriceCents: number) {
  const supabase = await createServerSupabaseClient();
  return addMaterialOrderLineItemService(supabase, materialOrderId, projectId, costCodeId, description, quantity, unit, unitPriceCents);
}

export async function commitMaterialOrder(materialOrderId: string) {
  const supabase = await createServerSupabaseClient();
  return commitMaterialOrderService(supabase, materialOrderId);
}

export async function recordReceivedQuantity(lineItemId: string, receivedQuantity: number, markBackordered?: boolean) {
  const supabase = await createServerSupabaseClient();
  return recordReceivedQuantityService(supabase, lineItemId, receivedQuantity, markBackordered);
}

export async function issuePurchaseOrder(materialOrderId: string, documentNumber?: string) {
  const supabase = await createServerSupabaseClient();
  return issuePurchaseOrderService(supabase, materialOrderId, documentNumber);
}
```

- [ ] **Step 6: Also add `issueSubcontract`'s Server Action to `apps/web/app/admin/bids/submissionActions.ts` (Task 5's file — it belongs with bid actions, not procurement)**

```typescript
// append to apps/web/app/admin/bids/submissionActions.ts
import { issueSubcontract as issueSubcontractService } from "../../../../../packages/02-app-shell/src/services/documentIssuanceService";

export async function issueSubcontract(bidPackageId: string, documentNumber?: string) {
  const supabase = await createServerSupabaseClient();
  return issueSubcontractService(supabase, bidPackageId, documentNumber);
}
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/02-app-shell/src/services/procurementService.ts packages/02-app-shell/src/services/documentIssuanceService.ts apps/web/app/admin/procurement/actions.ts apps/web/app/admin/bids/submissionActions.ts
git commit -m "feat(P5): line-level material order services + immutable document issuance"
```

---

### Task 9: `/admin/procurement` screen — functional specification

**Per explicit instruction, this task is a specification, not inlined component code** — same convention as Task 6. The implementer opens `BidPackageWorkspace.tsx` (Task 6, once built) as the closer sibling pattern within this same plan, since both are real-backend-only multi-entity workflows added in this package.

**Files:**
- Create: `apps/web/app/admin/procurement/page.tsx`
- Create: `packages/02-app-shell/src/components/MaterialOrderWorkspace.tsx`
- Modify: `apps/web/src/shell/AdminChrome.tsx` (add nav entry)

**Interfaces:**
- Consumes: `listMaterialOrders`, `getMaterialOrderDetail` (Task 8, read); `createMaterialOrder`, `addMaterialOrderLineItem`, `commitMaterialOrder`, `recordReceivedQuantity`, `issuePurchaseOrder` (Task 8, Server Actions); `repo.getCostCodes` (existing, for the per-line cost-code selector — every line item's dropdown, not just an order-level one, per Decision 2); `listVendors` (Task 6, reused here for the order's vendor picker).

**Authorization:** identical to Task 6 — `requireRole(["admin", "staff"])` at the page level, RLS as the real gate underneath, staff/admin only, no client or vendor variant.

**Navigation:**
- URL: `/admin/procurement`.
- Add `{ key: "procurement", label: "Procurement" }` to `AdminChrome`'s nav, after `commitments`.

**Data flow:**
1. `page.tsx`: `requireRole` → resolve first project → `listMaterialOrders(supabase, projectId)` + `repo.getCostCodes(projectId)` + `listVendors(supabase, orgId)` in parallel → props into `MaterialOrderWorkspace`.
2. `MaterialOrderWorkspace` holds `selectedOrderId` in `useState`; selecting an order fetches `getMaterialOrderDetail` (a new thin read-only Server Action added in this task, `apps/web/app/admin/procurement/actions.ts`, alongside the write ones already added in Task 8).
3. The line-item entry form's cost-code `<select>` **defaults to** the order's `defaultCostCodeId` (Task 8's `MaterialOrderRow.defaultCostCodeId`) when present, but remains a fully independent, always-changeable control per line — this is the concrete UI expression of Decision 2's "optional order-level default, required line-level authority": the default only sets the *initial* value of a new row's selector, never disables it, and once a line item is added its cost code is exactly what was selected at that moment (not silently re-derived from the order default later).
4. Every mutating action follows the identical `startTransition` → inline-error-on-`{error}` → re-fetch-detail pattern specified in Task 6.

**Loading/error/empty states:**
- **Page-level empty:** identical "No projects yet" message, same component/copy as Task 6.
- **List-level empty:** "No material orders yet. Create one to get started."
- **Detail-level loading:** inline "Loading…" while `getMaterialOrderDetail` is in flight, via `useTransition`'s `pending` flag.
- **Detail-level empty (no line items yet):** "No line items yet — add at least one before committing." shown in place of an empty table; the "Commit Order" control is not merely disabled but absent entirely until at least one line item exists (matching the DB's own zero-line-item rejection in `commit_material_order()` — the UI should never let staff attempt an action the database has already told us will always fail).
- **Per-line-item cost-code selector, empty state:** if a project somehow has zero cost codes seeded (shouldn't happen post-P2.1, but the UI must not silently break) — the selector shows a disabled placeholder ("No cost codes available for this project") rather than an empty, seemingly-functional dropdown.
- **Mutation errors:** inline next to the triggering control, same convention as Task 6 — in particular, a rejected `addMaterialOrderLineItem` call (e.g., missing cost code) must surface the DB/service error text directly under that specific line-item row's form, not as a page-level banner.
- **Commit confirmation:** committing is irreversible-in-effect (creates real `committed_costs` rows and freezes every line item per Decision 10) — same inline "Are you sure?" confirmation pattern as Task 6's Award button, not a native `confirm()`.
- **Post-commit line item editing attempt:** if the UI is ever reached in a state where a committed order's line item edit form is still visible (a bug elsewhere), the Server Action's resulting DB error (from the freeze trigger) must render as a clear inline message, not a raw Postgres error string — the service layer's `{ error: error.message }` passthrough is acceptable here specifically because the trigger's own `raise exception` message (Decision 10) was deliberately written to be a clear, user-legible sentence, not internal jargon; no additional translation layer is required, but this must be verified by an actual attempted post-commit edit during manual testing (Step 5 below), not assumed.

**Mutations:**
| Action | Trigger | Visible effect on success |
|---|---|---|
| `createMaterialOrder` | "Create Order" form (project, optional default cost code, optional vendor, optional order number) | New order appears in the list, auto-selected, status `draft` |
| `addMaterialOrderLineItem` | "Add Line Item" form submit, per order | New row in the line-item table, with its own cost code shown |
| `commitMaterialOrder` | "Commit Order" button, behind confirmation, only visible with ≥1 line item and status `draft` | Order status → `ordered`; one or more new rows appear on `/admin/commitments`, grouped (Task 7); line-item edit forms disappear/lock, replaced by the receiving controls below |
| `recordReceivedQuantity` | "Record Received" inline control per line item, only visible once status is `ordered`/`partially_received` | That line's received quantity/backorder flag updates; order status recomputes to `partially_received` or `received` per the existing logic |
| `issuePurchaseOrder` | "Issue PO" button, visible once committed | Opens/links the PO PDF (Task 10) at its new version; re-issuing after any change shows "Version 2 issued" same as Task 6's subcontract flow |

**Regression tests:**
- `AdminChrome`'s prior nav entries (including Task 6's `bids` and Task 7's `commitments`) still render correctly after this task's addition.
- `/admin/commitments`'s grouping display (Task 7) correctly reflects orders committed through this screen — an explicit end-to-end check, not just unit-level: commit a two-cost-code order here, then confirm `/admin/commitments` groups it, closing the loop between Tasks 7 and 9.
- `npm run build`'s route count increases by exactly this task's new routes.

- [ ] **Step 1: Implement `packages/02-app-shell/src/components/MaterialOrderWorkspace.tsx`** per the Data flow / states / Mutations tables above.

- [ ] **Step 2: Implement `apps/web/app/admin/procurement/page.tsx`** per the Data flow section, same "first project, no demo fallback" shape as `/admin/bids`.

- [ ] **Step 3: Add the `getMaterialOrderDetail` read-only Server Action to `apps/web/app/admin/procurement/actions.ts`.**

- [ ] **Step 4: Add `"procurement"` nav entry to `AdminChrome.tsx`.**

- [ ] **Step 5: Start the dev server and manually walk every state, including the cross-task regression check**

Run: `npm run dev`. Walk: empty list → create order with a default cost code → add two line items, one keeping the default, one explicitly overridden to the second cost code → confirm the empty-state messaging disappears appropriately at each step → commit (confirm the confirmation step appears) → confirm `/admin/commitments` shows the grouped result (Task 7 regression check) → record a partial receive on one line, mark it backordered → confirm order status becomes `partially_received` → issue a PO → confirm the PDF opens → attempt (deliberately, e.g. via direct Server Action call in a scratch script or browser devtools) a post-commit line-item edit and confirm the DB's freeze-trigger message renders legibly, not as a raw error dump.

- [ ] **Step 6: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/admin/procurement packages/02-app-shell/src/components/MaterialOrderWorkspace.tsx apps/web/src/shell/AdminChrome.tsx
git commit -m "feat(P5): /admin/procurement screen with line-level cost-code allocation"
```

---

### Task 10: PO/subcontract PDF Route Handlers — versioned snapshot rendering, Node runtime, authorization/failure testing

**Substantially revised from Revision 1:** renders from an `issued_documents` snapshot once one exists (falling back to a live "DRAFT" preview before anything is issued); explicit `runtime = "nodejs"`; exact-pinned dependency; explicit authorization and rendering-failure handling and tests.

**Files:**
- Modify: `apps/web/package.json` (or wherever `csv-parse` was added for P4 — confirm via `git log -p` on the P4 commit before running the install)
- Create: `packages/02-app-shell/src/pdf/MaterialOrderPdf.tsx`
- Create: `packages/02-app-shell/src/pdf/SubcontractPdf.tsx`
- Create: `apps/web/app/api/procurement/material-orders/[id]/pdf/route.ts`
- Create: `apps/web/app/api/bids/[bidPackageId]/subcontract-pdf/route.ts`
- Create: `apps/web/test/pdf_routes_integration.ts` (new — the authorization/rendering-failure tests this task requires)

**Interfaces:**
- Consumes: `getMaterialOrderDetail` (Task 8), `getBidPackageDetail` (Task 4), `getLatestIssuedDocument`/`getIssuedDocumentVersion` (Task 8's `documentIssuanceService.ts`).

- [ ] **Step 1: Install and exact-pin the dependency**

Run: `npm install @react-pdf/renderer` from whichever workspace `csv-parse` was added to for P4 (confirm the exact workspace via `git log -p` on the P4 commit that added `csv-parse`, rather than guessing). After install, **edit the resulting `package.json` entry to strip the caret** npm adds by default (e.g. `"^3.4.4"` → `"3.4.4"`, using whatever version actually resolved) — this repo's own `csv-parse` precedent uses a caret range, but Decision 9 explicitly requires an exact pin here because Decision 4's reproducibility guarantee depends on the renderer never silently changing between two issuances of the same document. Record the exact resolved version in the commit message for this step.

Confirm compatibility before proceeding: this repo runs Next.js `14.2.35` / React `18.3.1` (`apps/web/package.json`) — `@react-pdf/renderer` 3.x targets React 16.8+/18, so no conflict. No other Route Handler in this repo sets `runtime = "edge"` (confirmed by checking `apps/web/app/api/imports/parse/route.ts`, P4's own Route Handler), so Node has been the implicit default all along — Step 4/5 below make it explicit rather than continuing to rely on that being unchanged in the future.

- [ ] **Step 2: Write `packages/02-app-shell/src/pdf/MaterialOrderPdf.tsx`**

```tsx
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatCents } from "../../../01-financial-engine/src/money";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  title: { fontSize: 16, marginBottom: 12 },
  draftWatermark: { position: "absolute", top: 24, right: 32, fontSize: 10, color: "#b91c1c" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ccc", paddingVertical: 4 },
  cell: { flex: 1 },
});

interface LineItemInput {
  description: string;
  costCodeId?: string;
  quantity: number;
  unit?: string | null;
  unitPriceCents: number;
  lineTotalCents?: number;
}

/** Renders from either a frozen issued_documents.canonical_data snapshot
 *  OR live current data (isDraft=true) — the same shape covers both, so
 *  there is exactly one template to keep visually consistent, not two
 *  that could drift apart. */
export function MaterialOrderPdf({
  documentNumber,
  vendorName,
  lineItems,
  totalCents,
  isDraft,
}: {
  documentNumber: string;
  vendorName: string;
  lineItems: LineItemInput[];
  totalCents: number;
  isDraft: boolean;
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {isDraft && <Text style={styles.draftWatermark}>DRAFT — NOT ISSUED</Text>}
        <Text style={styles.title}>Purchase Order {documentNumber}</Text>
        <Text>Vendor: {vendorName}</Text>
        <View style={styles.row}>
          <Text style={styles.cell}>Description</Text>
          <Text style={styles.cell}>Cost Code</Text>
          <Text style={styles.cell}>Qty</Text>
          <Text style={styles.cell}>Unit Price</Text>
          <Text style={styles.cell}>Total</Text>
        </View>
        {lineItems.map((li, i) => (
          <View style={styles.row} key={i}>
            <Text style={styles.cell}>{li.description}</Text>
            <Text style={styles.cell}>{li.costCodeId ?? "—"}</Text>
            <Text style={styles.cell}>{li.quantity} {li.unit ?? ""}</Text>
            <Text style={styles.cell}>{formatCents(li.unitPriceCents)}</Text>
            <Text style={styles.cell}>{formatCents(li.lineTotalCents ?? li.quantity * li.unitPriceCents)}</Text>
          </View>
        ))}
        <Text style={{ marginTop: 12 }}>Total: {formatCents(totalCents)}</Text>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: Write `packages/02-app-shell/src/pdf/SubcontractPdf.tsx`**

```tsx
import React from "react";
import { Document, Page, Text, StyleSheet } from "@react-pdf/renderer";
import { formatCents } from "../../../01-financial-engine/src/money";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  title: { fontSize: 16, marginBottom: 12 },
  draftWatermark: { position: "absolute", top: 24, right: 32, fontSize: 10, color: "#b91c1c" },
});

export function SubcontractPdf({
  documentNumber,
  title,
  scopeDescription,
  awardedVendorName,
  amountCents,
  isDraft,
}: {
  documentNumber: string;
  title: string;
  scopeDescription: string | null;
  awardedVendorName: string;
  amountCents: number;
  isDraft: boolean;
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {isDraft && <Text style={styles.draftWatermark}>DRAFT — NOT ISSUED</Text>}
        <Text style={styles.title}>Subcontract Agreement {documentNumber} — {title}</Text>
        <Text>Awarded to: {awardedVendorName}</Text>
        <Text>Contract amount: {formatCents(amountCents)}</Text>
        <Text style={{ marginTop: 12 }}>Scope: {scopeDescription ?? "See attached scope of work."}</Text>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 4: Write `apps/web/app/api/procurement/material-orders/[id]/pdf/route.ts` — Node runtime, snapshot-or-draft rendering, explicit auth/failure handling**

```typescript
export const runtime = "nodejs"; // @react-pdf/renderer requires Node APIs — never Edge (Decision 9)

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireRole, AuthorizationError } from "../../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../../src/server/supabase/serverClient";
import { getMaterialOrderDetail } from "../../../../../../../../packages/02-app-shell/src/services/procurementService";
import { getLatestIssuedDocument, getIssuedDocumentVersion } from "../../../../../../../../packages/02-app-shell/src/services/documentIssuanceService";
import { MaterialOrderPdf } from "../../../../../../../../packages/02-app-shell/src/pdf/MaterialOrderPdf";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole(["admin", "staff"]);
  } catch (err) {
    // AuthorizationError has no Route Handler error boundary to land in
    // gracefully (unlike a Server Component) — must be caught and
    // converted explicitly, or every wrong-role request gets a raw 500.
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err; // unauthenticated: requireAuthenticatedUser's redirect("/login") propagates
  }

  const supabase = await createServerSupabaseClient();
  const requestedVersion = req.nextUrl.searchParams.get("version");

  let documentNumber: string;
  let vendorName: string;
  let lineItems: { description: string; costCodeId: string; quantity: number; unit: string | null; unitPriceCents: number; lineTotalCents: number }[];
  let totalCents: number;
  let isDraft: boolean;

  if (requestedVersion) {
    const snapshot = await getIssuedDocumentVersion(supabase, "purchase_order", params.id, Number(requestedVersion));
    if (!snapshot) return NextResponse.json({ error: "Purchase order version not found" }, { status: 404 });
    const data = snapshot.canonicalData as any;
    documentNumber = snapshot.documentNumber;
    vendorName = data.vendorName;
    lineItems = data.lineItems;
    totalCents = data.totalCents;
    isDraft = false;
  } else {
    const latestIssued = await getLatestIssuedDocument(supabase, "purchase_order", params.id);
    if (latestIssued) {
      const data = latestIssued.canonicalData as any;
      documentNumber = latestIssued.documentNumber;
      vendorName = data.vendorName;
      lineItems = data.lineItems;
      totalCents = data.totalCents;
      isDraft = false;
    } else {
      const detail = await getMaterialOrderDetail(supabase, params.id);
      if (!detail) return NextResponse.json({ error: "Material order not found" }, { status: 404 });
      const { data: vendorRow } = detail.vendorId ? await supabase.from("vendors").select("name").eq("id", detail.vendorId).maybeSingle() : { data: null };
      documentNumber = detail.orderNumber ?? detail.id.slice(0, 8);
      vendorName = vendorRow?.name ?? "Unknown vendor";
      lineItems = detail.lineItems.map((li) => ({ description: li.description, costCodeId: li.costCodeId, quantity: li.quantity, unit: li.unit, unitPriceCents: li.unitPriceCents, lineTotalCents: li.quantity * li.unitPriceCents }));
      totalCents = lineItems.reduce((sum, li) => sum + li.lineTotalCents, 0);
      isDraft = true;
    }
  }

  try {
    const buffer = await renderToBuffer(
      React.createElement(MaterialOrderPdf, { documentNumber, vendorName, lineItems, totalCents, isDraft })
    );
    return new NextResponse(buffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="po-${documentNumber}.pdf"` } });
  } catch {
    // Never leak a stack trace or renderer internals in the response body.
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Write `apps/web/app/api/bids/[bidPackageId]/subcontract-pdf/route.ts`, same structure**

```typescript
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireRole, AuthorizationError } from "../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { getBidPackageDetail } from "../../../../../../../packages/02-app-shell/src/services/bidService";
import { getLatestIssuedDocument, getIssuedDocumentVersion } from "../../../../../../../packages/02-app-shell/src/services/documentIssuanceService";
import { SubcontractPdf } from "../../../../../../../packages/02-app-shell/src/pdf/SubcontractPdf";

export async function GET(req: NextRequest, { params }: { params: { bidPackageId: string } }) {
  try {
    await requireRole(["admin", "staff"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const supabase = await createServerSupabaseClient();
  const requestedVersion = req.nextUrl.searchParams.get("version");

  let documentNumber: string;
  let title: string;
  let scopeDescription: string | null;
  let awardedVendorName: string;
  let amountCents: number;
  let isDraft: boolean;

  if (requestedVersion) {
    const snapshot = await getIssuedDocumentVersion(supabase, "subcontract", params.bidPackageId, Number(requestedVersion));
    if (!snapshot) return NextResponse.json({ error: "Subcontract version not found" }, { status: 404 });
    const data = snapshot.canonicalData as any;
    documentNumber = snapshot.documentNumber; title = data.title; scopeDescription = data.scopeDescription;
    awardedVendorName = data.awardedVendorName; amountCents = data.amountCents; isDraft = false;
  } else {
    const latestIssued = await getLatestIssuedDocument(supabase, "subcontract", params.bidPackageId);
    if (latestIssued) {
      const data = latestIssued.canonicalData as any;
      documentNumber = latestIssued.documentNumber; title = data.title; scopeDescription = data.scopeDescription;
      awardedVendorName = data.awardedVendorName; amountCents = data.amountCents; isDraft = false;
    } else {
      const detail = await getBidPackageDetail(supabase, params.bidPackageId);
      if (!detail) return NextResponse.json({ error: "Bid package not found" }, { status: 404 });
      const awarded = detail.submissions.find((s) => s.status === "awarded");
      if (!awarded) return NextResponse.json({ error: "No awarded submission for this bid package yet" }, { status: 409 });
      documentNumber = `SUB-${detail.id.slice(0, 8)}`; title = detail.title; scopeDescription = detail.scopeDescription;
      awardedVendorName = awarded.vendorName; amountCents = awarded.amountCents ?? 0; isDraft = true;
    }
  }

  try {
    const buffer = await renderToBuffer(
      React.createElement(SubcontractPdf, { documentNumber, title, scopeDescription, awardedVendorName, amountCents, isDraft })
    );
    return new NextResponse(buffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="subcontract-${documentNumber}.pdf"` } });
  } catch {
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Write `apps/web/test/pdf_routes_integration.ts` — the authorization/rendering-failure tests Decision 9 requires**

Check this repo's existing convention for testing a Route Handler in isolation (grep for any existing test that imports a `route.ts`'s `GET` export directly and calls it with a mocked `NextRequest`/mocked `requireRole`/mocked Supabase client — if no such precedent exists anywhere in the repo, this is the first one, and should follow `import_parse_unit.ts`'s "fast, no server" philosophy: import the route module directly, monkey-patch/mock `requireRole` and `createServerSupabaseClient` at the module level, call `GET()` directly, assert on the returned `Response`). At minimum, cover:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
// Mock requireRole to throw AuthorizationError, call the route's GET,
// assert response.status === 403 and the body does NOT contain a stack
// trace or the word "Error:" verbatim (proving it's the clean JSON
// shape, not a leaked exception).

test("material order PDF route returns 403, not 500, for a wrong-role authenticated session", async () => {
  // ... mock requireRole to throw AuthorizationError, import route.ts's GET after mocking, invoke, assert status 403
});

test("material order PDF route returns 404 for a nonexistent material order id", async () => {
  // ... mock requireRole to succeed, mock getMaterialOrderDetail/getLatestIssuedDocument to return null, assert status 404
});

test("material order PDF route returns a safe 500 when renderToBuffer throws", async () => {
  // ... mock renderToBuffer to reject, assert status 500 and the response body is the generic { error: "Failed to render PDF" } shape, not the underlying exception's message
});

test("material order PDF route renders a DRAFT watermark when no issued_documents row exists, and omits it when one does", async () => {
  // ... mock getLatestIssuedDocument to return null in one case and a row in another, assert the isDraft flag passed into MaterialOrderPdf differs accordingly (test at the prop-construction level, not by parsing rendered PDF bytes)
});
```

Write the real mocking/assertion bodies once the exact `requireRole`/`createServerSupabaseClient` module shape is confirmed (Step 6 begins with that confirmation, per the instruction above — this is not a placeholder to leave unresolved, it is the first concrete action of this step).

- [ ] **Step 7: Manually verify both routes against real data**

Run: `npm run dev`. Hit both routes as: (a) a valid admin/staff session with no `issued_documents` row yet → confirm the DRAFT watermark renders; (b) call `issuePurchaseOrder`/`issueSubcontract` (Task 8), then hit the route again → confirm the watermark is gone and the numbers match what was issued, not any data changed afterward; (c) as an unauthenticated request (no session) → confirm a redirect; (d) as an authenticated client/vendor-role session → confirm 403 JSON, not a framework 500 page.

- [ ] **Step 8: Run typecheck, test, and build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json package-lock.json packages/02-app-shell/src/pdf apps/web/app/api/procurement apps/web/app/api/bids apps/web/test/pdf_routes_integration.ts
git commit -m "feat(P5): versioned PO/subcontract PDF issuance — Node runtime, exact-pinned renderer, tested auth/failure paths"
```

---

### Task 11: Action Center condition functions (registration only, no live screen wiring)

**Minor revision from Revision 1:** `getBackorderedMaterialLineItems` now also returns each line's `costCodeId`, since Decision 2 made that the authoritative allocation.

**Files:**
- Create: `packages/02-app-shell/src/services/actionCenterQueries.ts`
- Create: `packages/02-app-shell/test/action_center_queries_unit.ts`

- [ ] **Step 1: Write `packages/02-app-shell/src/services/actionCenterQueries.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OverdueBidPackage {
  id: string;
  title: string;
  dueAt: string;
}

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
  costCodeId: string;
  description: string;
}

export async function getBackorderedMaterialLineItems(supabase: SupabaseClient, projectId: string): Promise<BackorderedLineItem[]> {
  const { data, error } = await supabase
    .from("material_order_line_items")
    .select("id, material_order_id, cost_code_id, description, material_orders!inner(project_id, status)")
    .eq("backordered", true)
    .eq("material_orders.project_id", projectId)
    .neq("material_orders.status", "received");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, materialOrderId: row.material_order_id, costCodeId: row.cost_code_id, description: row.description }));
}
```

- [ ] **Step 2: Write `packages/02-app-shell/test/action_center_queries_unit.ts`**

Same mock-Supabase-client shape as Revision 1 specified — check for an existing mock-client convention elsewhere in the repo before writing a new one; if none exists, this file establishes it.

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

test("getBackorderedMaterialLineItems filters to backordered=true, excludes received orders, and returns cost_code_id", async () => {
  const calls: any[] = [];
  const mockClient: any = {
    from(table: string) {
      calls.push({ table });
      const builder: any = {
        select: (cols: string) => { calls.push({ select: cols }); return builder; },
        eq: (col: string, val: unknown) => { calls.push({ eq: [col, val] }); return builder; },
        neq: (col: string, val: unknown) => { calls.push({ neq: [col, val] }); return Promise.resolve({ data: [{ id: "li-1", material_order_id: "mo-1", cost_code_id: "cc-1", description: "Lumber" }], error: null }); },
      };
      return builder;
    },
  };
  const result = await getBackorderedMaterialLineItems(mockClient, "project-1");
  assert.ok(calls.some((c) => c.eq?.[0] === "backordered" && c.eq?.[1] === true));
  assert.ok(calls.some((c) => c.neq?.[0] === "material_orders.status" && c.neq?.[1] === "received"));
  assert.equal(result[0].costCodeId, "cc-1");
});
```

- [ ] **Step 3: Register the new test file and run it**

Add to whichever `npm run test` step already runs `import_parse_unit.ts`. Run: `npm run test`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/02-app-shell/src/services/actionCenterQueries.ts packages/02-app-shell/test/action_center_queries_unit.ts package.json
git commit -m "feat(P5): Action Center condition queries, now cost-code-aware for backorders"
```

---

### Task 12: Full verification, live checkpoint extension, milestone closeout, handoff

**Files:**
- Create: `docs/milestones/P5-complete.md`
- Modify: `docs/production-build/PRODUCTION-ROADMAP.md`

- [ ] **Step 1: Run the full verification suite from a clean install**

Run: `npm ci && npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 2: Apply migration 015 to the real hosted dev Supabase project and re-run the live checkpoint script**

Extend the existing live-checkpoint procedure to 015. Confirm the checkpoint script's assertion count increases to reflect the new tables/RPCs, including `vendor_members`, `issued_documents`, and the two-cost-code `commit_material_order()` path.

- [ ] **Step 3: Manually re-walk the full golden path end-to-end against the real hosted dev project**

Bid package → invite two vendors → record two submissions → award one → confirm exactly one `committed_costs` row and the sibling `declined`. Material order with line items across **two different cost codes** → commit → confirm **two** `committed_costs` rows, correctly summed and grouped on `/admin/commitments` → attempt a post-commit line-item edit and confirm it's rejected → record a partial receive, mark backordered → confirm `getBackorderedMaterialLineItems` returns it with the correct `costCodeId`. Issue a PO, then issue it again after some change → confirm two `issued_documents` versions exist and `?version=1` still renders the original numbers. Confirm a second real login (second `vendor_members` row on the same `vendors.id`) reads identically to the first, and that a client/vendor-role session hitting either PDF route gets 403, not a 500 page.

- [ ] **Step 4: Write `docs/milestones/P5-complete.md`**

Follow `docs/milestones/P4-complete.md`'s exact structure. Known limitations section must carry forward, explicitly, at minimum: no vendor-facing UI exercise of the new RLS until P11; no persisted PDF *bytes*, only canonical-data snapshots, with the template-stability caveat from Decision 4; single-cost-code-per-bid-package limitation (Decision 1, unchanged); single-award-per-package limitation (Decision 6, unchanged); no mechanism to end a `vendor_members` link yet. Final "Starter prompt for a fresh Claude Code session" section for P6, matching P4-complete.md's own precedent.

- [ ] **Step 5: Update `docs/production-build/PRODUCTION-ROADMAP.md`'s status line**

Same pattern as every prior package's closeout entry; update "The next package is P5" to "The next package is P6."

- [ ] **Step 6: Tag the milestone**

```bash
git add docs/milestones/P5-complete.md docs/production-build/PRODUCTION-ROADMAP.md
git commit -m "docs: P5 milestone complete — commitments, bids, procurement"
git tag p5-complete
```

- [ ] **Step 7: Report closeout summary**

Report final acceptance-criteria status (all ten from `P5-DESIGN.md` Revision 2), verified command output, the live-checkpoint result, and every "Known limitation" from Step 4 restated explicitly.
