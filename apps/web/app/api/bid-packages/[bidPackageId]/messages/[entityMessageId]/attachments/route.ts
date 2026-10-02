import { NextResponse } from "next/server";
import { requireRole, AuthorizationError } from "../../../../../../../src/server/auth/require";
import { canUploadDocument } from "../../../../../../../src/server/auth/can";
import { createServerSupabaseClient } from "../../../../../../../src/server/supabase/serverClient";
import { getStorageAdapter } from "../../../../../../../src/server/storage/getStorageAdapter";

/**
 * POST /api/bid-packages/[bidPackageId]/messages/[entityMessageId]/attachments
 * — multipart form field `file`. New route (P5.2 Phase D), staff-only
 * (matching this domain's own established "staff composes/uploads,
 * vendor reads" posture for the ONE UI surface this phase actually
 * ships — see schema/028's own comment on entity_message_attachments'
 * vendor INSERT policy being schema-ready but not wired to any screen
 * yet). Follows /api/bid-packages/[bidPackageId]/documents/route.ts's
 * exact shape: this route's own canUploadDocument() check is a fast,
 * clear 403 for the common case; the real enforcement is still
 * entity_message_attachments'/documents' RLS (schema/028).
 *
 * The parent entity_messages row must already exist (created by the
 * sendStaffMessage Server Action) and belong to THIS bid package —
 * re-verified here, not merely assumed from the URL.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ bidPackageId: string; entityMessageId: string }> }
) {
  const { bidPackageId, entityMessageId } = await params;

  let user;
  try {
    user = await requireRole(["admin", "staff"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const supabase = await createServerSupabaseClient();

  const { data: message, error: messageError } = await supabase
    .from("entity_messages")
    .select("id, bid_package_id, bid_packages(project_id)")
    .eq("id", entityMessageId)
    .eq("bid_package_id", bidPackageId)
    .maybeSingle();
  if (messageError) return NextResponse.json({ error: messageError.message }, { status: 500 });
  if (!message) return NextResponse.json({ error: "Message not found." }, { status: 404 });

  const projectId = (message as any).bid_packages?.project_id;
  if (!projectId || !(await canUploadDocument(projectId, supabase))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed multipart form body." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing or invalid 'file' field." }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read uploaded file contents." }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `entity-message-attachments/${entityMessageId}/${Date.now()}-${safeName}`;

  const adapter = getStorageAdapter();
  await adapter.upload(storageKey, buffer, file.type || "application/octet-stream");

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .insert({
      project_id: projectId,
      uploaded_by: user.id,
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: buffer.length,
      storage_key: storageKey,
    })
    .select("id")
    .single();
  if (documentError) return NextResponse.json({ error: documentError.message }, { status: 500 });

  const { data: attachment, error: attachmentError } = await supabase
    .from("entity_message_attachments")
    .insert({ entity_message_id: entityMessageId, document_id: document.id })
    .select("id")
    .single();
  if (attachmentError) return NextResponse.json({ error: attachmentError.message }, { status: 500 });

  return NextResponse.json({ id: attachment.id });
}
