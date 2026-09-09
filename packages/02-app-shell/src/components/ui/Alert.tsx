"use client";

/**
 * Alert — info/success/warning/error banner, replacing the various
 * one-off inline `<div className="sc-projects-error">`/
 * `sc-projects-warning`/`sc-team-error`/`sc-contact-error` `<p>`/`<div>`
 * treatments scattered across existing forms (every one of those is
 * currently just brick-colored text with no container, no icon, no
 * `role`). Reuses the existing `info`/`success`/`warning`/`danger` +
 * `*Bg` token aliases already defined in tokens.ts for exactly this
 * purpose.
 */
import React from "react";

export type AlertTone = "info" | "success" | "warning" | "error";

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: AlertTone;
  /** Rendered as a heading inside the alert body — deliberately typed as
   *  `ReactNode`, not restricted to the native `title` attribute's
   *  `string` type (which is why this omits and re-declares `title`
   *  rather than inheriting it from `HTMLAttributes`). */
  title?: React.ReactNode;
}

export function Alert({ tone = "info", title, className, children, ...rest }: AlertProps) {
  const classes = ["sc-ui-alert", `sc-ui-alert-${tone}`, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role={tone === "error" ? "alert" : "status"} {...rest}>
      {title && <p className="sc-ui-alert-title">{title}</p>}
      <div className="sc-ui-alert-body">{children}</div>
    </div>
  );
}
