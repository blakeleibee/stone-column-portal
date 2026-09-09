import React from "react";
import { colors, spacing, radius, typography } from "../design/tokens";
import { BudgetTable } from "../components/BudgetTable";
import { Card, PageHeader, Badge, Alert } from "../components/ui";
import { formatCents } from "../../../01-financial-engine/src/money";
import { AdminFinancialsViewModel } from "../viewmodels/types";
import type { ProjectPhase } from "../services/projectService";

// P3.1 Task 1's own follow-up note (see
// docs/superpowers/plans/2026-08-26-p3.1-project-intake-and-handoff.md,
// Task 1 section): once schema/018 converted `projects.phase` to a real
// `project_phase` enum, this screen's raw `{projectMeta.phase} phase`
// render needed humanizing (e.g. `contract_pending` -> "Contract
// Pending") instead of showing the slug as-is. ProjectBriefWorkspace.tsx
// (Task 5, P3.1's Concept & Scope form) independently defines an
// identical, un-exported `PHASE_LABELS` map — not imported from here
// deliberately: Task 5 is a different in-flight task's file, and this is
// a small enough duplication (one 6-entry lookup table, both matching
// schema/018's `project_phase` enum verbatim) that it's safer to
// duplicate than to add a cross-task edit dependency. Worth unifying
// into one shared constant later (see this task's report).
const PHASE_LABELS: Record<ProjectPhase, string> = {
  lead: "Lead",
  feasibility: "Feasibility",
  preconstruction: "Preconstruction",
  pricing: "Pricing",
  contract_pending: "Contract Pending",
  ready_to_start: "Ready to Start",
};

/** `projectMeta.phase` is a plain optional string (ProjectMeta, not yet
 *  narrowed to ProjectPhase — see financialRepository.ts), so this falls
 *  back to the raw value for anything not in the known enum rather than
 *  rendering nothing. */
function humanizePhase(phase: string | undefined): string | undefined {
  if (!phase) return phase;
  return PHASE_LABELS[phase as ProjectPhase] ?? phase;
}

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
      <PageHeader
        title="Budget & Financials"
        subtitle={`${projectMeta.name} · ${projectMeta.pricingLabel} · ${humanizePhase(projectMeta.phase)} phase`}
      />

      <div className="sc-stat-grid">
        {feeSummary ? (
          <StatMini label="Fee Accrued" value={formatCents(feeSummary.feeAccruedCents)} />
        ) : (
          <StatMini
            label="Fee Accrued"
            value="Not yet determined"
            preview
            note="Pricing not yet determined — set contract terms to see fee figures"
          />
        )}
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
                <Badge tone={suggestion.direction === "over" ? "brick" : "gold"}>{suggestion.confidence}</Badge>
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

function SummaryCard({ label, value, emphasis }: { label: string; value: string; emphasis?: "danger" }) {
  return (
    <Card padding="compact" className={`sc-summary-card ${emphasis ? `sc-summary-card--${emphasis}` : ""}`}>
      <span className="sc-summary-label">{label}</span>
      <span className="sc-summary-value">{value}</span>
    </Card>
  );
}

function ReconciliationPanel({ report }: { report: import("../../../01-financial-engine/src/types").ReconciliationReport }) {
  if (report.ok) {
    return (
      <Alert tone="success" className="sc-reconciliation-banner">
        Financials reconcile to the cent.
      </Alert>
    );
  }
  return (
    <Alert
      tone="error"
      className="sc-reconciliation-banner"
      title={`Reconciliation issue${report.issues.length > 1 ? "s" : ""} detected (${report.issues.length}):`}
    >
      <ul className="sc-reconciliation-issue-list">
        {report.issues.map((issue, i) => (
          <li key={`${issue.scope}-${i}`}>
            <strong>{issue.scope}</strong> — {issue.message} (expected {formatCents(issue.expectedCents)}, got{" "}
            {formatCents(issue.actualCents)})
          </li>
        ))}
      </ul>
    </Alert>
  );
}

const screenStyles = `
.sc-stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 18px; background: ${colors.paperDim}; padding: 16px; border-radius: ${radius.lg}; }
.sc-stat-mini { display: flex; flex-direction: column; gap: 3px; }
.sc-stat-mini-label { font-size: 11px; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-stat-mini-value { font-weight: 700; font-size: 19px; color: ${colors.ink}; }
.sc-stat-mini-value--accent { color: ${colors.sageDeep}; }
.sc-stat-mini-value--preview { color: ${colors.stoneDark}; font-style: italic; font-weight: 500; font-size: 15px; }

/* .sc-ui-card (compact padding) supplies SummaryCard's own background/
   border/radius/padding — this rule only adds the internal label+value
   stack layout and the danger-state border override, neither of which
   the shared Card primitive itself owns an opinion about. */
.sc-summary-cards { display: flex; flex-direction: column; gap: ${spacing.sm}; margin-bottom: ${spacing.md}; }
.sc-summary-card { display: flex; flex-direction: column; gap: 4px; }
.sc-summary-card--danger { border-color: ${colors.brick}; }
.sc-summary-label { font-size: 11px; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.03em; }
.sc-summary-value { font-size: ${typography.sizeLg}; font-weight: ${typography.weightSemibold}; color: ${colors.ink}; font-variant-numeric: tabular-nums; }

/* The reconciliation banner's background/border-radius/padding/font-size
   now come from the shared Alert primitive's info/success/warning/error
   tones — this only adds the bottom margin before the next section. */
.sc-reconciliation-banner { margin-bottom: ${spacing.md}; }
.sc-reconciliation-issue-list { margin: 0; padding-left: 18px; }

.sc-financials-section { margin-bottom: ${spacing.lg}; }
.sc-financials-section h2 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: 17px; margin-bottom: ${spacing.sm}; color: ${colors.ink}; }

.sc-suggestions-note { font-size: 11px; color: ${colors.stoneDark}; margin-bottom: ${spacing.sm}; }
.sc-suggestions-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: ${spacing.xs}; }
.sc-suggestion { display: flex; gap: ${spacing.sm}; align-items: center; font-size: ${typography.sizeSm}; padding: ${spacing.sm}; border-radius: ${radius.sm}; background: ${colors.paperDim}; }

.sc-preview-note { font-size: 11px; color: ${colors.stoneDark}; font-style: italic; margin: -4px 0 8px; }
.sc-doc-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid ${colors.paperDim}; font-size: ${typography.sizeSm}; color: ${colors.ink}; }
.sc-doc-meta { color: ${colors.stoneDark}; font-size: 11.5px; }

@media (min-width: 768px) {
  .sc-summary-cards { flex-direction: row; }
  .sc-summary-card { flex: 1; }
  .sc-stat-grid { grid-template-columns: repeat(4, 1fr); }
}
`;
