-- =====================================================================
-- Stone Column Portal — Migration 028: P5.2 Phase D — bid package
-- correspondence, real email invitations, and inbound-email routing.
-- See docs/production-build/P5-EXTENSION-PACKAGES-DESIGN.md, Section 5,
-- "P5.2" Part D/E. Phases A (022-023), B (024-025), C (026-027) are
-- closed and untouched here.
--
-- =====================================================================
-- SCOPE/SHAPE DECISION: entity_messages is bid-package-specific here,
-- NOT the design doc's originally-sketched generic entity_type/
-- entity_id table meant to also cover P5.3 material orders later.
-- Reasons:
--  1. This phase's explicit scope is P5.2 only — P5.3 (material order
--     collaboration) is out of bounds; building a generic table now
--     would be exactly the kind of "build ahead of real usage"
--     speculation this codebase's own design doc (Section 6, item 2)
--     repeatedly rejects elsewhere.
--  2. It is not even a deviation from an established convention: this
--     codebase's OWN precedent for "the same conceptual feature, two
--     different parent entities" is TWO PARALLEL TABLES, not one
--     generic one — bid_package_documents (schema/025) and the design
--     doc's own future material_order_documents are explicitly
--     described as "same shape as bid_package_documents," a sibling
--     table, never a shared one. entity_messages here follows that
--     exact, already-chosen shape.
--  3. If/when P5.3 needs vendor correspondence on material orders, that
--     package's own migration can decide fresh whether to widen this
--     table (entity_type/entity_id + nullable bid_package_id) or add a
--     sibling `material_order_messages` — a real design choice for that
--     package's own author to make with that package's actual
--     requirements in hand, not pre-guessed here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- entity_messages: the permanent, append-only correspondence log for a
-- bid package + vendor pair. Deliberately INSERT + SELECT only, no
-- UPDATE ever (see below) — matches this codebase's own established
-- "a correction is a new row, never a silent overwrite" non-negotiable,
-- and is possible here specifically because every field this table
-- carries is fully known at insert time: an outbound send's delivery
-- outcome is resolved SYNCHRONOUSLY from EmailService.send()'s own
-- return value before the row is ever written (see
-- packages/02-app-shell/src/services/email/), so there is no
-- "insert now, patch delivery_status later" step that would need
-- UPDATE. A future async delivery-status webhook (bounce/complaint
-- events — NOT built in this phase, which only implements the
-- email.received inbound path) would need its own migration to add an
-- update path; that is a known, explicitly flagged limitation, not an
-- oversight.
-- ---------------------------------------------------------------------
create table entity_messages (
  id                   uuid primary key default uuid_generate_v4(),
  bid_package_id       uuid not null references bid_packages(id) on delete cascade,
  vendor_id            uuid not null references vendors(id),
  direction            text not null check (direction in ('outbound', 'inbound')),
  -- sender/recipient are free-text email-address-shaped strings, not
  -- FKs — an outbound message's sender is often a generic notification
  -- address (see EmailService's own FROM_ADDRESS), and an inbound
  -- message's sender is whatever arrived on the wire (verified against
  -- the vendor's on-file email during ingestion, but stored as the
  -- literal string that arrived, for an honest record of what was
  -- actually received).
  sender               text not null,
  recipient            text not null,
  subject              text,
  body                 text not null,
  sent_at              timestamptz,
  received_at          timestamptz,
  delivery_status      text
    check (delivery_status in ('pending', 'sent', 'delivered', 'bounced', 'failed', 'pending_provider_configuration')),
  -- Resend's own id once a real send/receive happens through it. Unique
  -- (nullable) so it can double as the webhook's own idempotency key
  -- (see enforce_entity_message_provenance below and the Route
  -- Handler): a redelivered webhook whose event id already exists here
  -- is a real, cheap, DB-enforced no-op, never a duplicate thread entry.
  provider_message_id  text unique,
  -- Staff identity for a staff-authored row; NULL for a vendor-authored
  -- (portal or inbound-email) row or a system/webhook insert — enforced
  -- below, never merely a default.
  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now(),

  constraint entity_messages_direction_timestamps check (
    (direction = 'outbound' and received_at is null)
    or (direction = 'inbound' and sent_at is null)
  )
);

alter table entity_messages enable row level security;

-- Financial-staff only (not merely is_org_staff) — matches this exact
-- domain's own already-corrected precedent: bid_questions/bid_addenda
-- (schema/016) were both upgraded from is_org_staff to is_financial_staff
-- specifically because this kind of vendor correspondence can carry
-- pricing discussion, and entity_messages is the newest, most general
-- member of that same correspondence family.
create policy entity_messages_staff_full_access on entity_messages
  for all to authenticated
  using (is_financial_staff(get_bid_package_project_id(entity_messages.bid_package_id)))
  with check (is_financial_staff(get_bid_package_project_id(entity_messages.bid_package_id)));

-- Vendor read: THE OWNERSHIP-SCOPING FIX this migration exists to get
-- right. Gates on is_vendor_member(entity_messages.vendor_id) — i.e.
-- "is the calling vendor session actually a member of THIS ROW'S OWN
-- vendor_id" — never merely is_invited_vendor_for_bid_package(bid_
-- package_id) alone. The latter only proves "the calling vendor is
-- invited to SOME vendor slot on this package" (it is a package-level
-- EXISTS across bid_submissions, not a check against a specific row's
-- vendor_id) — insufficient by itself whenever the table itself carries
-- a specific vendor_id, exactly the scenario the P5.2 Phase D brief
-- calls out from Phase C's review: two vendors invited to the SAME
-- package would BOTH pass is_invited_vendor_for_bid_package(bid_
-- package_id) for the same package, so using it alone here would let
-- vendor B read vendor A's private thread. is_vendor_member(vendor_id)
-- is this codebase's own already-proven correct pattern for exactly
-- this "is this MY row" shape (see bid_submission_revisions_vendor_read,
-- schema/026, which uses the identical direct-ownership check rather
-- than a package-level EXISTS).
create policy entity_messages_vendor_read on entity_messages
  for select to authenticated
  using (
    vendor_id is not null
    and is_vendor_member(entity_messages.vendor_id)
  );

-- Vendor insert: a vendor composing a portal message is always,
-- structurally, an 'inbound' message (from Stone Column's perspective,
-- correspondence FROM the vendor) with created_by forced null (provenance
-- tracks staff authorship only — see the trigger below) — a vendor
-- session cannot masquerade as staff or as an 'outbound' send. The EXISTS
-- re-derives real invitation status directly (never trusts vendor_id/
-- bid_package_id pairing alone), matching bid_questions_vendor_insert's/
-- bid_addendum_acknowledgments_vendor_insert's own established shape.
create policy entity_messages_vendor_insert on entity_messages
  for insert to authenticated
  with check (
    vendor_id is not null
    and is_vendor_member(entity_messages.vendor_id)
    and direction = 'inbound'
    and created_by is null
    and exists (
      select 1 from bid_submissions bs
      where bs.bid_package_id = entity_messages.bid_package_id and bs.vendor_id = entity_messages.vendor_id
    )
  );

-- Provenance/identity enforcement, mirroring this codebase's own
-- established "the column default alone is not a boundary" rule for
-- every other created_by/recorded_by/issued_by column in this domain.
-- Three real actors write this table: a staff session (created_by must
-- equal auth.uid()), a vendor session (created_by must be null — RLS's
-- own WITH CHECK above already requires this, re-verified here in
-- defense in depth), and the inbound-webhook's service-role client
-- (auth.uid() is null — no session at all — created_by must be null).
create or replace function public.enforce_entity_message_provenance() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_staff boolean;
begin
  if auth.uid() is null then
    if new.created_by is not null then
      raise exception 'entity_messages.created_by must be null for a system-inserted (service-role, no session) row.';
    end if;
    return new;
  end if;

  v_is_staff := is_financial_staff(get_bid_package_project_id(new.bid_package_id));
  if v_is_staff then
    if new.created_by is distinct from auth.uid() then
      raise exception 'entity_messages.created_by must equal the inserting staff session''s own auth.uid() (%) — got %.',
        auth.uid(), new.created_by;
    end if;
  else
    if new.created_by is not null then
      raise exception 'entity_messages.created_by must be null for a vendor-authored row.';
    end if;
  end if;
  return new;
end;
$$;

create trigger entity_messages_provenance
  before insert on entity_messages
  for each row execute function public.enforce_entity_message_provenance();

-- Permanent, append-only record — no update, no delete, ever (see this
-- table's own header comment for why no update path is needed).
create trigger entity_messages_no_delete before delete on entity_messages
  for each row execute function public.reject_delete();
revoke update, delete on entity_messages from authenticated, anon;

create trigger audit_entity_messages after insert on entity_messages
  for each row execute function public.log_audit_via_bid_package();

-- ---------------------------------------------------------------------
-- entity_message_attachments: a message's attachments, reusing the
-- existing `documents` metadata table exactly like bid_package_documents
-- does — never a new file-storage mechanism. No versioning concept here
-- (unlike bid_package_documents): a message attachment is never
-- "replaced," only ever sent again as a new message with a new
-- attachment, so a plain one-document-per-row join (no superseded_by
-- chain) is the correct, simplest shape.
-- ---------------------------------------------------------------------
create table entity_message_attachments (
  id                uuid primary key default uuid_generate_v4(),
  entity_message_id uuid not null references entity_messages(id) on delete cascade,
  document_id       uuid not null references documents(id),
  created_at        timestamptz not null default now(),

  constraint entity_message_attachments_unique_link unique (entity_message_id, document_id)
);

alter table entity_message_attachments enable row level security;

create policy entity_message_attachments_staff_full_access on entity_message_attachments
  for all to authenticated
  using (
    exists (
      select 1 from entity_messages em
      where em.id = entity_message_attachments.entity_message_id
        and is_financial_staff(get_bid_package_project_id(em.bid_package_id))
    )
  )
  with check (
    exists (
      select 1 from entity_messages em
      where em.id = entity_message_attachments.entity_message_id
        and is_financial_staff(get_bid_package_project_id(em.bid_package_id))
    )
  );

-- Vendor read/insert: scoped through the OWNING message's own vendor_id
-- — the identical direct-ownership check as entity_messages itself
-- (is_vendor_member(em.vendor_id), never is_invited_vendor_for_bid_
-- package alone), so an attachment can never be visible to a vendor who
-- couldn't already see the message it belongs to.
create policy entity_message_attachments_vendor_read on entity_message_attachments
  for select to authenticated
  using (
    exists (
      select 1 from entity_messages em
      where em.id = entity_message_attachments.entity_message_id
        and em.vendor_id is not null
        and is_vendor_member(em.vendor_id)
    )
  );

-- Schema-ready for a future vendor-attaches-a-file UI (not wired to any
-- screen in this phase — see this package's report for the explicit
-- scope trim: the vendor-facing compose box ships text-only). Kept here
-- because it costs nothing extra to get right now and closes the same
-- ownership gap the read policy above closes, rather than leaving a
-- known future gap for whoever wires the UI up later to rediscover.
create policy entity_message_attachments_vendor_insert on entity_message_attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from entity_messages em
      where em.id = entity_message_attachments.entity_message_id
        and em.vendor_id is not null
        and is_vendor_member(em.vendor_id)
        and em.created_by is null
    )
  );

create trigger entity_message_attachments_no_delete before delete on entity_message_attachments
  for each row execute function public.reject_delete();
revoke update, delete on entity_message_attachments from authenticated, anon;

-- =====================================================================
-- documents: new vendor INSERT + narrowly-scoped read policy for
-- message attachments — the FIRST vendor-facing document upload path in
-- this codebase (bid_package_documents' vendor policy, schema/025, is
-- staff-upload/vendor-READ only). uploaded_by is forced to the inserting
-- vendor session's own auth.uid() (a real profiles row exists for every
-- vendor session via vendor_members, unlike the design doc's more
-- general "vendor without a portal profile" case, which does not apply
-- to THIS codebase's vendor-access model at all) — a real boundary via
-- WITH CHECK, not merely a column default.
--
-- Scoped via bid_packages/is_invited_vendor_for_bid_package (package-
-- level "is this vendor invited to something on this project," the
-- correct check HERE because documents rows carry no vendor_id of their
-- own to check ownership against — the REAL per-vendor gate is enforced
-- one step later, when the document is linked via a specific
-- entity_message row through entity_message_attachments, exactly
-- mirroring how bid_package_documents_vendor_read's double-gate already
-- works: package-level invitation for the parent, link-level specificity
-- for the actual visibility grant).
-- =====================================================================
create policy documents_vendor_insert_via_bid_package on documents
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from bid_packages bp
      where bp.project_id = documents.project_id and is_invited_vendor_for_bid_package(bp.id)
    )
  );

create policy documents_vendor_read_via_entity_message on documents
  for select to authenticated
  using (
    exists (
      select 1 from entity_message_attachments ema
      join entity_messages em on em.id = ema.entity_message_id
      where ema.document_id = documents.id
        and em.vendor_id is not null
        and is_vendor_member(em.vendor_id)
    )
  );

-- =====================================================================
-- inbound_reply_tokens: one dedicated, opaque, unguessable token per
-- (bid_package, vendor) pair — set at invite time, reused for every
-- outbound notification on that thread (invitation, staff message,
-- addendum), per the design doc's own Part E. Deliberately ONE token
-- per pair, not per-message: the design doc itself specifies this shape
-- ("Every vendor+package pairing gets one dedicated ... reply address
-- at invite time"), and a per-message token would add real complexity
-- (which message's token is "current" for Reply-To purposes when a
-- vendor replies to an OLD email in the thread — a real, common email-
-- client behavior) for no real security benefit: the actual replay/
-- reuse defense is NOT the token's scope (per-pair vs. per-message) but
-- the SECOND independent factor layered on top of it at resolution time
-- — sender-email verification (see the webhook Route Handler) — so a
-- leaked/guessed token alone still cannot inject a message unless it
-- also comes from the vendor's own on-file address. Revocation is
-- re-derived live (via is_vendor_member/vendor_members.revoked_at at
-- resolution time), never by needing to remember to also flip this
-- row's own revoked_at — the SAME "access is computed live, no second
-- write path to keep in sync" philosophy schema/022 already established
-- for is_invited_vendor_for_bid_package(). revoked_at still exists here
-- for the one case that genuinely IS this row's own concern: a staff
-- member deliberately invalidating a specific reply address (e.g. a
-- leaked token) without touching the vendor's actual membership at all.
-- =====================================================================
create table inbound_reply_tokens (
  id             uuid primary key default uuid_generate_v4(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  vendor_id      uuid not null references vendors(id),
  token          text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,

  constraint inbound_reply_tokens_unique_pair unique (bid_package_id, vendor_id)
);

alter table inbound_reply_tokens enable row level security;

-- Staff-manage only — never directly readable/writable by a vendor
-- session (matching bid_vendor_access_invitations' own posture,
-- schema/022): a vendor never needs to read its own token row (the
-- token is embedded directly in the emails they receive), and letting a
-- vendor session read this table at all would trivially leak other
-- vendors' tokens absent very careful additional scoping this table has
-- no other reason to carry.
create policy inbound_reply_tokens_staff_manage on inbound_reply_tokens
  for all to authenticated
  using (is_financial_staff(get_bid_package_project_id(inbound_reply_tokens.bid_package_id)))
  with check (is_financial_staff(get_bid_package_project_id(inbound_reply_tokens.bid_package_id)));

create trigger inbound_reply_tokens_no_delete before delete on inbound_reply_tokens
  for each row execute function public.reject_delete();
revoke delete on inbound_reply_tokens from authenticated, anon;

create trigger audit_inbound_reply_tokens after insert or update on inbound_reply_tokens
  for each row execute function public.log_audit_via_bid_package();

-- =====================================================================
-- quarantined_inbound_messages: staff-visible review queue for anything
-- the inbound webhook cannot safely route automatically. Deliberately
-- carries its OWN best-effort org_id/bid_package_id/vendor_id (all
-- nullable) rather than assuming these are always resolvable — the
-- entire point of several quarantine reasons (unmatched_token,
-- signature_invalid, malformed_payload) is that we genuinely do NOT
-- know which org/package/vendor this concerns yet.
--
-- RLS judgment call, stated plainly: a row with org_id IS NULL (fully
-- unattributable) is visible to ANY staff session at ANY org, not
-- narrowed further — there is no narrower fact available to narrow it
-- by. In a genuinely multi-org deployment of this platform this is a
-- real, deliberate cross-org visibility exception; it is accepted here
-- because (a) the current deployment has exactly one operating org
-- (Stone Column) end to end, and (b) the alternative — making a wholly-
-- unattributable inbound message invisible to every staff session
-- everywhere — is strictly worse (a message requiring human review
-- would simply never be reviewed by anyone). A row WITH a resolved
-- org_id is scoped normally, exactly like everything else in this
-- schema.
-- =====================================================================
create table quarantined_inbound_messages (
  id                   uuid primary key default uuid_generate_v4(),
  reason               text not null
    check (reason in ('unmatched_token', 'revoked_vendor', 'sender_mismatch', 'signature_invalid', 'malformed_payload')),
  raw_payload          jsonb not null,
  org_id               uuid references orgs(id),
  bid_package_id       uuid references bid_packages(id),
  vendor_id            uuid references vendors(id),
  reviewed_by          uuid references profiles(id),
  reviewed_at          timestamptz,
  resolution           text check (resolution in ('promoted', 'discarded')),
  promoted_message_id  uuid references entity_messages(id),
  received_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),

  constraint quarantined_inbound_messages_resolution_pairing check (
    (resolution is null and reviewed_by is null and reviewed_at is null and promoted_message_id is null)
    or (resolution = 'discarded' and reviewed_by is not null and reviewed_at is not null and promoted_message_id is null)
    or (resolution = 'promoted' and reviewed_by is not null and reviewed_at is not null and promoted_message_id is not null)
  )
);

alter table quarantined_inbound_messages enable row level security;

-- is_any_staff(): a genuinely NEW helper (every other is_*_staff*
-- function in this schema takes a project/org id to scope against) —
-- needed here specifically because a fully-unattributable quarantine
-- row (org_id null) has no org to scope against at all, yet must still
-- be staff-only, never vendor/client-visible. Found and fixed during
-- this migration's own SQL test pass: an earlier draft of the policy
-- below (`org_id is null or is_org_staff_for_org(org_id)`) let the null
-- branch through for ANY authenticated role, including vendor —
-- `org_id is null` alone says nothing about who is asking. This helper
-- closes that gap by requiring "is staff at SOME org" instead of "org_id
-- happens to be null."
create or replace function public.is_any_staff() returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'staff') and is_active
  );
$$;
revoke all on function public.is_any_staff() from public;
grant execute on function public.is_any_staff() to authenticated;

create policy quarantined_inbound_messages_staff_manage on quarantined_inbound_messages
  for all to authenticated
  using (
    case when org_id is null then is_any_staff() else is_org_staff_for_org(quarantined_inbound_messages.org_id) end
  )
  with check (
    case when org_id is null then is_any_staff() else is_org_staff_for_org(quarantined_inbound_messages.org_id) end
  );

-- Review provenance — the same "column default is not a boundary" rule
-- as everywhere else, applied to reviewed_by specifically (resolution/
-- reviewed_at are also staff-supplied but have no spoofing concern of
-- their own the way "who reviewed this" does).
create or replace function public.enforce_quarantined_inbound_message_review_self() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.reviewed_by is not null and new.reviewed_by is distinct from auth.uid() then
    raise exception 'quarantined_inbound_messages.reviewed_by must equal the inserting/updating session''s own auth.uid() (%) — got %.',
      auth.uid(), new.reviewed_by;
  end if;
  return new;
end;
$$;

create trigger quarantined_inbound_messages_review_self
  before insert or update on quarantined_inbound_messages
  for each row execute function public.enforce_quarantined_inbound_message_review_self();

create trigger quarantined_inbound_messages_no_delete before delete on quarantined_inbound_messages
  for each row execute function public.reject_delete();
revoke delete on quarantined_inbound_messages from authenticated, anon;

-- Reuses log_audit_via_bid_package() (schema/015) rather than the plain
-- log_audit() every other table above uses — plain log_audit() does a
-- hard NEW.project_id/OLD.project_id field access that would raise at
-- runtime against a row shape with no such column at all.
-- log_audit_via_bid_package() instead resolves project_id from a
-- bid_package_id column (which this table does have, nullable) via a
-- SELECT, which degrades gracefully to a null project_id (audit_log.
-- project_id is nullable — schema/001's own comment already anticipates
-- exactly this "a table without project scope" case) for the genuinely
-- unattributable quarantine reasons (unmatched_token/signature_invalid/
-- malformed_payload) rather than erroring. A null-project_id audit row
-- may not surface through every existing project-scoped audit_log
-- staff-read policy — an accepted, narrow gap (the quarantine row
-- itself, with its own reviewed_by/reviewed_at/resolution columns,
-- already IS the durable record of what happened; audit_log here is a
-- secondary trail, not the only one).
create trigger audit_quarantined_inbound_messages after insert or update on quarantined_inbound_messages
  for each row execute function public.log_audit_via_bid_package();
