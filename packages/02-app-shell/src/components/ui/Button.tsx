"use client";

/**
 * Shared Button primitive (application-wide visual modernization,
 * packages/02-app-shell/src/components/ui/). Replaces every screen's own
 * one-off `-primary`/`-sm`/`-danger` button class suffix
 * (`sc-projects-btn-primary`, `sc-team-btn-danger`, `sc-contact-btn`,
 * etc.) with one component with a real variant/size API.
 *
 * `loading` supports the same pattern every existing screen already uses
 * for a submitting state (`createSubmitting`, `assignSubmitting`,
 * `revokeSubmitting`, ...): pass `loading` + a `loadingText` ("Saving…")
 * and this component disables itself, sets `aria-busy`, and swaps the
 * label — plus renders a small spinner so a loading state is visible
 * even when the caller doesn't override the label. Not wired into any
 * existing screen yet (out of scope for this task — primitives only).
 */
import React from "react";

export type ButtonVariant = "primary" | "secondary" | "destructive";
export type ButtonSize = "default" | "sm";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** True while an async action triggered by this button is in flight.
   *  Disables the button (merged with any caller-supplied `disabled`),
   *  sets `aria-busy`, and renders a spinner. */
  loading?: boolean;
  /** Replaces `children` while `loading` is true (e.g. "Saving…"). If
   *  omitted, `children` stays visible alongside the spinner. */
  loadingText?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "default", loading = false, loadingText, disabled, className, children, type, ...rest },
  ref
) {
  const classes = ["sc-ui-btn", `sc-ui-btn-${variant}`, size === "sm" ? "sc-ui-btn-sm" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="sc-ui-spinner" aria-hidden="true" />}
      <span className="sc-ui-btn-label">{loading && loadingText !== undefined ? loadingText : children}</span>
    </button>
  );
});
