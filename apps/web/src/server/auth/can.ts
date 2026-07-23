import { createServerSupabaseClient } from "../supabase/serverClient";
import { getCurrentUser } from "./getCurrentUser";

/** Boolean predicates for conditional UI -- backed by the SAME real
 *  queries the require*() functions use, never a separate, potentially
 *  drifting code path. */

export async function canViewProject(projectId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  return data !== null;
}

export async function canManageProject(projectId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "staff")) return false;
  return canViewProject(projectId);
}

export async function canViewDocument(documentId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("documents").select("id").eq("id", documentId).maybeSingle();
  return data !== null;
}

export async function canUploadDocument(projectId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "staff")) return false;
  return canViewProject(projectId);
}
