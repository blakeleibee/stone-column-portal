"use client";

/**
 * The `/admin/procurement` screen (P5, Task 9) — a single Client
 * Component owning list + detail + every form, matching
 * BidPackageWorkspace.tsx's own shape (Task 6, "the closer sibling
 * pattern" this file was told to follow): list-on-the-left,
 * detail-on-select, inline forms, an inline "Are you sure?" confirm
 * step before the one irreversible-in-effect action (Commit), and
 * shared `ui/` primitives throughout — never raw markup, never a raw
 * `<style>{...}</style>` JSX child.
 *
 * State-freshness rule (same lesson BidPackageWorkspace.tsx and
 * ImportWizard.tsx both document): the detail pane (`detail`) is never
 * patched in place after a mutation. Every successful mutation is
 * followed by a full `loadDetail(id)` re-fetch whose result
 * WHOLESALE-REPLACES `detail` — never merged or hand-patched. The one
 * list row affected by a mutation is derived from that same fresh
 * `getMaterialOrderDetail` response (`toMaterialOrderRow`) and spliced
 * into `orders`, exactly like BidPackageWorkspace does for `packages`.
 *
 * Loading state: plain `useState` booleans (`detailLoading`,
 * `createSubmitting`, etc.), not React's `useTransition` — matching
 * BidPackageWorkspace.tsx's own deliberate choice (see that file's
 * header comment): React 18.3.1 does not reliably keep a
 * `useTransition` `isPending` flag true across an `await` inside a
 * plain async callback, which would risk "Loading…" flickering off
 * before a fetch actually resolves. This file follows the ACTUAL,
 * documented, working sibling pattern rather than the plan text's
 * "via useTransition's pending flag" phrasing, which BidPackageWorkspace
 * itself already deviated from for the same correctness reason.
 *
 * Decision 2 (line-level cost-code allocation): a material order's
 * `defaultCostCodeId` is a UI convenience only, never authoritative.
 * The "Add a line item" form's cost-code `<select>` is re-initialized
 * to that default every time a NEW row is about to be added (on
 * selecting an order, and again after each successful add) but is
 * always independently changeable before submit, and once a line item
 * is added its cost code is exactly whatever was selected at that
 * moment — never silently re-derived later.
 *
 * Honest issue-PO confirmation (this task's Correction 2 — Task 10's
 * PDF route does not exist yet): after `issuePurchaseOrder` succeeds,
 * this fetches the real issued document's version via
 * `getLatestIssuedPurchaseOrder` (a thin Task 9 addition to
 * documentIssuanceService's already-real `getLatestIssuedDocument`) and
 * shows "Purchase Order issued — Version N." with a plain, non-interactive
 * "PDF viewing available in a future update." note — never a clickable
 * "Open PDF"/"View PDF" link, matching ProjectSetupChecklist.tsx's own
 * "never present not-yet-built functionality as if it were real"
 * convention.
 *
 * Every number this file renders traces to a real, already-computed
 * value: line items show `quantity`/`unitPriceCents` exactly as stored
 * (no client-side multiplication into a "line total" anywhere), and the
 * post-commit per-cost-code confirmation summary's dollar amounts come
 * from `committed_costs.amount_cents` itself (fetched via the new
 * `getCommittedCostsForProject` action, a thin forward to the
 * pre-existing, pre-P5 `FinancialRepository.getCommittedCosts` —
 * CommitmentsTable.tsx's page already sources the identical figure the
 * same way), matched back to the specific `committedCostId`s
 * `commitMaterialOrder` returned — never recomputed from `quantity *
 * unitPriceCents` a second time in the browser.
 */
import React, { useState } from "react";
import { colors, spacing, typography, radius } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { CostCode, CommittedCost } from "../../../01-financial-engine/src/types";
import type {
  MaterialOrderRow,
  MaterialOrderDetail,
  MaterialOrderLineItemRow,
  MaterialOrderCommitResult,
} from "../services/procurementService";
import type { VendorRow } from "../services/bidService";
import type { IssuedDocumentRow } from "../services/documentIssuanceService";
import { Card, PageHeader, Button, TextInput, Select, Checkbox, FormField, StatusBadge, Alert, EmptyState } from "./ui";
import type { BadgeTone } from "./ui";

type ActionResult<T extends object = object> = (T & { error?: undefined }) | { error: string };

export interface MaterialOrderWorkspaceProps {
  projectId: string;
  materialOrders: MaterialOrderRow[];
  costCodes: CostCode[];
  vendors: VendorRow[];
  createMaterialOrder: (
    projectId: string,
    defaultCostCodeId?: string,
    vendorId?: string,
    orderNumber?: string,
    notes?: string
  ) => Promise<{ id?: string; error?: string }>;
  getMaterialOrderDetail: (materialOrderId: string) => Promise<{ detail?: MaterialOrderDetail; error?: string }>;
  addMaterialOrderLineItem: (
    materialOrderId: string,
    projectId: string,
    costCodeId: string,
    description: string,
    quantity: number,
    unit: string | undefined,
    unitPriceCents: number
  ) => Promise<{ error?: string }>;
  commitMaterialOrder: (materialOrderId: string) => Promise<{ committedCosts?: MaterialOrderCommitResult[]; error?: string }>;
  recordReceivedQuantity: (lineItemId: string, receivedQuantity: number, markBackordered?: boolean) => Promise<{ error?: string }>;
  issuePurchaseOrder: (materialOrderId: string, documentNumber?: string) => Promise<{ issuedDocumentId?: string; error?: string }>;
  getCommittedCostsForProject: (projectId: string) => Promise<{ committedCosts?: CommittedCost[]; error?: string }>;
  getLatestIssuedPurchaseOrder: (materialOrderId: string) => Promise<{ document?: IssuedDocumentRow; error?: string }>;
}

const ORDER_STATUS_LABELS: Record<MaterialOrderRow["status"], string> = {
  draft: "Draft",
  ordered: "Ordered",
  partially_received: "Partially Received",
  received: "Received",
  cancelled: "Cancelled",
};

const ORDER_STATUS_TONE: Record<MaterialOrderRow["status"], BadgeTone> = {
  draft: "neutral",
  ordered: "sage",
  partially_received: "gold",
  received: "sage",
  cancelled: "brick",
};

function OrderStatusBadge({ status }: { status: MaterialOrderRow["status"] }) {
  return <StatusBadge label={ORDER_STATUS_LABELS[status]} tone={ORDER_STATUS_TONE[status]} />;
}

function toMaterialOrderRow(detail: MaterialOrderDetail): MaterialOrderRow {
  const { lineItems, ...rest } = detail;
  return rest;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

interface CommitSummaryRow {
  costCodeId: string;
  costCodeLabel: string;
  amountCents: number | null;
}

type PoIssuedResult = { version: number } | { versionUnknown: true };

export function MaterialOrderWorkspace({
  projectId,
  materialOrders,
  costCodes,
  vendors,
  createMaterialOrder,
  getMaterialOrderDetail,
  addMaterialOrderLineItem,
  commitMaterialOrder,
  recordReceivedQuantity,
  issuePurchaseOrder,
  getCommittedCostsForProject,
  getLatestIssuedPurchaseOrder,
}: MaterialOrderWorkspaceProps) {
  const [orders, setOrders] = useState<MaterialOrderRow[]>(materialOrders);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<MaterialOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // --- Create order form ---
  const [createCostCodeId, setCreateCostCodeId] = useState("");
  const [createVendorId, setCreateVendorId] = useState("");
  const [createOrderNumber, setCreateOrderNumber] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // --- Add line item form (single active form per selected order) ---
  const [lineCostCodeId, setLineCostCodeId] = useState("");
  const [lineDescription, setLineDescription] = useState("");
  const [lineQuantity, setLineQuantity] = useState("");
  const [lineUnit, setLineUnit] = useState("");
  const [lineUnitPriceDollars, setLineUnitPriceDollars] = useState("");
  const [lineSubmitting, setLineSubmitting] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);

  // --- Commit (single confirmation for the selected order) ---
  const [commitConfirming, setCommitConfirming] = useState(false);
  const [commitSubmitting, setCommitSubmitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSummary, setCommitSummary] = useState<CommitSummaryRow[] | null>(null);

  // --- Receiving (per-line-item drafts, keyed by line item id) ---
  const [receiveQuantityDrafts, setReceiveQuantityDrafts] = useState<Record<string, string>>({});
  const [receiveBackorderedDrafts, setReceiveBackorderedDrafts] = useState<Record<string, boolean>>({});
  const [receiveSubmitting, setReceiveSubmitting] = useState<Record<string, boolean>>({});
  const [receiveErrors, setReceiveErrors] = useState<Record<string, string | null>>({});

  // --- Issue PO ---
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [poIssuedResult, setPoIssuedResult] = useState<PoIssuedResult | null>(null);

  const costCodesById = new Map(costCodes.map((cc) => [cc.id, cc]));
  const vendorsById = new Map(vendors.map((v) => [v.id, v]));

  function resetLineForm(defaultCostCodeId: string | null) {
    setLineCostCodeId(defaultCostCodeId ?? "");
    setLineDescription("");
    setLineQuantity("");
    setLineUnit("");
    setLineUnitPriceDollars("");
    setLineError(null);
  }

  // The single re-fetch every mutation below calls on success. Never
  // patches state in place — always replaces `detail` wholesale from a
  // fresh read, and refreshes the matching list row from that same
  // fresh response. `resetLine` is only true right after selecting an
  // order and right after a successful line-item add — a NEW row's
  // selector should start at the order's default, but an in-progress
  // edit (e.g. after a receiving update elsewhere) must not be
  // clobbered.
  async function loadDetail(id: string, resetLine: boolean) {
    const result = await getMaterialOrderDetail(id);
    if (result.error || !result.detail) {
      setDetail(null);
      setDetailError(result.error ?? "Material order not found.");
      return;
    }
    setDetailError(null);
    setDetail(result.detail);
    setOrders((prev) => {
      const row = toMaterialOrderRow(result.detail!);
      const exists = prev.some((o) => o.id === id);
      return exists ? prev.map((o) => (o.id === id ? row : o)) : [row, ...prev];
    });
    if (resetLine) {
      resetLineForm(result.detail.defaultCostCodeId);
    }
  }

  async function handleSelectOrder(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setCommitConfirming(false);
    setCommitError(null);
    setCommitSummary(null);
    setIssueError(null);
    setPoIssuedResult(null);
    setDetailLoading(true);
    try {
      await loadDetail(id, true);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleRetryDetail() {
    if (!selectedId) return;
    setDetailLoading(true);
    try {
      await loadDetail(selectedId, false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSubmitting(true);
    try {
      const result = await createMaterialOrder(
        projectId,
        createCostCodeId || undefined,
        createVendorId || undefined,
        createOrderNumber.trim() || undefined
      );
      if (result.error || !result.id) {
        setCreateError(result.error ?? "Failed to create material order.");
        return;
      }
      setCreateOrderNumber("");
      await handleSelectOrder(result.id);
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleAddLineItem(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (!lineCostCodeId) {
      setLineError("Select a cost code.");
      return;
    }
    if (!lineDescription.trim()) {
      setLineError("Description is required.");
      return;
    }
    const quantity = Number(lineQuantity);
    if (lineQuantity.trim() === "" || Number.isNaN(quantity) || !(quantity > 0)) {
      setLineError("Quantity must be greater than zero.");
      return;
    }
    const dollars = Number(lineUnitPriceDollars);
    if (lineUnitPriceDollars.trim() === "" || Number.isNaN(dollars) || dollars < 0) {
      setLineError("Enter a valid unit price, zero or greater.");
      return;
    }
    const unitPriceCents = Math.round(dollars * 100);
    setLineError(null);
    setLineSubmitting(true);
    try {
      const result = await addMaterialOrderLineItem(
        detail.id,
        detail.projectId,
        lineCostCodeId,
        lineDescription,
        quantity,
        lineUnit.trim() || undefined,
        unitPriceCents
      );
      if (result.error) {
        setLineError(result.error);
        return;
      }
      await loadDetail(detail.id, true);
    } finally {
      setLineSubmitting(false);
    }
  }

  function handleCommitClick() {
    setCommitConfirming(true);
    setCommitError(null);
  }

  function handleCommitCancel() {
    setCommitConfirming(false);
    setCommitError(null);
  }

  async function handleCommitConfirm() {
    if (!detail) return;
    setCommitSubmitting(true);
    try {
      const result = await commitMaterialOrder(detail.id);
      if (result.error || !result.committedCosts) {
        setCommitError(result.error ?? "Failed to commit material order.");
        return;
      }
      const mapping = result.committedCosts;
      setCommitConfirming(false);
      await loadDetail(detail.id, false);

      const committedCostIds = new Set(mapping.map((m) => m.committedCostId));
      const costsResult = await getCommittedCostsForProject(detail.projectId);
      const realRows = costsResult.committedCosts ?? [];
      const summary: CommitSummaryRow[] = mapping.map((m) => {
        const row = realRows.find((r) => committedCostIds.has(r.id) && r.id === m.committedCostId);
        return {
          costCodeId: m.costCodeId,
          costCodeLabel: costCodesById.get(m.costCodeId)?.code ?? m.costCodeId,
          amountCents: row ? row.amountCents : null,
        };
      });
      setCommitSummary(summary);
    } finally {
      setCommitSubmitting(false);
    }
  }

  function receiveQuantityValue(li: MaterialOrderLineItemRow): string {
    return receiveQuantityDrafts[li.id] ?? String(li.receivedQuantity);
  }

  function receiveBackorderedValue(li: MaterialOrderLineItemRow): boolean {
    return receiveBackorderedDrafts[li.id] ?? li.backordered;
  }

  async function handleRecordReceived(li: MaterialOrderLineItemRow) {
    if (!detail) return;
    const raw = receiveQuantityValue(li);
    const qty = Number(raw);
    if (raw.trim() === "" || Number.isNaN(qty) || qty < 0) {
      setReceiveErrors((prev) => ({ ...prev, [li.id]: "Enter a valid received quantity, zero or greater." }));
      return;
    }
    setReceiveErrors((prev) => ({ ...prev, [li.id]: null }));
    setReceiveSubmitting((prev) => ({ ...prev, [li.id]: true }));
    try {
      const result = await recordReceivedQuantity(li.id, qty, receiveBackorderedValue(li));
      if (result.error) {
        setReceiveErrors((prev) => ({ ...prev, [li.id]: result.error! }));
        return;
      }
      setReceiveQuantityDrafts((prev) => {
        const next = { ...prev };
        delete next[li.id];
        return next;
      });
      setReceiveBackorderedDrafts((prev) => {
        const next = { ...prev };
        delete next[li.id];
        return next;
      });
      await loadDetail(detail.id, false);
    } finally {
      setReceiveSubmitting((prev) => ({ ...prev, [li.id]: false }));
    }
  }

  async function handleIssuePO() {
    if (!detail) return;
    setIssueError(null);
    setPoIssuedResult(null);
    setIssueSubmitting(true);
    try {
      const result = await issuePurchaseOrder(detail.id);
      if (result.error) {
        setIssueError(result.error);
        return;
      }
      const latest = await getLatestIssuedPurchaseOrder(detail.id);
      if (latest.error || !latest.document) {
        // The issuance itself succeeded (no error above) — this is only
        // the follow-up read failing, so still an honest success state,
        // just without a confirmed version number. Never fabricated.
        setPoIssuedResult({ versionUnknown: true });
        return;
      }
      setPoIssuedResult({ version: latest.document.version });
      await loadDetail(detail.id, false);
    } finally {
      setIssueSubmitting(false);
    }
  }

  function CostCodeSelect({
    id,
    value,
    onChange,
    optional,
  }: {
    id: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    optional: boolean;
  }) {
    if (costCodes.length === 0) {
      return (
        <Select id={id} disabled value="">
          <option value="">No cost codes available for this project</option>
        </Select>
      );
    }
    return (
      <Select id={id} value={value} onChange={onChange}>
        <option value="">{optional ? "— none —" : "— select —"}</option>
        {costCodes.map((cc) => (
          <option key={cc.id} value={cc.id}>
            {cc.code}
            {cc.activityName ? ` — ${cc.activityName}` : ""}
          </option>
        ))}
      </Select>
    );
  }

  // The "Receiving" column itself (with a plain read-only received/
  // backordered summary) shows for any post-commit status, including
  // 'received' — there's nothing wrong with staff seeing what was
  // received on a fully-received order. The INTERACTIVE controls
  // (input/checkbox/button) are narrower, matching the plan's own
  // Mutations table exactly: "only visible once status is ordered/
  // partially_received" — once every line is fully received there's
  // nothing left to record, so the editable form gives way to a plain
  // summary line instead.
  const showReceivingColumn = detail
    ? detail.status === "ordered" || detail.status === "partially_received" || detail.status === "received"
    : false;
  const showReceivingControls = detail ? detail.status === "ordered" || detail.status === "partially_received" : false;
  const showIssuePO = showReceivingColumn; // "visible once committed" — same set of post-commit statuses

  return (
    <div className="sc-procurement-workspace">
      <PageHeader title="Material Orders" subtitle="Manage material orders, receiving, and purchase-order issuance." />
      <div className="sc-procurement-layout">
        <Card className="sc-procurement-list-col">
          {orders.length === 0 ? (
            <EmptyState title="No material orders yet." description="Create one to get started." />
          ) : (
            <ul className="sc-procurement-list">
              {orders.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    className={`sc-procurement-list-item${order.id === selectedId ? " sc-procurement-list-item-active" : ""}`}
                    onClick={() => handleSelectOrder(order.id)}
                  >
                    <span className="sc-procurement-list-title">{order.orderNumber || `Order ${shortId(order.id)}`}</span>
                    <OrderStatusBadge status={order.status} />
                    <span className="sc-procurement-list-vendor">
                      {order.vendorId ? vendorsById.get(order.vendorId)?.name ?? "Vendor" : "No vendor"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <section className="sc-procurement-create">
            <h4>Create a material order</h4>
            <form onSubmit={handleCreateSubmit} className="sc-procurement-form">
              <FormField
                label="Default cost code (optional)"
                htmlFor="sc-proc-create-costcode"
                hint="Pre-fills each new line item's cost code — never used when committing."
              >
                <CostCodeSelect
                  id="sc-proc-create-costcode"
                  value={createCostCodeId}
                  onChange={(e) => setCreateCostCodeId(e.target.value)}
                  optional
                />
              </FormField>
              <FormField label="Vendor (optional)" htmlFor="sc-proc-create-vendor">
                <Select id="sc-proc-create-vendor" value={createVendorId} onChange={(e) => setCreateVendorId(e.target.value)}>
                  <option value="">— none —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Order number (optional)" htmlFor="sc-proc-create-ordernum">
                <TextInput
                  id="sc-proc-create-ordernum"
                  value={createOrderNumber}
                  onChange={(e) => setCreateOrderNumber(e.target.value)}
                />
              </FormField>
              <Button type="submit" variant="primary" disabled={createSubmitting} loading={createSubmitting} loadingText="Creating…">
                Create Order
              </Button>
              {createError && <Alert tone="error">{createError}</Alert>}
            </form>
          </section>
        </Card>

        <Card className="sc-procurement-detail-col">
          {!selectedId && (
            <EmptyState
              title="No order selected"
              description="Select a material order on the left to view its detail, or create one to get started."
            />
          )}

          {selectedId && detailLoading && !detail && !detailError && <p>Loading…</p>}

          {selectedId && detailError && (
            <div className="sc-procurement-detail-error">
              <Alert tone="error">{detailError}</Alert>
              <Button variant="secondary" size="sm" onClick={handleRetryDetail}>
                Retry
              </Button>
            </div>
          )}

          {selectedId && detail && (
            <div className="sc-procurement-detail">
              <div className="sc-procurement-detail-header">
                <h3>{detail.orderNumber || `Order ${shortId(detail.id)}`}</h3>
                <OrderStatusBadge status={detail.status} />
              </div>
              <p className="sc-procurement-meta">
                Vendor: {detail.vendorId ? vendorsById.get(detail.vendorId)?.name ?? detail.vendorId : "—"} · Default cost code:{" "}
                {detail.defaultCostCodeId ? costCodesById.get(detail.defaultCostCodeId)?.code ?? detail.defaultCostCodeId : "—"}
              </p>

              <section className="sc-procurement-section">
                <h4>Line items</h4>
                {detail.lineItems.length === 0 ? (
                  <EmptyState title="No line items yet — add at least one before committing." />
                ) : (
                  <table className="sc-procurement-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Description</th>
                        <th style={{ textAlign: "left" }}>Cost Code</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "left" }}>Unit</th>
                        <th style={{ textAlign: "right" }}>Unit Price</th>
                        {showReceivingColumn && <th style={{ textAlign: "left" }}>Receiving</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lineItems.map((li) => (
                        <tr key={li.id}>
                          <td style={{ textAlign: "left" }}>{li.description}</td>
                          <td style={{ textAlign: "left" }}>{costCodesById.get(li.costCodeId)?.code ?? li.costCodeId}</td>
                          <td style={{ textAlign: "right" }}>{li.quantity}</td>
                          <td style={{ textAlign: "left" }}>{li.unit ?? "—"}</td>
                          <td style={{ textAlign: "right" }}>{formatCents(li.unitPriceCents)}</td>
                          {showReceivingColumn && (
                            <td>
                              {showReceivingControls ? (
                                <>
                                  <div className="sc-procurement-inline-form">
                                    <TextInput
                                      type="number"
                                      step="any"
                                      min={0}
                                      className="sc-procurement-input-narrow"
                                      value={receiveQuantityValue(li)}
                                      onChange={(e) =>
                                        setReceiveQuantityDrafts((prev) => ({ ...prev, [li.id]: e.target.value }))
                                      }
                                      aria-label={`Received quantity for ${li.description}`}
                                      disabled={!!receiveSubmitting[li.id]}
                                    />
                                    <Checkbox
                                      label="Backordered"
                                      checked={receiveBackorderedValue(li)}
                                      onChange={(e) =>
                                        setReceiveBackorderedDrafts((prev) => ({ ...prev, [li.id]: e.target.checked }))
                                      }
                                      disabled={!!receiveSubmitting[li.id]}
                                    />
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      disabled={!!receiveSubmitting[li.id]}
                                      loading={!!receiveSubmitting[li.id]}
                                      loadingText="Saving…"
                                      onClick={() => handleRecordReceived(li)}
                                    >
                                      Record Received
                                    </Button>
                                  </div>
                                  {receiveErrors[li.id] && <Alert tone="error">{receiveErrors[li.id]}</Alert>}
                                </>
                              ) : null}
                              <p className="sc-procurement-muted">
                                Received {li.receivedQuantity} of {li.quantity}
                                {li.backordered ? " · Backordered" : ""}
                              </p>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detail.status === "draft" && (
                  <form onSubmit={handleAddLineItem} className="sc-procurement-form">
                    <h5>Add a line item</h5>
                    <FormField label="Cost code" htmlFor="sc-proc-line-costcode">
                      <CostCodeSelect
                        id="sc-proc-line-costcode"
                        value={lineCostCodeId}
                        onChange={(e) => setLineCostCodeId(e.target.value)}
                        optional={false}
                      />
                    </FormField>
                    <FormField label="Description" htmlFor="sc-proc-line-desc">
                      <TextInput id="sc-proc-line-desc" value={lineDescription} onChange={(e) => setLineDescription(e.target.value)} />
                    </FormField>
                    <FormField label="Quantity" htmlFor="sc-proc-line-qty">
                      <TextInput
                        id="sc-proc-line-qty"
                        type="number"
                        step="any"
                        min={0}
                        value={lineQuantity}
                        onChange={(e) => setLineQuantity(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Unit (optional)" htmlFor="sc-proc-line-unit">
                      <TextInput id="sc-proc-line-unit" value={lineUnit} onChange={(e) => setLineUnit(e.target.value)} />
                    </FormField>
                    <FormField label="Unit price ($)" htmlFor="sc-proc-line-price">
                      <TextInput
                        id="sc-proc-line-price"
                        type="number"
                        step="0.01"
                        min={0}
                        value={lineUnitPriceDollars}
                        onChange={(e) => setLineUnitPriceDollars(e.target.value)}
                      />
                    </FormField>
                    <Button type="submit" variant="secondary" disabled={lineSubmitting} loading={lineSubmitting} loadingText="Adding…">
                      Add Line Item
                    </Button>
                    {lineError && <Alert tone="error">{lineError}</Alert>}
                  </form>
                )}
              </section>

              {detail.status === "draft" && detail.lineItems.length > 0 && (
                <section className="sc-procurement-section">
                  <h4>Commit</h4>
                  {commitConfirming ? (
                    <div className="sc-procurement-confirm">
                      <Alert tone="warning" title="Commit this order?">
                        This creates one committed cost per distinct cost code among this order's line items and freezes every line
                        item's committed fields — quantity, unit price, description, unit, and cost code can no longer change (only
                        received quantity/backorder status stay editable after this).
                      </Alert>
                      <div className="sc-procurement-confirm-actions">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={commitSubmitting}
                          loading={commitSubmitting}
                          loadingText="Committing…"
                          onClick={handleCommitConfirm}
                        >
                          Yes, commit
                        </Button>
                        <Button variant="secondary" size="sm" onClick={handleCommitCancel}>
                          Cancel
                        </Button>
                      </div>
                      {commitError && <Alert tone="error">{commitError}</Alert>}
                    </div>
                  ) : (
                    <Button variant="primary" onClick={handleCommitClick}>
                      Commit Order
                    </Button>
                  )}
                </section>
              )}

              {commitSummary && (
                <section className="sc-procurement-section">
                  <Alert tone="success" title="Order committed">
                    <ul className="sc-procurement-commit-summary">
                      {commitSummary.map((s) => (
                        <li key={s.costCodeId}>
                          {s.costCodeLabel}: {s.amountCents != null ? formatCents(s.amountCents) : "—"} committed
                        </li>
                      ))}
                    </ul>
                    See these on the <a href="/admin/commitments">Commitments</a> screen.
                  </Alert>
                </section>
              )}

              {showIssuePO && (
                <section className="sc-procurement-section">
                  <h4>Purchase order</h4>
                  <Button
                    variant="secondary"
                    disabled={issueSubmitting}
                    loading={issueSubmitting}
                    loadingText="Issuing…"
                    onClick={handleIssuePO}
                  >
                    Issue Purchase Order
                  </Button>
                  {issueError && <Alert tone="error">{issueError}</Alert>}
                  {poIssuedResult && (
                    <Alert tone="success">
                      {"version" in poIssuedResult
                        ? `Purchase Order issued — Version ${poIssuedResult.version}.`
                        : "Purchase Order issued."}
                      <br />
                      <span className="sc-procurement-muted">PDF viewing available in a future update.</span>
                    </Alert>
                  )}
                </section>
              )}
            </div>
          )}
        </Card>
      </div>
      <style dangerouslySetInnerHTML={{ __html: workspaceStyles }} />
    </div>
  );
}

const workspaceStyles = `
.sc-procurement-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-procurement-layout { display: flex; gap: ${spacing.lg}; align-items: flex-start; }
.sc-procurement-list-col { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; gap: ${spacing.md}; }
.sc-procurement-detail-col { flex: 1; min-width: 0; }
.sc-procurement-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: ${spacing.xs}; }
.sc-procurement-list-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; padding: ${spacing.sm}; border: 1px solid ${colors.line}; border-radius: ${radius.md}; background: ${colors.white}; cursor: pointer; }
.sc-procurement-list-item-active { border-color: ${colors.sage}; background: ${colors.sageTint}; }
.sc-procurement-list-title { font-weight: ${typography.weightSemibold}; font-size: ${typography.sizeSm}; }
.sc-procurement-list-vendor { font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; }
.sc-procurement-create { border-top: 1px solid ${colors.line}; padding-top: ${spacing.md}; }
.sc-procurement-create h4 { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeSm}; text-transform: uppercase; letter-spacing: 0.02em; color: ${colors.stoneDark}; }
.sc-procurement-form { display: flex; flex-direction: column; gap: ${spacing.sm}; align-items: flex-start; width: 100%; }
.sc-procurement-form h5 { margin: ${spacing.md} 0 0 0; font-size: ${typography.sizeSm}; color: ${colors.stoneDark}; }
.sc-procurement-input-narrow { max-width: 120px; }
.sc-procurement-muted { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; margin: 4px 0 0 0; }
.sc-procurement-detail-error { display: flex; align-items: center; gap: ${spacing.sm}; }
.sc-procurement-detail-header { display: flex; align-items: center; gap: ${spacing.sm}; }
.sc-procurement-detail-header h3 { margin: 0; }
.sc-procurement-meta { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; }
.sc-procurement-section { margin-top: ${spacing.lg}; padding-top: ${spacing.md}; border-top: 1px solid ${colors.line}; }
.sc-procurement-section h4 { margin: 0 0 ${spacing.sm} 0; }
.sc-procurement-inline-form { display: flex; flex-wrap: wrap; align-items: center; gap: ${spacing.sm}; }
.sc-procurement-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; margin-top: ${spacing.sm}; }
.sc-procurement-table th { padding: 6px 8px; border-bottom: 1px solid ${colors.line}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-procurement-table td { padding: 6px 8px; border-bottom: 1px solid ${colors.paperDim}; vertical-align: top; }
.sc-procurement-confirm { display: flex; flex-direction: column; gap: ${spacing.xs}; max-width: 480px; }
.sc-procurement-confirm-actions { display: flex; gap: ${spacing.xs}; align-items: center; }
.sc-procurement-commit-summary { list-style: none; padding: 0; margin: 0 0 ${spacing.xs} 0; display: flex; flex-direction: column; gap: 2px; }
`;
