import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { requireRole, AuthorizationError } from "../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { getBidPackageDetail } from "../../../../../../../packages/02-app-shell/src/services/bidService";
import { getLatestIssuedDocument, getIssuedDocumentVersion } from "../../../../../../../packages/02-app-shell/src/services/documentIssuanceService";
import { SUBCONTRACT_PDF_RENDERERS } from "../../../../../../../packages/02-app-shell/src/pdf/SubcontractPdf";
import { SUBCONTRACT_PDF_TEMPLATE_VERSION } from "../../../../../../../packages/02-app-shell/src/pdf/templateVersions";
// renderToBuffer is re-exported from packages/02-app-shell (not imported
// directly from "@react-pdf/renderer" here) — see pdfRenderer.ts's
// header comment for why a bare npm specifier can't resolve from an
// apps/web file.
import { renderToBuffer } from "../../../../../../../packages/02-app-shell/src/pdf/pdfRenderer";

/**
 * GET /api/bids/[bidPackageId]/subcontract-pdf's actual logic — split
 * out of route.ts for the same reason as the material-order PDF
 * route's handler.ts (see that file's header comment): Next.js's App
 * Router rejects any route.ts export beyond the recognized set
 * (GET/POST/etc., config, generateStaticParams, dynamic, revalidate,
 * runtime) at build time, so the dependency-injection seam this task's
 * unit tests need has to live in a plain module instead.
 *
 * Same snapshot-or-draft rendering shape as the material-order PDF
 * route (see that file's header comment). `?version=N` renders a
 * specific historical version.
 */
export interface SubcontractPdfRouteDeps {
  requireRole: typeof requireRole;
  createServerSupabaseClient: typeof createServerSupabaseClient;
  getBidPackageDetail: typeof getBidPackageDetail;
  getLatestIssuedDocument: typeof getLatestIssuedDocument;
  getIssuedDocumentVersion: typeof getIssuedDocumentVersion;
  renderToBuffer: typeof renderToBuffer;
  renderers: typeof SUBCONTRACT_PDF_RENDERERS;
}

const defaultDeps: SubcontractPdfRouteDeps = {
  requireRole,
  createServerSupabaseClient,
  getBidPackageDetail,
  getLatestIssuedDocument,
  getIssuedDocumentVersion,
  renderToBuffer,
  renderers: SUBCONTRACT_PDF_RENDERERS,
};

export async function handleSubcontractPdfRequest(
  req: NextRequest,
  bidPackageId: string,
  deps: SubcontractPdfRouteDeps = defaultDeps
): Promise<NextResponse> {
  try {
    await deps.requireRole(["admin", "staff"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const supabase = await deps.createServerSupabaseClient();
  const requestedVersion = req.nextUrl.searchParams.get("version");

  let documentNumber: string;
  let title: string;
  let scopeDescription: string | null;
  let awardedVendorName: string;
  let amountCents: number;
  let isDraft: boolean;
  let templateVersion: string;

  if (requestedVersion) {
    const snapshot = await deps.getIssuedDocumentVersion(supabase, "subcontract", bidPackageId, Number(requestedVersion));
    if (!snapshot) return NextResponse.json({ error: "Subcontract version not found" }, { status: 404 });
    const data = snapshot.canonicalData as any;
    documentNumber = snapshot.documentNumber;
    title = data.title;
    scopeDescription = data.scopeDescription;
    awardedVendorName = data.awardedVendorName;
    amountCents = data.amountCents;
    isDraft = false;
    templateVersion = snapshot.templateVersion;
  } else {
    const latestIssued = await deps.getLatestIssuedDocument(supabase, "subcontract", bidPackageId);
    if (latestIssued) {
      const data = latestIssued.canonicalData as any;
      documentNumber = latestIssued.documentNumber;
      title = data.title;
      scopeDescription = data.scopeDescription;
      awardedVendorName = data.awardedVendorName;
      amountCents = data.amountCents;
      isDraft = false;
      templateVersion = latestIssued.templateVersion;
    } else {
      const detail = await deps.getBidPackageDetail(supabase, bidPackageId);
      if (!detail) return NextResponse.json({ error: "Bid package not found" }, { status: 404 });
      const awarded = detail.submissions.find((s) => s.status === "awarded");
      if (!awarded) return NextResponse.json({ error: "No awarded submission for this bid package yet" }, { status: 409 });
      documentNumber = `SUB-${detail.id.slice(0, 8)}`;
      title = detail.title;
      scopeDescription = detail.scopeDescription;
      awardedVendorName = awarded.vendorName;
      amountCents = awarded.amountCents ?? 0;
      isDraft = true;
      templateVersion = SUBCONTRACT_PDF_TEMPLATE_VERSION;
    }
  }

  const Renderer = deps.renderers[templateVersion];
  if (!Renderer) {
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
  }

  try {
    // See the material-order PDF route's identical cast for why: the
    // registry-dispatch pattern (Decision 4) means `Renderer`'s own prop
    // type is necessarily unrelated to @react-pdf/renderer's own
    // `DocumentProps` type, even though every registered component
    // renders a real <Document> root at runtime.
    const buffer = await deps.renderToBuffer(
      React.createElement(Renderer, { documentNumber, title, scopeDescription, awardedVendorName, amountCents, isDraft }) as any
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="subcontract-${documentNumber}.pdf"` },
    });
  } catch {
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
  }
}
