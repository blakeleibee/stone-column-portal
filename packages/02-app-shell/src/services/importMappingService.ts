import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mirrors the shape of an `import_mapping_profiles` row (schema/013), in
 * camelCase. Deliberately defined here rather than in
 * packages/01-financial-engine — a mapping profile is CSV-column-to-
 * cost-code bookkeeping for the QuickBooks import wizard, not a
 * financial calculation, so it doesn't belong alongside budget/fee/
 * reconciliation math.
 */
export interface MappingProfile {
  id: string;
  orgId: string;
  name: string;
  columnMapping: Record<string, string>;
  costCodeMatchStrategy: "prefix" | "exact" | "manual_only";
  costCodePrefixLength: number | null;
  itemOverrides: Record<string, unknown>;
  isArchived: boolean;
  createdBy: string | null;
  createdAt: string;
}

export async function createMappingProfile(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    name: string;
    columnMapping: Record<string, string>;
    strategy: "prefix" | "exact" | "manual_only";
    prefixLength?: number;
  }
): Promise<{ error?: string; id?: string }> {
  if (!input.name.trim()) {
    return { error: "A profile name is required." };
  }
  // Defense in depth on top of the DB's own CHECK constraint
  // (import_mapping_profiles_prefix_length_required) — same pattern as
  // bootstrapFirstAdmin's invite-code check being validated both here
  // and at the database layer.
  if (input.strategy === "prefix" && (input.prefixLength === undefined || input.prefixLength === null)) {
    return { error: "A prefix length is required when the match strategy is 'prefix'." };
  }

  const { data, error } = await supabase
    .from("import_mapping_profiles")
    .insert({
      org_id: orgId,
      name: input.name,
      column_mapping: input.columnMapping,
      cost_code_match_strategy: input.strategy,
      cost_code_prefix_length: input.strategy === "prefix" ? input.prefixLength : null,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }
  return { id: data.id };
}

export async function listMappingProfiles(supabase: SupabaseClient, orgId: string): Promise<MappingProfile[]> {
  const { data, error } = await supabase
    .from("import_mapping_profiles")
    .select("id, org_id, name, column_mapping, cost_code_match_strategy, cost_code_prefix_length, item_overrides, is_archived, created_by, created_at")
    .eq("org_id", orgId)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    columnMapping: row.column_mapping,
    costCodeMatchStrategy: row.cost_code_match_strategy,
    costCodePrefixLength: row.cost_code_prefix_length,
    itemOverrides: row.item_overrides,
    isArchived: row.is_archived,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}
