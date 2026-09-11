import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../../../src/server/auth/getCurrentUser";
import { createServerSupabaseClient } from "../../../../../../../src/server/supabase/serverClient";
import { getStorageAdapter } from "../../../../../../../src/server/storage/getStorageAdapter";

const LINK_EXPIRY_SECONDS = 60 * 60; // generous — bid package documents aren't W-9-sensitive.

/**
 * GET /api/bid-packages/[bidPackageId]/documents/[bidPackageDocumentId]/download
 *
 * New route (Package P5.2 Phase B). Deliberately usable by BOTH a
 * staff session and an invited vendor session — unlike the W-9 route's
 * own single-role posture, this route has no role check of its own at
 * all: the SELECT below runs through the CALLER'S OWN RLS-scoped
 * client, and bid_package_documents/documents' real policies
 * (schema/025) already encode exactly who may see this specific row —
 * staff (any row on a project they staff) OR an invited vendor (only a
 * non-internal-only row on a package they're actually invited to).
 * A client-role session (no policy grants it anything here) or a
 * vendor requesting an internal_only-linked document both get the same
 * clean 404 `canViewDocument()` already established elsewhere in this
 * codebase — never a 500, never a hint that a restricted document
 * exists.
 *
 * Always issues a real, time-limited SIGNED url via
 * StorageAdapter.getDownloadUrl's `expiresInSeconds` option (P5.1's own
 * extension) rather than the older unsigned `/api/documents/[id]/
 * download` -> `/api/documents/download-by-key` path — that path's own
 * target route does not actually exist in this codebase today (a
 * separate, pre-existing gap this route deliberately avoids inheriting,
 * flagged in this package's report rather than silently fixed inline,
 * since it belongs to the older, out-of-scope `documents` upload flow).
 *
 * Resolves the relative signed-URL path against THIS REQUEST's own
 * origin (`request.url`), not a hardcoded "http://localhost" base — a
 * real browser walkthrough of this exact route caught a genuine defect
 * in the pattern `/api/documents/[id]/download/route.ts` and P5.1's
 * `/api/vendors/[vendorId]/documents/[documentId]/download/route.ts`
 * both already use (`new URL(url, "http://localhost")`): on any dev
 * server not literally bound to port 80 (this repo's own dev server
 * runs on 127.0.0.1:5173), that produces a Location header pointing at
 * a host:port nothing listens on, so the redirect silently fails to
 * connect. Confirmed live: `curl http://localhost/` times out while
 * `curl http://localhost:5173/` succeeds. Fixed here, in this NEW file
 * only — the two pre-existing P1/P5.1 routes are left untouched
 * (out of scope for this package) and this finding is called out in
 * this phase's report rather than patched inline there.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bidPackageId: string; bidPackageDocumentId: string }> }
) {
  const { bidPackageId, bidPackageDocumentId } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: link, error } = await supabase
    .from("bid_package_documents")
    .select("id, documents(storage_key, file_name, mime_type)")
    .eq("id", bidPackageDocumentId)
    .eq("bid_package_id", bidPackageId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const document = (link as any)?.documents;
  if (!link || !document?.storage_key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const adapter = getStorageAdapter();
  const url = await adapter.getDownloadUrl(document.storage_key, { expiresInSeconds: LINK_EXPIRY_SECONDS });
  return NextResponse.redirect(new URL(url, request.url));
}
