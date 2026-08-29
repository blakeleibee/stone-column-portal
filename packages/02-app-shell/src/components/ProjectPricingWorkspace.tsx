"use client";

/**
 * `/admin/projects/[id]/pricing` (P3.1 Task 8) — "Contract & Pricing
 * Terms," the new home for pricing capture moved out of the create-
 * project panel (design §2/§3: pricing is intake-deferred, never
 * fabricated to make the create form "complete"). Calls the new
 * `set_project_fee_terms()` RPC (schema/018) via `setProjectFeeTerms`,
 * atomically superseding the current `project_fee_rules` row (if any)
 * and updating `projects.pricing_model`/`pricing_model_label` together.
 *
 * PRICING_MODEL_OPTIONS below is copied verbatim (values, labels,
 * disabled flags, "(Coming later)" wording) from ProjectListWorkspace.tsx's
 * own create-form constant — same reasoning as that file's own comment:
 * `project_fee_rules`/`set_project_fee_terms()` can only genuinely
 * represent a cost-plus builder fee (percentage-of-cost or a flat dollar
 * amount on top of cost), so the other four `PricingModel` values stay
 * visible (so staff can see what's planned) but disabled in the
 * `<select>`. `setProjectFeeTerms()` (projectService.ts) enforces the
 * same restriction server-adjacent (mirroring the RPC's own check), so
 * this UI-level restriction is a courtesy, not the real boundary.
 *
 * Admin-only write, per P3.1-DESIGN.md consequential decision 5 (matches
 * project creation's own admin-only pricing restriction) — gated by the
 * `isAdmin` prop, same pattern as ProjectTeamWorkspace.tsx's staff-
 * assignments section: a non-admin session renders the read-only current-
 * terms summary and an explanatory note instead of the write form, never
 * a broken or silently-inert form. This is UI-level courtesy only — the
 * real enforcement is `set_project_fee_terms()`'s own
 * `is_org_admin_for_org()` check inside the RPC, already in place.
 *
 * Visual-modernization pass (application-wide, VISUAL-MODERNIZATION-PLAN.md):
 * `PageHeader` for the title, `Card` for both the current-terms summary
 * and the edit form, `Alert` for the "Not yet determined" empty state
 * and the non-admin restricted note, `FormField`/`Select`/`TextInput`/
 * `Button` for the write form. The admin-only gating (`isAdmin` prop
 * controls whether a `<form>` renders at all — the read-only summary
 * always renders regardless) is byte-for-byte unchanged; only the
 * markup layer changed.
 *
 * Styling/structure conventions match ProjectTeamWorkspace.tsx /
 * ProjectContactsWorkspace.tsx exactly: a trailing
 * `<style dangerouslySetInnerHTML>` block (never a raw
 * `<style>{...}</style>` JSX child), full-replace-on-reload after a
 * successful mutation (never patched in place, via `refreshFeeTerms`).
 */
import React, { useState } from "react";
import { colors, spacing, typography } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import { PageHeader } from "./ui/PageHeader";
import { Card } from "./ui/Card";
import { FormField } from "./ui/FormField";
import { FormGrid } from "./ui/FormGrid";
import { TextInput } from "./ui/TextInput";
import { Select } from "./ui/Select";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import type { PricingModel, FeeBasis, ProjectFeeTermsRow } from "../services/projectService";

// Verbatim copy of ProjectListWorkspace.tsx's PRICING_MODEL_OPTIONS (Round
// 2, Task D2) — see this file's header comment for why these four stay
// visible-but-disabled rather than being omitted.
const PRICING_MODEL_OPTIONS: { value: PricingModel; label: string; disabled?: boolean }[] = [
  { value: "cost_plus_percentage", label: "Cost-Plus (% Fee)" },
  { value: "cost_plus_fixed_fee", label: "Cost-Plus (Fixed Fee)" },
  { value: "fixed_price", label: "Fixed Price (Coming later)", disabled: true },
  { value: "time_and_materials", label: "Time & Materials (Coming later)", disabled: true },
  { value: "hybrid_custom", label: "Hybrid / Custom (Coming later)", disabled: true },
  { value: "other", label: "Other (Coming later)", disabled: true },
];

// Plain read-only display labels (no "(Coming later)" suffix — a value
// that's actually SET should never read as "coming later", even for one
// of the four models this screen's own write form can't currently
// produce). Covers all six PricingModel values for robustness in case a
// project's pricing_model was ever set by a path other than this screen
// or the create panel (both of which restrict writes to the two
// fee-supported values today).
const PRICING_MODEL_DISPLAY_LABELS: Record<PricingModel, string> = {
  cost_plus_percentage: "Cost-Plus (% Fee)",
  cost_plus_fixed_fee: "Cost-Plus (Fixed Fee)",
  fixed_price: "Fixed Price",
  time_and_materials: "Time & Materials",
  hybrid_custom: "Hybrid / Custom",
  other: "Other",
};

function formatFeeBasisPoints(basisPoints: number): string {
  const pct = basisPoints / 100;
  // Trim a trailing ".00" for whole-number percentages (e.g. "15%" not
  // "15.00%") while still showing real precision when it exists (e.g.
  // "12.5%") — a small display nicety, not a rounding decision (the
  // stored basisPoints value is untouched).
  const trimmed = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${trimmed}%`;
}

export interface ProjectPricingWorkspaceProps {
  projectId: string;
  projectName: string;
  /** Whether the acting session is an admin. Governs whether the write
   *  form renders at all — see this file's header comment. The current-
   *  terms summary below always renders regardless (it's a read, gated
   *  by RLS alone, not by this flag). */
  isAdmin: boolean;
  /** Server-rendered initial value. */
  feeTerms: ProjectFeeTermsRow;
  setFeeTerms: (params: {
    projectId: string;
    pricingModel: PricingModel;
    feeBasis: FeeBasis;
    feeBasisPoints?: number | null;
    feeFixedAmountCents?: number | null;
    pricingModelLabel?: string | null;
  }) => Promise<{ error?: string }>;
  refreshFeeTerms: (projectId: string) => Promise<{ feeTerms?: ProjectFeeTermsRow; error?: string }>;
}

export function ProjectPricingWorkspace({
  projectId,
  projectName,
  isAdmin,
  feeTerms: initialFeeTerms,
  setFeeTerms,
  refreshFeeTerms,
}: ProjectPricingWorkspaceProps) {
  const [feeTerms, setFeeTermsState] = useState<ProjectFeeTermsRow>(initialFeeTerms);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state, pre-filled from the current terms where they exist —
  // defaulting the pricingModel select to the selectable
  // cost_plus_percentage when nothing is set yet, same default
  // ProjectListWorkspace.tsx's create form uses.
  const [pricingModel, setPricingModel] = useState<PricingModel>(feeTerms.pricingModel ?? "cost_plus_percentage");
  const [pricingModelLabel, setPricingModelLabel] = useState(feeTerms.pricingModelLabel ?? "");
  const [feePercent, setFeePercent] = useState(
    feeTerms.feeBasis === "percentage" && feeTerms.feeBasisPoints != null ? String(feeTerms.feeBasisPoints / 100) : ""
  );
  const [feeFixedDollars, setFeeFixedDollars] = useState(
    feeTerms.feeBasis === "fixed" && feeTerms.feeFixedAmountCents != null
      ? String(feeTerms.feeFixedAmountCents / 100)
      : ""
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  async function reload() {
    const result = await refreshFeeTerms(projectId);
    if (result.error) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    if (result.feeTerms) setFeeTermsState(result.feeTerms);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);

    // Round 2, Task D2 precedent, reused verbatim from
    // ProjectListWorkspace.tsx's create form: pricingModel can only ever
    // be one of these two values in practice (the other four
    // PRICING_MODEL_OPTIONS entries are disabled in the <select>), so
    // the fee basis is always fully implied by the pricing model.
    const resolvedFeeBasis: FeeBasis = pricingModel === "cost_plus_fixed_fee" ? "fixed" : "percentage";

    // Same 0-100/nonnegative validation as the create form, mirroring
    // project_fee_rules' own DB constraints (fee_basis_points_range,
    // fee_fixed_amount_nonnegative — schema/001) with a friendly message
    // rather than a raw Postgres constraint-violation error.
    let feeBasisPoints: number | null = null;
    let feeFixedAmountCents: number | null = null;
    if (resolvedFeeBasis === "percentage") {
      const pct = Number(feePercent);
      if (feePercent.trim() === "" || Number.isNaN(pct) || pct < 0 || pct > 100) {
        setSubmitError("Enter a valid fee percentage between 0 and 100.");
        return;
      }
      feeBasisPoints = Math.round(pct * 100);
    } else {
      const dollars = Number(feeFixedDollars);
      if (feeFixedDollars.trim() === "" || Number.isNaN(dollars) || dollars < 0) {
        setSubmitError("Enter a valid fixed fee amount of 0 or more.");
        return;
      }
      feeFixedAmountCents = Math.round(dollars * 100);
    }

    setSubmitting(true);
    try {
      const result = await setFeeTerms({
        projectId,
        pricingModel,
        feeBasis: resolvedFeeBasis,
        feeBasisPoints,
        feeFixedAmountCents,
        pricingModelLabel: pricingModelLabel.trim() || null,
      });
      if (result.error) {
        setSubmitError(result.error);
        return;
      }
      setSubmitSuccess(true);
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  const hasPricingSet = feeTerms.pricingModel != null;

  return (
    <div className="sc-pricing-workspace">
      <PageHeader title={`${projectName} — Contract & Pricing Terms`} />

      <Card className="sc-pricing-section">
        <h3 className="sc-pricing-section-title">Current terms</h3>
        {loadError && (
          <Alert tone="error" className="sc-pricing-error">
            {loadError}
          </Alert>
        )}
        {!hasPricingSet ? (
          <Alert tone="info" className="sc-pricing-not-determined">
            Not yet determined.
          </Alert>
        ) : (
          <dl className="sc-pricing-summary">
            <dt>Pricing model</dt>
            <dd>{PRICING_MODEL_DISPLAY_LABELS[feeTerms.pricingModel as PricingModel]}</dd>
            {feeTerms.pricingModelLabel && (
              <>
                <dt>Label</dt>
                <dd>{feeTerms.pricingModelLabel}</dd>
              </>
            )}
            <dt>Fee terms</dt>
            <dd>
              {feeTerms.feeBasis === "percentage" && feeTerms.feeBasisPoints != null
                ? `${formatFeeBasisPoints(feeTerms.feeBasisPoints)} of eligible cost`
                : feeTerms.feeBasis === "fixed" && feeTerms.feeFixedAmountCents != null
                  ? `${formatCents(feeTerms.feeFixedAmountCents)} fixed fee`
                  : "Not yet on file for this session — an admin may need to confirm."}
            </dd>
          </dl>
        )}
      </Card>

      <Card className="sc-pricing-section">
        <h3 className="sc-pricing-section-title">Set / update terms</h3>
        {!isAdmin ? (
          <Alert tone="info" className="sc-pricing-restricted">
            Only an org admin can set or change a project&rsquo;s pricing/fee terms. Ask an admin if this needs to be
            updated.
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="sc-pricing-form">
            <FormGrid columns={2}>
              <FormField label="Pricing model" htmlFor="sc-pricing-model">
                <Select
                  id="sc-pricing-model"
                  value={pricingModel}
                  onChange={(e) => setPricingModel(e.target.value as PricingModel)}
                >
                  {PRICING_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Pricing model label (optional)" htmlFor="sc-pricing-label">
                <TextInput
                  id="sc-pricing-label"
                  value={pricingModelLabel}
                  onChange={(e) => setPricingModelLabel(e.target.value)}
                  placeholder="e.g. Cost-plus 15%"
                />
              </FormField>
            </FormGrid>

            {pricingModel === "cost_plus_percentage" && (
              <FormField label="Fee percentage" htmlFor="sc-pricing-fee-pct" required>
                <TextInput
                  id="sc-pricing-fee-pct"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  placeholder="e.g. 15"
                  value={feePercent}
                  onChange={(e) => setFeePercent(e.target.value)}
                />
              </FormField>
            )}

            {pricingModel === "cost_plus_fixed_fee" && (
              <FormField label="Fixed fee amount ($)" htmlFor="sc-pricing-fee-fixed" required>
                <TextInput
                  id="sc-pricing-fee-fixed"
                  type="number"
                  step="0.01"
                  min={0}
                  value={feeFixedDollars}
                  onChange={(e) => setFeeFixedDollars(e.target.value)}
                />
              </FormField>
            )}

            {submitError && (
              <Alert tone="error" className="sc-pricing-error">
                {submitError}
              </Alert>
            )}
            {submitSuccess && (
              <Alert tone="success" className="sc-pricing-success">
                Pricing/fee terms saved.
              </Alert>
            )}

            <div className="sc-pricing-form-actions">
              <Button type="submit" variant="primary" disabled={submitting} loading={submitting} loadingText="Saving…">
                {hasPricingSet ? "Update terms" : "Save terms"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <style dangerouslySetInnerHTML={{ __html: workspaceStyles }} />
    </div>
  );
}

const workspaceStyles = `
.sc-pricing-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-pricing-section-title { margin: 0 0 ${spacing.sm} 0; }
.sc-pricing-section > * + * { margin-top: ${spacing.md}; }
.sc-pricing-summary { display: grid; grid-template-columns: auto 1fr; gap: 4px ${spacing.md}; font-size: ${typography.sizeSm}; margin: 0; max-width: 480px; }
.sc-pricing-summary dt { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; text-transform: uppercase; letter-spacing: 0.02em; align-self: start; padding-top: 2px; }
.sc-pricing-summary dd { margin: 0; }
.sc-pricing-form { display: flex; flex-direction: column; gap: ${spacing.md}; max-width: 520px; }
.sc-pricing-form-actions { margin-top: 0; }
`;
