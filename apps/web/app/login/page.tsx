import { signInWithPassword, signInWithMagicLink } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; magicLinkSent?: string }>;
}) {
  const params = await searchParams;

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", fontFamily: "sans-serif", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 24 }}>Stone Column Portal — Sign in</h1>

      {params.error && (
        <p style={{ color: "#B23A3A", marginBottom: 16, fontSize: 13 }}>{params.error}</p>
      )}
      {params.magicLinkSent && (
        <p style={{ color: "#3A7A4E", marginBottom: 16, fontSize: 13 }}>
          Check your email for a sign-in link.
        </p>
      )}

      <form action={signInWithPassword} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input name="email" type="email" placeholder="Email" required style={{ padding: 8 }} />
        <input name="password" type="password" placeholder="Password" required style={{ padding: 8 }} />
        <button type="submit" style={{ padding: 10 }}>
          Sign in
        </button>
      </form>

      <form action={signInWithMagicLink} style={{ marginTop: 16 }}>
        <input name="email" type="email" placeholder="Email" required style={{ padding: 8, width: "100%", marginBottom: 8 }} />
        <button type="submit" style={{ padding: 10, width: "100%" }}>
          Send magic link instead
        </button>
      </form>
    </div>
  );
}
