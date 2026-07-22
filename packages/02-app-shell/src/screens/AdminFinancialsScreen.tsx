import React from "react";
import { colors, spacing, radius, typography } from "../design/tokens";
import { BudgetTable } from "../components/BudgetTable";
import { formatCents } from "../../../01-financial-engine/src/money";
import { AdminFinancialsViewModel } from "../viewmodels/types";

/**
 * PRODUCTION SCREEN — imports NO fixture, NO Supabase client, and NO
 * engine calculation function directly (only `formatCents`, pure
 * presentation formatting). Receives a fully-built
 * `AdminFinancialsViewModel` — see viewmodels/buildAdminFinancialsViewModel.ts.
 *
 * VISUAL RESTORATION: the StatMini grid (Fee Accrued / Invoiced /
 * Payments / Balance Due), the sage-toned reconciliation banner, and
 * the overall density match the original Phase 1 prototype's
 * `AdminBudget` page. Invoiced/Payments/Balance figures are clearly
 * marked as preview content (Package 4 doesn't exist yet — there is no
 * real invoice/payment ledger to read them from); only Fee Accrued
 * comes from the real engine today.
 */
export interface AdminFinancialsScreenProps {
  viewModel: AdminFinancialsViewModel;
}

export function AdminFinancialsScreen({ viewModel }: AdminFinancialsScreenProps) {
  const { projectMeta, categories, totals, feeSummary, reconciliation, suggestions } = viewModel;

  return (
    <div className="sc-financials-screen">
      <header className="sc-financials-header">
        <h1>Budget &amp; Financials</h1>
        <p className="sc-financials-sub">
          {projectMeta.name} · {projectMeta.pricingLabel} · {projectMeta.phase} phase
        </p>
      </header>

      <div className="sc-stat-grid">
        <StatMini label="Fee Accrued" value={formatCents(feeSummary.feeAccruedCents)} />
        <StatMini label="Invoiced to Date" value="Preview" preview note="Package 4 — Invoices & Draws" />
        <StatMini label="Payments Received" value="Preview" preview note="Package 4 — Invoices & Draws" />
        <StatMini label="Current Balance Due" value="Preview" preview accent note="Package 4 — Invoices & Draws" />
      </div>

      <div className="sc-summary-cards">
        <SummaryCard label="Revised Estimate" value={formatCents(totals.revisedEstimateCents)} />
        <SummaryCard label="Actual Cost" value={formatCents(totals.actualCostCents)} />
        <SummaryCard label="Committed" value={formatCents(totals.committedCostCents)} />
        <SummaryCard
          label="Projected Final"
          value={formatCents(totals.projectedFinalCostCents)}
          emphasis={totals.projectedFinalCostCents > totals.revisedEstimateCents ? "danger" : undefined}
        />
      </div>

      <ReconciliationPanel report={reconciliation} />

      <section className="sc-financials-section">
        <h2>Budget by Cost Code</h2>
        <BudgetTable categories={categories} />
      </section>

      {suggestions.length > 0 && (
        <section className="sc-financials-section">
          <h2>Suggested Variances</h2>
          <p className="sc-suggestions-note">
            Pending review — none of these are official until an authorized Stone Column user accepts or edits them.
          </p>
          <ul className="sc-suggestions-list">
            {suggestions.map(({ suggestion, key }) => (
              <li key={key} className={`sc-suggestion sc-suggestion-${suggestion.direction}`}>
                <span className="sc-suggestion-badge">{suggestion.confidence}</span>
                <span>{suggestion.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sc-financials-section">
        <h2>Supporting Documentation</h2>
        <p className="sc-preview-note">
          Preview — supporting invoices and receipts will link here from each transaction (Package 4/8). See the
          project's Documents tab for the full document library.
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

function SummaryCard({ label, value, emphasis }: { label: string; value: string; emphasis?: "danger" }) {
  return (
    <div className={`sc-summary-card ${emphasis ? `sc-summary-card--${emphasis}` : ""}`}>
      <span className="sc-summary-label">{label}</span>
      <span className="sc-summary-value">{value}</span>
    </div>
  );
}

function ReconciliationPanel({ report }: { report: import("../../../01-financial-engine/src/types").ReconciliationReport }) {
  if (report.ok) {
    return <div className="sc-reconciliation-banner sc-reconciliation-ok">Financials reconcile to the cent.</div>;
  }
  return (
    <div className="sc-reconciliation-banner sc-reconciliation-bad">
      <p className="sc-reconciliation-headline">
        Reconciliation issue{report.issues.length > 1 ? "s" : ""} detected ({report.issues.length}):
      </p>
      <ul className="sc-reconciliation-issue-list">
        {report.issues.map((issue, i) => (
          <li key={`${issue.scope}-${i}`}>
            <strong>{issue.scope}</strong> — {issue.message} (expected {formatCents(issue.expectedCents)}, got{" "}
            {formatCents(issue.actualCents)})
          </li>
        ))}
      </ul>
    </div>
  );
}

const screenStyles = `
.sc-financials-header h1 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: ${typography.sizeXl}; margin: 0; color: ${colors.ink}; }
.sc-financials-sub { color: ${colors.stoneDark}; margin: 4px 0 ${spacing.lg} 0; font-size: ${typography.sizeSm}; }

.sc-stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 18px; background: ${colors.paperDim}; padding: 16px; border-radius: ${radius.lg}; }
.sc-stat-mini { display: flex; flex-direction: column; gap: 3px; }
.sc-stat-mini-label { font-size: 11px; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-stat-mini-value { font-weight: 700; font-size: 19px; color: ${colors.ink}; }
.sc-stat-mini-value--accent { color: ${colors.sageDeep}; }
.sc-stat-mini-value--preview { color: ${colors.stoneDark}; font-style: italic; font-weight: 500; font-size: 15px; }

.sc-summary-cards { display: flex; flex-direction: column; gap: ${spacing.sm}; margin-bottom: ${spacing.md}; }
.sc-summary-card { background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.md}; display: flex; flex-direction: column; gap: 4px; }
.sc-summary-card--danger { border-color: ${colors.brick}; }
.sc-summary-label { font-size: 11px; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-summary-value { font-size: ${typography.sizeLg}; font-weight: ${typography.weightSemibold}; color: ${colors.ink}; font-variant-numeric: tabular-nums; }

.sc-reconciliation-banner { padding: ${spacing.sm} ${spacing.md}; border-radius: ${radius.sm}; font-size: ${typography.sizeSm}; margin-bottom: ${spacing.md}; }
.sc-reconciliation-ok { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-reconciliation-bad { background: ${colors.brickTint}; color: ${colors.brick}; }
.sc-reconciliation-headline { margin: 0 0 ${spacing.xs} 0; font-weight: ${typography.weightMedium}; }
.sc-reconciliation-issue-list { margin: 0; padding-left: 18px; }

.sc-financials-section { margin-bottom: ${spacing.lg}; }
.sc-financials-section h2 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: 17px; margin-bottom: ${spacing.sm}; color: ${colors.ink}; }

.sc-suggestions-note { font-size: 11px; color: ${colors.stoneDark}; margin-bottom: ${spacing.sm}; }
.sc-suggestions-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: ${spacing.xs}; }
.sc-suggestion { display: flex; gap: ${spacing.sm}; align-items: flex-start; font-size: ${typography.sizeSm}; padding: ${spacing.sm}; border-radius: ${radius.sm}; background: ${colors.paperDim}; }
.sc-suggestion-badge { font-size: 11px; text-transform: uppercase; font-weight: ${typography.weightBold}; color: ${colors.stoneDark}; }

.sc-preview-note { font-size: 11px; color: ${colors.stoneDark}; font-style: italic; margin: -4px 0 8px; }
.sc-doc-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid ${colors.paperDim}; font-size: ${typography.sizeSm}; color: ${colors.ink}; }
.sc-doc-meta { color: ${colors.stoneDark}; font-size: 11.5px; }

@media (min-width: 768px) {
  .sc-summary-cards { flex-direction: row; }
  .sc-summary-card { flex: 1; }
  .sc-stat-grid { grid-template-columns: repeat(4, 1fr); }
}
`;
