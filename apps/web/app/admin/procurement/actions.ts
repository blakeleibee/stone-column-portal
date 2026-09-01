"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  createMaterialOrder as createMaterialOrderService,
  addMaterialOrderLineItem as addMaterialOrderLineItemService,
  commitMaterialOrder as commitMaterialOrderService,
  recordReceivedQuantity as recordReceivedQuantityService,
} from "../../../../../packages/02-app-shell/src/services/procurementService";
import { issuePurchaseOrder as issuePurchaseOrderService } from "../../../../../packages/02-app-shell/src/services/documentIssuanceService";

export async function createMaterialOrder(projectId: string, defaultCostCodeId?: string, vendorId?: string, orderNumber?: string, notes?: string) {
  const supabase = await createServerSupabaseClient();
  return createMaterialOrderService(supabase, projectId, defaultCostCodeId, vendorId, orderNumber, notes);
}

export async function addMaterialOrderLineItem(materialOrderId: string, projectId: string, costCodeId: string, description: string, quantity: number, unit: string | undefined, unitPriceCents: number) {
  const supabase = await createServerSupabaseClient();
  return addMaterialOrderLineItemService(supabase, materialOrderId, projectId, costCodeId, description, quantity, unit, unitPriceCents);
}

export async function commitMaterialOrder(materialOrderId: string) {
  const supabase = await createServerSupabaseClient();
  return commitMaterialOrderService(supabase, materialOrderId);
}

export async function recordReceivedQuantity(lineItemId: string, receivedQuantity: number, markBackordered?: boolean) {
  const supabase = await createServerSupabaseClient();
  return recordReceivedQuantityService(supabase, lineItemId, receivedQuantity, markBackordered);
}

export async function issuePurchaseOrder(materialOrderId: string, documentNumber?: string) {
  const supabase = await createServerSupabaseClient();
  return issuePurchaseOrderService(supabase, materialOrderId, documentNumber);
}
