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

/** Package P5.1: mirrors the DB's own is_accounting_or_admin_staff_for_org()
 *  (schema/020) for UI-gating purposes only (e.g. /admin/vendors deciding
 *  whether to render a W-9 download control or a "restricted" message) —
 *  RLS on vendor_documents/vendor_document_access_log remains the real
 *  enforcement boundary regardless of what this returns. AppUser doesn't
 *  carry staff_function (most callers never need it), so this queries
 *  profiles directly rather than widening that shared type for one
 *  caller. */
export async function isAccountingOrAdminStaff(client?: SupabaseLike): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());
  const user = await getCurrentUser(supabase);
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role !== "staff") return false;
  const { data } = await supabase.from("profiles").select("staff_function").eq("id", user.id).single();
  return data?.staff_function === "accounting";
}
