import type { SupabaseClient } from "@supabase/supabase-js";
import { listAccessibleProjects } from "../../../../../packages/02-app-shell/src/services/projectService";

/**
 * P5.0 (Project-Context Write-Safety), requirement 5: "Server-side
 * validation of the target project for every affected create/write
 * action ... re-checked against the acting user's real access (the same
 * RLS-backed `listAccessibleProjects()` check `switchProject()` already
 * uses), not merely inferred from whatever the UI happened to display."
 *
 * Every project-scoped CREATE Server Action reachable from a page that
 * resolves its project via resolveSelectedProject()/
 * resolveProjectAndSwitcherData() must call this before writing a new
 * row, rather than trusting the `projectId` parameter the client sent.
 * That parameter originates from a Server Component's props into a
 * Client Component's event handler — before P5.0, a session with no (or
 * a stale) selected-project cookie could silently resolve to an
 * unintended project, and this is the check that stops a create action
 * from ever completing against a project the acting user doesn't
 * actually have access to, independent of whatever the page happened to
 * render. Reuses the exact `listAccessibleProjects(supabase, orgId)` +
 * membership check `switchProject()` (apps/web/app/admin/projects/
 * switchAction.ts) already performs, rather than inventing a second
 * access-check mechanism.
 *
 * Deliberately returns a boolean rather than throwing: callers already
 * have an established `{ data } | { error }` return convention (see
 * every apps/web/app/admin/**\/actions.ts file), and a thrown error from
 * a Server Action surfaces as an unhandled rejection / Next.js error
 * boundary in the calling Client Component instead of the inline error
 * text every other validation failure in these files produces.
 */
export async function isProjectAccessibleToUser(
  supabase: SupabaseClient,
  orgId: string,
  projectId: string
): Promise<boolean> {
  const projects = await listAccessibleProjects(supabase, orgId);
  return projects.some((project) => project.id === projectId);
}

/** Shared error text for every create action's project-validation
 *  rejection — one string, not five slightly different ones. */
export const PROJECT_NOT_ACCESSIBLE_ERROR = "That project is not accessible to you.";
