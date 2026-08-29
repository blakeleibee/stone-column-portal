"use client";

/**
 * ProgressBar — for the Setup checklist's overall completion indicator
 * (`ProjectSetupChecklist.tsx`'s `sc-setup-progress`, currently plain
 * text: "N of M sections complete") and the project-list row's
 * setup-progress indicator called for by the modernization plan. Renders
 * the same fraction as text (via `label`, left to the caller so the
 * exact wording stays screen-specific) plus a real visual track/fill.
 */
import React from "react";

export interface ProgressBarProps {
  /** Numerator — e.g. `completedCount`. */
  value: number;
  /** Denominator — e.g. `derivedItems.length`. Defaults to 100 (treats
   *  `value` as a raw percentage) when omitted. */
  max?: number;
  label?: React.ReactNode;
  className?: string;
}

export function ProgressBar({ value, max = 100, label, className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={["sc-ui-progress", className].filter(Boolean).join(" ")}>
      {label && <p className="sc-ui-progress-label">{label}</p>}
      <div className="sc-ui-progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className="sc-ui-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
