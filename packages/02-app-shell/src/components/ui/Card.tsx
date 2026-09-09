"use client";

/**
 * Card — a consistent bordered/shadowed container replacing every
 * screen's own one-off card-ish class (`sc-projects-create`,
 * `sc-setup-card`, `sc-projects-contact-summary`, `sc-contacts-add-panel`,
 * etc. — each with its own slightly different border/radius/padding).
 */
import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** "compact" for a tighter inline summary card (e.g. a captured-contact
   *  confirmation), default for a full section container. */
  padding?: "default" | "compact";
}

export function Card({ padding = "default", className, children, ...rest }: CardProps) {
  const classes = ["sc-ui-card", padding === "compact" ? "sc-ui-card-compact" : "", className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
