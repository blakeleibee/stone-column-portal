"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  createMappingProfile as createMappingProfileService,
  listMappingProfiles as listMappingProfilesService,
} from "../../../../../packages/02-app-shell/src/services/importMappingService";

export async function createMappingProfile(
  orgId: string,
  input: {
    name: string;
    columnMapping: Record<string, string>;
    strategy: "prefix" | "exact" | "manual_only";
    prefixLength?: number;
  }
) {
  const supabase = await createServerSupabaseClient();
  return createMappingProfileService(supabase, orgId, input);
}

export async function listMappingProfiles(orgId: string) {
  const supabase = await createServerSupabaseClient();
  return listMappingProfilesService(supabase, orgId);
}
