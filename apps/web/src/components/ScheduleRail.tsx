import React from "react";
import { colors } from "../../../../packages/02-app-shell/src/design/tokens";
import type { SchedulePhase } from "../data/sampleContent";

/**
 * Restored from the original prototype's `ScheduleRail` — described in
 * its own source comment as "signature element" of the visual design.
 * Pure presentation of static sample schedule data (no engine, no
 * calculation) — Schedule has no real backend yet (see
 * docs/PACKAGE_02_NOTES.md / IMPLEMENTATION_PLAN.md).
 */
export function ScheduleRail({ phases, compact }: { phases: SchedulePhase[]; compact?: boolean }) {
  const doneCount = phases.filter((p) => p.status === "complete").length;
  const inProgIdx = phases.findIndex((p) => p.status === "in-progress");
  const fillIndex = inProgIdx >= 0 ? inProgIdx : doneCount - 1;
  const fillPct = ((fillIndex + 0.5) / phases.length) * 100;

  const dotColor = (status: SchedulePhase["status"]) => {
    if (status === "complete") return colors.sage;
    if (status === "in-progress") return colors.gold;
    if (status === "delayed") return colors.brick;
    return colors.stone;
  };

  return (
    <div style={{ padding: compact ? "4px 6px 10px" : "10px 6px 6px" }}>
      <div style={{ position: "relative", height: compact ? 38 : 54 }}>
        <div style={{ position: "absolute", top: compact ? 17 : 25, left: 0, right: 0, height: 2, background: colors.line }} />
        <div style={{ position: "absolute", top: compact ? 17 : 25, left: 0, width: `${fillPct}%`, height: 2, background: colors.sage }} />
        <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
          {phases.map((p) => (
            <div key={p.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: `${100 / phases.length}%` }}>
              <div
                title={p.name}
                style={{
                  width: compact ? 9 : 13,
                  height: compact ? 9 : 13,
                  borderRadius: "50%",
                  background: dotColor(p.status),
                  border: `2px solid ${colors.white}`,
                  boxShadow: `0 0 0 1px ${colors.line}`,
                  marginTop: compact ? 11 : 17,
                  zIndex: 1,
                }}
              />
              {!compact && (
                <div style={{ fontSize: "9.5px", color: colors.ink2, textAlign: "center", marginTop: 8, lineHeight: 1.25, maxWidth: 64 }}>
                  {p.name}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
