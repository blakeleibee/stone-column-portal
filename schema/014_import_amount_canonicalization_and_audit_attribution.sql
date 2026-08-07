-- =====================================================================
-- Stone Column Portal — Migration 014: P4 final-review fix wave.
-- schema/013_estimating_and_qb_import.sql has already been applied to
-- the real hosted Supabase dev project once this session (see the P4
-- live checkpoint recorded in docs/milestones/P4-complete.md), so the
-- two fixes below to confirm_import_batch() -- both to its BODY, not
-- its signature -- land as a NEW migration rather than an amendment to
-- 013. Amending 013 in place would never reach an environment that has
-- already run it; a new migration reaches every environment regardless
-- of whether 013 has already been applied there.
--
-- Fix 1 (finding 1 of the P4 final-review): confirm_import_batch()
-- previously read raw_data->>'Amount' as a decimal-string dollar amount
-- and multiplied by 100 -- `round((v_row.raw_data->>'Amount')::numeric
-- * 100)::bigint` -- which threw on QuickBooks' own common
-- currency-formatted export values ("$1,250.00", "1,250.00" -- Postgres
-- cannot cast a string containing "$"/"," to numeric) and silently
-- dropped the sign of a parenthesized-negative credit ("(500.00)").
-- Application code (packages/02-app-shell/src/imports/parseQuickBooksCsv.ts,
-- called from stageImportBatch()) is now the ONE place Amount is ever
-- parsed from a source file's own formatting; it writes raw_data.Amount
-- as an already-canonical SIGNED INTEGER NUMBER OF CENTS (as a string).
-- This function must therefore read it as exactly that -- a direct cast
-- to bigint, no numeric parsing of a decimal string, no *100.
--
-- Format-transition note (re-review of the fix above): this migration
-- changes what `import_rows.raw_data->>'Amount'` MEANS, not just how
-- this function reads it. Before this migration, application code
-- wrote it as the raw CSV decimal-dollar string (e.g. "1200.00");
-- after, `parseQuickBooksCsv()`/`stageImportBatch()` write it as an
-- already-computed SIGNED INTEGER NUMBER OF CENTS string (e.g.
-- "120000"). Any `import_rows` row staged under the OLD format that
-- was never confirmed before this migration shipped is now stale: if
-- it were confirmed post-migration, this function's `::bigint` cast
-- would either fail loudly (any old-format value containing a decimal
-- point, e.g. "1200.00" -- bigint's input syntax rejects decimal
-- points, so this is safe) or, narrowly, silently misinterpret a
-- bare-integer old-format value with no decimal point (e.g. "1200",
-- unusual but possible from a QuickBooks export) as 1,200 CENTS
-- instead of $1,200.00 -- a silent 100x error. No runtime format-
-- version detection was added for this: this is P4's first-ever ship
-- (no real Stone Column usage exists yet), the only known
-- `import_rows` data anywhere is the dev checkpoint's own
-- already-confirmed test batch, and the idempotency guard immediately
-- below already blocks that specific batch from ever being
-- re-confirmed. If a future package ever needs to resurrect/re-stage
-- old, pre-migration `import_rows` for confirmation, re-validate this
-- assumption before trusting the `::bigint` cast blindly.
--
-- Fix 2 (finding 5 of the P4 final-review): the expenses row this
-- function creates never populated created_by, leaving every
-- QuickBooks-imported expense's audit trail silently attributing
-- authorship to no one. security invoker means auth.uid() here is the
-- real confirming user's id, same as every other created_by/posted_by/
-- published_by column in this schema.
-- =====================================================================

create or replace function public.confirm_import_batch(p_batch_id uuid) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_project_id uuid;
  v_unresolved_count integer;
begin
  select project_id into v_project_id from import_batches where id = p_batch_id;

  select count(*) into v_unresolved_count from import_rows
  where batch_id = p_batch_id and match_status in ('unmatched', 'error');
  if v_unresolved_count > 0 then
    raise exception 'Batch % has % unresolved row(s) — resolve or exclude them before confirming.', p_batch_id, v_unresolved_count;
  end if;

  -- Idempotency guard: without this, a double-click on a future Confirm
  -- button, or a retried request after a dropped response, would re-run
  -- the loop below against the same 'new'/'changed' rows (their
  -- match_status isn't changed by a successful confirm) and silently
  -- insert a second duplicate expenses row per row, overwriting
  -- matched_expense_id in the process.
  if (select status from import_batches where id = p_batch_id) = 'confirmed' then
    raise exception 'Batch % is already confirmed.', p_batch_id;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and match_status in ('new', 'changed') loop
    insert into expenses (
      project_id, cost_code_id, vendor_name, transaction_date, description_internal,
      amount_cents, financial_status, source_type, import_batch_id, created_by
    ) values (
      v_project_id,
      (v_row.raw_data->>'__resolved_cost_code_id')::uuid,
      v_row.raw_data->>'Name',
      (v_row.raw_data->>'Date')::date,
      v_row.raw_data->>'Memo',
      (v_row.raw_data->>'Amount')::bigint,
      'pending',
      'quickbooks_import',
      p_batch_id,
      auth.uid()
    ) returning id into strict v_row.matched_expense_id;

    update import_rows set matched_expense_id = v_row.matched_expense_id where id = v_row.id;
  end loop;

  update import_batches set status = 'confirmed' where id = p_batch_id;
end;
$$;

revoke all on function public.confirm_import_batch(uuid) from public;
grant execute on function public.confirm_import_batch(uuid) to authenticated;
