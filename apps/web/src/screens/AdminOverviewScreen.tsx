"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, radius, typography } from "../../../../packages/02-app-shell/src/design/tokens";
import { projectMeta, expenses } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { formatCents } from "../../../../packages/01-financial-engine/src/money";
import type { AdminFinancialsViewModel } from "../../../../packages/02-app-shell/src/viewmodels/types";
import { ScheduleRail } from "../components/ScheduleRail";
import { Badge, statusTone } from "../components/Badge";
import { SCHEDULE, SELECTIONS } from "../data/sampleContent";

/**
 * RESTORED to the original prototype's `AdminOverview` — project card
 * with schedule rail, pending client decisions, budget snapshot (real
 * engine figures), recently imported expenses, and an unpublished-items
 * summary. Financial figures come from the real `AdminFinancialsViewModel`
 * (passed in, already computed by the Package 1 engine); schedule and
 * selections are static sample content (no backend yet — see
 * data/sampleContent.ts's header comment).
 */
export function AdminOverviewScreen({ adminVM }: { adminVM: AdminFinancialsViewModel }) {
  const router = useRouter();
  const pendingDecisions = SELECTIONS.filter((s) => s.status === "Client decision required" || s.status === "Submitted for approval");
  const draftExpenseCount = expenses.filter((e) => e.financialStatus === "pending").length;

  return (
    <div className="sc-overview">
      <div className="sc-overview-head">
        <h1>Overview</h1>
      </div>

      <div className="sc-overview-grid-2">
        <button className="sc-project-card" onClick={() => router.push("/admin/projects")}>
          <div className="sc-project-card-head">
            <div>
              <div className="sc-project-address">{projectMeta.address}</div>
              <div className="sc-project-name">{projectMeta.name}</div>
              <div className="sc-project-meta">
                {projectMeta.clientNames} · {projectMeta.pricingLabel}
              </div>
            </div>
            <div className="sc-project-badges">
              <Badge tone="sage">Active</Badge>
              <Badge tone="gold">{projectMeta.phase}</Badge>
            </div>
          </div>
          <ScheduleRail phases={SCHEDULE} compact />
        </button>

        <div className="sc-card">
          <div className="sc-section-label">Pending Client Decisions</div>
          {pendingDecisions.map((s) => (
            <div key={s.id} className="sc-list-row">
              <span>{s.title}</span>
              <Badge tone={statusTone(s.status)}>{s.status}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="sc-overview-grid-3">
        <div className="sc-card">
          <div className="sc-section-label">Budget Snapshot</div>
          <StatRow label="Revised estimate" value={formatCents(adminVM.totals.revisedEstimateCents)} />
          <StatRow label="Actual to date" value={formatCents(adminVM.totals.actualCostCents)} />
          <StatRow label="Projected final" value={formatCents(adminVM.totals.projectedFinalCostCents)} emphasis />
        </div>
        <div className="sc-card">
          <div className="sc-section-label">Recently Imported</div>
          {expenses.slice(0, 3).map((e) => (
            <div key={e.id} className="sc-imported-row">
              <div className="sc-imported-top">
                <span>{e.vendorName}</span>
                <span>{formatCents(e.amountCents)}</span>
              </div>
              <div className="sc-imported-meta">
                {e.transactionDate} · {e.financialStatus === "posted" ? "Posted" : "Pending"}
              </div>
            </div>
          ))}
        </div>
        <div className="sc-card">
          <div className="sc-section-label">Unpublished</div>
          <div className="sc-plain-row">1 draft update</div>
          <div className="sc-plain-row">1 draft document</div>
          <div className="sc-plain-row sc-plain-row--last">{draftExpenseCount} unpublished expenses</div>
        </div>
      </div>

      <style>{`
        .sc-overview-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 22px; }
        .sc-overview h1 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: ${typography.sizeXl}; margin: 0; color: ${colors.ink}; }

        .sc-overview-grid-2 { display: grid; grid-template-columns: 1fr; gap: 18px; }
        .sc-overview-grid-3 { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 18px; }
        @media (min-width: 900px) {
          .sc-overview-grid-2 { grid-template-columns: 1.3fr 1fr; }
          .sc-overview-grid-3 { grid-template-columns: repeat(3, 1fr); }
        }

        .sc-card { background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.lg}; padding: 22px; }
        .sc-project-card { display: block; text-align: left; width: 100%; background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.lg}; padding: 22px; cursor: pointer; }
        .sc-project-card-head { display: flex; justify-content: space-between; align-items: flex-start; }
        .sc-project-address { font-size: 12px; color: ${colors.stoneDark}; margin-bottom: 4px; }
        .sc-project-name { font-family: ${typography.fontFamilyDisplay}; font-size: 22px; color: ${colors.ink}; }
        .sc-project-meta { font-size: 12.5px; color: ${colors.ink2}; margin-top: 4px; }
        .sc-project-badges { display: flex; gap: 6px; }

        .sc-section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${colors.stoneDark}; margin-bottom: 10px; }
        .sc-list-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid ${colors.paperDim}; font-size: 13px; color: ${colors.ink}; }
        .sc-list-row:last-child { border-bottom: none; }

        .sc-imported-row { font-size: 12.5px; padding: 6px 0; border-bottom: 1px solid ${colors.paperDim}; }
        .sc-imported-top { display: flex; justify-content: space-between; color: ${colors.ink}; }
        .sc-imported-meta { color: ${colors.stoneDark}; font-size: 11px; }

        .sc-plain-row { font-size: 13px; color: ${colors.ink}; padding: 6px 0; border-bottom: 1px solid ${colors.paperDim}; }
        .sc-plain-row--last { border-bottom: none; }
      `}</style>
    </div>
  );
}

function StatRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${colors.paperDim}` }}>
      <div style={{ fontSize: "13.5px", color: colors.ink2 }}>{label}</div>
      <div style={{ fontWeight: emphasis ? 700 : 600, fontSize: emphasis ? "18px" : "14.5px", color: colors.ink }}>{value}</div>
    </div>
  );
}
