import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../../../../src/server/auth/getCurrentUser";
import { createServerSupabaseClient } from "../../../../../../../../src/server/supabase/serverClient";
import { getStorageAdapter } from "../../../../../../../../src/server/storage/getStorageAdapter";

const LINK_EXPIRY_SECONDS = 60 * 60;

/**
 * GET /api/bid-packages/[bidPackageId]/messages/attachments/[attachmentId]/download
 *
 * New route (P5.2 Phase D), matching /api/bid-packages/[bidPackageId]/
 * documents/[bidPackageDocumentId]/download/route.ts's own established
 * shape exactly, including its fix for the real "http://localhost"
 * origin bug found there (resolving the signed-URL redirect against
 * THIS request's own origin via `request.url`, never a hardcoded base).
 * No role check of its own: the SELECT runs through the caller's own
 * RLS-scoped client, and entity_message_attachments'/documents' real
 * policies (schema/028) already encode exactly who may see this row —
 * staff (any row on a project they staff) OR the one specific vendor
 * who owns the message it's attached to.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bidPackageId: string; attachmentId: string }> }
) {
  const { bidPackageId, attachmentId } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Two separate queries rather than a single filtered embed —
  // matching this codebase's own established "separate query per
  // relationship, never an ambiguous/fragile embed filter" convention
  // (bidService.ts's own askBidQuestion/listBidQuestions doc comments).
  const { data: link, error } = await supabase
    .from("entity_message_attachments")
    .select("id, entity_message_id, documents(storage_key, file_name, mime_type)")
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const document = (link as any)?.documents;
  if (!link || !document?.storage_key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: message, error: messageError } = await supabase
    .from("entity_messages")
    .select("id")
    .eq("id", link.entity_message_id)
    .eq("bid_package_id", bidPackageId)
    .maybeSingle();
  if (messageError) return NextResponse.json({ error: messageError.message }, { status: 500 });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const adapter = getStorageAdapter();
  const url = await adapter.getDownloadUrl(document.storage_key, { expiresInSeconds: LINK_EXPIRY_SECONDS });
  return NextResponse.redirect(new URL(url, request.url));
}
