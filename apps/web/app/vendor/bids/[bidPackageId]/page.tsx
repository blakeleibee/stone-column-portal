import { requireRole } from "../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../src/server/supabase/serverClient";
import { getVendorVisibleBidPackage } from "../../../../../../packages/02-app-shell/src/services/bidService";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  awarded: "Awarded",
  cancelled: "Cancelled",
};

function formatDate(iso: string | null): string {
  if (!iso) return "No due date set";
  return new Date(iso).toLocaleString();
}

/**
 * P5.2 Phase A — the one real vendor-facing bid package screen this
 * phase ships. Deliberately minimal per this phase's explicit scope
 * boundary: title, scope description, cost code (resolved to its
 * human-readable code, never a raw UUID), due date, status. No
 * documents, no submission form, no Q&A/correspondence UI — those are
 * later phases; the RLS they'll eventually rely on already exists
 * (dormant) and is untouched here.
 *
 * Always requires a real vendor-role session regardless of DEMO_MODE —
 * matching /admin/bids/page.tsx's own established precedent for this
 * data domain ("bids are ... real-backend procurement data with no
 * fixture repository equivalent"). getVendorVisibleBidPackage() relies
 * entirely on RLS (schema/022) to decide what it can ever return: a
 * vendor session hitting a package it isn't invited to — a different
 * package, or one belonging to a project its company has no submission
 * on — gets `null` back here, rendered below as a clean, honest
 * "not found" state. Never a 500, never another vendor's data.
 */
export default async function VendorBidPackagePage({
  params,
}: {
  params: Promise<{ bidPackageId: string }>;
}) {
  const { bidPackageId } = await params;
  await requireRole(["vendor"]);
  const supabase = await createServerSupabaseClient();

  let pkg;
  try {
    pkg = await getVendorVisibleBidPackage(supabase, bidPackageId);
  } catch {
    // A malformed id (not a valid uuid) throws at the database level —
    // treated identically to "not accessible," never surfaced as a
    // crash. Genuine unexpected errors still show as this same clean
    // state; nothing about it leaks internals.
    pkg = null;
  }

  if (!pkg) {
    return (
      <div style={{ padding: 32, fontFamily: "sans-serif", maxWidth: 560 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Bid package not found</h1>
        <p style={{ color: "#666", fontSize: 13 }}>
          This bid package doesn&rsquo;t exist, or you don&rsquo;t have access to it. If you believe this is a
          mistake, contact the Stone Column team member who invited you.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif", maxWidth: 640 }}>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
        Cost code {pkg.costCodeCode} · {STATUS_LABELS[pkg.status] ?? pkg.status}
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>{pkg.title}</h1>

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, color: "#666", marginBottom: 4 }}>Scope</h2>
        <p style={{ fontSize: 14 }}>{pkg.scopeDescription ?? "No scope description provided yet."}</p>
      </div>

      <div>
        <h2 style={{ fontSize: 14, color: "#666", marginBottom: 4 }}>Due</h2>
        <p style={{ fontSize: 14 }}>{formatDate(pkg.dueAt)}</p>
      </div>

      <p style={{ marginTop: 32, fontSize: 12, color: "#999" }}>
        Documents, questions, and bid submission aren&rsquo;t available here yet — this view is preview-only for
        now.
      </p>
    </div>
  );
}
