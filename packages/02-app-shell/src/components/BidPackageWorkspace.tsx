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
  StaffProfileRow,
  BidQuestionRow,
  BidAddendumRow,
  BidPackageDocumentRow,
  BidPackageDocumentCategory,
  BidAddendumAcknowledgmentRow,
  VendorMemberRow,
} from "../services/bidService";
import type { IssuedDocumentRow } from "../services/documentIssuanceService";
import type { EntityMessageRow, QuarantinedInboundMessageRow } from "../services/correspondenceService";
import type { EmailSendStatus } from "../services/email/EmailService";
import { Card, PageHeader, Button, TextInput, Textarea, Select, Checkbox, FormField, StatusBadge, Alert, EmptyState } from "./ui";
import type { BadgeTone } from "./ui";

const DOCUMENT_CATEGORY_LABELS: Record<BidPackageDocumentCategory, string> = {
  plans: "Plans",
  specifications: "Specifications",
  scope: "Scope documents",
  photos: "Photos",
  addenda: "Addenda",
  reference: "Reference material",
  other: "Other",
};

const DOCUMENT_CATEGORY_OPTIONS = Object.keys(DOCUMENT_CATEGORY_LABELS) as BidPackageDocumentCategory[];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ActionResult = { error?: string } | void | undefined;

export interface BidPackageWorkspaceProps {
  projectId: string;
  /** P5.0 (Project-Context Write-Safety), requirement 6: named directly
   *  on the create-bid-package button so the last moment before this
   *  write happens still confirms which project it targets. */
  projectName: string;
  bidPackages: BidPackageRow[];
  costCodes: CostCode[];
  vendors: VendorRow[];
  /** P5.2 Phase B (Part B) — org staff, for the "Package Details"
   *  section's Stone Column contact picker. */
  staffProfiles: StaffProfileRow[];
  createBidPackage: (
    projectId: string,
    costCodeId: string,
    title: string,
    scopeDescription?: string,
    dueAt?: string
  ) => Promise<{ id?: string; error?: string }>;
  publishBidPackage: (bidPackageId: string) => Promise<ActionResult>;
  /** P5.2 Phase A's first-access magic-link token is still generated on
   *  every successful invite (Phase D never removes it — see
   *  bidService.ts's own inviteVendor doc comment) but the UI now only
   *  ever shows it as a fallback when `emailStatus` is not 'sent'.
   *  Phase D additions: `recipientEmail` (who the invitation actually
   *  went/would go to) and `emailStatus`/`emailError` (the honest
   *  EmailService outcome — never coerced to a false success). `warning`
   *  still covers the vendor-has-no-email case (invite succeeded, no
   *  notification of any kind was possible). */
  inviteVendor: (
    bidPackageId: string,
    vendorId: string
  ) => Promise<
    | { error?: string; warning?: string; accessToken?: string; recipientEmail?: string; emailStatus?: EmailSendStatus; emailError?: string }
    | void
    | undefined
  >;
  getBidPackageDetail: (bidPackageId: string) => Promise<{ detail?: BidPackageDetail; error?: string }>;
  listBidQuestions: (bidPackageId: string) => Promise<{ questions?: BidQuestionRow[]; error?: string }>;
  listBidAddenda: (bidPackageId: string) => Promise<{ addenda?: BidAddendumRow[]; error?: string }>;
  recordBidSubmission: (bidSubmissionId: string, amountCents: number, notes?: string) => Promise<ActionResult>;
  awardBid: (bidSubmissionId: string) => Promise<{ committedCostId?: string; error?: string }>;
  askBidQuestion: (bidPackageId: string, vendorId: string, questionText: string) => Promise<ActionResult>;
  answerBidQuestion: (bidQuestionId: string, answerText: string) => Promise<ActionResult>;
  issueBidAddendum: (bidPackageId: string, title: string, bodyText: string, revisedDueAt?: string) => Promise<ActionResult>;
  issueSubcontract: (bidPackageId: string, documentNumber?: string) => Promise<{ issuedDocumentId?: string; error?: string }>;
  getLatestIssuedSubcontract: (bidPackageId: string) => Promise<{ document?: IssuedDocumentRow; error?: string }>;
  /** P5.2 Phase B (Part B) — the "Package Details" section's Save
   *  action. Every field is independently optional — omitting a key
   *  leaves that column unchanged server-side. */
  updateBidPackageAssemblyDetails: (
    bidPackageId: string,
    fields: Partial<{
      inclusions: string;
      exclusions: string;
      alternates: string;
      allowances: string;
      pricingBreakdownInstructions: string;
      scheduleExpectations: string;
      bidInstructions: string;
      stoneColumnContactId: string;
    }>
  ) => Promise<ActionResult>;
  /** P5.2 Phase B (Part C) — the "Documents" section's list read.
   *  Upload itself goes straight to the multipart Route Handler via
   *  fetch(), matching P5.1's vendor-documents upload wiring — never a
   *  Server Action for the file bytes themselves. */
  listBidPackageDocuments: (bidPackageId: string) => Promise<{ documents?: BidPackageDocumentRow[]; error?: string }>;
  /** P5.2 Phase C — which invited vendors have acknowledged which
   *  addenda. Submission-level revision history does NOT need its own
   *  prop here: getBidPackageDetail already embeds each submission's
   *  full revisions array (BidSubmissionRow.revisions) in one batched
   *  query, so the "Vendors & submissions" table below reads it
   *  directly off `detail`, refreshed by the same loadDetail() call as
   *  everything else. */
  listBidAddendumAcknowledgments: (bidPackageId: string) => Promise<{ acknowledgments?: BidAddendumAcknowledgmentRow[]; error?: string }>;
  /** P5.2 Phase D — correspondence. listEntityMessages reads ONE
   *  vendor's private thread at a time (staff picks which invited
   *  vendor's thread to view) — matching this domain's own "load detail
   *  on selection" shape used everywhere else in this file. Attachment
   *  upload itself goes straight to a multipart Route Handler via
   *  fetch(), exactly like the Documents section above — never a Server
   *  Action for the file bytes themselves. */
  listEntityMessages: (bidPackageId: string, vendorId: string) => Promise<{ messages?: EntityMessageRow[]; error?: string }>;
  sendStaffMessage: (
    bidPackageId: string,
    vendorId: string,
    subject: string | undefined,
    body: string
  ) => Promise<{ messageId?: string; emailStatus?: EmailSendStatus; emailError?: string; recipientEmail?: string; error?: string }>;
  listQuarantinedMessages: (bidPackageId: string) => Promise<{ messages?: QuarantinedInboundMessageRow[]; error?: string }>;
  discardQuarantinedMessage: (id: string) => Promise<{ error?: string }>;
  promoteQuarantinedMessage: (id: string) => Promise<{ messageId?: string; error?: string }>;
  /** Final-review addition (post-Phase-E): the "Vendor Access" panel on
   *  each invited-vendor row. revokeVendorMember/reactivateVendorMember
   *  were already built, RLS-gated (vendor_members_staff_full_access,
   *  schema/015), and live-checkpoint-tested in Phase A/E — this wires
   *  them to a real button so a staff person (and the owner, during
   *  their walkthrough) can revoke or restore a vendor's portal access
   *  without touching the database directly. Membership here is
   *  per-person-per-vendor-company (vendor_members), not scoped to a
   *  single bid package — revoking a member ends that person's access
   *  to EVERY bid package for that vendor company, which matches
   *  is_vendor_member()'s own scope everywhere else in this codebase. */
  listVendorMembers: (vendorId: string) => Promise<{ members?: VendorMemberRow[]; error?: string }>;
  revokeVendorMember: (vendorId: string, profileId: string) => Promise<{ error?: string }>;
  reactivateVendorMember: (vendorId: string, profileId: string) => Promise<{ error?: string }>;
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
  projectName,
  bidPackages,
  costCodes,
  vendors,
  staffProfiles,
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
  issueSubcontract,
  getLatestIssuedSubcontract,
  updateBidPackageAssemblyDetails,
  listBidPackageDocuments,
  listBidAddendumAcknowledgments,
  listEntityMessages,
  sendStaffMessage,
  listQuarantinedMessages,
  discardQuarantinedMessage,
  promoteQuarantinedMessage,
  listVendorMembers,
  revokeVendorMember,
  reactivateVendorMember,
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

  // --- Addendum acknowledgments (P5.2 Phase C) ---
  const [acknowledgments, setAcknowledgments] = useState<BidAddendumAcknowledgmentRow[]>([]);
  const [acknowledgmentsError, setAcknowledgmentsError] = useState<string | null>(null);

  // --- Submission history expand/collapse, per submission id (P5.2 Phase C) ---
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);

  // --- Vendor access (revoke/reactivate) panel, per vendor id
  // (final-review addition, post-Phase-E) --- keyed by vendorId, not
  // submission id, since membership is company-wide, not per-package.
  const [accessOpenVendorId, setAccessOpenVendorId] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [vendorMembersByVendor, setVendorMembersByVendor] = useState<Record<string, VendorMemberRow[]>>({});
  const [memberActionSubmitting, setMemberActionSubmitting] = useState<Record<string, boolean>>({});
  const [memberActionErrors, setMemberActionErrors] = useState<Record<string, string | null>>({});

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
  const [inviteWarning, setInviteWarning] = useState<string | null>(null);
  // P5.2 Phase A temporary testing affordance — see inviteVendor prop doc.
  const [inviteAccessLink, setInviteAccessLink] = useState<string | null>(null);
  // P5.2 Phase D — the honest EmailService outcome of the invitation
  // send, alongside the resolved recipient. Only when emailStatus is
  // anything other than 'sent' does the UI fall back to showing
  // inviteAccessLink at all.
  const [inviteRecipientEmail, setInviteRecipientEmail] = useState<string | null>(null);
  const [inviteEmailStatus, setInviteEmailStatus] = useState<EmailSendStatus | null>(null);

  // --- Correspondence (P5.2 Phase D) ---
  const [threadVendorId, setThreadVendorId] = useState("");
  const [messages, setMessages] = useState<EntityMessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSubmitting, setComposeSubmitting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeResult, setComposeResult] = useState<{ recipientEmail: string; emailStatus?: EmailSendStatus; emailError?: string } | null>(null);
  const [composeFile, setComposeFile] = useState<File | null>(null);
  const [composeAttachError, setComposeAttachError] = useState<string | null>(null);
  const [quarantined, setQuarantined] = useState<QuarantinedInboundMessageRow[]>([]);
  const [quarantinedError, setQuarantinedError] = useState<string | null>(null);
  const [quarantineActionSubmitting, setQuarantineActionSubmitting] = useState<Record<string, boolean>>({});
  const [quarantineActionErrors, setQuarantineActionErrors] = useState<Record<string, string | null>>({});

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

  // --- Issue subcontract (Task 10 — closes Task 6's own forward-
  // referenced "ships with Task 8's document issuance service" gap now
  // that Task 10's PDF route exists). issuedSubcontract is refreshed by
  // every loadDetail() call (not only right after a successful issue),
  // so reopening an already-issued package shows its real version state
  // immediately, matching this task's own correction text.
  const [issuedSubcontract, setIssuedSubcontract] = useState<IssuedDocumentRow | null>(null);
  const [issuedSubcontractError, setIssuedSubcontractError] = useState<string | null>(null);
  const [issueSubcontractSubmitting, setIssueSubcontractSubmitting] = useState(false);
  const [issueSubcontractError, setIssueSubcontractError] = useState<string | null>(null);

  // --- Package Details (P5.2 Phase B, Part B) ---
  const [detailsDraft, setDetailsDraft] = useState({
    inclusions: "",
    exclusions: "",
    alternates: "",
    allowances: "",
    pricingBreakdownInstructions: "",
    scheduleExpectations: "",
    bidInstructions: "",
    stoneColumnContactId: "",
  });
  const [detailsSubmitting, setDetailsSubmitting] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);

  // --- Documents (P5.2 Phase B, Part C) ---
  const [documents, setDocuments] = useState<BidPackageDocumentRow[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<BidPackageDocumentCategory>("reference");
  const [uploadInternalOnly, setUploadInternalOnly] = useState(false);
  const [uploadReplaces, setUploadReplaces] = useState("");
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const costCodesById = new Map(costCodes.map((cc) => [cc.id, cc]));

  // The single re-fetch every mutation below calls on success. Never
  // patches state in place — always replaces detail/questions/addenda
  // wholesale from a fresh read, and (when the affected package is
  // already in the list) refreshes that one list row from the same
  // fresh detail response so status-badge changes (publish/award) show
  // up in the list without a separate listBidPackages round trip.
  async function loadDetail(id: string) {
    const [detailResult, questionsResult, addendaResult, issuedSubcontractResult, documentsResult, acknowledgmentsResult, quarantinedResult] =
      await Promise.all([
        getBidPackageDetail(id),
        listBidQuestions(id),
        listBidAddenda(id),
        getLatestIssuedSubcontract(id),
        listBidPackageDocuments(id),
        listBidAddendumAcknowledgments(id),
        listQuarantinedMessages(id),
      ]);

    if (quarantinedResult.error) {
      setQuarantinedError(quarantinedResult.error);
      setQuarantined([]);
    } else {
      setQuarantinedError(null);
      setQuarantined(quarantinedResult.messages ?? []);
    }

    if (detailResult.error || !detailResult.detail) {
      setDetail(null);
      setDetailError(detailResult.error ?? "Bid package not found.");
      setQuestions([]);
      setQuestionsError(null);
      setAddenda([]);
      setAddendaError(null);
      setIssuedSubcontract(null);
      setIssuedSubcontractError(null);
      setDocuments([]);
      setDocumentsError(null);
      setAcknowledgments([]);
      setAcknowledgmentsError(null);
      setQuarantined([]);
      setQuarantinedError(null);
      return;
    }

    setDetailError(null);
    setDetail(detailResult.detail);
    setDetailsDraft({
      inclusions: detailResult.detail.inclusions ?? "",
      exclusions: detailResult.detail.exclusions ?? "",
      alternates: detailResult.detail.alternates ?? "",
      allowances: detailResult.detail.allowances ?? "",
      pricingBreakdownInstructions: detailResult.detail.pricingBreakdownInstructions ?? "",
      scheduleExpectations: detailResult.detail.scheduleExpectations ?? "",
      bidInstructions: detailResult.detail.bidInstructions ?? "",
      stoneColumnContactId: detailResult.detail.stoneColumnContactId ?? "",
    });
    setPackages((prev) => {
      const row = toBidPackageRow(detailResult.detail!);
      const exists = prev.some((p) => p.id === id);
      return exists ? prev.map((p) => (p.id === id ? row : p)) : [row, ...prev];
    });

    if (documentsResult.error) {
      setDocumentsError(documentsResult.error);
      setDocuments([]);
    } else {
      setDocumentsError(null);
      setDocuments(documentsResult.documents ?? []);
    }

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

    // Absent (`document: undefined`) is the normal pre-issuance state,
    // not an error — only a real fetch failure sets issuedSubcontractError.
    if (issuedSubcontractResult.error) {
      setIssuedSubcontractError(issuedSubcontractResult.error);
      setIssuedSubcontract(null);
    } else {
      setIssuedSubcontractError(null);
      setIssuedSubcontract(issuedSubcontractResult.document ?? null);
    }

    if (acknowledgmentsResult.error) {
      setAcknowledgmentsError(acknowledgmentsResult.error);
      setAcknowledgments([]);
    } else {
      setAcknowledgmentsError(null);
      setAcknowledgments(acknowledgmentsResult.acknowledgments ?? []);
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
    setIssuedSubcontract(null);
    setIssuedSubcontractError(null);
    setIssueSubcontractError(null);
    setDocuments([]);
    setDocumentsError(null);
    setUploadError(null);
    setAcknowledgments([]);
    setAcknowledgmentsError(null);
    setHistoryOpenId(null);
    setDetailsError(null);
    setDetailsSaved(false);
    setThreadVendorId("");
    setMessages([]);
    setMessagesError(null);
    setComposeError(null);
    setComposeResult(null);
    setQuarantined([]);
    setQuarantinedError(null);
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
    setInviteWarning(null);
    setInviteAccessLink(null);
    setInviteRecipientEmail(null);
    setInviteEmailStatus(null);
    setInviteSubmitting(true);
    try {
      const result = await inviteVendor(detail.id, inviteVendorId);
      if (result && "error" in result && result.error) {
        setInviteError(result.error);
        return;
      }
      if (result && "warning" in result && result.warning) {
        setInviteWarning(result.warning);
      }
      if (result && "recipientEmail" in result && result.recipientEmail) {
        setInviteRecipientEmail(result.recipientEmail);
      }
      if (result && "emailStatus" in result && result.emailStatus) {
        setInviteEmailStatus(result.emailStatus);
      }
      // The magic-link token is ALWAYS captured (bidService.ts's own
      // inviteVendor doc comment: it never goes away) — the JSX below,
      // not this handler, decides whether it is ever actually shown.
      if (result && "accessToken" in result && result.accessToken) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        setInviteAccessLink(`${origin}/vendor/invite/${result.accessToken}`);
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

  // --- Vendor access (revoke/reactivate) — final-review addition ---
  async function handleToggleAccess(vendorId: string) {
    if (accessOpenVendorId === vendorId) {
      setAccessOpenVendorId(null);
      return;
    }
    setAccessOpenVendorId(vendorId);
    setAccessError(null);
    setAccessLoading(true);
    try {
      const result = await listVendorMembers(vendorId);
      if (result.error) {
        setAccessError(result.error);
        return;
      }
      setVendorMembersByVendor((prev) => ({ ...prev, [vendorId]: result.members ?? [] }));
    } finally {
      setAccessLoading(false);
    }
  }

  async function handleRevokeMember(vendorId: string, member: VendorMemberRow) {
    setMemberActionErrors((prev) => ({ ...prev, [member.id]: null }));
    setMemberActionSubmitting((prev) => ({ ...prev, [member.id]: true }));
    try {
      const result = await revokeVendorMember(vendorId, member.profileId);
      if (result.error) {
        setMemberActionErrors((prev) => ({ ...prev, [member.id]: result.error! }));
        return;
      }
      const refreshed = await listVendorMembers(vendorId);
      if (!refreshed.error) {
        setVendorMembersByVendor((prev) => ({ ...prev, [vendorId]: refreshed.members ?? [] }));
      }
    } finally {
      setMemberActionSubmitting((prev) => ({ ...prev, [member.id]: false }));
    }
  }

  async function handleReactivateMember(vendorId: string, member: VendorMemberRow) {
    setMemberActionErrors((prev) => ({ ...prev, [member.id]: null }));
    setMemberActionSubmitting((prev) => ({ ...prev, [member.id]: true }));
    try {
      const result = await reactivateVendorMember(vendorId, member.profileId);
      if (result.error) {
        setMemberActionErrors((prev) => ({ ...prev, [member.id]: result.error! }));
        return;
      }
      const refreshed = await listVendorMembers(vendorId);
      if (!refreshed.error) {
        setVendorMembersByVendor((prev) => ({ ...prev, [vendorId]: refreshed.members ?? [] }));
      }
    } finally {
      setMemberActionSubmitting((prev) => ({ ...prev, [member.id]: false }));
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

  // Reissue is allowed even once a subcontract already exists (Task 6's
  // own described behavior: "a second click after any underlying change
  // creates a new version") — issueSubcontract() itself (Task 8,
  // unmodified) is what actually increments the version; this handler
  // never guesses a version number, it always re-fetches it fresh via
  // loadDetail() -> getLatestIssuedSubcontract().
  async function handleIssueSubcontract() {
    if (!detail) return;
    setIssueSubcontractError(null);
    setIssueSubcontractSubmitting(true);
    try {
      const result = await issueSubcontract(detail.id);
      if (result.error) {
        setIssueSubcontractError(result.error);
        return;
      }
      await loadDetail(detail.id);
    } finally {
      setIssueSubcontractSubmitting(false);
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

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setDetailsError(null);
    setDetailsSaved(false);
    setDetailsSubmitting(true);
    try {
      const result = await updateBidPackageAssemblyDetails(detail.id, { ...detailsDraft });
      if (result && "error" in result && result.error) {
        setDetailsError(result.error);
        return;
      }
      setDetailsSaved(true);
      await loadDetail(detail.id);
    } finally {
      setDetailsSubmitting(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!uploadFile) {
      setUploadError("Choose a file to upload.");
      return;
    }
    setUploadError(null);
    setUploadSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("category", uploadCategory);
      formData.append("internalOnly", uploadInternalOnly ? "true" : "false");
      if (uploadReplaces) formData.append("replaces", uploadReplaces);
      const response = await fetch(`/api/bid-packages/${detail.id}/documents`, { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) {
        setUploadError(body.error ?? "Upload failed.");
        return;
      }
      setUploadFile(null);
      setUploadReplaces("");
      setUploadInternalOnly(false);
      await loadDetail(detail.id);
    } finally {
      setUploadSubmitting(false);
    }
  }

  // --- Correspondence (P5.2 Phase D) ---
  async function loadThread(bidPackageId: string, vendorId: string) {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const result = await listEntityMessages(bidPackageId, vendorId);
      if (result.error) {
        setMessagesError(result.error);
        setMessages([]);
        return;
      }
      setMessages(result.messages ?? []);
    } finally {
      setMessagesLoading(false);
    }
  }

  async function handleSelectThreadVendor(vendorId: string) {
    setThreadVendorId(vendorId);
    setComposeError(null);
    setComposeResult(null);
    if (!detail || !vendorId) {
      setMessages([]);
      return;
    }
    await loadThread(detail.id, vendorId);
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !threadVendorId) return;
    if (!composeBody.trim()) {
      setComposeError("Message text is required.");
      return;
    }
    setComposeError(null);
    setComposeAttachError(null);
    setComposeResult(null);
    setComposeSubmitting(true);
    try {
      const result = await sendStaffMessage(detail.id, threadVendorId, composeSubject.trim() || undefined, composeBody);
      if (result.error) {
        setComposeError(result.error);
        return;
      }
      setComposeResult({ recipientEmail: result.recipientEmail ?? "", emailStatus: result.emailStatus, emailError: result.emailError });
      setComposeSubject("");
      setComposeBody("");

      if (composeFile && result.messageId) {
        const formData = new FormData();
        formData.append("file", composeFile);
        const response = await fetch(`/api/bid-packages/${detail.id}/messages/${result.messageId}/attachments`, { method: "POST", body: formData });
        if (!response.ok) {
          const attachBody = await response.json().catch(() => ({}));
          setComposeAttachError(attachBody.error ?? "Message sent, but the attachment failed to upload.");
        }
        setComposeFile(null);
      }

      await loadThread(detail.id, threadVendorId);
    } finally {
      setComposeSubmitting(false);
    }
  }

  async function handleDiscardQuarantined(id: string) {
    setQuarantineActionErrors((prev) => ({ ...prev, [id]: null }));
    setQuarantineActionSubmitting((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await discardQuarantinedMessage(id);
      if (result.error) {
        setQuarantineActionErrors((prev) => ({ ...prev, [id]: result.error! }));
        return;
      }
      if (detail) await loadDetail(detail.id);
    } finally {
      setQuarantineActionSubmitting((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handlePromoteQuarantined(id: string) {
    setQuarantineActionErrors((prev) => ({ ...prev, [id]: null }));
    setQuarantineActionSubmitting((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await promoteQuarantinedMessage(id);
      if (result.error) {
        setQuarantineActionErrors((prev) => ({ ...prev, [id]: result.error! }));
        return;
      }
      if (detail) {
        await loadDetail(detail.id);
        if (threadVendorId) await loadThread(detail.id, threadVendorId);
      }
    } finally {
      setQuarantineActionSubmitting((prev) => ({ ...prev, [id]: false }));
    }
  }

  const availableVendors = detail ? vendors.filter((v) => !detail.submissions.some((s) => s.vendorId === v.id)) : vendors;
  const selectedInviteVendorEmail = vendors.find((v) => v.id === inviteVendorId)?.email ?? null;

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
                Create Package for {projectName}
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
                <h4>Package details</h4>
                <p className="sc-bids-muted">
                  Shown to every invited vendor on their bid package view — leave a field blank to omit that section
                  entirely rather than showing it empty.
                </p>
                <form onSubmit={handleSaveDetails} className="sc-bids-form">
                  <FormField label="Inclusions" htmlFor="sc-bids-details-inclusions">
                    <Textarea
                      id="sc-bids-details-inclusions"
                      rows={2}
                      value={detailsDraft.inclusions}
                      onChange={(e) => setDetailsDraft((prev) => ({ ...prev, inclusions: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Exclusions" htmlFor="sc-bids-details-exclusions">
                    <Textarea
                      id="sc-bids-details-exclusions"
                      rows={2}
                      value={detailsDraft.exclusions}
                      onChange={(e) => setDetailsDraft((prev) => ({ ...prev, exclusions: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Alternates" htmlFor="sc-bids-details-alternates">
                    <Textarea
                      id="sc-bids-details-alternates"
                      rows={2}
                      value={detailsDraft.alternates}
                      onChange={(e) => setDetailsDraft((prev) => ({ ...prev, alternates: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Allowances" htmlFor="sc-bids-details-allowances">
                    <Textarea
                      id="sc-bids-details-allowances"
                      rows={2}
                      value={detailsDraft.allowances}
                      onChange={(e) => setDetailsDraft((prev) => ({ ...prev, allowances: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Pricing breakdown instructions" htmlFor="sc-bids-details-pricing">
                    <Textarea
                      id="sc-bids-details-pricing"
                      rows={2}
                      value={detailsDraft.pricingBreakdownInstructions}
                      onChange={(e) => setDetailsDraft((prev) => ({ ...prev, pricingBreakdownInstructions: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Schedule expectations" htmlFor="sc-bids-details-schedule">
                    <Textarea
                      id="sc-bids-details-schedule"
                      rows={2}
                      value={detailsDraft.scheduleExpectations}
                      onChange={(e) => setDetailsDraft((prev) => ({ ...prev, scheduleExpectations: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Bid instructions" htmlFor="sc-bids-details-instructions">
                    <Textarea
                      id="sc-bids-details-instructions"
                      rows={2}
                      value={detailsDraft.bidInstructions}
                      onChange={(e) => setDetailsDraft((prev) => ({ ...prev, bidInstructions: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Stone Column contact" htmlFor="sc-bids-details-contact">
                    <Select
                      id="sc-bids-details-contact"
                      value={detailsDraft.stoneColumnContactId}
                      onChange={(e) => setDetailsDraft((prev) => ({ ...prev, stoneColumnContactId: e.target.value }))}
                    >
                      <option value="">— none designated —</option>
                      {staffProfiles.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.fullName}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <Button type="submit" variant="secondary" disabled={detailsSubmitting} loading={detailsSubmitting} loadingText="Saving…">
                    Save Package Details
                  </Button>
                  {detailsSaved && !detailsError && <Alert tone="success">Saved.</Alert>}
                  {detailsError && <Alert tone="error">{detailsError}</Alert>}
                </form>
              </section>

              <section className="sc-bids-section">
                <h4>Documents</h4>
                {documentsError && <Alert tone="error">{documentsError}</Alert>}
                {documents.length === 0 ? (
                  <EmptyState title="No documents uploaded yet." />
                ) : (
                  <div className="sc-bids-table-scroll">
                    <table className="sc-bids-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>File</th>
                          <th style={{ textAlign: "left" }}>Category</th>
                          <th style={{ textAlign: "left" }}>Version</th>
                          <th style={{ textAlign: "left" }}>Visibility</th>
                          <th style={{ textAlign: "left" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map((doc) => (
                          <tr key={doc.id}>
                            <td>
                              {doc.fileName} <span className="sc-bids-muted">({formatBytes(doc.sizeBytes)})</span>
                            </td>
                            <td>{DOCUMENT_CATEGORY_LABELS[doc.category] ?? doc.category}</td>
                            <td>v{doc.version}</td>
                            <td>
                              <StatusBadge label={doc.internalOnly ? "Internal only" : "Vendor-visible"} tone={doc.internalOnly ? "neutral" : "sage"} />
                            </td>
                            <td>
                              <a
                                href={`/api/bid-packages/${doc.bidPackageId}/documents/${doc.id}/download`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="sc-ui-btn sc-ui-btn-secondary sc-ui-btn-sm"
                              >
                                Download
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <form onSubmit={handleUpload} className="sc-bids-form">
                  <h5>Upload a document</h5>
                  <FormField label="File" htmlFor="sc-bids-doc-file">
                    <input
                      id="sc-bids-doc-file"
                      type="file"
                      onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    />
                  </FormField>
                  <FormField label="Category" htmlFor="sc-bids-doc-category">
                    <Select
                      id="sc-bids-doc-category"
                      value={uploadCategory}
                      onChange={(e) => setUploadCategory(e.target.value as BidPackageDocumentCategory)}
                    >
                      {DOCUMENT_CATEGORY_OPTIONS.map((cat) => (
                        <option key={cat} value={cat}>
                          {DOCUMENT_CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Replaces (optional — links a new version)" htmlFor="sc-bids-doc-replaces">
                    <Select
                      id="sc-bids-doc-replaces"
                      value={uploadReplaces}
                      onChange={(e) => setUploadReplaces(e.target.value)}
                    >
                      <option value="">— new document —</option>
                      {documents.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.fileName} (v{doc.version})
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <Checkbox
                    label="Internal only (never shown to vendors)"
                    checked={uploadInternalOnly}
                    onChange={(e) => setUploadInternalOnly(e.target.checked)}
                  />
                  <Button type="submit" variant="primary" disabled={uploadSubmitting} loading={uploadSubmitting} loadingText="Uploading…">
                    Upload
                  </Button>
                  {uploadError && <Alert tone="error">{uploadError}</Alert>}
                </form>
              </section>

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
                  {/* P5.1: navigation convenience only — creating/editing
                      a vendor happens on the org-level directory, not
                      inline here. Doesn't touch this file's own
                      invite/award/etc. logic at all. */}
                  <a href="/admin/vendors" target="_blank" rel="noopener noreferrer" className="sc-bids-muted">
                    Manage Vendors
                  </a>
                </div>
                {/* P5.2 Phase D — owner's explicit requirement: show
                    exactly who will receive the invitation BEFORE
                    sending, not only after. */}
                {inviteVendorId && (
                  <p className="sc-bids-muted">
                    {selectedInviteVendorEmail
                      ? `Will be sent to: ${selectedInviteVendorEmail}`
                      : "This vendor has no bidding email on file — add one from the vendor directory before inviting, or the invite will succeed with no notification sent."}
                  </p>
                )}
                {inviteError && <Alert tone="error">{inviteError}</Alert>}
                {inviteWarning && <Alert tone="warning">{inviteWarning}</Alert>}
                {inviteEmailStatus === "sent" && (
                  <Alert tone="success">Invitation sent to {inviteRecipientEmail}.</Alert>
                )}
                {inviteEmailStatus && inviteEmailStatus !== "sent" && (
                  <Alert tone="warning">
                    {inviteEmailStatus === "pending_provider_configuration"
                      ? "Email delivery is not yet configured — no message was sent."
                      : `The invitation email could not be delivered${inviteEmailStatus === "failed" && inviteRecipientEmail ? ` to ${inviteRecipientEmail}` : ""}.`}
                    {" "}Use the link below to give the vendor access manually in the meantime.
                    {inviteAccessLink && (
                      <>
                        <br />
                        <code className="sc-bids-access-link">{inviteAccessLink}</code>
                      </>
                    )}
                  </Alert>
                )}

                {detail.submissions.length === 0 ? (
                  <EmptyState title="No vendors invited yet" />
                ) : (
                  <div className="sc-bids-table-scroll">
                  <table className="sc-bids-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Vendor</th>
                        <th style={{ textAlign: "left" }}>Status</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                        <th style={{ textAlign: "left" }}>History</th>
                        <th style={{ textAlign: "left" }}>Access</th>
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
                            {/* P5.2 Phase C: the full immutable revision
                                history for THIS vendor's submission —
                                every submit/revise, not just the latest
                                amount already shown above. Empty for a
                                staff-recorded submission (recordBidSubmission
                                never calls submit_bid_revision()), rendered
                                as an honest "no vendor-submitted revisions
                                yet" rather than a hidden control. */}
                            {sub.revisions.length === 0 ? (
                              <span className="sc-bids-muted">No revisions</span>
                            ) : (
                              <>
                                <Button variant="secondary" size="sm" onClick={() => setHistoryOpenId(historyOpenId === sub.id ? null : sub.id)}>
                                  {historyOpenId === sub.id ? "Hide" : `View (${sub.revisions.length})`}
                                </Button>
                                {historyOpenId === sub.id && (
                                  <ul className="sc-bids-revision-list">
                                    {[...sub.revisions]
                                      .sort((a, b) => b.revisionNumber - a.revisionNumber)
                                      .map((rev) => (
                                        <li key={rev.id}>
                                          <strong>v{rev.revisionNumber}</strong> {formatCents(rev.amountCents)} — {formatDateTime(rev.submittedAt)}
                                          {rev.notes && <div className="sc-bids-muted">{rev.notes}</div>}
                                        </li>
                                      ))}
                                  </ul>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            {/* Final-review addition (post-Phase-E): membership
                                is per-person-per-vendor-company
                                (vendor_members), not per-bid-package — so
                                revoking here ends that person's portal access
                                to EVERY bid package for this vendor, matching
                                is_vendor_member()'s own scope, not just this
                                one package's row. */}
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleToggleAccess(sub.vendorId)}
                            >
                              {accessOpenVendorId === sub.vendorId ? "Hide" : "Manage"}
                            </Button>
                            {accessOpenVendorId === sub.vendorId && (
                              <div className="sc-bids-access-panel">
                                {accessLoading ? (
                                  <span className="sc-bids-muted">Loading…</span>
                                ) : accessError ? (
                                  <Alert tone="error">{accessError}</Alert>
                                ) : (vendorMembersByVendor[sub.vendorId] ?? []).length === 0 ? (
                                  <span className="sc-bids-muted">No registered portal user for this vendor yet.</span>
                                ) : (
                                  <ul className="sc-bids-access-list">
                                    {(vendorMembersByVendor[sub.vendorId] ?? []).map((member) => (
                                      <li key={member.id}>
                                        <div>
                                          {member.email ?? "(no email on file)"}
                                          {member.isPrimary && <span className="sc-bids-muted"> · Primary</span>}
                                        </div>
                                        <div className="sc-bids-inline-form">
                                          {member.revokedAt ? (
                                            <>
                                              <StatusBadge label="Revoked" tone="brick" />
                                              <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={!!memberActionSubmitting[member.id]}
                                                loading={!!memberActionSubmitting[member.id]}
                                                loadingText="Restoring…"
                                                onClick={() => handleReactivateMember(sub.vendorId, member)}
                                              >
                                                Reactivate
                                              </Button>
                                            </>
                                          ) : (
                                            <>
                                              <StatusBadge label="Active" tone="sage" />
                                              <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={!!memberActionSubmitting[member.id]}
                                                loading={!!memberActionSubmitting[member.id]}
                                                loadingText="Revoking…"
                                                onClick={() => handleRevokeMember(sub.vendorId, member)}
                                              >
                                                Revoke
                                              </Button>
                                            </>
                                          )}
                                        </div>
                                        <div className="sc-bids-muted">
                                          Ends/restores this person&rsquo;s portal access to every bid package for this vendor company &mdash; not just this one.
                                          {" "}It does not withdraw their company&rsquo;s submitted bid: that bid stays valid and can still be awarded.
                                        </div>
                                        {memberActionErrors[member.id] && <Alert tone="error">{memberActionErrors[member.id]}</Alert>}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </td>
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
                              <div className="sc-bids-confirm">
                                {issuedSubcontractError && <Alert tone="error">{issuedSubcontractError}</Alert>}
                                {issuedSubcontract && (
                                  <p className="sc-bids-muted">
                                    {issuedSubcontract.version > 1
                                      ? `Version ${issuedSubcontract.version} issued — `
                                      : `Subcontract issued — Version ${issuedSubcontract.version}. `}
                                    <a
                                      href={`/api/bids/${detail.id}/subcontract-pdf`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="sc-ui-btn sc-ui-btn-secondary sc-ui-btn-sm"
                                    >
                                      View PDF
                                    </a>
                                    {issuedSubcontract.version > 1 && (
                                      <>
                                        {" "}
                                        <a
                                          href={`/api/bids/${detail.id}/subcontract-pdf?version=${issuedSubcontract.version - 1}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          view previous version
                                        </a>
                                      </>
                                    )}
                                  </p>
                                )}
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={issueSubcontractSubmitting}
                                  loading={issueSubcontractSubmitting}
                                  loadingText="Issuing…"
                                  onClick={handleIssueSubcontract}
                                >
                                  {issuedSubcontract ? "Reissue Subcontract" : "Issue Subcontract"}
                                </Button>
                                {issueSubcontractError && <Alert tone="error">{issueSubcontractError}</Alert>}
                              </div>
                            )}

                            {(sub.status === "declined" || sub.status === "withdrawn") && (
                              <span className="sc-bids-muted">{SUBMISSION_STATUS_LABELS[sub.status]}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
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
                {acknowledgmentsError && <Alert tone="error">{acknowledgmentsError}</Alert>}
                {addenda.length === 0 ? (
                  <EmptyState title="No addenda issued yet." />
                ) : (
                  <ul className="sc-bids-addenda-list">
                    {addenda.map((a) => {
                      // P5.2 Phase C: a simple acknowledged/not-yet-
                      // acknowledged list per addendum, cross-referenced
                      // against every currently-invited vendor — no
                      // elaborate UI needed per this phase's own scope.
                      const ackedVendorIds = new Set(acknowledgments.filter((ack) => ack.bidAddendumId === a.id).map((ack) => ack.vendorId));
                      const ackedByAndWhen = acknowledgments.filter((ack) => ack.bidAddendumId === a.id);
                      const notYetAcked = detail.submissions.filter((sub) => !ackedVendorIds.has(sub.vendorId));
                      return (
                        <li key={a.id}>
                          <p className="sc-bids-addendum-title">
                            <strong>{a.title}</strong> — {formatDateTime(a.issuedAt)}
                          </p>
                          <p>{a.bodyText}</p>
                          {a.revisedDueAt && <p className="sc-bids-meta">Revised due date: {formatDate(a.revisedDueAt)}</p>}
                          {detail.submissions.length > 0 && (
                            <p className="sc-bids-meta">
                              Acknowledged:{" "}
                              {ackedByAndWhen.length === 0
                                ? "no one yet"
                                : ackedByAndWhen
                                    .map((ack) => {
                                      const vendorName = detail.submissions.find((sub) => sub.vendorId === ack.vendorId)?.vendorName ?? "Unknown vendor";
                                      return `${vendorName} (${formatDateTime(ack.acknowledgedAt)})`;
                                    })
                                    .join(", ")}
                              {notYetAcked.length > 0 && <> — not yet: {notYetAcked.map((sub) => sub.vendorName).join(", ")}</>}
                            </p>
                          )}
                        </li>
                      );
                    })}
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

              <section className="sc-bids-section">
                <h4>Correspondence</h4>
                <p className="sc-bids-muted">
                  A private thread with one invited vendor at a time — other invited vendors on this package never see
                  it. Sent via email when delivery is configured (with an in-app fallback while it isn&rsquo;t); a
                  vendor&rsquo;s reply, in-app or by email, appears here.
                </p>

                {detail.submissions.length === 0 ? (
                  <EmptyState title="Invite a vendor above to start a correspondence thread." />
                ) : (
                  <>
                    <FormField label="Thread with" htmlFor="sc-bids-thread-vendor">
                      <Select
                        id="sc-bids-thread-vendor"
                        value={threadVendorId}
                        onChange={(e) => handleSelectThreadVendor(e.target.value)}
                      >
                        <option value="">— select an invited vendor —</option>
                        {detail.submissions.map((sub) => (
                          <option key={sub.vendorId} value={sub.vendorId}>
                            {sub.vendorName}
                          </option>
                        ))}
                      </Select>
                    </FormField>

                    {threadVendorId && (
                      <>
                        {messagesLoading && <p className="sc-bids-muted">Loading…</p>}
                        {messagesError && <Alert tone="error">{messagesError}</Alert>}
                        {!messagesLoading && !messagesError && messages.length === 0 && (
                          <EmptyState title="No messages yet on this thread." />
                        )}
                        {!messagesLoading && messages.length > 0 && (
                          <ul className="sc-bids-message-list">
                            {messages.map((m) => (
                              <li key={m.id} className={`sc-bids-message sc-bids-message-${m.direction}`}>
                                <p className="sc-bids-qa-meta">
                                  {m.direction === "outbound" ? `To ${m.recipient}` : `From ${m.sender}`} ·{" "}
                                  {formatDateTime(m.direction === "outbound" ? m.sentAt : m.receivedAt ?? m.createdAt)}
                                  {m.deliveryStatus && m.direction === "outbound" && (
                                    <>
                                      {" "}
                                      · <StatusBadge label={m.deliveryStatus} tone={m.deliveryStatus === "sent" ? "sage" : "gold"} />
                                    </>
                                  )}
                                </p>
                                {m.subject && <p className="sc-bids-qa-question">{m.subject}</p>}
                                <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{m.body}</p>
                                {m.attachments.length > 0 && (
                                  <ul className="sc-bids-attachment-list">
                                    {m.attachments.map((a) => (
                                      <li key={a.id}>
                                        <a
                                          href={`/api/bid-packages/${detail.id}/messages/attachments/${a.id}/download`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          {a.fileName}
                                        </a>{" "}
                                        <span className="sc-bids-muted">({formatBytes(a.sizeBytes)})</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        <form onSubmit={handleSendMessage} className="sc-bids-form">
                          <h5>Send a message</h5>
                          <FormField label="Subject (optional)" htmlFor="sc-bids-message-subject">
                            <TextInput
                              id="sc-bids-message-subject"
                              value={composeSubject}
                              onChange={(e) => setComposeSubject(e.target.value)}
                            />
                          </FormField>
                          <FormField label="Message" htmlFor="sc-bids-message-body">
                            <Textarea
                              id="sc-bids-message-body"
                              rows={3}
                              value={composeBody}
                              onChange={(e) => setComposeBody(e.target.value)}
                            />
                          </FormField>
                          <FormField label="Attachment (optional)" htmlFor="sc-bids-message-file">
                            <input id="sc-bids-message-file" type="file" onChange={(e) => setComposeFile(e.target.files?.[0] ?? null)} />
                          </FormField>
                          <Button type="submit" variant="primary" disabled={composeSubmitting} loading={composeSubmitting} loadingText="Sending…">
                            Send
                          </Button>
                          {composeError && <Alert tone="error">{composeError}</Alert>}
                          {composeAttachError && <Alert tone="error">{composeAttachError}</Alert>}
                          {composeResult && composeResult.emailStatus === "sent" && (
                            <Alert tone="success">Sent to {composeResult.recipientEmail}.</Alert>
                          )}
                          {composeResult && composeResult.emailStatus === "pending_provider_configuration" && (
                            <Alert tone="warning">
                              Saved to this thread, but email delivery is not yet configured — {composeResult.recipientEmail} was not
                              actually notified. They will see this message the next time they sign into the vendor portal.
                            </Alert>
                          )}
                          {composeResult && composeResult.emailStatus === "failed" && (
                            <Alert tone="error">
                              Saved to this thread, but delivery to {composeResult.recipientEmail} failed
                              {composeResult.emailError ? `: ${composeResult.emailError}` : "."}
                            </Alert>
                          )}
                        </form>
                      </>
                    )}
                  </>
                )}

                {(quarantined.length > 0 || quarantinedError) && (
                  <div className="sc-bids-quarantine">
                    <h5>Needs review ({quarantined.length})</h5>
                    <p className="sc-bids-muted">
                      Inbound email replies that couldn&rsquo;t be safely routed into a thread automatically — never
                      shown to any vendor.
                    </p>
                    {quarantinedError && <Alert tone="error">{quarantinedError}</Alert>}
                    <ul className="sc-bids-qa-list">
                      {quarantined.map((q) => (
                        <li key={q.id} className="sc-bids-qa-item">
                          <p className="sc-bids-qa-meta">
                            {formatDateTime(q.receivedAt)} · reason: {q.reason}
                          </p>
                          <p style={{ margin: "0 0 8px 0", fontSize: 12, wordBreak: "break-word" }}>
                            {JSON.stringify(q.rawPayload)}
                          </p>
                          <div className="sc-bids-confirm-actions">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!!quarantineActionSubmitting[q.id] || !q.vendorId}
                              onClick={() => handlePromoteQuarantined(q.id)}
                            >
                              Promote to thread
                            </Button>
                            <Button variant="secondary" size="sm" disabled={!!quarantineActionSubmitting[q.id]} onClick={() => handleDiscardQuarantined(q.id)}>
                              Discard
                            </Button>
                          </div>
                          {quarantineActionErrors[q.id] && <Alert tone="error">{quarantineActionErrors[q.id]}</Alert>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
.sc-bids-access-link { word-break: break-all; font-size: ${typography.sizeSm}; }
.sc-bids-detail-error { display: flex; align-items: center; gap: ${spacing.sm}; }
.sc-bids-detail-header { display: flex; align-items: center; gap: ${spacing.sm}; }
.sc-bids-detail-header h3 { margin: 0; min-width: 0; overflow-wrap: break-word; }
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
.sc-bids-revision-list { list-style: none; padding: 0; margin: ${spacing.xs} 0 0 0; display: flex; flex-direction: column; gap: 4px; font-size: ${typography.sizeXs}; }
.sc-bids-revision-list li { border: 1px solid ${colors.line}; border-radius: ${radius.sm}; padding: 4px 6px; }

.sc-bids-table-scroll { overflow-x: auto; }

.sc-bids-message-list { list-style: none; padding: 0; margin: 0 0 ${spacing.md} 0; display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-bids-message { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm}; font-size: ${typography.sizeSm}; }
.sc-bids-message-outbound { background: ${colors.white}; }
.sc-bids-message-inbound { background: ${colors.sageTint}; }
.sc-bids-attachment-list { list-style: none; padding: 0; margin: ${spacing.xs} 0 0 0; font-size: ${typography.sizeXs}; }
.sc-bids-quarantine { margin-top: ${spacing.lg}; padding-top: ${spacing.md}; border-top: 1px dashed ${colors.line}; }
.sc-bids-quarantine h5 { margin: 0 0 4px 0; }

/* Pre-Task-10-owner-preview mobile fix: below the 768px breakpoint
   AppShell.tsx itself already uses for sidebar-vs-drawer, the list and
   detail columns were sitting side by side (a fixed 320px list column
   plus a flex:1 detail column) with no room for both on a 390px phone
   -- the detail panel was pushed off-screen, forcing horizontal page
   scroll to reach it at all. Stacking them (list column first, full
   width) is the only change here; every rule above is unmodified, so
   desktop/tablet (>=768px) render byte-for-byte as before. */
@media (max-width: 767px) {
  /* align-items: flex-start (base rule above) governs the CROSS axis --
     vertical in row mode (harmless: cards just don't stretch to equal
     height), but horizontal once flex-direction flips to column here.
     Left at flex-start, the detail column sized itself to its widest
     child's content (the submissions table) instead of the viewport,
     which is what was actually escaping past 390px -- the table's own
     overflow-x:auto wrapper only contains overflow within a box that's
     already width-constrained; it can't shrink a box that isn't being
     stretched in the first place. Overriding to stretch here is the
     fix; nothing above this block changes. */
  .sc-bids-layout { flex-direction: column; align-items: stretch; }
  .sc-bids-list-col { width: 100%; }
}
`;
