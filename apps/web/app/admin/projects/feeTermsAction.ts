"use server";

import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import {
  setProjectFeeTerms as setProjectFeeTermsService,
  getProjectFeeTerms as getProjectFeeTermsService,
  type PricingModel,
  type FeeBasis,
  type ProjectFeeTermsRow,
} from "../../../../../packages/02-app-shell/src/services/projectService";

/**
 * Thin wrapper, same shape as createAction.ts/statusAction.ts — all the
 * real logic (the set_project_fee_terms() RPC call and error
 * normalization) lives in projectService.setProjectFeeTerms; this only
 * constructs the request-scoped Supabase client and forwards the
 * params/return value unchanged.
 *
 * Built now (P3.1 Task 3) even though the screen that calls it is
 * Task 8's job — so Task 8 doesn't block on a Task 3 dependency.
 */
export async function setProjectFeeTerms(params: {
  projectId: string;
  pricingModel: PricingModel;
  feeBasis: FeeBasis;
  feeBasisPoints?: number | null;
  feeFixedAmountCents?: number | null;
  pricingModelLabel?: string | null;
}): Promise<{ error: string } | {}> {
  const supabase = await createServerSupabaseClient();
  return setProjectFeeTermsService(supabase, params);
}

// getProjectFeeTerms() throws on a Supabase error rather than returning
// { error } (see projectService.ts's own doc comments on that
// convention) — fine for a Server Component's initial load (used
// directly, unwrapped, by pricing/page.tsx), but this Server Action
// exists for ProjectPricingWorkspace's client-side reload() after a
// successful setProjectFeeTerms() call, which needs a normal return
// value to show inline error text rather than an unhandled rejection.
// Same normalization pattern as team/actions.ts's refreshAssignments and
// contactAction.ts's refreshContacts (P3.1 Task 8).
export async function refreshFeeTerms(projectId: string): Promise<{ feeTerms?: ProjectFeeTermsRow; error?: string }> {
  const supabase = await createServerSupabaseClient();
  try {
    const feeTerms = await getProjectFeeTermsService(supabase, projectId);
    return { feeTerms };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load pricing/fee terms." };
  }
}
