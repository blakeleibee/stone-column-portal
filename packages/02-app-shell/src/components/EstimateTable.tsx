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
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, typography, radius } from "../design/tokens";
import type { CategoryFinancials, CostCode } from "../../../01-financial-engine/src/types";
import { formatCents } from "../../../01-financial-engine/src/money";

type ActionResult = { error?: string } | void | undefined;

/**
 * Backs each inline-editable metadata field (activityName,
 * scopeDescription, includeInEstimate, billable) with local draft state
 * that ALWAYS ends up reflecting real server state — never a value the
 * server has silently rejected or a value some other session has since
 * overwritten. Two failure modes this exists to close:
 *
 * 1. A failed updateCostCodeMetadata() call must not leave the field
 *    showing the optimistically-applied new value — revertToServerValue()
 *    snaps it back to the last value actually confirmed saved.
 * 2. useState(serverValue) alone only seeds the INITIAL value; React
 *    reuses the same component instance across a router.refresh()
 *    re-render (keyed by the stable costCodeId), so a plain useState
 *    initializer never re-runs when fresh props arrive. The effect below
 *    re-syncs the draft to the incoming prop whenever it changes
 *    server-side (e.g. another session's edit, or server-side
 *    normalization of a just-saved value) — but only when there is no
 *    in-progress, not-yet-saved local edit to protect (i.e. the current
 *    draft still matches the last value we know the server held).
 */
function useServerSyncedField<T>(serverValue: T) {
  const [value, setValue] = useState<T>(serverValue);
  const lastServerValueRef = useRef<T>(serverValue);

  useEffect(() => {
    if (!Object.is(serverValue, lastServerValueRef.current)) {
      setValue((current) => (Object.is(current, lastServerValueRef.current) ? serverValue : current));
      lastServerValueRef.current = serverValue;
    }
  }, [serverValue]);

  function revertToServerValue() {
    setValue(lastServerValueRef.current);
  }

  /** Call after a save the server confirmed succeeded — updates the
   *  "last known good" baseline so the field is no longer considered
   *  dirty relative to it. */
  function markSaved(newValue: T) {
    lastServerValueRef.current = newValue;
  }

  return { value, setValue, revertToServerValue, markSaved } as const;
}

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

  const activityNameField = useServerSyncedField(costCode.activityName ?? "");
  const scopeDescriptionField = useServerSyncedField(costCode.scopeDescription ?? "");
  const includeInEstimateField = useServerSyncedField(costCode.includeInEstimate);
  const billableField = useServerSyncedField(costCode.billable);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  /** Saves one metadata field. On a server-reported error, the field's
   *  draft is reverted to the last confirmed-saved value (never left
   *  showing the optimistically-applied, actually-rejected value) — on
   *  success, the field's baseline is advanced to the new value and a
   *  router.refresh() re-reads real server state for the whole row. */
  async function saveMetadata<T>(
    patch: Parameters<EstimateTableProps["updateCostCodeMetadata"]>[1],
    field: { revertToServerValue: () => void; markSaved: (v: T) => void },
    nextValue: T
  ) {
    setMetadataError(null);
    const result = await updateCostCodeMetadata(costCode.id, patch);
    if (result && "error" in result && result.error) {
      setMetadataError(result.error);
      field.revertToServerValue();
      return;
    }
    field.markSaved(nextValue);
    router.refresh();
  }

  return (
    <tr>
      <td style={{ textAlign: "left", fontWeight: typography.weightSemibold }}>{category.code}</td>
      <td style={{ textAlign: "left" }}>
        <input
          type="text"
          value={activityNameField.value}
          onChange={(e) => activityNameField.setValue(e.target.value)}
          onBlur={() => {
            if (activityNameField.value !== (costCode.activityName ?? "")) {
              saveMetadata({ activityName: activityNameField.value }, activityNameField, activityNameField.value);
            }
          }}
          className="sc-estimate-input"
          aria-label={`Activity name for ${category.code}`}
        />
      </td>
      <td style={{ textAlign: "left" }}>
        <input
          type="text"
          value={scopeDescriptionField.value}
          onChange={(e) => scopeDescriptionField.setValue(e.target.value)}
          onBlur={() => {
            if (scopeDescriptionField.value !== (costCode.scopeDescription ?? "")) {
              saveMetadata(
                { scopeDescription: scopeDescriptionField.value },
                scopeDescriptionField,
                scopeDescriptionField.value
              );
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
          checked={includeInEstimateField.value}
          onChange={(e) => {
            const next = e.target.checked;
            includeInEstimateField.setValue(next);
            saveMetadata({ includeInEstimate: next }, includeInEstimateField, next);
          }}
          aria-label={`Include ${category.code} in estimate`}
        />
      </td>
      <td>
        <input
          type="checkbox"
          checked={billableField.value}
          onChange={(e) => {
            const next = e.target.checked;
            billableField.setValue(next);
            saveMetadata({ billable: next }, billableField, next);
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
