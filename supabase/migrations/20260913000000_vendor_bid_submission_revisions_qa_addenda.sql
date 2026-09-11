-- =====================================================================
-- Stone Column Portal — Migration 026: P5.2 Phase C — vendor bid
-- submission/revision with immutable history, vendor-submitted Q&A
-- (wiring the already-existing but dormant bid_questions_vendor_insert
-- policy), and addendum acknowledgment tracking. See
-- docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md, Section 5,
-- "P5.2." Phases A (schema/022-023) and B (schema/024-025) are closed
-- and untouched here.
--
-- =====================================================================
-- VERSIONING-PATTERN DECISION (read this before touching bid_submissions)
-- =====================================================================
-- bid_submissions (schema/015) is NOT an append-only ledger — it is a
-- single mutable row per (bid_package_id, vendor_id) (a real unique
-- constraint enforces this), doubling as both the invitation record
-- (status starts 'invited') and the current-state row staff already
-- read/write today via recordBidSubmission() (staff-recorded amount)
-- and award_bid() (status -> 'awarded'/'declined', which also inserts
-- the real committed_costs row). This is an ALREADY-ESTABLISHED,
-- already-shipped, different pattern from the "new row per version,
-- never mutate" shape `documents`/`issued_documents` use — changing
-- bid_submissions' own shape (e.g. dropping its one-row-per-vendor
-- unique constraint to allow multiple rows) would require rewriting
-- award_bid(), recordBidSubmission(), and every staff-facing read in
-- bidService.ts/BidPackageWorkspace.tsx that assumes exactly one row
-- per vendor per package — real regression risk against Phase A/B's
-- already-reviewed-clean work, for a table whose current shape is
-- correct for what IT is (the current-state/staff-award record).
--
-- The decision: KEEP bid_submissions' existing shape and every existing
-- read/write path against it completely unchanged (recordBidSubmission,
-- award_bid, getBidPackageDetail's staff view, the vendor_update policy
-- itself) — and add a NEW, purpose-built child table
-- (bid_submission_revisions) that IS append-only/immutable/one-row-per-
-- revision, exactly matching documents/issued_documents' own proven
-- versioning philosophy, scoped to the one new thing that genuinely
-- needs full history: a VENDOR's own sequence of submit/revise actions.
-- Every vendor submit/revise (via submit_bid_revision() below) does two
-- things atomically: (1) INSERT a new, permanent, never-updated
-- bid_submission_revisions row (the real history), and (2) UPDATE
-- bid_submissions' current amount_cents/notes/status/submitted_at to
-- mirror the latest revision — which is exactly the update
-- recordBidSubmission() already performs for a staff-recorded
-- submission, so award_bid()/staff reads need zero changes to keep
-- working against whichever path (staff-recorded or vendor-submitted)
-- produced the current row. A staff-recorded submission simply has zero
-- bid_submission_revisions rows — an honest, correctly-empty history for
-- a submission that was never made by the vendor's own session.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: resolve a bid_submissions row's project id, the same
-- "resolve through the parent chain, SECURITY DEFINER" shape as
-- get_bid_package_project_id() itself.
-- ---------------------------------------------------------------------
create or replace function public.get_bid_submission_project_id(p_bid_submission_id uuid) returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.get_bid_package_project_id(bs.bid_package_id)
  from public.bid_submissions bs
  where bs.id = p_bid_submission_id;
$$;
revoke all on function public.get_bid_submission_project_id(uuid) from public;
grant execute on function public.get_bid_submission_project_id(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- bid_submission_revisions: the real, permanent, immutable history.
-- revision_number is computed server-side (by the trigger below, never
-- client-supplied) — the trigger overwrites whatever the insert payload
-- provides, closing off any race/spoofing concern about a client
-- picking its own number.
-- ---------------------------------------------------------------------
create table bid_submission_revisions (
  id                 uuid primary key default uuid_generate_v4(),
  bid_submission_id  uuid not null references bid_submissions(id) on delete cascade,
  revision_number    integer not null,
  amount_cents       bigint not null,
  notes              text,
  submitted_by       uuid references profiles(id) default auth.uid(),
  submitted_at       timestamptz not null default now(),

  constraint bid_submission_revisions_amount_nonnegative check (amount_cents >= 0),
  constraint bid_submission_revisions_unique_number unique (bid_submission_id, revision_number)
);

alter table bid_submission_revisions enable row level security;

-- Staff (financial-staff only, matching bid_submissions' own corrected
-- policy from schema/016 — this table carries the same pricing
-- sensitivity) read every revision for their own org's packages.
create policy bid_submission_revisions_staff_read on bid_submission_revisions
  for select to authenticated
  using (is_financial_staff(get_bid_submission_project_id(bid_submission_revisions.bid_submission_id)));

-- Vendor: only their OWN submission's revisions — never another
-- vendor's, even on the same package. is_vendor_member() resolves the
-- owning bid_submissions row's vendor_id; a vendor with no relationship
-- to that row sees nothing.
create policy bid_submission_revisions_vendor_read on bid_submission_revisions
  for select to authenticated
  using (is_vendor_member((select bs.vendor_id from bid_submissions bs where bs.id = bid_submission_revisions.bid_submission_id)));

create policy bid_submission_revisions_vendor_insert on bid_submission_revisions
  for insert to authenticated
  with check (is_vendor_member((select bs.vendor_id from bid_submissions bs where bs.id = bid_submission_revisions.bid_submission_id)));

-- The real business-rule boundary (RLS's own WITH CHECK above is only
-- "is this even your submission" — everything else needs OLD/NEW-style
-- reasoning a boolean USING/WITH CHECK can't express, same reason every
-- other invariant in this domain is trigger-enforced): a vendor may only
-- add a revision to their OWN submission (re-verified here, defense in
-- depth), only while that submission is still open (status invited/
-- submitted, never awarded/declined/withdrawn) AND the package itself is
-- still accepting bids (status='published' AND due_at is null or in the
-- future) — this is the DB-level enforcement of "never after the
-- package closes," not merely a UI/service-layer courtesy. Also
-- computes the real, sequential revision_number and enforces
-- submitted_by = auth.uid() (the column default alone is not a
-- boundary, exactly like every other provenance column in this
-- codebase — bid_questions.recorded_by, bid_addenda.issued_by, etc.).
create or replace function public.enforce_bid_submission_revision_insert_rules() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_submission bid_submissions%rowtype;
  v_package bid_packages%rowtype;
begin
  if new.submitted_by is distinct from auth.uid() then
    raise exception 'bid_submission_revisions.submitted_by must equal the inserting session''s own auth.uid() (%) — got %.',
      auth.uid(), new.submitted_by;
  end if;

  select * into v_submission from bid_submissions where id = new.bid_submission_id;
  if not found then
    raise exception 'Bid submission % not found', new.bid_submission_id;
  end if;
  if not is_vendor_member(v_submission.vendor_id) then
    raise exception 'Not authorized to submit a bid revision for this bid submission';
  end if;
  if v_submission.status not in ('invited', 'submitted') then
    raise exception 'Bid submission % is % and can no longer be revised', new.bid_submission_id, v_submission.status;
  end if;

  select * into v_package from bid_packages where id = v_submission.bid_package_id;
  if v_package.status <> 'published' then
    raise exception 'This bid package is no longer accepting submissions (status: %)', v_package.status;
  end if;
  if v_package.due_at is not null and v_package.due_at <= now() then
    raise exception 'This bid package''s due date (%) has passed — submissions are closed', v_package.due_at;
  end if;

  select coalesce(max(revision_number), 0) + 1 into new.revision_number
  from bid_submission_revisions where bid_submission_id = new.bid_submission_id;

  return new;
end;
$$;

create trigger bid_submission_revisions_insert_rules
  before insert on bid_submission_revisions
  for each row execute function public.enforce_bid_submission_revision_insert_rules();

-- Permanent record — no update, no delete, ever, by anyone (matching
-- issued_documents/bid_package_documents' own "archive/supersede, never
-- delete or mutate" posture for anything that must persist as a
-- permanent history).
create trigger bid_submission_revisions_no_delete before delete on bid_submission_revisions
  for each row execute function public.reject_delete();
revoke update, delete on bid_submission_revisions from authenticated, anon;

-- log_audit_via_bid_package() (schema/015) resolves project_id from a
-- `bid_package_id` COLUMN directly on the triggering row — this table
-- has no such column (only bid_submission_id), so a dedicated resolver
-- is needed, following the exact same shape.
create or replace function public.log_audit_via_bid_submission() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  select get_bid_submission_project_id(coalesce(new.bid_submission_id, old.bid_submission_id)) into v_project_id;

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
revoke all on function public.log_audit_via_bid_submission() from public;

-- Insert-only table -> insert-only audit trigger (no update/delete ever
-- happens, so there is nothing else to audit). project_id resolved here
-- is non-null, so the generic audit_log_staff_select policy (schema/001)
-- already covers staff read access — no dedicated per-table audit_log
-- policy is needed, unlike vendor_members' org-scoped (project_id-less)
-- audit rows.
create trigger audit_bid_submission_revisions after insert on bid_submission_revisions
  for each row execute function public.log_audit_via_bid_submission();

-- ---------------------------------------------------------------------
-- bid_submissions: harden the ALREADY-EXISTING bid_submissions_vendor_
-- update policy (schema/015) with the same kind of trigger-enforced,
-- OLD/NEW-aware business rules bid_submission_revisions' own insert
-- trigger just proved out above. This is required because the existing
-- policy's USING/WITH CHECK — `is_vendor_member(vendor_id)` — is a
-- simple boolean with no way to express "only to 'submitted'," "only
-- while still invited/submitted," or "only while the package is still
-- open": without this trigger, a vendor session could otherwise call
-- the bid_submissions table directly (bypassing submit_bid_revision()
-- entirely) to set status='awarded'/'declined', edit a submission after
-- the deadline, or revise a withdrawn/declined/awarded submission — a
-- real, latent gap in the existing policy that Phase C's real vendor
-- session is the first thing ever able to exercise. Staff (financial
-- staff, matching this table's own already-corrected staff policy) are
-- completely unrestricted by this trigger — award_bid()/
-- recordBidSubmission() continue to work byte-for-byte as before.
-- ---------------------------------------------------------------------
create or replace function public.enforce_bid_submission_vendor_revision_rules() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_package_status bid_package_status;
  v_due_at timestamptz;
begin
  v_project_id := get_bid_package_project_id(old.bid_package_id);

  if is_financial_staff(v_project_id) then
    return new;
  end if;

  if new.vendor_id is distinct from old.vendor_id or new.bid_package_id is distinct from old.bid_package_id then
    raise exception 'bid_submissions.vendor_id/bid_package_id are immutable (row %) — a vendor session cannot reassign which package or vendor a submission belongs to.', old.id;
  end if;

  if new.status is distinct from old.status and new.status <> 'submitted' then
    raise exception 'A vendor may only move a bid submission to ''submitted'' — status % is staff-only (award/decline/withdrawal are recorded by Stone Column staff)', new.status;
  end if;

  if old.status not in ('invited', 'submitted') then
    raise exception 'Bid submission % is % and can no longer be revised by the vendor', old.id, old.status;
  end if;

  select status, due_at into v_package_status, v_due_at from bid_packages where id = old.bid_package_id;
  if v_package_status <> 'published' then
    raise exception 'This bid package is no longer accepting submissions (status: %)', v_package_status;
  end if;
  if v_due_at is not null and v_due_at <= now() then
    raise exception 'This bid package''s due date (%) has passed — submissions are closed', v_due_at;
  end if;

  return new;
end;
$$;

create trigger bid_submissions_vendor_revision_rules
  before update on bid_submissions
  for each row execute function public.enforce_bid_submission_vendor_revision_rules();

-- ---------------------------------------------------------------------
-- submit_bid_revision(): the one real vendor-facing write path,
-- orchestrating the two-table update atomically (one round trip, no
-- client-side race between "insert the revision" and "update the
-- current row" as two separate statements). SECURITY INVOKER, matching
-- every other multi-step RPC in this domain (award_bid,
-- commit_material_order, issue_document) — runs as the caller's own
-- session, so both writes below are still fully governed by the real
-- RLS policies and triggers above, not bypassed by this function.
-- Deliberately does NOT re-implement the business rules already
-- enforced by the two triggers above — a single source of truth for
-- "is this allowed," exercised identically whether a future caller
-- goes through this RPC or (hypothetically) writes to the tables
-- directly.
-- ---------------------------------------------------------------------
create or replace function public.submit_bid_revision(
  p_bid_submission_id uuid,
  p_amount_cents bigint,
  p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_revision_id uuid;
  v_clean_notes text;
begin
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'Bid amount must be a whole number of cents, zero or greater';
  end if;

  v_clean_notes := nullif(trim(coalesce(p_notes, '')), '');

  insert into bid_submission_revisions (bid_submission_id, amount_cents, notes)
  values (p_bid_submission_id, p_amount_cents, v_clean_notes)
  returning id into v_revision_id;

  update bid_submissions
  set status = 'submitted', amount_cents = p_amount_cents, notes = v_clean_notes, submitted_at = now()
  where id = p_bid_submission_id;

  if not found then
    raise exception 'Bid submission % could not be updated — not found, or not authorized', p_bid_submission_id;
  end if;

  return v_revision_id;
end;
$$;

revoke all on function public.submit_bid_revision(uuid, bigint, text) from public;
grant execute on function public.submit_bid_revision(uuid, bigint, text) to authenticated;

-- =====================================================================
-- Wiring the already-existing (dormant since schema/015)
-- bid_questions_vendor_insert policy. Re-verified sufficient for
-- identity/scope (invited-vendor-only, own-package-only, source forced
-- to 'vendor_submitted', recorded_by forced null by the existing
-- bid_questions_recorded_by_self trigger) — ONE genuine gap found: the
-- original WITH CHECK never constrained visible_to_all_vendors, so a
-- vendor's own inserted question could be immediately broadcast
-- (visible_to_all_vendors defaults to true) to every OTHER invited
-- vendor on the same package before any staff member ever reviews it —
-- a real, if narrow, cross-vendor exposure of one vendor's own
-- correspondence to competitors, unmediated by staff. Fixed by forcing
-- visible_to_all_vendors=false at insert; staff (who already have
-- unrestricted UPDATE via bid_questions_staff_full_access) can broaden
-- visibility to all vendors once they've reviewed the question and its
-- eventual answer, exactly mirroring how bid_addenda are the ONLY
-- always-broadcast mechanism in this domain and ad hoc Q&A is
-- staff-mediated by default.
-- =====================================================================
drop policy bid_questions_vendor_insert on bid_questions;

create policy bid_questions_vendor_insert on bid_questions
  for insert to authenticated
  with check (
    source = 'vendor_submitted'
    and vendor_id is not null
    and is_vendor_member(vendor_id)
    and visible_to_all_vendors = false
    and exists (
      select 1 from bid_submissions bs
      where bs.bid_package_id = bid_questions.bid_package_id and bs.vendor_id = bid_questions.vendor_id
    )
  );

-- =====================================================================
-- bid_addendum_acknowledgments: a specific invited vendor acknowledging
-- a specific addendum. Identity shape follows bid_submissions'/
-- bid_addenda's own established pattern exactly — vendor_id (a real FK
-- into vendors, gated through is_vendor_member() like every other
-- vendor-identity check in this domain, not a per-user-within-vendor-
-- org concept — this codebase has no such concept anywhere else in the
-- vendor domain, so none is invented here either) and acknowledged_by
-- (which person, mirroring bid_addenda.issued_by/bid_questions.
-- recorded_by's own "which real person acted" provenance).
-- =====================================================================
create table bid_addendum_acknowledgments (
  id               uuid primary key default uuid_generate_v4(),
  bid_addendum_id  uuid not null references bid_addenda(id) on delete cascade,
  vendor_id        uuid not null references vendors(id),
  acknowledged_by  uuid references profiles(id) default auth.uid(),
  acknowledged_at  timestamptz not null default now(),

  constraint bid_addendum_acknowledgments_unique unique (bid_addendum_id, vendor_id)
);

alter table bid_addendum_acknowledgments enable row level security;

create policy bid_addendum_acknowledgments_staff_read on bid_addendum_acknowledgments
  for select to authenticated
  using (
    is_financial_staff(get_bid_package_project_id((select ba.bid_package_id from bid_addenda ba where ba.id = bid_addendum_acknowledgments.bid_addendum_id)))
  );

create policy bid_addendum_acknowledgments_vendor_read on bid_addendum_acknowledgments
  for select to authenticated
  using (is_vendor_member(vendor_id));

-- Same "re-derive invitation via a direct EXISTS against bid_submissions"
-- shape bid_questions_vendor_insert (schema/015) and
-- bid_addenda_vendor_read (schema/015) already use — a vendor may only
-- acknowledge an addendum belonging to a package it is itself invited
-- to, for its OWN vendor_id, never another vendor's.
create policy bid_addendum_acknowledgments_vendor_insert on bid_addendum_acknowledgments
  for insert to authenticated
  with check (
    vendor_id is not null
    and is_vendor_member(vendor_id)
    and exists (
      select 1 from bid_addenda ba
      join bid_submissions bs on bs.bid_package_id = ba.bid_package_id
      where ba.id = bid_addendum_acknowledgments.bid_addendum_id and bs.vendor_id = bid_addendum_acknowledgments.vendor_id
    )
  );

-- Anti-spoofing, matching every other provenance column in this
-- codebase: the column default alone is not a boundary.
create or replace function public.enforce_bid_addendum_acknowledgment_self() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.acknowledged_by is distinct from auth.uid() then
    raise exception 'bid_addendum_acknowledgments.acknowledged_by must equal the inserting session''s own auth.uid() (%) — got %.',
      auth.uid(), new.acknowledged_by;
  end if;
  return new;
end;
$$;

create trigger bid_addendum_acknowledgments_self
  before insert on bid_addendum_acknowledgments
  for each row execute function public.enforce_bid_addendum_acknowledgment_self();

-- Permanent record — no update, no delete, ever (an acknowledgment is a
-- fact about what happened, never edited or retracted).
create trigger bid_addendum_acknowledgments_no_delete before delete on bid_addendum_acknowledgments
  for each row execute function public.reject_delete();
revoke update, delete on bid_addendum_acknowledgments from authenticated, anon;

create or replace function public.log_audit_via_bid_addendum() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  select get_bid_package_project_id(ba.bid_package_id) into v_project_id
  from bid_addenda ba where ba.id = coalesce(new.bid_addendum_id, old.bid_addendum_id);

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
revoke all on function public.log_audit_via_bid_addendum() from public;

create trigger audit_bid_addendum_acknowledgments after insert on bid_addendum_acknowledgments
  for each row execute function public.log_audit_via_bid_addendum();
