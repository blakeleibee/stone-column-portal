import React from "react";
import { colors, radius } from "../../../../packages/02-app-shell/src/design/tokens";
import { ScheduleRail } from "../components/ScheduleRail";
import { Badge, statusTone } from "../components/Badge";
import { SCHEDULE } from "../data/sampleContent";

/** Client-facing Schedule — same ScheduleRail + phase list as the admin
 *  ProjectWorkspace "Schedule" tab, but with the original prototype's
 *  gold-tinted client disclosure banner instead of the admin intro text. */
export function ScheduleClientTab() {
  return (
    <div>
      <span className="sc-preview-tag">Preview content — later package</span>
      <div className="sc-gold-note">
        Dates are approximate. They may shift due to weather, inspections, material availability, selections, or
        changes to the scope of work.
      </div>
      <div className="sc-card">
        <ScheduleRail phases={SCHEDULE} />
        <div className="sc-phase-grid">
          {SCHEDULE.map((p) => (
            <div key={p.name} className="sc-phase-row">
              <div className="sc-phase-name">{p.name}</div>
              <Badge tone={statusTone(p.status)}>{p.range}</Badge>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        .sc-preview-tag { display: inline-block; font-size: 11px; color: ${colors.stoneDark}; background: ${colors.paperDim}; padding: 3px 10px; border-radius: 999px; margin-bottom: 10px; }
        .sc-gold-note { background: ${colors.goldTint}; border-radius: ${radius.md}; padding: 13px 16px; margin: 4px 0 20px; font-size: 13px; color: ${colors.gold}; line-height: 1.5; }
        .sc-card { background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.lg}; padding: 22px; }
        .sc-phase-grid { margin-top: 22px; display: grid; grid-template-columns: 1fr; gap: 10px; }
        @media (min-width: 700px) { .sc-phase-grid { grid-template-columns: repeat(2, 1fr); } }
        .sc-phase-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; background: ${colors.paperDim}; border-radius: 7px; }
        .sc-phase-name { font-size: 13px; color: ${colors.ink}; }
      `}</style>
    </div>
  );
}
