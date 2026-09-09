# P5 — Commitments, Bids (PM-side), Procurement & Material Orders — Design Record

**Status:** Design approved in direction; this revision is a targeted
hardening pass before implementation begins.
`docs/superpowers/plans/2026-08-14-p5-commitments-bids-procurement.md`
is executed immediately after this revision lands. **Revision 3** (this
version) closes five specific gaps identified in owner review of
Revision 2, triaged honestly below rather than treated as uniformly
"new work" — two were genuine, unenforced gaps; one was a real security
hole (a DB default is not a boundary); one was already fully enforced
and needed only explicit documentation, not a schema change; one
reframes an existing caveat rather than solving a problem P5 was never
going to solve:

1. **Genuinely new:** `vendor_members` had no way to revoke access
   without deleting history. Added `revoked_at`/`revoked_by` plus a
   trigger, and `is_vendor_member()` now filters on active status.
2. **Genuinely new:** `commit_material_order()` returned bare,
   unordered UUIDs — a caller had no reliable way to know which
   `committed_costs` row belonged to which cost code without a second
   query. Now returns `table(cost_code_id, committed_cost_id)` directly.
3. **Already fully enforced, not changed:** the post-commit freeze
   (Decision 10) already protected exactly the right fields and left
   exactly the right fields mutable. This revision only makes the
   field list explicit and states it as a table — see Decision 10.
4. **A real gap, now fixed:** `bid_questions.recorded_by default
   auth.uid()` is a *default*, not a *constraint* — nothing stopped an
   explicit insert payload from overriding it. Added a trigger that
   rejects any value other than the inserting session's own
   `auth.uid()`, and makes the field immutable after insert.
5. **Genuinely new, and a scope clarification:** `issued_documents`
   now records `template_version`; a small per-template renderer
   registry keyed by that version is the mechanism that keeps old
   snapshots renderable after a template changes. P5's reproduction
   guarantee is explicitly redefined as **content/layout-equivalent**,
   not byte-identical — true byte-identical archival would require
   persisting the rendered file itself, which remains out of scope
   until a package that actually needs it (the owner named P9) does
   that. Revision 2's "byte-for-byte" language is corrected throughout.

Revision 2's own text is not preserved inline — see git history on
this file for prior versions if needed. Full
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
     The RPC's return type changes from `returns uuid` to **`returns
     table(cost_code_id uuid, committed_cost_id uuid)`** — not the
     unordered `returns setof uuid` this design originally specified.
     A bare `setof uuid` would force every caller to run a second query
     just to learn which `committed_costs` row belongs to which cost
     code; returning the mapping directly makes that association a
     guaranteed part of the RPC's contract, not something the caller
     has to reconstruct and hope stays correctly ordered.
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
     revoked_at  timestamptz,
     revoked_by  uuid references profiles(id),
     created_at  timestamptz not null default now(),
     constraint vendor_members_unique_pair unique (vendor_id, profile_id)
   );
   ```
   **Revocation, added this revision — a real gap, not a stylistic
   choice:** Revision 2 shipped `vendor_members_no_delete` (correctly —
   membership history must never vanish) but had **no way to revoke
   access at all**, meaning a departed employee's login would remain a
   valid vendor session indefinitely. `revoked_at`/`revoked_by`
   (`null` = active, matching this schema's established idiom —
   `committed_costs.superseded_at`, `bid_questions.answered_at` — of a
   nullable timestamp meaning "hasn't happened yet," not a second,
   independently-driftable boolean) fix this without touching the
   "never delete" posture: a membership row's full lifecycle stays
   permanently queryable, it just carries a revoked state instead of
   ceasing to exist. Re-adding a previously-revoked person clears
   `revoked_at`/`revoked_by` on the *same* row (`vendor_members_unique_pair`
   would otherwise block a second insert for that `(vendor_id,
   profile_id)` pair) — one continuous history per person-per-vendor,
   not a new disconnected row per re-invitation.
   **Isolation is enforced at five distinct layers, each independently
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
   - **Active-membership isolation, added this revision** —
     `is_vendor_member()`'s body now filters `and revoked_at is null`.
     Every policy in this design calls this one helper rather than
     inlining the join, so this single change is what makes "all
     membership helpers must require active membership" true across
     every vendor-facing policy in P5 at once, not something each
     policy has to separately remember — a revoked person loses access
     to every table the moment their row is revoked, with zero
     per-policy changes needed anywhere else in this migration.
   - **Identity/attribution immutability, added this revision** — a
     new trigger, `enforce_vendor_member_identity_and_revocation()`,
     (a) rejects any `update` that changes `vendor_id`/`profile_id`
     after insert (a membership link's identity is fixed at creation;
     revoke-and-recreate is the only way to "move" one, and recreate
     here means reactivating the existing unique row, not inserting a
     new one), and (b) requires `revoked_by = auth.uid()` whenever
     `revoked_at` or `revoked_by` changes — the same anti-spoofing
     principle Decision 8 applies to `bid_questions.recorded_by`.
     **The first version of this trigger only checked `update`s where
     `revoked_at` itself changed** — a task-review finding caught two
     real gaps: a row could be `insert`ed already-revoked with a forged
     `revoked_by`, and an `update` touching only `revoked_by` (leaving
     `revoked_at` unchanged) skipped the check entirely. The trigger
     now also runs on `insert` and checks either field changing, not
     just `revoked_at`. Reactivation (`revoked_at` cleared back to
     `null`) clears `revoked_by` too, so a stale attribution never
     lingers on an active row.
   - **No delete, ever** — `vendor_members_no_delete` (same
     `reject_delete()` trigger every other permanent-record table in
     this schema uses), so a later audit-log row referencing a
     membership can never point at a vanished row. Revocation (above)
     is now the actual mechanism for "this person no longer has
     access," making the delete prohibition load-bearing rather than
     merely aspirational — before this revision, "no delete" combined
     with "no revoke" meant a departed person's access could
     realistically never be turned off.
   RLS: `vendor_members_staff_full_access` (org-staff of the vendor's
   own org — this is also the mutation path for revoking/reactivating:
   a plain, RLS-gated `update` setting `revoked_at`/`revoked_by`, not a
   dedicated RPC, since it's a single-row change with no cross-table
   atomicity need); `vendor_members_self_read` (a member reads their
   own membership rows, including a revoked one — seeing "you were
   revoked" is useful, and this policy governs visibility of the
   historical record, not active-session authorization, so it
   deliberately does *not* filter on `revoked_at`). Audit via
   `log_audit_no_project()` (org-scoped, no `project_id`, same as
   `vendors` itself) plus the matching `audit_log` SELECT policy
   `audit_log_vendor_members_staff_select`, following the exact
   precedent `vendors` itself set in schema/012 for tables without a
   `project_id` column.
   **Forward-compatibility for P11:** when a real vendor invitation
   flow ships, it inserts a `vendor_members` row (never repurposes an
   existing one, except to reactivate a previously-revoked pairing for
   the same person/vendor) — the schema already supports one business
   having any number of logins, added or revoked, from day one, so P11
   adds a UI, not a migration.

4. **Issuing a PO or subcontract creates an immutable, versioned
   snapshot row — `issued_documents` — even though the rendered PDF
   bytes themselves are still never stored.** Revision 1's "no
   persistence at all" (its old Decision 3) is corrected per explicit
   owner instruction: *generating* a PDF (a preview, before anything
   is finalized) stays ephemeral exactly as before, but *issuing* one
   — the act of actually sending a PO or subcontract to a vendor — is
   a real business event whose data must be reproducible later, not
   just "whatever the database happens to say today."
   **P5's reproducibility guarantee, defined precisely this revision**
   (replacing Revision 2's looser "byte-for-byte" language, which
   overstated what this design actually delivers): **content/layout-
   equivalent reproduction** — the same `canonical_data`, rendered
   through the *same template version* that produced the original,
   yields the same numbers, line items, and document structure. This
   is explicitly **not** pixel-identical/byte-identical reproduction
   of the originally-rendered file, which would require persisting the
   rendered bytes themselves — out of scope for P5, deferred to
   whichever future package actually needs a true archival copy (P9,
   per direction).
   ```sql
   create type issued_document_type as enum ('purchase_order', 'subcontract');

   create table issued_documents (
     id               uuid primary key default uuid_generate_v4(),
     document_type    issued_document_type not null,
     source_id        uuid not null, -- material_orders.id or bid_packages.id
     document_number  text not null,
     version          integer not null default 1,
     template_version text not null,
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
   can never be forged to claim a different issuer. **This alone does
   not close the gap** — found during Task 1's implementation review,
   not this decision's original pass: RLS still permits a direct
   `insert` on `issued_documents` that bypasses `issue_document()`
   entirely, so `enforce_issued_document_immutability()` now also runs
   on `insert`, rejecting any row whose `issued_by` isn't the inserting
   session's own `auth.uid()` regardless of which path wrote it.
   **`template_version`, added this revision, is what actually makes
   "historical template versions remain renderable" a mechanism rather
   than a hope.** Each PDF template module (`MaterialOrderPdf.tsx`/
   `SubcontractPdf.tsx`) exports its own current version string (e.g.
   `MATERIAL_ORDER_PDF_TEMPLATE_VERSION = "1"`); `documentIssuanceService.ts`
   passes it to `issue_document()` at issuance time, and it is frozen
   into the row alongside `canonical_data`, protected by the same
   immutability trigger. The PDF route resolves which component to
   render through a small registry keyed by that exact string (e.g.
   `MATERIAL_ORDER_PDF_RENDERERS: Record<string, Component>`), not by
   always calling "whatever the current template file exports." The
   convention going forward: a template change that would alter
   layout/structure for existing data bumps the version string and
   *adds* a new registry entry rather than replacing the old
   component — the old renderer stays in the codebase and in the
   registry, so a snapshot issued under version `"1"` keeps rendering
   through version `"1"`'s own component indefinitely, even after
   version `"2"` becomes current. P5 ships exactly one template
   version each for POs and subcontracts, so this mechanism has only
   one entry to prove today — but the dispatch-by-version-string
   design, and an explicit test for the "unrecognized template_version"
   failure path (Task 10), are what make the *claim* "historical
   versions remain renderable" backed by an actual code path now,
   rather than deferred to whenever a second version first ships.
   A new trigger, `enforce_issued_document_immutability()`, rejects any
   `update` that changes `canonical_data`/`document_number`/`version`/
   `template_version`/`document_type`/`source_id`/`issued_at`/`issued_by`
   — the only fields ever allowed to change post-insert are
   `superseded_at`/`superseded_by_id`, set exactly once by
   `issue_document()`'s own next call. No delete, ever, same reasoning
   as `vendor_members`.
   **The PDF route's behavior changes accordingly** (see "Server-side
   operations" below): once an `issued_documents` row exists, the PDF
   route renders from its frozen `canonical_data` through its frozen
   `template_version`'s own renderer, not live database state or the
   current template file — this is what makes content/layout-
   equivalent reproduction true in practice, not just in principle.
   Before anything is issued, the route still renders a live preview
   through the *current* template version, watermarked "DRAFT — NOT
   ISSUED," so staff can review before committing to an official
   issuance.
   **One honest caveat, kept from Revision 2 but now scoped correctly**
   (matching `FINANCIAL-ARCHITECTURE.md`'s own convention for stating
   these plainly): `canonical_data` plus `template_version` together
   freeze everything this design guarantees — the *content and layout*
   of the issued document. They do not freeze incidental rendering
   details a future `@react-pdf/renderer` version upgrade could
   theoretically shift (font substitution, sub-pixel spacing) without
   bumping `template_version`, since those are renderer-library
   concerns, not template-code concerns. This residual gap is
   accepted for P5 specifically because the reproducibility bar this
   revision sets is content/layout-equivalence, not byte-identity — a
   future package targeting true byte-identical archival would need to
   also pin/version the renderer library per snapshot (or simply store
   the rendered bytes, the more direct fix, per this decision's own
   opening paragraph), neither of which P5 does.

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
   surface).
   **A real gap, closed this revision:** Revision 2 relied on
   `recorded_by default auth.uid()` alone to establish provenance —
   but a *default* only fills in a value the caller omits; it does
   **not** stop a caller from explicitly supplying a different
   `recorded_by` in the same insert payload. That is a default, not a
   boundary — the distinction the owner's review correctly called out.
   A new trigger, `enforce_bid_question_recorded_by_self()`, closes
   this at the database itself:
   ```sql
   create or replace function public.enforce_bid_question_recorded_by_self() returns trigger
   language plpgsql
   set search_path = public, pg_temp
   as $$
   begin
     if tg_op = 'INSERT' then
       if new.source = 'staff_recorded' and new.recorded_by is distinct from auth.uid() then
         raise exception 'bid_questions.recorded_by must equal the inserting session''s own auth.uid() (%) for staff_recorded rows — got %.',
           auth.uid(), new.recorded_by;
       end if;
       if new.source = 'vendor_submitted' and new.recorded_by is not null then
         raise exception 'bid_questions.recorded_by must be null for vendor_submitted rows — a vendor-submitted question has no staff recorder.';
       end if;
       return new;
     end if;
     -- UPDATE: provenance is set once at insert, never reassigned — an
     -- answer changes answer_text/answered_by/answered_at, never who
     -- originally asked/recorded the question.
     if new.recorded_by is distinct from old.recorded_by or new.source is distinct from old.source then
       raise exception 'bid_questions.recorded_by/source are immutable after insert (row %) — provenance is set once, never reassigned.', old.id;
     end if;
     return new;
   end;
   $$;
   ```
   The column default is kept (it is still the convenient common case —
   an ordinary insert that omits `recorded_by` gets the correct value
   automatically) but the trigger, not the default, is what actually
   makes impersonation impossible: even a caller that explicitly tries
   to set `recorded_by` to someone else's id is rejected, at the
   database boundary, regardless of what the service layer does or
   fails to do. `issued_by` on `issued_documents` (Decision 4) never
   had this gap through the RPC-call path — `issued_by` is set *inside*
   the RPC body with no caller-facing parameter to spoof, which is a
   stronger starting point than a column default. **It was not,
   however, immune to a direct table insert bypassing the RPC
   entirely** (a task-review finding, corrected the same way as the two
   items below: `enforce_issued_document_immutability()` now also runs
   on `insert`). `bid_questions` uses a trigger from the start because
   it is a plain table insert, not an RPC, so there is no RPC body to
   hide the assignment inside. `asked_at` records when the vendor
   reportedly asked (per staff, possibly by phone yesterday); the row's
   own `created_at` (implicit, not separately named) records when it
   was actually entered — keeping "what the vendor said" and "when this
   became a system record" honestly distinct rather than conflated into
   one timestamp. **`bid_addenda` needed the identical trigger-based fix
   as `bid_questions`** — a correction to this decision's original
   claim that it "needed no equivalent change... no impersonation risk
   to begin with." That reasoning was wrong: `bid_addenda_staff_full_access`'s
   `WITH CHECK` only tests project ownership, not who `issued_by`
   claims to be, so a direct insert could forge it exactly like
   `bid_questions.recorded_by` could before this decision's trigger. A
   new `enforce_bid_addendum_issued_by_self()` closes it, found and
   fixed during Task 1's implementation review, not this decision's
   original pass.

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
    not just one).
    **Confirmed on this revision's review: already fully enforced
    exactly as specified — no schema change made here.** The owner's
    hardening instruction asked that the freeze "protect financial
    identity and amounts without blocking permitted receipt/backorder
    tracking" and asked for the exact mutable-field list to be stated.
    Both are already true of the Revision 2 trigger; this entry now
    states the list explicitly rather than leaving it implicit in
    prose, so there is no ambiguity to re-derive later:

    | Field | Mutable once `status <> 'draft'`? | Why |
    |---|---|---|
    | `id` | No (never, at any status) | Primary key |
    | `material_order_id` | No | Identity — which order this line belongs to |
    | `project_id` | No | Identity — backbone FK correctness |
    | `cost_code_id` | No | **Financial identity** — which `committed_costs` row this line's dollars already landed in |
    | `quantity` | No | **Amount input** — already summed into a frozen `committed_costs.amount_cents` |
    | `unit_price_cents` | No | **Amount input** — same reason as `quantity` |
    | `description` | No | Frozen alongside the above for one consistent record of what was actually ordered at commit time |
    | `unit` | No | Same reasoning as `description` |
    | `received_quantity` | **Yes, always** | The entire point of receiving — only meaningful *after* an order is placed |
    | `backordered` | **Yes, always** | Same reasoning as `received_quantity` |

    A new trigger,
    `enforce_material_order_line_item_frozen_after_commit()`, covers
    all three operations: blocks `insert` of a new line item once the
    parent order's `status <> 'draft'`; blocks `update` of any row in
    the "No" column above once `status <> 'draft'`; blocks `delete`
    once `status <> 'draft'`. Style matches
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

- `vendor_members` (Decision 3: `revoked_at`/`revoked_by` added this
  revision) + `enforce_vendor_member_org_match()` +
  `enforce_vendor_member_identity_and_revocation()` + `is_vendor_member()`
  (now filters `revoked_at is null`) + `vendor_members_no_delete` + RLS
  + audit.
- `bid_packages` (Decision 1) + RLS (staff full access;
  `bid_packages_vendor_read` now via `is_vendor_member()`, not
  `vendors.profile_id`) + audit.
- `bid_submissions` (unchanged shape from Revision 1) + RLS (vendor
  read/update now via `is_vendor_member()`) + audit via
  `log_audit_via_bid_package()`.
- `bid_questions` (Decision 8: `source`, `recorded_by` added, plus
  `enforce_bid_question_recorded_by_self()` added this revision) + RLS
  (vendor read/insert via `is_vendor_member()`) + audit.
- `bid_addenda` (unchanged shape) + RLS (vendor read via
  `is_vendor_member()`) + audit.
- `material_orders` (Decision 2: `cost_code_id` now nullable) + RLS
  (staff-only, no vendor policy, unchanged) + audit.
- `material_order_line_items` (Decision 2: `project_id`/`cost_code_id`
  added, composite FK, `enforce_line_item_project_matches_order()`;
  Decision 10: `enforce_material_order_line_item_frozen_after_commit()`)
  + RLS (staff-only) + audit via `log_audit_via_material_order()`.
- `issued_documents` (Decision 4: `template_version` added this
  revision) + `enforce_issued_document_immutability()`
  + `issued_documents_no_delete` + RLS (staff-only, resolved through
  `material_orders`/`bid_packages` depending on `document_type`) +
  audit via `log_audit_via_issued_document()`.
- RPCs: `award_bid()` (unchanged from Revision 1), `commit_material_order()`
  (Decision 2: `returns table(cost_code_id uuid, committed_cost_id uuid)`,
  groups by cost code — not the unordered `returns setof uuid` this
  design specified before this revision), `issue_document()` (Decision
  4, now also takes `p_template_version text`).

## RLS policies

**A real recursion bug, found only once Task 2 actually executed the
RLS tests against a live database — no amount of reading the SQL caught
it — and fixed in Task 1's deliverable:** `bid_packages_vendor_read`
and `bid_submissions_staff_full_access` originally referenced each
other via plain (non-security-definer) cross-table subqueries.
Postgres detects this as "infinite recursion detected in policy" at
plan time, for *any* querying role — this broke all access to both
tables, staff included, not just the vendor path. Two new
`SECURITY DEFINER` helpers, `get_bid_package_project_id(uuid)` and
`is_invited_vendor_for_bid_package(uuid)` — the same pattern
`is_project_vendor()`/`is_vendor_member()`/`is_org_staff()` already
use elsewhere in this schema — resolve each cross-table check without
re-triggering the other table's RLS, breaking the cycle. Every policy
below that needs "which project does this bid_package belong to" now
goes through `get_bid_package_project_id()` rather than inlining its
own subquery, for consistency and to close off any future re-
introduction of the same class of bug from a different angle.

Staff: full access on every new table, `is_org_staff(project_id)`
(resolved directly for `bid_packages`/`material_orders`, through the
parent for the child tables via `get_bid_package_project_id()`, and
through a `document_type`-conditional lookup for `issued_documents`),
matching every existing project-scoped financial table.

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

Every one of the five bullets above resolves vendor identity through
`is_vendor_member()` and nothing else — meaning **every one of them
automatically requires active (non-revoked) membership** the moment
that helper does (Decision 3), with zero per-policy edits. This is the
concrete proof that "all membership helpers must require active
membership" holds across the whole vendor surface, not just in
isolation.

Every vendor policy gets the roadmap's mandated pair of tests, now
explicitly including the "two members, one vendor" case: "Vendor A on
Project 1 sees nothing on Project 2," "Vendor A sees nothing belonging
to Vendor B on the same project," and (new, per Decision 3) "a second
authenticated person linked to the *same* `vendors.id` as Vendor A
sees exactly what Vendor A sees" — plus, added this revision, "a
revoked member loses access immediately; reactivating restores it."

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
  `commit_material_order()`; returns
  `{ committedCosts: { costCodeId: string; committedCostId: string }[] }`
  — the cost-code-to-commitment mapping directly, per Decision 2's
  revised RPC signature, not a bare array of ids the caller would have
  to re-associate itself.
- `recordReceivedQuantity(supabase, lineItemId, receivedQuantity, markBackordered?)`
  — unchanged from Revision 1.
- **`documentIssuanceService.ts`** (new, Decision 4):
  `issuePurchaseOrder(supabase, materialOrderId, documentNumber?)` —
  builds `canonical_data` from `getMaterialOrderDetail` (project meta,
  vendor name, every line item with its own cost code/quantity/price),
  defaults `documentNumber` to the order's `order_number` if the
  caller doesn't supply one, passes the PDF template module's own
  exported `MATERIAL_ORDER_PDF_TEMPLATE_VERSION` constant, calls
  `issue_document('purchase_order', ..., templateVersion, ...)`.
  `issueSubcontract(supabase, bidPackageId, documentNumber?)` —
  validates the package's status is `awarded` first (returns `{error}`
  otherwise — issuing a subcontract for a bid that was never awarded
  is a service-layer validation, not just a UI affordance), builds
  `canonical_data` from `getBidPackageDetail` plus the awarded
  submission, passes `SUBCONTRACT_PDF_TEMPLATE_VERSION`, calls
  `issue_document('subcontract', ...)`.
  `getLatestIssuedDocument(supabase, documentType, sourceId)` /
  `getIssuedDocumentVersion(supabase, documentType, sourceId, version)`
  — read functions the PDF routes call to render a frozen snapshot
  (including its `templateVersion`) instead of live data once one
  exists.
- **PO/subcontract PDF Route Handlers** (`GET
  /api/procurement/material-orders/[id]/pdf` and `GET
  /api/bids/[bidPackageId]/subcontract-pdf`; both `export const runtime
  = "nodejs"`, Decision 9): if an `issued_documents` row exists for
  this source (optionally a specific `?version=`), resolves the
  correct renderer component from a small `template_version`-keyed
  registry (Decision 4) and renders `@react-pdf/renderer` output from
  the snapshot's frozen `canonical_data` through that specific
  renderer; otherwise renders a live preview through the *current*
  template version, watermarked "DRAFT — NOT ISSUED." An unrecognized
  `template_version` (a data-integrity case that should never occur in
  practice, but is defensively tested per Decision 4) returns a safe
  500, the same as any other rendering failure. Explicit
  `AuthorizationError`→403 handling and `renderToBuffer`-failure→500
  handling per Decision 9's test requirements — no case is left to
  fall through to a framework default. Never persists the rendered
  bytes (Decision 4's own "PDF bytes are still never stored" clause;
  the reproducibility this provides is content/layout-equivalent, not
  byte-identical, per Decision 4's redefinition this revision).
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
   and "two members of the same vendor see the same data" — using
   `vendor_members` + `is_vendor_member()` instead of Revision 1's
   `vendors.profile_id`.
3. `enforce_vendor_member_org_match()` rejects linking a profile from
   org B to a vendor owned by org A.
4. **Revocation, added this revision**: an active member reads
   normally; revoking (`revoked_at`/`revoked_by` set) removes their
   access on the *next* request, proven by re-running the same read
   assertions from test 2 as the now-revoked session and confirming
   zero rows; reactivating (`revoked_at` cleared) restores access,
   proven the same way. `enforce_vendor_member_identity_and_revocation()`
   rejects (a) changing `vendor_id`/`profile_id` post-insert, (b)
   setting `revoked_by` to anything other than the acting session's own
   `auth.uid()` at the moment of revocation.
5. `bid_submissions_one_per_vendor_per_package` /
   `bid_submissions_amount_set_when_submitted` — unchanged from
   Revision 1.
6. `award_bid()` happy path + reject-non-submitted — unchanged.
7. **`commit_material_order()` with line items spanning two different
   cost codes** — happy path now asserts the RPC's returned
   `(cost_code_id, committed_cost_id)` rows correctly pair each cost
   code with its own `committed_costs` row (not merely that "two rows
   exist," per Decision 2's revised return shape), each summed only
   from that cost code's own line items; rejects zero line items;
   rejects a non-`draft` order.
8. `enforce_line_item_project_matches_order()` rejects a line item
   whose `project_id` doesn't match its order's.
9. `enforce_material_order_line_item_frozen_after_commit()`: rejects
   inserting/updating/deleting any field in Decision 10's "No" column
   once the order isn't `draft`; confirms `received_quantity`/
   `backordered` (the "Yes" column) remain updatable post-commit at
   every subsequent status, not just once.
10. `material_order_line_items_received_not_over` — unchanged.
11. `bid_questions_staff_recorded_requires_recorder` rejects a
    `source='staff_recorded'` row with `recorded_by is null`.
12. **`enforce_bid_question_recorded_by_self()`, added this revision**:
    an insert attempting to set `recorded_by` to a *different* user's
    id (not merely omitting it) is rejected — the actual spoofing case
    the column default alone could never catch; a subsequent `update`
    attempting to reassign `recorded_by`/`source` on an existing row is
    also rejected.
13. `issue_document()`: first issuance creates version 1 with the
    caller-supplied `template_version` recorded; a second call for the
    same source creates version 2 and marks version 1 superseded
    (`superseded_by_id` pointing at the new row);
    `enforce_issued_document_immutability()` rejects a direct `update`
    to `canonical_data` **or `template_version`** on an existing row.
14. `issued_documents` staff-only RLS + cross-org isolation, for both
    `document_type` values (proves the conditional
    `material_orders`-vs-`bid_packages` lookup resolves correctly for
    each).
15. Audit visibility across all seven new tables (same bar P4 set),
    including `vendor_members`' revoke/reactivate updates each
    producing their own distinct audit row.
16. Real Postgres re-run of `committed_forecast_hardening_tests.sql`
    "in context" — unchanged from Revision 1.
17. **Added after Task 1's review round, not in this list's original
    pass**: direct-spoofing-attempt tests for the three actor-provenance
    fields found to be unenforced — `bid_addenda.issued_by` (insert
    with a forged value rejected; post-insert reassignment rejected),
    `issued_documents.issued_by` (a direct insert bypassing
    `issue_document()` entirely, with a forged value, rejected), and
    `vendor_members.revoked_by` (inserting an already-revoked row with
    a forged value rejected; an update touching only `revoked_by` on an
    already-revoked row, leaving `revoked_at` unchanged, rejected).
    These exercise the fixes described in Decisions 3, 4, and 8's
    review-round corrections above.

New files added to `scripts/db/run-sql-tests.mjs`'s `FILES` array as
before. `apps/web` test additions: `procurement_totals_unit.ts`
(unchanged scope) plus PDF-route authorization/failure-path tests
(Decision 9), now also including an unrecognized-`template_version`
case (Decision 4 — the registry-dispatch fallback returning a safe
500, not a crash), under whichever existing Route Handler test
convention this repo uses (check for precedent before inventing a new
one — see implementation plan Task 10).

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
   committed, produces exactly two `committed_costs` rows correctly
   paired to their originating cost codes via the RPC's own returned
   mapping — not merely "two rows exist" — proven through the UI, not
   just direct SQL.**
4. **A material order line item's cost code, quantity, description,
   and unit price can never be edited or deleted once its parent
   order leaves `draft` — proven by an actual attempted edit through
   the service layer being rejected by the database, not merely
   absent from the UI — while `received_quantity`/`backordered`
   remain editable at any post-commit status. Decision 10's field
   table is the authoritative list; this criterion is proven against
   every row in it, not a sample.**
5. **Two different authenticated test sessions, both linked via
   `vendor_members` to the same `vendors.id`, can each read that
   vendor's own invited bid packages/submissions; a third session
   linked to a different vendor reads none of it — proven by all three
   required isolation axes, not just the original two.**
6. **Revoking one of those two sessions' `vendor_members` row removes
   its access immediately (proven by re-running its own read
   assertions from criterion 5 and confirming zero rows), while the
   other, still-active session is unaffected; reactivating restores
   access — proven by an actual revoke/reactivate cycle, not code
   review.**
7. **Issuing a PO twice for the same material order (once, then again
   after a change) produces two `issued_documents` rows, version 1
   marked superseded by version 2, and the PDF route serving version 1
   explicitly (`?version=1`) still renders through version 1's own
   `template_version` — content/layout-equivalent to what was
   originally issued — even after the order's live data and/or the
   current template file has since changed.**
8. **An insert into `bid_questions` that explicitly supplies a
   `recorded_by` value other than the inserting session's own
   `auth.uid()` is rejected by the database — proven by an actual
   attempted spoof, not by confirming the column default alone.**
9. A material order with one backordered line item surfaces as a
   distinct Action Center event, separate from the order's own overall
   status.
10. Every new table's writes produce a real, staff-readable `audit_log`
    row.
11. **The PO/subcontract PDF routes return 403 (not 500) for an
    authenticated non-staff session, 404 for a nonexistent id, a safe
    generic 500 (no internal detail) for a forced rendering failure,
    and a safe generic 500 for an unrecognized `template_version` —
    proven by actual requests, not code review.**
12. `npm ci`/`typecheck`/`test`/`build` all pass from a clean install,
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
data snapshot plus its `template_version` is persisted, deliberately,
not the rendered document itself; P5's reproducibility guarantee is
content/layout-equivalent, not byte-identical (Decision 4) — true
byte-identical archival is deferred to whichever future package
persists the rendered file itself. No admin UI to revoke/reactivate a
`vendor_members` link in P5 — the schema, RLS, and a callable service
function all support it correctly (Decision 3) and are tested at the
SQL level, but no screen in this package exposes the action; the first
package with a real reason to expose it in a UI (plausibly P11,
alongside its invitation flow) wires the screen, not a migration. No
change to `AdminFinancialsScreen`'s existing rollup.
