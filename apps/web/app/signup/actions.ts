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
