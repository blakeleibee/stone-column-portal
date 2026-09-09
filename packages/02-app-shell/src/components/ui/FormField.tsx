"use client";

/**
 * FormField — wraps a label, a control, an optional hint, and an
 * optional error message with consistent vertical rhythm. This is the
 * component that directly fixes the modernization plan's "do not
 * compress labels, controls, checkboxes, and explanations into inline
 * rows" requirement — every existing screen currently hand-rolls this
 * (`sc-projects-field`/`sc-contact-field`/`sc-handoff-field`, each with
 * its own slightly different label/gap/error styling).
 *
 * Renders a real `<label htmlFor>` associated with the control's id
 * (every existing form in this codebase already does this correctly —
 * this component must not regress it). The control element is cloned to
 * receive that id (generated via `useId()` when neither `htmlFor` nor
 * the child's own `id` is supplied) plus `aria-describedby`/
 * `aria-invalid`/`hasError`, so callers don't have to wire those by hand
 * on every field.
 *
 * `children` must be a single control element whose props satisfy
 * `FormControlProps` (id/hasError/aria-describedby/aria-invalid) — every
 * primitive in this directory (TextInput, Textarea, Select, Checkbox)
 * already does.
 */
import React from "react";

export interface FormControlProps {
  id?: string;
  hasError?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

export interface FormFieldProps<P extends FormControlProps = FormControlProps> {
  label: React.ReactNode;
  /** Explicit control id. When omitted, falls back to the control's own
   *  `id` prop if it already has one, otherwise a generated id. */
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactElement<P>;
  className?: string;
}

export function FormField<P extends FormControlProps>({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: FormFieldProps<P>) {
  const generatedId = React.useId();
  const controlId = htmlFor ?? children.props.id ?? generatedId;
  // hintId only exists when the hint paragraph is actually rendered
  // below (`hint && !error` — error takes precedence and suppresses the
  // hint entirely). Computing it off `hint` alone would put a
  // non-existent element's id into aria-describedby whenever both hint
  // and error are supplied.
  const hintId = hint && !error ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = React.cloneElement(children, {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    hasError: error ? true : children.props.hasError,
  } as Partial<P>);

  return (
    <div className={["sc-ui-field", className].filter(Boolean).join(" ")}>
      <label className="sc-ui-field-label" htmlFor={controlId}>
        {label}
        {required && (
          <span className="sc-ui-field-required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {control}
      {hint && !error && (
        <p className="sc-ui-field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="sc-ui-field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
