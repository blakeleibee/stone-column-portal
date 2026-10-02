-- =====================================================================
-- Stone Column Portal — Migration 025: P5.2 Phase B — bid package
-- document control. See docs/production-build/P5-EXTENSION-PACKAGES-
-- DESIGN.md, Section 5, "P5.2" Part C. Extends the existing, currently
-- fully unused `documents` metadata table (schema/010) and adds a new
-- join table (`bid_package_documents`) linking specific document
-- VERSIONS to a bid package — never "whichever is latest."
--
-- =====================================================================
-- documents: versioning columns, additive only. schema/010 itself is
-- left completely untouched (this repo's standing rule: never edit an
-- already-applied migration file). Mirrors issued_documents' own
-- proven version/superseded_by_id shape (schema/015) and
-- vendor_documents' identical pair (schema/020) — the third table in
-- this codebase to use this exact pattern, not a new one being trusted
-- for the first time. No backfill needed: every existing row simply
-- starts at version=1 with no prior version, which is already correct
-- (nothing before this migration ever created a second version of a
-- document).
-- =====================================================================
alter table documents
  add column version integer not null default 1,
  add column superseded_by_id uuid references documents(id);

-- =====================================================================
-- bid_package_documents: the join table. document_id is pinned to one
-- immutable document VERSION (enforced below by a trigger, not just
-- convention) — publishing a bid package therefore snapshots exactly
-- which document versions were included BY CONSTRUCTION: a later
-- re-upload always creates a brand-new `documents` row (a new id, a
-- new version number) and a brand-new `bid_package_documents` row to
-- link it; no existing bid_package_documents row is ever repointed at
-- a different document_id. An already-published package's document
-- links can therefore never change out from under it without a new,
-- separate, visible action (linking the new version, exactly matching
-- the "versioned addenda, not silent replacement" instruction) — no
-- separate "published snapshot" table is needed; the join table's own
-- shape already IS the snapshot mechanism.
--
-- category expresses the owner's own named organization scheme
-- ("plans, specifications, scope documents, photos, addenda, and other
-- reference material") as a plain CHECK-constrained vocabulary — this
-- codebase's only existing precedent for a document taxonomy
-- (vendor_documents.category, schema/020) is the same shape (a
-- text CHECK, not an enum type), matched here for consistency.
-- =====================================================================
create table bid_package_documents (
  id             uuid primary key default uuid_generate_v4(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  document_id    uuid not null references documents(id),
  internal_only  boolean not null default false,
  category       text not null default 'reference'
    check (category in ('plans', 'specifications', 'scope', 'photos', 'addenda', 'reference', 'other')),
  created_by     uuid references profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),

  constraint bid_package_documents_unique_link unique (bid_package_id, document_id)
);

alter table bid_package_documents enable row level security;

create policy bid_package_documents_staff_full_access on bid_package_documents
  for all to authenticated
  using (is_org_staff(get_bid_package_project_id(bid_package_documents.bid_package_id)))
  with check (is_org_staff(get_bid_package_project_id(bid_package_documents.bid_package_id)));

-- Vendor read: double-gated exactly like every other vendor-visible row
-- in this domain (bid_packages/bid_submissions/bid_addenda/
-- bid_questions) — invited to THIS package (is_invited_vendor_for_
-- bid_package, the self-sufficient helper schema/022 already proved
-- correct) AND the link itself is not internal_only. Never a blanket
-- project-wide document grant.
create policy bid_package_documents_vendor_read on bid_package_documents
  for select to authenticated
  using (
    not bid_package_documents.internal_only
    and is_invited_vendor_for_bid_package(bid_package_documents.bid_package_id)
  );

-- Integrity trigger, combining two invariants this codebase always
-- backs with a real trigger rather than relying on RLS/service-layer
-- discipline alone (see e.g. vendor_members' identity/revocation
-- trigger, bid_addenda/bid_questions' issued_by/recorded_by triggers):
-- (1) bid_package_id/document_id are immutable after insert — this IS
-- the "published snapshot" guarantee at the database level, not merely
-- a convention the service layer is trusted to honor; (2) created_by
-- must equal the inserting session's own auth.uid() and never changes
-- after insert — the column default alone is not a boundary, exactly
-- like every other provenance column in this codebase.
create or replace function public.enforce_bid_package_document_integrity() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is distinct from auth.uid() then
      raise exception 'bid_package_documents.created_by must equal the inserting session''s own auth.uid() (%) — got %.',
        auth.uid(), new.created_by;
    end if;
    return new;
  end if;

  if new.bid_package_id is distinct from old.bid_package_id or new.document_id is distinct from old.document_id then
    raise exception 'bid_package_documents.bid_package_id/document_id are immutable after insert (row %) — link a NEW document version by inserting a new bid_package_documents row instead of repointing this one; this is what makes an already-published package''s document links a permanent snapshot.',
      old.id;
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'bid_package_documents.created_by is immutable after insert (row %) — provenance is set once, never reassigned.', old.id;
  end if;
  return new;
end;
$$;

create trigger bid_package_documents_integrity
  before insert or update on bid_package_documents
  for each row execute function public.enforce_bid_package_document_integrity();

-- Archive/supersede, never delete — matching every other permanent
-- record in this domain (documents/messages/invitation history,
-- Section 11 of the design doc).
create trigger bid_package_documents_no_delete before delete on bid_package_documents
  for each row execute function public.reject_delete();
revoke delete on bid_package_documents from authenticated, anon;

-- log_audit_via_bid_package() (schema/015) already resolves project_id
-- from a `bid_package_id` column on the triggering row — this table
-- has one, so it is reused directly, unmodified.
create trigger audit_bid_package_documents after insert or update on bid_package_documents
  for each row execute function public.log_audit_via_bid_package();

create policy audit_log_bid_package_documents_staff_select on audit_log
  for select to authenticated
  using (
    table_name = 'bid_package_documents'
    and exists (
      select 1 from bid_package_documents bpd
      where bpd.id = audit_log.record_id and is_org_staff(get_bid_package_project_id(bpd.bid_package_id))
    )
  );

-- =====================================================================
-- documents: new, narrowly scoped vendor read policy. Without this, a
-- vendor session could read a bid_package_documents join row (via the
-- policy above) but still get nothing back for the underlying
-- `documents` row itself (file_name/storage_key/mime_type) — documents'
-- only existing policies are staff-full-access and client-read
-- (schema/010), neither of which ever applies to a vendor role. Scoped
-- identically to the join policy above: a documents row is vendor-
-- readable only via a non-internal-only link to a bid package that
-- vendor is actually invited to — never blanket project-document
-- access, matching this codebase's own established double-gate
-- philosophy for this whole domain.
--
-- (Judgment call, matching schema/022's own precedent: this uses
-- is_invited_vendor_for_bid_package() alone, the now-proven
-- self-sufficient check, rather than an is_project_vendor() AND
-- pairing the design doc's own earlier draft text suggested — schema/
-- 022 already found and fixed that exact redundant/broken pairing for
-- bid_packages_vendor_read, so this policy is written the corrected
-- way from the start rather than reintroducing the same defect.)
-- =====================================================================
create policy documents_vendor_read_via_bid_package on documents
  for select to authenticated
  using (
    exists (
      select 1 from bid_package_documents bpd
      where bpd.document_id = documents.id
        and not bpd.internal_only
        and is_invited_vendor_for_bid_package(bpd.bid_package_id)
    )
  );
