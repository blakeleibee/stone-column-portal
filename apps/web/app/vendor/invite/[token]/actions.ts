"use server";

/**
 * P5.2 Phase A — vendor first-access acceptance. Mirrors
 * /invite/[token]/actions.ts's own division of labor (client-side
 * Supabase Auth call here in the Server Action, then a SECURITY DEFINER
 * RPC finishes the real work) but calls the NEW, vendor-specific
 * accept_vendor_bid_invitation() RPC (schema/022) instead of the
 * generic accept_invitation() — that RPC is left completely untouched
 * by this package; see schema/022's own header comment for why this is
 * a dedicated function rather than a modification of it.
 *
 * Three entry points, matching the two first-access shapes
 * P5-EXTENSION-PACKAGES-DESIGN.md Section 10 names:
 *  - signUpAndAccept: brand-new vendor contact, no account yet.
 *  - logInAndAccept: vendor contact with an existing account, but not
 *    currently signed in (e.g. a different device/browser).
 *  - continueAsSignedIn: already signed in (the page itself detects
 *    this and renders a single "Continue" button instead of a form).
 */
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../../../src/server/supabase/serverClient";

type SupabaseLike = Awaited<ReturnType<typeof createServerSupabaseClient>>;

async function finishAcceptance(supabase: SupabaseLike, token: string, fullName: string | null) {
  const { data, error } = await supabase.rpc("accept_vendor_bid_invitation", {
    p_token: token,
    p_full_name: fullName,
  });
  if (error) {
    redirect(`/vendor/invite/${token}?error=${encodeURIComponent(error.message)}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  const bidPackageId = row?.bid_package_id as string | null | undefined;
  redirect(bidPackageId ? `/vendor/bids/${bidPackageId}` : "/vendor");
}

export async function signUpAndAccept(token: string, formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createServerSupabaseClient();

  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    redirect(`/vendor/invite/${token}?error=${encodeURIComponent(signUpError.message)}`);
  }

  await finishAcceptance(supabase, token, fullName);
}

export async function logInAndAccept(token: string, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createServerSupabaseClient();

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    redirect(`/vendor/invite/${token}?error=${encodeURIComponent(signInError.message)}`);
  }

  await finishAcceptance(supabase, token, null);
}

export async function continueAsSignedIn(token: string) {
  const supabase = await createServerSupabaseClient();
  await finishAcceptance(supabase, token, null);
}
