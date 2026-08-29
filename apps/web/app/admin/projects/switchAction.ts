"use server";

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { getCurrentUser } from "../../../src/server/auth/getCurrentUser";
import { listAccessibleProjects } from "../../../../../packages/02-app-shell/src/services/projectService";
import { SELECTED_PROJECT_COOKIE_NAME } from "../../../src/server/project/resolveSelectedProject";

/**
 * Re-validates the submitted project id against a fresh
 * listAccessibleProjects() call before setting the cookie — never
 * trusts the client-submitted id blindly (Decision 8). A client could
 * submit any string here (e.g. a project id copy-pasted from a
 * different org, or one the caller's staff_function assignment no
 * longer covers); listAccessibleProjects is RLS-filtered, so this is
 * the same real access check every page's data fetch would apply, just
 * run before the cookie is trusted rather than after.
 */
export async function switchProject(projectId: string): Promise<{ id: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { error: "Not authenticated." };

  const projects = await listAccessibleProjects(supabase, user.orgId);
  const matched = projects.find((project) => project.id === projectId);
  if (!matched) {
    return { error: "That project is not accessible to you." };
  }

  const cookieStore = await cookies();
  cookieStore.set(SELECTED_PROJECT_COOKIE_NAME, matched.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return { id: matched.id };
}
