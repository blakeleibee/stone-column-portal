import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Ordinary user-originated server operations use the user's own JWT via
// this client (forwarded through cookies), remaining fully subject to
// RLS -- per TARGET-ARCHITECTURE.md §5.2, this is the default and the
// only client this package's server code uses. The service-role client
// is deliberately not created here -- see that section's enumerated,
// narrow list of cases where it would ever be appropriate; nothing in
// this package needs one.
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll called from a Server Component -- middleware
            // refreshes the session on every request instead, so this
            // is safe to ignore here (Supabase's own documented
            // pattern for the Next.js App Router).
          }
        },
      },
    }
  );
}
