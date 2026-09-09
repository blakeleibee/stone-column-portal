export const runtime = "nodejs"; // @react-pdf/renderer requires Node APIs — never Edge (Decision 9)

import { NextRequest } from "next/server";
import { handleMaterialOrderPdfRequest } from "./handler";

/**
 * GET /api/procurement/material-orders/[id]/pdf — renders the purchase
 * order as a PDF, either from the frozen `issued_documents` snapshot
 * (once one exists — Decision 4) or a live "DRAFT" preview built from
 * the material order's current data (before anything has been issued).
 * `?version=N` renders a specific historical version instead of the
 * latest.
 *
 * All actual logic lives in ./handler.ts (see its header comment for
 * why) — this file stays deliberately minimal because Next.js's App
 * Router validates a route.ts module's exports at build time and
 * rejects any export beyond the recognized set (GET/POST/etc., config,
 * generateStaticParams, dynamic, revalidate, runtime).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleMaterialOrderPdfRequest(req, id);
}
