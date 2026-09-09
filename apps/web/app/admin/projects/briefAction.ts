"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  upsertProjectBrief as upsertProjectBriefService,
  type ProjectBriefWriteFields,
} from "../../../../../packages/02-app-shell/src/services/projectIntakeService";
import {
  updateProjectPhaseAndTiming as updateProjectPhaseAndTimingService,
  type ProjectPhaseAndTimingWriteFields,
} from "../../../../../packages/02-app-shell/src/services/projectService";

/**
 * Thin wrapper, same shape as createAction.ts/statusAction.ts — all the
 * real logic (the upsert, the archived-project guard, the
 * partial-write/pickDefined() semantics) lives entirely in
 * projectIntakeService.upsertProjectBrief; this only constructs the
 * request-scoped Supabase client and forwards params/return value
 * unchanged. Built now (P3.1 Task 3); the Concept & Scope screen that
 * calls it is Task 5's job.
 */
export async function upsertProjectBrief(
  projectId: string,
  fields: ProjectBriefWriteFields
): Promise<{} | { error: string }> {
  const supabase = await createServerSupabaseClient();
  return upsertProjectBriefService(supabase, projectId, fields);
}

/**
 * Thin wrapper over projectService.updateProjectPhaseAndTiming() — the
 * Task 5 gap closure for design §5's "phase reuses projects.phase;
 * desired timing reuses projects.start_date/target_completion_date"
 * plumbing, which had no write path anywhere before this. Co-located in
 * this file (rather than a separate phaseTimingAction.ts) because the
 * Concept & Scope screen's single "Save" submits both this and
 * upsertProjectBrief above together as one logical form.
 */
export async function updateProjectPhaseAndTiming(
  projectId: string,
  fields: ProjectPhaseAndTimingWriteFields
): Promise<{} | { error: string }> {
  const supabase = await createServerSupabaseClient();
  return updateProjectPhaseAndTimingService(supabase, projectId, fields);
}
