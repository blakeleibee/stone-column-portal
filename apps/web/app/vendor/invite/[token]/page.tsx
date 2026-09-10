import { createServerSupabaseClient } from "../../../../src/server/supabase/serverClient";
import { signUpAndAccept, logInAndAccept, continueAsSignedIn } from "./actions";

/**
 * P5.2 Phase A — vendor first-access landing page. Styling deliberately
 * matches /invite/[token]/page.tsx and /login/page.tsx's own minimal
 * inline-style convention (these pre-authentication pages sit outside
 * AppShell/AdminChrome entirely, so there's no shared ui/ primitive
 * layout to render inside yet).
 *
 * Three states:
 *  1. Already signed in as the invitation's own vendor -> a single
 *     "Continue" button (continueAsSignedIn).
 *  2. Not signed in -> two side-by-side paths: log in (an existing
 *     vendor_members profile, P5-EXTENSION-PACKAGES-DESIGN.md Section
 *     10's "(a)") or create an account (a brand-new contact, "(b)").
 *     The RPC itself is the real authority on which is actually valid
 *     for this token/email — this page doesn't try to guess in advance.
 */
export default async function VendorInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const search = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const signUpWithToken = signUpAndAccept.bind(null, token);
  const logInWithToken = logInAndAccept.bind(null, token);
  const continueWithToken = continueAsSignedIn.bind(null, token);

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", fontFamily: "sans-serif", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Vendor bid invitation</h1>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 24 }}>
        You&rsquo;ve been invited to view and bid on a Stone Column Custom Homes &amp; Remodeling bid package.
      </p>

      {search.error && <p style={{ color: "#B23A3A", marginBottom: 16, fontSize: 13 }}>{search.error}</p>}

      {user ? (
        <form action={continueWithToken}>
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            Signed in as <strong>{user.email}</strong>.
          </p>
          <button type="submit" style={{ padding: 10, width: "100%" }}>
            Continue to the bid package
          </button>
        </form>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <section>
            <h2 style={{ fontSize: 15, marginBottom: 10 }}>Already have a vendor account?</h2>
            <form action={logInWithToken} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input name="email" type="email" placeholder="Email" required style={{ padding: 8 }} />
              <input name="password" type="password" placeholder="Password" required style={{ padding: 8 }} />
              <button type="submit" style={{ padding: 10 }}>
                Log in and continue
              </button>
            </form>
          </section>

          <section>
            <h2 style={{ fontSize: 15, marginBottom: 10 }}>New vendor contact?</h2>
            <form action={signUpWithToken} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input name="fullName" placeholder="Your full name" required style={{ padding: 8 }} />
              <input name="email" type="email" placeholder="Email (must match the invitation)" required style={{ padding: 8 }} />
              <input name="password" type="password" placeholder="Choose a password" required minLength={8} style={{ padding: 8 }} />
              <button type="submit" style={{ padding: 10 }}>
                Create account and continue
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
