import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listAccessibleProjects,
  type ProjectRow,
} from "../../../../../packages/02-app-shell/src/services/projectService";
import { resolveSelectedProject } from "./resolveSelectedProject";
import type { ProjectSwitcherData } from "./switcherDataAction";

export interface ResolvedProjectAndSwitcherData {
  /** The project this page's own content should scope to. `null` means
   *  the org has zero accessible projects — callers render their
   *  existing "No projects yet" empty state, unchanged from today. */
  project: ProjectRow | null;
  /** Ready to pass straight through as AdminChrome's `projectSwitcherData`
   *  prop — same shape getProjectSwitcherData() (switcherDataAction.ts)
   *  returns on its non-error path, computed here from data the caller
   *  already needs for its own page content, so no page does two
   *  independent resolveSelectedProject()/listAccessibleProjects() round
   *  trips (one for its content, one for the switcher). */
  switcherData: ProjectSwitcherData;
}

/**
 * Task 5: the single place every rewired admin page (overview,
 * financials, estimate, bids, import) resolves both (a) which project its
 * own content should scope to and (b) the data AdminChrome's
 * ProjectSwitcher needs — one resolveSelectedProject() + one
 * listAccessibleProjects() call, shared between both needs, per page
 * request. `role` is passed in rather than re-derived because every
 * caller already has it from requireRole(["admin","staff"]) — this
 * mirrors getProjectSwitcherData()'s isAdmin computation exactly (that
 * function's own role !== "admin"/"staff" early-return doesn't need
 * duplicating here since requireRole() already enforced it upstream).
 */
export async function resolveProjectAndSwitcherData(
  supabase: SupabaseClient,
  orgId: string,
  role: string
): Promise<ResolvedProjectAndSwitcherData> {
  const [project, allProjects] = await Promise.all([
    resolveSelectedProject(supabase, orgId),
    listAccessibleProjects(supabase, orgId),
  ]);

  const otherProjects = allProjects.filter((p) => p.id !== project?.id);

  return {
    project,
    switcherData: {
      currentProject: project,
      otherProjects,
      isAdmin: role === "admin",
    },
  };
}
