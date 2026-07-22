import React from "react";
import { colors, typography } from "../../../../packages/02-app-shell/src/design/tokens";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { Badge } from "../components/Badge";
import { CONTACT } from "../data/sampleContent";

export function ContactsScreen() {
  const clientNames = (projectMeta.clientNames ?? "").split(" & ");
  return (
    <div>
      <h1 style={{ fontFamily: typography.fontFamilyDisplay, fontWeight: 500, fontSize: typography.sizeXl, margin: 0, color: colors.ink }}>Contacts</h1>
      <span className="sc-preview-tag">Preview content — later package</span>
      <div className="sc-card">
        <div className="sc-section-label">Clients</div>
        {clientNames.map((c, i) => (
          <div key={c} className="sc-row" style={{ borderBottom: i < clientNames.length - 1 ? undefined : "none" }}>
            <div>
              <div className="sc-name">{c}</div>
              <div className="sc-meta">{projectMeta.name} · Homeowner</div>
            </div>
            <Badge tone="sage">Active</Badge>
          </div>
        ))}
      </div>
      <div className="sc-card">
        <div className="sc-section-label">Stone Column Team</div>
        <div className="sc-row" style={{ borderBottom: "none" }}>
          <div>
            <div className="sc-name">{CONTACT.name}</div>
            <div className="sc-meta">{CONTACT.role}</div>
          </div>
          <Badge tone="sage">Active</Badge>
        </div>
      </div>
      <style>{`
        .sc-preview-tag { display: inline-block; font-size: 11px; color: ${colors.stoneDark}; background: ${colors.paperDim}; padding: 3px 10px; border-radius: 999px; margin: 8px 0 20px; }
        .sc-card { background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: 10px; padding: 22px; margin-bottom: 14px; }
        .sc-section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${colors.stoneDark}; margin-bottom: 10px; }
        .sc-row { display: flex; justify-content: space-between; align-items: center; padding: 11px 0; border-bottom: 1px solid ${colors.paperDim}; }
        .sc-name { font-size: 13.5px; color: ${colors.ink}; }
        .sc-meta { font-size: 11.5px; color: ${colors.stoneDark}; }
      `}</style>
    </div>
  );
}
