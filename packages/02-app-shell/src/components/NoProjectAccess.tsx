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
import { spacing, typography } from "../design/tokens";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";

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
  /** Optional override for the heading; defaults to the Decision-10
   *  "no access" wording. Added for reuse in a genuinely-has-access-but-
   *  blocked-for-another-reason case (e.g. the archived-project block on
   *  /admin/projects/[id]/team and /admin/projects/[id]/setup) — that
   *  caller DOES have access, so the default heading would be actively
   *  wrong for them, not just generic. */
  heading?: string;
}

export function NoProjectAccess({ backHref, message, backLabel, heading }: NoProjectAccessProps) {
  return (
    <div className="sc-no-access">
      <Card className="sc-no-access-card">
        <EmptyState
          title={heading ?? "You don’t have access to this project"}
          description={
            message ??
            "This project doesn't exist, or you no longer have access to it. If you believe this is a mistake, contact your administrator."
          }
          action={
            // Reuses the shared Button primitive's own visual classes
            // directly (rather than the Button component itself, which
            // only renders a <button>) — this is real cross-page
            // navigation, so it must stay a genuine <a href>, not a
            // client-side click handler. The classes are plain CSS
            // selectors (see ui/styles.ts's `.sc-ui-btn`), so applying
            // them to an anchor gets byte-identical styling for free.
            <a href={backHref} className="sc-ui-btn sc-ui-btn-primary">
              {backLabel ?? "Back to your projects"}
            </a>
          }
        />
      </Card>
      <style dangerouslySetInnerHTML={{ __html: noAccessStyles }} />
    </div>
  );
}

const noAccessStyles = `
.sc-no-access { display: flex; justify-content: center; padding: ${spacing.xxl} ${spacing.md}; font-family: ${typography.fontFamily}; }
.sc-no-access-card { max-width: 420px; width: 100%; box-sizing: border-box; }
`;
