"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  createProject as createProjectService,
  type CreateProjectParams,
} from "../../../../../packages/02-app-shell/src/services/projectService";

/**
 * Thin wrapper, same shape as every other Server Action in
 * apps/web/app/admin/**\/actions.ts — business logic (validation, the
 * create_project_with_defaults() RPC call, error normalization) lives
 * entirely in projectService.createProject; this only constructs the
 * request-scoped Supabase client and forwards params/return value
 * unchanged.
 */
export async function createProject(
  params: CreateProjectParams
): Promise<{ id: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  return createProjectService(supabase, params);
}
