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
 *      access to, e.g. a revoked staff assignment — it falls through to
 *      case 2 below, exactly like "no cookie at all");
 *   2. otherwise null — no cookie, or a cookie naming a project the
 *      caller can no longer see.
 *
 * P5.0 (Project-Context Write-Safety) removed this function's previous
 * third branch, which silently fell back to `projects[0]` (the
 * alphabetically-first accessible project, per listAccessibleProjects'
 * `.order("name")`) whenever there was no cookie or a stale one. That
 * silent fallback was the confirmed root cause of a real incident: a
 * session with no cookie set landed on an unrelated, data-empty project
 * with nothing on screen indicating the switch, and a create action from
 * that state would have written a new record under the wrong project
 * with no warning at all (docs/production-build/P5-EXTENSION-PACKAGES-
 * DESIGN.md §3/§5). `null` now means "the caller must explicitly select
 * a project before this page can show or write anything," regardless of
 * whether the org has zero accessible projects or merely hasn't chosen
 * one yet — every caller of `resolveSelectedProject()`/
 * `resolveProjectAndSwitcherData()` already handles a `null` project by
 * rendering an empty state; P5.0's own change was teaching those
 * callers to distinguish "zero accessible projects" from "projects
 * exist, none selected" using `switcherData.otherProjects`/
 * `hasArchivedProjects` rather than changing this contract further.
 *
 * Deliberately does NOT special-case "the org has exactly one
 * accessible project" by auto-selecting it — the safer, more literal
 * reading of "no silent fallback" is that ANY project selection the
 * user didn't explicitly make is a silent one, even when there's only
 * one candidate. The resulting "select a project" UI still makes
 * picking that one project a single click (NoProjectSelected.tsx lists
 * every accessible project as a button, including when there's only
 * one), so this costs the user one click the first time per browser
 * session/cookie expiry, not a materially worse experience — and it
 * keeps this function's contract uniform rather than depending on
 * `projects.length`, which would silently change behavior for an org
 * the moment a second project is created.
 */
export async function resolveSelectedProjectForCookieValue(
  supabase: SupabaseClient,
  orgId: string,
  cookieProjectId: string | null
): Promise<ProjectRow | null> {
  if (!cookieProjectId) return null;
  const projects = await listAccessibleProjects(supabase, orgId);
  return projects.find((project) => project.id === cookieProjectId) ?? null;
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
