"use client";

/**
 * The `/admin/bids` screen (P5, Task 6) — a single Client Component
 * owning list + detail + every form, matching ImportWizard.tsx's own
 * single-file-per-workflow shape (see that file's header comment for
 * why this package stays free of any apps/web-layout/next/headers
 * dependency: every Server Action this component calls is passed in
 * as a prop from page.tsx, never imported directly).
 *
 * State-freshness rule (same lesson ImportWizard.tsx already
 * documents): the detail pane (`detail`/`questions`/`addenda`) is
 * never patched in place after a mutation. Every successful mutation
 * is followed by a full `loadDetail(id)` re-fetch whose result
 * WHOLESALE-REPLACES those three state values — never merged or
 * hand-patched. `packages` (the list) is the one exception: since no
 * `listBidPackages` Server Action exists (only `getBidPackageDetail`/
 * `listBidQuestions`/`listBidAddenda` do, per the brief's Data flow
 * section), the single package row affected by a mutation is derived
 * straight from that same fresh `getBidPackageDetail` response
 * (`toBidPackageRow`) and spliced into `packages` — still sourced from
 * a real re-fetch, never a client-guessed value.
 *
 * Loading state: this deliberately uses plain `useState` booleans
 * (`detailLoading`, `createSubmitting`, etc.), not React's
 * `useTransition`. React 18's `startTransition` does not reliably keep
 * `isPending` true across an `await` inside a plain async callback
 * (that guarantee is a later-React "Actions" feature this app's pinned
 * React 18.3.1 doesn't have) — using it here would risk the "Loading…"
 * indicator flickering off before the fetch actually resolves. This
 * matches what ImportWizard.tsx itself does (manual `uploading`/
 * `confirming`/`rowsLoading` booleans), which is the concrete pattern
 * this component was told to follow.
 */
import React, { useState } from "react";
import { colors, spacing, typography, radius } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { CostCode } from "../../../01-financial-engine/src/types";
import type {
  BidPackageRow,
  BidPackageDetail,
  BidSubmissionRow,
  VendorRow,
  BidQuestionRow,
  BidAddendumRow,
} from "../services/bidService";

type ActionResult = { error?: string } | void | undefined;

export interface BidPackageWorkspaceProps {
  projectId: string;
  bidPackages: BidPackageRow[];
  costCodes: CostCode[];
  vendors: VendorRow[];
  createBidPackage: (
    projectId: string,
    costCodeId: string,
    title: string,
    scopeDescription?: string,
    dueAt?: string
  ) => Promise<{ id?: string; error?: string }>;
  publishBidPackage: (bidPackageId: string) => Promise<ActionResult>;
  inviteVendor: (bidPackageId: string, vendorId: string) => Promise<ActionResult>;
  getBidPackageDetail: (bidPackageId: string) => Promise<{ detail?: BidPackageDetail; error?: string }>;
  listBidQuestions: (bidPackageId: string) => Promise<{ questions?: BidQuestionRow[]; error?: string }>;
  listBidAddenda: (bidPackageId: string) => Promise<{ addenda?: BidAddendumRow[]; error?: string }>;
  recordBidSubmission: (bidSubmissionId: string, amountCents: number, notes?: string) => Promise<ActionResult>;
  awardBid: (bidSubmissionId: string) => Promise<{ committedCostId?: string; error?: string }>;
  askBidQuestion: (bidPackageId: string, vendorId: string, questionText: string) => Promise<ActionResult>;
  answerBidQuestion: (bidQuestionId: string, answerText: string) => Promise<ActionResult>;
  issueBidAddendum: (bidPackageId: string, title: string, bodyText: string, revisedDueAt?: string) => Promise<ActionResult>;
}

const PACKAGE_STATUS_LABELS: Record<BidPackageRow["status"], string> = {
  draft: "Draft",
  published: "Published",
  awarded: "Awarded",
  cancelled: "Cancelled",
};

const SUBMISSION_STATUS_LABELS: Record<BidSubmissionRow["status"], string> = {
  invited: "Invited",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// datetime-local/date <input> values ("2026-08-20") need a real ISO
// timestamp before they can be passed to a Server Action expecting
// `timestamptz`-shaped text — this is the one conversion point every
// due-date field in this component funnels through.
function dateInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toBidPackageRow(detail: BidPackageDetail): BidPackageRow {
  return {
    id: detail.id,
    projectId: detail.projectId,
    costCodeId: detail.costCodeId,
    title: detail.title,
    scopeDescription: detail.scopeDescription,
    dueAt: detail.dueAt,
    status: detail.status,
    createdAt: detail.createdAt,
  };
}

function PackageStatusBadge({ status }: { status: BidPackageRow["status"] }) {
  return <span className={`sc-bids-badge sc-bids-badge-pkg-${status}`}>{PACKAGE_STATUS_LABELS[status]}</span>;
}

function SubmissionStatusBadge({ status }: { status: BidSubmissionRow["status"] }) {
  return <span className={`sc-bids-badge sc-bids-badge-sub-${status}`}>{SUBMISSION_STATUS_LABELS[status]}</span>;
}

export function BidPackageWorkspace({
  projectId,
  bidPackages,
  costCodes,
  vendors,
  createBidPackage,
  publishBidPackage,
  inviteVendor,
  getBidPackageDetail,
  listBidQuestions,
  listBidAddenda,
  recordBidSubmission,
  awardBid,
  askBidQuestion,
  answerBidQuestion,
  issueBidAddendum,
}: BidPackageWorkspaceProps) {
  const [packages, setPackages] = useState<BidPackageRow[]>(bidPackages);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<BidPackageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<BidQuestionRow[]>([]);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  const [addenda, setAddenda] = useState<BidAddendumRow[]>([]);
  const [addendaError, setAddendaError] = useState<string | null>(null);

  // --- Create package form ---
  const [createTitle, setCreateTitle] = useState("");
  const [createCostCodeId, setCreateCostCodeId] = useState(costCodes[0]?.id ?? "");
  const [createScope, setCreateScope] = useState("");
  const [createDueAt, setCreateDueAt] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // --- Publish ---
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // --- Invite vendor ---
  const [inviteVendorId, setInviteVendorId] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // --- Record submission (per-row, keyed by submission id) ---
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [recordSubmitting, setRecordSubmitting] = useState<Record<string, boolean>>({});
  const [recordErrors, setRecordErrors] = useState<Record<string, string | null>>({});

  // --- Award (per-row confirmation) ---
  const [awardConfirmId, setAwardConfirmId] = useState<string | null>(null);
  const [awardSubmitting, setAwardSubmitting] = useState<Record<string, boolean>>({});
  const [awardErrors, setAwardErrors] = useState<Record<string, string | null>>({});

  // --- Ask question ---
  const [questionVendorId, setQuestionVendorId] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);

  // --- Answer question (per-row) ---
  const [answerOpenId, setAnswerOpenId] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [answerSubmitting, setAnswerSubmitting] = useState<Record<string, boolean>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string | null>>({});

  // --- Issue addendum ---
  const [addendumTitle, setAddendumTitle] = useState("");
  const [addendumBody, setAddendumBody] = useState("");
  const [addendumDueAt, setAddendumDueAt] = useState("");
  const [addendumSubmitting, setAddendumSubmitting] = useState(false);
  const [addendumError, setAddendumError] = useState<string | null>(null);

  const costCodesById = new Map(costCodes.map((cc) => [cc.id, cc]));

  // The single re-fetch every mutation below calls on success. Never
  // patches state in place — always replaces detail/questions/addenda
  // wholesale from a fresh read, and (when the affected package is
  // already in the list) refreshes that one list row from the same
  // fresh detail response so status-badge changes (publish/award) show
  // up in the list without a separate listBidPackages round trip.
  async function loadDetail(id: string) {
    const [detailResult, questionsResult, addendaResult] = await Promise.all([
      getBidPackageDetail(id),
      listBidQuestions(id),
      listBidAddenda(id),
    ]);

    if (detailResult.error || !detailResult.detail) {
      setDetail(null);
      setDetailError(detailResult.error ?? "Bid package not found.");
      setQuestions([]);
      setQuestionsError(null);
      setAddenda([]);
      setAddendaError(null);
      return;
    }

    setDetailError(null);
    setDetail(detailResult.detail);
    setPackages((prev) => {
      const row = toBidPackageRow(detailResult.detail!);
      const exists = prev.some((p) => p.id === id);
      return exists ? prev.map((p) => (p.id === id ? row : p)) : [row, ...prev];
    });

    if (questionsResult.error) {
      setQuestionsError(questionsResult.error);
      setQuestions([]);
    } else {
      setQuestionsError(null);
      setQuestions(questionsResult.questions ?? []);
    }

    if (addendaResult.error) {
      setAddendaError(addendaResult.error);
      setAddenda([]);
    } else {
      setAddendaError(null);
      setAddenda(addendaResult.addenda ?? []);
    }
  }

  async function handleSelectPackage(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setQuestions([]);
    setQuestionsError(null);
    setAddenda([]);
    setAddendaError(null);
    setAwardConfirmId(null);
    setDetailLoading(true);
    try {
      await loadDetail(id);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleRetryDetail() {
    if (!selectedId) return;
    setDetailLoading(true);
    try {
      await loadDetail(selectedId);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!createCostCodeId) {
      setCreateError("Select a cost code.");
      return;
    }
    if (!createTitle.trim()) {
      setCreateError("Title is required.");
      return;
    }
    setCreateError(null);
    setCreateSubmitting(true);
    try {
      const result = await createBidPackage(
        projectId,
        createCostCodeId,
        createTitle,
        createScope.trim() || undefined,
        dateInputToIso(createDueAt)
      );
      if (result.error || !result.id) {
        setCreateError(result.error ?? "Failed to create bid package.");
        return;
      }
      setCreateTitle("");
      setCreateScope("");
      setCreateDueAt("");
      await handleSelectPackage(result.id);
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handlePublish() {
    if (!detail) return;
    setPublishError(null);
    setPublishSubmitting(true);
    try {
      const result = await publishBidPackage(detail.id);
      if (result && "error" in result && result.error) {
        setPublishError(result.error);
        return;
      }
      await loadDetail(detail.id);
    } finally {
      setPublishSubmitting(false);
    }
  }

  async function handleInvite() {
    if (!detail) return;
    if (!inviteVendorId) {
      setInviteError("Select a vendor to invite.");
      return;
    }
    setInviteError(null);
    setInviteSubmitting(true);
    try {
      const result = await inviteVendor(detail.id, inviteVendorId);
      if (result && "error" in result && result.error) {
        setInviteError(result.error);
        return;
      }
      setInviteVendorId("");
      await loadDetail(detail.id);
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function handleRecordSubmission(submissionId: string) {
    if (!detail) return;
    const raw = (amountDrafts[submissionId] ?? "").trim();
    const dollars = Number(raw);
    if (raw === "" || Number.isNaN(dollars)) {
      setRecordErrors((prev) => ({ ...prev, [submissionId]: "Enter a valid amount." }));
      return;
    }
    const amountCents = Math.round(dollars * 100);
    setRecordErrors((prev) => ({ ...prev, [submissionId]: null }));
    setRecordSubmitting((prev) => ({ ...prev, [submissionId]: true }));
    try {
      const result = await recordBidSubmission(submissionId, amountCents);
      if (result && "error" in result && result.error) {
        setRecordErrors((prev) => ({ ...prev, [submissionId]: result.error! }));
        return;
      }
      setAmountDrafts((prev) => ({ ...prev, [submissionId]: "" }));
      await loadDetail(detail.id);
    } finally {
      setRecordSubmitting((prev) => ({ ...prev, [submissionId]: false }));
    }
  }

  function handleAwardClick(submissionId: string) {
    setAwardConfirmId(submissionId);
    setAwardErrors((prev) => ({ ...prev, [submissionId]: null }));
  }

  function handleAwardCancel() {
    setAwardConfirmId(null);
  }

  async function handleAwardConfirm(submissionId: string) {
    if (!detail) return;
    setAwardSubmitting((prev) => ({ ...prev, [submissionId]: true }));
    try {
      const result = await awardBid(submissionId);
      if (result.error) {
        setAwardErrors((prev) => ({ ...prev, [submissionId]: result.error! }));
        return;
      }
      setAwardConfirmId(null);
      await loadDetail(detail.id);
    } finally {
      setAwardSubmitting((prev) => ({ ...prev, [submissionId]: false }));
    }
  }

  async function handleAskQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!questionVendorId) {
      setQuestionError("Select which invited vendor asked this.");
      return;
    }
    if (!questionText.trim()) {
      setQuestionError("Question text is required.");
      return;
    }
    setQuestionError(null);
    setQuestionSubmitting(true);
    try {
      const result = await askBidQuestion(detail.id, questionVendorId, questionText);
      if (result && "error" in result && result.error) {
        setQuestionError(result.error);
        return;
      }
      setQuestionText("");
      setQuestionVendorId("");
      await loadDetail(detail.id);
    } finally {
      setQuestionSubmitting(false);
    }
  }

  async function handleAnswer(questionId: string) {
    if (!detail) return;
    const text = (answerDrafts[questionId] ?? "").trim();
    if (!text) {
      setAnswerErrors((prev) => ({ ...prev, [questionId]: "Answer text is required." }));
      return;
    }
    setAnswerErrors((prev) => ({ ...prev, [questionId]: null }));
    setAnswerSubmitting((prev) => ({ ...prev, [questionId]: true }));
    try {
      const result = await answerBidQuestion(questionId, text);
      if (result && "error" in result && result.error) {
        setAnswerErrors((prev) => ({ ...prev, [questionId]: result.error! }));
        return;
      }
      setAnswerOpenId(null);
      await loadDetail(detail.id);
    } finally {
      setAnswerSubmitting((prev) => ({ ...prev, [questionId]: false }));
    }
  }

  async function handleIssueAddendum(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!addendumTitle.trim() || !addendumBody.trim()) {
      setAddendumError("Title and body are required.");
      return;
    }
    setAddendumError(null);
    setAddendumSubmitting(true);
    try {
      const result = await issueBidAddendum(detail.id, addendumTitle, addendumBody, dateInputToIso(addendumDueAt));
      if (result && "error" in result && result.error) {
        setAddendumError(result.error);
        return;
      }
      setAddendumTitle("");
      setAddendumBody("");
      setAddendumDueAt("");
      await loadDetail(detail.id);
    } finally {
      setAddendumSubmitting(false);
    }
  }

  const availableVendors = detail ? vendors.filter((v) => !detail.submissions.some((s) => s.vendorId === v.id)) : vendors;

  return (
    <div className="sc-bids-workspace">
      <div className="sc-bids-layout">
        <div className="sc-bids-list-col">
          <h3>Bid Packages</h3>
          {packages.length === 0 && <p className="sc-bids-empty">No bid packages yet. Create one to get started.</p>}
          {packages.length > 0 && (
            <ul className="sc-bids-list">
              {packages.map((pkg) => (
                <li key={pkg.id}>
                  <button
                    type="button"
                    className={`sc-bids-list-item${pkg.id === selectedId ? " sc-bids-list-item-active" : ""}`}
                    onClick={() => handleSelectPackage(pkg.id)}
                  >
                    <span className="sc-bids-list-title">{pkg.title}</span>
                    <PackageStatusBadge status={pkg.status} />
                    <span className="sc-bids-list-due">Due {formatDate(pkg.dueAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <section className="sc-bids-create">
            <h4>Create a bid package</h4>
            <form onSubmit={handleCreateSubmit} className="sc-bids-form">
              <div className="sc-bids-field">
                <label htmlFor="sc-bids-create-title">Title</label>
                <input
                  id="sc-bids-create-title"
                  className="sc-bids-input"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                />
              </div>
              <div className="sc-bids-field">
                <label htmlFor="sc-bids-create-costcode">Cost code</label>
                <select
                  id="sc-bids-create-costcode"
                  className="sc-bids-input"
                  value={createCostCodeId}
                  onChange={(e) => setCreateCostCodeId(e.target.value)}
                >
                  <option value="">— select —</option>
                  {costCodes.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code}
                      {cc.activityName ? ` — ${cc.activityName}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sc-bids-field">
                <label htmlFor="sc-bids-create-scope">Scope description (optional)</label>
                <textarea
                  id="sc-bids-create-scope"
                  className="sc-bids-input"
                  rows={2}
                  value={createScope}
                  onChange={(e) => setCreateScope(e.target.value)}
                />
              </div>
              <div className="sc-bids-field">
                <label htmlFor="sc-bids-create-due">Due date (optional)</label>
                <input
                  id="sc-bids-create-due"
                  type="date"
                  className="sc-bids-input"
                  value={createDueAt}
                  onChange={(e) => setCreateDueAt(e.target.value)}
                />
              </div>
              <button type="submit" className="sc-bids-btn sc-bids-btn-primary" disabled={createSubmitting}>
                {createSubmitting ? "Creating…" : "Create Package"}
              </button>
              {createError && <div className="sc-bids-error">{createError}</div>}
            </form>
          </section>
        </div>

        <div className="sc-bids-detail-col">
          {!selectedId && (
            <p className="sc-bids-empty">Select a bid package on the left to view its detail, or create one to get started.</p>
          )}

          {selectedId && detailLoading && !detail && !detailError && <p>Loading…</p>}

          {selectedId && detailError && (
            <div className="sc-bids-detail-error">
              <div className="sc-bids-error">{detailError}</div>
              <button type="button" className="sc-bids-btn" onClick={handleRetryDetail}>
                Retry
              </button>
            </div>
          )}

          {selectedId && detail && (
            <div className="sc-bids-detail">
              <div className="sc-bids-detail-header">
                <h3>{detail.title}</h3>
                <PackageStatusBadge status={detail.status} />
              </div>
              {detail.scopeDescription && <p className="sc-bids-scope">{detail.scopeDescription}</p>}
              <p className="sc-bids-meta">
                Cost code: {costCodesById.get(detail.costCodeId)?.code ?? detail.costCodeId} · Due: {formatDate(detail.dueAt)}
              </p>

              {detail.status === "awarded" && (
                <div className="sc-bids-note">
                  Bid awarded. View the resulting commitment in <a href="/admin/commitments">Commitments</a>.
                </div>
              )}

              {detail.status === "draft" && (
                <div className="sc-bids-inline-form">
                  <button
                    type="button"
                    className="sc-bids-btn sc-bids-btn-primary"
                    disabled={publishSubmitting}
                    onClick={handlePublish}
                  >
                    {publishSubmitting ? "Publishing…" : "Publish"}
                  </button>
                  {publishError && <div className="sc-bids-error">{publishError}</div>}
                </div>
              )}

              <section className="sc-bids-section">
                <h4>Vendors &amp; submissions</h4>

                <div className="sc-bids-inline-form">
                  <select
                    className="sc-bids-input"
                    value={inviteVendorId}
                    onChange={(e) => setInviteVendorId(e.target.value)}
                    aria-label="Vendor to invite"
                  >
                    <option value="">— select a vendor —</option>
                    {availableVendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="sc-bids-btn" disabled={inviteSubmitting} onClick={handleInvite}>
                    {inviteSubmitting ? "Inviting…" : "Invite"}
                  </button>
                </div>
                {inviteError && <div className="sc-bids-error">{inviteError}</div>}

                {detail.submissions.length === 0 ? (
                  <p className="sc-bids-empty">No vendors invited yet</p>
                ) : (
                  <table className="sc-bids-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Vendor</th>
                        <th style={{ textAlign: "left" }}>Status</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                        <th style={{ textAlign: "left" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.submissions.map((sub) => (
                        <tr key={sub.id}>
                          <td>{sub.vendorName}</td>
                          <td>
                            <SubmissionStatusBadge status={sub.status} />
                          </td>
                          <td style={{ textAlign: "right" }}>{sub.amountCents != null ? formatCents(sub.amountCents) : "—"}</td>
                          <td>
                            {sub.status === "invited" && (
                              <div className="sc-bids-inline-form">
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="Amount ($)"
                                  className="sc-bids-input sc-bids-input-narrow"
                                  value={amountDrafts[sub.id] ?? ""}
                                  onChange={(e) => setAmountDrafts((prev) => ({ ...prev, [sub.id]: e.target.value }))}
                                  aria-label={`Bid amount for ${sub.vendorName}`}
                                />
                                <button
                                  type="button"
                                  className="sc-bids-btn"
                                  disabled={!!recordSubmitting[sub.id]}
                                  onClick={() => handleRecordSubmission(sub.id)}
                                >
                                  {recordSubmitting[sub.id] ? "Recording…" : "Record"}
                                </button>
                                {recordErrors[sub.id] && <div className="sc-bids-error">{recordErrors[sub.id]}</div>}
                              </div>
                            )}

                            {sub.status === "submitted" &&
                              (awardConfirmId === sub.id ? (
                                <div className="sc-bids-confirm">
                                  <p>Award this bid? This creates a commitment and declines every other submitted bid on this package.</p>
                                  <button
                                    type="button"
                                    className="sc-bids-btn sc-bids-btn-primary"
                                    disabled={!!awardSubmitting[sub.id]}
                                    onClick={() => handleAwardConfirm(sub.id)}
                                  >
                                    {awardSubmitting[sub.id] ? "Awarding…" : "Yes, award"}
                                  </button>
                                  <button type="button" className="sc-bids-btn" onClick={handleAwardCancel}>
                                    Cancel
                                  </button>
                                  {awardErrors[sub.id] && <div className="sc-bids-error">{awardErrors[sub.id]}</div>}
                                </div>
                              ) : (
                                <button type="button" className="sc-bids-btn" onClick={() => handleAwardClick(sub.id)}>
                                  Award
                                </button>
                              ))}

                            {sub.status === "awarded" && (
                              <button
                                type="button"
                                className="sc-bids-btn"
                                disabled
                                title="Issue Subcontract ships with Task 8's document issuance service."
                              >
                                Issue Subcontract (coming soon)
                              </button>
                            )}

                            {(sub.status === "declined" || sub.status === "withdrawn") && (
                              <span className="sc-bids-muted">{SUBMISSION_STATUS_LABELS[sub.status]}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="sc-bids-section">
                <h4>Questions &amp; answers</h4>
                {questionsError && <div className="sc-bids-error">{questionsError}</div>}
                {questions.length === 0 ? (
                  <p className="sc-bids-empty">No questions logged yet.</p>
                ) : (
                  <ul className="sc-bids-qa-list">
                    {questions.map((q) => (
                      <li key={q.id} className="sc-bids-qa-item">
                        <p className="sc-bids-qa-question">{q.questionText}</p>
                        <p className="sc-bids-qa-meta">
                          Recorded by {q.recordedByName ?? "a staff member"} on {formatDateTime(q.askedAt)}
                        </p>
                        {q.answerText ? (
                          <p className="sc-bids-qa-answer">
                            <strong>Answer:</strong> {q.answerText}{" "}
                            <span className="sc-bids-qa-meta">({formatDateTime(q.answeredAt)})</span>
                          </p>
                        ) : answerOpenId === q.id ? (
                          <div className="sc-bids-inline-form">
                            <textarea
                              className="sc-bids-input"
                              rows={2}
                              value={answerDrafts[q.id] ?? ""}
                              onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                              aria-label="Answer text"
                            />
                            <button
                              type="button"
                              className="sc-bids-btn sc-bids-btn-primary"
                              disabled={!!answerSubmitting[q.id]}
                              onClick={() => handleAnswer(q.id)}
                            >
                              {answerSubmitting[q.id] ? "Saving…" : "Save answer"}
                            </button>
                            <button type="button" className="sc-bids-btn" onClick={() => setAnswerOpenId(null)}>
                              Cancel
                            </button>
                            {answerErrors[q.id] && <div className="sc-bids-error">{answerErrors[q.id]}</div>}
                          </div>
                        ) : (
                          <button type="button" className="sc-bids-btn" onClick={() => setAnswerOpenId(q.id)}>
                            Answer
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={handleAskQuestion} className="sc-bids-form">
                  <h5>Log a question</h5>
                  <div className="sc-bids-field">
                    <label htmlFor="sc-bids-question-vendor">Asked by</label>
                    <select
                      id="sc-bids-question-vendor"
                      className="sc-bids-input"
                      value={questionVendorId}
                      onChange={(e) => setQuestionVendorId(e.target.value)}
                      disabled={detail.submissions.length === 0}
                    >
                      <option value="">— select an invited vendor —</option>
                      {detail.submissions.map((sub) => (
                        <option key={sub.vendorId} value={sub.vendorId}>
                          {sub.vendorName}
                        </option>
                      ))}
                    </select>
                  </div>
                  {detail.submissions.length === 0 && <p className="sc-bids-hint">Invite a vendor before logging a question.</p>}
                  <div className="sc-bids-field">
                    <label htmlFor="sc-bids-question-text">Question</label>
                    <textarea
                      id="sc-bids-question-text"
                      className="sc-bids-input"
                      rows={2}
                      value={questionText}
                      onChange={(e) => setQuestionText(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="sc-bids-btn sc-bids-btn-primary"
                    disabled={questionSubmitting || detail.submissions.length === 0}
                  >
                    {questionSubmitting ? "Logging…" : "Log Question"}
                  </button>
                  {questionError && <div className="sc-bids-error">{questionError}</div>}
                </form>
              </section>

              <section className="sc-bids-section">
                <h4>Addenda</h4>
                {addendaError && <div className="sc-bids-error">{addendaError}</div>}
                {addenda.length === 0 ? (
                  <p className="sc-bids-empty">No addenda issued yet.</p>
                ) : (
                  <ul className="sc-bids-addenda-list">
                    {addenda.map((a) => (
                      <li key={a.id}>
                        <p className="sc-bids-addendum-title">
                          <strong>{a.title}</strong> — {formatDateTime(a.issuedAt)}
                        </p>
                        <p>{a.bodyText}</p>
                        {a.revisedDueAt && <p className="sc-bids-meta">Revised due date: {formatDate(a.revisedDueAt)}</p>}
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={handleIssueAddendum} className="sc-bids-form">
                  <h5>Issue an addendum</h5>
                  <div className="sc-bids-field">
                    <label htmlFor="sc-bids-addendum-title">Title</label>
                    <input
                      id="sc-bids-addendum-title"
                      className="sc-bids-input"
                      value={addendumTitle}
                      onChange={(e) => setAddendumTitle(e.target.value)}
                    />
                  </div>
                  <div className="sc-bids-field">
                    <label htmlFor="sc-bids-addendum-body">Body</label>
                    <textarea
                      id="sc-bids-addendum-body"
                      className="sc-bids-input"
                      rows={3}
                      value={addendumBody}
                      onChange={(e) => setAddendumBody(e.target.value)}
                    />
                  </div>
                  <div className="sc-bids-field">
                    <label htmlFor="sc-bids-addendum-due">Revised due date (optional)</label>
                    <input
                      id="sc-bids-addendum-due"
                      type="date"
                      className="sc-bids-input"
                      value={addendumDueAt}
                      onChange={(e) => setAddendumDueAt(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="sc-bids-btn sc-bids-btn-primary" disabled={addendumSubmitting}>
                    {addendumSubmitting ? "Issuing…" : "Issue Addendum"}
                  </button>
                  {addendumError && <div className="sc-bids-error">{addendumError}</div>}
                </form>
              </section>
            </div>
          )}
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: workspaceStyles }} />
    </div>
  );
}

const workspaceStyles = `
.sc-bids-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-bids-layout { display: flex; gap: ${spacing.lg}; align-items: flex-start; }
.sc-bids-list-col { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; gap: ${spacing.md}; }
.sc-bids-detail-col { flex: 1; min-width: 0; }
.sc-bids-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: ${spacing.xs}; }
.sc-bids-list-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; padding: ${spacing.sm}; border: 1px solid ${colors.line}; border-radius: ${radius.md}; background: ${colors.white}; cursor: pointer; }
.sc-bids-list-item-active { border-color: ${colors.sage}; background: ${colors.sageTint}; }
.sc-bids-list-title { font-weight: ${typography.weightSemibold}; font-size: ${typography.sizeSm}; }
.sc-bids-list-due { font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; }
.sc-bids-create { border-top: 1px solid ${colors.line}; padding-top: ${spacing.md}; }
.sc-bids-create h4 { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeSm}; text-transform: uppercase; letter-spacing: 0.02em; color: ${colors.stoneDark}; }
.sc-bids-form { display: flex; flex-direction: column; gap: ${spacing.sm}; align-items: flex-start; }
.sc-bids-form h5 { margin: ${spacing.md} 0 0 0; font-size: ${typography.sizeSm}; color: ${colors.stoneDark}; }
.sc-bids-field { display: flex; flex-direction: column; gap: 4px; width: 100%; max-width: 420px; }
.sc-bids-field label { font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
.sc-bids-input { padding: 6px 8px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; color: ${colors.ink}; background: ${colors.white}; }
.sc-bids-input-narrow { max-width: 140px; }
.sc-bids-btn { padding: 7px 13px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; background: ${colors.white}; color: ${colors.ink2}; font-size: ${typography.sizeSm}; cursor: pointer; align-self: flex-start; }
.sc-bids-btn-primary { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-bids-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-bids-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; margin-top: 4px; }
.sc-bids-empty { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }
.sc-bids-hint { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; margin: 0; }
.sc-bids-muted { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }
.sc-bids-note { background: ${colors.goldTint}; color: ${colors.ink}; border-radius: ${radius.md}; padding: ${spacing.sm} ${spacing.md}; font-size: ${typography.sizeSm}; margin: ${spacing.sm} 0; }
.sc-bids-note a { color: ${colors.sageDeep}; font-weight: ${typography.weightSemibold}; }
.sc-bids-detail-error { display: flex; align-items: center; gap: ${spacing.sm}; }
.sc-bids-detail-header { display: flex; align-items: center; gap: ${spacing.sm}; }
.sc-bids-detail-header h3 { margin: 0; }
.sc-bids-scope { color: ${colors.ink2}; font-size: ${typography.sizeSm}; }
.sc-bids-meta { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; }
.sc-bids-section { margin-top: ${spacing.lg}; padding-top: ${spacing.md}; border-top: 1px solid ${colors.line}; }
.sc-bids-section h4 { margin: 0 0 ${spacing.sm} 0; }
.sc-bids-inline-form { display: flex; flex-wrap: wrap; align-items: flex-start; gap: ${spacing.sm}; margin-bottom: ${spacing.sm}; }
.sc-bids-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; margin-top: ${spacing.sm}; }
.sc-bids-table th { padding: 6px 8px; border-bottom: 1px solid ${colors.line}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-bids-table td { padding: 6px 8px; border-bottom: 1px solid ${colors.paperDim}; vertical-align: top; }
.sc-bids-confirm { background: ${colors.brickTint}; border-radius: ${radius.md}; padding: ${spacing.sm}; display: flex; flex-direction: column; gap: ${spacing.xs}; align-items: flex-start; max-width: 360px; }
.sc-bids-confirm p { margin: 0; font-size: ${typography.sizeXs}; color: ${colors.ink}; }
.sc-bids-qa-list, .sc-bids-addenda-list { list-style: none; padding: 0; margin: 0 0 ${spacing.md} 0; display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-bids-qa-item { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm}; }
.sc-bids-qa-question { margin: 0 0 4px 0; font-weight: ${typography.weightMedium}; }
.sc-bids-qa-meta { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; margin: 0 0 6px 0; }
.sc-bids-qa-answer { margin: 6px 0 0 0; font-size: ${typography.sizeSm}; }
.sc-bids-addenda-list li { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm}; }
.sc-bids-addendum-title { margin: 0 0 4px 0; }
.sc-bids-badge { display: inline-block; padding: 2px 8px; border-radius: ${radius.pill}; font-size: ${typography.sizeXs}; font-weight: ${typography.weightMedium}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-bids-badge-pkg-draft { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-bids-badge-pkg-published { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-bids-badge-pkg-awarded { background: ${colors.goldTint}; color: ${colors.gold}; }
.sc-bids-badge-pkg-cancelled { background: ${colors.brickTint}; color: ${colors.brick}; }
.sc-bids-badge-sub-invited { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-bids-badge-sub-submitted { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-bids-badge-sub-awarded { background: ${colors.goldTint}; color: ${colors.gold}; }
.sc-bids-badge-sub-declined { background: ${colors.brickTint}; color: ${colors.brick}; }
.sc-bids-badge-sub-withdrawn { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
`;
