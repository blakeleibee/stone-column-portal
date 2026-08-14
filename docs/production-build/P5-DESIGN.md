# P5 — Commitments, Bids (PM-side), Procurement & Material Orders — Design Record

**Status:** Design only. Not yet implemented. Awaiting review/approval
before `docs/superpowers/plans/2026-08-14-p5-commitments-bids-procurement.md`
is executed. **Revision 2** (this version) responds to explicit owner
review of Revision 1: material orders now allocate cost at the line
level, vendor identity is a real many-to-many membership rather than a
single column, PO/subcontract issuance now produces an immutable
versioned snapshot, and staff-recorded bid Q&A carries explicit
author/source provenance. Revision 1's text is not preserved inline —
see git history on this file for the prior version if needed. Full
scope reference: `docs/production-build/PRODUCTION-ROADMAP.md`
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
actually consume this helper**, alongside a new, narrower
`is_vendor_member()` helper this revision adds (Decision 3) for
"which specific vendor business does this authenticated user
represent."

## Scope

Real `committed_costs` UI (list, create, supersede — wired to the
existing RPC through a real screen for the first time); PM-facing bid
package create/publish/receive/compare/award; PO/subcontract issuance
with an immutable versioned document record; procurement/material
orders with line-level cost-code allocation, per-line receiving, and
backorder tracking. Per `PRODUCTION-ROADMAP.md`: **no vendor-facing UI
in this package** (P11) — vendor identity/RLS is extended here so P11
doesn't have to touch a security boundary under time pressure, but no
vendor ever logs into anything P5 ships.

## Decisions made in this design (flagged explicitly, per project convention)

1. **A `bid_package` is scoped to exactly one `(cost_code_id,
   project_id)`.** Unchanged from Revision 1, confirmed on review. A
   per-trade bid package (framing, electrical, drywall) mapping to one
   cost code matches how Stone Column actually bids subcontractor
   work. **Trade-off, stated plainly:** a bid whose real-world scope
   genuinely spans two cost codes must be split into two bid packages.
   This does *not* apply to material orders — see Decision 2, which
   revises Revision 1's identical treatment of `material_orders` after
   owner review.

2. **`material_orders` carries an *optional* `cost_code_id` as a
   convenience default; every `material_order_line_items` row carries
   its own *required* `cost_code_id`, and that line-level value is
   what `commit_material_order()`, receiving, and backorder
   reconciliation all actually use.** Revision 1 treated material
   orders the same as bid packages (one cost code per order) and an
   owner review correctly rejected that: a single material delivery
   routinely covers several trades in one shipment (e.g., one lumber
   order covering both framing and exterior-trim cost codes), and
   forcing staff to split every such order into N separate orders just
   to satisfy the schema would be real friction for no schema benefit
   — unlike a bid package, a material order was never conceptually
   single-trade. Concretely:
   - `material_orders.cost_code_id` is now nullable. The UI uses it
     only to pre-fill new line items' cost code field; nothing in the
     database or the commit/reconciliation path reads it as
     authoritative.
   - `material_order_line_items` gains `project_id` (denormalized,
     required) and `cost_code_id` (required), with the same composite
     `foreign key (cost_code_id, project_id) references
     cost_codes(id, project_id)` the rest of the backbone uses, plus a
     new trigger, `enforce_line_item_project_matches_order()`,
     rejecting a line item whose `project_id` doesn't match its parent
     order's — this is DB-enforced, not merely trusted from the
     service layer that inserts it, matching this project's general
     posture of not relying on application code alone for an
     invariant the database can guarantee directly.
   - `commit_material_order()` now **groups line items by
     `cost_code_id` and inserts one `committed_costs` row per distinct
     cost code**, all sharing `source_id = material_orders.id` — the
     exact same "one event, several backbone rows, shared `source_id`"
     shape `FINANCIAL-ARCHITECTURE.md` already documents for change
     orders touching multiple cost codes (§"How money flows," step 6).
     The RPC's return type changes from `returns uuid` to `returns
     setof uuid` accordingly.
   - Receiving/backorder tracking was already per-line-item in
     Revision 1 and needed no change here — it was already the
     correct granularity; only the cost-code allocation was wrong.

3. **Vendor identity is a real many-to-many membership junction,
   `vendor_members`, not a single `vendors.profile_id` column** —
   replacing Revision 1's Decision 2 entirely, per explicit owner
   correction. A `vendors` row is a *business* (Acme Framing); more
   than one authenticated person can legitimately represent that
   business (the owner, an estimator, a foreman who logs in from the
   truck) — a single nullable FK column could only ever link one.
   ```sql
   create table vendor_members (
     id          uuid primary key default uuid_generate_v4(),
     vendor_id   uuid not null references vendors(id) on delete cascade,
     profile_id  uuid not null references profiles(id) on delete cascade,
     is_primary  boolean not null default false,
     created_at  timestamptz not null default now(),
     constraint vendor_members_unique_pair unique (vendor_id, profile_id)
   );
   ```
   **Isolation is enforced at four distinct layers, each independently
   testable, per the explicit requirement that this be database-
   enforced, not just RLS-shaped:**
   - **Org isolation** — a new `before insert or update` trigger,
     `enforce_vendor_member_org_match()`, rejects linking a profile to
     a vendor when `profiles.org_id <> vendors.org_id`. This is a hard
     constraint, not an RLS filter — even a bug in a future policy
     could never let a cross-org link exist as a row in the first
     place.
   - **Project isolation** — unchanged mechanism from Revision 1: the
     existing `is_project_vendor(project_id)` (schema/007,
     `project_members`-backed) still gates whether a user is a vendor
     *on a given project at all*; `vendor_members` only answers "which
     `vendors.id` do they represent," a orthogonal question.
   - **Vendor isolation (cross-vendor)** — a new helper,
     `is_vendor_member(p_vendor_id uuid)` (`security definer`, same
     shape as `is_project_client`/`is_project_vendor`), replaces every
     place Revision 1 inlined `vendors.profile_id = auth.uid()`. Two
     people both linked to the *same* `vendors.id` correctly see the
     same data (the actual "multiple people, one business"
     requirement); a person linked to a *different* vendor sees
     nothing, exactly as before.
   - **No delete, ever** — `vendor_members_no_delete` (same
     `reject_delete()` trigger every other permanent-record table in
     this schema uses), so a later audit-log row referencing a
     membership can never point at a vanished row. A membership that
     needs to end is out of P5's scope (no UI exists to end one yet);
     when P11 needs that, it adds an `is_active` flag or equivalent,
     not a hard delete.
   RLS: `vendor_members_staff_full_access` (org-staff of the vendor's
   own org); `vendor_members_self_read` (a member reads their own
   membership rows — harmless, and lets a future vendor session know
   which business(es) they represent). Audit via
   `log_audit_no_project()` (org-scoped, no `project_id`, same as
   `vendors` itself) plus the matching `audit_log` SELECT policy
   `audit_log_vendor_members_staff_select`, following the exact
   precedent `vendors` itself set in schema/012 for tables without a
   `project_id` column.
   **Forward-compatibility for P11:** when a real vendor invitation
   flow ships, it inserts a `vendor_members` row (never repurposes an
   existing one) — the schema already supports one business having any
   number of logins from day one, so P11 adds a UI, not a migration.

4. **Issuing a PO or subcontract creates an immutable, versioned
   snapshot row — `issued_documents` — even though the rendered PDF
   bytes themselves are still never stored.** Revision 1's "no
   persistence at all" (its old Decision 3) is corrected per explicit
   owner instruction: *generating* a PDF (a preview, before anything
   is finalized) stays ephemeral exactly as before, but *issuing* one
   — the act of actually sending a PO or subcontract to a vendor — is
   a real business event that must be reproducible later byte-for-byte,
   not just "whatever the database happens to say today."
   ```sql
   create type issued_document_type as enum ('purchase_order', 'subcontract');

   create table issued_documents (
     id               uuid primary key default uuid_generate_v4(),
     document_type    issued_document_type not null,
     source_id        uuid not null, -- material_orders.id or bid_packages.id
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
   ```
   `canonical_data` is a JSON snapshot of every field the PDF template
   needs (project/vendor identity, line items with their cost codes,
   totals, terms) — metadata only, the same "never a blob" philosophy
   `documents` (schema/010) already established, just structured JSON
   instead of a `storage_key` pointer, since there is no binary to
   point at. A new RPC, `issue_document()`, models the exact
   claim-old/insert-new/link pattern `supersede_committed_cost()`
   already established: it looks up the current non-superseded version
   for that `(document_type, source_id)`, inserts a new row at
   `version + 1` (or `1` if none exists), and marks the prior row
   superseded — **"later changes create revisions"** in schema terms.
   `issued_by` is set to `auth.uid()` *inside* the RPC, never accepted
   as a caller-supplied parameter — the same anti-impersonation
   reasoning as Decision 8 below, applied here so an issuance record
   can never be forged to claim a different issuer.
   A new trigger, `enforce_issued_document_immutability()`, rejects any
   `update` that changes `canonical_data`/`document_number`/`version`/
   `document_type`/`source_id`/`issued_at`/`issued_by` — the only
   fields ever allowed to change post-insert are
   `superseded_at`/`superseded_by_id`, set exactly once by
   `issue_document()`'s own next call. No delete, ever, same reasoning
   as `vendor_members`.
   **The PDF route's behavior changes accordingly** (see "Server-side
   operations" below): once an `issued_documents` row exists, the PDF
   route renders from its frozen `canonical_data`, not live database
   state — this is what makes "reproduce the exact issued document"
   true. Before anything is issued, the route still renders a live
   preview, watermarked "DRAFT — NOT ISSUED," so staff can review
   before committing to an official issuance.
   **One honest caveat, not glossed over** (matching
   `FINANCIAL-ARCHITECTURE.md`'s own convention for stating these
   plainly): byte-for-byte reproducibility from a snapshot assumes the
   PDF *template* code itself doesn't change in a way that alters
   layout for old data. `canonical_data` freezes the *inputs*; it does
   not freeze the *renderer*. If `MaterialOrderPdf.tsx`/
   `SubcontractPdf.tsx` are ever restyled, a re-render of an old
   snapshot will reflect the new styling, not the original document's
   appearance. This is judged acceptable for P5 (the actual dollar
   amounts and terms in `canonical_data` are what must never drift,
   and they don't) but is flagged here explicitly rather than silently
   assumed — a future package that needs true pixel-identical
   archival reproduction would need to store the rendered bytes too,
   which this design deliberately still does not do.

5. **A new `committed_costs.source_type` value, `material_order`,
   remains registered** in `FINANCIAL-ARCHITECTURE.md`'s registry
   table, updated in this revision to note explicitly: **one
   `material_orders` row may now produce *multiple*
   `committed_costs` rows** (one per distinct cost code among its line
   items, per Decision 2), all sharing the same `source_id`. This is
   the same multi-row-per-event shape the registry already documents
   for `change_order` (P7) — noted here so P7 doesn't have to
   rediscover that `source_id` was never a promise of "exactly one
   row."

6. **A bid package supports exactly one award.** Unchanged from
   Revision 1, confirmed on review. Awarding a `bid_submissions` row
   sets that row's status to `awarded`, the parent `bid_packages` row
   to `awarded`, and every sibling `bid_submissions` row on the same
   package to `declined`, automatically, in the same RPC.

7. **`material_order_line_items` carries its own `received_quantity`
   and `backordered` flag, not just an order-level status.** Unchanged
   from Revision 1, confirmed on review — still correct at the line
   level even though cost-code allocation (Decision 2) also moved to
   the line level; these are two independent reasons to track state
   per line, not per order.

8. **Staff-recorded bid Q&A carries explicit, structurally-enforced
   provenance so a staff-entered record can never be mistaken for a
   vendor's own words.** Per explicit owner instruction, `bid_questions`
   gains two fields Revision 1 didn't have:
   ```sql
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
   ```
   `source` is a closed enum, not free text — every row is
   structurally either `'staff_recorded'` (P5's only path: `recorded_by`
   is mandatory, and the RLS insert policy for this path is staff-only)
   or `'vendor_submitted'` (unused until P11, when a vendor's own RLS
   insert policy sets it and leaves `recorded_by` null — a vendor's own
   `auth.uid()` is implicit in that row via the *same* `is_vendor_member()`
   check already governing read access, not a separate impersonation
   surface). `recorded_by default auth.uid()` means the service layer
   never has to (and cannot be trusted to) pass "who is recording
   this" as a parameter — it is always the actual authenticated
   session's own id, evaluated server-side at insert time, the same
   anti-spoofing reasoning `issue_document()` uses for `issued_by`
   (Decision 4), just expressed as a column default here since this is
   a plain insert rather than an RPC. `asked_at` records when the vendor reportedly asked (per
   staff, possibly by phone yesterday); the row's own `created_at`
   (implicit, not separately named) records when it was actually
   entered — keeping "what the vendor said" and "when this became a
   system record" honestly distinct rather than conflated into one
   timestamp. `bid_addenda` needed no equivalent change — an addendum
   is inherently staff-issued by design (a vendor never issues one),
   so it already carried `issued_by` with no impersonation risk to
   begin with.

9. **New dependency: `@react-pdf/renderer`, used only inside a
   server-side Node.js Route Handler, pinned to an exact version (no
   caret range) rather than following `csv-parse`'s `^7.0.2` precedent.**
   Confirmed compatible: this repo runs Next.js `14.2.35` /
   React `18.3.1` (`apps/web/package.json`), and `@react-pdf/renderer`
   3.x targets React 16.8+/18 — no version conflict. **Runtime is
   Node.js, explicitly, not the default left implicit:** both new
   Route Handlers set `export const runtime = "nodejs";` at the module
   level — App Router route segment config — rather than relying on
   "Node is the default today," since `@react-pdf/renderer` uses
   Node-only APIs and would fail outright under the Edge runtime; an
   explicit declaration survives a future Next.js default change that
   an implicit assumption would not. Chosen over `puppeteer` (spins a
   full headless Chrome — incompatible with this constraint and a poor
   fit for Vercel's serverless function limits per
   `TARGET-ARCHITECTURE.md`'s deployment target) and over `pdf-lib`
   (lower-level manual coordinate-based layout for the same result).
   **Exact-pin rationale, distinct from `csv-parse`'s looser range:**
   Decision 4's reproducibility guarantee depends on the renderer
   producing the same output from the same `canonical_data` — a caret
   range could silently pull in a minor/patch release that changes
   layout between two issuances of the same document type, undermining
   the very guarantee Decision 4 exists to provide. `csv-parse` has no
   such reproducibility requirement riding on it, so its looser pin is
   unaffected and not being revisited here.
   **Authorization and rendering-failure paths are explicitly tested**
   (not just the happy path, per instruction) — both routes: (a) an
   unauthenticated request triggers `requireAuthenticatedUser`'s
   existing `redirect("/login")` (Route Handlers support this,
   verified against Next.js 14's documented behavior — `redirect()`
   throws a framework-recognized signal that produces a real HTTP
   redirect from a Route Handler, not just a Server Component); (b) an
   authenticated request with the wrong role must **not** leak a raw
   500 — `requireRole`'s `AuthorizationError` is caught explicitly
   inside the route and converted to a `403` JSON response, since an
   uncaught throw in a Route Handler (unlike a Server Component) has
   no framework error boundary to land in gracefully; (c) a request
   for a non-existent `id` returns `404`; (d) a `renderToBuffer` call
   that throws (malformed/unexpected `canonical_data` shape) is caught
   and converted to a safe, generic `500` — no stack trace or internal
   detail in the response body.

10. **`material_order_line_items` becomes structurally frozen once its
    parent order leaves `draft`, except for `received_quantity`/
    `backordered`.** This closes a real gap in Revision 1: that
    version's acceptance criteria *claimed* "a committed order's line
    items become as frozen as a posted expense's fields," but no
    trigger actually enforced it — an oversight caught while revising
    the design for Decision 2, not something the owner asked for
    directly, but necessary once material orders can produce multiple
    `committed_costs` rows (an unenforced post-commit edit would now
    silently desynchronize potentially several backbone rows at once,
    not just one). A new trigger,
    `enforce_material_order_line_item_frozen_after_commit()`, covers
    all three operations: blocks `insert` of a new line item once the
    parent order's `status <> 'draft'`; blocks `update` of
    `description`/`quantity`/`unit`/`unit_price_cents`/`cost_code_id`/
    `project_id`/`material_order_id` once `status <> 'draft'` (
    `received_quantity`/`backordered` remain freely updatable — that's
    the entire point of receiving, which only happens *after* an order
    is placed); blocks `delete` once `status <> 'draft'`. Style matches
    `enforce_expense_state_transition`'s precedent exactly: a specific,
    row-identifying exception message naming what changed and why it's
    rejected.

## Schema/migration changes

One new migration, `schema/015_commitments_bids_procurement.sql` (+
down), following P2.1/P4's precedent of bundling one package's full
schema surface into a single file. Mirrored in `supabase/migrations/`
per existing practice (both directories updated in the same commit).
Full SQL for every table/trigger/RPC above lives in the implementation
plan (Task 1) rather than duplicated here — this section is the
narrative map of what the migration contains, not a second copy of it:

- `vendor_members` (Decision 3) + `enforce_vendor_member_org_match()`
  + `is_vendor_member()` + `vendor_members_no_delete` + RLS + audit.
- `bid_packages` (Decision 1) + RLS (staff full access;
  `bid_packages_vendor_read` now via `is_vendor_member()`, not
  `vendors.profile_id`) + audit.
- `bid_submissions` (unchanged shape from Revision 1) + RLS (vendor
  read/update now via `is_vendor_member()`) + audit via
  `log_audit_via_bid_package()`.
- `bid_questions` (Decision 8: `source`, `recorded_by` added) + RLS
  (vendor read/insert via `is_vendor_member()`) + audit.
- `bid_addenda` (unchanged shape) + RLS (vendor read via
  `is_vendor_member()`) + audit.
- `material_orders` (Decision 2: `cost_code_id` now nullable) + RLS
  (staff-only, no vendor policy, unchanged) + audit.
- `material_order_line_items` (Decision 2: `project_id`/`cost_code_id`
  added, composite FK, `enforce_line_item_project_matches_order()`;
  Decision 10: `enforce_material_order_line_item_frozen_after_commit()`)
  + RLS (staff-only) + audit via `log_audit_via_material_order()`.
- `issued_documents` (Decision 4) + `enforce_issued_document_immutability()`
  + `issued_documents_no_delete` + RLS (staff-only, resolved through
  `material_orders`/`bid_packages` depending on `document_type`) +
  audit via `log_audit_via_issued_document()`.
- RPCs: `award_bid()` (unchanged from Revision 1), `commit_material_order()`
  (Decision 2: now `returns setof uuid`, groups by cost code),
  `issue_document()` (Decision 4).

## RLS policies

Staff: full access on every new table, `is_org_staff(project_id)`
(resolved directly for `bid_packages`/`material_orders`, through the
parent for the child tables, and through a `document_type`-conditional
lookup for `issued_documents`), matching every existing project-scoped
financial table.

Vendor (first real consumer of `is_project_vendor()` *and* the new
`is_vendor_member()`):
- `bid_packages_vendor_read`: a vendor may `select` a bid package only
  if a `bid_submissions` row exists linking a vendor they're a member
  of (`is_vendor_member(bs.vendor_id)`) to that package — **not**
  blanket `is_project_vendor(project_id)` access, since not every
  vendor on a project is invited to every bid package.
- `bid_submissions_vendor_read`/`_vendor_update`: `is_vendor_member(vendor_id)`.
- `bid_questions_vendor_read`/`_vendor_insert`: read where
  `visible_to_all_vendors` or `vendor_id` is a vendor they're a member
  of; insert only with `source='vendor_submitted'` (P11, dormant in
  P5) and their own `vendor_id`, on a package they're invited to.
- `bid_addenda_vendor_read`: read addenda for a package they're
  invited to.
- **No vendor policy on `material_orders`/`material_order_line_items`/
  `issued_documents`** — procurement and issuance are purely internal.

Every vendor policy gets the roadmap's mandated pair of tests, now
explicitly including the "two members, one vendor" case: "Vendor A on
Project 1 sees nothing on Project 2," "Vendor A sees nothing belonging
to Vendor B on the same project," and (new, per Decision 3) "a second
authenticated person linked to the *same* `vendors.id` as Vendor A
sees exactly what Vendor A sees."

## Server-side operations

Per `TARGET-ARCHITECTURE.md` §5.1/§5.2 and the P4-established
service/Server-Action split: `packages/02-app-shell/src/services/bidService.ts`,
`procurementService.ts`, and a new `documentIssuanceService.ts`
(Decision 4), each function taking the caller's own `SupabaseClient`
first, called by a thin Server Action under `apps/web/app/admin/...`.

- Bid package/submission/question/addendum functions: unchanged from
  Revision 1 (`createBidPackage`, `publishBidPackage`, `inviteVendor`,
  `recordBidSubmission`, `awardBid`, `askBidQuestion` — inserts with
  `source='staff_recorded'` explicitly; `recorded_by` is left unset in
  the insert payload and populated by the column's own
  `default auth.uid()` per Decision 8, never passed as a parameter —
  `answerBidQuestion`, `issueBidAddendum`).
- `createMaterialOrder(supabase, projectId, defaultCostCodeId?, vendorId?, orderNumber?, notes?)`
  — `defaultCostCodeId` is optional and only pre-fills the UI's
  line-item form (Decision 2); it is never read by `commitMaterialOrder`.
- `addMaterialOrderLineItem(supabase, orderId, costCodeId, description, quantity, unit, unitPriceCents)`
  — `costCodeId` is now a required parameter, not inherited implicitly.
- `commitMaterialOrder(supabase, orderId)` — thin wrapper over
  `commit_material_order()`; now returns `{ committedCostIds: string[] }`
  (plural), reflecting the RPC's `setof uuid` return.
- `recordReceivedQuantity(supabase, lineItemId, receivedQuantity, markBackordered?)`
  — unchanged from Revision 1.
- **`documentIssuanceService.ts`** (new, Decision 4):
  `issuePurchaseOrder(supabase, materialOrderId, documentNumber?)` —
  builds `canonical_data` from `getMaterialOrderDetail` (project meta,
  vendor name, every line item with its own cost code/quantity/price),
  defaults `documentNumber` to the order's `order_number` if the
  caller doesn't supply one, calls `issue_document('purchase_order', ...)`.
  `issueSubcontract(supabase, bidPackageId, documentNumber?)` —
  validates the package's status is `awarded` first (returns `{error}`
  otherwise — issuing a subcontract for a bid that was never awarded
  is a service-layer validation, not just a UI affordance), builds
  `canonical_data` from `getBidPackageDetail` plus the awarded
  submission, calls `issue_document('subcontract', ...)`.
  `getLatestIssuedDocument(supabase, documentType, sourceId)` /
  `getIssuedDocumentVersion(supabase, documentType, sourceId, version)`
  — read functions the PDF routes call to render a frozen snapshot
  instead of live data once one exists.
- **PO/subcontract PDF Route Handlers** (`GET
  /api/procurement/material-orders/[id]/pdf` and `GET
  /api/bids/[bidPackageId]/subcontract-pdf`; both `export const runtime
  = "nodejs"`, Decision 9): if an `issued_documents` row exists for
  this source (optionally a specific `?version=`), renders
  `@react-pdf/renderer` output from its frozen `canonical_data`;
  otherwise renders a live preview from current data, watermarked
  "DRAFT — NOT ISSUED." Explicit `AuthorizationError`→403 handling and
  `renderToBuffer`-failure→500 handling per Decision 9's test
  requirements — no case is left to fall through to a framework
  default. Never persists the rendered bytes (Decision 4's own
  "PDF bytes are still never stored" clause).
- **`issuePurchaseOrder`/`issueSubcontract` Server Actions** (new,
  thin wrappers) — the explicit staff action that actually calls
  `issue_document()`, distinct from merely viewing a preview.

## UI screens

Following P4's convention exactly: new **flat** admin routes (not
wired into `ProjectWorkspace`'s client-facing preview tabs, which
belong to the prototype reference, not this real-data package),
operating on "the first project" per the existing limitation P4 also
inherited and did not fix.

- **`/admin/commitments`**: unchanged in shape from Revision 1 — list
  of `committed_costs`, "Supersede" action wired to the existing
  `supersede_committed_cost()` RPC. Now may show several rows sharing
  the same `source_id` for one material order (Decision 2) — the
  screen groups by `source_id` when `source_type='material_order'` so
  staff can see "these N rows are one order" rather than N
  unrelated-looking entries.
- **`/admin/bids`**: unchanged core shape from Revision 1
  (create/publish/invite/compare/award), plus an "Issue Subcontract"
  action once a submission is `awarded`, and Q&A entries now display
  their `source`/`recorded_by` explicitly (Decision 8) so staff always
  see "recorded by [staff name], per a phone call," never text that
  could be mistaken for the vendor's own submission.
- **`/admin/procurement`**: line-item entry now includes a required
  per-line cost-code selector (pre-filled from the order's optional
  default, per Decision 2), an "Issue PO" action once committed, and
  the detail view shows a per-cost-code subtotal breakdown alongside
  the order total, since a single order may now span several cost
  codes. Full wiring/state/test specification for this screen and
  `/admin/bids` is in the implementation plan's Tasks 6 and 9
  (expanded to explicit-spec form per instruction, not inlined here).
- **Fixture behavior:** unaffected — all three are new routes with no
  fixture equivalent to retire, matching P4's own note about
  `/admin/estimate`/`/admin/import`.

## Audit events

Every insert/update on all seven new tables (`vendor_members` added in
this revision) — this closes the same kind of gap P4 closed for
`import_batches`/`import_rows`, applied here from day one instead of
retrofitted. `issued_documents` additionally: every issuance and every
revision is independently audit-visible (an `issue_document()` call
produces both an `insert` audit row for the new version and an
`update` audit row for the prior version's `superseded_at` — both are
real, distinct, staff-readable events, not collapsed into one).

## Action Center events

Per `PRODUCTION-ROADMAP.md`'s P5 line item (unchanged from Revision 1):
- **Unapproved changes past expected timeframe**: a `bid_packages` row
  in `published` status past its `due_at` with no `awarded` submission,
  or a `material_orders` row in `draft` past some staff-configured
  staleness window.
- **Backordered material**: any `material_order_line_items` row with
  `backordered = true` and the parent order not yet `received`. Now
  also carries that line's `cost_code_id` in the query result (Decision
  2), so a future real Action Center screen can group backorders by
  trade, not just by order.

## Tests

`tests/sql/package_p5_commitments_bids_procurement_tests.sql`, same
structural precedent as Revision 1, expanded for this revision's
changes:

1. `bid_packages`/`material_orders` composite-FK + staff RLS +
   cross-org isolation.
2. **Vendor RLS, all three required cases**: cross-project, cross-vendor,
   and (new) "two members of the same vendor see the same data" —
   using `vendor_members` + `is_vendor_member()` instead of Revision
   1's `vendors.profile_id`.
3. `enforce_vendor_member_org_match()` rejects linking a profile from
   org B to a vendor owned by org A.
4. `bid_submissions_one_per_vendor_per_package` /
   `bid_submissions_amount_set_when_submitted` — unchanged from
   Revision 1.
5. `award_bid()` happy path + reject-non-submitted — unchanged.
6. **`commit_material_order()` with line items spanning two different
   cost codes** — happy path now asserts *two* `committed_costs` rows
   are created, correctly summed per cost code, both sharing
   `source_id`; rejects zero line items; rejects a non-`draft` order.
7. `enforce_line_item_project_matches_order()` rejects a line item
   whose `project_id` doesn't match its order's.
8. `enforce_material_order_line_item_frozen_after_commit()`: rejects
   inserting/updating/deleting a committed-fields change on a line
   item once the order isn't `draft`; confirms `received_quantity`/
   `backordered` updates are still accepted post-commit.
9. `material_order_line_items_received_not_over` — unchanged.
10. `bid_questions_staff_recorded_requires_recorder` rejects a
    `source='staff_recorded'` row with `recorded_by is null`.
11. `issue_document()`: first issuance creates version 1; a second
    call for the same source creates version 2 and marks version 1
    superseded (`superseded_by_id` pointing at the new row);
    `enforce_issued_document_immutability()` rejects a direct `update`
    to `canonical_data` on an existing row.
12. `issued_documents` staff-only RLS + cross-org isolation, for both
    `document_type` values (proves the conditional
    `material_orders`-vs-`bid_packages` lookup resolves correctly for
    each).
13. Audit visibility across all seven new tables (same bar P4 set).
14. Real Postgres re-run of `committed_forecast_hardening_tests.sql`
    "in context" — unchanged from Revision 1.

New files added to `scripts/db/run-sql-tests.mjs`'s `FILES` array as
before. `apps/web` test additions: `procurement_totals_unit.ts`
(unchanged scope) plus PDF-route authorization/failure-path tests
(Decision 9) under whichever existing Route Handler test convention
this repo uses (check for precedent before inventing a new one — see
implementation plan Task 10).

## CI requirements

Unchanged from Revision 1: extends the existing `test:db` job, no new
CI job needed.

## Deployment requirements

Unchanged from Revision 1: same Vercel/Supabase projects, migration
015 applied and end-to-end-tested against the real hosted dev project
before completion.

## Acceptance criteria

1. A commitment can be created (via `award_bid()` or
   `commit_material_order()`), superseded, and its lineage remains
   correct and queryable through the UI.
2. A bid package with two vendor submissions, awarding one, leaves the
   other `declined` and produces exactly one `committed_costs` row.
3. **A material order with line items across two cost codes, once
   committed, produces exactly two `committed_costs` rows — one per
   cost code, correctly summed, sharing `source_id` — proven through
   the UI, not just direct SQL.**
4. **A material order line item's cost code, quantity, description,
   and unit price can never be edited or deleted once its parent
   order leaves `draft` — proven by an actual attempted edit through
   the service layer being rejected by the database, not merely
   absent from the UI — while `received_quantity`/`backordered`
   remain editable at any post-commit status.**
5. **Two different authenticated test sessions, both linked via
   `vendor_members` to the same `vendors.id`, can each read that
   vendor's own invited bid packages/submissions; a third session
   linked to a different vendor reads none of it — proven by all three
   required isolation axes, not just the original two.**
6. **Issuing a PO twice for the same material order (once, then again
   after a change) produces two `issued_documents` rows, version 1
   marked superseded by version 2, and the PDF route serving version 1
   explicitly (`?version=1`) still renders the original numbers even
   after the order's live data has changed.**
7. A material order with one backordered line item surfaces as a
   distinct Action Center event, separate from the order's own overall
   status.
8. Every new table's writes produce a real, staff-readable `audit_log`
   row.
9. **The PO/subcontract PDF routes return 403 (not 500) for an
   authenticated non-staff session, 404 for a nonexistent id, and a
   safe generic 500 (no internal detail) for a forced rendering
   failure — proven by actual requests, not code review.**
10. `npm ci`/`typecheck`/`test`/`build` all pass from a clean install,
    migration 015 applies cleanly to the real hosted dev project
    alongside 001–014.

## Dependencies

P3 (vendor RLS foundation, via P1's consolidation), P4 (budget to
commit against).

## Explicit exclusions

No vendor-facing UI (P11) — every vendor policy added here is correct
and tested but has no real session to exercise it with until P11
actually links `vendor_members` rows through a real invitation flow.
No draws/invoices/payments (P6/P6b). No change orders (P7) — a
commitment amount change after award goes through
`supersede_committed_cost()`. No persisted PDF *bytes* for generated
POs or vendor-submitted bid files (Decision 4's own explicit "the
rendered bytes are still never stored" clause) — only the canonical
data snapshot is persisted, deliberately, not the rendered document
itself; re-rendering depends on template stability (Decision 4's
caveat). No mechanism to end a `vendor_members` link (no delete, no
deactivation flag) — out of scope until P11 has a reason to need one.
No change to `AdminFinancialsScreen`'s existing rollup.
