"use client";

/**
 * Mounted in AppShell.tsx's persistent header so it's visible on every
 * admin screen (PRODUCT-VISION.md §3, P3-DESIGN.md's UI section). Shows
 * the current project's name/status badge and a dropdown of the
 * caller's other accessible ACTIVE-ish projects, plus links to the full
 * list and the separate archived view, plus an admin-only "+ Create New
 * Project" link.
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
import { colors, spacing, radius, typography, touchTarget } from "../design/tokens";
import type { ProjectRow, ProjectStatus } from "../services/projectService";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On Hold",
  closed_out: "Closed Out",
  archived: "Archived",
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
  /** Re-validates server-side before setting the cookie (Decision 8) —
   *  this component never trusts its own click as the access check. */
  onSwitch: (projectId: string) => Promise<{ id: string } | { error: string }>;
  /** Whether to show the (still UI-only, RPC-enforced) "+ Create New
   *  Project" link. */
  isAdmin: boolean;
  allProjectsHref: string;
  archivedProjectsHref: string;
  createProjectHref: string;
}

export function ProjectSwitcher({
  currentProject,
  otherProjects,
  onSwitch,
  isAdmin,
  allProjectsHref,
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
        {currentProject ? (
          <>
            <span className="sc-switcher-name">{currentProject.name}</span>
            <span className={`sc-switcher-badge sc-switcher-badge-${currentProject.status}`}>
              {STATUS_LABELS[currentProject.status]}
            </span>
          </>
        ) : (
          <span className="sc-switcher-name sc-switcher-empty-label">No project selected</span>
        )}
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
                {currentProject ? "No other active projects." : "No projects yet for this organization."}
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
                  <span className={`sc-switcher-badge sc-switcher-badge-${project.status}`}>
                    {STATUS_LABELS[project.status]}
                  </span>
                </button>
              ))
            )}

            <div className="sc-switcher-footer">
              <a href={allProjectsHref} className="sc-switcher-link">
                All projects
              </a>
              <a href={archivedProjectsHref} className="sc-switcher-link">
                Completed / Archived
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
.sc-switcher-trigger { display: inline-flex; align-items: center; gap: 6px; min-height: ${touchTarget.minSize}; padding: 4px 8px; background: none; border: 1px solid transparent; border-radius: ${radius.sm}; cursor: pointer; max-width: 260px; }
.sc-switcher-trigger:hover { border-color: ${colors.line}; }
.sc-switcher-name { font-size: ${typography.sizeSm}; color: ${colors.ink}; font-weight: ${typography.weightMedium}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
.sc-switcher-empty-label { color: ${colors.stoneDark}; font-weight: ${typography.weightRegular}; }
.sc-switcher-caret { font-size: 10px; color: ${colors.stoneDark}; }

.sc-switcher-backdrop { position: fixed; inset: 0; z-index: 40; background: transparent; }
.sc-switcher-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 41; min-width: 260px; max-width: 320px; max-height: 360px; overflow-y: auto; background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.md}; box-shadow: 0 8px 24px rgba(34,38,43,0.16); padding: ${spacing.xs}; display: flex; flex-direction: column; gap: 2px; }

.sc-switcher-item { display: flex; align-items: center; justify-content: space-between; gap: ${spacing.sm}; width: 100%; text-align: left; padding: 7px 8px; background: none; border: none; border-radius: ${radius.sm}; cursor: pointer; font-family: ${typography.fontFamily}; }
.sc-switcher-item:hover { background: ${colors.paperDim}; }
.sc-switcher-item:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-switcher-item-name { font-size: ${typography.sizeSm}; color: ${colors.ink}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sc-switcher-badge { flex-shrink: 0; display: inline-block; padding: 2px 7px; border-radius: ${radius.pill}; font-size: 10px; font-weight: ${typography.weightMedium}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-switcher-badge-draft { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-switcher-badge-active { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-switcher-badge-on_hold { background: ${colors.goldTint}; color: ${colors.gold}; }
.sc-switcher-badge-closed_out { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-switcher-badge-archived { background: ${colors.brickTint}; color: ${colors.brick}; }

.sc-switcher-empty-msg { margin: 0; padding: 8px; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; }
.sc-switcher-error { margin: 0 0 4px 0; padding: 6px 8px; font-size: ${typography.sizeXs}; color: ${colors.brick}; background: ${colors.brickTint}; border-radius: ${radius.sm}; }

.sc-switcher-footer { border-top: 1px solid ${colors.line}; margin-top: 4px; padding-top: 4px; display: flex; flex-direction: column; }
.sc-switcher-link { padding: 7px 8px; font-size: ${typography.sizeXs}; color: ${colors.ink2}; text-decoration: none; border-radius: ${radius.sm}; }
.sc-switcher-link:hover { background: ${colors.paperDim}; }
.sc-switcher-link-create { color: ${colors.sageDeep}; font-weight: ${typography.weightMedium}; }
`;
