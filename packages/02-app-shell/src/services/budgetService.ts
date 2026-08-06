import type { SupabaseClient } from "@supabase/supabase-js";

export async function enterOriginalBudget(
  supabase: SupabaseClient,
  projectId: string,
  costCodeId: string,
  amountCents: number,
  note?: string
) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return { error: "Amount must be a whole number of cents, zero or greater." };
  }
  const { error } = await supabase.from("budget_ledger").insert({
    project_id: projectId,
    cost_code_id: costCodeId,
    entry_type: "original",
    amount_cents: amountCents,
    note: note ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function adjustBudget(
  supabase: SupabaseClient,
  projectId: string,
  costCodeId: string,
  deltaCents: number,
  reason: string
) {
  if (!Number.isInteger(deltaCents) || deltaCents === 0) {
    return { error: "Adjustment must be a non-zero whole number of cents." };
  }
  if (!reason.trim()) {
    return { error: "A reason is required for every budget adjustment." };
  }
  const { error } = await supabase.from("budget_ledger").insert({
    project_id: projectId,
    cost_code_id: costCodeId,
    entry_type: "correction",
    amount_cents: deltaCents,
    note: reason,
  });
  return error ? { error: error.message } : {};
}
