import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listAccessibleProjects,
  type ProjectRow,
} from "../../../../../packages/02-app-shell/src/services/projectService";

/**
 * The ONE place this name is decided. Task 4's project-switcher UI
 * (switchAction.ts, which sets this cookie) and every Task 5 page
 * (which calls resolveSelectedProject() below, which reads it) both
 * import this constant rather than re-typing the string — see
 * switchAction.ts.
 */
export const SELECTED_PROJECT_COOKIE_NAME = "sc_selected_project_id";

/**
 * Pure resolution logic, deliberately independent of Next.js's
 * cookies() so it's directly unit-testable without a request context:
 * given the org's real accessible-project list and whatever project id
 * (if any) the cookie currently names, returns —
 *   1. the cookie's project, if it's still in that real list
 *      (listAccessibleProjects is RLS-filtered, so this also silently
 *      self-heals a stale cookie pointing at a project the caller lost
 *      access to, e.g. a revoked staff assignment);
 *   2. otherwise the list's first entry;
 *   3. otherwise null (the org has zero accessible projects — callers
 *      render the existing "No projects yet" empty state, unchanged
 *      from today's /admin/bids, /admin/estimate, /admin/import,
 *      /admin/financials "first project" convention).
 */
export async function resolveSelectedProjectForCookieValue(
  supabase: SupabaseClient,
  orgId: string,
  cookieProjectId: string | null
): Promise<ProjectRow | null> {
  const projects = await listAccessibleProjects(supabase, orgId);
  if (projects.length === 0) return null;

  if (cookieProjectId) {
    const matched = projects.find((project) => project.id === cookieProjectId);
    if (matched) return matched;
  }

  return projects[0];
}

/**
 * The function every Task 5 page calls. Reads the selected-project
 * cookie itself (server-only, via next/headers's cookies() — this file
 * is imported only from Server Components/Server Actions) and delegates
 * to the pure resolver above. Split into two exports deliberately: this
 * one is the convenient, request-scoped entry point; the other is the
 * testable core with no framework dependency.
 */
export async function resolveSelectedProject(
  supabase: SupabaseClient,
  orgId: string
): Promise<ProjectRow | null> {
  const cookieStore = await cookies();
  const cookieProjectId = cookieStore.get(SELECTED_PROJECT_COOKIE_NAME)?.value ?? null;
  return resolveSelectedProjectForCookieValue(supabase, orgId, cookieProjectId);
}
