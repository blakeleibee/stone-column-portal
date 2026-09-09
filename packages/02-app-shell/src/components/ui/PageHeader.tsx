"use client";

/**
 * PageHeader — title + optional subtitle + a primary-action slot,
 * meant to appear at the top of every real screen for consistent
 * hierarchy (every existing screen currently starts with its own bare
 * `<h2>`, e.g. ProjectListWorkspace.tsx's `sc-projects-header` /
 * ProjectTeamWorkspace.tsx's plain `<h2>{projectName} — Team</h2>`).
 *
 * `children` is an optional slot rendered below the title row — meant
 * for a `Tabs` row (e.g. the Active/Completed/Archived project-list
 * tabs) that belongs visually inside the page header, not a separate
 * standalone block.
 */
import React from "react";

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Primary (and, if the caller composes a `MenuButton` alongside it,
   *  secondary) action(s), right-aligned next to the title. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions, children }: PageHeaderProps) {
  return (
    <div className="sc-ui-page-header">
      <div className="sc-ui-page-header-row">
        <div className="sc-ui-page-header-text">
          <h2 className="sc-ui-page-header-title">{title}</h2>
          {subtitle && <p className="sc-ui-page-header-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="sc-ui-page-header-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
