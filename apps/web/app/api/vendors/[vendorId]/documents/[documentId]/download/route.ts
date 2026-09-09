import { NextResponse } from "next/server";
import { requireRole, AuthorizationError } from "../../../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../../../src/server/supabase/serverClient";
import { getStorageAdapter } from "../../../../../../../src/server/storage/getStorageAdapter";
import { getW9DownloadUrl } from "../../../../../../../../../packages/02-app-shell/src/services/vendorService";

const W9_LINK_EXPIRY_SECONDS = 5 * 60; // short-lived, per the W-9 design decision
const ORDINARY_LINK_EXPIRY_SECONDS = 60 * 60; // generous, non-sensitive categories

/**
 * GET /api/vendors/[vendorId]/documents/[documentId]/download — new
 * route (Package P5.1), not a reuse of the project-scoped
 * /api/documents/[id]/download family (vendor_documents isn't
 * project-scoped). Every category goes through a real, time-limited
 * signed URL via StorageAdapter.getDownloadUrl's new `expiresInSeconds`
 * option (rather than the pre-existing, never-actually-wired unsigned
 * `/api/documents/download-by-key` path) — category='w9' additionally
 * routes through getW9DownloadUrl(), which writes the required
 * vendor_document_access_log row atomically with issuing the URL.
 *
 * Authorization: the SELECT itself runs through the caller's own
 * RLS-scoped Supabase client — a non-accounting/non-admin staff session
 * requesting a w9 document gets back no row at all (schema/020's
 * category-conditional policy), which this route reports as a plain
 * 404, the same denial-by-omission shape canViewDocument() already
 * uses elsewhere in this codebase (never confirms a restricted
 * document's existence to a caller who can't see it).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ vendorId: string; documentId: string }> }) {
  const { vendorId, documentId } = await params;

  let user;
  try {
    user = await requireRole(["admin", "staff"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const supabase = await createServerSupabaseClient();
  const { data: doc, error } = await supabase
    .from("vendor_documents")
    .select("id, category, storage_key")
    .eq("id", documentId)
    .eq("vendor_id", vendorId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const adapter = getStorageAdapter();

  if (doc.category === "w9") {
    const result = await getW9DownloadUrl(supabase, documentId, user.id, (key) => adapter.getDownloadUrl(key, { expiresInSeconds: W9_LINK_EXPIRY_SECONDS }));
    if (result.error || !result.url) {
      return NextResponse.json({ error: result.error ?? "Could not generate a download link." }, { status: 500 });
    }
    return NextResponse.redirect(new URL(result.url, "http://localhost"));
  }

  if (!doc.storage_key) {
    return NextResponse.json({ error: "No file has been uploaded for this document yet." }, { status: 404 });
  }
  const url = await adapter.getDownloadUrl(doc.storage_key, { expiresInSeconds: ORDINARY_LINK_EXPIRY_SECONDS });
  return NextResponse.redirect(new URL(url, "http://localhost"));
}
