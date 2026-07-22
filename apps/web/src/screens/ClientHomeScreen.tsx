import React from "react";
import { colors, spacing, radius, typography } from "../../../../packages/02-app-shell/src/design/tokens";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { formatCents } from "../../../../packages/01-financial-engine/src/money";
import type { ClientBudgetViewModel } from "../../../../packages/02-app-shell/src/viewmodels/types";
import { ScheduleRail } from "../components/ScheduleRail";
import { Badge } from "../components/Badge";
import { SCHEDULE, UPDATES, CONTACT, SELECTIONS } from "../data/sampleContent";

/**
 * RESTORED to the original prototype's `ClientOverview` — schedule
 * rail, latest update, Stone Column contact card, financial summary
 * (real client-safe figures), and a "needs your attention" list.
 */
export function ClientHomeScreen({ onGoToBudget, clientVM }: { onGoToBudget: () => void; clientVM: ClientBudgetViewModel }) {
  const latestUpdate = UPDATES.filter((u) => u.published)[0];
  const needsAttention = SELECTIONS.filter((s) => s.status === "Client decision required");
  const remaining = clientVM.totals.revisedEstimateCents - clientVM.totals.publishedActualCostCents;
  const firstNames = (projectMeta.clientNames ?? "").split(" & ").map((n) => n.split(" ")[0]).join(" & ");

  return (
    <div className="sc-client-home">
      <h1>Welcome, {firstNames}</h1>
      <p className="sc-client-home-sub">{projectMeta.address}</p>

      <div className="sc-card">
        <div className="sc-card-head-row">
          <span className="sc-section-label">Where things stand</span>
          <Badge tone="gold">Currently: {projectMeta.phase}</Badge>
        </div>
        <ScheduleRail phases={SCHEDULE} />
      </div>

      <div className="sc-grid-2">
        <div className="sc-card">
          <div className="sc-section-label">Latest Update</div>
          {latestUpdate && (
            <>
              <div className="sc-update-title">{latestUpdate.title}</div>
              <div className="sc-update-date">{latestUpdate.date}</div>
              <div className="sc-update-body">{latestUpdate.completed}</div>
            </>
          )}
        </div>
        <div className="sc-card">
          <div className="sc-section-label">Stone Column Contact</div>
          <div className="sc-contact-name">{CONTACT.name}</div>
          <div className="sc-contact-role">{CONTACT.role}</div>
          <div className="sc-contact-detail">{CONTACT.phone}</div>
          <div className="sc-contact-detail">{CONTACT.email}</div>
        </div>
      </div>

      <div className="sc-grid-2">
        <button className="sc-card sc-card--clickable" onClick={onGoToBudget}>
          <div className="sc-section-label">Current Financial Summary</div>
          <StatRow label="Revised estimate" value={formatCents(clientVM.totals.revisedEstimateCents)} hint="Includes approved changes" />
          <StatRow label="Remaining estimated cost" value={formatCents(remaining)} />
        </button>
        <div className="sc-card">
          <div className="sc-section-label">Needs Your Attention</div>
          {needsAttention.length === 0 ? (
            <div className="sc-empty-text">Nothing needs your attention right now.</div>
          ) : (
            needsAttention.map((s) => (
              <div key={s.id} className="sc-attention-row">
                <span>{s.title}</span>
                <Badge tone="brick">Decision needed</Badge>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        .sc-client-home h1 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: ${typography.sizeXl}; margin: 0; color: ${colors.ink}; }
        .sc-client-home-sub { font-size: 13.5px; color: ${colors.ink2}; margin: 6px 0 22px; }
        .sc-card { background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.lg}; padding: 22px; margin-bottom: 18px; }
        .sc-card--clickable { display: block; width: 100%; text-align: left; cursor: pointer; }
        .sc-card-head-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .sc-section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${colors.stoneDark}; margin-bottom: 8px; display: block; }
        .sc-grid-2 { display: grid; grid-template-columns: 1fr; gap: 18px; }
        @media (min-width: 800px) { .sc-grid-2 { grid-template-columns: 1.2fr 1fr; } }
        .sc-update-title { font-family: ${typography.fontFamilyDisplay}; font-size: 17px; color: ${colors.ink}; }
        .sc-update-date { font-size: 11.5px; color: ${colors.stoneDark}; margin-top: 2px; }
        .sc-update-body { font-size: 13px; color: ${colors.ink2}; margin-top: 10px; line-height: 1.55; }
        .sc-contact-name { font-size: 14px; color: ${colors.ink}; font-weight: 600; }
        .sc-contact-role { font-size: 12.5px; color: ${colors.ink2}; margin-top: 2px; }
        .sc-contact-detail { font-size: 12.5px; color: ${colors.ink2}; margin-top: 8px; }
        .sc-empty-text { font-size: 13px; color: ${colors.stoneDark}; }
        .sc-attention-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; color: ${colors.ink}; }
      `}</style>
    </div>
  );
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${colors.paperDim}` }}>
      <div>
        <div style={{ fontSize: "13.5px", color: colors.ink2 }}>{label}</div>
        {hint && <div style={{ fontSize: "11.5px", color: colors.stoneDark, marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ fontWeight: 600, fontSize: "14.5px", color: colors.ink }}>{value}</div>
    </div>
  );
}
