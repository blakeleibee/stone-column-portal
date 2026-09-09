"use client";

/**
 * Shared select primitive — same conventions as TextInput.tsx. Replaces
 * every screen's own `<select className="sc-*-input">` with one
 * component. Options/optgroups are still passed as plain `children`
 * (`<option>` elements) exactly as every existing screen already does —
 * this component only standardizes the wrapper's styling, not the
 * option-list API.
 */
import React from "react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { hasError, className, children, ...rest },
  ref
) {
  const classes = ["sc-ui-select", hasError ? "sc-ui-select-error" : "", className].filter(Boolean).join(" ");
  return (
    <select ref={ref} className={classes} aria-invalid={hasError || undefined} {...rest}>
      {children}
    </select>
  );
});
