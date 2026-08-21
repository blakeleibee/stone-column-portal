"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  changeProjectStatus as changeProjectStatusService,
  type ProjectStatus,
} from "../../../../../packages/02-app-shell/src/services/projectService";

/**
 * Thin wrapper, same shape as createAction.ts/switchAction.ts — all the
 * real logic (the change_project_status() RPC call and error
 * normalization) lives in projectService.changeProjectStatus; this only
 * constructs the request-scoped Supabase client and forwards the
 * params/return value unchanged. The UI hiding this control for
 * non-admins (ProjectListWorkspace.tsx) is cosmetic — this Server
 * Action performs no admin check of its own, same "UI hiding is
 * cosmetic, the [RLS/RPC/trigger] is real" framing already used
 * throughout this package.
 *
 * FIX ROUND 1 (independent review, empirically proven): the RPC's own
 * is_org_admin_for_org() check is a friendly pre-check, not the actual
 * authorization boundary — a non-admin caller can bypass this RPC
 * entirely with a raw supabase.from("projects").update(...) call, since
 * projects_staff_update's RLS policy (schema/016) admits any
 * non-superintendent staff, not just admins. The real boundary is now
 * inside enforce_project_status_transition() (schema/017 FIX ROUND 1) —
 * a database trigger every write path funnels through, including this
 * RPC's own UPDATE and any direct PostgREST call. This Server Action
 * and the RPC it wraps exist to surface a clear error before ever
 * reaching that trigger, not because either is what actually stops a
 * non-admin.
 */
export async function changeProjectStatus(
  projectId: string,
  newStatus: ProjectStatus
): Promise<{ error: string } | {}> {
  const supabase = await createServerSupabaseClient();
  return changeProjectStatusService(supabase, projectId, newStatus);
}
