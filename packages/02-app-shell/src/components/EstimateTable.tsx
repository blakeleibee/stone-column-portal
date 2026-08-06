"use client";

/**
 * The mutation-capable sibling of BudgetTable.tsx, deliberately kept as a
 * SEPARATE component (per P4-DESIGN.md's decision not to overload
 * BudgetTable, which stays a pure read-only display of CategoryFinancials
 * and is used by AdminFinancialsScreen/ClientBudgetAndInvoicesScreen).
 *
 * This component never computes a budget total, fee, or any other
 * financial figure itself — every number rendered comes straight from
 * `CategoryFinancials` (already computed by computeAllCategoryFinancials
 * in the calling page.tsx) via `formatCents`. Every mutation goes through
 * one of the three Server Actions passed in as props (enterOriginalBudget /
 * adjustBudget / updateCostCodeMetadata — thin Server Actions over
 * packages/02-app-shell/src/services/*), and after any successful
 * mutation this component calls router.refresh() rather than computing a
 * new number itself — the fresh totals always come from a real server
 * re-read, never client-side arithmetic.
 *
 * Server Actions are passed as PROPS from page.tsx (an apps/web Server
 * Component) rather than imported directly here. That keeps this
 * package-level component free of any dependency on apps/web's file
 * layout (or, transitively, on next/headers / @supabase/ssr, which this
 * package does not declare as a dependency) — passing Server Actions as
 * props to a Client Component is the standard, supported Next.js App
 * Router pattern.
 */
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, typography, radius } from "../design/tokens";
import type { CategoryFinancials } from "../../../01-financial-engine/src/types";
import type { CostCode } from "../../../01-financial-engine/src/types";
import { formatCents } from "../../../01-financial-engine/src/money";

type ActionResult = { error?: string } | void | undefined;

export interface EstimateTableProps {
  categories: CategoryFinancials[];
  costCodes: CostCode[];
  /** Keyed by cost code id — whether ANY budget_ledger row with
   *  entry_type === 'original' already exists for that cost code.
   *  Computed by the page from the raw ledger, never inferred from
   *  originalEstimateCents === 0 (a legitimate $0 original entry is
   *  valid and indistinguishable from "no entry yet" by value alone). */
  hasOriginalEntry: Record<string, boolean>;
  projectId: string;
  enterOriginalBudget: (
    projectId: string,
    costCodeId: string,
    amountCents: number,
    note?: string
  ) => Promise<ActionResult>;
  adjustBudget: (
    projectId: string,
    costCodeId: string,
    deltaCents: number,
    reason: string
  ) => Promise<ActionResult>;
  updateCostCodeMetadata: (
    costCodeId: string,
    patch: {
      activityName?: string;
      scopeDescription?: string;
      includeInEstimate?: boolean;
      billable?: boolean;
    }
  ) => Promise<ActionResult>;
}

export function EstimateTable({
  categories,
  costCodes,
  hasOriginalEntry,
  projectId,
  enterOriginalBudget,
  adjustBudget,
  updateCostCodeMetadata,
}: EstimateTableProps) {
  const costCodesById = new Map(costCodes.map((cc) => [cc.id, cc]));

  return (
    <div className="sc-estimate-table-wrap">
      <table className="sc-estimate-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Cost Code</th>
            <th style={{ textAlign: "left" }}>Activity</th>
            <th style={{ textAlign: "left" }}>Scope</th>
            <th>Original Est.</th>
            <th>Revised Est.</th>
            <th>Include</th>
            <th>Billable</th>
            <th style={{ textAlign: "left" }}>Budget Entry</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const costCode = costCodesById.get(c.costCodeId);
            if (!costCode) return null;
            return (
              <EstimateRow
                key={c.costCodeId}
                category={c}
                costCode={costCode}
                hasOriginalEntry={!!hasOriginalEntry[c.costCodeId]}
                projectId={projectId}
                enterOriginalBudget={enterOriginalBudget}
                adjustBudget={adjustBudget}
                updateCostCodeMetadata={updateCostCodeMetadata}
              />
            );
          })}
        </tbody>
      </table>
      <style>{tableStyles}</style>
    </div>
  );
}

function EstimateRow({
  category,
  costCode,
  hasOriginalEntry,
  projectId,
  enterOriginalBudget,
  adjustBudget,
  updateCostCodeMetadata,
}: {
  category: CategoryFinancials;
  costCode: CostCode;
  hasOriginalEntry: boolean;
  projectId: string;
  enterOriginalBudget: EstimateTableProps["enterOriginalBudget"];
  adjustBudget: EstimateTableProps["adjustBudget"];
  updateCostCodeMetadata: EstimateTableProps["updateCostCodeMetadata"];
}) {
  const router = useRouter();

  const [activityName, setActivityName] = useState(costCode.activityName ?? "");
  const [scopeDescription, setScopeDescription] = useState(costCode.scopeDescription ?? "");
  const [includeInEstimate, setIncludeInEstimate] = useState(costCode.includeInEstimate);
  const [billable, setBillable] = useState(costCode.billable);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  async function saveMetadata(patch: Parameters<EstimateTableProps["updateCostCodeMetadata"]>[1]) {
    setMetadataError(null);
    const result = await updateCostCodeMetadata(costCode.id, patch);
    if (result && "error" in result && result.error) {
      setMetadataError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <tr>
      <td style={{ textAlign: "left", fontWeight: typography.weightSemibold }}>{category.code}</td>
      <td style={{ textAlign: "left" }}>
        <input
          type="text"
          value={activityName}
          onChange={(e) => setActivityName(e.target.value)}
          onBlur={() => {
            if (activityName !== (costCode.activityName ?? "")) {
              saveMetadata({ activityName });
            }
          }}
          className="sc-estimate-input"
          aria-label={`Activity name for ${category.code}`}
        />
      </td>
      <td style={{ textAlign: "left" }}>
        <input
          type="text"
          value={scopeDescription}
          onChange={(e) => setScopeDescription(e.target.value)}
          onBlur={() => {
            if (scopeDescription !== (costCode.scopeDescription ?? "")) {
              saveMetadata({ scopeDescription });
            }
          }}
          className="sc-estimate-input"
          aria-label={`Scope description for ${category.code}`}
        />
      </td>
      <td>{formatCents(category.originalEstimateCents)}</td>
      <td style={{ fontWeight: typography.weightSemibold }}>{formatCents(category.revisedEstimateCents)}</td>
      <td>
        <input
          type="checkbox"
          checked={includeInEstimate}
          onChange={(e) => {
            const next = e.target.checked;
            setIncludeInEstimate(next);
            saveMetadata({ includeInEstimate: next });
          }}
          aria-label={`Include ${category.code} in estimate`}
        />
      </td>
      <td>
        <input
          type="checkbox"
          checked={billable}
          onChange={(e) => {
            const next = e.target.checked;
            setBillable(next);
            saveMetadata({ billable: next });
          }}
          aria-label={`${category.code} billable`}
        />
      </td>
      <td style={{ textAlign: "left" }}>
        <BudgetEntryControl
          costCode={costCode}
          category={category}
          projectId={projectId}
          hasOriginalEntry={hasOriginalEntry}
          enterOriginalBudget={enterOriginalBudget}
          adjustBudget={adjustBudget}
          onSuccess={() => router.refresh()}
        />
        {metadataError && <div className="sc-estimate-error">{metadataError}</div>}
      </td>
    </tr>
  );
}

function BudgetEntryControl({
  costCode,
  category,
  projectId,
  hasOriginalEntry,
  enterOriginalBudget,
  adjustBudget,
  onSuccess,
}: {
  costCode: CostCode;
  category: CategoryFinancials;
  projectId: string;
  hasOriginalEntry: boolean;
  enterOriginalBudget: EstimateTableProps["enterOriginalBudget"];
  adjustBudget: EstimateTableProps["adjustBudget"];
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function parseDollarsToCents(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return null;
    // Round to nearest cent from a decimal dollar string input, then
    // hand off an already-integer cents value — money.ts's assertInt()
    // is still the final enforcement point on the server side.
    return Math.round(value * 100);
  }

  async function handleEnterOriginal() {
    setError(null);
    const cents = parseDollarsToCents(amount);
    if (cents === null) {
      setError("Enter a valid dollar amount.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await enterOriginalBudget(projectId, costCode.id, cents, note || undefined);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setAmount("");
      setNote("");
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdjust() {
    setError(null);
    const cents = parseDollarsToCents(amount);
    if (cents === null) {
      setError("Enter a valid, non-zero signed dollar amount (e.g. -500 or 1200).");
      return;
    }
    if (!note.trim()) {
      setError("A reason is required for every budget adjustment.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await adjustBudget(projectId, costCode.id, cents, note);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setAmount("");
      setNote("");
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="sc-estimate-btn"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        {hasOriginalEntry ? "Adjust" : "Enter Original"}
      </button>
    );
  }

  return (
    <div className="sc-estimate-inline-form">
      <input
        type="text"
        inputMode="decimal"
        placeholder={hasOriginalEntry ? "+/- amount" : "amount"}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="sc-estimate-input"
        aria-label={hasOriginalEntry ? `Adjustment amount for ${category.code}` : `Original amount for ${category.code}`}
      />
      <input
        type="text"
        placeholder={hasOriginalEntry ? "Reason (required)" : "Note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="sc-estimate-input"
        aria-label={hasOriginalEntry ? `Adjustment reason for ${category.code}` : `Original entry note for ${category.code}`}
      />
      <button
        type="button"
        className="sc-estimate-btn sc-estimate-btn-primary"
        disabled={submitting}
        onClick={hasOriginalEntry ? handleAdjust : handleEnterOriginal}
      >
        {submitting ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        className="sc-estimate-btn"
        disabled={submitting}
        onClick={() => {
          setOpen(false);
          setError(null);
          setAmount("");
          setNote("");
        }}
      >
        Cancel
      </button>
      {error && <div className="sc-estimate-error">{error}</div>}
    </div>
  );
}

const tableStyles = `
.sc-estimate-table { width: 100%; border-collapse: collapse; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; min-width: 900px; }
.sc-estimate-table th { text-align: right; padding: 9px 8px; color: ${colors.stoneDark}; font-weight: 600; font-size: 11px; letter-spacing: 0.03em; text-transform: uppercase; border-bottom: 1px solid ${colors.line}; }
.sc-estimate-table td { padding: 9px 8px; border-bottom: 1px solid ${colors.paperDim}; text-align: right; color: ${colors.ink2}; vertical-align: top; }
.sc-estimate-input { width: 100%; min-width: 90px; padding: 5px 7px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; color: ${colors.ink}; background: ${colors.white}; }
.sc-estimate-btn { padding: 5px 11px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; background: ${colors.white}; color: ${colors.ink2}; font-size: ${typography.sizeSm}; cursor: pointer; margin-right: 6px; }
.sc-estimate-btn-primary { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-estimate-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-estimate-inline-form { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.sc-estimate-inline-form .sc-estimate-input { margin-bottom: 2px; }
.sc-estimate-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; margin-top: 4px; }
`;
