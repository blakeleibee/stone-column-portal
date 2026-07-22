import React from "react";
import { colors, typography } from "../../../../packages/02-app-shell/src/design/tokens";
import { Badge, statusTone } from "../components/Badge";
import { ACTION_ITEMS } from "../data/sampleContent";

export function ActionCenterScreen() {
  const grouped = ["Needs attention today", "Waiting on client", "Waiting on vendor", "Upcoming this week"] as const;
  return (
    <div>
      <h1 style={{ fontFamily: typography.fontFamilyDisplay, fontWeight: 500, fontSize: typography.sizeXl, margin: 0, color: colors.ink }}>Action Center</h1>
      <span className="sc-preview-tag">Preview content — later package</span>
      <p style={{ fontSize: 13, color: colors.ink2, maxWidth: 620, margin: "10px 0 20px", lineHeight: 1.55 }}>
        A single, calm list of everything actionable across projects — deliberately excludes the full activity log.
      </p>
      {grouped.map((section) => {
        const items = ACTION_ITEMS.filter((a) => a.status === section);
        if (items.length === 0) return null;
        return (
          <div key={section} style={{ marginBottom: 18 }}>
            <div className="sc-section-label">{section}</div>
            <div className="sc-card" style={{ padding: 0 }}>
              {items.map((a, i) => (
                <div key={a.action} className="sc-action-row" style={{ borderBottom: i < items.length - 1 ? undefined : "none" }}>
                  <div>
                    <div className="sc-action-title">{a.action}</div>
                    <div className="sc-action-meta">{a.project} · {a.owner} · Due {a.due}</div>
                  </div>
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <style>{`
        .sc-preview-tag { display: inline-block; font-size: 11px; color: ${colors.stoneDark}; background: ${colors.paperDim}; padding: 3px 10px; border-radius: 999px; }
        .sc-section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${colors.stoneDark}; margin-bottom: 8px; }
        .sc-card { background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: 10px; }
        .sc-action-row { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; border-bottom: 1px solid ${colors.paperDim}; }
        .sc-action-title { font-size: 13.5px; color: ${colors.ink}; }
        .sc-action-meta { font-size: 11.5px; color: ${colors.stoneDark}; margin-top: 2px; }
      `}</style>
    </div>
  );
}
