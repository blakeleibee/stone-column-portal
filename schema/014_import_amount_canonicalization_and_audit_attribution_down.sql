-- =====================================================================
-- Stone Column Portal — Migration 014 ROLLBACK.
-- Restores confirm_import_batch() to its schema/013 body (decimal-
-- string dollar-amount parsing via `round(...::numeric * 100)::bigint`,
-- no created_by on the expenses insert). This is a CREATE OR REPLACE
-- back to the prior body, not a DROP -- 013's own down migration is
-- what removes the function entirely, and 014 never changed the
-- function's signature, only its body, so 013's down migration remains
-- valid and unaffected whether or not 014 has been applied.
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

  if (select status from import_batches where id = p_batch_id) = 'confirmed' then
    raise exception 'Batch % is already confirmed.', p_batch_id;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and match_status in ('new', 'changed') loop
    insert into expenses (
      project_id, cost_code_id, vendor_name, transaction_date, description_internal,
      amount_cents, financial_status, source_type, import_batch_id
    ) values (
      v_project_id,
      (v_row.raw_data->>'__resolved_cost_code_id')::uuid,
      v_row.raw_data->>'Name',
      (v_row.raw_data->>'Date')::date,
      v_row.raw_data->>'Memo',
      round((v_row.raw_data->>'Amount')::numeric * 100)::bigint,
      'pending',
      'quickbooks_import',
      p_batch_id
    ) returning id into strict v_row.matched_expense_id;

    update import_rows set matched_expense_id = v_row.matched_expense_id where id = v_row.id;
  end loop;

  update import_batches set status = 'confirmed' where id = p_batch_id;
end;
$$;

revoke all on function public.confirm_import_batch(uuid) from public;
grant execute on function public.confirm_import_batch(uuid) to authenticated;
