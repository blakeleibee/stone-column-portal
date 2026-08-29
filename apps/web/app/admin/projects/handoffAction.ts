"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  updateStaffAssignmentHandoff as updateStaffAssignmentHandoffService,
  type StaffAssignmentHandoffFields,
} from "../../../../../packages/02-app-shell/src/services/projectIntakeService";

/**
 * Thin wrapper, same shape as createAction.ts/statusAction.ts — all the
 * real logic (the assignment->project_id lookup, the archived-project
 * guard, the column update) lives entirely in
 * projectIntakeService.updateStaffAssignmentHandoff; this only
 * constructs the request-scoped Supabase client and forwards params/
 * return value unchanged. Built now (P3.1 Task 3); the team-page handoff
 * fields UI that calls it is Task 9's job.
 */
export async function updateStaffAssignmentHandoff(
  assignmentId: string,
  fields: StaffAssignmentHandoffFields
): Promise<{} | { error: string }> {
  const supabase = await createServerSupabaseClient();
  return updateStaffAssignmentHandoffService(supabase, assignmentId, fields);
}
