"use client";

/**
 * P5 Task 7 — displays open (`status === "open"`) committed_costs rows
 * for a project, grouped by `sourceId` when several rows share one
 * (a material order that produced multiple cost-code lines, per
 * Decision 2) so staff see "these N rows are one order," not N
 * unrelated-looking entries. Every other open row renders as its own
 * single-row group.
 *
 * Every number here is read straight off `CommittedCost.amountCents`
 * via `formatCents()` — this component never computes a financial
 * figure of its own (CLAUDE.md: "no screen computes its own financial
 * numbers").
 *
 * Styled with the BudgetTable.tsx precedent for a restyled native
 * `<table>` (no dedicated Table primitive exists yet): a bordered/
 * shadowed scroll-container wrapper, a shaded header row, row hover,
 * every value token-driven, applied via
 * `<style dangerouslySetInnerHTML>` — never a raw `<style>{...}</style>`
 * JSX child (that exact pattern caused a repeatedly-found hydration-
 * mismatch bug across this codebase).
 *
 * Mutations go through the `supersedeCommittedCost` Server Action
 * passed in as a prop (same "Server Actions passed as props to a
 * package-level Client Component" pattern as EstimateTable.tsx, which
 * keeps this component free of any dependency on apps/web's file
 * layout / next/headers / @supabase/ssr). After a successful supersede
 * this calls `router.refresh()` rather than computing a new row itself
 * — the fresh committed_costs list always comes from a real server
 * re-read.
 */
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, typography, radius, shadow } from "../design/tokens";
import type { CommittedCost, CostCode } from "../../../01-financial-engine/src/types";
import { formatCents } from "../../../01-financial-engine/src/money";
import { Button, TextInput, Badge, Alert, EmptyState, type BadgeTone } from "./ui";

export interface CommitmentGroup {
  /** The shared `sourceId` for a multi-row material-order group, or the
   *  row's own `id` for a single-row group. */
  key: string;
  rows: CommittedCost[];
}

/**
 * Pure grouping logic, exported separately so it can be unit-tested
 * without mounting the component. Filters to open rows only (fulfilled/
 * cancelled/superseded commitments have nothing left to act on from
 * this screen), then groups by `sourceId` ONLY when `sourceType ===
 * "material_order"` — a bid-award-sourced row (or any other single
 * commitment) always gets its own one-row group, matching
 * `CommittedCost.sourceId`'s own doc comment ("NOT unique — a material
 * order may back several rows sharing one sourceId").
 */
export function groupOpenCommittedCosts(committedCosts: CommittedCost[]): CommitmentGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, CommittedCost[]>();
  for (const row of committedCosts) {
    if (row.status !== "open") continue;
    const key = row.sourceType === "material_order" && row.sourceId ? row.sourceId : row.id;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(row);
  }
  return order.map((key) => ({ key, rows: byKey.get(key)! }));
}

type SupersedeAction = (
  oldCommittedCostId: string,
  newAmountCents: number,
  newVendorName?: string
) => Promise<{ newCommittedCostId: string } | { error: string }>;

export interface CommitmentsTableProps {
  committedCosts: CommittedCost[];
  /** Resolves each row's `costCodeId` to a human-readable code (e.g.
   *  "06-100 Framing") instead of a raw UUID — same data every other
   *  real screen in this app (BudgetTable, EstimateTable) already
   *  fetches via `repo.getCostCodes(projectId)`. */
  costCodes: CostCode[];
  supersedeCommittedCost: SupersedeAction;
}

export function CommitmentsTable({ committedCosts, costCodes, supersedeCommittedCost }: CommitmentsTableProps) {
  const groups = groupOpenCommittedCosts(committedCosts);
  const codeByCostCodeId = new Map(costCodes.map((c) => [c.id, c.code]));

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No open commitments"
        description="Committed costs from awarded bids or material orders will appear here once they're open."
      />
    );
  }

  return (
    <div className="sc-commitments-wrap">
      {groups.map((group) => (
        <CommitmentGroupTable
          key={group.key}
          group={group}
          codeByCostCodeId={codeByCostCodeId}
          supersedeCommittedCost={supersedeCommittedCost}
        />
      ))}
      <style dangerouslySetInnerHTML={{ __html: tableStyles }} />
    </div>
  );
}

function CommitmentGroupTable({
  group,
  codeByCostCodeId,
  supersedeCommittedCost,
}: {
  group: CommitmentGroup;
  codeByCostCodeId: Map<string, string>;
  supersedeCommittedCost: SupersedeAction;
}) {
  const router = useRouter();
  const isMultiRow = group.rows.length > 1;

  return (
    <div className="sc-commitments-table-scroll">
      <table className="sc-commitments-table">
        {isMultiRow && (
          <caption>
            Material order {group.key.slice(0, 8)} — {group.rows.length} cost codes
          </caption>
        )}
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Vendor</th>
            <th style={{ textAlign: "left" }}>Cost Code</th>
            <th style={{ textAlign: "left" }}>Source</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <CommitmentRow
              key={row.id}
              row={row}
              costCodeLabel={codeByCostCodeId.get(row.costCodeId) ?? row.costCodeId}
              supersedeCommittedCost={supersedeCommittedCost}
              onSuperseded={() => router.refresh()}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_TONE: Record<CommittedCost["status"], BadgeTone> = {
  open: "sage",
  fulfilled: "neutral",
  cancelled: "brick",
};

function CommitmentRow({
  row,
  costCodeLabel,
  supersedeCommittedCost,
  onSuperseded,
}: {
  row: CommittedCost;
  costCodeLabel: string;
  supersedeCommittedCost: SupersedeAction;
  onSuperseded: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function parseDollarsToCents(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) return null;
    // Round to nearest cent from a decimal dollar string input, then
    // hand off an already-integer cents value — the service function's
    // own Number.isInteger() check is still the final enforcement
    // point on the server side.
    return Math.round(value * 100);
  }

  async function handleConfirm() {
    setError(null);
    const cents = parseDollarsToCents(draftAmount);
    if (cents === null) {
      setError("Enter a valid dollar amount, zero or greater.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await supersedeCommittedCost(row.id, cents, row.vendorName);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setDraftAmount("");
      onSuperseded();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <tr>
      <td style={{ textAlign: "left" }}>{row.vendorName ?? "—"}</td>
      <td style={{ textAlign: "left" }}>{costCodeLabel}</td>
      <td style={{ textAlign: "left" }}>{row.sourceType ?? "manual"}</td>
      <td>{formatCents(row.amountCents)}</td>
      <td>
        <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
      </td>
      <td>
        {editing ? (
          <div className="sc-commitments-edit">
            <TextInput
              type="number"
              min={0}
              step="0.01"
              placeholder="New amount ($)"
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
              aria-label={`New amount for ${costCodeLabel}`}
              disabled={submitting}
            />
            <div className="sc-commitments-edit-actions">
              <Button size="sm" onClick={handleConfirm} loading={submitting} loadingText="Saving…">
                Confirm
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={submitting}
                onClick={() => {
                  setEditing(false);
                  setDraftAmount("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Supersede
          </Button>
        )}
      </td>
    </tr>
  );
}

const tableStyles = `
.sc-commitments-wrap { display: flex; flex-direction: column; gap: ${spacing.lg}; }
.sc-commitments-table-scroll { border: 1px solid ${colors.line}; border-radius: ${radius.lg}; overflow-x: auto; overflow-y: hidden; background: ${colors.white}; box-shadow: ${shadow.sm}; }
.sc-commitments-table { width: 100%; border-collapse: collapse; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; min-width: 640px; }
.sc-commitments-table caption { text-align: left; caption-side: top; font-size: ${typography.sizeXs}; font-weight: ${typography.weightSemibold}; color: ${colors.stoneDark}; padding: ${spacing.sm} ${spacing.sm} 0; }
.sc-commitments-table thead th { text-align: right; padding: ${spacing.sm}; color: ${colors.stoneDark}; font-weight: 600; font-size: 11px; letter-spacing: 0.03em; text-transform: uppercase; border-bottom: 1px solid ${colors.line}; background: ${colors.paperDim}; }
.sc-commitments-table td { padding: ${spacing.sm}; border-bottom: 1px solid ${colors.paperDim}; text-align: right; color: ${colors.ink2}; vertical-align: middle; }
.sc-commitments-table tbody tr:last-child td { border-bottom: none; }
.sc-commitments-table tbody tr:hover td { background: ${colors.paperDim}; }
.sc-commitments-edit { display: flex; flex-direction: column; align-items: flex-end; gap: ${spacing.xs}; }
.sc-commitments-edit-actions { display: flex; gap: ${spacing.xs}; }
`;
