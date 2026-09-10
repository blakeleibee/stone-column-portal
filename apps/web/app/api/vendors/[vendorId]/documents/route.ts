import { NextResponse } from "next/server";
import { requireRole, AuthorizationError } from "../../../../../src/server/auth/require";
import { isAccountingOrAdminStaff } from "../../../../../src/server/auth/can";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { getStorageAdapter } from "../../../../../src/server/storage/getStorageAdapter";
import { recordVendorDocumentUpload, type VendorDocumentCategory } from "../../../../../../../packages/02-app-shell/src/services/vendorService";

const VALID_CATEGORIES: VendorDocumentCategory[] = ["w9", "certificate_of_insurance", "license", "other"];

/**
 * POST /api/vendors/[vendorId]/documents — multipart form fields
 * `file`, `category`, optional `expirationDate`. New route (Package
 * P5.1): vendor_documents is org-scoped, not project-scoped, so this
 * does NOT reuse the existing /api/documents/[id]/download route
 * family (which resolves everything through the project-scoped
 * `documents` table) — mirrors apps/web/app/api/imports/parse/route.ts's
 * multipart-parsing shape, the only other real upload precedent in this
 * codebase.
 *
 * Authorization is two-layered, same as every other write path in this
 * codebase: this route's own role check is a fast, clear 403/404 for
 * the common case, and the actual INSERT is still subject to
 * vendor_documents' real RLS policy (schema/020's category-conditional
 * w9 gate) as the ultimate enforcement — a non-accounting staff member
 * who somehow got past this route's check would still be rejected by
 * the database itself.
 */
export async function POST(request: Request, { params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;

  let user;
  try {
    user = await requireRole(["admin", "staff"]);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed multipart form body." }, { status: 400 });
  }

  const file = formData.get("file");
  const category = formData.get("category");
  const expirationDate = formData.get("expirationDate");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing or invalid 'file' field." }, { status: 400 });
  }
  if (typeof category !== "string" || !VALID_CATEGORIES.includes(category as VendorDocumentCategory)) {
    return NextResponse.json({ error: `'category' must be one of: ${VALID_CATEGORIES.join(", ")}.` }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Clear, specific 403 up front for the common case a non-accounting
  // staff member tries to upload a W-9 — RLS would reject the eventual
  // INSERT anyway, but this avoids a confusing generic 500 from a raw
  // Postgres RLS error reaching the UI.
  if (category === "w9" && !(await isAccountingOrAdminStaff(supabase))) {
    return NextResponse.json({ error: "Only accounting or admin staff may upload a W-9." }, { status: 403 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read uploaded file contents." }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `vendor-documents/${vendorId}/${category}/${Date.now()}-${safeName}`;

  const adapter = getStorageAdapter();
  await adapter.upload(storageKey, buffer, file.type || "application/octet-stream");

  const result = await recordVendorDocumentUpload(supabase, {
    vendorId,
    orgId: user.orgId,
    category: category as VendorDocumentCategory,
    storageKey,
    mimeType: file.type || null,
    sizeBytes: buffer.length,
    uploadedBy: user.id,
    expirationDate: typeof expirationDate === "string" && expirationDate ? expirationDate : null,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ id: result.id });
}
