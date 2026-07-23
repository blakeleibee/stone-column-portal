"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../src/server/supabase/serverClient";

export async function bootstrapFirstAdmin(formData: FormData) {
  const inviteCode = String(formData.get("inviteCode") ?? "");
  const orgName = String(formData.get("orgName") ?? "");
  const fullName = String(formData.get("fullName") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!process.env.BOOTSTRAP_INVITE_CODE || inviteCode !== process.env.BOOTSTRAP_INVITE_CODE) {
    redirect("/signup?error=" + encodeURIComponent("Invalid invite code."));
  }

  const supabase = await createServerSupabaseClient();

  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    redirect("/signup?error=" + encodeURIComponent(signUpError.message));
  }

  // KNOWN LIMITATION (tracked, not fixed here — see
  // docs/production-build/P1-DESIGN.md's production-readiness
  // limitations): signUp() above and this RPC are not atomic. If this
  // call fails (transient DB error, or a race where this email somehow
  // already bootstrapped between the two calls), the just-created
  // auth.users row is left with no profiles row, and a retry with the
  // same email will get "already registered" from signUp() before ever
  // reaching this RPC again — an orphaned account with no self-service
  // recovery path. A full fix (idempotent retry / reuse an existing
  // profile-less session) is bigger than this flow's current scope;
  // this is acceptable for a single, rarely-run first-admin bootstrap
  // but must be revisited before this path sees real, repeated use.
  const { error: rpcError } = await supabase.rpc("bootstrap_organization", {
    p_org_name: orgName,
    p_admin_full_name: fullName,
    p_admin_email: email,
  });
  if (rpcError) {
    redirect("/signup?error=" + encodeURIComponent(rpcError.message));
  }

  redirect("/");
}
