export const runtime = "nodejs"; // @react-pdf/renderer requires Node APIs — never Edge (Decision 9)

import { NextRequest } from "next/server";
import { handleSubcontractPdfRequest } from "./handler";

/**
 * GET /api/bids/[bidPackageId]/subcontract-pdf — same snapshot-or-draft
 * rendering shape as the material-order PDF route (see that route's
 * handler.ts header comment). `?version=N` renders a specific
 * historical version.
 *
 * All actual logic lives in ./handler.ts (see its header comment for
 * why) — this file stays deliberately minimal because Next.js's App
 * Router validates a route.ts module's exports at build time and
 * rejects any export beyond the recognized set (GET/POST/etc., config,
 * generateStaticParams, dynamic, revalidate, runtime).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ bidPackageId: string }> }) {
  const { bidPackageId } = await params;
  return handleSubcontractPdfRequest(req, bidPackageId);
}
