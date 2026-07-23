import { bootstrapFirstAdmin } from "./actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div style={{ maxWidth: 400, margin: "80px auto", fontFamily: "sans-serif", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Create your organization</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>
        This creates the first admin account for a new organization. Requires an invite code — if you
        don't have one, ask whoever set up this deployment.
      </p>

      {params.error && <p style={{ color: "#B23A3A", marginBottom: 16, fontSize: 13 }}>{params.error}</p>}

      <form action={bootstrapFirstAdmin} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input name="inviteCode" placeholder="Invite code" required style={{ padding: 8 }} />
        <input name="orgName" placeholder="Company name" required style={{ padding: 8 }} />
        <input name="fullName" placeholder="Your full name" required style={{ padding: 8 }} />
        <input name="email" type="email" placeholder="Email" required style={{ padding: 8 }} />
        <input name="password" type="password" placeholder="Password" required minLength={8} style={{ padding: 8 }} />
        <button type="submit" style={{ padding: 10 }}>
          Create organization
        </button>
      </form>
    </div>
  );
}
