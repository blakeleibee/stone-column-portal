"use client";

import React from "react";
import { colors, spacing, radius, typography, touchTarget } from "../../../../packages/02-app-shell/src/design/tokens";
import type { AppRole } from "../../../../packages/02-app-shell/src/nav/navigation";

export interface DemoControlsProps {
  role: AppRole;
  onChangeRole: (role: AppRole) => void;
  isPreviewingAsClient: boolean;
  onPreviewAsClient: () => void;
}

export function DemoControls({ role, onChangeRole, isPreviewingAsClient, onPreviewAsClient }: DemoControlsProps) {
  return (
    <div className="sc-demo-controls">
      <span className="sc-demo-label">DEMO CONTROLS — not part of the real sign-in flow</span>
      <div className="sc-demo-row">
        <span className="sc-demo-group-label">View as:</span>
        {(["admin", "staff", "client"] as const).map((r) => (
          <button
            key={r}
            className="sc-demo-btn"
            data-active={!isPreviewingAsClient && role === r}
            onClick={() => onChangeRole(r)}
          >
            {r === "admin" ? "Admin" : r === "staff" ? "Staff" : "Client"}
          </button>
        ))}
        {(role === "admin" || role === "staff") && !isPreviewingAsClient && (
          <button className="sc-demo-btn sc-demo-btn--preview" onClick={onPreviewAsClient}>
            Preview as Client
          </button>
        )}
      </div>
      <style>{styles}</style>
    </div>
  );
}

const styles = `
.sc-demo-controls { background: ${colors.stone900}; color: ${colors.stone100}; padding: ${spacing.sm} ${spacing.md}; display: flex; flex-direction: column; gap: ${spacing.xs}; }
.sc-demo-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${colors.stone400}; }
.sc-demo-row { display: flex; align-items: center; gap: ${spacing.xs}; flex-wrap: wrap; }
.sc-demo-group-label { font-size: ${typography.sizeSm}; color: ${colors.stone400}; margin-right: 4px; }
.sc-demo-btn { min-height: ${touchTarget.minSize}; padding: 0 ${spacing.md}; background: transparent; border: 1px solid ${colors.stone600}; border-radius: ${radius.pill}; color: ${colors.stone100}; font-size: ${typography.sizeSm}; }
.sc-demo-btn[data-active="true"] { background: ${colors.stone100}; color: ${colors.stone900}; border-color: ${colors.stone100}; font-weight: ${typography.weightMedium}; }
.sc-demo-btn--preview { border-color: ${colors.accent}; color: ${colors.stone50}; background: ${colors.accent}; }
`;
