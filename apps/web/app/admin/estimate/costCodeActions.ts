"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { updateCostCodeMetadata as updateCostCodeMetadataService } from "../../../../../packages/02-app-shell/src/services/costCodeService";

export async function updateCostCodeMetadata(
  costCodeId: string,
  patch: {
    activityName?: string;
    scopeDescription?: string;
    includeInEstimate?: boolean;
    billable?: boolean;
  }
) {
  const supabase = await createServerSupabaseClient();
  return updateCostCodeMetadataService(supabase, costCodeId, patch);
}
