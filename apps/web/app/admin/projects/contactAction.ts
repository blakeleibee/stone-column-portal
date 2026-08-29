"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  upsertProjectContact as upsertProjectContactService,
  listProjectContacts as listProjectContactsService,
  type ProjectContactInput,
  type ProjectContactRow,
} from "../../../../../packages/02-app-shell/src/services/projectIntakeService";

/**
 * Thin wrapper, same shape as createAction.ts/statusAction.ts and
 * team/actions.ts's assignStaff — all the real logic (the insert-or-
 * update branch, the archived-project guard, the id+project_id scoping)
 * lives entirely in projectIntakeService.upsertProjectContact; this only
 * constructs the request-scoped Supabase client and forwards params/
 * return value unchanged.
 */
export async function upsertProjectContact(
  projectId: string,
  contact: ProjectContactInput
): Promise<{ id: string } | { error: string }> {
  const supabase = await createServerSupabaseClient();
  return upsertProjectContactService(supabase, projectId, contact);
}

// listProjectContacts() throws on a Supabase error rather than returning
// { error } (see projectIntakeService.ts's / projectService.ts's own
// doc comments on that convention) — fine for a Server Component's
// initial load (used directly, unwrapped, by contacts/page.tsx), but
// this Server Action exists for ProjectContactsWorkspace's client-side
// reload() after every mutation, which needs a normal return value to
// show inline error text rather than an unhandled rejection. Same
// normalization pattern as team/actions.ts's refreshAssignments and
// apps/web/app/admin/bids/actions.ts's getBidPackageDetail.
export async function refreshContacts(
  projectId: string
): Promise<{ contacts?: ProjectContactRow[]; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const contacts = await listProjectContactsService(supabase, projectId);
    return { contacts };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load project contacts." };
  }
}
