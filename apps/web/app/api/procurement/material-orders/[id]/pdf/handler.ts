import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { requireRole, AuthorizationError } from "../../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../../src/server/supabase/serverClient";
import { getMaterialOrderDetail } from "../../../../../../../../packages/02-app-shell/src/services/procurementService";
import { getLatestIssuedDocument, getIssuedDocumentVersion } from "../../../../../../../../packages/02-app-shell/src/services/documentIssuanceService";
import { MATERIAL_ORDER_PDF_RENDERERS, type MaterialOrderPdfLineItem } from "../../../../../../../../packages/02-app-shell/src/pdf/MaterialOrderPdf";
import { MATERIAL_ORDER_PDF_TEMPLATE_VERSION } from "../../../../../../../../packages/02-app-shell/src/pdf/templateVersions";
// renderToBuffer is re-exported from packages/02-app-shell (not imported
// directly from "@react-pdf/renderer" here) — see pdfRenderer.ts's
// header comment for why a bare npm specifier can't resolve from an
// apps/web file.
import { renderToBuffer } from "../../../../../../../../packages/02-app-shell/src/pdf/pdfRenderer";

/**
 * GET /api/procurement/material-orders/[id]/pdf's actual logic — split
 * out of route.ts (Task 10) because Next.js's App Router validates a
 * route.ts module's exports at build time (`.next/types/...`) and
 * rejects ANY export other than the recognized set (GET/POST/etc.,
 * config, generateStaticParams, dynamic, revalidate, runtime) — the
 * build fails with "Property '...' is incompatible with index
 * signature" if a route.ts exports anything else. This file is a plain
 * module with no such restriction, so the actual dependency-injection
 * seam this task needs for apps/web/test/pdf_routes_integration.ts
 * lives here; route.ts (in this same directory) re-exports nothing
 * from here except by calling `handleMaterialOrderPdfRequest` from
 * inside its own `GET`.
 *
 * Dependency-injection seam (Task 10): `handleMaterialOrderPdfRequest`
 * takes every collaborator as an explicit `deps` argument, defaulting
 * to the real ones. This is NOT how any other Route Handler in this
 * repo is structured (they call their collaborators directly) — it
 * exists because this is the first Route Handler this repo unit-tests
 * in isolation, and this repo's usual "mock a named import at the
 * module level" idea (the plan text's own suggestion) does not
 * actually work here: these files run as real ES modules (verified
 * empirically), where a named import is a read-only live binding —
 * `(mod as any).fn = ...` throws "Cannot assign to read only property"
 * rather than silently no-op'ing. A real seam is the only way to
 * substitute a fake `requireRole`/`renderToBuffer`/etc. from a test
 * without a module-mocking library, which this repo has none of.
 * `GET` itself always calls this with the untouched real dependencies —
 * nothing about the live route's behavior changes.
 */
export interface MaterialOrderPdfRouteDeps {
  requireRole: typeof requireRole;
  createServerSupabaseClient: typeof createServerSupabaseClient;
  getMaterialOrderDetail: typeof getMaterialOrderDetail;
  getLatestIssuedDocument: typeof getLatestIssuedDocument;
  getIssuedDocumentVersion: typeof getIssuedDocumentVersion;
  renderToBuffer: typeof renderToBuffer;
  renderers: typeof MATERIAL_ORDER_PDF_RENDERERS;
}

const defaultDeps: MaterialOrderPdfRouteDeps = {
  requireRole,
  createServerSupabaseClient,
  getMaterialOrderDetail,
  getLatestIssuedDocument,
  getIssuedDocumentVersion,
  renderToBuffer,
  renderers: MATERIAL_ORDER_PDF_RENDERERS,
};

export async function handleMaterialOrderPdfRequest(
  req: NextRequest,
  id: string,
  deps: MaterialOrderPdfRouteDeps = defaultDeps
): Promise<NextResponse> {
  try {
    await deps.requireRole(["admin", "staff"]);
  } catch (err) {
    // AuthorizationError has no Route Handler error boundary to land in
    // gracefully (unlike a Server Component) — must be caught and
    // converted explicitly, or every wrong-role request gets a raw 500.
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err; // unauthenticated: requireAuthenticatedUser's redirect("/login") propagates
  }

  const supabase = await deps.createServerSupabaseClient();
  const requestedVersion = req.nextUrl.searchParams.get("version");

  let documentNumber: string;
  let vendorName: string;
  let lineItems: MaterialOrderPdfLineItem[];
  let totalCents: number;
  let isDraft: boolean;
  let templateVersion: string;

  if (requestedVersion) {
    const snapshot = await deps.getIssuedDocumentVersion(supabase, "purchase_order", id, Number(requestedVersion));
    if (!snapshot) return NextResponse.json({ error: "Purchase order version not found" }, { status: 404 });
    const data = snapshot.canonicalData as any;
    documentNumber = snapshot.documentNumber;
    vendorName = data.vendorName;
    lineItems = data.lineItems;
    totalCents = data.totalCents;
    isDraft = false;
    templateVersion = snapshot.templateVersion;
  } else {
    const latestIssued = await deps.getLatestIssuedDocument(supabase, "purchase_order", id);
    if (latestIssued) {
      const data = latestIssued.canonicalData as any;
      documentNumber = latestIssued.documentNumber;
      vendorName = data.vendorName;
      lineItems = data.lineItems;
      totalCents = data.totalCents;
      isDraft = false;
      templateVersion = latestIssued.templateVersion;
    } else {
      const detail = await deps.getMaterialOrderDetail(supabase, id);
      if (!detail) return NextResponse.json({ error: "Material order not found" }, { status: 404 });
      const { data: vendorRow } = detail.vendorId
        ? await supabase.from("vendors").select("name").eq("id", detail.vendorId).maybeSingle()
        : { data: null };
      documentNumber = detail.orderNumber ?? detail.id.slice(0, 8);
      vendorName = vendorRow?.name ?? "Unknown vendor";
      lineItems = detail.lineItems.map((li) => ({
        description: li.description,
        costCodeId: li.costCodeId,
        quantity: li.quantity,
        unit: li.unit,
        unitPriceCents: li.unitPriceCents,
        lineTotalCents: li.quantity * li.unitPriceCents,
      }));
      totalCents = lineItems.reduce((sum, li) => sum + (li.lineTotalCents ?? 0), 0);
      isDraft = true;
      templateVersion = MATERIAL_ORDER_PDF_TEMPLATE_VERSION;
    }
  }

  // Resolve the EXACT renderer this snapshot was issued under (or the
  // current one, for a draft) — never "whatever MaterialOrderPdf
  // currently exports." An unrecognized version is a data-integrity
  // case that should never occur in practice but is defensively
  // handled the same as any other rendering failure (Decision 4/9).
  const Renderer = deps.renderers[templateVersion];
  if (!Renderer) {
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
  }

  try {
    // The registry-dispatch pattern (Decision 4) means `Renderer` is
    // whatever concrete PDF template component this template_version
    // maps to — its own prop type (MaterialOrderPdfProps) is
    // necessarily unrelated to @react-pdf/renderer's own `DocumentProps`
    // (the type `renderToBuffer` itself declares), even though at
    // runtime every registered component renders a real <Document> root
    // (verified by the real, unmocked render in this task's own
    // manual-verification step). The cast below is that one narrow,
    // deliberate escape hatch — not a broad `any`-typing of this
    // function or its deps.
    const buffer = await deps.renderToBuffer(
      React.createElement(Renderer, { documentNumber, vendorName, lineItems, totalCents, isDraft }) as any
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="po-${documentNumber}.pdf"` },
    });
  } catch {
    // Never leak a stack trace or renderer internals in the response body.
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
  }
}
