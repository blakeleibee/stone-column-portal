import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Material order + line item service functions, on top of the already-
 * live schema/015_commitments_bids_procurement.sql (material_orders,
 * material_order_line_items) as amended by schema/016's is_org_staff ->
 * is_financial_staff RLS swap. Same "repository read functions + plain
 * write functions a Server Action wraps thinly" split as every other
 * service in this package (CLAUDE.md's AI-readiness mandate) — nothing
 * here is called directly from a component or a Server Action's own
 * body beyond a one-line forward.
 */

export interface MaterialOrderRow {
  id: string;
  projectId: string;
  defaultCostCodeId: string | null; // convenience default only — never authoritative, see Decision 2
  vendorId: string | null;
  orderNumber: string | null;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  orderedAt: string | null;
  expectedDeliveryAt: string | null;
}

export interface MaterialOrderLineItemRow {
  id: string;
  materialOrderId: string;
  costCodeId: string; // authoritative allocation for this line — Decision 2
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceCents: number;
  receivedQuantity: number;
  backordered: boolean;
}

export interface MaterialOrderDetail extends MaterialOrderRow {
  lineItems: MaterialOrderLineItemRow[];
}

function mapOrder(row: any): MaterialOrderRow {
  return {
    id: row.id,
    projectId: row.project_id,
    defaultCostCodeId: row.cost_code_id,
    vendorId: row.vendor_id,
    orderNumber: row.order_number,
    status: row.status,
    orderedAt: row.ordered_at,
    expectedDeliveryAt: row.expected_delivery_at,
  };
}

function mapLineItem(row: any): MaterialOrderLineItemRow {
  return {
    id: row.id,
    materialOrderId: row.material_order_id,
    costCodeId: row.cost_code_id,
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPriceCents: row.unit_price_cents,
    receivedQuantity: Number(row.received_quantity),
    backordered: row.backordered,
  };
}

export async function listMaterialOrders(supabase: SupabaseClient, projectId: string): Promise<MaterialOrderRow[]> {
  const { data, error } = await supabase.from("material_orders").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapOrder);
}

export async function getMaterialOrderDetail(supabase: SupabaseClient, materialOrderId: string): Promise<MaterialOrderDetail | null> {
  const { data: orderRow, error: orderError } = await supabase.from("material_orders").select("*").eq("id", materialOrderId).maybeSingle();
  if (orderError) throw orderError;
  if (!orderRow) return null;

  const { data: lineRows, error: lineError } = await supabase.from("material_order_line_items").select("*").eq("material_order_id", materialOrderId);
  if (lineError) throw lineError;

  return { ...mapOrder(orderRow), lineItems: (lineRows ?? []).map(mapLineItem) };
}

export async function createMaterialOrder(
  supabase: SupabaseClient,
  projectId: string,
  defaultCostCodeId?: string,
  vendorId?: string,
  orderNumber?: string,
  notes?: string
) {
  const { data, error } = await supabase
    .from("material_orders")
    .insert({ project_id: projectId, cost_code_id: defaultCostCodeId ?? null, vendor_id: vendorId ?? null, order_number: orderNumber ?? null, notes: notes ?? null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

/** costCodeId is REQUIRED — Decision 2 made the order-level cost code
 *  an optional UI convenience only. The caller (Task 9's screen)
 *  pre-fills its input from the order's defaultCostCodeId but must
 *  always pass an explicit, possibly-overridden value here. */
export async function addMaterialOrderLineItem(
  supabase: SupabaseClient,
  materialOrderId: string,
  projectId: string,
  costCodeId: string,
  description: string,
  quantity: number,
  unit: string | undefined,
  unitPriceCents: number
) {
  if (!costCodeId) return { error: "A cost code is required for every line item." };
  if (!description.trim()) return { error: "Description is required." };
  if (!(quantity > 0)) return { error: "Quantity must be greater than zero." };
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) return { error: "Unit price must be a whole number of cents, zero or greater." };
  const { error } = await supabase.from("material_order_line_items").insert({
    material_order_id: materialOrderId,
    project_id: projectId,
    cost_code_id: costCodeId,
    description: description.trim(),
    quantity,
    unit: unit ?? null,
    unit_price_cents: unitPriceCents,
  });
  if (error) return { error: error.message };
  return {};
}

export interface MaterialOrderCommitResult {
  costCodeId: string;
  committedCostId: string;
}

/** Returns the mapping directly (Revision 3) — Decision 2 means one
 *  order may now back several committed_costs rows, one per distinct
 *  cost code among its lines, and the RPC's own `table(cost_code_id,
 *  committed_cost_id)` return shape is what lets a caller associate
 *  each without a second query. */
export async function commitMaterialOrder(supabase: SupabaseClient, materialOrderId: string) {
  const { data, error } = await supabase.rpc("commit_material_order", { p_material_order_id: materialOrderId });
  if (error) return { error: error.message };
  const rows = (data as { cost_code_id: string; committed_cost_id: string }[] | null) ?? [];
  return { committedCosts: rows.map((row) => ({ costCodeId: row.cost_code_id, committedCostId: row.committed_cost_id })) as MaterialOrderCommitResult[] };
}

export async function recordReceivedQuantity(supabase: SupabaseClient, lineItemId: string, receivedQuantity: number, markBackordered?: boolean) {
  if (receivedQuantity < 0) return { error: "Received quantity cannot be negative." };

  const { data: lineRow, error: lineReadError } = await supabase
    .from("material_order_line_items")
    .select("material_order_id, quantity")
    .eq("id", lineItemId)
    .single();
  if (lineReadError) return { error: lineReadError.message };
  if (receivedQuantity > Number(lineRow.quantity)) {
    return { error: "Received quantity cannot exceed the ordered quantity." };
  }

  const { error: updateError } = await supabase
    .from("material_order_line_items")
    .update({ received_quantity: receivedQuantity, backordered: markBackordered ?? false })
    .eq("id", lineItemId);
  if (updateError) return { error: updateError.message };

  const { data: allLines, error: allLinesError } = await supabase
    .from("material_order_line_items")
    .select("quantity, received_quantity")
    .eq("material_order_id", lineRow.material_order_id);
  if (allLinesError) return { error: allLinesError.message };

  const allReceived = (allLines ?? []).every((l: any) => Number(l.received_quantity) >= Number(l.quantity));
  const someReceived = (allLines ?? []).some((l: any) => Number(l.received_quantity) > 0);
  const newStatus = allReceived ? "received" : someReceived ? "partially_received" : undefined;

  if (newStatus) {
    const { error: statusError } = await supabase
      .from("material_orders")
      .update({ status: newStatus })
      .eq("id", lineRow.material_order_id)
      .in("status", ["ordered", "partially_received"]);
    if (statusError) return { error: statusError.message };
  }

  return {};
}
