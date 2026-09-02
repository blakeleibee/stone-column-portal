import React from "react";
import { Document, Page, Text, StyleSheet } from "@react-pdf/renderer";
import { formatCents } from "../../../01-financial-engine/src/money";
import { SUBCONTRACT_PDF_TEMPLATE_VERSION } from "./templateVersions";

/**
 * Subcontract PDF template (P5 Task 10, Decision 4) — same
 * snapshot-or-draft shape and registry-dispatch convention as
 * MaterialOrderPdf.tsx (see that file's header comment for the full
 * rationale). Consumed by
 * apps/web/app/api/bids/[bidPackageId]/subcontract-pdf/route.ts
 * through SUBCONTRACT_PDF_RENDERERS, never imported directly.
 */

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  title: { fontSize: 16, marginBottom: 12 },
  draftWatermark: { position: "absolute", top: 24, right: 32, fontSize: 10, color: "#b91c1c" },
});

export interface SubcontractPdfProps {
  documentNumber: string;
  title: string;
  scopeDescription: string | null;
  awardedVendorName: string;
  amountCents: number;
  isDraft: boolean;
}

export function SubcontractPdf({ documentNumber, title, scopeDescription, awardedVendorName, amountCents, isDraft }: SubcontractPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {isDraft && <Text style={styles.draftWatermark}>DRAFT — NOT ISSUED</Text>}
        <Text style={styles.title}>
          Subcontract Agreement {documentNumber} — {title}
        </Text>
        <Text>Awarded to: {awardedVendorName}</Text>
        <Text>Contract amount: {formatCents(amountCents)}</Text>
        <Text style={{ marginTop: 12 }}>Scope: {scopeDescription ?? "See attached scope of work."}</Text>
      </Page>
    </Document>
  );
}

export const SUBCONTRACT_PDF_RENDERERS: Record<string, typeof SubcontractPdf> = {
  [SUBCONTRACT_PDF_TEMPLATE_VERSION]: SubcontractPdf,
};
