import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatCents } from "../../../01-financial-engine/src/money";
import { MATERIAL_ORDER_PDF_TEMPLATE_VERSION } from "./templateVersions";

/**
 * PO PDF template (P5 Task 10, Decision 4). Renders from either a
 * frozen `issued_documents.canonical_data` snapshot OR live current
 * data (`isDraft=true`) — the same shape covers both, so there is
 * exactly one template to keep visually consistent, not two that could
 * drift apart. The Route Handler
 * (apps/web/app/api/procurement/material-orders/[id]/pdf/route.ts)
 * never imports `MaterialOrderPdf` directly — it always resolves the
 * correct component through `MATERIAL_ORDER_PDF_RENDERERS`, keyed by
 * the snapshot's own frozen `template_version` (or
 * MATERIAL_ORDER_PDF_TEMPLATE_VERSION directly, for a draft). When a
 * future breaking template change ships, add a new keyed entry (e.g. a
 * `MaterialOrderPdfV2` component under
 * `MATERIAL_ORDER_PDF_TEMPLATE_VERSION = "2"` in templateVersions.ts)
 * to the registry below WITHOUT removing the "1" entry — that is what
 * makes "historical template versions remain renderable" a real code
 * path rather than a design intention.
 */

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  title: { fontSize: 16, marginBottom: 12 },
  draftWatermark: { position: "absolute", top: 24, right: 32, fontSize: 10, color: "#b91c1c" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ccc", paddingVertical: 4 },
  cell: { flex: 1 },
});

export interface MaterialOrderPdfLineItem {
  description: string;
  costCodeId?: string;
  quantity: number;
  unit?: string | null;
  unitPriceCents: number;
  lineTotalCents?: number;
}

export interface MaterialOrderPdfProps {
  documentNumber: string;
  vendorName: string;
  lineItems: MaterialOrderPdfLineItem[];
  totalCents: number;
  isDraft: boolean;
}

export function MaterialOrderPdf({ documentNumber, vendorName, lineItems, totalCents, isDraft }: MaterialOrderPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {isDraft && <Text style={styles.draftWatermark}>DRAFT — NOT ISSUED</Text>}
        <Text style={styles.title}>Purchase Order {documentNumber}</Text>
        <Text>Vendor: {vendorName}</Text>
        <View style={styles.row}>
          <Text style={styles.cell}>Description</Text>
          <Text style={styles.cell}>Cost Code</Text>
          <Text style={styles.cell}>Qty</Text>
          <Text style={styles.cell}>Unit Price</Text>
          <Text style={styles.cell}>Total</Text>
        </View>
        {lineItems.map((li, i) => (
          <View style={styles.row} key={i}>
            <Text style={styles.cell}>{li.description}</Text>
            <Text style={styles.cell}>{li.costCodeId ?? "—"}</Text>
            <Text style={styles.cell}>
              {li.quantity} {li.unit ?? ""}
            </Text>
            <Text style={styles.cell}>{formatCents(li.unitPriceCents)}</Text>
            <Text style={styles.cell}>{formatCents(li.lineTotalCents ?? li.quantity * li.unitPriceCents)}</Text>
          </View>
        ))}
        <Text style={{ marginTop: 12 }}>Total: {formatCents(totalCents)}</Text>
      </Page>
    </Document>
  );
}

/** Keyed by template_version — see this file's header comment. */
export const MATERIAL_ORDER_PDF_RENDERERS: Record<string, typeof MaterialOrderPdf> = {
  [MATERIAL_ORDER_PDF_TEMPLATE_VERSION]: MaterialOrderPdf,
};
