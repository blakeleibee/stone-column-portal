"use client";

/**
 * ChecklistItem — a per-item row for the Setup checklist
 * (`ProjectSetupChecklist.tsx`), matching that component's existing three
 * kinds exactly (see its own header comment for the full contract this
 * mirrors):
 *   - `status="complete"` / any other derived status: a real, clickable
 *     link (`href`) showing a derived status badge.
 *   - `status="available"`: a real, clickable control with NO
 *     completion-status badge (e.g. "Preliminary estimating," which
 *     needs a switch-then-navigate `onClick` instead of a plain href).
 *   - `status="inert"`: genuinely inert — no `href`/`onClick`, real
 *     `aria-disabled="true"`, exactly `ProjectSetupChecklist.tsx`'s
 *     existing "Coming later" treatment.
 *
 * This component only renders an already-computed status; it derives
 * nothing itself (same discipline as `ProjectSetupChecklist.tsx`).
 */
import React from "react";

export type ChecklistItemStatus = "not_started" | "in_progress" | "complete" | "available" | "inert";

// Maps each status to its OWN css class suffix rather than interpolating
// `status` directly into a className template (`sc-ui-checklist-status-
// ${status}`) — a real bug found by this task's own render_smoke.tsx
// regression suite: that direct interpolation put the literal substrings
// "not_started"/"in_progress" into this package's shared stylesheet
// (uiStyles is injected unconditionally by AppShell on every page,
// admin AND client), which collided with render_smoke.tsx's check that
// the CLIENT screen's rendered HTML never contains internal status
// vocabulary like "not_started" — a check that's about to matter for
// real once a future migration phase actually uses this component
// (Setup checklist statuses are admin/staff-facing derived state, never
// meant to leak verbatim into any client-visible output). Decoupling the
// CSS suffix from the raw domain string is also just better practice
// independent of that: this ui/ layer shouldn't hardcode a business
// enum's exact spelling into its own selectors.
const STATUS_CLASS_SUFFIX: Record<ChecklistItemStatus, string> = {
  not_started: "pending",
  in_progress: "inprogress",
  complete: "complete",
  available: "available",
  inert: "inert",
};

export interface ChecklistItemProps {
  label: React.ReactNode;
  status: ChecklistItemStatus;
  /** Rendered text for the trailing status badge (e.g. "Not started" /
   *  "Complete" / "Available" / "Coming later"). Omit entirely for
   *  `status="available"` items with no completion signal to show. */
  statusLabel?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  id?: string;
}

export function ChecklistItem({ label, status, statusLabel, href, onClick, disabled, id }: ChecklistItemProps) {
  const isInert = status === "inert";
  const checkClass =
    status === "complete"
      ? "sc-ui-checklist-check-complete"
      : status === "available"
        ? "sc-ui-checklist-check-available"
        : isInert
          ? "sc-ui-checklist-check-inert"
          : "sc-ui-checklist-check-available";
  const checkGlyph = status === "complete" ? "✓" : isInert ? "○" : "→";

  const content = (
    <>
      <span className={`sc-ui-checklist-check ${checkClass}`} aria-hidden="true">
        {checkGlyph}
      </span>
      <span className="sc-ui-checklist-label">{label}</span>
      {statusLabel && (
        <span className={`sc-ui-checklist-status sc-ui-checklist-status-${STATUS_CLASS_SUFFIX[status]}`}>{statusLabel}</span>
      )}
    </>
  );

  if (isInert) {
    return (
      <li className="sc-ui-checklist-item sc-ui-checklist-item-inert" aria-disabled="true">
        {content}
      </li>
    );
  }

  if (href) {
    return (
      <li className="sc-ui-checklist-item">
        <a href={href} className="sc-ui-checklist-link" id={id}>
          {content}
        </a>
      </li>
    );
  }

  if (onClick) {
    return (
      <li className="sc-ui-checklist-item">
        <button type="button" id={id} className="sc-ui-checklist-link" onClick={onClick} disabled={disabled}>
          {content}
        </button>
      </li>
    );
  }

  // No href/onClick, not inert: a static summary row (e.g. "Project
  // identity" — always complete, no link, matching
  // ProjectSetupChecklist.tsx's own treatment of that one item).
  return <li className="sc-ui-checklist-item">{content}</li>;
}
