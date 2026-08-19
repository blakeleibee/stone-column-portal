"use server";

import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import {
  assignStaffToProject as assignStaffToProjectService,
  revokeStaffAssignment as revokeStaffAssignmentService,
  reactivateStaffAssignment as reactivateStaffAssignmentService,
  listProjectStaffAssignments as listProjectStaffAssignmentsService,
  type ProjectStaffAssignmentRow,
} from "../../../../../../../packages/02-app-shell/src/services/projectService";

/**
 * Thin Server Action wrappers, same shape as every other
 * apps/web/app/admin/**\/actions.ts file — all business logic (RLS-backed
 * writes, the assigned_by/revoked_by auth.uid() plumbing) lives entirely
 * in projectService.ts; these only construct the request-scoped
 * Supabase client and forward params/return values unchanged.
 */
export async function assignStaff(projectId: string, profileId: string) {
  const supabase = await createServerSupabaseClient();
  return assignStaffToProjectService(supabase, projectId, profileId);
}

export async function revokeAssignment(assignmentId: string) {
  const supabase = await createServerSupabaseClient();
  return revokeStaffAssignmentService(supabase, assignmentId);
}

export async function reactivateAssignment(assignmentId: string) {
  const supabase = await createServerSupabaseClient();
  return reactivateStaffAssignmentService(supabase, assignmentId);
}

// listProjectStaffAssignments throws on a Supabase error rather than
// returning { error } (see projectService.ts's own doc comments on that
// convention) — fine for a Server Component's initial load, but this
// Server Action is invoked from ProjectTeamWorkspace's reload() after
// every mutation and needs a normal return value to show inline error
// text, never an unhandled rejection. Same normalization pattern as
// apps/web/app/admin/bids/actions.ts's getBidPackageDetail.
export async function refreshAssignments(
  projectId: string
): Promise<{ assignments?: ProjectStaffAssignmentRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const assignments = await listProjectStaffAssignmentsService(supabase, projectId);
    return { assignments };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load staff assignments." };
  }
}
