-- =====================================================================
-- Stone Column Portal — Migration 011: sum_posted_expenses RPC.
--
-- The genuinely separate aggregate query
-- SupabaseFinancialRepository.getIndependentPostedActualCostCents()
-- calls -- TARGET-ARCHITECTURE.md §6's "independent control total"
-- contract requires this NOT share a code path with getExpenses().
-- =====================================================================

create or replace function public.sum_posted_expenses(p_project_id uuid) returns bigint
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select coalesce(sum(amount_cents), 0)
  from public.expenses
  where project_id = p_project_id and financial_status = 'posted';
$$;

revoke all on function public.sum_posted_expenses(uuid) from public;
grant execute on function public.sum_posted_expenses(uuid) to authenticated;
