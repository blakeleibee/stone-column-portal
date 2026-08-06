"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { confirmImportBatch as confirmImportBatchService } from "../../../../../packages/02-app-shell/src/services/importService";

export async function confirmImportBatch(batchId: string) {
  const supabase = await createServerSupabaseClient();
  return confirmImportBatchService(supabase, batchId);
}
