import type { SupabaseClient } from "@supabase/supabase-js";
import { getMaterialOrderDetail } from "./procurementService";
import { getBidPackageDetail } from "./bidService";
import { MATERIAL_ORDER_PDF_TEMPLATE_VERSION, SUBCONTRACT_PDF_TEMPLATE_VERSION } from "../pdf/templateVersions";

/**
 * Document issuance service, on top of the already-live
 * issue_document() RPC (schema/015_commitments_bids_procurement.sql,
 * RLS swapped to is_financial_staff by schema/016). Implements
 * Decision 4: issuing a PO or subcontract freezes a canonical JSON
 * snapshot (never the rendered PDF bytes) at the moment of issuance,
 * so a later change to the live material order or bid package can
 * never retroactively alter a document someone has already been
 * handed. template_version (Revision 3) is always imported from
 * ../pdf/templateVersions, never hand-typed, so the service and the
 * future PDF template components can never silently drift apart on
 * which string names which renderer.
 */

export type IssuedDocumentType = "purchase_order" | "subcontract";

export interface IssuedDocumentRow {
  id: string;
  documentType: IssuedDocumentType;
  sourceId: string;
  documentNumber: string;
  version: number;
  templateVersion: string;
  issuedAt: string;
  issuedBy: string | null;
  canonicalData: unknown;
  supersededAt: string | null;
  supersededById: string | null;
}

function mapIssuedDocument(row: any): IssuedDocumentRow {
  return {
    id: row.id,
    documentType: row.document_type,
    sourceId: row.source_id,
    documentNumber: row.document_number,
    version: row.version,
    templateVersion: row.template_version,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by,
    canonicalData: row.canonical_data,
    supersededAt: row.superseded_at,
    supersededById: row.superseded_by_id,
  };
}

export async function getLatestIssuedDocument(supabase: SupabaseClient, documentType: IssuedDocumentType, sourceId: string): Promise<IssuedDocumentRow | null> {
  const { data, error } = await supabase
    .from("issued_documents")
    .select("*")
    .eq("document_type", documentType)
    .eq("source_id", sourceId)
    .is("superseded_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapIssuedDocument(data) : null;
}

export async function getIssuedDocumentVersion(supabase: SupabaseClient, documentType: IssuedDocumentType, sourceId: string, version: number): Promise<IssuedDocumentRow | null> {
  const { data, error } = await supabase
    .from("issued_documents")
    .select("*")
    .eq("document_type", documentType)
    .eq("source_id", sourceId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw error;
  return data ? mapIssuedDocument(data) : null;
}

/** Builds the canonical snapshot from LIVE data at the moment of
 *  issuance, then hands it to issue_document() to freeze. Every field
 *  the PDF template (Task 10) needs must be present here — anything
 *  missing here is unrecoverable later, since post-issuance the
 *  snapshot, not the live tables, is authoritative for this version.
 *  MATERIAL_ORDER_PDF_TEMPLATE_VERSION (Revision 3, Decision 4) is
 *  imported from the template module itself, never hand-typed here —
 *  the whole point of "historical template versions remain renderable"
 *  is that this string always reflects whichever template file actually
 *  produced canonicalData, with zero chance of the two silently drifting
 *  out of sync. */
export async function issuePurchaseOrder(supabase: SupabaseClient, materialOrderId: string, documentNumber?: string) {
  const order = await getMaterialOrderDetail(supabase, materialOrderId);
  if (!order) return { error: "Material order not found." };
  if (order.lineItems.length === 0) return { error: "Cannot issue a PO with no line items." };

  const { data: vendorRow } = order.vendorId ? await supabase.from("vendors").select("name").eq("id", order.vendorId).maybeSingle() : { data: null };

  const canonicalData = {
    materialOrderId: order.id,
    orderNumber: order.orderNumber,
    vendorName: vendorRow?.name ?? "Unknown vendor",
    lineItems: order.lineItems.map((li) => ({
      description: li.description,
      costCodeId: li.costCodeId,
      quantity: li.quantity,
      unit: li.unit,
      unitPriceCents: li.unitPriceCents,
      lineTotalCents: li.quantity * li.unitPriceCents,
    })),
    totalCents: order.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPriceCents, 0),
  };

  const { data, error } = await supabase.rpc("issue_document", {
    p_document_type: "purchase_order",
    p_source_id: materialOrderId,
    p_document_number: documentNumber ?? order.orderNumber ?? materialOrderId.slice(0, 8),
    p_template_version: MATERIAL_ORDER_PDF_TEMPLATE_VERSION,
    p_canonical_data: canonicalData,
  });
  if (error) return { error: error.message };
  return { issuedDocumentId: data as string };
}

/** Validates the package is actually awarded BEFORE calling
 *  issue_document() — issuing a subcontract for a bid that was never
 *  awarded is a service-layer validation error, not merely a disabled
 *  UI button (the button being disabled doesn't stop a direct call). */
export async function issueSubcontract(supabase: SupabaseClient, bidPackageId: string, documentNumber?: string) {
  const detail = await getBidPackageDetail(supabase, bidPackageId);
  if (!detail) return { error: "Bid package not found." };
  const awarded = detail.submissions.find((s) => s.status === "awarded");
  if (!awarded) return { error: "This bid package has no awarded submission yet." };

  const canonicalData = {
    bidPackageId: detail.id,
    title: detail.title,
    scopeDescription: detail.scopeDescription,
    costCodeId: detail.costCodeId,
    awardedVendorName: awarded.vendorName,
    amountCents: awarded.amountCents,
  };

  const { data, error } = await supabase.rpc("issue_document", {
    p_document_type: "subcontract",
    p_source_id: bidPackageId,
    p_document_number: documentNumber ?? `SUB-${bidPackageId.slice(0, 8)}`,
    p_template_version: SUBCONTRACT_PDF_TEMPLATE_VERSION,
    p_canonical_data: canonicalData,
  });
  if (error) return { error: error.message };
  return { issuedDocumentId: data as string };
}
