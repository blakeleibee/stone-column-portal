import React from "react";
import { colors, spacing, typography, radius } from "../design/tokens";
import type { CategoryFinancials } from "../../../01-financial-engine/src/types";
import { formatCents } from "../../../01-financial-engine/src/money";

/**
 * RESTORED to the original prototype's exact column set (Cost Code /
 * Original Est. / Approved Changes / Revised Est. / Actual / Remaining
 * Est. / Status) and totals footer row, which the previous version of
 * this file had simplified away.
 *
 * MANDATE #5 still holds: every number rendered is either read directly
 * from the engine's `CategoryFinancials` (already computed by
 * computeAllCategoryFinancials — see AdminFinancialsScreen.tsx, the
 * only caller) or a trivial same-screen subtraction/sum that the
 * original prototype itself displayed the same way ("Remaining Est." =
 * revised − actual; the totals row = a column sum of already-computed
 * per-category numbers). Nothing here re-derives fee, forecast,
 * committed cost, or any figure the engine doesn't already provide —
 * classifyBudgetHealth() below is presentation-only labeling of
 * numbers the engine already computed, not a new financial formula.
 */
export interface BudgetTableProps {
  categories: CategoryFinancials[];
}

export function BudgetTable({ categories }: BudgetTableProps) {
  const totals = categories.reduce(
    (acc, c) => ({
      originalEstimateCents: acc.originalEstimateCents + c.originalEstimateCents,
      approvedChangesCents: acc.approvedChangesCents + c.approvedChangesCents,
      revisedEstimateCents: acc.revisedEstimateCents + c.revisedEstimateCents,
      actualCostCents: acc.actualCostCents + c.actualCostCents,
    }),
    { originalEstimateCents: 0, approvedChangesCents: 0, revisedEstimateCents: 0, actualCostCents: 0 }
  );
  const totalRemaining = totals.revisedEstimateCents - totals.actualCostCents;

  return (
    <div className="sc-budget-table-wrap">
      <table className="sc-budget-table sc-desktop-only">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Cost Code</th>
            <th>Original Est.</th>
            <th>Approved Changes</th>
            <th>Revised Est.</th>
            <th>Actual</th>
            <th>Remaining Est.</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const remaining = c.revisedEstimateCents - c.actualCostCents;
            const health = classifyBudgetHealth(c);
            return (
              <tr key={c.costCodeId}>
                <td style={{ textAlign: "left" }}>{c.code}</td>
                <td>{formatCents(c.originalEstimateCents)}</td>
                <td className={c.approvedChangesCents ? "sc-changes-positive" : "sc-muted"}>
                  {c.approvedChangesCents ? "+" + formatCents(c.approvedChangesCents) : "—"}
                </td>
                <td style={{ fontWeight: typography.weightSemibold }}>{formatCents(c.revisedEstimateCents)}</td>
                <td>{formatCents(c.actualCostCents)}</td>
                <td className={remaining < 0 ? "sc-remaining-negative" : ""}>{formatCents(remaining)}</td>
                <td>
                  <StatusBadge health={health} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ textAlign: "left", fontWeight: typography.weightBold }}>Total</td>
            <td style={{ fontWeight: typography.weightBold }}>{formatCents(totals.originalEstimateCents)}</td>
            <td style={{ fontWeight: typography.weightBold }}>{formatCents(totals.approvedChangesCents)}</td>
            <td style={{ fontWeight: typography.weightBold }}>{formatCents(totals.revisedEstimateCents)}</td>
            <td style={{ fontWeight: typography.weightBold }}>{formatCents(totals.actualCostCents)}</td>
            <td style={{ fontWeight: typography.weightBold }}>{formatCents(totalRemaining)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="sc-budget-cards sc-mobile-only">
        {categories.map((c) => {
          const remaining = c.revisedEstimateCents - c.actualCostCents;
          const health = classifyBudgetHealth(c);
          return (
            <div className="sc-budget-card" key={c.costCodeId}>
              <div className="sc-budget-card-head">
                <span className="sc-budget-card-title">{c.code}</span>
                <StatusBadge health={health} />
              </div>
              <div className="sc-budget-card-row"><span>Original</span><strong>{formatCents(c.originalEstimateCents)}</strong></div>
              <div className="sc-budget-card-row"><span>Approved changes</span><strong>{c.approvedChangesCents ? "+" + formatCents(c.approvedChangesCents) : "—"}</strong></div>
              <div className="sc-budget-card-row"><span>Revised estimate</span><strong>{formatCents(c.revisedEstimateCents)}</strong></div>
              <div className="sc-budget-card-row"><span>Actual</span><strong>{formatCents(c.actualCostCents)}</strong></div>
              <div className="sc-budget-card-row"><span>Remaining est.</span><strong>{formatCents(remaining)}</strong></div>
            </div>
          );
        })}
      </div>

      <style>{tableStyles}</style>
    </div>
  );
}

type BudgetHealth = "complete" | "over" | "on-track" | "not-started";

/** Presentation-only classification (matches the original prototype's
 *  per-category status badges: complete / over / on-track / not-started)
 *  — derived from figures the engine already computed, never a new
 *  calculation. "Over" takes priority since it's the one that needs a
 *  homeowner or PM's attention regardless of lifecycle stage. */
function classifyBudgetHealth(c: CategoryFinancials): BudgetHealth {
  if (c.actualCostCents > c.revisedEstimateCents) return "over";
  if (c.status === "complete" || c.status === "closed") return "complete";
  if (c.actualCostCents === 0 && c.status === "not_started") return "not-started";
  return "on-track";
}

function StatusBadge({ health }: { health: BudgetHealth }) {
  const label = health.replace("-", " ");
  return <span className={`sc-status-badge sc-status-${health}`}>{label}</span>;
}

const tableStyles = `
.sc-budget-table { width: 100%; border-collapse: collapse; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; min-width: 760px; }
.sc-budget-table th { text-align: right; padding: 9px 8px; color: ${colors.stoneDark}; font-weight: 600; font-size: 11px; letter-spacing: 0.03em; text-transform: uppercase; border-bottom: 1px solid ${colors.line}; }
.sc-budget-table td { padding: 9px 8px; border-bottom: 1px solid ${colors.paperDim}; text-align: right; color: ${colors.ink2}; }
.sc-budget-table tfoot td { padding: 11px 8px; border-bottom: none; border-top: 1px solid ${colors.line}; }
.sc-changes-positive { color: ${colors.gold}; }
.sc-muted { color: ${colors.ink2}; }
.sc-remaining-negative { color: ${colors.brick}; }

.sc-status-badge { display: inline-block; padding: 3px 9px; border-radius: ${radius.pill}; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; background: ${colors.paperDim}; color: ${colors.ink2}; }
.sc-status-complete, .sc-status-on-track { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-status-over { background: ${colors.brickTint}; color: ${colors.brick}; }
.sc-status-not-started { background: ${colors.paperDim}; color: ${colors.stoneDark}; }

.sc-budget-cards { display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-budget-card { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.md}; background: ${colors.white}; }
.sc-budget-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: ${spacing.sm}; }
.sc-budget-card-title { font-weight: ${typography.weightSemibold}; color: ${colors.ink}; }
.sc-budget-card-row { display: flex; justify-content: space-between; font-size: ${typography.sizeSm}; padding: 2px 0; color: ${colors.ink2}; }

.sc-desktop-only { display: none; }
.sc-mobile-only { display: block; }
@media (min-width: 768px) {
  .sc-desktop-only { display: table; }
  .sc-mobile-only { display: none; }
}
`;
