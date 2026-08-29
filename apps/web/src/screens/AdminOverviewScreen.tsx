"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, typography, shadow } from "../../../../packages/02-app-shell/src/design/tokens";
import { formatCents } from "../../../../packages/01-financial-engine/src/money";
import type { Expense } from "../../../../packages/01-financial-engine/src/types";
import type { AdminFinancialsViewModel } from "../../../../packages/02-app-shell/src/viewmodels/types";
import type { ProjectMeta } from "../../../../packages/02-app-shell/src/data/financialRepository";
import { ScheduleRail } from "../components/ScheduleRail";
// `statusTone()` is a plain presentation-only status->tone lookup (never a
// financial calculation) — kept from the prototype-era Badge module per
// its own doc comment, while the actual badge RENDERING below moves to
// the shared `packages/02-app-shell/src/components/ui` Badge/ProgressBar/
// Card/PageHeader primitives (same tone vocabulary: neutral/sage/gold/
// brick/ink) as part of the application-wide visual modernization.
import { statusTone } from "../components/Badge";
import { Badge, Card, PageHeader, ProgressBar } from "../../../../packages/02-app-shell/src/components/ui";
import { SCHEDULE, SELECTIONS } from "../data/sampleContent";
import type { StaffFunction, ProjectPhase } from "../../../../packages/02-app-shell/src/services/projectService";
import type { MyStaffAssignmentSummary, ProjectSetupChecklist } from "../../../../packages/02-app-shell/src/services/projectIntakeService";
import { STAFF_FUNCTION_LABELS, REQUESTED_WORK_LABELS, PRIORITY_LABELS } from "../../../../packages/02-app-shell/src/components/ProjectTeamWorkspace";

// Same duplication judgment call as AdminFinancialsScreen.tsx's own
// PHASE_LABELS (see that file's comment): matches schema/018's
// `project_phase` enum verbatim; not imported from ProjectBriefWorkspace.tsx
// (Task 5, a different in-flight task's file) to avoid a cross-task edit
// dependency on a file this task didn't otherwise need to touch.
const PHASE_LABELS: Record<ProjectPhase, string> = {
  lead: "Lead",
  feasibility: "Feasibility",
  preconstruction: "Preconstruction",
  pricing: "Pricing",
  contract_pending: "Contract Pending",
  ready_to_start: "Ready to Start",
};
function humanizePhase(phase: string | undefined): string | undefined {
  if (!phase) return phase;
  return PHASE_LABELS[phase as ProjectPhase] ?? phase;
}

// The 6 checklist items design §9 treats as real derived-status signals
// (excludes "projectIdentity", always statically complete and not a
// meaningful "received/missing" signal; excludes the "available"/
// "coming_later" kind items, which have no derived status to show here).
const CHECKLIST_SUMMARY_ITEMS: { key: keyof ProjectSetupChecklist; label: string }[] = [
  { key: "homeownersDecisionMakers", label: "Homeowners & decision-makers" },
  { key: "conceptScope", label: "Concept & scope" },
  { key: "propertySiteInfo", label: "Property & site info" },
  { key: "staffResponsibilities", label: "Staff & responsibilities" },
  { key: "permitting", label: "Permitting" },
  { key: "contractPricingTerms", label: "Contract & pricing terms" },
];

/**
 * RESTORED to the original prototype's `AdminOverview` — project card
 * with schedule rail, pending client decisions, budget snapshot (real
 * engine figures), recently imported expenses, and an unpublished-items
 * summary. Financial figures come from the real `AdminFinancialsViewModel`
 * (passed in, already computed by the Package 1 engine); schedule and
 * selections are static sample content (no backend yet — see
 * data/sampleContent.ts's header comment).
 *
 * Task 5 fix round 1: `project`/`expenses` were previously imported
 * directly from the fixture (`fixtures/hawksRidge`), unconditionally, so
 * a real non-demo session still saw the fixture's project card and
 * "Recently Imported" rows even after Task 5 fixed this screen's OWN
 * `loadAdminVM()` fixture bug one layer up. Both are now required props:
 * demo callers pass the fixture's `projectMeta`/`expenses` explicitly
 * (same objects, same visual output); real callers pass the resolved
 * real project and its real expense rows. `project` is typed `ProjectMeta`
 * (the same type `adminVM.projectMeta` already uses) rather than a new
 * bespoke shape — every field on it is optional except id/name/
 * projectNumber, so real sessions that don't have a real value for a
 * given field (e.g. `clientNames`, which has no real data source wired
 * up yet — no project_clients query exists) can simply omit it; the JSX
 * below renders each optional field conditionally rather than printing
 * "undefined" or a stray separator.
 */
/** Task 9 (P3.1 design §8) — bundles everything the "Your assignment"
 *  card needs, resolved server-side in one place
 *  (apps/web/app/admin/overview/page.tsx) and passed down as one prop.
 *  `undefined`/`null` means the current session has no ACTIVE assignment
 *  on the current project (an admin viewing without being personally
 *  assigned is the common case, per the Task 9 brief's own example) —
 *  the card simply doesn't render, not an error state. */
export interface MyAssignmentCardData {
  /** The session's own staff_function (profiles.staff_function) —
   *  nullable because an ADMIN session can also hold a personal
   *  assignment (staff_function is only NOT NULL-enforced for
   *  role='staff', schema/016), and because a "general" staff profile's
   *  own function may simply not carry extra meaning here beyond the
   *  label. */
  staffFunction: StaffFunction | null;
  /** project_briefs.summary — "what the project is," design §8's first
   *  explicit requirement, independent of the assignment row itself. */
  briefSummary: string | null;
  assignment: MyStaffAssignmentSummary;
  /** Task 2's own derived-status computation (getProjectSetupChecklist),
   *  reused verbatim here for the "what's received / what's missing"
   *  summary — never recomputed. */
  checklist: ProjectSetupChecklist;
}

export function AdminOverviewScreen({
  adminVM,
  project,
  expenses,
  myAssignment,
}: {
  adminVM: AdminFinancialsViewModel;
  project: ProjectMeta;
  expenses: Expense[];
  myAssignment?: MyAssignmentCardData | null;
}) {
  const router = useRouter();
  const pendingDecisions = SELECTIONS.filter((s) => s.status === "Client decision required" || s.status === "Submitted for approval");
  const draftExpenseCount = expenses.filter((e) => e.financialStatus === "pending").length;
  // Graceful omission (not "undefined · Cost-Plus 15%") for whichever of
  // these two real sessions don't have — see the component doc comment.
  const projectMetaLine = [project.clientNames, project.pricingLabel].filter(Boolean).join(" · ");

  return (
    <div className="sc-overview">
      <PageHeader title="Overview" />

      {myAssignment && <YourAssignmentCard data={myAssignment} />}

      <div className="sc-overview-grid-2">
        <button type="button" className="sc-project-card sc-ui-card" onClick={() => router.push("/admin/projects")}>
          <div className="sc-project-card-head">
            <div>
              {project.address && <div className="sc-project-address">{project.address}</div>}
              <div className="sc-project-name">{project.name}</div>
              {projectMetaLine && <div className="sc-project-meta">{projectMetaLine}</div>}
            </div>
            <div className="sc-project-badges">
              <Badge tone="sage">Active</Badge>
              {project.phase && <Badge tone="gold">{humanizePhase(project.phase)}</Badge>}
            </div>
          </div>
          <ScheduleRail phases={SCHEDULE} compact />
        </button>

        <Card>
          <div className="sc-section-label">Pending Client Decisions</div>
          {pendingDecisions.map((s) => (
            <div key={s.id} className="sc-list-row">
              <span>{s.title}</span>
              <Badge tone={statusTone(s.status)}>{s.status}</Badge>
            </div>
          ))}
        </Card>
      </div>

      <div className="sc-overview-grid-3">
        <Card>
          <div className="sc-section-label">Budget Snapshot</div>
          <StatRow label="Revised estimate" value={formatCents(adminVM.totals.revisedEstimateCents)} />
          <StatRow label="Actual to date" value={formatCents(adminVM.totals.actualCostCents)} />
          <StatRow label="Projected final" value={formatCents(adminVM.totals.projectedFinalCostCents)} emphasis />
        </Card>
        <Card>
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
        </Card>
        <Card>
          <div className="sc-section-label">Unpublished</div>
          <div className="sc-plain-row">1 draft update</div>
          <div className="sc-plain-row">1 draft document</div>
          <div className="sc-plain-row sc-plain-row--last">{draftExpenseCount} unpublished expenses</div>
        </Card>
      </div>

      {/* dangerouslySetInnerHTML, not <style>{overviewStyles}</style> — the
          same hydration-mismatch class already found and fixed in
          AppShell.tsx and BidPackageWorkspace.tsx: overviewStyles
          interpolates typography.fontFamilyDisplay, which contains literal
          apostrophes ('Fraunces', Georgia), and React's plain-children
          <style> rendering HTML-escapes them on the server while the
          browser's raw-text <style> parsing never decodes them back,
          producing a client/server text mismatch on every hydration. */}
      <style dangerouslySetInnerHTML={{ __html: overviewStyles }} />
    </div>
  );
}

const overviewStyles = `
  .sc-overview-grid-2 { display: grid; grid-template-columns: 1fr; gap: 18px; }
  .sc-overview-grid-3 { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 18px; }
  @media (min-width: 900px) {
    .sc-overview-grid-2 { grid-template-columns: 1.3fr 1fr; }
    .sc-overview-grid-3 { grid-template-columns: repeat(3, 1fr); }
  }

  /* .sc-ui-card (from the shared ui/ stylesheet, injected once via
     AppShell) supplies background/border/radius/shadow/padding/box-sizing
     here — this rule only adds the interactive (button) affordances a
     plain Card <div> doesn't need: pointer cursor, a hover/focus
     treatment, and resetting the button's own default font/border. */
  .sc-project-card { display: block; text-align: left; width: 100%; cursor: pointer; font-family: ${typography.fontFamily}; }
  .sc-project-card:hover { border-color: ${colors.stone}; box-shadow: ${shadow.md}; }
  .sc-project-card:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: 2px; }
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

  /* Your Assignment card — sc-ui-card supplies the container chrome;
     only the margin below it (spacing between this card and the rest of
     the page) is added here. */
  .sc-assignment-card { margin-bottom: 18px; }
  .sc-assignment-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .sc-assignment-title { font-family: ${typography.fontFamilyDisplay}; font-size: 18px; color: ${colors.ink}; margin: 0; }
  .sc-assignment-function { font-size: 12.5px; color: ${colors.stoneDark}; margin-top: 2px; }
  .sc-assignment-summary { font-size: 13px; color: ${colors.ink2}; line-height: 1.5; margin: 0 0 16px 0; }
  .sc-assignment-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: ${spacing.lg}; }
  @media (min-width: 700px) {
    .sc-assignment-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .sc-assignment-field-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${colors.stoneDark}; margin-bottom: 3px; }
  .sc-assignment-field-value { font-size: 13.5px; color: ${colors.ink}; }

  .sc-assignment-progress { margin-bottom: ${spacing.lg}; }

  .sc-assignment-checklist-cols { display: grid; grid-template-columns: 1fr; gap: ${spacing.lg}; border-top: 1px solid ${colors.paperDim}; padding-top: ${spacing.md}; }
  @media (min-width: 600px) {
    .sc-assignment-checklist-cols { grid-template-columns: 1fr 1fr; }
  }
  .sc-assignment-checklist-heading { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${colors.stoneDark}; margin-bottom: ${spacing.xs}; }
  .sc-assignment-badge-row { display: flex; flex-wrap: wrap; gap: ${spacing.xs}; }
  .sc-assignment-checklist-empty { margin: 0; font-size: 12.5px; color: ${colors.stoneDark}; font-style: italic; }
`;

function StatRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${colors.paperDim}` }}>
      <div style={{ fontSize: "13.5px", color: colors.ink2 }}>{label}</div>
      <div style={{ fontWeight: emphasis ? 700 : 600, fontSize: emphasis ? "18px" : "14.5px", color: colors.ink }}>{value}</div>
    </div>
  );
}

/**
 * Task 9 (P3.1 design §8) — every field the design's own explicit list
 * requires: what the project is (briefSummary), the session's own
 * assigned function (staffFunction), and the assignment's own
 * requestedWork/priority/targetDueDate/nextAction/internalInstructions —
 * plus the compact "what's received / what's missing" summary drawn from
 * the checklist's own derived-status data (never recomputed here).
 * Rendered only when the caller (AdminOverviewScreen above) has a
 * non-null `myAssignment` — i.e. only for a session with an ACTIVE
 * assignment on the current project.
 */
function YourAssignmentCard({ data }: { data: MyAssignmentCardData }) {
  const { staffFunction, briefSummary, assignment, checklist } = data;
  const received = CHECKLIST_SUMMARY_ITEMS.filter((item) => {
    const state = checklist[item.key];
    return state.kind === "derived" && state.status === "complete";
  });
  const missing = CHECKLIST_SUMMARY_ITEMS.filter((item) => {
    const state = checklist[item.key];
    return state.kind === "derived" && state.status !== "complete";
  });

  return (
    <Card className="sc-assignment-card">
      <div className="sc-assignment-head">
        <div>
          <h2 className="sc-assignment-title">Your Assignment</h2>
          <div className="sc-assignment-function">{staffFunction ? STAFF_FUNCTION_LABELS[staffFunction] : "Function not set"}</div>
        </div>
        {assignment.priority !== "normal" && (
          <Badge tone={assignment.priority === "urgent" ? "brick" : assignment.priority === "high" ? "gold" : "neutral"}>
            {PRIORITY_LABELS[assignment.priority]} priority
          </Badge>
        )}
      </div>

      <p className="sc-assignment-summary">{briefSummary && briefSummary.trim() ? briefSummary : "No project summary recorded yet."}</p>

      <div className="sc-assignment-grid">
        <div>
          <div className="sc-assignment-field-label">Requested work</div>
          <div className="sc-assignment-field-value">
            {assignment.requestedWork ? REQUESTED_WORK_LABELS[assignment.requestedWork] : "Not yet specified"}
          </div>
        </div>
        <div>
          <div className="sc-assignment-field-label">Target due date</div>
          <div className="sc-assignment-field-value">{assignment.targetDueDate ?? "No due date set"}</div>
        </div>
        <div>
          <div className="sc-assignment-field-label">Next action</div>
          <div className="sc-assignment-field-value">{assignment.nextAction ?? "—"}</div>
        </div>
        <div>
          <div className="sc-assignment-field-label">Internal instructions</div>
          <div className="sc-assignment-field-value">{assignment.internalInstructions ?? "—"}</div>
        </div>
      </div>

      <ProgressBar
        className="sc-assignment-progress"
        value={received.length}
        max={CHECKLIST_SUMMARY_ITEMS.length}
        label={`${received.length} of ${CHECKLIST_SUMMARY_ITEMS.length} setup sections received`}
      />

      <div className="sc-assignment-checklist-cols">
        <div>
          <div className="sc-assignment-checklist-heading">Received</div>
          {received.length > 0 ? (
            <div className="sc-assignment-badge-row">
              {received.map((item) => (
                <Badge key={item.key} tone="sage">
                  {item.label}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="sc-assignment-checklist-empty">Nothing yet</p>
          )}
        </div>
        <div>
          <div className="sc-assignment-checklist-heading">Still needed</div>
          {missing.length > 0 ? (
            <div className="sc-assignment-badge-row">
              {missing.map((item) => (
                <Badge key={item.key} tone="neutral">
                  {item.label}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="sc-assignment-checklist-empty">Nothing outstanding</p>
          )}
        </div>
      </div>
    </Card>
  );
}
