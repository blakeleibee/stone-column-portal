import { createClient } from "@supabase/supabase-js";

/**
 * The FIRST service-role Supabase client in this codebase — per
 * TARGET-ARCHITECTURE.md §5.2, service-role access is restricted to a
 * narrow, enumerated set of cases, the first of which is named
 * explicitly: "verified external webhooks ... where there is no
 * end-user session to act as." That is exactly what this backs: the
 * inbound Resend/Svix webhook Route Handler
 * (app/api/webhooks/resend/route.ts) has no Supabase Auth session at
 * all to act as (Resend's HTTP call to our server carries no user JWT),
 * so it cannot use createServerSupabaseClient() the way every other
 * route in this codebase does.
 *
 * The second, narrower use (promoteQuarantinedMessage, called from a
 * Server Action) is the "privileged administrative operation ...
 * explicitly designed to cross RLS boundaries" case §5.2 also
 * enumerates: promoting a quarantined message must insert it with the
 * exact same shape a real inbound-email ingestion would have produced
 * (`created_by` null, matching entity_messages' own provenance
 * trigger) even though the actual caller is an authenticated staff
 * member — that specific one INSERT is the only step that runs against
 * this client; every read/authorization check around it still goes
 * through the calling staff session's own RLS-scoped client (see
 * correspondenceService.ts's own promoteQuarantinedMessage doc comment).
 *
 * NEVER import this from anything reachable by an ordinary authenticated
 * user's own request path without an explicit, narrow, pre-checked
 * reason — per §5.2's own "every service-role operation requires ...
 * explicit authorization checked in code before the privileged action
 * runs" rule. Both current call sites re-verify authorization
 * themselves (Svix signature verification for the webhook;
 * requireRole(["admin","staff"]) for the promote Server Action) before
 * ever constructing this client.
 */
export function createServiceRoleSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be configured to use the service-role client.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
