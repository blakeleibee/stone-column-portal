import { NextResponse } from "next/server";
import { requireRole, AuthorizationError } from "../../../../../src/server/auth/require";
import { canUploadDocument } from "../../../../../src/server/auth/can";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { getStorageAdapter } from "../../../../../src/server/storage/getStorageAdapter";
import { uploadBidPackageDocument, type BidPackageDocumentCategory } from "../../../../../../../packages/02-app-shell/src/services/bidService";

const VALID_CATEGORIES: BidPackageDocumentCategory[] = ["plans", "specifications", "scope", "photos", "addenda", "reference", "other"];

/**
 * POST /api/bid-packages/[bidPackageId]/documents — multipart form
 * fields `file`, `category`, `internalOnly` ("true"/"false"), optional
 * `replaces` (an existing bid_package_documents.id being superseded by
 * this upload). New route (Package P5.2 Phase B): bid_package_documents
 * is project-scoped (via its parent bid package), unlike P5.1's
 * vendor_documents route (org-scoped) — this is a genuinely NEW route,
 * not a reuse of that one, but follows its exact multipart-parsing
 * shape (itself following apps/web/app/api/imports/parse/route.ts, the
 * only other real upload precedent in this codebase).
 *
 * canUploadDocument(projectId) — defined in schema/P1's auth/can.ts and
 * already correctly written, but never called anywhere until now (the
 * design doc's own "~70% of the plumbing already exists, unused"
 * finding) — gets its first real call site here, exactly as intended.
 * Authorization is two-layered like every other write path in this
 * codebase: this route's own check is a fast, clear 403 for the common
 * case; the actual INSERT is still subject to bid_package_documents'
 * and documents' real RLS (schema/025) as the ultimate enforcement.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bidPackageId: string }> }) {
  const { bidPackageId } = await params;

  let user;
  try {
    user = await requireRole(["admin", "staff"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const supabase = await createServerSupabaseClient();

  const { data: bidPackage, error: bidPackageError } = await supabase
    .from("bid_packages")
    .select("project_id")
    .eq("id", bidPackageId)
    .maybeSingle();
  if (bidPackageError) return NextResponse.json({ error: bidPackageError.message }, { status: 500 });
  if (!bidPackage) return NextResponse.json({ error: "Bid package not found." }, { status: 404 });

  if (!(await canUploadDocument(bidPackage.project_id, supabase))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed multipart form body." }, { status: 400 });
  }

  const file = formData.get("file");
  const category = formData.get("category");
  const internalOnlyRaw = formData.get("internalOnly");
  const replaces = formData.get("replaces");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing or invalid 'file' field." }, { status: 400 });
  }
  if (typeof category !== "string" || !VALID_CATEGORIES.includes(category as BidPackageDocumentCategory)) {
    return NextResponse.json({ error: `'category' must be one of: ${VALID_CATEGORIES.join(", ")}.` }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read uploaded file contents." }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `bid-package-documents/${bidPackageId}/${category}/${Date.now()}-${safeName}`;

  const adapter = getStorageAdapter();
  await adapter.upload(storageKey, buffer, file.type || "application/octet-stream");

  const result = await uploadBidPackageDocument(supabase, {
    projectId: bidPackage.project_id,
    bidPackageId,
    storageKey,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: buffer.length,
    category: category as BidPackageDocumentCategory,
    internalOnly: internalOnlyRaw === "true",
    uploadedBy: user.id,
    replacesId: typeof replaces === "string" && replaces ? replaces : undefined,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ id: result.id });
}
