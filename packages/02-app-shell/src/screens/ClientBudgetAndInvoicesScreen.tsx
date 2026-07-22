import React from "react";
import { colors, spacing, radius, typography } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import { ClientBudgetViewModel } from "../viewmodels/types";

/**
 * SEPARATE component and SEPARATE view model from AdminFinancialsScreen
 * — not the same screen with a role flag hiding fields after the fact.
 * Renders exactly `ClientBudgetViewModel`, built by
 * `buildClientBudgetViewModel()` from ONLY client-safe repository
 * methods. There is no fee-accrual number, no reconciliation status, no
 * suggestion list, and no internal category status anywhere in this
 * component's props to accidentally render.
 *
 * VISUAL RESTORATION: the sage-tinted cost-plus disclosure banner and
 * StatMini row match the original prototype's `ClientBudget` page.
 * "Projected Final" is shown as an explicitly-labeled PREVIEW item
 * (text, not a number) rather than either omitting it or fabricating
 * one from internal committed/forecast data that this view model
 * intentionally never receives — see buildClientBudgetViewModel.ts for
 * the full reasoning on why no client-safe projection source exists yet.
 */
export interface ClientBudgetAndInvoicesScreenProps {
  viewModel: ClientBudgetViewModel;
}

export function ClientBudgetAndInvoicesScreen({ viewModel }: ClientBudgetAndInvoicesScreenProps) {
  const { budgetLines, totals, invoices, invoiceSummary } = viewModel;

  return (
    <div className="sc-client-budget-screen">
      <header className="sc-client-header">
        <h1>Budget</h1>
      </header>

      <div className="sc-cost-plus-note">
        This budget is a planning estimate based on the information currently available. For cost-plus work, actual
        job costs are billed according to the construction agreement and may be higher or lower than estimated
        amounts.
      </div>

      <div className="sc-stat-grid sc-stat-grid--three">
        <StatMini label="Revised Estimate" value={formatCents(totals.revisedEstimateCents)} />
        <StatMini label="Actual to Date" value={formatCents(totals.publishedActualCostCents)} />
        <StatMini label="Projected Final" value="Preview" preview note="Available once your contractor publishes a project forecast" />
      </div>

      <section className="sc-financials-section">
        <h2>Budget by Cost Code</h2>
        <table className="sc-client-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Cost Code</th>
              <th>Original Est.</th>
              <th>Approved Changes</th>
              <th>Revised Est.</th>
              <th>Actual to Date</th>
            </tr>
          </thead>
          <tbody>
            {budgetLines.map((line) => (
              <tr key={line.costCodeId}>
                <td style={{ textAlign: "left" }}>{line.code}</td>
                <td>{formatCents(line.originalEstimateCents)}</td>
                <td className={line.approvedChangesCents ? "sc-changes-positive" : "sc-muted"}>
                  {line.approvedChangesCents ? "+" + formatCents(line.approvedChangesCents) : "—"}
                </td>
                <td style={{ fontWeight: typography.weightSemibold }}>{formatCents(line.revisedEstimateCents)}</td>
                <td>{formatCents(line.publishedActualCostCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sc-financials-section">
        <h2>Invoices &amp; Payments</h2>
        <div className="sc-stat-grid sc-stat-grid--three">
          <StatMini label="Invoiced to Date" value={invoices.length === 0 ? "—" : formatCents(invoiceSummary.totalInvoicedCents)} />
          <StatMini label="Payments Received" value={invoices.length === 0 ? "—" : formatCents(invoiceSummary.totalPaidCents)} />
          <StatMini label="Balance Due" value={invoices.length === 0 ? "—" : formatCents(invoiceSummary.balanceCents)} accent />
        </div>
        {invoices.length === 0 ? (
          <p className="sc-empty-note">No invoices have been issued yet — Stone Column will publish draws here as they're issued (Package 4).</p>
        ) : (
          <ul className="sc-invoice-list">
            {invoices.map((inv) => (
              <li key={inv.id} className="sc-invoice-row">
                <span>Draw #{inv.drawNumber}</span>
                <span>{formatCents(inv.totalCents)}</span>
                <span className={`sc-invoice-status sc-invoice-status-${inv.status}`}>{inv.status.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sc-financials-section">
        <h2>Supporting Documentation</h2>
        <p className="sc-preview-note">
          Preview — supporting invoices and receipts will link here from each transaction (Package 4/8). See Documents
          for the full document library.
        </p>
      </section>

      <style>{screenStyles}</style>
    </div>
  );
}

function StatMini({ label, value, accent, preview, note }: { label: string; value: string; accent?: boolean; preview?: boolean; note?: string }) {
  return (
    <div className="sc-stat-mini" title={note}>
      <span className="sc-stat-mini-label">{label}</span>
      <span className={`sc-stat-mini-value ${accent ? "sc-stat-mini-value--accent" : ""} ${preview ? "sc-stat-mini-value--preview" : ""}`}>{value}</span>
    </div>
  );
}

const screenStyles = `
.sc-client-header h1 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: ${typography.sizeXl}; margin: 0; color: ${colors.ink}; }

.sc-cost-plus-note { background: ${colors.sageTint}; border: 1px solid ${colors.sage}; border-radius: ${radius.md}; padding: 13px 16px; margin: 14px 0 20px; font-size: ${typography.sizeSm}; color: ${colors.sageDeep}; line-height: 1.5; }

.sc-stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 18px; background: ${colors.paperDim}; padding: 16px; border-radius: ${radius.lg}; }
.sc-stat-grid--three { grid-template-columns: repeat(1, 1fr); }
.sc-stat-mini { display: flex; flex-direction: column; gap: 3px; }
.sc-stat-mini-label { font-size: 11px; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-stat-mini-value { font-weight: 700; font-size: 19px; color: ${colors.ink}; }
.sc-stat-mini-value--accent { color: ${colors.sageDeep}; }
.sc-stat-mini-value--preview { color: ${colors.stoneDark}; font-style: italic; font-weight: 500; font-size: 13px; }

.sc-financials-section { margin-bottom: ${spacing.lg}; }
.sc-financials-section h2 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: 17px; margin-bottom: ${spacing.sm}; color: ${colors.ink}; }

.sc-client-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; }
.sc-client-table th { text-align: right; padding: ${spacing.sm}; border-bottom: 1px solid ${colors.line}; color: ${colors.stoneDark}; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-client-table td { padding: ${spacing.sm}; border-bottom: 1px solid ${colors.paperDim}; text-align: right; color: ${colors.ink2}; }
.sc-changes-positive { color: ${colors.gold}; }
.sc-muted { color: ${colors.ink2}; }

.sc-empty-note { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }
.sc-invoice-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: ${spacing.xs}; }
.sc-invoice-row { display: flex; gap: ${spacing.md}; padding: ${spacing.sm}; background: ${colors.paperDim}; border-radius: ${radius.sm}; font-size: ${typography.sizeSm}; }
.sc-invoice-status { text-transform: capitalize; color: ${colors.stoneDark}; }

.sc-preview-note { font-size: 11px; color: ${colors.stoneDark}; font-style: italic; margin: -4px 0 8px; }
.sc-doc-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid ${colors.paperDim}; font-size: ${typography.sizeSm}; color: ${colors.ink}; }
.sc-doc-meta { color: ${colors.stoneDark}; font-size: 11.5px; }

@media (min-width: 768px) {
  .sc-stat-grid { grid-template-columns: repeat(3, 1fr); }
  .sc-stat-grid--three { grid-template-columns: repeat(3, 1fr); }
}
`;
