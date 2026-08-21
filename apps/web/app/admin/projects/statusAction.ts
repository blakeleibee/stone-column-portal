"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  changeProjectStatus as changeProjectStatusService,
  type ProjectStatus,
} from "../../../../../packages/02-app-shell/src/services/projectService";

/**
 * Thin wrapper, same shape as createAction.ts/switchAction.ts — all the
 * real logic (the change_project_status() RPC call, which is itself
 * admin-only via is_org_admin_for_org() inside the function, and error
 * normalization) lives in projectService.changeProjectStatus; this only
 * constructs the request-scoped Supabase client and forwards the
 * params/return value unchanged. The UI hiding this control for
 * non-admins (ProjectListWorkspace.tsx) is cosmetic — this Server
 * Action performs no admin check of its own, same "UI hiding is
 * cosmetic, the RPC is real" framing already used throughout this
 * package (see projectService.ts's own comments).
 */
export async function changeProjectStatus(
  projectId: string,
  newStatus: ProjectStatus
): Promise<{ error: string } | {}> {
  const supabase = await createServerSupabaseClient();
  return changeProjectStatusService(supabase, projectId, newStatus);
}
