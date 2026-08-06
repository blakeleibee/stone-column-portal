-- =====================================================================
-- Stone Column Portal — Migration 010: document metadata.
--
-- Metadata only, per TARGET-ARCHITECTURE.md §8 -- storage_key points at
-- wherever the actual file bytes live (local filesystem in dev, a
-- future OneDrive/SharePoint item id in production), never a blob in
-- this table. is_published_to_client mirrors expenses'
-- financial_status/publication_status split: staff always see
-- everything; a client sees a row only once explicitly published.
-- No vendor policy yet, matching the "each package adds its own
-- narrowly scoped vendor policy when it genuinely needs one" rule from
-- TARGET-ARCHITECTURE.md §3 -- vendors get zero documents rows for now.
-- =====================================================================

create table documents (
  id                     uuid primary key default uuid_generate_v4(),
  project_id             uuid not null references projects(id) on delete cascade,
  uploaded_by            uuid references profiles(id),
  file_name              text not null,
  mime_type              text not null,
  size_bytes             bigint not null,
  category               text,
  storage_key            text not null,
  is_published_to_client boolean not null default false,
  created_at             timestamptz not null default now(),

  constraint documents_size_nonnegative check (size_bytes >= 0)
);

alter table documents enable row level security;

create policy documents_staff_full_access on documents
  for all to authenticated
  using (is_org_staff(project_id)) with check (is_org_staff(project_id));

create policy documents_client_read on documents
  for select to authenticated
  using (is_project_client(project_id) and is_published_to_client);

create trigger audit_documents after insert or update or delete on documents
  for each row execute function public.log_audit();
