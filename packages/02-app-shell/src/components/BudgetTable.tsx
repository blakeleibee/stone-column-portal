import React from "react";
import { colors, spacing, typography, radius, shadow } from "../design/tokens";
import type { CategoryFinancials } from "../../../01-financial-engine/src/types";
import { formatCents } from "../../../01-financial-engine/src/money";
import { Badge, type BadgeTone } from "./ui";

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
      <div className="sc-budget-table-scroll sc-desktop-only">
      <table className="sc-budget-table">
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
      </div>

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

      <style dangerouslySetInnerHTML={{ __html: tableStyles }} />
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

const HEALTH_TONE: Record<BudgetHealth, BadgeTone> = {
  complete: "sage",
  "on-track": "sage",
  over: "brick",
  "not-started": "neutral",
};

function StatusBadge({ health }: { health: BudgetHealth }) {
  const label = health.replace("-", " ");
  return <Badge tone={HEALTH_TONE[health]}>{label}</Badge>;
}

const tableStyles = `
/* The bordered/shadowed "card" treatment wraps only the actual table
   (not the mobile card list below it, which already has its own
   per-card border) — a separate inner div rather than styling the
   <table> element directly, since border-radius doesn't clip cleanly
   through a collapsed-border table's own cell borders. overflow-x
   lets a wide table scroll horizontally on its own instead of
   widening the page. */
.sc-budget-table-scroll { border: 1px solid ${colors.line}; border-radius: ${radius.lg}; overflow-x: auto; overflow-y: hidden; background: ${colors.white}; box-shadow: ${shadow.sm}; }
.sc-budget-table { width: 100%; border-collapse: collapse; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; min-width: 760px; }
.sc-budget-table thead th { text-align: right; padding: ${spacing.sm} ${spacing.sm}; color: ${colors.stoneDark}; font-weight: 600; font-size: 11px; letter-spacing: 0.03em; text-transform: uppercase; border-bottom: 1px solid ${colors.line}; background: ${colors.paperDim}; }
.sc-budget-table td { padding: ${spacing.sm} ${spacing.sm}; border-bottom: 1px solid ${colors.paperDim}; text-align: right; color: ${colors.ink2}; }
.sc-budget-table tbody tr:last-child td { border-bottom: none; }
.sc-budget-table tbody tr:hover td { background: ${colors.paperDim}; }
.sc-budget-table tfoot td { padding: ${spacing.sm} ${spacing.sm}; border-bottom: none; border-top: 1px solid ${colors.line}; background: ${colors.paperDim}; }
.sc-changes-positive { color: ${colors.gold}; }
.sc-muted { color: ${colors.ink2}; }
.sc-remaining-negative { color: ${colors.brick}; }

.sc-budget-cards { display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-budget-card { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.md}; background: ${colors.white}; box-shadow: ${shadow.sm}; }
.sc-budget-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: ${spacing.sm}; }
.sc-budget-card-title { font-weight: ${typography.weightSemibold}; color: ${colors.ink}; }
.sc-budget-card-row { display: flex; justify-content: space-between; font-size: ${typography.sizeSm}; padding: 2px 0; color: ${colors.ink2}; }

.sc-desktop-only { display: none; }
.sc-mobile-only { display: block; }
@media (min-width: 768px) {
  .sc-desktop-only { display: block; }
  .sc-mobile-only { display: none; }
}
`;
