"use client";

/**
 * P5.2 Phase C — the interactive part of the vendor-facing bid package
 * screen: submit/revise a bid (with visible history), ask a question,
 * and acknowledge addenda. The static, read-only parts of this screen
 * (scope/assembly fields, documents, the existing Q&A/addenda
 * displays) predate this phase (Phase A/B, apps/web/app/vendor/bids/
 * [bidPackageId]/page.tsx) and are deliberately left rendered with
 * that same file's own plain-inline-style convention — this component
 * matches that convention for visual consistency on the ONE screen
 * they share, rather than introducing the AdminChrome-era shared ui/
 * kit (Card/Button/etc.) into a screen that has never used it and
 * carries no AdminChrome shell at all (Phase A's own explicit
 * "deliberately minimal" design decision for this route).
 *
 * State-freshness rule, matching BidPackageWorkspace.tsx's own
 * established pattern exactly: after every successful mutation, this
 * component does a full re-fetch (refreshAll) and WHOLESALE-REPLACES
 * submission/revisions/questions/addenda/acknowledgments state — never
 * a hand-patched in-place update.
 */
import React, { useState } from "react";
import type {
  BidSubmissionRow,
  BidSubmissionRevisionRow,
  VendorVisibleBidQuestionRow,
  VendorVisibleBidAddendumRow,
  BidAddendumAcknowledgmentRow,
} from "../services/bidService";
import type { EntityMessageRow } from "../services/correspondenceService";

type ActionResult = { error?: string } | void | undefined;

export interface VendorBidWorkspaceProps {
  bidPackageId: string;
  vendorId: string;
  /** Whether the package is currently accepting new/revised
   *  submissions — resolved server-side once at page load
   *  (status='published' AND (due_at is null OR due_at is in the
   *  future)) from real data, never guessed client-side from a stale
   *  clock. Re-derived on every refreshAll() from the freshly-read
   *  package status/due date passed back in, so a package that closes
   *  WHILE a vendor has this screen open is caught on their next
   *  action, not just at initial load. */
  isAcceptingSubmissions: boolean;
  initialSubmission: BidSubmissionRow | null;
  initialRevisions: BidSubmissionRevisionRow[];
  initialQuestions: VendorVisibleBidQuestionRow[];
  initialAddenda: VendorVisibleBidAddendumRow[];
  initialAcknowledgments: BidAddendumAcknowledgmentRow[];
  /** P5.2 Phase D — this vendor's own private thread with staff. Never
   *  another invited vendor's thread (RLS-enforced, schema/028) — this
   *  prop's own initial value and every subsequent refreshAll() re-fetch
   *  both rely entirely on entity_messages_vendor_read to guarantee
   *  that, the same "RLS is the only real gate" posture as every other
   *  vendor-visible read in this file. */
  initialMessages: EntityMessageRow[];
  listEntityMessages: (bidPackageId: string, vendorId: string) => Promise<{ messages?: EntityMessageRow[]; error?: string }>;
  sendVendorMessage: (bidPackageId: string, vendorId: string, body: string) => Promise<{ messageId?: string; error?: string }>;
  submitVendorBid: (bidSubmissionId: string, amountCents: number, notes?: string) => Promise<{ revisionId?: string; error?: string }>;
  askVendorBidQuestion: (bidPackageId: string, vendorId: string, questionText: string) => Promise<ActionResult>;
  acknowledgeBidAddendum: (bidAddendumId: string, vendorId: string) => Promise<ActionResult>;
  getVendorOwnBidSubmission: (bidPackageId: string) => Promise<{ submission?: BidSubmissionRow | null; error?: string }>;
  listMyBidSubmissionRevisions: (bidSubmissionId: string) => Promise<{ revisions?: BidSubmissionRevisionRow[]; error?: string }>;
  listVendorVisibleBidQuestions: (bidPackageId: string) => Promise<{ questions?: VendorVisibleBidQuestionRow[]; error?: string }>;
  listVendorVisibleBidAddenda: (bidPackageId: string) => Promise<{ addenda?: VendorVisibleBidAddendumRow[]; error?: string }>;
  getVendorBidAddendumAcknowledgments: (bidPackageId: string) => Promise<{ acknowledgments?: BidAddendumAcknowledgmentRow[]; error?: string }>;
}

function formatCentsAsDollars(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

const boxStyle: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 6, padding: 12, fontSize: 13 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "#666", marginBottom: 4 };
const inputStyle: React.CSSProperties = { fontSize: 14, padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, width: "100%", boxSizing: "border-box" };
const buttonStyle: React.CSSProperties = { fontSize: 13, padding: "6px 14px", borderRadius: 4, border: "1px solid #333", background: "#222", color: "#fff", cursor: "pointer" };
const secondaryButtonStyle: React.CSSProperties = { ...buttonStyle, background: "#fff", color: "#222" };
const errorStyle: React.CSSProperties = { color: "#a33", fontSize: 12, marginTop: 4 };

export function VendorBidWorkspace({
  bidPackageId,
  vendorId,
  isAcceptingSubmissions,
  initialSubmission,
  initialRevisions,
  initialQuestions,
  initialAddenda,
  initialAcknowledgments,
  initialMessages,
  listEntityMessages,
  sendVendorMessage,
  submitVendorBid,
  askVendorBidQuestion,
  acknowledgeBidAddendum,
  getVendorOwnBidSubmission,
  listMyBidSubmissionRevisions,
  listVendorVisibleBidQuestions,
  listVendorVisibleBidAddenda,
  getVendorBidAddendumAcknowledgments,
}: VendorBidWorkspaceProps) {
  const [submission, setSubmission] = useState<BidSubmissionRow | null>(initialSubmission);
  const [revisions, setRevisions] = useState<BidSubmissionRevisionRow[]>(initialRevisions);
  const [questions, setQuestions] = useState<VendorVisibleBidQuestionRow[]>(initialQuestions);
  const [addenda, setAddenda] = useState<VendorVisibleBidAddendumRow[]>(initialAddenda);
  const [acknowledgments, setAcknowledgments] = useState<BidAddendumAcknowledgmentRow[]>(initialAcknowledgments);

  const [amountDraft, setAmountDraft] = useState(submission?.amountCents != null ? (submission.amountCents / 100).toFixed(2) : "");
  const [notesDraft, setNotesDraft] = useState(submission?.notes ?? "");
  const [submitSubmitting, setSubmitSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [questionText, setQuestionText] = useState("");
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);

  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [acknowledgeErrors, setAcknowledgeErrors] = useState<Record<string, string | null>>({});

  const [messages, setMessages] = useState<EntityMessageRow[]>(initialMessages);
  const [messageText, setMessageText] = useState("");
  const [messageSubmitting, setMessageSubmitting] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  async function refreshAll() {
    const [submissionResult, questionsResult, addendaResult, acknowledgmentsResult, messagesResult] = await Promise.all([
      getVendorOwnBidSubmission(bidPackageId),
      listVendorVisibleBidQuestions(bidPackageId),
      listVendorVisibleBidAddenda(bidPackageId),
      getVendorBidAddendumAcknowledgments(bidPackageId),
      listEntityMessages(bidPackageId, vendorId),
    ]);
    setMessages(messagesResult.messages ?? []);

    const nextSubmission = submissionResult.submission ?? null;
    setSubmission(nextSubmission);
    setQuestions(questionsResult.questions ?? []);
    setAddenda(addendaResult.addenda ?? []);
    setAcknowledgments(acknowledgmentsResult.acknowledgments ?? []);

    if (nextSubmission) {
      const revisionsResult = await listMyBidSubmissionRevisions(nextSubmission.id);
      setRevisions(revisionsResult.revisions ?? []);
    } else {
      setRevisions([]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!submission) return;
    const dollars = Number(amountDraft.trim());
    if (amountDraft.trim() === "" || Number.isNaN(dollars) || dollars < 0) {
      setSubmitError("Enter a valid bid amount.");
      return;
    }
    setSubmitError(null);
    setSubmitSuccess(false);
    setSubmitSubmitting(true);
    try {
      const amountCents = Math.round(dollars * 100);
      const result = await submitVendorBid(submission.id, amountCents, notesDraft.trim() || undefined);
      if (result.error) {
        setSubmitError(result.error);
        return;
      }
      setSubmitSuccess(true);
      await refreshAll();
    } finally {
      setSubmitSubmitting(false);
    }
  }

  async function handleAskQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!questionText.trim()) {
      setQuestionError("Question text is required.");
      return;
    }
    setQuestionError(null);
    setQuestionSubmitting(true);
    try {
      const result = await askVendorBidQuestion(bidPackageId, vendorId, questionText);
      if (result && "error" in result && result.error) {
        setQuestionError(result.error);
        return;
      }
      setQuestionText("");
      await refreshAll();
    } finally {
      setQuestionSubmitting(false);
    }
  }

  async function handleAcknowledge(addendumId: string) {
    setAcknowledgeErrors((prev) => ({ ...prev, [addendumId]: null }));
    setAcknowledgingId(addendumId);
    try {
      const result = await acknowledgeBidAddendum(addendumId, vendorId);
      if (result && "error" in result && result.error) {
        setAcknowledgeErrors((prev) => ({ ...prev, [addendumId]: result.error! }));
        return;
      }
      await refreshAll();
    } finally {
      setAcknowledgingId(null);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!messageText.trim()) {
      setMessageError("Message text is required.");
      return;
    }
    setMessageError(null);
    setMessageSubmitting(true);
    try {
      const result = await sendVendorMessage(bidPackageId, vendorId, messageText);
      if (result.error) {
        setMessageError(result.error);
        return;
      }
      setMessageText("");
      await refreshAll();
    } finally {
      setMessageSubmitting(false);
    }
  }

  const acknowledgedByAddendumId = new Map(acknowledgments.map((a) => [a.bidAddendumId, a]));

  return (
    <>
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #ddd" }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Your bid</h2>

        {!submission && (
          <p style={{ fontSize: 13, color: "#888" }}>No submission record found for your company on this package.</p>
        )}

        {submission && !isAcceptingSubmissions && (
          <div style={{ ...boxStyle, background: "#faf7f0" }}>
            This bid package is no longer accepting new or revised submissions
            {submission.status === "invited" || submission.status === "submitted"
              ? " — the package has closed or its due date has passed."
              : ` (your submission is ${submission.status}).`}
            {submission.amountCents != null && (
              <p style={{ margin: "8px 0 0 0" }}>
                Your last submitted amount: <strong>{formatCentsAsDollars(submission.amountCents)}</strong>
              </p>
            )}
          </div>
        )}

        {submission && isAcceptingSubmissions && (submission.status === "invited" || submission.status === "submitted") && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
            <div>
              <label style={labelStyle} htmlFor="vendor-bid-amount">
                Bid amount ($)
              </label>
              <input
                id="vendor-bid-amount"
                type="number"
                step="0.01"
                min="0"
                style={inputStyle}
                value={amountDraft}
                onChange={(e) => setAmountDraft(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="vendor-bid-notes">
                Notes / comments (optional)
              </label>
              <textarea
                id="vendor-bid-notes"
                rows={3}
                style={{ ...inputStyle, fontFamily: "inherit" }}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
            </div>
            <button type="submit" style={buttonStyle} disabled={submitSubmitting}>
              {submitSubmitting ? "Submitting…" : submission.status === "invited" ? "Submit Bid" : "Submit Revision"}
            </button>
            {submitSuccess && !submitError && <p style={{ color: "#2a6", fontSize: 12 }}>Submitted. Your history is updated below.</p>}
            {submitError && <p style={errorStyle}>{submitError}</p>}
          </form>
        )}

        {submission && (submission.status === "awarded" || submission.status === "declined" || submission.status === "withdrawn") && (
          <p style={{ fontSize: 13, color: "#888" }}>
            Your submission is <strong>{submission.status}</strong> — no further revisions can be made.
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Your submission history</h3>
          {revisions.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888" }}>No submissions yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {[...revisions]
                .sort((a, b) => b.revisionNumber - a.revisionNumber)
                .map((rev) => (
                  <li key={rev.id} style={boxStyle}>
                    <strong>Revision {rev.revisionNumber}</strong> — {formatCentsAsDollars(rev.amountCents)}{" "}
                    <span style={{ color: "#888" }}>({formatDateTime(rev.submittedAt)})</span>
                    {rev.notes && <p style={{ margin: "4px 0 0 0" }}>{rev.notes}</p>}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #ddd" }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Ask a question</h2>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
          Your question is visible to you and the Stone Column team only, unless staff chooses to share it (and its
          answer) with every invited vendor.
        </p>
        <form onSubmit={handleAskQuestion} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
          <textarea
            rows={2}
            style={{ ...inputStyle, fontFamily: "inherit" }}
            placeholder="Type your question…"
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            aria-label="Question text"
          />
          <button type="submit" style={secondaryButtonStyle} disabled={questionSubmitting}>
            {questionSubmitting ? "Sending…" : "Ask Question"}
          </button>
          {questionError && <p style={errorStyle}>{questionError}</p>}
        </form>

        {questions.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {questions.map((q) => (
              <li key={q.id} style={boxStyle}>
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

      {addenda.length > 0 && (
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #ddd" }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Acknowledge addenda</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {addenda.map((a) => {
              const ack = acknowledgedByAddendumId.get(a.id);
              return (
                <li key={a.id} style={boxStyle}>
                  <p style={{ margin: "0 0 4px 0", fontWeight: 600 }}>
                    {a.title} — {formatDateTime(a.issuedAt)}
                  </p>
                  <p style={{ margin: "0 0 8px 0" }}>{a.bodyText}</p>
                  {a.revisedDueAt && <p style={{ margin: "0 0 8px 0", color: "#888" }}>Revised due date: {formatDateTime(a.revisedDueAt)}</p>}
                  {ack ? (
                    <p style={{ margin: 0, color: "#2a6" }}>Acknowledged on {formatDateTime(ack.acknowledgedAt)}</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        disabled={acknowledgingId === a.id}
                        onClick={() => handleAcknowledge(a.id)}
                      >
                        {acknowledgingId === a.id ? "Acknowledging…" : "Acknowledge"}
                      </button>
                      {acknowledgeErrors[a.id] && <p style={errorStyle}>{acknowledgeErrors[a.id]}</p>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #ddd" }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Messages</h2>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
          A private conversation between your company and the Stone Column team on this bid package. No other invited
          vendor can see this thread.
        </p>

        {messages.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888" }}>No messages yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.map((m) => (
              <li key={m.id} style={{ ...boxStyle, background: m.direction === "outbound" ? "#fff" : "#f3f7f4" }}>
                <p style={{ margin: "0 0 4px 0", fontSize: 11, color: "#888" }}>
                  {m.direction === "outbound" ? "From Stone Column" : "From you"} ·{" "}
                  {formatDateTime(m.direction === "outbound" ? m.sentAt : m.receivedAt ?? m.createdAt)}
                </p>
                {m.subject && <p style={{ margin: "0 0 4px 0", fontWeight: 600 }}>{m.subject}</p>}
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.body}</p>
                {m.attachments.length > 0 && (
                  <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0 0", fontSize: 12 }}>
                    {m.attachments.map((a) => (
                      <li key={a.id}>
                        <a href={`/api/bid-packages/${bidPackageId}/messages/attachments/${a.id}/download`} target="_blank" rel="noopener noreferrer">
                          {a.fileName}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleSendMessage} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
          <textarea
            rows={3}
            style={{ ...inputStyle, fontFamily: "inherit" }}
            placeholder="Type a message to the Stone Column team…"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            aria-label="Message text"
          />
          <button type="submit" style={secondaryButtonStyle} disabled={messageSubmitting}>
            {messageSubmitting ? "Sending…" : "Send"}
          </button>
          {messageError && <p style={errorStyle}>{messageError}</p>}
        </form>
      </div>
    </>
  );
}
