"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { getRepository } from "../../../src/data/getRepository";
import {
  createMaterialOrder as createMaterialOrderService,
  addMaterialOrderLineItem as addMaterialOrderLineItemService,
  commitMaterialOrder as commitMaterialOrderService,
  recordReceivedQuantity as recordReceivedQuantityService,
  getMaterialOrderDetail as getMaterialOrderDetailService,
} from "../../../../../packages/02-app-shell/src/services/procurementService";
import {
  issuePurchaseOrder as issuePurchaseOrderService,
  getLatestIssuedDocument as getLatestIssuedDocumentService,
} from "../../../../../packages/02-app-shell/src/services/documentIssuanceService";

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

/**
 * Task 9: the one read-only Server Action the plan's own Step 3 calls
 * for — thin forward to procurementService.getMaterialOrderDetail
 * (Task 8, unmodified), same shape as every write action above.
 */
export async function getMaterialOrderDetail(materialOrderId: string) {
  const supabase = await createServerSupabaseClient();
  const detail = await getMaterialOrderDetailService(supabase, materialOrderId);
  return detail ? { detail } : { error: "Material order not found." };
}

/**
 * Task 9 addition, not explicitly named in the plan's own Interfaces
 * list but required to satisfy its Mutations table honestly: after
 * `commitMaterialOrder` returns `{costCodeId, committedCostId}[]`, the
 * UI needs the real dollar amount per committed_cost row to render
 * "Framing: $85,000 committed" — and CLAUDE.md forbids computing that
 * client-side (it would just be re-deriving sum(quantity * unit_price)
 * a second time in the browser). committed_costs.amount_cents is the
 * one place that real number already lives, so this is a thin forward
 * to the pre-existing, already-tested FinancialRepository.getCommittedCosts
 * (Package 1/2, predates this plan entirely, unmodified here) — the same
 * function CommitmentsTable.tsx's page already uses for the identical
 * figure. The workspace matches the returned rows back to the specific
 * committedCostIds commitMaterialOrder handed it; no new business logic,
 * no edit to any P5 Task 1-8 file.
 */
export async function getCommittedCostsForProject(projectId: string) {
  const supabase = await createServerSupabaseClient();
  const repo = getRepository(supabase);
  const committedCosts = await repo.getCommittedCosts(projectId);
  return { committedCosts };
}

/**
 * Task 9's honest issue-PO confirmation (per this task's Correction 2):
 * Task 10's PDF route does not exist yet, so instead of a fake "Open
 * PDF" link the UI shows "Purchase Order issued — Version N" using the
 * REAL version number of the just-issued issued_documents row, fetched
 * via documentIssuanceService.getLatestIssuedDocument (Task 8,
 * unmodified) exactly as this task's own correction text suggests.
 */
export async function getLatestIssuedPurchaseOrder(materialOrderId: string) {
  const supabase = await createServerSupabaseClient();
  const document = await getLatestIssuedDocumentService(supabase, "purchase_order", materialOrderId);
  return document ? { document } : { error: "No issued purchase order found for this material order." };
}
