#!/usr/bin/env node
// Pre-P4 production-readiness checkpoint: proves real Supabase Auth +
// Postgres RLS end-to-end against an actual hosted project, using the
// exact same @supabase/supabase-js calls apps/web's route handlers make
// (auth.signUp, auth.signInWithPassword, the bootstrap_organization()/
// accept_invitation() RPCs, and ordinary RLS-scoped table queries) --
// never the service-role client for anything a real user flow does.
// The service-role client is used only for teardown at the end, exactly
// as scripts/db/seed.mjs already does for a different reason.
//
// Out of scope (already covered elsewhere, not re-tested here):
// apps/web/test/auth_smoke.ts already proves the Next.js route/redirect
// layer (DEMO_MODE gating, unauthenticated redirects) via real HTTP
// against `next dev`. This script proves the layer underneath that --
// the actual Supabase Auth/RLS backend -- which P1 shipped but never
// verified against a live project (every prior run used PGlite). The
// BOOTSTRAP_INVITE_CODE gate itself lives in apps/web/app/signup/actions.ts,
// not in the bootstrap_organization() RPC this script calls directly, so
// that specific check is not exercised here -- auth_smoke.ts's job.
//
// Usage: node scripts/db/live-auth-checkpoint.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local if present).
// Deliberately has no ALLOW_SEED-style guard: this script never bulk-
// inserts financial/product data, only creates and then deletes its own
// disposable auth users/orgs, safe to run against any real dev project.

try {
  process.loadEnvFile(".env.local");
} catch {
  // fine if it doesn't exist -- env vars may already be exported
}

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must all be set.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const stamp = Date.now();
const results = [];
const createdUserIds = [];
const createdOrgIds = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}

function freshClient() {
  // A brand-new client per step, deliberately never sharing in-memory
  // session state, so "login" and "session persistence" are proven by
  // actually rehydrating a session from stored tokens -- not just
  // reusing a client object that happens to still be authenticated.
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  // ---- Phase 1: signup + bootstrap (Org A) ----
  const emailA = `checkpoint-admin-a-${stamp}@example.com`;
  const password = "Checkpoint-Test-Password-123!";
  const clientA = freshClient();

  const { data: signUpA, error: signUpAErr } = await clientA.auth.signUp({ email: emailA, password });
  record("Signup (Org A admin)", !signUpAErr && !!signUpA.user, signUpAErr?.message);
  if (signUpAErr) throw new Error("Cannot continue without a signed-up user.");
  createdUserIds.push(signUpA.user.id);

  const { data: orgAId, error: bootstrapAErr } = await clientA.rpc("bootstrap_organization", {
    p_org_name: `Checkpoint Org A ${stamp}`,
    p_admin_full_name: "Checkpoint Admin A",
    p_admin_email: emailA,
  });
  record("bootstrap_organization() creates org + admin profile", !bootstrapAErr && !!orgAId, bootstrapAErr?.message);
  if (bootstrapAErr) throw new Error("Cannot continue without Org A.");
  createdOrgIds.push(orgAId);

  // ---- Phase 2: login (fresh client, real password auth) ----
  const loginClientA = freshClient();
  const { data: loginA, error: loginAErr } = await loginClientA.auth.signInWithPassword({ email: emailA, password });
  record("Login with real password", !loginAErr && loginA.session?.user.id === signUpA.user.id, loginAErr?.message);
  if (loginAErr) throw new Error("Cannot continue without a login session.");

  // ---- Phase 3: session persistence (rehydrate on a brand-new client) ----
  const rehydrated = freshClient();
  const { error: setSessionErr } = await rehydrated.auth.setSession({
    access_token: loginA.session.access_token,
    refresh_token: loginA.session.refresh_token,
  });
  const { data: rehydratedProfile, error: rehydratedProfileErr } = await rehydrated
    .from("profiles")
    .select("id, role, org_id")
    .eq("id", signUpA.user.id)
    .maybeSingle();
  record(
    "Session persistence (stored tokens rehydrate a working session on a new client)",
    !setSessionErr && !rehydratedProfileErr && rehydratedProfile?.role === "admin",
    setSessionErr?.message ?? rehydratedProfileErr?.message
  );

  // ---- Phase 4: logout ----
  const { error: signOutErr } = await rehydrated.auth.signOut();
  const { data: afterLogout } = await rehydrated
    .from("profiles")
    .select("id")
    .eq("id", signUpA.user.id)
    .maybeSingle();
  record(
    "Logout revokes access (post-logout query returns no row under anon RLS, not an error)",
    !signOutErr && !afterLogout,
    signOutErr?.message
  );

  // ---- Phase 5: invitation create -> accept -> role assignment ----
  const staffLogin = freshClient();
  await staffLogin.auth.signInWithPassword({ email: emailA, password });

  const inviteeEmail = `checkpoint-staff-${stamp}@example.com`;
  const { data: invitation, error: inviteErr } = await staffLogin
    .from("invitations")
    .insert({ org_id: orgAId, email: inviteeEmail, role: "staff" })
    .select("token")
    .single();
  record("Admin creates an invitation (RLS-scoped insert, not service role)", !inviteErr && !!invitation?.token, inviteErr?.message);

  const inviteeClient = freshClient();
  const { data: inviteeSignUp, error: inviteeSignUpErr } = await inviteeClient.auth.signUp({
    email: inviteeEmail,
    password,
  });
  record("Invitee signs up", !inviteeSignUpErr && !!inviteeSignUp.user, inviteeSignUpErr?.message);
  if (inviteeSignUp?.user) createdUserIds.push(inviteeSignUp.user.id);

  const { data: acceptedOrgId, error: acceptErr } = await inviteeClient.rpc("accept_invitation", {
    p_token: invitation?.token,
    p_full_name: "Checkpoint Staff Invitee",
  });
  record("accept_invitation() succeeds and returns the correct org", !acceptErr && acceptedOrgId === orgAId, acceptErr?.message);

  const { data: inviteeProfile, error: inviteeProfileErr } = await inviteeClient
    .from("profiles")
    .select("role, org_id")
    .eq("id", inviteeSignUp?.user?.id)
    .maybeSingle();
  record(
    "Role assignment: invitee's profile has role='staff' in Org A (not self-chosen)",
    !inviteeProfileErr && inviteeProfile?.role === "staff" && inviteeProfile?.org_id === orgAId,
    inviteeProfileErr?.message
  );

  // ---- Phase 6: cross-organization isolation (Org B, real RLS, both directions) ----
  const emailB = `checkpoint-admin-b-${stamp}@example.com`;
  const clientB = freshClient();
  const { data: signUpB, error: signUpBErr } = await clientB.auth.signUp({ email: emailB, password });
  if (signUpB?.user) createdUserIds.push(signUpB.user.id);

  const { data: orgBId, error: bootstrapBErr } = await clientB.rpc("bootstrap_organization", {
    p_org_name: `Checkpoint Org B ${stamp}`,
    p_admin_full_name: "Checkpoint Admin B",
    p_admin_email: emailB,
  });
  record("Second organization (Org B) bootstrapped for isolation testing", !signUpBErr && !bootstrapBErr && !!orgBId, signUpBErr?.message ?? bootstrapBErr?.message);
  if (orgBId) createdOrgIds.push(orgBId);

  const adminAAgain = freshClient();
  await adminAAgain.auth.signInWithPassword({ email: emailA, password });
  const { data: aSeesB } = await adminAAgain.from("orgs").select("id").eq("id", orgBId).maybeSingle();
  const { data: aSeesBProfiles } = await adminAAgain.from("profiles").select("id").eq("org_id", orgBId);
  record(
    "Cross-org isolation (A -> B): Org A admin cannot read Org B's org row or profiles",
    !aSeesB && (aSeesBProfiles?.length ?? 0) === 0
  );

  const adminBAgain = freshClient();
  await adminBAgain.auth.signInWithPassword({ email: emailB, password });
  const { data: bSeesA } = await adminBAgain.from("orgs").select("id").eq("id", orgAId).maybeSingle();
  const { data: bSeesAProfiles } = await adminBAgain.from("profiles").select("id").eq("org_id", orgAId);
  record(
    "Cross-org isolation (B -> A): Org B admin cannot read Org A's org row or profiles",
    !bSeesA && (bSeesAProfiles?.length ?? 0) === 0
  );
}

async function cleanup() {
  console.log("\n--- cleanup (removing disposable checkpoint data) ---");
  if (createdOrgIds.length) {
    await admin.from("invitations").delete().in("org_id", createdOrgIds);
  }
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`  cleanup warning: could not delete user ${id}: ${error.message}`);
  }
  if (createdOrgIds.length) {
    const { error } = await admin.from("orgs").delete().in("id", createdOrgIds);
    if (error) console.warn(`  cleanup warning: could not delete orgs: ${error.message}`);
  }
  console.log("cleanup done.");
}

main()
  .catch((err) => {
    console.error("\nCheckpoint script stopped early:", err.message);
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) {
      console.log("Failed checks:", failed.map((f) => f.name).join("; "));
      process.exit(1);
    }
  });
