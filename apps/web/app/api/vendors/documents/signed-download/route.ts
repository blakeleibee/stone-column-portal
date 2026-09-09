import { NextResponse } from "next/server";
import { LocalFilesystemStorageAdapter, verifySignedLocalDownload } from "../../../../../src/server/storage/LocalFilesystemStorageAdapter";

/**
 * GET /api/vendors/documents/signed-download?key=&expires=&sig= — the
 * dev-only file-streaming counterpart to
 * LocalFilesystemStorageAdapter.getDownloadUrl's signed URL (Package
 * P5.1). This route deliberately does NOT re-check the caller's
 * session/role: the whole point of a signed URL is that the signature
 * + expiry (verified below, HMAC, constant-time comparison) is the
 * complete authorization proof, exactly like an S3 presigned URL — the
 * real authorization decision already happened once, at the moment
 * getDownloadUrl() was called from behind RLS (see
 * /api/vendors/[vendorId]/documents/[documentId]/download/route.ts).
 * A production deployment never reaches this route at all —
 * getStorageAdapter() only returns LocalFilesystemStorageAdapter when
 * MICROSOFT_GRAPH_CLIENT_ID is unset, i.e. never in production, where
 * OneDriveStorageAdapter's own Microsoft-Graph-issued download URLs are
 * used directly instead.
 *
 * Content-Type is guessed from the key's extension rather than looked
 * up in the database — this route intentionally has no database
 * dependency at all (judgment call: keeping a bearer-capability route
 * infrastructure-only, with zero further trust decisions to make,
 * mirrors how a real cloud provider's presigned URL works and avoids
 * needing a service-role client here).
 */
function guessMimeType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const expires = url.searchParams.get("expires");
  const sig = url.searchParams.get("sig");

  if (!key || !expires || !sig) {
    return NextResponse.json({ error: "Malformed signed download link." }, { status: 400 });
  }

  const verification = verifySignedLocalDownload(key, expires, sig);
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: 403 });
  }

  const adapter = new LocalFilesystemStorageAdapter();
  let bytes: Buffer;
  try {
    bytes = await adapter.readLocal(key);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const fileName = key.split("/").pop() ?? "download";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": guessMimeType(key),
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
