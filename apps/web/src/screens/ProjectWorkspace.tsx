import React, { useState } from "react";
import { colors, spacing, radius, typography, touchTarget } from "../../../../packages/02-app-shell/src/design/tokens";
import { projectMeta } from "../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { formatCents } from "../../../../packages/01-financial-engine/src/money";
import { AdminFinancialsScreen } from "../../../../packages/02-app-shell/src/screens/AdminFinancialsScreen";
import type { AdminFinancialsViewModel } from "../../../../packages/02-app-shell/src/viewmodels/types";
import { ScheduleRail } from "../components/ScheduleRail";
import { Badge, statusTone, PhotoPlaceholder } from "../components/Badge";
import { SCHEDULE, SELECTIONS, DOCUMENTS, UPDATES, CONVERSATIONS } from "../data/sampleContent";

export type ProjectTab = "overview" | "financials" | "schedule" | "selections" | "documents" | "updates" | "conversations";

const TABS: { key: ProjectTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "financials", label: "Financials" },
  { key: "schedule", label: "Schedule" },
  { key: "selections", label: "Selections" },
  { key: "documents", label: "Documents" },
  { key: "updates", label: "Updates & Photos" },
  { key: "conversations", label: "Conversations" },
];

export function ProjectWorkspace({
  adminViewModel,
  initialTab,
}: {
  adminViewModel: AdminFinancialsViewModel;
  initialTab?: ProjectTab;
}) {
  const [tab, setTab] = useState<ProjectTab>(initialTab ?? "overview");

  return (
    <div className="sc-workspace">
      <header className="sc-workspace-head">
        <h1>{projectMeta.name}</h1>
        <p>{projectMeta.address}</p>
      </header>

      <nav className="sc-workspace-tabs" aria-label="Project sections">
        {TABS.map((t) => (
          <button key={t.key} className="sc-workspace-tab" data-active={tab === t.key} aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="sc-workspace-content">
        {tab === "overview" && <ProjectOverviewTab />}
        {tab === "financials" && <AdminFinancialsScreen viewModel={adminViewModel} />}
        {tab === "schedule" && <ScheduleTab />}
        {tab === "selections" && <SelectionsTab isClient={false} />}
        {tab === "documents" && <DocumentsTab isClient={false} />}
        {tab === "updates" && <UpdatesTab isClient={false} />}
        {tab === "conversations" && <ConversationsTab />}
      </div>

      <style>{`
        .sc-workspace-head h1 { font-family: ${typography.fontFamilyDisplay}; font-weight: 500; font-size: ${typography.sizeXl}; margin: 0; color: ${colors.ink}; }
        .sc-workspace-head p { color: ${colors.stoneDark}; margin: 4px 0 ${spacing.md} 0; font-size: 12.5px; }
        .sc-workspace-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid ${colors.line}; margin-bottom: ${spacing.md}; padding-bottom: 2px; }
        .sc-workspace-tab { flex-shrink: 0; min-height: ${touchTarget.minSize}; padding: 0 ${spacing.sm}; background: none; border: none; border-bottom: 2px solid transparent; color: ${colors.stoneDark}; font-size: 13px; white-space: nowrap; }
        .sc-workspace-tab[data-active="true"] { color: ${colors.ink}; border-bottom-color: ${colors.sage}; font-weight: 600; }
      `}</style>
    </div>
  );
}

function PreviewTag({ label }: { label: string }) {
  return <span className="sc-preview-tag">Preview content — {label}</span>;
}

function ProjectOverviewTab() {
  return (
    <div>
      <PreviewTag label="Package 3" />
      <p className="sc-tab-intro">
        {projectMeta.name} is a custom home project for {projectMeta.clientNames}, currently in the{" "}
        {projectMeta.phase.toLowerCase()} phase under a {projectMeta.pricingLabel.toLowerCase()} agreement. Full scope,
        allowances, and closeout tracking will live on this tab once Package 3 is built.
      </p>
      <div className="sc-card">
        <div className="sc-section-label">Project Summary</div>
        <p className="sc-summary-text">
          A custom home on a wooded ridge lot, featuring a modern-farmhouse exterior, vaulted great room, and a
          detached studio. Currently in framing with dry-in targeted for late summer.
        </p>
      </div>
      <style>{tabSharedStyles}</style>
    </div>
  );
}

function ScheduleTab() {
  return (
    <div>
      <PreviewTag label="later package" />
      <p className="sc-tab-intro">Rough construction schedule by phase. Dates are approximate and may shift with weather, inspections, or selections.</p>
      <div className="sc-card">
        <ScheduleRail phases={SCHEDULE} />
        <div className="sc-phase-grid">
          {SCHEDULE.map((p) => (
            <div key={p.name} className="sc-phase-row">
              <div>
                <div className="sc-phase-name">{p.name}</div>
                <div className="sc-phase-range">{p.range}</div>
              </div>
              <Badge tone={statusTone(p.status)}>{p.status.replace("-", " ")}</Badge>
            </div>
          ))}
        </div>
      </div>
      <style>{tabSharedStyles}</style>
    </div>
  );
}

export function SelectionsTab({ isClient }: { isClient: boolean }) {
  return (
    <div>
      <PreviewTag label="Package 5" />
      {isClient && <p className="sc-tab-intro">Review and approve finish selections for your home.</p>}
      <div className="sc-selections-grid">
        {SELECTIONS.map((s) => {
          const diff = s.priceCents != null ? s.priceCents - s.allowanceCents : null;
          const needsClient = s.status === "Client decision required" || s.status === "Submitted for approval";
          return (
            <div className="sc-card" key={s.id}>
              <div className="sc-selection-head">
                <div>
                  <div className="sc-selection-category">{s.category} · {s.room}</div>
                  <div className="sc-selection-title">{s.title}</div>
                </div>
                <Badge tone={statusTone(s.status)}>{s.status}</Badge>
              </div>
              {isClient && <div className="sc-photo-placeholder-inline"><PhotoPlaceholder /></div>}
              <div className="sc-selection-product">{s.product}</div>
              <div className="sc-selection-figures">
                <span>Allowance: <strong>{formatCents(s.allowanceCents)}</strong></span>
                {s.priceCents != null && (
                  <span>{isClient ? "Selected" : "Price"}: <strong>{formatCents(s.priceCents)}</strong></span>
                )}
                {diff != null && (
                  <span style={{ color: diff > 0 ? colors.brick : colors.sageDeep }}>
                    {isClient ? (diff > 0 ? "Estimated overage" : "Estimated credit") : diff > 0 ? "Over" : "Under"}: {formatCents(Math.abs(diff))}
                  </span>
                )}
              </div>
              {s.note && <div className="sc-selection-note">{s.note}</div>}
              {s.approvedOn ? (
                <div className="sc-selection-approved">Approved by {s.approvedBy} on {s.approvedOn}</div>
              ) : isClient && needsClient ? (
                <button className="sc-btn-primary sc-selection-approve-btn">Review &amp; Approve (preview)</button>
              ) : !isClient ? null : (
                <div className="sc-selection-approved">Awaiting Stone Column</div>
              )}
            </div>
          );
        })}
      </div>
      <style>{tabSharedStyles}</style>
    </div>
  );
}

export function DocumentsTab({ isClient }: { isClient: boolean }) {
  const docs = isClient ? DOCUMENTS.filter((d) => d.visible) : DOCUMENTS;
  return (
    <div>
      <PreviewTag label="later package" />
      <div className="sc-card">
        {docs.map((d, i) => (
          <div key={d.name} className="sc-doc-row" style={{ borderBottom: i < docs.length - 1 ? undefined : "none" }}>
            <div>
              <div className="sc-doc-name">{d.name}</div>
              <div className="sc-doc-meta">{d.category} · {d.date}</div>
            </div>
            {isClient ? (
              <button className="sc-link-btn">Download</button>
            ) : (
              <div className="sc-doc-actions">
                <Badge tone={d.visible ? "sage" : "neutral"}>{d.visible ? "Published" : "Draft"}</Badge>
              </div>
            )}
          </div>
        ))}
      </div>
      <style>{tabSharedStyles}</style>
    </div>
  );
}

export function UpdatesTab({ isClient }: { isClient: boolean }) {
  const updates = isClient ? UPDATES.filter((u) => u.published) : UPDATES;
  return (
    <div>
      <PreviewTag label="later package" />
      {updates.map((u) => (
        <div className="sc-card sc-update-card" key={u.title}>
          <div className="sc-update-head">
            <div>
              <div className="sc-update-title">{u.title}</div>
              <div className="sc-update-date">{u.date}</div>
            </div>
            {!isClient && <Badge tone={u.published ? "sage" : "neutral"}>{u.published ? "Published" : "Draft"}</Badge>}
          </div>
          <div className="sc-photo-grid">
            <PhotoPlaceholder /><PhotoPlaceholder /><PhotoPlaceholder />
          </div>
          <div className="sc-update-body">
            <div><strong>{isClient ? "Completed: " : "Work completed: "}</strong>{u.completed}</div>
            <div style={{ marginTop: 5 }}><strong>{isClient ? "Up next: " : "Planned next: "}</strong>{u.next}</div>
            {!isClient && <div style={{ marginTop: 5 }}><strong>Notes: </strong>{u.concerns}</div>}
          </div>
        </div>
      ))}
      <style>{tabSharedStyles}</style>
    </div>
  );
}

export function ConversationsTab() {
  return (
    <div>
      <PreviewTag label="Package 7" />
      <div className="sc-card" style={{ padding: 0 }}>
        {CONVERSATIONS.map((c, i) => (
          <div key={c.subject} className="sc-thread-row" style={{ borderBottom: i < CONVERSATIONS.length - 1 ? undefined : "none" }}>
            <div className="sc-thread-top">
              <span className="sc-thread-subject">{c.subject}</span>
              <Badge tone={statusTone(c.status)}>{c.status}</Badge>
            </div>
            <div className="sc-thread-meta">{c.topic} · {c.participants}</div>
            <div className="sc-thread-message">{c.lastMessage}</div>
            <div className="sc-thread-date">{c.date}</div>
          </div>
        ))}
      </div>
      <style>{tabSharedStyles}</style>
    </div>
  );
}

const tabSharedStyles = `
.sc-preview-tag { display: inline-block; font-size: 11px; color: ${colors.stoneDark}; background: ${colors.paperDim}; padding: 3px 10px; border-radius: 999px; margin-bottom: 12px; }
.sc-tab-intro { font-size: 13px; color: ${colors.ink2}; max-width: 620px; margin: 0 0 18px; line-height: 1.55; }
.sc-card { background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.lg}; padding: 22px; margin-bottom: 14px; }
.sc-section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${colors.stoneDark}; margin-bottom: 10px; }
.sc-summary-text { font-size: 13px; color: ${colors.ink2}; line-height: 1.6; margin: 0; }

.sc-phase-grid { margin-top: 22px; display: grid; grid-template-columns: 1fr; gap: 10px; }
@media (min-width: 700px) { .sc-phase-grid { grid-template-columns: repeat(3, 1fr); } }
.sc-phase-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; background: ${colors.paperDim}; border-radius: 7px; }
.sc-phase-name { font-size: 13px; color: ${colors.ink}; }
.sc-phase-range { font-size: 11.5px; color: ${colors.stoneDark}; }

.sc-selections-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
@media (min-width: 700px) { .sc-selections-grid { grid-template-columns: repeat(2, 1fr); } }
.sc-selection-head { display: flex; justify-content: space-between; align-items: flex-start; }
.sc-selection-category { font-size: 11px; color: ${colors.stoneDark}; text-transform: uppercase; }
.sc-selection-title { font-family: ${typography.fontFamilyDisplay}; font-size: 17px; color: ${colors.ink}; margin-top: 2px; }
.sc-photo-placeholder-inline { margin: 10px 0; }
.sc-selection-product { font-size: 12.5px; color: ${colors.ink2}; margin-top: 8px; }
.sc-selection-figures { display: flex; gap: 18px; margin-top: 10px; font-size: 12.5px; color: ${colors.ink2}; flex-wrap: wrap; }
.sc-selection-note { font-size: 12px; color: ${colors.stoneDark}; margin-top: 8px; font-style: italic; }
.sc-selection-approved { font-size: 11.5px; color: ${colors.stoneDark}; margin-top: 10px; }
.sc-selection-approve-btn { margin-top: 12px; width: 100%; }
.sc-btn-primary { background: ${colors.sage}; color: ${colors.white}; border: none; border-radius: 7px; padding: 9px 14px; font-size: 12.5px; font-weight: 600; min-height: ${touchTarget.minSize}; }

.sc-doc-row { display: flex; justify-content: space-between; align-items: center; padding: 11px 0; border-bottom: 1px solid ${colors.paperDim}; }
.sc-doc-name { font-size: 13.5px; color: ${colors.ink}; }
.sc-doc-meta { font-size: 11.5px; color: ${colors.stoneDark}; margin-top: 2px; }
.sc-link-btn { background: none; border: none; color: ${colors.sageDeep}; font-size: 12.5px; font-weight: 600; min-height: ${touchTarget.minSize}; }

.sc-update-card { margin-bottom: 14px; }
.sc-update-head { display: flex; justify-content: space-between; align-items: flex-start; }
.sc-update-title { font-family: ${typography.fontFamilyDisplay}; font-size: 18px; color: ${colors.ink}; }
.sc-update-date { font-size: 11.5px; color: ${colors.stoneDark}; margin-top: 2px; }
.sc-photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
.sc-update-body { margin-top: 14px; font-size: 13px; color: ${colors.ink2}; line-height: 1.55; }
.sc-update-body strong { color: ${colors.ink}; }

.sc-thread-row { padding: 14px 16px; border-bottom: 1px solid ${colors.paperDim}; }
.sc-thread-top { display: flex; justify-content: space-between; align-items: center; }
.sc-thread-subject { font-size: 13.5px; font-weight: 600; color: ${colors.ink}; }
.sc-thread-meta { font-size: 11.5px; color: ${colors.stoneDark}; margin-top: 3px; }
.sc-thread-message { font-size: 12.5px; color: ${colors.ink2}; margin-top: 6px; }
.sc-thread-date { font-size: 11px; color: ${colors.stoneDark}; margin-top: 6px; }
`;
