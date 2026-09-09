"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  upsertProjectSiteInfo as upsertProjectSiteInfoService,
  type ProjectSiteInfoWriteFields,
} from "../../../../../packages/02-app-shell/src/services/projectIntakeService";

/**
 * Thin wrapper, same shape as createAction.ts/statusAction.ts — all the
 * real logic (the upsert, the archived-project guard, the
 * partial-write/pickDefined() semantics) lives entirely in
 * projectIntakeService.upsertProjectSiteInfo; this only constructs the
 * request-scoped Supabase client and forwards params/return value
 * unchanged. Built now (P3.1 Task 3); the Property & Site Info screen
 * that calls it is Task 5's job.
 */
export async function upsertProjectSiteInfo(
  projectId: string,
  fields: ProjectSiteInfoWriteFields
): Promise<{} | { error: string }> {
  const supabase = await createServerSupabaseClient();
  return upsertProjectSiteInfoService(supabase, projectId, fields);
}
