import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P5 Task 11 — Action Center condition functions. Registration only:
 * these are real, RLS-scoped read queries a future Action Center screen
 * can call, but nothing here wires them into any live screen (the
 * Action Center itself remains fixture/preview content, per
 * PRODUCT-COMPLETENESS-MATRIX.md Section D's "no condition-registry
 * screen exists yet" gap) — that wiring is deliberately out of scope
 * for this task, matching the plan's own title.
 */

export interface OverdueBidPackage {
  id: string;
  title: string;
  dueAt: string;
}

/** A bid package is "overdue" once it's been published (not still a
 *  draft, not already awarded/cancelled) and its due date has passed —
 *  matches the same "published" gate the Bids screen itself uses before
 *  a package can receive submissions. */
export async function getOverdueBidPackages(supabase: SupabaseClient, projectId: string): Promise<OverdueBidPackage[]> {
  const { data, error } = await supabase
    .from("bid_packages")
    .select("id, title, due_at")
    .eq("project_id", projectId)
    .eq("status", "published")
    .lt("due_at", new Date().toISOString());
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ id: row.id, title: row.title, dueAt: row.due_at }));
}

export interface BackorderedLineItem {
  id: string;
  materialOrderId: string;
  costCodeId: string;
  description: string;
}

/** costCodeId is returned per line item, not per order — Decision 2
 *  (P5-DESIGN.md) made line-level cost-code allocation authoritative,
 *  so a backorder condition must trace back to the specific cost code
 *  it affects, never the order's own optional default. Excludes orders
 *  already fully received (a backordered flag left set on an otherwise-
 *  received order is stale data, not an active condition). */
export async function getBackorderedMaterialLineItems(supabase: SupabaseClient, projectId: string): Promise<BackorderedLineItem[]> {
  const { data, error } = await supabase
    .from("material_order_line_items")
    .select("id, material_order_id, cost_code_id, description, material_orders!inner(project_id, status)")
    .eq("backordered", true)
    .eq("material_orders.project_id", projectId)
    .neq("material_orders.status", "received");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    materialOrderId: row.material_order_id,
    costCodeId: row.cost_code_id,
    description: row.description,
  }));
}
