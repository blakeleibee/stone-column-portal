import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../src/server/auth/getCurrentUser";
import { canViewProject } from "../../../../src/server/auth/can";
import { createServerSupabaseClient } from "../../../../src/server/supabase/serverClient";
import { stageImportBatch } from "../../../../../../packages/02-app-shell/src/services/importService";

/**
 * POST /api/imports/parse — multipart form fields `file`, `projectId`,
 * `mappingProfileId`. Thin adapter only (P4 final-review fix): parses
 * the multipart body into plain params, authenticates/authorizes the
 * request (a Route-Handler-specific concern — a future AI tool-calling
 * adapter would perform its own analogous check, per
 * docs/production-build/AI-ASSISTANT-ARCHITECTURE.md), constructs the
 * caller's Supabase client, and calls `stageImportBatch()`
 * (packages/02-app-shell/src/services/importService.ts) for every actual
 * business-logic step (loading the mapping profile, resolving cost
 * codes, duplicate detection, parsing, and the import_batches/import_rows
 * inserts). See that function's doc comment for the full raw_data
 * contract with `confirm_import_batch()`.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed multipart form body." }, { status: 400 });
  }

  const file = formData.get("file");
  const projectId = formData.get("projectId");
  const mappingProfileId = formData.get("mappingProfileId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing or invalid 'file' field." }, { status: 400 });
  }
  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "Missing or invalid 'projectId' field." }, { status: 400 });
  }
  if (typeof mappingProfileId !== "string" || !mappingProfileId) {
    return NextResponse.json({ error: "Missing or invalid 'mappingProfileId' field." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Staff/admin-only, project-scoped -- same check writes to this
  // project's financial data already require elsewhere. Resolved via
  // getCurrentUser()/canViewProject() directly (rather than the
  // canManageProject() convenience wrapper) so this route also has the
  // acting user's id on hand for stageImportBatch()'s `importedBy`,
  // without a second redundant profile lookup. Returns 404 (not 403) so
  // this route never confirms a project's existence to a caller who
  // can't see it.
  const user = await getCurrentUser(supabase);
  const allowed = !!user && (user.role === "admin" || user.role === "staff") && (await canViewProject(projectId, supabase));
  if (!allowed || !user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let fileContents: string;
  try {
    fileContents = await file.text();
  } catch {
    return NextResponse.json({ error: "Could not read uploaded file contents." }, { status: 400 });
  }

  const result = await stageImportBatch(supabase, {
    projectId,
    mappingProfileId,
    fileName: file.name,
    fileContents,
    importedBy: user.id,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ batchId: result.batchId, rowCounts: result.rowCounts });
}
