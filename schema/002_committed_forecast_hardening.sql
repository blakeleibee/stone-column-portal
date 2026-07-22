-- =====================================================================
-- Stone Column Portal — Migration 002: harden committed_costs and
-- forecast_entries against direct amount edits
--
-- STATUS: written, NOT executed — same disclosure as every other SQL
-- file in this project (no local Postgres/Docker/network in this
-- sandbox). See tests/sql/committed_forecast_hardening_tests.sql.
--
-- WHY THIS IS A SEPARATE FORWARD MIGRATION, NOT AN EDIT TO 001:
-- Package 1 was conditionally approved with 001/002(down)/tests
-- already reviewed and accepted. Rewriting 001 in place after approval
-- would mean re-reviewing a file that's already been signed off, and
-- would break the "up -> down -> up" reapply story for anyone who has
-- already applied 001 (their existing committed_costs/forecast_entries
-- rows would need this migration's triggers attached going forward,
-- not a retroactive schema rewrite). A new migration is the correct
-- move per the standing instruction: add forward migrations rather
-- than silently rewriting established history.
--
-- WHY NOW, NOT DEFERRED TO PACKAGE 4:
-- Package 2 mandate: don't defer this if an earlier package begins
-- using these tables. Package 2's Financials screen READS
-- committed_costs/forecast_entries (via the Package 1 engine) but does
-- not yet write to them — no functional create/edit UI exists for
-- either table until a later package. Closing the gap now, before any
-- UI touches these tables at all, means no future package ever has to
-- retrofit this protection under time pressure once real workflows
-- depend on the current (softer) behavior.
--
-- THE GAP THIS CLOSES: `committed_costs` and `forecast_entries` already
-- disallow DELETE (001, review item 5) and already use a "supersede"
-- pattern by convention (superseded_at/superseded_by_id) — but nothing
-- stopped an UPDATE from changing amount_cents (or cost_code_id,
-- project_id, vendor_name, source_type/source_id for committed_costs;
-- forecast_to_complete_cents, method, source_suggestion_id for
-- forecast_entries) directly on an EXISTING row, in place, bypassing
-- the supersede pattern entirely. That's the same class of problem
-- 001 already solved for budget_ledger/fee_ledger (append-only) and
-- expenses (frozen once posted) — this migration closes the same gap
-- for the two tables that were explicitly flagged as still open.
-- =====================================================================

-- ---------------------------------------------------------------------
-- committed_costs: only status, superseded_at, and superseded_by_id
-- may ever change on an existing row. Everything else — amount_cents,
-- cost_code_id, project_id, vendor_name, source_type, source_id — is
-- fixed at creation. A correction/partial-invoice split is always a
-- NEW row (see schema/001_core_financial.sql's own comment on this
-- table), never an edit to amount_cents on the old one.
-- ---------------------------------------------------------------------

create or replace function public.reject_committed_cost_core_edit() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.amount_cents   is distinct from OLD.amount_cents or
     NEW.cost_code_id   is distinct from OLD.cost_code_id or
     NEW.project_id     is distinct from OLD.project_id or
     NEW.vendor_name     is distinct from OLD.vendor_name or
     NEW.source_type     is distinct from OLD.source_type or
     NEW.source_id       is distinct from OLD.source_id
  then
    raise exception
      'Cannot edit core fields of an existing committed cost (id=%). Supersede it with a new row (superseded_at/superseded_by_id) instead.',
      OLD.id;
  end if;
  return NEW;
end;
$$;

create trigger committed_costs_no_core_edit before update on committed_costs
  for each row execute function public.reject_committed_cost_core_edit();

-- ---------------------------------------------------------------------
-- forecast_entries: only superseded_at may ever change on an existing
-- row. forecast_to_complete_cents, cost_code_id, project_id, method,
-- and source_suggestion_id are fixed at creation — a revised forecast
-- is always a new row (see the existing
-- forecast_entries_one_active_per_cost_code partial unique index,
-- which already assumes this).
-- ---------------------------------------------------------------------

create or replace function public.reject_forecast_core_edit() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.forecast_to_complete_cents is distinct from OLD.forecast_to_complete_cents or
     NEW.cost_code_id                is distinct from OLD.cost_code_id or
     NEW.project_id                  is distinct from OLD.project_id or
     NEW.method                      is distinct from OLD.method or
     NEW.source_suggestion_id        is distinct from OLD.source_suggestion_id
  then
    raise exception
      'Cannot edit core fields of an existing forecast entry (id=%). Supersede it with a new row instead.',
      OLD.id;
  end if;
  return NEW;
end;
$$;

create trigger forecast_entries_no_core_edit before update on forecast_entries
  for each row execute function public.reject_forecast_core_edit();

-- ---------------------------------------------------------------------
-- budget_suggestions: while reviewing the same class of gap, this table
-- has an analogous exposure — status/resolved_by/resolved_at/
-- resolved_amount_cents are meant to be the only mutable fields (that's
-- literally how accept/dismiss/edit works), but nothing stopped an
-- UPDATE from also silently rewriting suggested_amount_cents, reason,
-- direction, source_type, or evidence_refs on an existing suggestion —
-- rewriting the historical record of what was suggested and why, after
-- the fact. Closed here too, not deferred, for the same reasoning as
-- committed_costs/forecast_entries above.
-- ---------------------------------------------------------------------

create or replace function public.reject_suggestion_core_edit() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.suggested_amount_cents is distinct from OLD.suggested_amount_cents or
     NEW.direction               is distinct from OLD.direction or
     NEW.reason                  is distinct from OLD.reason or
     NEW.source_type             is distinct from OLD.source_type or
     NEW.cost_code_id            is distinct from OLD.cost_code_id or
     NEW.project_id              is distinct from OLD.project_id or
     NEW.confidence               is distinct from OLD.confidence or
     NEW.evidence_refs           is distinct from OLD.evidence_refs or
     NEW.generated_at             is distinct from OLD.generated_at
  then
    raise exception
      'Cannot edit the core content of an existing suggestion (id=%). Only its resolution (status/resolved_by/resolved_at/resolved_amount_cents) may change.',
      OLD.id;
  end if;
  return NEW;
end;
$$;

create trigger budget_suggestions_no_core_edit before update on budget_suggestions
  for each row execute function public.reject_suggestion_core_edit();
