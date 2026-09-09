"use client";

/**
 * FormGrid — a responsive multi-column layout wrapper for grouping
 * related `FormField`s (e.g. the Create Project panel's "Project
 * identity" section: name + project type side by side on a wide screen).
 * Collapses to a single column at narrow widths (the `breakpoints.sm`
 * token), never a bespoke per-screen media query.
 */
import React from "react";

export interface FormGridProps {
  columns?: 2 | 3;
  children: React.ReactNode;
  className?: string;
}

export function FormGrid({ columns = 2, children, className }: FormGridProps) {
  const classes = ["sc-ui-form-grid", `sc-ui-form-grid-${columns}`, className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}
