"use client";

/**
 * Shared text-input primitive — replaces every screen's own
 * `sc-projects-input`/`sc-team-input`/`sc-contact-field input` etc. with
 * one component with consistent padding/border/radius/hover/focus and a
 * `hasError` prop.
 */
import React from "react";

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Switches the border to a restrained (not alarming) error treatment
   *  using the existing `brick` token — never a separate invented red. */
  hasError?: boolean;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { hasError, className, ...rest },
  ref
) {
  const classes = ["sc-ui-input", hasError ? "sc-ui-input-error" : "", className].filter(Boolean).join(" ");
  return <input ref={ref} className={classes} aria-invalid={hasError || undefined} {...rest} />;
});
