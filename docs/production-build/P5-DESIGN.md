# P5 — Commitments, Bids (PM-side), Procurement & Material Orders — Design Record

**Status:** Design only. Not yet implemented. Awaiting review/approval
before `docs/superpowers/plans/2026-08-14-p5-commitments-bids-procurement.md`
is executed. Full scope reference: `docs/production-build/PRODUCTION-ROADMAP.md`
§"Package P5"; governing cross-package constraint:
`docs/production-build/FINANCIAL-ARCHITECTURE.md` (the permanent-backbone
rule this design follows, and the money-flow diagram/`source_type`
registry this design extends); AI-readiness constraint:
`docs/production-build/AI-ASSISTANT-ARCHITECTURE.md` /
`TARGET-ARCHITECTURE.md` §14 (repository/service-layer discipline, same
as P4).

## The core architectural fact this design rests on

**`committed_costs` already exists, fully schema-hardened across five
migrations (001–005), and has never been exercised by any UI.** It
already carries the composite `(cost_code_id, project_id)` FK into the
backbone, a real status state machine
(`enforce_committed_cost_status_transition`, schema/003), and a
supersede-not-edit RPC (`supersede_committed_cost`, schema/003) that
inserts a new row and links the old one to it rather than mutating
history. **P5's job is to activate this existing spine for real writes
for the first time and to add the vendor-quote/procurement mechanism
that feeds it — not to design a new financial table.** This mirrors
P4's own framing of itself relative to `budget_ledger`.

`is_project_vendor(project_id)` also already exists (schema/007) but is
currently called by **zero** RLS policies anywhere in the schema — its
own migration header says explicitly that future packages (named as
P5) call it in their own new policies. **P5 is the first package to
actually consume this helper.**

## Scope

Real `committed_costs` UI (list, create, supersede — wired to the
existing RPC through a real screen for the first time); PM-facing bid
package create/publish/receive/compare/award; PO/subcontract PDF
generation; procurement/material orders with per-line receiving and
backorder tracking. Per `PRODUCTION-ROADMAP.md`: **no vendor-facing UI
in this package** (P11) — vendor identity/RLS is extended here so P11
doesn't have to touch a security boundary under time pressure, but no
vendor ever logs into anything P5 ships.

## Decisions made in this design (flagged explicitly, per project convention)

1. **A `bid_package` and a `material_order` are each scoped to exactly
   one `(cost_code_id, project_id)`, not a multi-cost-code line-item
   spread.** `FINANCIAL-ARCHITECTURE.md`'s own table list for P5 names
   exactly six tables — `bid_packages`, `bid_submissions`,
   `bid_questions`, `bid_addenda`, `material_orders`,
   `material_order_line_items` — with no `bid_package_line_items` or
   equivalent. A per-trade bid package (framing, electrical, drywall)
   mapping to one cost code matches how Stone Column actually bids
   subcontractor work and lets every new table use the exact same
   composite-FK pattern as the rest of the backbone with zero new
   shape. **Trade-off, stated plainly:** a bid or material order whose
   real-world scope genuinely spans two cost codes (e.g., a sitework
   package covering both grading and utilities) must be split into two
   bid packages/orders, one per code. This is the same trade-off
   `change_orders` (P7) resolves the opposite way (one change order,
   multiple `budget_ledger` rows) — flagged here because P5 deliberately
   does not follow that shape, and an owner who wants multi-code bid
   packages should say so now, before the schema ships, not after.

2. **`vendors` gets one new nullable column, `profile_id uuid
   references profiles(id)`.** This is a real, load-bearing gap I
   found during research, not a stylistic choice: `vendors` (schema/012,
   org-scoped business-contact records — name, email, phone) has **no
   column linking it to `profiles`/`project_members`** (the actual
   login/session identity `is_project_vendor()` checks). Without this
   link, "a vendor can read their own bid_submissions" cannot be
   expressed as an RLS policy at all — there is no way to go from
   `auth.uid()` to "which `vendors.id` is this." Nullable because P5
   ships no vendor invitation flow (that's P11) — every `vendors` row
   stays `profile_id = null` in practice until P11 actually invites a
   vendor to log in, but the column and the policies that use it are
   correct and tested now, so P11 only has to populate the column, not
   design new RLS. This is additive-only (schema/012 is not edited in
   place) and does not redefine vendor identity — it only makes the
   identity P3/P7 already established addressable from the `vendors`
   table for the first time.

3. **No file storage/PDF persistence in P5 — PO/subcontract PDFs are
   generated on demand and downloaded, not saved as a `documents`
   row.** The roadmap's "PDF generation for PO/subcontract documents"
   scope line doesn't require persistence, and `documents` (schema/010)
   has no generic `source_type`/`source_id` linkage columns today —
   adding them would mean altering a table P5 doesn't otherwise own,
   for a need P5 can satisfy without it. Likewise, a vendor's submitted
   bid (received by phone/email, since there's no vendor portal yet) is
   recorded as text/amount on `bid_submissions`, not an uploaded file.
   **Alternative considered:** add nullable `source_type text`/
   `source_id uuid` to `documents` now, so generated POs and received
   bid files have somewhere to live from day one. Deferred, not
   rejected — flagged here so P9 (real Documents UI) or P11 (vendor
   uploads) can pick it up deliberately instead of two packages each
   inventing their own attachment mechanism independently.

4. **A new `committed_costs.source_type` value, `material_order`, is
   registered** in `FINANCIAL-ARCHITECTURE.md`'s registry table in the
   same commit as this design. The document's own money-flow diagram
   lists `material_orders` as one of the three P5 mechanisms feeding
   `committed_costs` (alongside `bid_packages`/`bid_submissions`), but
   its `source_type` registry table only pre-reserved `bid_award` for
   P5 — this is a real gap between the diagram and the registry, not a
   deliberate omission, closed here per the registry's own stated rule
   ("any package introducing a new financial event type adds its row
   here in the same commit that introduces it").

5. **A bid package supports exactly one award.** Awarding a
   `bid_submissions` row sets that row's status to `awarded`, the
   parent `bid_packages` row to `awarded`, and every sibling
   `bid_submissions` row on the same package to `declined`,
   automatically, in the same RPC. **Alternative considered:** splitting
   one package's scope across multiple vendors (e.g., half the drywall
   to one sub, half to another). Rejected for P5 as unnecessary
   complexity for the common case (Decision 1 already means a
   multi-vendor scope would normally be two bid packages against two
   cost codes); an owner who actually splits awards within a single
   trade regularly should flag it now rather than after the schema is
   fixed.

6. **`material_order_line_items` carries its own `received_quantity`,
   not just an order-level status.** The roadmap explicitly calls for
   a "backordered material" Action Center event and audit signal, which
   requires knowing *which line* is short, not just that "the order" is
   incomplete — an order with 8 line items where 1 is on backorder is a
   materially different state than the whole order being delayed.
   Mirrors `expenses`' existing philosophy of tracking state at the
   most granular row that actually changes, not a coarser parent.

7. **`bid_questions` and `bid_addenda` are staff-authored records in
   P5, not an interactive vendor Q&A thread.** Per the roadmap's own
   exclusion ("vendor data is referenced... but never displayed to a
   vendor session in this package"), P5 has no vendor session to
   receive a question from directly — staff logs a question a vendor
   asked by phone/email and staff's own answer. The schema shape
   (`bid_package_id`, `vendor_id`, question/answer text, timestamps) is
   designed so P11 can later let a vendor insert their own
   `bid_questions` row directly, under the same RLS policy, with zero
   schema change — only a new UI.

8. **New dependency: `@react-pdf/renderer`** for PO/subcontract PDF
   generation. No PDF library is named anywhere in
   `TARGET-ARCHITECTURE.md` today — this is a genuine new-dependency
   choice, same category as P4's `csv-parse` decision. Chosen over
   `puppeteer` (spins a full headless Chrome — a poor fit for Vercel's
   serverless function limits, per `TARGET-ARCHITECTURE.md`'s
   deployment target) and over `pdf-lib` (lower-level manual
   coordinate-based layout, more code for the same result). Renders
   the PO/subcontract document as plain React components server-side
   inside the Route Handler, streamed back as `application/pdf` — no
   client-side rendering, matching §5.1's "genuine business logic runs
   server-side" rule already applied to P4's CSV parsing.

## Schema/migration changes

One new migration, `schema/015_commitments_bids_procurement.sql` (+
down), following P2.1/P4's precedent of bundling one package's full
schema surface into a single file. Mirrored in `supabase/migrations/`
per existing practice (both directories updated in the same commit).

**Vendor identity extension:**
```sql
alter table vendors
  add column profile_id uuid references profiles(id);
```
(No RLS change to `vendors` itself — `vendors_staff_only` already
covers this column; it's not a new access grant, matching P4's own
"a new constraint is not a new access grant" reasoning for
`budget_ledger`.)

**`bid_packages`:**
```sql
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
```

**`bid_submissions`** (also the invitee record — see Decision-adjacent
note below: a `'invited'` row is how a vendor is invited to a package,
before they've responded):
```sql
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
```
`unique (bid_package_id, vendor_id)` is what makes "invited, then later
updated to submitted" a real workflow rather than two disconnected
rows — the same vendor's row is updated in place from `invited` to
`submitted` (pre-response fields are not yet financial data, so this is
not a violation of the ledger's append-only philosophy; the append-only
rule binds `committed_costs`/`budget_ledger`, which this table feeds
*into* via `award_bid()`, not this staging table itself).

**`bid_questions`:**
```sql
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
```

**`bid_addenda`:**
```sql
create table bid_addenda (
  id             uuid primary key default uuid_generate_v4(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  title          text not null,
  body_text      text not null,
  revised_due_at timestamptz,
  issued_by      uuid references profiles(id),
  issued_at      timestamptz not null default now()
);
```

**`material_orders`:**
```sql
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
```

**`material_order_line_items`:**
```sql
create table material_order_line_items (
  id                  uuid primary key default uuid_generate_v4(),
  material_order_id   uuid not null references material_orders(id) on delete cascade,
  description         text not null,
  quantity             numeric not null,
  unit                text,
  unit_price_cents    bigint not null,
  received_quantity   numeric not null default 0,
  backordered         boolean not null default false,
  created_at          timestamptz not null default now(),

  constraint material_order_line_items_quantity_positive check (quantity > 0),
  constraint material_order_line_items_unit_price_nonnegative check (unit_price_cents >= 0),
  constraint material_order_line_items_received_nonnegative check (received_quantity >= 0),
  constraint material_order_line_items_received_not_over check (received_quantity <= quantity)
);
```
Line total (`quantity * unit_price_cents`) is computed in the service
layer/view, never stored — same "derive, don't duplicate" rule
`revisedEstimateCents` already follows in the financial engine.

**Award/commit RPCs** (both `security invoker`, same reasoning as
`supersede_committed_cost` — the caller already has direct RLS access
to every table touched; the RPC exists purely for transactional
atomicity across multiple statements):

```sql
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
```

```sql
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

  select coalesce(sum(quantity * unit_price_cents), 0) into v_total
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

Both RPCs deliberately never call `supersede_committed_cost()`
themselves — they create the *first* `committed_costs` row for a given
award/order. A later amount change (price increase after backorder,
renegotiated bid) goes through the existing `supersede_committed_cost()`
RPC exactly as any other commitment revision would, so P5 adds zero new
"how does a commitment change" concept.

**Audit triggers**, modeled on `log_audit_self_scoped`/
`log_audit_no_project` (schema/006) exactly as P4 modeled
`log_audit_via_batch()` on the same pair:
- `audit_bid_packages`, `audit_material_orders` — project-scoped
  tables, standard `log_audit()` (the existing generic trigger already
  used by `documents`/`committed_costs`, which resolves `project_id`
  directly since both tables carry it).
- `audit_bid_submissions`, `audit_bid_questions`, `audit_bid_addenda`,
  `audit_material_order_line_items` — no direct `project_id` column
  (only a parent-table FK) — new trigger function
  `log_audit_via_bid_package()` (resolves `project_id` through
  `bid_packages`) and `log_audit_via_material_order()` (resolves
  through `material_orders`), each modeled on P4's
  `log_audit_via_batch()` precedent.

## RLS policies

Staff: full access on every new table, `is_org_staff(project_id)`
(resolved directly for `bid_packages`/`material_orders`, through the
parent for the four child tables), matching every existing
project-scoped financial table.

Vendor (new — first real consumer of `is_project_vendor()`):
- `bid_packages_vendor_read`: a vendor may `select` a bid package only
  if a `bid_submissions` row exists linking their `vendors.id` (via
  `vendors.profile_id = auth.uid()`) to that package — **not** blanket
  `is_project_vendor(project_id)` access, since (per Decision 1's
  reasoning) not every vendor on a project is invited to every bid
  package.
- `bid_submissions_vendor_read`/`_vendor_update`: a vendor may
  `select`/`update` (submit an amount, never change `vendor_id` or
  `bid_package_id`) only their own row (`vendors.profile_id =
  auth.uid()`).
- `bid_questions_vendor_read`/`_vendor_insert`: read where
  `visible_to_all_vendors` or `vendor_id` is their own; insert only
  with their own `vendor_id`, on a package they're invited to.
- `bid_addenda_vendor_read`: read addenda for a package they're
  invited to.
- **No vendor policy on `material_orders`/`material_order_line_items`**
  — procurement is purely internal (staff ordering from a vendor as a
  supplier, not a vendor bidding), matching `vendors` itself having no
  vendor-session policy.

Every vendor policy gets the roadmap's mandated pair of tests: "Vendor
A on Project 1 sees nothing on Project 2" and "Vendor A sees nothing
belonging to Vendor B on the same project/package" — per
`PRODUCTION-ROADMAP.md`'s vendor-RLS-sequencing rule item 5.

## Server-side operations

Per `TARGET-ARCHITECTURE.md` §5.1/§5.2 and the P4-established
service/Server-Action split: new
`packages/02-app-shell/src/services/bidService.ts` and
`procurementService.ts`, each function taking the caller's own
`SupabaseClient` first, called by a thin Server Action under
`apps/web/app/admin/...`.

- `createBidPackage(supabase, projectId, costCodeId, title, scopeDescription?, dueAt?)`,
  `publishBidPackage(supabase, bidPackageId)` (draft → published),
  `inviteVendor(supabase, bidPackageId, vendorId)` (inserts the
  `'invited'` `bid_submissions` row) — `bidService.ts`.
- `recordBidSubmission(supabase, bidSubmissionId, amountCents, notes?)`
  (staff records what a vendor quoted by phone/email; sets
  `status='submitted'`, `submitted_at=now()`) — `bidService.ts`. Plain
  RLS-gated `.update()`.
- `awardBid(supabase, bidSubmissionId)` — thin wrapper calling the
  `award_bid()` RPC — `bidService.ts`.
- `askBidQuestion` / `answerBidQuestion` / `issueBidAddendum` —
  `bidService.ts`, plain RLS-gated inserts.
- `createMaterialOrder(supabase, projectId, costCodeId, vendorId?, orderNumber?, notes?)`,
  `addMaterialOrderLineItem(supabase, orderId, description, quantity, unit, unitPriceCents)`,
  `commitMaterialOrder(supabase, orderId)` (thin wrapper over
  `commit_material_order()`), `recordReceivedQuantity(supabase,
  lineItemId, receivedQuantity, markBackordered?)` (updates
  `received_quantity`/`backordered`, then recomputes and persists the
  parent order's `status` — `received` when every line's
  `received_quantity = quantity`, `partially_received` when some but
  not all lines are fully received, unchanged otherwise) —
  `procurementService.ts`.
- **PO/subcontract PDF Route Handler** (`GET
  /api/procurement/material-orders/[id]/pdf` and `GET
  /api/bids/[bidPackageId]/subcontract-pdf`, new): server-rendered PDF
  (reuses whatever PDF library `TARGET-ARCHITECTURE.md` already
  names for this purpose — if none is named yet, this is a genuine
  library choice the implementation plan flags as a new dependency,
  same as P4 flagged `csv-parse`), generated on request from live data,
  streamed back — not persisted (Decision 3).

## UI screens

Following P4's convention exactly: new **flat** admin routes (not
wired into `ProjectWorkspace`'s client-facing preview tabs, which
belong to the prototype reference, not this real-data package),
operating on "the first project" per the existing limitation P4 also
inherited and did not fix.

- **`/admin/commitments`** (new route): list of `committed_costs` for
  the project, grouped by cost code, each row showing status/vendor/
  amount/source, with a "Supersede" action (opens a small form: new
  amount + optional new vendor, calls the existing
  `supersede_committed_cost()` RPC through a new thin Server Action —
  this RPC has existed since schema/003 and is wired to real UI here
  for the first time, exactly as the roadmap's acceptance criteria
  requires).
- **`/admin/bids`** (new route): bid package list; create-package form;
  package detail view showing invited vendors/submissions
  side-by-side for comparison, question/answer log, addenda list, and
  an "Award" button per submission (only enabled when `status =
  'submitted'`).
- **`/admin/procurement`** (new route): material order list; create-
  order form with line-item entry; order detail view with per-line
  "Record Received" action and a backorder indicator; "Commit" button
  (only enabled in `draft` status, calls `commitMaterialOrder`).
- **Fixture behavior:** unaffected — all three are new routes with no
  fixture equivalent to retire, matching P4's own note about
  `/admin/estimate`/`/admin/import`.

## Audit events

Every insert/update on all six new tables (per the audit triggers
above — this closes the same kind of gap P4 closed for
`import_batches`/`import_rows`, applied here from day one instead of
retrofitted).

## Action Center events

Per `PRODUCTION-ROADMAP.md`'s P5 line item:
- **Unapproved changes past expected timeframe**: a `bid_packages` row
  in `published` status past its `due_at` with no `awarded` submission,
  or a `material_orders` row in `draft` past some staff-configured
  staleness window — surfaced the same way existing Action Center
  events are computed (read-only query, no new event-storage table;
  matches how other packages' Action Center items are described as
  computed-on-read in the roadmap).
- **Backordered material**: any `material_order_line_items` row with
  `backordered = true` and the parent order not yet `received`.

## Tests

`tests/sql/package_p5_commitments_bids_procurement_tests.sql` (new),
following `package_p4_estimating_qb_import_tests.sql`'s exact
structure and reusing its `set_test_user`/`assert_that`/
`assert_raises`/`test_fixture_ids`/`org_b_admin` fixtures, **plus** a
new vendor-session fixture (a `profiles` row with `role` allowing
`project_members.member_role = 'vendor'`, linked via the new
`vendors.profile_id` column) since this is the first test suite to
actually exercise `is_project_vendor()` through a real policy:

1. `bid_packages`/`material_orders` composite-FK + staff RLS +
   cross-org isolation (same shape as every prior package's section 1).
2. **Vendor RLS, both required axes** (roadmap rule item 5): "Vendor A
   on Project 1 sees nothing on Project 2" and "Vendor A sees nothing
   belonging to Vendor B on the same project" — run against
   `bid_packages`, `bid_submissions`, and `bid_questions`.
3. `bid_submissions_one_per_vendor_per_package` rejects a second invite
   of the same vendor to the same package; accepts the first.
4. `bid_submissions_amount_set_when_submitted` rejects setting
   `status='submitted'` with `amount_cents is null`; accepts a proper
   submission.
5. `award_bid()`: happy path (submitted → awarded, sibling submissions
   → declined, package → awarded, one `committed_costs` row created
   with `source_type='bid_award'`); rejects awarding a submission not
   in `'submitted'` status.
6. `commit_material_order()`: happy path (draft → ordered, one
   `committed_costs` row with `source_type='material_order'`, amount =
   sum of line items); rejects committing an order with zero line
   items; rejects committing a non-`draft` order.
7. `material_order_line_items_received_not_over` rejects
   `received_quantity > quantity`.
8. Audit visibility: an insert to each of the six new tables produces
   a real, staff-readable `audit_log` row (same bar P4 set).
9. Real Postgres re-run of `committed_forecast_hardening_tests.sql`
   "in context" (per the roadmap's own P5 test line) — confirms
   `supersede_committed_cost()` still behaves correctly once real
   `award_bid()`/`commit_material_order()` writes exist alongside it,
   not just in isolation.

New files added to `scripts/db/run-sql-tests.mjs`'s `FILES` array (the
migration and its test file), positioned after
`schema/014_import_amount_canonicalization_and_audit_attribution.sql`
and `tests/sql/package_p4_estimating_qb_import_tests.sql` respectively.

`apps/web` test: a new `apps/web/test/procurement_totals_unit.ts`
covering the line-item total/received-status derivation logic in
isolation (matches quantity, over-partial, exact-match-closes-order,
zero-line-items cases) — fast, no server, same style as
`import_parse_unit.ts`.

## CI requirements

Extends the existing `test:db` job with the new migration/test file —
no new CI job needed, same ephemeral-PGlite job P1 set up and P4
reused. `procurement_totals_unit.ts` added to whichever `npm run test`
step already runs `import_parse_unit.ts`.

## Deployment requirements

None new — same Vercel/Supabase projects as P1–P4. Migration 015 gets
applied to and end-to-end-tested against the real hosted dev Supabase
project, exactly as 001–014 were, before this package is considered
complete.

## Acceptance criteria

1. A commitment can be created (via `award_bid()` or
   `commit_material_order()`), superseded (via the existing
   `supersede_committed_cost()`, now wired to real UI), and its lineage
   remains correct and queryable — through the UI, not just direct SQL
   (roadmap's own stated acceptance bar).
2. A bid package with two vendor submissions, awarding one, leaves the
   other `declined` and produces exactly one `committed_costs` row —
   proven by an actual award through the UI.
3. A material order's committed amount equals the live sum of its line
   items at commit time, and later line-item price/quantity edits
   (there are none post-commit — Decision-consistent: a committed
   order's line items become as frozen as a posted expense's fields,
   enforced the same "raise a clear exception" way as
   `enforce_expense_state_transition`) never silently change the
   already-committed number.
4. A vendor test session (using the new `vendors.profile_id` link) can
   read only their own invited bid packages/submissions — proven by
   both required isolation-test axes, not just the single-axis version.
5. A material order with one backordered line item surfaces as a
   distinct Action Center event, separate from the order's own overall
   status.
6. Every new table's writes produce a real, staff-readable `audit_log`
   row — proven by an actual query, matching P4's own bar.
7. `npm ci`/`typecheck`/`test`/`build` all pass from a clean install,
   migration 015 applies cleanly to the real hosted dev project
   alongside 001–014.

## Dependencies

P3 (vendor RLS foundation, via P1's consolidation), P4 (budget to
commit against — `committed_costs` needs cost codes and a budget
context to be meaningful even though it doesn't FK to `budget_ledger`
directly).

## Explicit exclusions

No vendor-facing UI (P11) — every vendor policy added here is
correct and tested but has no real session to exercise it with until
P11 populates `vendors.profile_id` through an actual invitation flow.
No draws/invoices/payments (P6/P6b) — a committed cost is not billed
in this package. No change orders (P7) — a commitment amount change
after award goes through `supersede_committed_cost()`, the same path
any other commitment revision uses; a *scope* change significant
enough to need client approval is P7's concern, not P5's. No document/
file persistence for generated POs or vendor-submitted bid files
(Decision 3) — deferred to P9/P11 as a deliberate, flagged choice, not
a silent gap. No change to `AdminFinancialsScreen`'s existing rollup —
`committed_costs` already flows into it (P1); P5 only gives it real
rows to render for the first time.
