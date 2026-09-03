"use client";

/**
 * P5.0 (Project-Context Write-Safety): the "projects exist, but none is
 * explicitly selected yet" state — distinct from NoProjectAccess.tsx's
 * "you don't have access to this specific project" and distinct from a
 * genuinely empty org (see the caller-supplied `projects`/
 * `hasArchivedProjects` branch below, which still renders a plain
 * "no projects" message with no picker when there's truly nothing to
 * pick).
 *
 * Reached only from the seven /admin pages that resolve their project
 * via resolveProjectAndSwitcherData() (overview, financials, estimate,
 * bids, procurement, commitments, import): resolveSelectedProject() now
 * returns `null` whenever there's no explicit, valid selected-project
 * cookie — this used to silently fall back to whichever project sorted
 * first alphabetically (the confirmed root cause of a real incident,
 * P5-EXTENSION-PACKAGES-DESIGN.md §3) — so every one of those pages must
 * now distinguish "nothing to select" from "something to select" rather
 * than showing the same "No projects yet" copy for both.
 *
 * Deliberately reuses the SAME accessible-project list and the SAME
 * `switchProject()` Server Action the header's ProjectSwitcher already
 * uses (never a new selection mechanism) — picking a project here is
 * exactly equivalent to picking it from the switcher dropdown, just
 * surfaced inline in the page body where it can't be missed, since the
 * whole point of this state is that nothing on the page is trustworthy
 * yet.
 */
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { spacing, typography } from "../design/tokens";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { Button } from "./ui/Button";
import type { ProjectRow } from "../services/projectService";

export interface NoProjectSelectedProps {
  /** Every project accessible to the caller (active-ish, same set the
   *  header switcher's dropdown offers) — NOT filtered to exclude a
   *  "current" project, since by definition there isn't one here. */
  projects: ProjectRow[];
  /** Distinguishes "this org genuinely has zero projects" from "zero
   *  active projects, but archived ones exist" when `projects` is empty
   *  — same distinction ProjectSwitcher.tsx's own empty-menu copy
   *  already makes. */
  hasArchivedProjects: boolean;
  /** Re-validates server-side before setting the cookie (Decision 8,
   *  same switchProject() the header ProjectSwitcher calls) — this
   *  component never trusts its own click as the access check. */
  onSelectProject: (projectId: string) => Promise<{ id: string } | { error: string }>;
}

export function NoProjectSelected({ projects, hasArchivedProjects, onSelectProject }: NoProjectSelectedProps) {
  const router = useRouter();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(projectId: string) {
    setError(null);
    setSwitchingId(projectId);
    try {
      const result = await onSelectProject(projectId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // The Server Action above only sets a cookie — it doesn't itself
      // revalidate this route, so an explicit router.refresh() is
      // required to re-run this page's Server Component with the
      // newly-selected project, exactly like AdminChrome's own
      // handleSwitchProject wrapper does for the header ProjectSwitcher.
      // This component calls switchProject() directly (bypassing that
      // wrapper, since it renders inside the page body rather than
      // through AdminChrome), so it performs the same refresh itself.
      router.refresh();
    } finally {
      setSwitchingId(null);
    }
  }

  if (projects.length === 0) {
    return (
      <div className="sc-no-project-selected">
        <Card className="sc-no-project-selected-card">
          <EmptyState
            title={hasArchivedProjects ? "No active projects for this organization" : "No projects yet for this organization"}
            description={
              hasArchivedProjects
                ? "Every project in this organization is archived. Use the project switcher above to view Archived projects."
                : undefined
            }
          />
        </Card>
        <style dangerouslySetInnerHTML={{ __html: noProjectSelectedStyles }} />
      </div>
    );
  }

  return (
    <div className="sc-no-project-selected">
      <Card className="sc-no-project-selected-card">
        <EmptyState
          title="Select a project to continue"
          description="This page shows one project at a time, and none is selected yet. Choose a project below to continue — nothing on this page reflects real data until you do."
          action={
            <div className="sc-no-project-selected-list">
              {error && <p className="sc-no-project-selected-error">{error}</p>}
              {projects.map((project) => (
                <Button
                  key={project.id}
                  type="button"
                  variant="secondary"
                  disabled={switchingId !== null}
                  loading={switchingId === project.id}
                  loadingText="Selecting…"
                  onClick={() => handleSelect(project.id)}
                  className="sc-no-project-selected-item"
                >
                  {project.name}
                </Button>
              ))}
            </div>
          }
        />
      </Card>
      <style dangerouslySetInnerHTML={{ __html: noProjectSelectedStyles }} />
    </div>
  );
}

const noProjectSelectedStyles = `
.sc-no-project-selected { display: flex; justify-content: center; padding: ${spacing.xxl} ${spacing.md}; font-family: ${typography.fontFamily}; }
.sc-no-project-selected-card { max-width: 480px; width: 100%; box-sizing: border-box; }
.sc-no-project-selected-list { display: flex; flex-direction: column; gap: ${spacing.xs}; align-items: stretch; width: 100%; }
.sc-no-project-selected-item { width: 100%; justify-content: center; }
.sc-no-project-selected-error { margin: 0 0 ${spacing.xs} 0; font-size: ${typography.sizeSm}; color: #B3352B; }
`;
