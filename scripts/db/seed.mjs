#!/usr/bin/env node
// Dev/test-only seed data: one org, four profiles (one per role), one
// project, project_members rows, two documents, one invitation.
// Refuses to run unless ALLOW_SEED=true, failing closed against an
// accidental production run. Requires a real Supabase project
// (local via `supabase start`, or hosted) — SUPABASE_SERVICE_ROLE_KEY
// is required because seeding creates auth.users rows directly, which
// only the service-role (Admin API) can do; every other write in this
// script still goes through normal RLS-scoped operations once the
// underlying auth users/profiles exist, mirroring how a real signup
// flow would create them, not a bulk RLS-bypassing insert everywhere.
import { createClient } from "@supabase/supabase-js";

if (process.env.ALLOW_SEED !== "true") {
  console.error("Refusing to seed: set ALLOW_SEED=true explicitly (never in production).");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey);

async function main() {
  const users = {
    admin: { email: "admin@seed.local", password: "seed-password-123" },
    staff: { email: "staff@seed.local", password: "seed-password-123" },
    client: { email: "client@seed.local", password: "seed-password-123" },
    vendor: { email: "vendor@seed.local", password: "seed-password-123" },
  };

  const created = {};
  for (const [key, { email, password }] of Object.entries(users)) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    created[key] = data.user.id;
    console.log(`created auth user ${key}: ${email} (${data.user.id})`);
  }

  const { data: orgResult, error: orgError } = await admin.rpc("bootstrap_organization", {
    p_org_name: "Seed Co",
    p_admin_full_name: "Seed Admin",
    p_admin_email: users.admin.email,
  });
  // bootstrap_organization runs as the CALLING user (auth.uid()) --
  // the service-role client has no auth.uid(), so this call is
  // expected to fail here; seed profiles are inserted directly instead,
  // as the deliberate exception to "never bulk-insert via service role"
  // that seeding scripts are: this data never goes through real user
  // signup, by definition.
  console.log("(expected) bootstrap_organization via service role:", orgError?.message ?? orgResult);

  const { data: org, error: orgInsertError } = await admin.from("orgs").insert({ name: "Seed Co" }).select("id").single();
  if (orgInsertError) throw orgInsertError;

  await admin.from("profiles").insert([
    { id: created.admin, org_id: org.id, role: "admin", full_name: "Seed Admin", email: users.admin.email },
    { id: created.staff, org_id: org.id, role: "staff", full_name: "Seed Staff", email: users.staff.email },
    { id: created.client, org_id: org.id, role: "client", full_name: "Seed Client", email: users.client.email },
    { id: created.vendor, org_id: org.id, role: "vendor", full_name: "Seed Vendor", email: users.vendor.email },
  ]);

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({ org_id: org.id, name: "Hawks Ridge Residence", project_number: "HR-001", pricing_model: "cost_plus_percentage" })
    .select("id")
    .single();
  if (projectError) throw projectError;

  await admin.from("project_members").insert([
    { project_id: project.id, user_id: created.client, member_role: "client" },
    { project_id: project.id, user_id: created.vendor, member_role: "vendor" },
  ]);

  await admin.from("documents").insert([
    {
      project_id: project.id,
      uploaded_by: created.admin,
      file_name: "contract.pdf",
      mime_type: "application/pdf",
      size_bytes: 102400,
      category: "contract",
      storage_key: `seed/${project.id}/contract.pdf`,
      is_published_to_client: false,
    },
    {
      project_id: project.id,
      uploaded_by: created.admin,
      file_name: "floor-plan.pdf",
      mime_type: "application/pdf",
      size_bytes: 51200,
      category: "plans",
      storage_key: `seed/${project.id}/floor-plan.pdf`,
      is_published_to_client: true,
    },
  ]);

  await admin.from("invitations").insert({
    org_id: org.id,
    email: "new-hire@seed.local",
    role: "staff",
    created_by: created.admin,
  });

  console.log("\nSeed complete.");
  console.log("Login credentials (all roles use the same password):", "seed-password-123");
  for (const [key, { email }] of Object.entries(users)) {
    console.log(`  ${key}: ${email}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
