"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  confirmImportBatch as confirmImportBatchService,
  overrideImportRow as overrideImportRowService,
  excludeImportRow as excludeImportRowService,
  listImportRows as listImportRowsService,
  getImportBatchReconciliation as getImportBatchReconciliationService,
} from "../../../../../packages/02-app-shell/src/services/importService";

export async function confirmImportBatch(batchId: string) {
  const supabase = await createServerSupabaseClient();
  return confirmImportBatchService(supabase, batchId);
}

export async function overrideImportRow(rowId: string, costCodeId: string) {
  const supabase = await createServerSupabaseClient();
  return overrideImportRowService(supabase, rowId, costCodeId);
}

export async function excludeImportRow(rowId: string) {
  const supabase = await createServerSupabaseClient();
  return excludeImportRowService(supabase, rowId);
}

export async function listImportRows(batchId: string) {
  const supabase = await createServerSupabaseClient();
  return listImportRowsService(supabase, batchId);
}

export async function getImportBatchReconciliation(batchId: string) {
  const supabase = await createServerSupabaseClient();
  return getImportBatchReconciliationService(supabase, batchId);
}
