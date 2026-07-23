import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../supabase/serverClient";
import { getCurrentUser } from "./getCurrentUser";
import type { AppRole, AppUser } from "./types";

export class AuthorizationError extends Error {}

type SupabaseLike = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Redirects to /login if there's no valid session. Every protected
 *  Server Component calls this (or a require* that calls it) directly
 *  -- never relies on middleware alone. */
export async function requireAuthenticatedUser(client?: SupabaseLike): Promise<AppUser> {
  const user = await getCurrentUser(client);
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(roles: AppRole[], client?: SupabaseLike): Promise<AppUser> {
  const user = await requireAuthenticatedUser(client);
  if (!roles.includes(user.role)) {
    throw new AuthorizationError(`Role "${user.role}" is not permitted here (requires one of: ${roles.join(", ")}).`);
  }
  return user;
}

/** Confirms the current user can access the given project — staff/admin
 *  org-wide, or client/vendor via their own project_members row —
 *  through a REAL query subject to RLS, not a JWT-claim shortcut. */
export async function requireProjectAccess(projectId: string, client?: SupabaseLike): Promise<AppUser> {
  const supabase = client ?? (await createServerSupabaseClient());
  const user = await requireAuthenticatedUser(supabase);

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();

  if (!project) {
    throw new AuthorizationError(`Project ${projectId} is not accessible to the current user.`);
  }
  return user;
}

export async function requireOrganizationAccess(orgId: string, client?: SupabaseLike): Promise<AppUser> {
  const user = await requireAuthenticatedUser(client);
  if (user.orgId !== orgId) {
    throw new AuthorizationError(`Organization ${orgId} is not accessible to the current user.`);
  }
  return user;
}
