/**
 * Integration tests for the P5 Task 10 PDF Route Handlers
 * (apps/web/app/api/procurement/material-orders/[id]/pdf/route.ts and
 * apps/web/app/api/bids/[bidPackageId]/subcontract-pdf/route.ts).
 * Follows import_parse_unit.ts / procurement_actions_unit.ts's "real
 * function, hand-rolled fakes, no network" style — this is this repo's
 * first Route Handler unit test, so there is no existing precedent for
 * how to substitute a fake `requireRole`/`createServerSupabaseClient`.
 *
 * The plan text for this task suggested "monkey-patch/mock requireRole
 * ... at the module level" — that does NOT work in this repo's actual
 * runtime: these .ts files execute as real ES modules under tsx (proven
 * empirically: `(importedModule as any).fn = ...` throws "Cannot assign
 * to read only property ... of object '[object Module]'", since a named
 * import is a read-only live binding, not a mutable property). Both
 * routes' actual logic therefore lives in a sibling handler.ts module
 * (`handleMaterialOrderPdfRequest`/`handleSubcontractPdfRequest`, each
 * taking an optional `deps` object that defaults to the real
 * collaborators), not in route.ts itself — see each handler.ts's own
 * header comment for why: Next.js's App Router rejects any route.ts
 * export beyond the recognized set (GET/POST/etc., config,
 * generateStaticParams, dynamic, revalidate, runtime) at build time, so
 * this dependency-injection seam couldn't live there either. Every test
 * below calls the handler function directly with a fake `deps` object;
 * `GET` itself (untouched, always using the real defaults) is never
 * invoked here.
 *
 * Each route gets the same 5 cases Decision 9 requires: 403 for a
 * wrong-role session, 404 for a nonexistent record, a safe 500 (never
 * leaking the underlying error) when rendering fails, the DRAFT
 * watermark prop present vs. absent depending on whether an
 * issued_documents row exists, and a safe 500 for an unrecognized
 * template_version (proving the registry-dispatch fallback is a real,
 * tested code path).
 *
 * Run with `npx tsx test/pdf_routes_integration.ts`.
 */
import { strict as assert } from "node:assert";
import { NextRequest } from "next/server";
import { AuthorizationError } from "../src/server/auth/require";
import { handleMaterialOrderPdfRequest, type MaterialOrderPdfRouteDeps } from "../app/api/procurement/material-orders/[id]/pdf/handler";
import { handleSubcontractPdfRequest, type SubcontractPdfRouteDeps } from "../app/api/bids/[bidPackageId]/subcontract-pdf/handler";
import type { IssuedDocumentRow } from "../../../packages/02-app-shell/src/services/documentIssuanceService";
import { MATERIAL_ORDER_PDF_RENDERERS } from "../../../packages/02-app-shell/src/pdf/MaterialOrderPdf";
import { SUBCONTRACT_PDF_RENDERERS } from "../../../packages/02-app-shell/src/pdf/SubcontractPdf";

let checks = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function fakeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"));
}

async function bodyText(res: Response): Promise<string> {
  return JSON.stringify(await res.clone().json());
}

// ---------------------------------------------------------------------
// Material order PDF route
// ---------------------------------------------------------------------

function baseMaterialOrderDeps(overrides: Partial<MaterialOrderPdfRouteDeps> = {}): MaterialOrderPdfRouteDeps {
  return {
    requireRole: (async () => ({ id: "u-1", orgId: "org-1", role: "admin" }) as any),
    createServerSupabaseClient: (async () => ({}) as any),
    getMaterialOrderDetail: (async () => null) as any,
    getLatestIssuedDocument: (async () => null) as any,
    getIssuedDocumentVersion: (async () => null) as any,
    renderToBuffer: (async () => Buffer.from("fake-pdf-bytes")) as any,
    renderers: MATERIAL_ORDER_PDF_RENDERERS,
    ...overrides,
  };
}

async function testMaterialOrderPdfRoute() {
  console.log("--- material order PDF route ---");

  {
    const deps = baseMaterialOrderDeps({
      requireRole: (async () => {
        throw new AuthorizationError('Role "client" is not permitted here.');
      }) as any,
    });
    const res = await handleMaterialOrderPdfRequest(fakeReq("/api/procurement/material-orders/mo-1/pdf"), "mo-1", deps);
    const text = await bodyText(res);
    check("returns 403, not 500, for a wrong-role authenticated session", res.status === 403);
    check("403 body is the clean { error: 'Forbidden' } shape, no leaked stack/message", text === JSON.stringify({ error: "Forbidden" }) && !text.includes("Error:"));
  }

  {
    const deps = baseMaterialOrderDeps({
      getMaterialOrderDetail: (async () => null) as any,
      getLatestIssuedDocument: (async () => null) as any,
    });
    const res = await handleMaterialOrderPdfRequest(fakeReq("/api/procurement/material-orders/does-not-exist/pdf"), "does-not-exist", deps);
    check("returns 404 for a nonexistent material order id", res.status === 404);
  }

  {
    const deps = baseMaterialOrderDeps({
      getMaterialOrderDetail: (async () => ({
        id: "mo-1",
        projectId: "proj-1",
        defaultCostCodeId: null,
        vendorId: null,
        orderNumber: "PO-1",
        status: "ordered",
        orderedAt: null,
        expectedDeliveryAt: null,
        lineItems: [{ id: "li-1", materialOrderId: "mo-1", costCodeId: "cc-1", description: "Lumber", quantity: 10, unit: "ea", unitPriceCents: 500, receivedQuantity: 0, backordered: false }],
      })) as any,
      getLatestIssuedDocument: (async () => null) as any,
      renderToBuffer: (async () => {
        throw new Error("renderer exploded — this message must never reach the client");
      }) as any,
    });
    const res = await handleMaterialOrderPdfRequest(fakeReq("/api/procurement/material-orders/mo-1/pdf"), "mo-1", deps);
    const text = await bodyText(res);
    check("returns a safe 500 when renderToBuffer throws", res.status === 500);
    check("500 body is the generic { error: 'Failed to render PDF' } shape, not the underlying exception's message", text === JSON.stringify({ error: "Failed to render PDF" }) && !text.includes("exploded"));
  }

  {
    let capturedIsDraftNoIssued: unknown;
    let capturedIsDraftIssued: unknown;

    const order = {
      id: "mo-1",
      projectId: "proj-1",
      defaultCostCodeId: null,
      vendorId: null,
      orderNumber: "PO-1",
      status: "ordered" as const,
      orderedAt: null,
      expectedDeliveryAt: null,
      lineItems: [{ id: "li-1", materialOrderId: "mo-1", costCodeId: "cc-1", description: "Lumber", quantity: 10, unit: "ea", unitPriceCents: 500, receivedQuantity: 0, backordered: false }],
    };

    const noIssuedDeps = baseMaterialOrderDeps({
      getMaterialOrderDetail: (async () => order) as any,
      getLatestIssuedDocument: (async () => null) as any,
      renderToBuffer: (async (element: any) => {
        capturedIsDraftNoIssued = element.props.isDraft;
        return Buffer.from("fake");
      }) as any,
    });
    await handleMaterialOrderPdfRequest(fakeReq("/api/procurement/material-orders/mo-1/pdf"), "mo-1", noIssuedDeps);

    const issuedDoc: IssuedDocumentRow = {
      id: "doc-1",
      documentType: "purchase_order",
      sourceId: "mo-1",
      documentNumber: "PO-1",
      version: 1,
      templateVersion: "1",
      issuedAt: "2026-08-20T00:00:00Z",
      issuedBy: "u-1",
      canonicalData: { vendorName: "Acme Lumber", lineItems: [], totalCents: 0 },
      supersededAt: null,
      supersededById: null,
    };
    const issuedDeps = baseMaterialOrderDeps({
      getLatestIssuedDocument: (async () => issuedDoc) as any,
      renderToBuffer: (async (element: any) => {
        capturedIsDraftIssued = element.props.isDraft;
        return Buffer.from("fake");
      }) as any,
    });
    await handleMaterialOrderPdfRequest(fakeReq("/api/procurement/material-orders/mo-1/pdf"), "mo-1", issuedDeps);

    check("renders the DRAFT watermark (isDraft=true) when no issued_documents row exists", capturedIsDraftNoIssued === true);
    check("omits the DRAFT watermark (isDraft=false) once an issued_documents row exists", capturedIsDraftIssued === false);
  }

  {
    const issuedDocUnknownVersion: IssuedDocumentRow = {
      id: "doc-1",
      documentType: "purchase_order",
      sourceId: "mo-1",
      documentNumber: "PO-1",
      version: 1,
      templateVersion: "99", // not a key in MATERIAL_ORDER_PDF_RENDERERS
      issuedAt: "2026-08-20T00:00:00Z",
      issuedBy: "u-1",
      canonicalData: { vendorName: "Acme Lumber", lineItems: [], totalCents: 0 },
      supersededAt: null,
      supersededById: null,
    };
    const deps = baseMaterialOrderDeps({ getLatestIssuedDocument: (async () => issuedDocUnknownVersion) as any });
    const res = await handleMaterialOrderPdfRequest(fakeReq("/api/procurement/material-orders/mo-1/pdf"), "mo-1", deps);
    const text = await bodyText(res);
    check("returns a safe 500 for an unrecognized template_version, not a crash", res.status === 500);
    check("unrecognized-template-version 500 body matches the same generic rendering-failure shape", text === JSON.stringify({ error: "Failed to render PDF" }));
  }
}

// ---------------------------------------------------------------------
// Subcontract PDF route
// ---------------------------------------------------------------------

function baseSubcontractDeps(overrides: Partial<SubcontractPdfRouteDeps> = {}): SubcontractPdfRouteDeps {
  return {
    requireRole: (async () => ({ id: "u-1", orgId: "org-1", role: "admin" }) as any),
    createServerSupabaseClient: (async () => ({}) as any),
    getBidPackageDetail: (async () => null) as any,
    getLatestIssuedDocument: (async () => null) as any,
    getIssuedDocumentVersion: (async () => null) as any,
    renderToBuffer: (async () => Buffer.from("fake-pdf-bytes")) as any,
    renderers: SUBCONTRACT_PDF_RENDERERS,
    ...overrides,
  };
}

const AWARDED_BID_PACKAGE = {
  id: "bp-1",
  projectId: "proj-1",
  costCodeId: "cc-1",
  title: "Framing",
  scopeDescription: "Frame the main structure.",
  dueAt: null,
  status: "awarded" as const,
  createdAt: "2026-01-01T00:00:00Z",
  submissions: [
    { id: "sub-1", bidPackageId: "bp-1", vendorId: "v-1", vendorName: "Acme Framing", status: "awarded" as const, amountCents: 500000, notes: null, submittedAt: "2026-01-02T00:00:00Z" },
  ],
};

async function testSubcontractPdfRoute() {
  console.log("--- subcontract PDF route ---");

  {
    const deps = baseSubcontractDeps({
      requireRole: (async () => {
        throw new AuthorizationError('Role "vendor" is not permitted here.');
      }) as any,
    });
    const res = await handleSubcontractPdfRequest(fakeReq("/api/bids/bp-1/subcontract-pdf"), "bp-1", deps);
    const text = await bodyText(res);
    check("returns 403, not 500, for a wrong-role authenticated session", res.status === 403);
    check("403 body is the clean { error: 'Forbidden' } shape, no leaked stack/message", text === JSON.stringify({ error: "Forbidden" }) && !text.includes("Error:"));
  }

  {
    const deps = baseSubcontractDeps({
      getBidPackageDetail: (async () => null) as any,
      getLatestIssuedDocument: (async () => null) as any,
    });
    const res = await handleSubcontractPdfRequest(fakeReq("/api/bids/does-not-exist/subcontract-pdf"), "does-not-exist", deps);
    check("returns 404 for a nonexistent bid package id", res.status === 404);
  }

  {
    const deps = baseSubcontractDeps({
      getBidPackageDetail: (async () => AWARDED_BID_PACKAGE) as any,
      getLatestIssuedDocument: (async () => null) as any,
      renderToBuffer: (async () => {
        throw new Error("renderer exploded — this message must never reach the client");
      }) as any,
    });
    const res = await handleSubcontractPdfRequest(fakeReq("/api/bids/bp-1/subcontract-pdf"), "bp-1", deps);
    const text = await bodyText(res);
    check("returns a safe 500 when renderToBuffer throws", res.status === 500);
    check("500 body is the generic { error: 'Failed to render PDF' } shape, not the underlying exception's message", text === JSON.stringify({ error: "Failed to render PDF" }) && !text.includes("exploded"));
  }

  {
    let capturedIsDraftNoIssued: unknown;
    let capturedIsDraftIssued: unknown;

    const noIssuedDeps = baseSubcontractDeps({
      getBidPackageDetail: (async () => AWARDED_BID_PACKAGE) as any,
      getLatestIssuedDocument: (async () => null) as any,
      renderToBuffer: (async (element: any) => {
        capturedIsDraftNoIssued = element.props.isDraft;
        return Buffer.from("fake");
      }) as any,
    });
    await handleSubcontractPdfRequest(fakeReq("/api/bids/bp-1/subcontract-pdf"), "bp-1", noIssuedDeps);

    const issuedDoc: IssuedDocumentRow = {
      id: "doc-1",
      documentType: "subcontract",
      sourceId: "bp-1",
      documentNumber: "SUB-1",
      version: 1,
      templateVersion: "1",
      issuedAt: "2026-08-20T00:00:00Z",
      issuedBy: "u-1",
      canonicalData: { title: "Framing", scopeDescription: "Frame the main structure.", awardedVendorName: "Acme Framing", amountCents: 500000 },
      supersededAt: null,
      supersededById: null,
    };
    const issuedDeps = baseSubcontractDeps({
      getLatestIssuedDocument: (async () => issuedDoc) as any,
      renderToBuffer: (async (element: any) => {
        capturedIsDraftIssued = element.props.isDraft;
        return Buffer.from("fake");
      }) as any,
    });
    await handleSubcontractPdfRequest(fakeReq("/api/bids/bp-1/subcontract-pdf"), "bp-1", issuedDeps);

    check("renders the DRAFT watermark (isDraft=true) when no issued_documents row exists", capturedIsDraftNoIssued === true);
    check("omits the DRAFT watermark (isDraft=false) once an issued_documents row exists", capturedIsDraftIssued === false);
  }

  {
    const issuedDocUnknownVersion: IssuedDocumentRow = {
      id: "doc-1",
      documentType: "subcontract",
      sourceId: "bp-1",
      documentNumber: "SUB-1",
      version: 1,
      templateVersion: "99", // not a key in SUBCONTRACT_PDF_RENDERERS
      issuedAt: "2026-08-20T00:00:00Z",
      issuedBy: "u-1",
      canonicalData: { title: "Framing", scopeDescription: null, awardedVendorName: "Acme Framing", amountCents: 500000 },
      supersededAt: null,
      supersededById: null,
    };
    const deps = baseSubcontractDeps({ getLatestIssuedDocument: (async () => issuedDocUnknownVersion) as any });
    const res = await handleSubcontractPdfRequest(fakeReq("/api/bids/bp-1/subcontract-pdf"), "bp-1", deps);
    const text = await bodyText(res);
    check("returns a safe 500 for an unrecognized template_version, not a crash", res.status === 500);
    check("unrecognized-template-version 500 body matches the same generic rendering-failure shape", text === JSON.stringify({ error: "Failed to render PDF" }));
  }
}

async function main() {
  await testMaterialOrderPdfRoute();
  await testSubcontractPdfRoute();
  console.log(`\npdf_routes_integration.ts: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
