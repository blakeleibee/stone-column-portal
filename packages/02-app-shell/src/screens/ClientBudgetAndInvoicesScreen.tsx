import React from "react";
import { colors, spacing, radius, typography } from "../design/tokens";
import { Card, PageHeader, Badge, Alert } from "../components/ui";
import { formatCents } from "../../../01-financial-engine/src/money";
import { ClientBudgetViewModel } from "../viewmodels/types";
import type { ClientSafeInvoice } from "../data/financialRepository";

/**
 * SEPARATE component and SEPARATE view model from AdminFinancialsScreen
 * — not the same screen with a role flag hiding fields after the fact.
 * Renders exactly `ClientBudgetViewModel`, built by
 * `buildClientBudgetViewModel()` from ONLY client-safe repository
 * methods. There is no fee-accrual number, no reconciliation status, no
 * suggestion list, and no internal category status anywhere in this
 * component's props to accidentally render.
 *
 * VISUAL MODERNIZATION: matches AdminFinancialsScreen.tsx's just-completed
 * treatment — `PageHeader` for the title, the shared `Card`-based
 * SummaryCard tiles (in place of the old plain `sc-summary-card` div) for
 * the real totals row, `Badge` for the invoice status tag, and the shared
 * `Alert` primitive (info tone) for the cost-plus disclosure banner that
 * previously had its own one-off sage-tinted styling. The Invoiced/
 * Payments/Balance StatMini row is left as plain `StatMini` (not a Card),
 * matching AdminFinancialsScreen's own treatment of its analogous
 * Package-4-preview figures. "Projected Final" is still shown as an
 * explicitly-labeled PREVIEW item (text, not a number) rather than either
 * omitting it or fabricating one from internal committed/forecast data
 * that this view model intentionally never receives — see
 * buildClientBudgetViewModel.ts for the full reasoning on why no
 * client-safe projection source exists yet.
 */
export interface ClientBudgetAndInvoicesScreenProps {
  viewModel: ClientBudgetViewModel;
}

/** Purely cosmetic tone mapping for the invoice status `Badge` — the
 *  underlying `status` string is unchanged and still rendered verbatim
 *  (via the same `.replace(/_/g, " ")` as before); this only chooses
 *  which of the shared Badge tones (sage/gold/brick/neutral) best
 *  reflects each status so the badge reads as an at-a-glance signal
 *  rather than a flat neutral pill for every state. */
function invoiceStatusTone(status: ClientSafeInvoice["status"]): "neutral" | "sage" | "gold" | "brick" {
  switch (status) {
    case "paid":
      return "sage";
    case "partially_paid":
      return "gold";
    case "overdue":
      return "brick";
    default:
      return "neutral";
  }
}

export function ClientBudgetAndInvoicesScreen({ viewModel }: ClientBudgetAndInvoicesScreenProps) {
  const { budgetLines, totals, invoices, invoiceSummary } = viewModel;

  return (
    <div className="sc-client-budget-screen">
      <PageHeader title="Budget" />

      <Alert tone="info" className="sc-cost-plus-note">
        This budget is a planning estimate based on the information currently available. For cost-plus work, actual
        job costs are billed according to the construction agreement and may be higher or lower than estimated
        amounts.
      </Alert>

      <div className="sc-summary-cards">
        <SummaryCard label="Revised Estimate" value={formatCents(totals.revisedEstimateCents)} />
        <SummaryCard label="Actual to Date" value={formatCents(totals.publishedActualCostCents)} />
        <SummaryCard
          label="Projected Final"
          value="Preview"
          preview
          note="Available once your contractor publishes a project forecast"
        />
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
                <Badge tone={invoiceStatusTone(inv.status)} className="sc-invoice-status">
                  {inv.status.replace(/_/g, " ")}
                </Badge>
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

      <style dangerouslySetInnerHTML={{ __html: screenStyles }} />
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

/** Same Card-based tile AdminFinancialsScreen.tsx's own (unexported,
 *  file-local) `SummaryCard` renders — duplicated rather than imported
 *  since that component isn't exported from the admin screen (and the
 *  two screens deliberately stay import-independent of one another, see
 *  the file header comment). This version additionally supports the
 *  `preview`/`note` treatment `StatMini` already had, for the
 *  "Projected Final" tile that has no real client-safe value to show. */
function SummaryCard({ label, value, preview, note }: { label: string; value: string; preview?: boolean; note?: string }) {
  return (
    <Card padding="compact" className="sc-summary-card" title={note}>
      <span className="sc-summary-label">{label}</span>
      <span className={`sc-summary-value ${preview ? "sc-summary-value--preview" : ""}`}>{value}</span>
    </Card>
  );
}

const screenStyles = `
.sc-cost-plus-note { margin: 14px 0 20px; }

.sc-stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 18px; background: ${colors.paperDim}; padding: 16px; border-radius: ${radius.lg}; }
.sc-stat-grid--three { grid-template-columns: repeat(1, 1fr); }
.sc-stat-mini { display: flex; flex-direction: column; gap: 3px; }
.sc-stat-mini-label { font-size: 11px; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-stat-mini-value { font-weight: 700; font-size: 19px; color: ${colors.ink}; }
.sc-stat-mini-value--accent { color: ${colors.sageDeep}; }
.sc-stat-mini-value--preview { color: ${colors.stoneDark}; font-style: italic; font-weight: 500; font-size: 13px; }

/* .sc-ui-card (compact padding) supplies SummaryCard's own background/
   border/radius/padding — this rule only adds the internal label+value
   stack layout, matching AdminFinancialsScreen.tsx's identical rule for
   its own Card-based SummaryCard tiles. */
.sc-summary-cards { display: flex; flex-direction: column; gap: ${spacing.sm}; margin-bottom: ${spacing.md}; }
.sc-summary-card { display: flex; flex-direction: column; gap: 4px; }
.sc-summary-label { font-size: 11px; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-summary-value { font-size: ${typography.sizeLg}; font-weight: ${typography.weightSemibold}; color: ${colors.ink}; font-variant-numeric: tabular-nums; }
.sc-summary-value--preview { color: ${colors.stoneDark}; font-style: italic; font-weight: 500; font-size: 15px; }

.sc-financials-section { margin-bottom: ${spacing.lg}; }
.sc-financials-section h2 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: 17px; margin-bottom: ${spacing.sm}; color: ${colors.ink}; }

.sc-client-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; }
.sc-client-table th { text-align: right; padding: ${spacing.sm}; border-bottom: 1px solid ${colors.line}; color: ${colors.stoneDark}; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-client-table td { padding: ${spacing.sm}; border-bottom: 1px solid ${colors.paperDim}; text-align: right; color: ${colors.ink2}; }
.sc-changes-positive { color: ${colors.gold}; }
.sc-muted { color: ${colors.ink2}; }

.sc-empty-note { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }
.sc-invoice-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: ${spacing.xs}; }
.sc-invoice-row { display: flex; gap: ${spacing.md}; align-items: center; padding: ${spacing.sm}; background: ${colors.paperDim}; border-radius: ${radius.sm}; font-size: ${typography.sizeSm}; }

.sc-preview-note { font-size: 11px; color: ${colors.stoneDark}; font-style: italic; margin: -4px 0 8px; }
.sc-doc-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid ${colors.paperDim}; font-size: ${typography.sizeSm}; color: ${colors.ink}; }
.sc-doc-meta { color: ${colors.stoneDark}; font-size: 11.5px; }

@media (min-width: 768px) {
  .sc-summary-cards { flex-direction: row; }
  .sc-summary-card { flex: 1; }
  .sc-stat-grid { grid-template-columns: repeat(3, 1fr); }
  .sc-stat-grid--three { grid-template-columns: repeat(3, 1fr); }
}
`;
