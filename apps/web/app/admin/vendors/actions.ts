"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { getCurrentUser } from "../../../src/server/auth/getCurrentUser";
import {
  createVendor as createVendorService,
  checkVendorDuplicate as checkVendorDuplicateService,
  getVendorDetail as getVendorDetailService,
  updateVendorCoreFields as updateVendorCoreFieldsService,
  setVendorArchived as setVendorArchivedService,
  upsertVendorContact as upsertVendorContactService,
  archiveVendorContact as archiveVendorContactService,
  setVendorDocumentStatus as setVendorDocumentStatusService,
  mergeVendors as mergeVendorsService,
  unmergeVendor as unmergeVendorService,
  type VendorCoreFieldUpdate,
  type UpsertVendorContactInput,
  type VendorDocumentCategory,
  type VendorDocumentStatus,
} from "../../../../../packages/02-app-shell/src/services/vendorService";

/**
 * Package P5.1 — thin Server Action forwards to vendorService.ts, same
 * shape as every other admin screen's actions.ts in this codebase
 * (procurement/actions.ts, bids/actions.ts): no business logic here,
 * just session resolution and a one-line call-through, so a future
 * AI tool-adapter can call the exact same vendorService functions under
 * the same asking user's session (CLAUDE.md's AI-readiness mandate).
 */

export async function createVendor(name: string, email?: string, phone?: string) {
  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { error: "Not authenticated." };
  return createVendorService(supabase, user.orgId, name, email, phone);
}

export async function checkVendorDuplicate(name: string, email?: string) {
  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return {};
  return checkVendorDuplicateService(supabase, user.orgId, name, email);
}

export async function getVendorDetail(vendorId: string) {
  const supabase = await createServerSupabaseClient();
  const detail = await getVendorDetailService(supabase, vendorId);
  return detail ? { detail } : { error: "Vendor not found." };
}

export async function updateVendorCoreFields(vendorId: string, fields: VendorCoreFieldUpdate) {
  const supabase = await createServerSupabaseClient();
  return updateVendorCoreFieldsService(supabase, vendorId, fields);
}

export async function setVendorArchived(vendorId: string, archived: boolean) {
  const supabase = await createServerSupabaseClient();
  return setVendorArchivedService(supabase, vendorId, archived);
}

export async function upsertVendorContact(input: UpsertVendorContactInput) {
  const supabase = await createServerSupabaseClient();
  return upsertVendorContactService(supabase, input);
}

export async function archiveVendorContact(contactId: string) {
  const supabase = await createServerSupabaseClient();
  return archiveVendorContactService(supabase, contactId);
}

export async function setVendorDocumentStatus(
  vendorId: string,
  category: VendorDocumentCategory,
  status: VendorDocumentStatus,
  expirationDate?: string | null
) {
  const supabase = await createServerSupabaseClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { error: "Not authenticated." };
  return setVendorDocumentStatusService(supabase, { vendorId, orgId: user.orgId, category, status, expirationDate });
}

export async function mergeVendors(loserVendorId: string, survivorVendorId: string) {
  const supabase = await createServerSupabaseClient();
  return mergeVendorsService(supabase, loserVendorId, survivorVendorId);
}

export async function unmergeVendor(vendorId: string) {
  const supabase = await createServerSupabaseClient();
  return unmergeVendorService(supabase, vendorId);
}
