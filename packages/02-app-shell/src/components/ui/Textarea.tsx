"use client";

/**
 * Shared textarea primitive — same conventions as TextInput.tsx.
 * Replaces `sc-projects-textarea`/`sc-team-input` (used on `<textarea>`
 * elsewhere) with one component.
 */
import React from "react";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { hasError, className, ...rest },
  ref
) {
  const classes = ["sc-ui-textarea", hasError ? "sc-ui-textarea-error" : "", className].filter(Boolean).join(" ");
  return <textarea ref={ref} className={classes} aria-invalid={hasError || undefined} {...rest} />;
});
