"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  createBidPackage as createBidPackageService,
  publishBidPackage as publishBidPackageService,
  inviteVendor as inviteVendorService,
  revokeVendorMember as revokeVendorMemberService,
  reactivateVendorMember as reactivateVendorMemberService,
} from "../../../../../packages/02-app-shell/src/services/bidService";

export async function createBidPackage(projectId: string, costCodeId: string, title: string, scopeDescription?: string, dueAt?: string) {
  const supabase = await createServerSupabaseClient();
  return createBidPackageService(supabase, projectId, costCodeId, title, scopeDescription, dueAt);
}

export async function publishBidPackage(bidPackageId: string) {
  const supabase = await createServerSupabaseClient();
  return publishBidPackageService(supabase, bidPackageId);
}

export async function inviteVendor(bidPackageId: string, vendorId: string) {
  const supabase = await createServerSupabaseClient();
  return inviteVendorService(supabase, bidPackageId, vendorId);
}

// No screen in P5 calls these two yet (P5-DESIGN.md's own exclusion
// note) — exported now so the capability is typechecked and testable,
// not dead code waiting to be written from scratch later.
export async function revokeVendorMember(vendorId: string, profileId: string) {
  const supabase = await createServerSupabaseClient();
  return revokeVendorMemberService(supabase, vendorId, profileId);
}

export async function reactivateVendorMember(vendorId: string, profileId: string) {
  const supabase = await createServerSupabaseClient();
  return reactivateVendorMemberService(supabase, vendorId, profileId);
}
