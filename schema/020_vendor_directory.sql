-- =====================================================================
-- Stone Column Portal — Migration 020: Vendor Directory & Onboarding
-- (Package P5.1). See docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md
-- Section 5's "P5.1 — Vendor Directory & Onboarding" subsection, Section
-- 9 item 4 (W-9 handling decision), and Section 11 (database/security
-- implications) for full design rationale.
--
-- Scope: extends the existing org-scoped `vendors` table (schema/012)
-- with directory/onboarding fields and a duplicate-merge concept;
-- three new tables (`vendor_contacts`, `vendor_documents`,
-- `vendor_document_access_log`); one new access-control helper
-- (`is_accounting_or_admin_staff_for_org`). No existing table's shape
-- changes beyond the additive `vendors` columns below; no existing RLS
-- policy is weakened. This does not touch schema/015 or schema/016.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Step 1 — vendors: directory/onboarding columns, plus the merge
-- concept. `is_active` deliberately reuses the existing `is_archived`
-- column, inverted, in every reader/UI — no redundant second status
-- column is added here (P5.1 design, "explicitly kept simple").
--
-- `merged_into_vendor_id` implements "duplicate-vendor merge, never
-- rewrite history" (P5.1 design): merging a vendor sets this column on
-- the LOSER to point at the SURVIVOR and archives the loser
-- (`is_archived = true`) — no existing `bid_submissions.vendor_id` /
-- `material_orders.vendor_id` row is ever rewritten. The CHECK
-- constraint below enforces, at the database level (not just in the
-- service layer), that a merged vendor is always archived — an
-- inconsistent "merged but still active" row can never exist even if a
-- future caller writes directly to this table. It intentionally does
-- NOT require the reverse (archived implies merged) — a vendor can be
-- archived for ordinary reasons without ever having been merged.
-- ---------------------------------------------------------------------
alter table vendors
  add column legal_name text,
  add column website text,
  add column trades text[],
  add column service_area text,
  add column preferred_communication_method text,
  add column payment_terms text,
  add column merged_into_vendor_id uuid references vendors(id);

alter table vendors
  add constraint vendors_merged_implies_archived
    check (merged_into_vendor_id is null or is_archived);

-- No-self-merge, no-merge-chains (Judgment call, defense in depth to
-- match this codebase's established pattern of enforcing consequential
-- invariants at the database level, not only in the service layer —
-- see vendor_members' org-match trigger, schema/015 — for exactly this
-- kind of "never trust the client/service layer alone" reasoning): a
-- vendor cannot be merged into itself, and a merge target ("survivor")
-- must not itself already have `merged_into_vendor_id` set — the design
-- explicitly requires resolving to the ultimate survivor in one hop
-- only, never a chain. This trigger only fires when
-- `merged_into_vendor_id` is being newly set or changed (an unrelated
-- update, e.g. editing `notes`, never re-validates it), and skips the
-- check when it's being cleared (unmerge).
create or replace function public.enforce_vendor_merge_no_chain() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_target_org uuid;
  v_target_already_merged uuid;
begin
  if new.merged_into_vendor_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.merged_into_vendor_id is not distinct from old.merged_into_vendor_id then
    return new;
  end if;

  if new.merged_into_vendor_id = new.id then
    raise exception 'A vendor cannot be merged into itself (vendor %).', new.id;
  end if;

  select org_id, merged_into_vendor_id into v_target_org, v_target_already_merged
  from public.vendors where id = new.merged_into_vendor_id;

  if v_target_org is null then
    raise exception 'Merge target vendor % does not exist.', new.merged_into_vendor_id;
  end if;
  if v_target_org is distinct from new.org_id then
    raise exception 'Cannot merge vendor % into vendor % — org mismatch.', new.id, new.merged_into_vendor_id;
  end if;
  if v_target_already_merged is not null then
    raise exception 'Merge target vendor % is itself already merged into vendor % — resolve to the ultimate survivor and merge into that vendor directly instead (no merge chains).',
      new.merged_into_vendor_id, v_target_already_merged;
  end if;

  return new;
end;
$$;

create trigger vendors_merge_no_chain before insert or update on vendors
  for each row execute function public.enforce_vendor_merge_no_chain();

-- ---------------------------------------------------------------------
-- Step 2 — vendor_contacts. Modeled on the *design* already written for
-- project_decision_makers (CLIENT-APPROVAL-MODEL.md) — that table is
-- itself not yet implemented anywhere in this codebase, so this is a
-- proven design pattern (contact-plus-role child table, archived not
-- deleted), not existing code being extended. RLS/audit/delete-block
-- mirror vendor_members' own pattern exactly (schema/015), resolving
-- org_id through the parent vendors row via a subquery, since
-- vendor_contacts carries no org_id column of its own.
-- ---------------------------------------------------------------------
create table vendor_contacts (
  id                          uuid primary key default uuid_generate_v4(),
  vendor_id                   uuid not null references vendors(id) on delete cascade,
  name                        text not null,
  title                       text,
  email                       text,
  phone                       text,
  is_primary_bidding_contact  boolean not null default false,
  notes                       text,
  is_archived                 boolean not null default false,
  created_by                  uuid references profiles(id),
  created_at                  timestamptz not null default now()
);

alter table vendor_contacts enable row level security;

create policy vendor_contacts_staff_only on vendor_contacts
  for all to authenticated
  using (is_org_staff_for_org((select org_id from vendors where id = vendor_contacts.vendor_id)))
  with check (is_org_staff_for_org((select org_id from vendors where id = vendor_contacts.vendor_id)));

create trigger audit_vendor_contacts after insert or update or delete on vendor_contacts
  for each row execute function public.log_audit_no_project();

create trigger vendor_contacts_no_delete before delete on vendor_contacts
  for each row execute function public.reject_delete();
revoke delete on vendor_contacts from authenticated, anon;

create policy audit_log_vendor_contacts_staff_select on audit_log
  for select to authenticated
  using (
    table_name = 'vendor_contacts'
    and exists (
      select 1 from vendor_contacts vc
      join vendors v on v.id = vc.vendor_id
      where vc.id = audit_log.record_id and is_org_staff_for_org(v.org_id)
    )
  );

-- ---------------------------------------------------------------------
-- Step 3 — staff_function-based accounting/admin gate. staff_function
-- already carries an 'accounting' enum value (schema/016) — no enum
-- change needed. Mirrors is_financial_staff(p_project_id)'s exact style
-- (schema/016 lines 273-282) but org-scoped via is_org_staff_for_org()
-- instead of project-scoped via is_org_staff(), and restricted to
-- role='admin' OR staff_function='accounting' specifically (a NARROWER
-- audience than is_financial_staff's "everyone except superintendent").
-- ---------------------------------------------------------------------
create or replace function public.is_accounting_or_admin_staff_for_org(p_org_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_org_staff_for_org(p_org_id)
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and org_id = p_org_id
        and (role = 'admin' or staff_function = 'accounting')
    );
$$;

revoke all on function public.is_accounting_or_admin_staff_for_org(uuid) from public;
grant execute on function public.is_accounting_or_admin_staff_for_org(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Step 4 — vendor_documents. Absorbs the entirety of P11's originally-
-- named `vendor_compliance` table (P5-EXTENSION-PACKAGES-DESIGN.md
-- Section 4). `status` is a real, explicit, staff-set field — NOT
-- derived from whether `storage_key` is populated — because "received"
-- (a file was uploaded) and "verified" (a human confirmed it's actually
-- valid/current) are meaningfully different states. `org_id` is carried
-- directly (not resolved solely via vendor_id -> vendors.org_id) so the
-- W-9 RLS policy below can be written as a direct column check without
-- a correlated subquery on every row; the org-match trigger further
-- down keeps this redundant column from ever drifting out of sync with
-- its parent vendor's own org_id.
--
-- W-9 documents get materially stricter handling than COI/license, per
-- the owner's explicit decision (P5-EXTENSION-PACKAGES-DESIGN.md
-- Section 9 item 4): SELECT/INSERT/UPDATE on a category='w9' row
-- requires is_accounting_or_admin_staff_for_org(); every other category
-- stays on the ordinary org-wide staff policy. Structured as ONE policy
-- per action with a category-conditional predicate (brief's own
-- "whichever is cleaner" call) rather than two separate policies, since
-- Postgres combines multiple permissive policies for the same command
-- with OR, which would make an accidental second permissive w9 grant
-- easy to introduce later without noticing; one predicate makes the
-- w9 gate impossible to silently bypass via an additive policy.
-- ---------------------------------------------------------------------
create table vendor_documents (
  id                      uuid primary key default uuid_generate_v4(),
  vendor_id               uuid not null references vendors(id) on delete cascade,
  org_id                  uuid not null references orgs(id) on delete cascade,
  category                text not null check (category in ('w9', 'certificate_of_insurance', 'license', 'other')),
  status                  text not null default 'missing' check (status in ('missing', 'requested', 'received', 'verified', 'expired', 'not_applicable')),
  expiration_date         date,
  storage_key             text,
  mime_type               text,
  size_bytes              bigint,
  version                 integer not null default 1,
  superseded_by_id        uuid references vendor_documents(id),
  excluded_from_indexing  boolean not null default true,
  uploaded_by             uuid references profiles(id),
  created_at              timestamptz not null default now()
);

alter table vendor_documents enable row level security;

-- Judgment call (defense in depth, matching vendor_members'
-- org-match trigger precedent): vendor_documents.org_id is a redundant
-- column (also derivable via vendor_id -> vendors.org_id), added per
-- the brief's exact column list specifically so the W-9 RLS policy
-- below can check org_id directly. A redundant column that can drift
-- from its source of truth is worse than not having it at all, so this
-- trigger keeps it pinned to vendor_id's actual owning org on every
-- insert/update.
create or replace function public.enforce_vendor_document_org_match() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_vendor_org uuid;
begin
  select org_id into v_vendor_org from public.vendors where id = new.vendor_id;
  if v_vendor_org is distinct from new.org_id then
    raise exception 'vendor_documents.org_id (%) does not match vendor %''s own org (%) — org_id must always mirror vendor_id''s owning org.',
      new.org_id, new.vendor_id, v_vendor_org;
  end if;
  return new;
end;
$$;

create trigger vendor_documents_org_match before insert or update on vendor_documents
  for each row execute function public.enforce_vendor_document_org_match();

create policy vendor_documents_category_gated on vendor_documents
  for all to authenticated
  using (
    (category <> 'w9' and is_org_staff_for_org(org_id))
    or (category = 'w9' and is_accounting_or_admin_staff_for_org(org_id))
  )
  with check (
    (category <> 'w9' and is_org_staff_for_org(org_id))
    or (category = 'w9' and is_accounting_or_admin_staff_for_org(org_id))
  );

create trigger audit_vendor_documents after insert or update or delete on vendor_documents
  for each row execute function public.log_audit_no_project();

create trigger vendor_documents_no_delete before delete on vendor_documents
  for each row execute function public.reject_delete();
revoke delete on vendor_documents from authenticated, anon;

create policy audit_log_vendor_documents_staff_select on audit_log
  for select to authenticated
  using (
    table_name = 'vendor_documents'
    and exists (
      select 1 from vendor_documents vd
      where vd.id = audit_log.record_id
        and (
          (vd.category <> 'w9' and is_org_staff_for_org(vd.org_id))
          or (vd.category = 'w9' and is_accounting_or_admin_staff_for_org(vd.org_id))
        )
    )
  );

-- ---------------------------------------------------------------------
-- Step 5 — vendor_document_access_log. New pattern this codebase
-- doesn't have yet: log_audit_no_project() only fires on
-- insert/update/delete, and a W-9 *download* is a read. This table is
-- written by an explicit, separate service-layer call at the moment a
-- signed download URL is issued for a category='w9' document (never a
-- trigger — there is no DB-level "row was read" event to hang one off
-- of). SELECT is restricted to the same accounting/admin audience W-9
-- documents themselves require (only that audience should be able to
-- review who accessed what). No delete-block trigger needed — an
-- RLS-enabled table with no delete policy at all is already
-- undeletable by authenticated/anon by default; adding a reject_delete
-- trigger here would be a redundant no-op, not extra protection.
-- ---------------------------------------------------------------------
create table vendor_document_access_log (
  id                    uuid primary key default uuid_generate_v4(),
  vendor_document_id    uuid not null references vendor_documents(id),
  accessed_by           uuid not null references profiles(id),
  accessed_at           timestamptz not null default now(),
  action                text not null default 'downloaded'
);

alter table vendor_document_access_log enable row level security;

create policy vendor_document_access_log_staff_select on vendor_document_access_log
  for select to authenticated
  using (
    is_accounting_or_admin_staff_for_org(
      (select org_id from vendor_documents where id = vendor_document_access_log.vendor_document_id)
    )
  );

-- INSERT: any org staff member may write a row, but ONLY attributed to
-- themselves — matches the material_orders/vendor_documents-adjacent
-- "at least org staff" baseline while the anti-spoofing trigger below
-- (mirroring vendor_members.revoked_by / bid_questions.recorded_by,
-- schema/015) provides the same defense-in-depth this codebase already
-- established for actor-provenance columns: RLS's WITH CHECK alone is
-- not trusted as the only enforcement layer.
create policy vendor_document_access_log_self_insert on vendor_document_access_log
  for insert to authenticated
  with check (
    accessed_by = auth.uid()
    and is_org_staff_for_org(
      (select org_id from vendor_documents where id = vendor_document_access_log.vendor_document_id)
    )
  );

create or replace function public.enforce_vendor_document_access_log_self() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.accessed_by is distinct from auth.uid() then
    raise exception 'vendor_document_access_log.accessed_by must equal the inserting session''s own auth.uid() (%) — got %. Access is logged automatically by the download service function, never written directly.',
      auth.uid(), new.accessed_by;
  end if;
  return new;
end;
$$;

create trigger vendor_document_access_log_self_insert_trigger
  before insert on vendor_document_access_log
  for each row execute function public.enforce_vendor_document_access_log_self();
