"use client";

/**
 * EmptyState — icon-optional, heading + description + optional action,
 * for empty lists. Replaces every screen's own bare
 * `<p className="sc-projects-empty">`/`sc-team-empty`/`sc-contacts-empty`
 * one-liner with a consistent, more legible empty-list treatment.
 */
import React from "react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={["sc-ui-empty-state", className].filter(Boolean).join(" ")}>
      {icon && (
        <div className="sc-ui-empty-state-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="sc-ui-empty-state-title">{title}</p>
      {description && <p className="sc-ui-empty-state-description">{description}</p>}
      {action && <div className="sc-ui-empty-state-action">{action}</div>}
    </div>
  );
}
