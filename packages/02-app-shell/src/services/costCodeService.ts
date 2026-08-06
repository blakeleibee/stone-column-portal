import type { SupabaseClient } from "@supabase/supabase-js";

export async function updateCostCodeMetadata(
  supabase: SupabaseClient,
  costCodeId: string,
  patch: {
    activityName?: string;
    scopeDescription?: string;
    includeInEstimate?: boolean;
    billable?: boolean;
  }
) {
  // Build update object with only keys present in patch (partial update)
  const updateData: Record<string, any> = {};

  if (patch.activityName !== undefined) {
    updateData.activity_name = patch.activityName;
  }
  if (patch.scopeDescription !== undefined) {
    updateData.scope_description = patch.scopeDescription;
  }
  if (patch.includeInEstimate !== undefined) {
    updateData.include_in_estimate = patch.includeInEstimate;
  }
  if (patch.billable !== undefined) {
    updateData.billable = patch.billable;
  }

  const { error } = await supabase
    .from("cost_codes")
    .update(updateData)
    .eq("id", costCodeId);

  return error ? { error: error.message } : {};
}
