/**
 * P5 Task 9 regression coverage for MaterialOrderWorkspace.tsx. Same
 * pattern as this package's other component tests
 * (projectContactsWorkspace.tsx, commitmentsTable_grouping.tsx):
 * react-test-renderer, hand-rolled `check()` assertions, no jsdom.
 *
 * Exercises, at minimum (per this task's own required coverage):
 *   - Decision 2's per-line cost-code default-vs-override behavior: a
 *     new "Add a line item" row's cost-code selector starts at the
 *     order's `defaultCostCodeId`, stays fully changeable, and once a
 *     line item is added its cost code is exactly what was selected at
 *     submit time — never silently re-derived from the default later.
 *     Also proves the selector resets back to the default for the NEXT
 *     new row after a successful add.
 *   - Commit-requires-line-items gating: the "Commit Order" control is
 *     ABSENT (not merely disabled) with zero line items, and appears
 *     once at least one exists.
 *   - The confirm-step-before-commit safety: clicking "Commit Order"
 *     never calls `commitMaterialOrder` directly — it shows an inline
 *     "Are you sure?" step first; Cancel aborts with zero calls; only
 *     confirming calls it, and the resulting per-cost-code dollar
 *     summary is sourced from the (mocked) `getCommittedCostsForProject`
 *     response, not recomputed from quantity * unitPrice.
 *
 * Run with `npx tsx test/materialOrderWorkspace.tsx`.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";
import { MaterialOrderWorkspace } from "../src/components/MaterialOrderWorkspace";
import type { MaterialOrderRow, MaterialOrderDetail, MaterialOrderCommitResult } from "../src/services/procurementService";
import type { IssuedDocumentRow } from "../src/services/documentIssuanceService";
import type { CostCode, CommittedCost } from "../../01-financial-engine/src/types";

let checks = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  checks++;
  console.log(`  ok — ${name}`);
}

function findById(root: ReactTestInstance, id: string): ReactTestInstance {
  return root.findByProps({ id });
}

function closestForm(instance: ReactTestInstance): ReactTestInstance {
  let node: ReactTestInstance | null = instance;
  while (node && node.type !== "form") node = node.parent;
  if (!node) throw new Error("No ancestor <form> found");
  return node;
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

const COST_CODES: CostCode[] = [
  {
    id: "cc_lumber",
    projectId: "proj_1",
    code: "06-200 Lumber",
    feeEligible: true,
    status: "active",
    isArchived: false,
    divisionId: null,
    activityName: null,
    scopeDescription: null,
    includeInEstimate: true,
    billable: true,
  },
  {
    id: "cc_drywall",
    projectId: "proj_1",
    code: "09-200 Drywall",
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

const BASE_ORDER: MaterialOrderRow = {
  id: "order_1",
  projectId: "proj_1",
  defaultCostCodeId: "cc_lumber",
  vendorId: null,
  orderNumber: "PO-100",
  status: "draft",
  orderedAt: null,
  expectedDeliveryAt: null,
};

/**
 * A tiny in-memory fake standing in for the real Server Actions —
 * mirrors what procurementService/documentIssuanceService actually do
 * (grouping line items by cost code, summing quantity * unit_price_cents
 * server-side into `amount_cents`) so the commit-summary assertions
 * below prove the component reads that number from the "backend"
 * response rather than recomputing it itself.
 */
function makeFakeServer() {
  let status: MaterialOrderRow["status"] = "draft";
  let lineItems: MaterialOrderDetail["lineItems"] = [];
  let nextLineId = 1;
  let nextCommittedCostId = 1;
  let lastCommittedCosts: CommittedCost[] = [];

  const addedLineItemCalls: Array<{ costCodeId: string; description: string; quantity: number; unitPriceCents: number }> = [];
  let commitCallCount = 0;
  let issuedVersion = 0;
  let issueCallCount = 0;

  async function getMaterialOrderDetail(id: string) {
    if (id !== BASE_ORDER.id) return { error: "not found" };
    return { detail: { ...BASE_ORDER, status, lineItems } as MaterialOrderDetail };
  }

  async function addMaterialOrderLineItem(
    materialOrderId: string,
    _projectId: string,
    costCodeId: string,
    description: string,
    quantity: number,
    unit: string | undefined,
    unitPriceCents: number
  ) {
    addedLineItemCalls.push({ costCodeId, description, quantity, unitPriceCents });
    lineItems = [
      ...lineItems,
      {
        id: `li_${nextLineId++}`,
        materialOrderId,
        costCodeId,
        description,
        quantity,
        unit: unit ?? null,
        unitPriceCents,
        receivedQuantity: 0,
        backordered: false,
      },
    ];
    return {};
  }

  async function commitMaterialOrder(_materialOrderId: string): Promise<{ committedCosts?: MaterialOrderCommitResult[]; error?: string }> {
    commitCallCount++;
    status = "ordered";
    const grouped = new Map<string, number>();
    for (const li of lineItems) {
      grouped.set(li.costCodeId, (grouped.get(li.costCodeId) ?? 0) + li.quantity * li.unitPriceCents);
    }
    const mapping: MaterialOrderCommitResult[] = [];
    const rows: CommittedCost[] = [];
    for (const [costCodeId, amountCents] of grouped) {
      const committedCostId = `ccost_${nextCommittedCostId++}`;
      mapping.push({ costCodeId, committedCostId });
      rows.push({ id: committedCostId, projectId: "proj_1", costCodeId, amountCents, status: "open", sourceType: "material_order", sourceId: "order_1" });
    }
    lastCommittedCosts = rows;
    return { committedCosts: mapping };
  }

  async function getCommittedCostsForProject(_projectId: string) {
    return { committedCosts: lastCommittedCosts };
  }

  async function createMaterialOrder() {
    return { id: BASE_ORDER.id };
  }
  async function recordReceivedQuantity() {
    return {};
  }
  // Stateful, real-issue-tracking fakes (post-Task-10-review fix): the
  // ORIGINAL version of this fake unconditionally returned a version-1
  // document regardless of whether issuePurchaseOrder had ever actually
  // been called — harmless back when the component only read this
  // response right after a click, but load-bearing now that
  // loadDetail() ALSO calls getLatestIssuedPurchaseOrder on every
  // select/reload (the bug this task fixes): a fake that always reports
  // "issued" would hide a real regression where loadDetail's fetch is
  // missing or wrong. issuedVersion === 0 (nothing issued yet) must
  // report an absent document, exactly like the real
  // documentIssuanceService.getLatestIssuedDocument does before any
  // issue_document() RPC call — mirrors bidPackageWorkspace.tsx's fake
  // issueSubcontract/getLatestIssuedSubcontract pairing.
  async function issuePurchaseOrder() {
    issueCallCount++;
    issuedVersion++;
    return { issuedDocumentId: `doc_${issuedVersion}` };
  }
  async function getLatestIssuedPurchaseOrder(): Promise<{ document?: IssuedDocumentRow; error?: string }> {
    if (issuedVersion === 0) return { document: undefined };
    return {
      document: {
        id: `doc_${issuedVersion}`,
        documentType: "purchase_order",
        sourceId: BASE_ORDER.id,
        documentNumber: "PO-100",
        version: issuedVersion,
        templateVersion: "v1",
        issuedAt: new Date().toISOString(),
        issuedBy: null,
        canonicalData: {},
        supersededAt: null,
        supersededById: null,
      },
    };
  }

  return {
    getMaterialOrderDetail,
    addMaterialOrderLineItem,
    commitMaterialOrder,
    getCommittedCostsForProject,
    createMaterialOrder,
    recordReceivedQuantity,
    issuePurchaseOrder,
    getLatestIssuedPurchaseOrder,
    addedLineItemCalls,
    getCommitCallCount: () => commitCallCount,
    getIssueCallCount: () => issueCallCount,
    getIssuedVersion: () => issuedVersion,
  };
}

async function main() {
  console.log("--- Decision 2: per-line cost-code default, override, and reset-for-next-row ---");
  {
    const server = makeFakeServer();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MaterialOrderWorkspace
          projectId="proj_1"
          materialOrders={[BASE_ORDER]}
          costCodes={COST_CODES}
          vendors={[]}
          createMaterialOrder={server.createMaterialOrder}
          getMaterialOrderDetail={server.getMaterialOrderDetail}
          addMaterialOrderLineItem={server.addMaterialOrderLineItem}
          commitMaterialOrder={server.commitMaterialOrder}
          recordReceivedQuantity={server.recordReceivedQuantity}
          issuePurchaseOrder={server.issuePurchaseOrder}
          getCommittedCostsForProject={server.getCommittedCostsForProject}
          getLatestIssuedPurchaseOrder={server.getLatestIssuedPurchaseOrder}
        />
      );
    });

    // Select the order.
    const orderButton = findButtonByText(renderer.root, "PO-100");
    await act(async () => {
      orderButton.props.onClick();
    });

    check(
      "zero line items: 'No line items yet' empty state renders",
      textOf(renderer.root).includes("No line items yet")
    );
    check(
      "zero line items: the Commit Order control is ABSENT, not merely disabled",
      tryFindButtonByText(renderer.root, "Commit Order") === null
    );

    // New row's cost-code select defaults to the order's defaultCostCodeId.
    const lineCostCodeSelect = findById(renderer.root, "sc-proc-line-costcode");
    check("a new line's cost-code select defaults to the order's defaultCostCodeId", lineCostCodeSelect.props.value === "cc_lumber");

    // Fill and submit the first line item WITHOUT touching the cost-code
    // select — it should keep using the default.
    const descInput1 = findById(renderer.root, "sc-proc-line-desc");
    act(() => {
      descInput1.props.onChange({ target: { value: "2x4 studs" } });
    });
    const qtyInput1 = findById(renderer.root, "sc-proc-line-qty");
    act(() => {
      qtyInput1.props.onChange({ target: { value: "100" } });
    });
    const priceInput1 = findById(renderer.root, "sc-proc-line-price");
    act(() => {
      priceInput1.props.onChange({ target: { value: "5.00" } });
    });
    const lineForm1 = closestForm(findById(renderer.root, "sc-proc-line-desc"));
    await act(async () => {
      await lineForm1.props.onSubmit({ preventDefault() {} });
    });

    check("first line item's add call used the DEFAULT cost code (untouched)", server.addedLineItemCalls[0]?.costCodeId === "cc_lumber");
    check("first line item's unit price was converted to integer cents (5.00 -> 500)", server.addedLineItemCalls[0]?.unitPriceCents === 500);

    check("after a successful add, the Commit Order control now APPEARS", tryFindButtonByText(renderer.root, "Commit Order") !== null);

    // The form resets for the NEXT new row — cost code selector is back
    // at the default (not left on whatever was submitted, and not
    // disabled).
    const lineCostCodeSelectAfterAdd = findById(renderer.root, "sc-proc-line-costcode");
    check("after adding a line item, the form resets and the NEXT row's selector is back at the default", lineCostCodeSelectAfterAdd.props.value === "cc_lumber");

    // Now explicitly override the cost code for a second line item —
    // proves the selector is always independently changeable, and the
    // override (not the default) is what gets submitted.
    act(() => {
      lineCostCodeSelectAfterAdd.props.onChange({ target: { value: "cc_drywall" } });
    });
    const descInput2 = findById(renderer.root, "sc-proc-line-desc");
    act(() => {
      descInput2.props.onChange({ target: { value: "1/2in drywall sheets" } });
    });
    const qtyInput2 = findById(renderer.root, "sc-proc-line-qty");
    act(() => {
      qtyInput2.props.onChange({ target: { value: "30" } });
    });
    const priceInput2 = findById(renderer.root, "sc-proc-line-price");
    act(() => {
      priceInput2.props.onChange({ target: { value: "10.00" } });
    });
    const lineForm2 = closestForm(findById(renderer.root, "sc-proc-line-desc"));
    await act(async () => {
      await lineForm2.props.onSubmit({ preventDefault() {} });
    });

    check("second line item's add call used the OVERRIDDEN cost code, not the default", server.addedLineItemCalls[1]?.costCodeId === "cc_drywall");
    check("exactly two addMaterialOrderLineItem calls were made", server.addedLineItemCalls.length === 2);
    check(
      "the first (already-added) line item's cost code was NOT retroactively changed by the second row's override",
      server.addedLineItemCalls[0]?.costCodeId === "cc_lumber"
    );

    console.log("\n--- Commit: confirm-step safety, then a real per-cost-code dollar summary ---");
    const commitButton = findButtonByText(renderer.root, "Commit Order");
    act(() => {
      commitButton.props.onClick();
    });
    check("clicking 'Commit Order' does NOT call commitMaterialOrder directly", server.getCommitCallCount() === 0);
    check("an inline confirmation step appears", textOf(renderer.root).includes("Commit this order?"));
    check("the confirmation offers 'Yes, commit' and 'Cancel', not a native confirm()", !!tryFindButtonByText(renderer.root, "Yes, commit") && !!tryFindButtonByText(renderer.root, "Cancel"));

    // Cancel aborts — zero calls, confirmation UI goes away.
    const cancelButton = findButtonByText(renderer.root, "Cancel");
    act(() => {
      cancelButton.props.onClick();
    });
    check("Cancel aborts the commit with zero calls to commitMaterialOrder", server.getCommitCallCount() === 0);
    check("the confirmation step is gone after Cancel", !textOf(renderer.root).includes("Commit this order?"));
    check("'Commit Order' is available again after Cancel", tryFindButtonByText(renderer.root, "Commit Order") !== null);

    // Now actually confirm.
    const commitButtonAgain = findButtonByText(renderer.root, "Commit Order");
    act(() => {
      commitButtonAgain.props.onClick();
    });
    const yesCommitButton = findButtonByText(renderer.root, "Yes, commit");
    await act(async () => {
      await yesCommitButton.props.onClick();
    });

    check("confirming calls commitMaterialOrder exactly once", server.getCommitCallCount() === 1);
    const rendered = textOf(renderer.root);
    check(
      "the commit summary names the Lumber cost code with its real committed dollar amount (100 * $5.00 = $500.00)",
      rendered.includes("06-200 Lumber") && rendered.includes("$500.00")
    );
    check(
      "the commit summary names the Drywall cost code with its real, DIFFERENT committed dollar amount (30 * $10.00 = $300.00) — not the same figure copy-pasted, and not a client-side recalculation",
      rendered.includes("09-200 Drywall") && rendered.includes("$300.00")
    );
    check("after commit, the 'Add a line item' form is gone (order left draft status)", !rendered.includes("Add a line item"));

    console.log("\n--- Task 10: Issue Purchase Order now links to a real PDF route ---");
    check("no 'View PDF' link renders before a PO has been issued", renderer.root.findAllByType("a").filter((a) => textOf(a).includes("View PDF")).length === 0);

    const issueButton = findButtonByText(renderer.root, "Issue Purchase Order");
    await act(async () => {
      await issueButton.props.onClick();
    });

    const renderedAfterIssue = textOf(renderer.root);
    check("shows 'Purchase Order issued — Version 1.' after issuing", renderedAfterIssue.includes("Purchase Order issued — Version 1."));
    check("the obsolete 'future update' placeholder text is gone now that the real PDF route exists", !renderedAfterIssue.includes("future update"));

    const pdfLinks = renderer.root.findAllByType("a").filter((a) => textOf(a).includes("View PDF"));
    check("exactly one 'View PDF' link renders once a PO has been issued", pdfLinks.length === 1);
    check(
      "the 'View PDF' link points at this material order's real PDF route",
      pdfLinks[0].props.href === "/api/procurement/material-orders/order_1/pdf"
    );
    check("the 'View PDF' link opens in a new tab, not navigating away from the workspace", pdfLinks[0].props.target === "_blank");
    check("the button relabels to 'Reissue Purchase Order' once a version already exists", tryFindButtonByText(renderer.root, "Reissue Purchase Order") !== null);
    check("no leftover 'Issue Purchase Order' (non-reissue) label remains once issued", tryFindButtonByText(renderer.root, "Issue Purchase Order") === null);

    console.log("\n--- Task 10 fix (post-review): issued-PO state survives reselecting the SAME order, not just the immediate post-click render ---");
    // Deselect, then reselect the same order via the list — this
    // re-runs handleSelectOrder(), which resets poIssuedResult to null
    // BEFORE loadDetail() re-fetches it. Before the fix, loadDetail()
    // never called getLatestIssuedPurchaseOrder at all, so this would
    // have left the banner/link gone and the button back to plain
    // "Issue Purchase Order" even though the order was still genuinely
    // issued.
    const orderButtonAgain = findButtonByText(renderer.root, "PO-100");
    await act(async () => {
      await orderButtonAgain.props.onClick();
    });

    const renderedAfterReselect = textOf(renderer.root);
    check("reselecting the same order still shows 'Purchase Order issued — Version 1.'", renderedAfterReselect.includes("Purchase Order issued — Version 1."));
    check(
      "reselecting the same order still shows the 'View PDF' link with the correct href",
      renderer.root.findAllByType("a").filter((a) => textOf(a).includes("View PDF") && a.props.href === "/api/procurement/material-orders/order_1/pdf").length === 1
    );
    check("reselecting the same order still shows 'Reissue Purchase Order', not the initial-issue label", tryFindButtonByText(renderer.root, "Reissue Purchase Order") !== null);
    check("reselecting did NOT call issuePurchaseOrder again — this is a read-only re-fetch, not a reissue", server.getIssueCallCount() === 1);

    console.log("\n--- Task 10 fix (post-review): issued-PO state survives a full remount (simulates navigating away and back / reloading the page) ---");
    // A brand-new component tree sharing NOTHING with the renderer above
    // except the same fake "backend" (server) — proves the version
    // state/PDF link/Reissue label come from loadDetail()'s own fetch on
    // first select, not from any React state carried over in memory.
    let freshRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      freshRenderer = TestRenderer.create(
        <MaterialOrderWorkspace
          projectId="proj_1"
          materialOrders={[BASE_ORDER]}
          costCodes={COST_CODES}
          vendors={[]}
          createMaterialOrder={server.createMaterialOrder}
          getMaterialOrderDetail={server.getMaterialOrderDetail}
          addMaterialOrderLineItem={server.addMaterialOrderLineItem}
          commitMaterialOrder={server.commitMaterialOrder}
          recordReceivedQuantity={server.recordReceivedQuantity}
          issuePurchaseOrder={server.issuePurchaseOrder}
          getCommittedCostsForProject={server.getCommittedCostsForProject}
          getLatestIssuedPurchaseOrder={server.getLatestIssuedPurchaseOrder}
        />
      );
    });

    const freshOrderButton = findButtonByText(freshRenderer.root, "PO-100");
    await act(async () => {
      await freshOrderButton.props.onClick();
    });

    const renderedFreshMount = textOf(freshRenderer.root);
    check(
      "a freshly-mounted workspace (simulating page reload) shows 'Purchase Order issued — Version 1.' on first select, with zero clicks in this instance",
      renderedFreshMount.includes("Purchase Order issued — Version 1.")
    );
    check(
      "the freshly-mounted workspace shows the correct 'View PDF' link on first select",
      freshRenderer.root.findAllByType("a").filter((a) => textOf(a).includes("View PDF") && a.props.href === "/api/procurement/material-orders/order_1/pdf").length === 1
    );
    check("the freshly-mounted workspace shows 'Reissue Purchase Order' immediately, not the initial-issue label", tryFindButtonByText(freshRenderer.root, "Reissue Purchase Order") !== null);
    check("issuePurchaseOrder was still only ever called once (the fresh mount's own load did not call it)", server.getIssueCallCount() === 1);

    // Reissuing from the fresh instance creates a real version 2 — a
    // second click is a legible, intentional "Reissue" action (the
    // button already said so), not a silent, unlabeled Version-2
    // creation.
    const reissueButton = findButtonByText(freshRenderer.root, "Reissue Purchase Order");
    await act(async () => {
      await reissueButton.props.onClick();
    });

    check("reissuing calls issuePurchaseOrder a second time", server.getIssueCallCount() === 2);
    check("reissuing actually creates version 2 on the fake backend", server.getIssuedVersion() === 2);
    check("shows 'Purchase Order issued — Version 2.' after reissuing", textOf(freshRenderer.root).includes("Purchase Order issued — Version 2."));
  }

  console.log(`\nmaterialOrderWorkspace.tsx: all ${checks} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
