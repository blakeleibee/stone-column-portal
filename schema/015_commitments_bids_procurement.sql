-- =====================================================================
-- Stone Column Portal — Migration 015: commitments, bids (PM-side),
-- procurement & material orders. See docs/production-build/P5-DESIGN.md
-- (Revision 3) for full rationale.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vendor identity: a many-to-many junction, not a single column, so
-- more than one authenticated person can represent one vendor business.
-- Every isolation axis is DB-enforced, not just RLS-shaped. revoked_at/
-- revoked_by (Revision 3) support ending a membership WITHOUT deleting
-- its history — vendor_members_no_delete below still applies.
-- ---------------------------------------------------------------------
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

-- Revision 3: (a) vendor_id/profile_id are immutable after insert — a
-- membership's identity never changes, only its active/revoked state;
-- (b) revoked_by must equal the ACTING session's own auth.uid() at the
-- moment of revocation — the same anti-spoofing rule Decision 8 applies
-- to bid_questions.recorded_by, applied here too; (c) reactivating
-- (revoked_at cleared) also clears revoked_by, so no stale attribution
-- lingers on an active row.
create or replace function public.enforce_vendor_member_identity_and_revocation() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.vendor_id is distinct from old.vendor_id or new.profile_id is distinct from old.profile_id then
    raise exception 'vendor_members.vendor_id/profile_id are immutable after insert (row %) — revoke and reactivate the existing membership instead of reassigning it.', old.id;
  end if;

  if new.revoked_at is distinct from old.revoked_at then
    if new.revoked_at is not null and new.revoked_by is distinct from auth.uid() then
      raise exception 'vendor_members.revoked_by must equal the acting session''s own auth.uid() (%) when revoking — got %.', auth.uid(), new.revoked_by;
    end if;
    if new.revoked_at is null then
      new.revoked_by := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger vendor_members_identity_and_revocation
  before update on vendor_members
  for each row execute function public.enforce_vendor_member_identity_and_revocation();

-- Revision 3: filters to ACTIVE membership. Every RLS policy in this
-- migration that needs "which vendor does this user represent" calls
-- this one function — so this single filter change is what makes
-- "all membership helpers must require active membership" true across
-- every policy at once, with zero other edits required.
create or replace function public.is_vendor_member(p_vendor_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.vendor_members
    where vendor_id = p_vendor_id and profile_id = auth.uid() and revoked_at is null
  );
$$;
revoke all on function public.is_vendor_member(uuid) from public;
grant execute on function public.is_vendor_member(uuid) to authenticated;

create policy vendor_members_staff_full_access on vendor_members
  for all to authenticated
  using (is_org_staff_for_org((select org_id from vendors where id = vendor_members.vendor_id)))
  with check (is_org_staff_for_org((select org_id from vendors where id = vendor_members.vendor_id)));

-- Deliberately does NOT filter on revoked_at — this governs visibility
-- of the historical record ("can I see my own membership rows, even a
-- revoked one"), not active-session authorization (that's what
-- is_vendor_member() gates, everywhere else).
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

create policy bid_packages_vendor_read on bid_packages
  for select to authenticated
  using (
    is_project_vendor(project_id)
    and exists (
      select 1 from bid_submissions bs
      where bs.bid_package_id = bid_packages.id and is_vendor_member(bs.vendor_id)
    )
  );

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

-- Revision 3 hardening: recorded_by's column default alone is NOT a
-- boundary — a caller could still explicitly supply a different value
-- in the insert payload, overriding the default entirely. This trigger
-- is the actual enforcement; the default is kept only for convenience
-- on the ordinary case (an insert that omits recorded_by).
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

create trigger bid_questions_recorded_by_self
  before insert or update on bid_questions
  for each row execute function public.enforce_bid_question_recorded_by_self();

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

-- ---------------------------------------------------------------------
-- Issued documents: an immutable, versioned snapshot created only when
-- a PO/subcontract is actually issued (not on every preview render).
-- canonical_data is metadata (JSON), never the rendered PDF bytes —
-- same "never a blob" philosophy as documents (schema/010).
-- template_version (Revision 3) records which PDF template rendering
-- logic produced canonical_data, so the PDF route can dispatch to the
-- CORRECT historical renderer instead of whatever the template file
-- currently says — this is the mechanism behind "historical template
-- versions remain renderable." Reproduction guaranteed here is
-- content/layout-equivalent, not byte-identical (P5-DESIGN.md
-- Decision 4) — the rendered file itself is still never stored.
-- ---------------------------------------------------------------------
create type issued_document_type as enum ('purchase_order', 'subcontract');

create table issued_documents (
  id               uuid primary key default uuid_generate_v4(),
  document_type    issued_document_type not null,
  source_id        uuid not null, -- material_orders.id or bid_packages.id, per document_type
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
    or new.template_version is distinct from old.template_version
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
-- commit_material_order(): groups line items by their OWN cost_code_id
-- (never the order's optional default) and inserts one committed_costs
-- row per distinct code, all sharing source_id = the order's id — the
-- same multi-row-per-event shape FINANCIAL-ARCHITECTURE.md already
-- documents for change_order. Revision 3: returns TABLE(cost_code_id,
-- committed_cost_id) — the mapping directly — not a bare `setof uuid`
-- a caller would have to re-associate with a second query.
-- ---------------------------------------------------------------------
create or replace function public.commit_material_order(p_material_order_id uuid)
returns table(cost_code_id uuid, committed_cost_id uuid)
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_order material_orders%rowtype;
  v_vendor_name text;
  v_line record;
  v_new_committed_cost_id uuid;
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

  -- v_line.cc/v_line.total_cents are deliberately aliased away from
  -- cost_code_id — this function's RETURNS TABLE makes cost_code_id an
  -- OUT parameter, and assigning it directly from a query alias avoids
  -- any ambiguity with material_order_line_items' own cost_code_id
  -- column of the same name.
  for v_line in
    select mo_li.cost_code_id as cc, sum(mo_li.quantity * mo_li.unit_price_cents)::bigint as total_cents
    from material_order_line_items mo_li
    where mo_li.material_order_id = v_order.id
    group by mo_li.cost_code_id
  loop
    insert into committed_costs (project_id, cost_code_id, vendor_name, amount_cents, source_type, source_id)
    values (v_order.project_id, v_line.cc, v_vendor_name, v_line.total_cents, 'material_order', v_order.id)
    returning id into v_new_committed_cost_id;

    cost_code_id := v_line.cc;
    committed_cost_id := v_new_committed_cost_id;
    return next;
  end loop;

  update material_orders set status = 'ordered', ordered_at = now() where id = v_order.id;

  return;
end;
$$;

revoke all on function public.commit_material_order(uuid) from public;
grant execute on function public.commit_material_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- issue_document(): models supersede_committed_cost()'s exact
-- claim-old/insert-new/link shape. issued_by is ALWAYS auth.uid(),
-- never a caller-supplied parameter, so an issuance record can never be
-- forged to claim a different issuer. Revision 3: takes
-- p_template_version, frozen alongside canonical_data so the PDF route
-- can always resolve the EXACT renderer that produced this snapshot,
-- even after the current template file has moved on to a newer version.
-- ---------------------------------------------------------------------
create or replace function public.issue_document(
  p_document_type issued_document_type,
  p_source_id uuid,
  p_document_number text,
  p_template_version text,
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

  insert into issued_documents (document_type, source_id, document_number, version, template_version, issued_by, canonical_data)
  values (p_document_type, p_source_id, p_document_number, coalesce(v_prior_version, 0) + 1, p_template_version, auth.uid(), p_canonical_data)
  returning id into v_new_id;

  if v_prior_id is not null then
    update issued_documents set superseded_at = now(), superseded_by_id = v_new_id where id = v_prior_id;
  end if;

  return v_new_id;
end;
$$;

revoke all on function public.issue_document(issued_document_type, uuid, text, text, jsonb) from public;
grant execute on function public.issue_document(issued_document_type, uuid, text, text, jsonb) to authenticated;
