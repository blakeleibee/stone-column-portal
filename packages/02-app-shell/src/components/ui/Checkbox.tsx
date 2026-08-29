"use client";

/**
 * Shared checkbox primitive — replaces every screen's own
 * `sc-projects-checkbox-item`/`sc-contact-checkbox` inline
 * `<label><input type="checkbox">...</label>` pattern with one
 * component. When `label` is supplied, this renders the same
 * "checkbox nested inside its own `<label>`" structure every existing
 * screen already uses (auto-associates without needing a separate `id`/
 * `htmlFor` pair) — still a real, accessible label, just via nesting
 * rather than `htmlFor`, matching this codebase's existing checkbox
 * convention exactly (see ProjectListWorkspace.tsx's
 * `sc-projects-checkbox-inline`/`sc-projects-checkbox-item` and
 * ProjectContactsWorkspace.tsx's `sc-contact-checkbox`).
 */
import React from "react";

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  hasError?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hasError, className, ...rest },
  ref
) {
  const classes = ["sc-ui-checkbox-input", hasError ? "sc-ui-checkbox-input-error" : "", className]
    .filter(Boolean)
    .join(" ");
  const input = <input ref={ref} type="checkbox" className={classes} aria-invalid={hasError || undefined} {...rest} />;

  if (!label) return input;

  return (
    <label className="sc-ui-checkbox">
      {input}
      <span className="sc-ui-checkbox-label">{label}</span>
    </label>
  );
});
