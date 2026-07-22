import React from "react";
import { colors, spacing, radius, typography } from "../../../../packages/02-app-shell/src/design/tokens";

export interface PlaceholderScreenProps {
  title: string;
  description: string;
  packageLabel: string; // e.g. "Package 5"
}

/**
 * Polished "not yet built" placeholder for screens outside Package 2's
 * scope (Schedule, Selections, Documents, Updates & Photos,
 * Conversations, Action Center, etc.). Deliberately styled to match the
 * rest of the app (same design tokens as AppShell/BudgetTable) rather
 * than looking like a broken or unstyled page — but the "Preview only"
 * tag is unmissable, so nobody mistakes this for finished functionality.
 */
export function PlaceholderScreen({ title, description, packageLabel }: PlaceholderScreenProps) {
  return (
    <div className="sc-placeholder">
      <div className="sc-placeholder-card">
        <span className="sc-placeholder-tag">Preview only — not yet functional ({packageLabel})</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="sc-placeholder-sketch" aria-hidden="true">
          <div className="sc-placeholder-line" style={{ width: "70%" }} />
          <div className="sc-placeholder-line" style={{ width: "45%" }} />
          <div className="sc-placeholder-line" style={{ width: "60%" }} />
        </div>
      </div>
      <style>{styles}</style>
    </div>
  );
}

const styles = `
.sc-placeholder { display: flex; justify-content: center; padding: ${spacing.lg} 0; }
.sc-placeholder-card { max-width: 480px; width: 100%; background: ${colors.paper}; border: 1px solid ${colors.border}; border-radius: ${radius.lg}; padding: ${spacing.lg}; text-align: center; }
.sc-placeholder-tag { display: inline-block; background: ${colors.infoBg}; color: ${colors.info}; font-size: ${typography.sizeXs}; font-weight: ${typography.weightMedium}; padding: 4px 12px; border-radius: ${radius.pill}; margin-bottom: ${spacing.md}; }
.sc-placeholder-card h1 { font-family: ${typography.fontFamilyDisplay}; font-size: ${typography.sizeLg}; color: ${colors.stone900}; margin: 0 0 ${spacing.sm} 0; }
.sc-placeholder-card p { color: ${colors.stone600}; font-size: ${typography.sizeSm}; margin: 0 0 ${spacing.lg} 0; }
.sc-placeholder-sketch { display: flex; flex-direction: column; gap: ${spacing.sm}; align-items: center; }
.sc-placeholder-line { height: 10px; background: ${colors.stone100}; border-radius: ${radius.sm}; }
`;
