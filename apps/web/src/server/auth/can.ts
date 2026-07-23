import { createServerSupabaseClient } from "../supabase/serverClient";
import { getCurrentUser } from "./getCurrentUser";

type SupabaseLike = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Boolean predicates for conditional UI -- backed by the SAME real
 *  queries the require*() functions use, never a separate, potentially
 *  drifting code path. */

export async function canViewProject(projectId: string, client?: SupabaseLike): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());
  const user = await getCurrentUser(supabase);
  if (!user) return false;
  const { data } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  return data !== null;
}

export async function canManageProject(projectId: string, client?: SupabaseLike): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());
  const user = await getCurrentUser(supabase);
  if (!user || (user.role !== "admin" && user.role !== "staff")) return false;
  return canViewProject(projectId, supabase);
}

export async function canViewDocument(documentId: string, client?: SupabaseLike): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());
  const user = await getCurrentUser(supabase);
  if (!user) return false;
  const { data } = await supabase.from("documents").select("id").eq("id", documentId).maybeSingle();
  return data !== null;
}

export async function canUploadDocument(projectId: string, client?: SupabaseLike): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());
  const user = await getCurrentUser(supabase);
  if (!user || (user.role !== "admin" && user.role !== "staff")) return false;
  return canViewProject(projectId, supabase);
}
