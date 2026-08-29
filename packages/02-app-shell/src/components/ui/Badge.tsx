"use client";

/**
 * Badge / StatusBadge — a generic badge plus a status-aware variant,
 * reusing the same tone vocabulary (`neutral`/`sage`/`gold`/`brick`/
 * `ink`) already established by `apps/web/src/components/Badge.tsx`
 * (the prototype-era Badge, imported by six `apps/web/src/screens/`
 * files — most preview-only, but not all; see the non-unification note
 * below) and by `ProjectListWorkspace.tsx`'s own inline `StatusBadge`/
 * `sc-projects-badge-*` classes.
 *
 * DELIBERATELY KEPT SEPARATE from `apps/web/src/components/Badge.tsx`,
 * not unified with it:
 *   - Dependency direction, and only this — `apps/web` already depends on
 *     `packages/02-app-shell` (see that file's own cross-package import
 *     of `../design/tokens`). This new `ui/` layer lives IN
 *     `packages/02-app-shell` and must not import anything back from
 *     `apps/web` — doing so would create a circular package dependency.
 *     Moving `apps/web`'s Badge into this package instead would require
 *     updating every one of its consumers' imports, which is a broader
 *     existing-screen edit than this primitives-only task is scoped to
 *     make in one pass.
 *
 *     (`apps/web`'s Badge is NOT only used by "Preview only" screens —
 *     one of its six consumers, `apps/web/src/screens/AdminOverviewScreen.tsx`,
 *     is a real, in-scope, fixture-driven functional screen per the
 *     modernization plan, not a preview-only one. That fact doesn't change
 *     the conclusion above — the dependency-direction argument alone is
 *     sufficient reason to keep these separate regardless of which
 *     screens consume the old one — but AdminOverviewScreen's own Badge
 *     usage will need to be reconciled with this new Badge/StatusBadge
 *     when that screen is migrated to these primitives in a later
 *     phase, not silently left on the old component forever.)
 *   - The two components' status vocabularies don't actually overlap:
 *     `apps/web`'s `statusTone()` maps prototype-era fixture strings
 *     ("Waiting on Stone Column", "Needs attention today", ...) that
 *     don't exist anywhere in the real schema; this package's real
 *     screens key off real enums (`ProjectStatus`,
 *     `ChecklistDerivedStatus`, revoked/active assignment state). A
 *     shared component that only standardizes the TONE names (not the
 *     status-string-to-tone mapping, which stays screen-specific either
 *     way) gains little from forcing the two together.
 *
 * `StatusBadge` takes an explicit `label` (rather than trying to own a
 * status-to-label lookup itself) so each screen's own already-correct
 * status vocabulary (`STATUS_LABELS`, `STATUS_TRANSITIONS`, etc.) stays
 * exactly where it is — this component only standardizes the visual
 * treatment, never the domain mapping.
 */
import React from "react";

export type BadgeTone = "neutral" | "sage" | "gold" | "brick" | "ink";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  const classes = ["sc-ui-badge", `sc-ui-badge-${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

export interface StatusBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  label: React.ReactNode;
  tone?: BadgeTone;
}

/** Same rendering as `Badge`, named/shaped for status use (an explicit
 *  `label` prop instead of `children`) so call sites read clearly at the
 *  point of use: `<StatusBadge label={STATUS_LABELS[status]} tone={...} />`. */
export function StatusBadge({ label, tone = "neutral", className, ...rest }: StatusBadgeProps) {
  return (
    <Badge tone={tone} className={className} {...rest}>
      {label}
    </Badge>
  );
}
