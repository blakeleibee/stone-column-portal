import { requireRole } from "../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../src/server/supabase/serverClient";
import {
  getVendorVisibleBidPackage,
  listVendorVisibleBidQuestions,
  listVendorVisibleBidAddenda,
  listVendorVisibleBidPackageDocuments,
  type BidPackageDocumentCategory,
} from "../../../../../../packages/02-app-shell/src/services/bidService";

const DOCUMENT_CATEGORY_LABELS: Record<BidPackageDocumentCategory, string> = {
  plans: "Plans",
  specifications: "Specifications",
  scope: "Scope documents",
  photos: "Photos",
  addenda: "Addenda",
  reference: "Reference material",
  other: "Other",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

  // Phase B (Part C): documents/addenda/Q&A all rely entirely on RLS
  // (bid_package_documents_vendor_read + documents_vendor_read_via_
  // bid_package, bid_addenda_vendor_read, bid_questions_vendor_read —
  // schema/025, schema/022) to decide what this session can ever see —
  // same posture as getVendorVisibleBidPackage() above. Fetched in
  // parallel since none depends on another's result.
  const [documents, addenda, questions] = await Promise.all([
    listVendorVisibleBidPackageDocuments(supabase, bidPackageId),
    listVendorVisibleBidAddenda(supabase, bidPackageId),
    listVendorVisibleBidQuestions(supabase, bidPackageId),
  ]);

  // "Honest empty states" convention: an assembly field/section only
  // renders when actually populated — never an empty "Alternates:
  // (none)" line.
  const assemblyFields: { label: string; value: string | null }[] = [
    { label: "Inclusions", value: pkg.inclusions },
    { label: "Exclusions", value: pkg.exclusions },
    { label: "Alternates", value: pkg.alternates },
    { label: "Allowances", value: pkg.allowances },
    { label: "Pricing breakdown instructions", value: pkg.pricingBreakdownInstructions },
    { label: "Schedule expectations", value: pkg.scheduleExpectations },
    { label: "Bid instructions", value: pkg.bidInstructions },
  ].filter((f) => f.value);

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

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, color: "#666", marginBottom: 4 }}>Due</h2>
        <p style={{ fontSize: 14 }}>{formatDate(pkg.dueAt)}</p>
      </div>

      {pkg.stoneColumnContactName && (
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, color: "#666", marginBottom: 4 }}>Stone Column contact</h2>
          <p style={{ fontSize: 14 }}>{pkg.stoneColumnContactName}</p>
        </div>
      )}

      {assemblyFields.map((f) => (
        <div key={f.label} style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, color: "#666", marginBottom: 4 }}>{f.label}</h2>
          <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{f.value}</p>
        </div>
      ))}

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #ddd" }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Documents</h2>
        {documents.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888" }}>No documents have been shared yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {documents.map((doc) => (
              <li key={doc.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 }}>
                <a href={`/api/bid-packages/${doc.bidPackageId}/documents/${doc.id}/download`} target="_blank" rel="noopener noreferrer">
                  {doc.fileName}
                </a>{" "}
                <span style={{ color: "#888" }}>
                  ({DOCUMENT_CATEGORY_LABELS[doc.category] ?? doc.category}, v{doc.version}, {formatBytes(doc.sizeBytes)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #ddd" }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Addenda</h2>
        {addenda.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888" }}>No addenda have been issued yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {addenda.map((a) => (
              <li key={a.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 }}>
                <p style={{ margin: "0 0 4px 0", fontWeight: 600 }}>
                  {a.title} — {formatDate(a.issuedAt)}
                </p>
                <p style={{ margin: 0 }}>{a.bodyText}</p>
                {a.revisedDueAt && <p style={{ margin: "4px 0 0 0", color: "#888" }}>Revised due date: {formatDate(a.revisedDueAt)}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #ddd" }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Questions &amp; answers</h2>
        {questions.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888" }}>No questions have been logged yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {questions.map((q) => (
              <li key={q.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 }}>
                <p style={{ margin: "0 0 4px 0", fontWeight: 600 }}>{q.questionText}</p>
                {q.answerText ? (
                  <p style={{ margin: 0 }}>
                    <strong>Answer:</strong> {q.answerText}
                  </p>
                ) : (
                  <p style={{ margin: 0, color: "#888" }}>Not answered yet.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p style={{ marginTop: 32, fontSize: 12, color: "#999" }}>
        Asking a new question, acknowledging an addendum, and submitting a bid aren&rsquo;t available here yet —
        those are coming in a later phase.
      </p>
    </div>
  );
}
