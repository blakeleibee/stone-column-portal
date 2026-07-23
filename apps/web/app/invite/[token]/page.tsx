import { acceptInvitation } from "./actions";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const search = await searchParams;
  const acceptWithToken = acceptInvitation.bind(null, token);

  return (
    <div style={{ maxWidth: 400, margin: "80px auto", fontFamily: "sans-serif", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 24 }}>Accept your invitation</h1>

      {search.error && <p style={{ color: "#B23A3A", marginBottom: 16, fontSize: 13 }}>{search.error}</p>}

      <form action={acceptWithToken} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input name="fullName" placeholder="Your full name" required style={{ padding: 8 }} />
        <input name="email" type="email" placeholder="Email (must match the invitation)" required style={{ padding: 8 }} />
        <input name="password" type="password" placeholder="Choose a password" required minLength={8} style={{ padding: 8 }} />
        <button type="submit" style={{ padding: 10 }}>
          Accept and create account
        </button>
      </form>
    </div>
  );
}
