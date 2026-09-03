/**
 * P5 Task 10 regression coverage for BidPackageWorkspace.tsx's "Issue
 * Subcontract" wiring. No render-smoke/component test existed for this
 * component before this task (confirmed by searching packages/02-app-shell/test/
 * and render_smoke.tsx) — this is the first one, following
 * materialOrderWorkspace.tsx's exact pattern (react-test-renderer,
 * hand-rolled `check()` assertions, no jsdom).
 *
 * Exercises, at minimum (per this task's own required coverage):
 *   - Awarded-but-not-yet-issued state: the submissions table shows an
 *     "Issue Subcontract" button (not the old permanently-disabled
 *     "Issue Subcontract (coming soon)"), and no "View PDF" link yet.
 *   - On-load version state (this task's own correction — Task 6's gap
 *     was that nothing showed current version state without a fresh
 *     click): loadDetail() itself fetches getLatestIssuedSubcontract, so
 *     an already-issued package shows its version immediately on
 *     selection, not only right after a click in the same session.
 *   - After issuing: "Subcontract issued — Version 1." renders, a real
 *     "View PDF" link appears with the correct
 *     /api/bids/{bidPackageId}/subcontract-pdf href, and the button
 *     relabels to "Reissue Subcontract".
 *   - Reissuing: a second click creates version 2, updates the label to
 *     "Version 2 issued —", and a "view previous version" link appears
 *     pointing at ?version=1.
 *
 * Run with `npx tsx test/bidPackageWorkspace.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { BidPackageWorkspace } from "../src/components/BidPackageWorkspace";
import type { BidPackageRow, BidPackageDetail, BidQuestionRow, BidAddendumRow } from "../src/services/bidService";
import type { IssuedDocumentRow } from "../src/services/documentIssuanceService";
import type { CostCode } from "../../01-financial-engine/src/types";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function textOf(instance: ReactTestInstance): string {
  return instance.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

function findButtonByText(root: ReactTestInstance, text: string): ReactTestInstance {
  const buttons = root.findAllByType("button");
  const match = buttons.find((b) => textOf(b).includes(text));
  if (!match) throw new Error(`No <button> found containing text "${text}"`);
  return match;
}

function tryFindButtonByText(root: ReactTestInstance, text: string): ReactTestInstance | null {
  const buttons = root.findAllByType("button");
  return buttons.find((b) => textOf(b).includes(text)) ?? null;
}

function findLinksByText(root: ReactTestInstance, text: string): ReactTestInstance[] {
  return root.findAllByType("a").filter((a) => textOf(a).includes(text));
}

const COST_CODES: CostCode[] = [
  {
    id: "cc_framing",
    projectId: "proj_1",
    code: "06-100 Framing",
    feeEligible: true,
    status: "active",
    isArchived: false,
    divisionId: null,
    activityName: null,
    scopeDescription: null,
    includeInEstimate: true,
    billable: true,
  },
];

const BASE_PACKAGE: BidPackageRow = {
  id: "bp_1",
  projectId: "proj_1",
  costCodeId: "cc_framing",
  title: "Framing Package",
  scopeDescription: "Frame the main structure.",
  dueAt: null,
  status: "awarded",
  createdAt: "2026-01-01T00:00:00Z",
};

/**
 * In-memory fake standing in for the real Server Actions
 * (bidService.ts + documentIssuanceService.ts). issueSubcontract
 * increments a real version counter on each call — getLatestIssuedSubcontract
 * always reflects that same counter, exactly like the real
 * issue_document()/issued_documents pairing this stands in for.
 */
function makeFakeServer() {
  let issuedVersion = 0;
  let issueCallCount = 0;

  async function getBidPackageDetail(id: string): Promise<{ detail?: BidPackageDetail; error?: string }> {
    if (id !== BASE_PACKAGE.id) return { error: "not found" };
    return {
      detail: {
        ...BASE_PACKAGE,
        submissions: [
          {
            id: "sub_1",
            bidPackageId: BASE_PACKAGE.id,
            vendorId: "v_1",
            vendorName: "Acme Framing",
            status: "awarded",
            amountCents: 500000,
            notes: null,
            submittedAt: "2026-01-05T00:00:00Z",
          },
        ],
      },
    };
  }

  async function listBidQuestions(): Promise<{ questions?: BidQuestionRow[]; error?: string }> {
    return { questions: [] };
  }
  async function listBidAddenda(): Promise<{ addenda?: BidAddendumRow[]; error?: string }> {
    return { addenda: [] };
  }
  async function createBidPackage() {
    return { id: BASE_PACKAGE.id };
  }
  async function publishBidPackage() {
    return {};
  }
  async function inviteVendor() {
    return {};
  }
  async function recordBidSubmission() {
    return {};
  }
  async function awardBid() {
    return {};
  }
  async function askBidQuestion() {
    return {};
  }
  async function answerBidQuestion() {
    return {};
  }
  async function issueBidAddendum() {
    return {};
  }

  async function issueSubcontract(bidPackageId: string) {
    if (bidPackageId !== BASE_PACKAGE.id) return { error: "not found" };
    issueCallCount++;
    issuedVersion++;
    return { issuedDocumentId: `doc_${issuedVersion}` };
  }

  async function getLatestIssuedSubcontract(bidPackageId: string): Promise<{ document?: IssuedDocumentRow; error?: string }> {
    if (bidPackageId !== BASE_PACKAGE.id || issuedVersion === 0) return { document: undefined };
    return {
      document: {
        id: `doc_${issuedVersion}`,
        documentType: "subcontract",
        sourceId: BASE_PACKAGE.id,
        documentNumber: "SUB-1",
        version: issuedVersion,
        templateVersion: "1",
        issuedAt: new Date().toISOString(),
        issuedBy: null,
        canonicalData: {},
        supersededAt: null,
        supersededById: null,
      },
    };
  }

  return {
    getBidPackageDetail,
    listBidQuestions,
    listBidAddenda,
    createBidPackage,
    publishBidPackage,
    inviteVendor,
    recordBidSubmission,
    awardBid,
    askBidQuestion,
    answerBidQuestion,
    issueBidAddendum,
    issueSubcontract,
    getLatestIssuedSubcontract,
    getIssueCallCount: () => issueCallCount,
  };
}

async function main() {
  console.log("--- Task 10: Issue Subcontract state transitions ---");
  const server = makeFakeServer();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <BidPackageWorkspace
        projectId="proj_1"
        projectName="Test Project"
        bidPackages={[BASE_PACKAGE]}
        costCodes={COST_CODES}
        vendors={[]}
        createBidPackage={server.createBidPackage}
        publishBidPackage={server.publishBidPackage}
        inviteVendor={server.inviteVendor}
        getBidPackageDetail={server.getBidPackageDetail}
        listBidQuestions={server.listBidQuestions}
        listBidAddenda={server.listBidAddenda}
        recordBidSubmission={server.recordBidSubmission}
        awardBid={server.awardBid}
        askBidQuestion={server.askBidQuestion}
        answerBidQuestion={server.answerBidQuestion}
        issueBidAddendum={server.issueBidAddendum}
        issueSubcontract={server.issueSubcontract}
        getLatestIssuedSubcontract={server.getLatestIssuedSubcontract}
      />
    );
  });

  // Select the package — loadDetail() fires, including the on-load
  // getLatestIssuedSubcontract fetch this task added.
  const packageButton = findButtonByText(renderer.root, "Framing Package");
  await act(async () => {
    await packageButton.props.onClick();
  });

  check(
    "awarded-but-not-yet-issued: an 'Issue Subcontract' button renders (not the old permanently-disabled 'coming soon' button)",
    tryFindButtonByText(renderer.root, "Issue Subcontract") !== null
  );
  check("no leftover 'coming soon' text remains", !textOf(renderer.root).includes("coming soon"));
  check("no 'View PDF' link renders before a subcontract has been issued", findLinksByText(renderer.root, "View PDF").length === 0);
  check("no 'Reissue Subcontract' label appears before anything has been issued", tryFindButtonByText(renderer.root, "Reissue Subcontract") === null);

  // Issue it.
  const issueButton = findButtonByText(renderer.root, "Issue Subcontract");
  await act(async () => {
    await issueButton.props.onClick();
  });

  check("calling Issue Subcontract invokes the real issueSubcontract action exactly once", server.getIssueCallCount() === 1);
  const renderedAfterIssue = textOf(renderer.root);
  check("shows 'Subcontract issued — Version 1.' after issuing", renderedAfterIssue.includes("Subcontract issued — Version 1."));

  const pdfLinksV1 = findLinksByText(renderer.root, "View PDF");
  check("exactly one 'View PDF' link renders once issued", pdfLinksV1.length === 1);
  check("the 'View PDF' link points at this bid package's real subcontract PDF route", pdfLinksV1[0].props.href === "/api/bids/bp_1/subcontract-pdf");
  check("the 'View PDF' link opens in a new tab", pdfLinksV1[0].props.target === "_blank");
  check("the button relabels to 'Reissue Subcontract' once a version already exists", tryFindButtonByText(renderer.root, "Reissue Subcontract") !== null);
  check("no 'view previous version' link yet — there is no version 0", findLinksByText(renderer.root, "view previous version").length === 0);

  // Reissue — a second click creates version 2.
  const reissueButton = findButtonByText(renderer.root, "Reissue Subcontract");
  await act(async () => {
    await reissueButton.props.onClick();
  });

  check("reissuing invokes issueSubcontract a second time", server.getIssueCallCount() === 2);
  const renderedAfterReissue = textOf(renderer.root);
  check("shows 'Version 2 issued —' after reissuing", renderedAfterReissue.includes("Version 2 issued —"));

  const pdfLinksV2 = findLinksByText(renderer.root, "View PDF");
  check("still exactly one 'View PDF' link (pointing at the latest version) after reissuing", pdfLinksV2.length === 1 && pdfLinksV2[0].props.href === "/api/bids/bp_1/subcontract-pdf");

  const previousVersionLinks = findLinksByText(renderer.root, "view previous version");
  check("a 'view previous version' link appears once a reissue creates version 2", previousVersionLinks.length === 1);
  check("the 'view previous version' link points at version 1", previousVersionLinks[0].props.href === "/api/bids/bp_1/subcontract-pdf?version=1");

  console.log(`\nbidPackageWorkspace.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
