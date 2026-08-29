"use client";

/**
 * Mounted in AppShell.tsx's persistent header so it's visible on every
 * admin screen (PRODUCT-VISION.md §3, P3-DESIGN.md's UI section). Shows
 * the current project's name/status badge and a dropdown of the
 * caller's other accessible ACTIVE-ish projects, plus links to the full
 * list and the separate Completed and Archived views, plus an admin-only
 * "+ Create New Project" link.
 *
 * Same convention as EstimateTable.tsx/MappingProfileForm.tsx (the
 * established precedent for package-level Client Components that need a
 * Server Action): the switch mutation (`onSwitch`) and both project
 * arrays are passed in as props from whatever apps/web caller assembled
 * them (AdminChrome, in this task) — this component never imports
 * `next/headers`, a Supabase client, or an apps/web Server Action file
 * directly, so it stays fully decoupled from apps/web's layout.
 *
 * Deliberately does its OWN switching side effects (open/close, loading,
 * inline error) rather than expecting the caller to pre-compute them —
 * this is the "ProjectSwitcher does its own [client-side] fetch/mutate"
 * half of the Task 4 brief's judgment call on how AppShell gets project
 * data; the other half (the actual data FETCH) is owned by the caller
 * (AdminChrome) precisely so this package-level component never needs a
 * Server Action import of its own for reads either.
 */
import React, { useState } from "react";
import { colors, spacing, radius, typography, touchTarget, shadow } from "../design/tokens";
import { StatusBadge } from "./ui/Badge";
import type { BadgeTone } from "./ui/Badge";
import type { ProjectRow, ProjectStatus } from "../services/projectService";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On Hold",
  closed_out: "Closed Out",
  archived: "Archived",
};

// Reuses the shared ui/ Badge tone vocabulary (application-wide visual
// modernization) instead of this component's own bespoke
// `sc-switcher-badge-${status}` color rules — same tone-per-status
// mapping a reader would expect from StatusBadge elsewhere in the app.
const STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  draft: "neutral",
  active: "sage",
  on_hold: "gold",
  closed_out: "neutral",
  archived: "brick",
};

export interface ProjectSwitcherProps {
  /** Null when the caller has zero accessible projects, or while data is
   *  still loading (see AdminChrome's loading state, which simply omits
   *  this whole component rather than passing a placeholder). */
  currentProject: ProjectRow | null;
  /** The caller's other accessible active-ish projects (excludes
   *  currentProject, excludes archived — same "active projects" default
   *  as listAccessibleProjects()'s own default). */
  otherProjects: ProjectRow[];
  /** Whether the org has any archived projects at all, independent of
   *  otherProjects/currentProject (both exclude archived). Lets the
   *  empty-state message distinguish "this org genuinely has zero
   *  projects" from "zero ACTIVE projects, but archived ones exist" —
   *  final-review fix wave, Minor finding 3; the two states used to
   *  render the same "No projects yet" copy. */
  hasArchivedProjects: boolean;
  /** Re-validates server-side before setting the cookie (Decision 8) —
   *  this component never trusts its own click as the access check. */
  onSwitch: (projectId: string) => Promise<{ id: string } | { error: string }>;
  /** Whether to show the (still UI-only, RPC-enforced) "+ Create New
   *  Project" link. */
  isAdmin: boolean;
  allProjectsHref: string;
  /** The distinct `status='closed_out'` view — final-review fix wave,
   *  Important finding 1: this footer used to only link to
   *  archivedProjectsHref under a combined "Completed / Archived" label,
   *  so there was no way to reach /admin/projects?view=completed from
   *  anywhere except navigating there directly. Now a real, separate
   *  destination. */
  completedProjectsHref: string;
  archivedProjectsHref: string;
  createProjectHref: string;
}

export function ProjectSwitcher({
  currentProject,
  otherProjects,
  hasArchivedProjects,
  onSwitch,
  isAdmin,
  allProjectsHref,
  completedProjectsHref,
  archivedProjectsHref,
  createProjectHref,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(projectId: string) {
    if (switching) return;
    setError(null);
    setSwitching(true);
    try {
      const result = await onSwitch(projectId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="sc-switcher">
      <button
        type="button"
        className="sc-switcher-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Labeling fix only (owner-preview polish pass, item 1) — the
            trigger already had real switcher mechanics (caret,
            aria-haspopup, click-to-open dropdown); nothing told a
            first-time viewer that this was a switcher and not just a
            label. This eyebrow doesn't change the mechanism at all. */}
        <span className="sc-switcher-trigger-text">
          <span className="sc-switcher-eyebrow">Current Project</span>
          <span className="sc-switcher-name-line">
            {currentProject ? (
              <>
                <span className="sc-switcher-name">{currentProject.name}</span>
                <StatusBadge
                  className="sc-switcher-badge-fix"
                  label={STATUS_LABELS[currentProject.status]}
                  tone={STATUS_TONE[currentProject.status]}
                />
              </>
            ) : (
              <span className="sc-switcher-name sc-switcher-empty-label">No project selected</span>
            )}
          </span>
        </span>
        <span aria-hidden="true" className="sc-switcher-caret">
          ▾
        </span>
      </button>

      {open && (
        <>
          <div className="sc-switcher-backdrop" onClick={() => setOpen(false)} />
          <div className="sc-switcher-menu" role="menu" aria-label="Switch project">
            {error && <div className="sc-switcher-error">{error}</div>}

            {otherProjects.length === 0 ? (
              <p className="sc-switcher-empty-msg">
                {currentProject
                  ? "No other active projects."
                  : hasArchivedProjects
                    ? "No active projects for this organization — see Completed or Archived below."
                    : "No projects yet for this organization."}
              </p>
            ) : (
              otherProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  role="menuitem"
                  className="sc-switcher-item"
                  disabled={switching}
                  onClick={() => handleSelect(project.id)}
                >
                  <span className="sc-switcher-item-name">{project.name}</span>
                  <StatusBadge
                    className="sc-switcher-badge-fix"
                    label={STATUS_LABELS[project.status]}
                    tone={STATUS_TONE[project.status]}
                  />
                </button>
              ))
            )}

            <div className="sc-switcher-footer">
              <a href={allProjectsHref} className="sc-switcher-link">
                All projects
              </a>
              <a href={completedProjectsHref} className="sc-switcher-link">
                Completed
              </a>
              <a href={archivedProjectsHref} className="sc-switcher-link">
                Archived
              </a>
              {isAdmin && (
                <a href={createProjectHref} className="sc-switcher-link sc-switcher-link-create">
                  + Create New Project
                </a>
              )}
            </div>
          </div>
        </>
      )}
      <style dangerouslySetInnerHTML={{ __html: switcherStyles }} />
    </div>
  );
}

const switcherStyles = `
.sc-switcher { position: relative; }
.sc-switcher-trigger { display: inline-flex; align-items: center; gap: ${spacing.xs}; min-height: ${touchTarget.minSize}; padding: ${spacing.xs} ${spacing.sm}; background: none; border: 1px solid transparent; border-radius: ${radius.sm}; cursor: pointer; max-width: 260px; transition: background-color 0.15s ease, border-color 0.15s ease; }
.sc-switcher-trigger:hover { border-color: ${colors.line}; background: ${colors.paperDim}; }
.sc-switcher-trigger:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: 2px; }
.sc-switcher-trigger-text { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 0; }
.sc-switcher-eyebrow { font-size: 9.5px; font-weight: ${typography.weightSemibold}; letter-spacing: 0.06em; text-transform: uppercase; color: ${colors.stoneDark}; line-height: 1.2; }
.sc-switcher-name-line { display: flex; align-items: center; gap: ${spacing.xs}; min-width: 0; }
.sc-switcher-name { font-size: ${typography.sizeSm}; color: ${colors.ink}; font-weight: ${typography.weightMedium}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
.sc-switcher-empty-label { color: ${colors.stoneDark}; font-weight: ${typography.weightRegular}; }
.sc-switcher-caret { font-size: 10px; color: ${colors.stoneDark}; }

.sc-switcher-backdrop { position: fixed; inset: 0; z-index: 40; background: transparent; }
.sc-switcher-menu { position: absolute; top: calc(100% + ${spacing.xs}); left: 0; z-index: 41; min-width: 260px; max-width: 320px; max-height: 360px; overflow-y: auto; background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.md}; box-shadow: ${shadow.md}; padding: ${spacing.xs}; display: flex; flex-direction: column; gap: 2px; }

.sc-switcher-item { display: flex; align-items: center; justify-content: space-between; gap: ${spacing.sm}; width: 100%; text-align: left; padding: ${spacing.xs} ${spacing.sm}; background: none; border: none; border-radius: ${radius.sm}; cursor: pointer; font-family: ${typography.fontFamily}; transition: background-color 0.15s ease; }
.sc-switcher-item:hover:not(:disabled) { background: ${colors.paperDim}; }
.sc-switcher-item:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: -2px; }
.sc-switcher-item:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-switcher-item-name { font-size: ${typography.sizeSm}; color: ${colors.ink}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Layout-only: the visual tone/shape of the status badge now comes from
   the shared ui/ StatusBadge component (see STATUS_TONE above) — this
   just keeps it from being squeezed by its flex sibling's ellipsis. */
.sc-switcher-badge-fix { flex-shrink: 0; }

.sc-switcher-empty-msg { margin: 0; padding: ${spacing.sm}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; }
.sc-switcher-error { margin: 0 0 ${spacing.xs} 0; padding: ${spacing.xs} ${spacing.sm}; font-size: ${typography.sizeXs}; color: ${colors.brick}; background: ${colors.brickTint}; border-radius: ${radius.sm}; }

.sc-switcher-footer { border-top: 1px solid ${colors.line}; margin-top: ${spacing.xs}; padding-top: ${spacing.xs}; display: flex; flex-direction: column; }
.sc-switcher-link { padding: ${spacing.xs} ${spacing.sm}; font-size: ${typography.sizeXs}; color: ${colors.ink2}; text-decoration: none; border-radius: ${radius.sm}; transition: background-color 0.15s ease; }
.sc-switcher-link:hover { background: ${colors.paperDim}; }
.sc-switcher-link:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: -2px; }
.sc-switcher-link-create { color: ${colors.sageDeep}; font-weight: ${typography.weightMedium}; }
`;
