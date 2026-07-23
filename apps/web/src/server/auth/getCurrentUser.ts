import { createServerSupabaseClient } from "../supabase/serverClient";
import type { AppUser } from "./types";

/**
 * Every authorization helper in this module is built on this one
 * function -- a future auth-provider change touches this file's
 * internals, not every route that calls requireRole()/canViewProject()/etc.
 * Queries `profiles` through the CURRENT USER's own Supabase client
 * (their JWT, subject to RLS) -- never the service-role client -- so
 * RLS is always the second, independent enforcement layer behind every
 * check built on this function.
 */
export async function getCurrentUser(
  client?: Awaited<ReturnType<typeof createServerSupabaseClient>>
): Promise<AppUser | null> {
  const supabase = client ?? (await createServerSupabaseClient());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, org_id, role, full_name, email, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  return {
    id: profile.id,
    orgId: profile.org_id,
    role: profile.role,
    fullName: profile.full_name,
    email: profile.email,
    isActive: profile.is_active,
  };
}
