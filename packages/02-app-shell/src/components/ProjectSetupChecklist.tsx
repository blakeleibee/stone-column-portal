"use client";

/**
 * `/admin/projects/[id]/setup` (owner-preview correction round, item 11)
 * — the landing screen right after a project is created. Replaces the
 * old create-project flow's plain "close the form and refresh the list"
 * ending: ProjectListWorkspace.tsx's handleCreateSubmit now switches to
 * the new project and navigates here instead.
 *
 * This is a lightweight progress checklist, not a wizard. "Project
 * identity" is marked done, and "Client and team" is a real, clickable
 * link to `/admin/projects/[id]/team` (Task 6, P3) — both genuinely
 * exist today. Every OTHER step (estimate/budget, cost codes, selections,
 * QuickBooks, schedule, documents) is explicitly, visibly inert ("Coming
 * later"): no link, no button, no click handler. Those steps really
 * don't exist yet as of P3 — they're scoped to later packages
 * (P4.1/P4.3/P4.4/P8/P9 per CLAUDE.md/PRODUCTION-ROADMAP.md).
 *
 * The rule this component follows cuts both ways: never claim a step is
 * available when it isn't (the original brief's concern), and never
 * claim a step is "coming later" when it's actually already shipped and
 * working (the corrected reading here — an earlier draft of this
 * component got that second half backwards and labeled "Client and
 * team" as "Coming later" even though the team-management screen it
 * would point to was fully functional; that was itself a misleading
 * label, just in the opposite direction from the one the brief warned
 * about, so it's fixed here rather than left as a "judgment call").
 */
import React from "react";
import { colors, spacing, radius, typography } from "../design/tokens";

const COMING_LATER_STEPS = [
  "Estimate and budget",
  "Cost codes and project-specific subcategories",
  "Specifications/selections",
  "QuickBooks connection",
  "Schedule",
  "Documents",
];

export interface ProjectSetupChecklistProps {
  projectId: string;
  projectName: string;
  /** Where the prominent "Go to Overview" control sends the user — the
   *  project was already switched-to before this page was reached (see
   *  ProjectListWorkspace.tsx's handleCreateSubmit), so this is a plain
   *  static href, not something this component resolves itself. */
  overviewHref: string;
}

export function ProjectSetupChecklist({ projectId, projectName, overviewHref }: ProjectSetupChecklistProps) {
  return (
    <div className="sc-setup-checklist">
      <div className="sc-setup-card">
        <p className="sc-setup-eyebrow">Project created</p>
        <h2 className="sc-setup-title">{projectName}</h2>
        <p className="sc-setup-intro">
          Here&rsquo;s what&rsquo;s set up so far, and what&rsquo;s coming as this portal grows. You can leave this page
          any time — nothing here needs to be finished before you start working in the project.
        </p>

        <ul className="sc-setup-list">
          <li className="sc-setup-item sc-setup-item-done">
            <span className="sc-setup-check" aria-hidden="true">
              ✓
            </span>
            <span className="sc-setup-item-label">Project identity</span>
            <span className="sc-setup-item-status">Done</span>
          </li>
          {/* Real, working link (Task 6, P3) — not a "Coming later" row.
              See the doc comment at the top of this file for why this one
              step, alone among the seven the owner named, gets its own
              treatment: it's already shipped and functional today, so
              labeling it "Coming later" would be actively misleading in
              the opposite direction from what the brief warned about. */}
          <li className="sc-setup-item sc-setup-item-available">
            <a href={`/admin/projects/${projectId}/team`} className="sc-setup-item-link">
              <span className="sc-setup-check sc-setup-check-available" aria-hidden="true">
                →
              </span>
              <span className="sc-setup-item-label">Client and team</span>
              <span className="sc-setup-item-status sc-setup-item-status-available">Manage team</span>
            </a>
          </li>
          {COMING_LATER_STEPS.map((step) => (
            <li key={step} className="sc-setup-item sc-setup-item-inert" aria-disabled="true">
              <span className="sc-setup-check sc-setup-check-inert" aria-hidden="true">
                ○
              </span>
              <span className="sc-setup-item-label">{step}</span>
              <span className="sc-setup-item-status sc-setup-item-status-inert">Coming later</span>
            </li>
          ))}
        </ul>

        <a href={overviewHref} className="sc-setup-continue">
          Go to Overview
        </a>
      </div>
      <style dangerouslySetInnerHTML={{ __html: setupChecklistStyles }} />
    </div>
  );
}

const setupChecklistStyles = `
.sc-setup-checklist { display: flex; justify-content: center; padding: ${spacing.xl} ${spacing.md}; font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-setup-card { width: 100%; max-width: 560px; background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.lg}; padding: ${spacing.xl} ${spacing.lg}; }
.sc-setup-eyebrow { margin: 0 0 4px 0; font-size: ${typography.sizeXs}; font-weight: ${typography.weightSemibold}; text-transform: uppercase; letter-spacing: 0.04em; color: ${colors.sageDeep}; }
.sc-setup-title { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeXl}; }
.sc-setup-intro { margin: 0 0 ${spacing.lg} 0; color: ${colors.ink2}; font-size: ${typography.sizeSm}; line-height: 1.6; }

.sc-setup-list { list-style: none; margin: 0 0 ${spacing.xl} 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.sc-setup-item { display: flex; align-items: center; gap: ${spacing.sm}; padding: ${spacing.sm} ${spacing.xs}; border-radius: ${radius.sm}; }
.sc-setup-item-done { background: ${colors.sageTint}; }
.sc-setup-check { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px; font-size: 13px; font-weight: ${typography.weightSemibold}; background: ${colors.sage}; color: ${colors.white}; flex-shrink: 0; }
.sc-setup-check-inert { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-setup-item-label { flex: 1; font-size: ${typography.sizeSm}; }
.sc-setup-item-status { font-size: ${typography.sizeXs}; font-weight: ${typography.weightMedium}; color: ${colors.sageDeep}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-setup-item-inert { opacity: 0.72; }
.sc-setup-item-status-inert { color: ${colors.stoneDark}; }

.sc-setup-item-available { padding: 0; background: ${colors.paperDim}; }
.sc-setup-item-link { display: flex; align-items: center; gap: ${spacing.sm}; width: 100%; padding: ${spacing.sm} ${spacing.xs}; border-radius: ${radius.sm}; text-decoration: none; color: inherit; box-sizing: border-box; }
.sc-setup-item-link:hover { background: ${colors.sageTint}; }
.sc-setup-check-available { background: ${colors.sage}; color: ${colors.white}; }
.sc-setup-item-status-available { color: ${colors.sageDeep}; }

.sc-setup-continue { display: inline-block; padding: 10px 20px; border-radius: ${radius.sm}; background: ${colors.sage}; color: ${colors.white}; font-weight: ${typography.weightMedium}; font-size: ${typography.sizeSm}; text-decoration: none; }
.sc-setup-continue:hover { background: ${colors.sageDeep}; }
`;
