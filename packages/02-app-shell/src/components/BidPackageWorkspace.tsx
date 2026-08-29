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
 *
 * VISUAL MODERNIZATION (docs/production-build/VISUAL-MODERNIZATION-PLAN.md):
 * markup now composes the shared `ui/` primitives (Card/PageHeader/
 * Button/TextInput/Select/Textarea/FormField/Badge/Alert/EmptyState)
 * instead of this file's own one-off `sc-bids-*` input/button/badge/
 * error styling. Visual/structural only — every prop, handler, and the
 * re-fetch-and-replace state-freshness rule above is unchanged. This
 * file already used `<style dangerouslySetInnerHTML>` (not the raw,
 * hydration-unsafe `<style>{...}</style>` form) and still does.
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
import { Card, PageHeader, Button, TextInput, Textarea, Select, FormField, StatusBadge, Alert, EmptyState } from "./ui";
import type { BadgeTone } from "./ui";

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

// Purely presentational tone mapping — reuses the shared Badge tone
// vocabulary rather than this file's own bespoke `sc-bids-badge-pkg-*`/
// `sc-bids-badge-sub-*` color rules (which set the exact same
// sage/gold/brick/paperDim colors these tones already resolve to).
const PACKAGE_STATUS_TONE: Record<BidPackageRow["status"], BadgeTone> = {
  draft: "neutral",
  published: "sage",
  awarded: "gold",
  cancelled: "brick",
};

const SUBMISSION_STATUS_TONE: Record<BidSubmissionRow["status"], BadgeTone> = {
  invited: "neutral",
  submitted: "sage",
  awarded: "gold",
  declined: "brick",
  withdrawn: "neutral",
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
  return <StatusBadge label={PACKAGE_STATUS_LABELS[status]} tone={PACKAGE_STATUS_TONE[status]} />;
}

function SubmissionStatusBadge({ status }: { status: BidSubmissionRow["status"] }) {
  return <StatusBadge label={SUBMISSION_STATUS_LABELS[status]} tone={SUBMISSION_STATUS_TONE[status]} />;
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
      <PageHeader title="Bid Packages" subtitle="Manage vendor bid packages, submissions, questions, and addenda." />
      <div className="sc-bids-layout">
        <Card className="sc-bids-list-col">
          {packages.length === 0 ? (
            <EmptyState title="No bid packages yet" description="Create one below to get started." />
          ) : (
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
              <FormField label="Title" htmlFor="sc-bids-create-title">
                <TextInput
                  id="sc-bids-create-title"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                />
              </FormField>
              <FormField label="Cost code" htmlFor="sc-bids-create-costcode">
                <Select
                  id="sc-bids-create-costcode"
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
                </Select>
              </FormField>
              <FormField label="Scope description (optional)" htmlFor="sc-bids-create-scope">
                <Textarea
                  id="sc-bids-create-scope"
                  rows={2}
                  value={createScope}
                  onChange={(e) => setCreateScope(e.target.value)}
                />
              </FormField>
              <FormField label="Due date (optional)" htmlFor="sc-bids-create-due">
                <TextInput
                  id="sc-bids-create-due"
                  type="date"
                  value={createDueAt}
                  onChange={(e) => setCreateDueAt(e.target.value)}
                />
              </FormField>
              <Button type="submit" variant="primary" disabled={createSubmitting} loading={createSubmitting} loadingText="Creating…">
                Create Package
              </Button>
              {createError && <Alert tone="error">{createError}</Alert>}
            </form>
          </section>
        </Card>

        <Card className="sc-bids-detail-col">
          {!selectedId && (
            <EmptyState
              title="No package selected"
              description="Select a bid package on the left to view its detail, or create one to get started."
            />
          )}

          {selectedId && detailLoading && !detail && !detailError && <p>Loading…</p>}

          {selectedId && detailError && (
            <div className="sc-bids-detail-error">
              <Alert tone="error">{detailError}</Alert>
              <Button variant="secondary" size="sm" onClick={handleRetryDetail}>
                Retry
              </Button>
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
                <Alert tone="info">
                  Bid awarded. View the resulting commitment in <a href="/admin/commitments">Commitments</a>.
                </Alert>
              )}

              {detail.status === "draft" && (
                <div className="sc-bids-inline-form">
                  <Button variant="primary" disabled={publishSubmitting} loading={publishSubmitting} loadingText="Publishing…" onClick={handlePublish}>
                    Publish
                  </Button>
                  {publishError && <Alert tone="error">{publishError}</Alert>}
                </div>
              )}

              <section className="sc-bids-section">
                <h4>Vendors &amp; submissions</h4>

                <div className="sc-bids-inline-form">
                  <Select
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
                  </Select>
                  <Button variant="secondary" disabled={inviteSubmitting} loading={inviteSubmitting} loadingText="Inviting…" onClick={handleInvite}>
                    Invite
                  </Button>
                </div>
                {inviteError && <Alert tone="error">{inviteError}</Alert>}

                {detail.submissions.length === 0 ? (
                  <EmptyState title="No vendors invited yet" />
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
                                <TextInput
                                  type="number"
                                  step="0.01"
                                  placeholder="Amount ($)"
                                  className="sc-bids-input-narrow"
                                  value={amountDrafts[sub.id] ?? ""}
                                  onChange={(e) => setAmountDrafts((prev) => ({ ...prev, [sub.id]: e.target.value }))}
                                  aria-label={`Bid amount for ${sub.vendorName}`}
                                />
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={!!recordSubmitting[sub.id]}
                                  loading={!!recordSubmitting[sub.id]}
                                  loadingText="Recording…"
                                  onClick={() => handleRecordSubmission(sub.id)}
                                >
                                  Record
                                </Button>
                                {recordErrors[sub.id] && <Alert tone="error">{recordErrors[sub.id]}</Alert>}
                              </div>
                            )}

                            {sub.status === "submitted" &&
                              (awardConfirmId === sub.id ? (
                                <div className="sc-bids-confirm">
                                  <Alert tone="warning" title="Award this bid?">
                                    This creates a commitment and declines every other submitted bid on this package.
                                  </Alert>
                                  <div className="sc-bids-confirm-actions">
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      disabled={!!awardSubmitting[sub.id]}
                                      loading={!!awardSubmitting[sub.id]}
                                      loadingText="Awarding…"
                                      onClick={() => handleAwardConfirm(sub.id)}
                                    >
                                      Yes, award
                                    </Button>
                                    <Button variant="secondary" size="sm" onClick={handleAwardCancel}>
                                      Cancel
                                    </Button>
                                  </div>
                                  {awardErrors[sub.id] && <Alert tone="error">{awardErrors[sub.id]}</Alert>}
                                </div>
                              ) : (
                                <Button variant="secondary" size="sm" onClick={() => handleAwardClick(sub.id)}>
                                  Award
                                </Button>
                              ))}

                            {sub.status === "awarded" && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled
                                title="Issue Subcontract ships with Task 8's document issuance service."
                              >
                                Issue Subcontract (coming soon)
                              </Button>
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
                {questionsError && <Alert tone="error">{questionsError}</Alert>}
                {questions.length === 0 ? (
                  <EmptyState title="No questions logged yet." />
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
                            <Textarea
                              rows={2}
                              value={answerDrafts[q.id] ?? ""}
                              onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                              aria-label="Answer text"
                            />
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={!!answerSubmitting[q.id]}
                              loading={!!answerSubmitting[q.id]}
                              loadingText="Saving…"
                              onClick={() => handleAnswer(q.id)}
                            >
                              Save answer
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setAnswerOpenId(null)}>
                              Cancel
                            </Button>
                            {answerErrors[q.id] && <Alert tone="error">{answerErrors[q.id]}</Alert>}
                          </div>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => setAnswerOpenId(q.id)}>
                            Answer
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={handleAskQuestion} className="sc-bids-form">
                  <h5>Log a question</h5>
                  <FormField label="Asked by" htmlFor="sc-bids-question-vendor" hint={detail.submissions.length === 0 ? "Invite a vendor before logging a question." : undefined}>
                    <Select
                      id="sc-bids-question-vendor"
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
                    </Select>
                  </FormField>
                  <FormField label="Question" htmlFor="sc-bids-question-text">
                    <Textarea
                      id="sc-bids-question-text"
                      rows={2}
                      value={questionText}
                      onChange={(e) => setQuestionText(e.target.value)}
                    />
                  </FormField>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={questionSubmitting || detail.submissions.length === 0}
                    loading={questionSubmitting}
                    loadingText="Logging…"
                  >
                    Log Question
                  </Button>
                  {questionError && <Alert tone="error">{questionError}</Alert>}
                </form>
              </section>

              <section className="sc-bids-section">
                <h4>Addenda</h4>
                {addendaError && <Alert tone="error">{addendaError}</Alert>}
                {addenda.length === 0 ? (
                  <EmptyState title="No addenda issued yet." />
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
                  <FormField label="Title" htmlFor="sc-bids-addendum-title">
                    <TextInput
                      id="sc-bids-addendum-title"
                      value={addendumTitle}
                      onChange={(e) => setAddendumTitle(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Body" htmlFor="sc-bids-addendum-body">
                    <Textarea
                      id="sc-bids-addendum-body"
                      rows={3}
                      value={addendumBody}
                      onChange={(e) => setAddendumBody(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Revised due date (optional)" htmlFor="sc-bids-addendum-due">
                    <TextInput
                      id="sc-bids-addendum-due"
                      type="date"
                      value={addendumDueAt}
                      onChange={(e) => setAddendumDueAt(e.target.value)}
                    />
                  </FormField>
                  <Button type="submit" variant="primary" disabled={addendumSubmitting} loading={addendumSubmitting} loadingText="Issuing…">
                    Issue Addendum
                  </Button>
                  {addendumError && <Alert tone="error">{addendumError}</Alert>}
                </form>
              </section>
            </div>
          )}
        </Card>
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
.sc-bids-form { display: flex; flex-direction: column; gap: ${spacing.sm}; align-items: flex-start; width: 100%; }
.sc-bids-form h5 { margin: ${spacing.md} 0 0 0; font-size: ${typography.sizeSm}; color: ${colors.stoneDark}; }
.sc-bids-input-narrow { max-width: 140px; }
.sc-bids-empty { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }
.sc-bids-muted { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }
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
.sc-bids-confirm { display: flex; flex-direction: column; gap: ${spacing.xs}; max-width: 360px; }
.sc-bids-confirm-actions { display: flex; gap: ${spacing.xs}; align-items: center; }
.sc-bids-qa-list, .sc-bids-addenda-list { list-style: none; padding: 0; margin: 0 0 ${spacing.md} 0; display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-bids-qa-item { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm}; }
.sc-bids-qa-question { margin: 0 0 4px 0; font-weight: ${typography.weightMedium}; }
.sc-bids-qa-meta { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; margin: 0 0 6px 0; }
.sc-bids-qa-answer { margin: 6px 0 0 0; font-size: ${typography.sizeSm}; }
.sc-bids-addenda-list li { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm}; }
.sc-bids-addendum-title { margin: 0 0 4px 0; }
`;
