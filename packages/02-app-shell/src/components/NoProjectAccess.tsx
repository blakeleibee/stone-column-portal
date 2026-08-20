"use client";

/**
 * The single, shared "you don't have access to this project" state
 * (P3-DESIGN.md Decision 10). Deliberately generic and reusable — Task 4
 * (`/admin/projects?project=<id>`'s deep-link check) and Task 6
 * (`/admin/projects/[id]/team`, when the route's project id isn't in the
 * caller's accessible list) both render this exact component. Task 5's
 * five rewired pages (overview/financials/estimate/bids/import) do NOT
 * render this — corrected here during the final-review fix wave, which
 * found this comment's earlier claim to the contrary; those pages use
 * `resolveSelectedProject()`'s own null-means-"zero accessible
 * projects" contract and render a plain "No projects yet for this
 * organization" fallback instead, since a null selected project there
 * means the org has no accessible projects at all, not a specific
 * named-but-inaccessible one.
 *
 * Per Decision 10, when this component IS rendered, its three possible
 * causes (nonexistent, wrong-org, revoked) are deliberately NOT
 * distinguished in the copy shown (RLS already returns zero rows
 * identically for all three — surfacing which one it was would leak
 * information about resources the caller can't see).
 *
 * Kept a plain, small prop interface on purpose (no dependency on any
 * particular route's data shape) so a future caller only ever needs to
 * supply where "back to my projects" should point.
 */
import React from "react";
import { colors, spacing, radius, typography } from "../design/tokens";

export interface NoProjectAccessProps {
  /** Link back to the current user's own real accessible-project list
   *  (e.g. "/admin/projects"). Always required — this page is never a
   *  dead end. */
  backHref: string;
  /** Optional override for the explanatory copy; defaults to the
   *  deliberately non-specific Decision 10 message. */
  message?: string;
  /** Optional label for the back link; defaults to "Back to your projects". */
  backLabel?: string;
}

export function NoProjectAccess({ backHref, message, backLabel }: NoProjectAccessProps) {
  return (
    <div className="sc-no-access">
      <div className="sc-no-access-card">
        <h2 className="sc-no-access-title">You don&rsquo;t have access to this project</h2>
        <p className="sc-no-access-body">
          {message ??
            "This project doesn't exist, or you no longer have access to it. If you believe this is a mistake, contact your administrator."}
        </p>
        <a href={backHref} className="sc-no-access-link">
          {backLabel ?? "Back to your projects"}
        </a>
      </div>
      <style dangerouslySetInnerHTML={{ __html: noAccessStyles }} />
    </div>
  );
}

const noAccessStyles = `
.sc-no-access { display: flex; justify-content: center; padding: ${spacing.xxl} ${spacing.md}; font-family: ${typography.fontFamily}; }
.sc-no-access-card { max-width: 420px; text-align: center; background: ${colors.white}; border: 1px solid ${colors.line}; border-radius: ${radius.lg}; padding: ${spacing.xl} ${spacing.lg}; }
.sc-no-access-title { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeLg}; color: ${colors.ink}; }
.sc-no-access-body { margin: 0 0 ${spacing.lg} 0; color: ${colors.ink2}; font-size: ${typography.sizeSm}; line-height: 1.5; }
.sc-no-access-link { display: inline-block; padding: 9px 16px; border-radius: ${radius.sm}; background: ${colors.sage}; color: ${colors.white}; font-weight: ${typography.weightMedium}; font-size: ${typography.sizeSm}; text-decoration: none; }
.sc-no-access-link:hover { background: ${colors.sageDeep}; }
`;
