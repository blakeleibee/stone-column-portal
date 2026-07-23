"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../src/server/supabase/serverClient";

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/");
}

export async function signInWithMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/login?magicLinkSent=1");
}
