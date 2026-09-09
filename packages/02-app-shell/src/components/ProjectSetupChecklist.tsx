"use client";

/**
 * `/admin/projects/[id]/setup` — the landing screen right after a project
 * is created, and a durable reference screen a staffer can come back to
 * any time to see what's still outstanding on a project's intake.
 *
 * P3.1 Task 7: revises this component from its P3-era static two-item
 * structure (one hardcoded "done" row, one real link, six hardcoded
 * "Coming later" rows) to the full 11-item table in
 * `docs/production-build/P3.1-DESIGN.md` §9, with every item's status
 * derived from real data at read time via
 * `getProjectSetupChecklist()` (`projectIntakeService.ts`) — never a
 * separately stored flag that can drift out of sync, matching that
 * function's own framing. This component only RENDERS the
 * already-computed `ChecklistItemState` per item; it does no derivation
 * of its own.
 *
 * Visual modernization pass: the 11 rows and the overall completion
 * indicator now render through the shared `ui/` primitives
 * (`ChecklistItem`/`ProgressBar`/`Card`) built for exactly this screen,
 * in place of this file's own hand-rolled `sc-setup-item`/`sc-setup-check`
 * markup+CSS. This is a markup/styling change only — every behavioral
 * distinction below (the three item kinds, the estimate-link
 * switch-then-navigate sequencing, the derived-only progress count)
 * is unchanged.
 *
 * Three item kinds, rendered three different ways (see
 * `projectIntakeService.ts`'s own header comment for the full contract):
 *   - `{kind:"derived"}` (7 items, including "Project identity," which is
 *     always statically `"complete"`): a real, clickable link showing
 *     Not started / In progress / Complete.
 *   - `{kind:"available"}` (1 item — "Preliminary estimating," P4's
 *     already-built, already-live estimate screen): a real, clickable
 *     link with NO completion-status badge — there is no completeness
 *     signal to derive one from, and showing a status here would imply a
 *     precision this checklist doesn't have for this item. (This screen
 *     still surfaces "Available"/"Opening…" as the control's own action
 *     label, matching the original design — that's the control's state,
 *     not a derived completion status.)
 *   - `{kind:"coming_later"}` (3 items): genuinely inert — no href, no
 *     onClick, `aria-disabled="true"` — exactly the pattern the P3-era
 *     version of this file already used for its six placeholder items.
 *
 * "Preliminary estimating" is special-cased among the real links: unlike
 * every other real link, `/admin/estimate` is not itself project-scoped
 * by URL (verified by reading apps/web/app/admin/estimate/page.tsx) — it
 * always renders whichever project resolveProjectAndSwitcherData() finds
 * as "the current project" for the session (cookie-selected, or the
 * first accessible one). This checklist screen, by contrast, always
 * describes `projectId` from the URL, which is not guaranteed to be the
 * cookie-selected project (e.g. a staffer viewing this page for a
 * DIFFERENT project's setup than whichever one they last switched to).
 * A plain `<a href="/admin/estimate">` here would silently show the
 * WRONG project's estimate table in that case. So this one link switches
 * the session to `projectId` first (via the same `switchProject` Server
 * Action `ProjectSwitcher.tsx`/`ProjectListWorkspace.tsx` already use for
 * exactly this "make the cookie agree with what the user is about to
 * see" purpose) and only then navigates — not a new mechanism, the
 * existing one applied to a spot that needed it.
 */
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, typography } from "../design/tokens";
import { Card, ProgressBar, ChecklistItem } from "./ui";
import type {
  ProjectSetupChecklist as ProjectSetupChecklistData,
  ChecklistDerivedStatus,
} from "../services/projectIntakeService";

const STATUS_LABELS: Record<ChecklistDerivedStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
};

interface ChecklistItemDef {
  key: keyof ProjectSetupChecklistData;
  label: string;
  /** Present only for items with a real, project-scoped-by-URL link
   *  (everything real except "Preliminary estimating," handled
   *  separately below). */
  href?: (projectId: string) => string;
}

// Order and labels match P3.1-DESIGN.md §9's table exactly, row by row.
const ITEMS: ChecklistItemDef[] = [
  { key: "projectIdentity", label: "Project identity" },
  { key: "homeownersDecisionMakers", label: "Homeowners & decision-makers", href: (id) => `/admin/projects/${id}/contacts` },
  { key: "conceptScope", label: "Concept & scope", href: (id) => `/admin/projects/${id}/brief` },
  { key: "propertySiteInfo", label: "Property & site info", href: (id) => `/admin/projects/${id}/brief?tab=site-info` },
  { key: "plansDocuments", label: "Plans & documents" },
  { key: "staffResponsibilities", label: "Staff & responsibilities", href: (id) => `/admin/projects/${id}/team` },
  { key: "preliminaryEstimating", label: "Preliminary estimating" },
  // "Links into the site-info section's permitting group" (design §9) —
  // same destination as "Property & site info," a narrower group of
  // fields within the same form, not a separate route.
  { key: "permitting", label: "Permitting", href: (id) => `/admin/projects/${id}/brief?tab=site-info` },
  { key: "quickbooksConnection", label: "QuickBooks connection" },
  { key: "contractPricingTerms", label: "Contract & pricing terms", href: (id) => `/admin/projects/${id}/pricing` },
  { key: "schedule", label: "Schedule" },
];

export interface ProjectSetupChecklistProps {
  projectId: string;
  projectName: string;
  /** Where the prominent "Go to Overview" control sends the user — the
   *  project was already switched-to before this page was reached (see
   *  ProjectListWorkspace.tsx's handleCreateSubmit), so this is a plain
   *  static href, not something this component resolves itself. */
  overviewHref: string;
  /** Task 2's derived-status computation (getProjectSetupChecklist),
   *  passed in already-resolved by the Server Component route — this
   *  component never fetches or derives, only renders. */
  checklist: ProjectSetupChecklistData;
  /** Re-validates project access and sets the selected-project cookie
   *  (same Server Action ProjectSwitcher.tsx/ProjectListWorkspace.tsx
   *  use) — needed only for the "Preliminary estimating" link; see the
   *  file header comment for why that one link can't be a plain href. */
  switchProject: (projectId: string) => Promise<{ id: string } | { error: string }>;
}

export function ProjectSetupChecklist({ projectId, projectName, overviewHref, checklist, switchProject }: ProjectSetupChecklistProps) {
  const router = useRouter();
  const [estimateSwitching, setEstimateSwitching] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  async function handleGoToEstimate() {
    if (estimateSwitching) return;
    setEstimateError(null);
    setEstimateSwitching(true);
    try {
      const result = await switchProject(projectId);
      if ("error" in result) {
        setEstimateError(result.error);
        return;
      }
      router.push("/admin/estimate");
    } finally {
      setEstimateSwitching(false);
    }
  }

  // Overall completion-progress indicator (design §3): counts only the
  // `{kind:"derived"}` items (7 of 11 — "available"/"coming_later" items
  // have no completion signal to count at all, so including them would
  // make the denominator meaningless). "Project identity" is itself a
  // `{kind:"derived"}` item (always "complete"), so it counts toward both
  // the numerator and denominator here, same as every other derived item
  // — it is a real, if trivial, completed section, not a special case.
  const derivedItems = ITEMS.filter((item) => checklist[item.key].kind === "derived");
  const completedCount = derivedItems.filter((item) => {
    const state = checklist[item.key];
    return state.kind === "derived" && state.status === "complete";
  }).length;

  return (
    <div className="sc-setup-checklist">
      <Card className="sc-setup-card">
        <p className="sc-setup-eyebrow">Project created</p>
        <h2 className="sc-setup-title">{projectName}</h2>
        <p className="sc-setup-intro">
          Here&rsquo;s what&rsquo;s set up so far, and what&rsquo;s still outstanding. You can leave this page any time
          — nothing here needs to be finished before you start working in the project.
        </p>
        <ProgressBar
          value={completedCount}
          max={derivedItems.length}
          label={`${completedCount} of ${derivedItems.length} sections complete`}
          className="sc-setup-progress"
        />

        <ul className="sc-setup-list">
          {ITEMS.map((item) => {
            const state = checklist[item.key];

            if (item.key === "preliminaryEstimating") {
              // {kind:"available"} — a real, already-built, clickable
              // feature (P4), but with no completeness signal of its own
              // to derive a status badge from. Rendered via onClick (not
              // href) because reaching it correctly requires the
              // switch-then-navigate sequence above — see the file header
              // comment.
              return (
                <React.Fragment key={item.key}>
                  <ChecklistItem
                    id="sc-setup-item-estimate"
                    label={item.label}
                    status="available"
                    statusLabel={estimateSwitching ? "Opening…" : "Available"}
                    onClick={handleGoToEstimate}
                    disabled={estimateSwitching}
                  />
                  {estimateError && (
                    <li className="sc-setup-item-error-row" role="alert">
                      <p className="sc-setup-item-error">{estimateError}</p>
                    </li>
                  )}
                </React.Fragment>
              );
            }

            if (state.kind === "coming_later") {
              return <ChecklistItem key={item.key} label={item.label} status="inert" statusLabel="Coming later" />;
            }

            // {kind:"derived"} — real, clickable link regardless of
            // status (including "not_started": the point of a checklist
            // is to click through and start it, not to hide the link
            // until something exists). Every remaining item after the
            // preliminaryEstimating/coming_later branches above really is
            // "derived" (design §9's table has no other kind left), but
            // TypeScript can't narrow that from `item.key` alone since
            // `checklist[item.key]`'s type is the full ChecklistItemState
            // union for every key — this guard makes the narrowing
            // explicit instead of asserting past it.
            if (state.kind !== "derived") return null;
            const status = state.status;
            const href = item.href ? item.href(projectId) : undefined;
            // "Project identity" only: no href, always complete — a
            // static summary row (design §9 row 1 — "Static summary,"
            // matching the P3-era version's own "Project identity"
            // treatment). ChecklistItem renders exactly this shape
            // (check + label + status, no link/button wrapper) whenever
            // neither href nor onClick is supplied.
            return <ChecklistItem key={item.key} label={item.label} status={status} statusLabel={STATUS_LABELS[status]} href={href} />;
          })}
        </ul>

        <a href={overviewHref} className="sc-ui-btn sc-ui-btn-primary sc-setup-continue">
          Go to Overview
        </a>
      </Card>
      <style dangerouslySetInnerHTML={{ __html: setupChecklistStyles }} />
    </div>
  );
}

const setupChecklistStyles = `
.sc-setup-checklist { display: flex; justify-content: center; padding: ${spacing.xl} ${spacing.md}; font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-setup-card { width: 100%; max-width: 560px; }
.sc-setup-eyebrow { margin: 0 0 4px 0; font-size: ${typography.sizeXs}; font-weight: ${typography.weightSemibold}; text-transform: uppercase; letter-spacing: 0.04em; color: ${colors.sageDeep}; }
.sc-setup-title { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeXl}; }
.sc-setup-intro { margin: 0 0 ${spacing.md} 0; color: ${colors.ink2}; font-size: ${typography.sizeSm}; line-height: 1.6; }
.sc-setup-progress { margin-bottom: ${spacing.lg}; }

.sc-setup-list { list-style: none; margin: 0 0 ${spacing.xl} 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.sc-setup-item-error-row { list-style: none; }
.sc-setup-item-error { margin: 4px ${spacing.xs} 0 ${spacing.xs}; font-size: ${typography.sizeXs}; color: ${colors.brick}; }

.sc-setup-continue { width: fit-content; }
`;
