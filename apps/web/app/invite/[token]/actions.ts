"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";

export async function acceptInvitation(token: string, formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createServerSupabaseClient();

  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    redirect(`/invite/${token}?error=${encodeURIComponent(signUpError.message)}`);
  }

  const { error: rpcError } = await supabase.rpc("accept_invitation", {
    p_token: token,
    p_full_name: fullName,
  });
  if (rpcError) {
    redirect(`/invite/${token}?error=${encodeURIComponent(rpcError.message)}`);
  }

  redirect("/");
}
