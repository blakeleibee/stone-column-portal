"use server";

import { createServerSupabaseClient } from "../supabase/serverClient";
import { getCurrentUser } from "../auth/getCurrentUser";
import { listAccessibleProjects, type ProjectRow } from "../../../../../packages/02-app-shell/src/services/projectService";
import { resolveSelectedProject } from "./resolveSelectedProject";

export interface ProjectSwitcherData {
  currentProject: ProjectRow | null;
  otherProjects: ProjectRow[];
  isAdmin: boolean;
}

/**
 * Called directly from AdminChrome.tsx (a Client Component, "use client")
 * on mount — this is the standard, supported Next.js App Router pattern
 * of importing a "use server" function straight into a Client Component
 * rather than threading it through as a prop from a Server Component.
 * AdminChrome is the ONE place every admin page's <AppShell> is
 * instantiated, so this single fetch is what makes ProjectSwitcher
 * appear on every admin screen (P3-DESIGN.md's UI section) without
 * Task 4 needing to touch /admin/overview, /admin/financials,
 * /admin/estimate, /admin/bids, or /admin/import individually — those
 * pages' OWN data (still fixture-bound / independently duplicated
 * "firstProject" queries) are Task 5's rewiring, untouched here.
 *
 * `client` role never gets a project switcher (ClientChrome doesn't call
 * this) — the `isAdmin`/role gate below is defense in depth for the
 * unlikely case this is ever called from somewhere else.
 */
export async function getProjectSwitcherData(): Promise<ProjectSwitcherData | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { error: "Not authenticated." };

  if (user.role !== "admin" && user.role !== "staff") {
    return { currentProject: null, otherProjects: [], isAdmin: false };
  }

  const [currentProject, allProjects] = await Promise.all([
    resolveSelectedProject(supabase, user.orgId),
    listAccessibleProjects(supabase, user.orgId),
  ]);

  const otherProjects = allProjects.filter((project) => project.id !== currentProject?.id);

  return { currentProject, otherProjects, isAdmin: user.role === "admin" };
}
