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

  // KNOWN LIMITATION (tracked, not fixed here — see
  // docs/production-build/P1-DESIGN.md's production-readiness
  // limitations): signUp() above and this RPC are not atomic. Two
  // people racing to accept the same invitation token (or any transient
  // DB error here) leaves the just-created auth.users row with no
  // profiles row, and a retry with the same email gets "already
  // registered" from signUp() before ever reaching this RPC again — an
  // orphaned account with no self-service recovery path. A full fix
  // (idempotent retry / reuse an existing profile-less session, or
  // detecting and completing an abandoned signUp) is bigger than this
  // flow's current scope; acceptable for P1's foundation but must be
  // revisited before real invitations are sent to real people.
  const { error: rpcError } = await supabase.rpc("accept_invitation", {
    p_token: token,
    p_full_name: fullName,
  });
  if (rpcError) {
    redirect(`/invite/${token}?error=${encodeURIComponent(rpcError.message)}`);
  }

  redirect("/");
}
