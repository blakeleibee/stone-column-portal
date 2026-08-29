"use client";

/**
 * `/admin/projects/[id]/brief` (P3.1, Task 5) — the "Concept & Scope"
 * form for `project_briefs` (design §5), PLUS `projects.phase` and
 * `projects.start_date`/`target_completion_date` (design §5's own
 * explicit instruction: "phase" and "desired timing" are not new
 * columns on project_briefs — they reuse these existing `projects`
 * columns directly). One form, one "Save" button, two underlying writes
 * (upsertBrief + updatePhaseTiming, both Task 5-supplied Server
 * Actions) — see this package's projectService.ts for the
 * updateProjectPhaseAndTiming() gap-closure this form depends on; no
 * such write path existed anywhere before this task.
 *
 * This table (and this form) owns its entire row conceptually — unlike
 * ProjectContactsWorkspace (a real list of many rows), there is exactly
 * one project_briefs row and one phase/timing pair per project, and this
 * is the only screen that edits either. So, unlike
 * projectIntakeService.ts's partial-write/pickDefined() convention
 * (built for a screen that might only own one section of a shared row),
 * this form always submits every field it renders, mapping a blank
 * input to `null` rather than omitting it — simpler, and always correct
 * for a form that owns the whole thing.
 *
 * Two requirements from the Task 5 brief this component is built
 * specifically around:
 *   - `target_budget_low_cents`/`target_budget_high_cents` are shown in
 *     dollars (cents<->dollars conversion at the form boundary only —
 *     the wire format stays integer cents, per CLAUDE.md's "money is
 *     always an integer number of cents" rule) with a permanent,
 *     always-rendered "Preliminary — not a budget or contract" banner
 *     directly beside them (P3.1-DESIGN.md §5's own "consequential
 *     decision 7" flag) — not a tooltip, not conditional.
 *   - `internal_notes` (staff-only, never client-visible) and
 *     `client_facing_notes` + its `client_facing_notes_published` toggle
 *     get deliberately different visual treatment (a muted/restricted
 *     card vs. a published-state-aware card), not just adjacent form
 *     fields — CLAUDE.md's "internal notes never appear in any
 *     client-facing query path" non-negotiable is a backend guarantee
 *     (getProjectBriefForClient() never selects the column at all); this
 *     UI difference exists so a staff user editing this screen never
 *     mistakes one field for the other.
 *
 * Visual-modernization pass (application-wide, VISUAL-MODERNIZATION-PLAN.md):
 * every hand-rolled input/textarea/select/checkbox is now the shared
 * `ui/` primitive, each wrapped in `FormField` (label + control + hint/
 * error, never packed inline) — the "Preliminary" banner is now a
 * permanent `Alert` (tone="warning"), and the internal/client notes
 * split now pairs a `Card` treatment with a `Badge` for the state text,
 * rather than a bespoke `<p className="...badge">`. Zero prop/behavior/
 * validation change — the id/exact copy the regression tests key off of
 * (`sc-brief-preliminary-banner`, the "Preliminary — not a budget or
 * contract" copy, the internal/client card distinction) are preserved
 * verbatim; only the markup producing them changed.
 *
 * Styling/structure conventions match ProjectTeamWorkspace.tsx /
 * ProjectContactsWorkspace.tsx exactly: a trailing
 * `<style dangerouslySetInnerHTML>` block (never a raw
 * `<style>{...}</style>` JSX child — a real hydration-mismatch bug,
 * already found and fixed twice this session).
 */
import React, { useState } from "react";
import { colors, spacing, typography } from "../design/tokens";
import { PageHeader } from "./ui/PageHeader";
import { Card } from "./ui/Card";
import { FormField } from "./ui/FormField";
import { FormGrid } from "./ui/FormGrid";
import { TextInput } from "./ui/TextInput";
import { Textarea } from "./ui/Textarea";
import { Select } from "./ui/Select";
import { Checkbox } from "./ui/Checkbox";
import { Badge } from "./ui/Badge";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import type { ProjectBriefRow, ProjectBriefWriteFields } from "../services/projectIntakeService";
import type { ProjectPhase, ProjectPhaseAndTimingRow, ProjectPhaseAndTimingWriteFields } from "../services/projectService";

const PHASE_LABELS: Record<ProjectPhase, string> = {
  lead: "Lead",
  feasibility: "Feasibility",
  preconstruction: "Preconstruction",
  pricing: "Pricing",
  contract_pending: "Contract Pending",
  ready_to_start: "Ready to Start",
};

const PHASE_ORDER: ProjectPhase[] = [
  "lead",
  "feasibility",
  "preconstruction",
  "pricing",
  "contract_pending",
  "ready_to_start",
];

function toIntOrNull(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : Math.round(n);
}

function toNumberOrNull(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

function toTextOrNull(input: string): string | null {
  const trimmed = input.trim();
  return trimmed === "" ? null : trimmed;
}

/** cents -> a plain dollars string for a controlled text/number input.
 *  Conversion happens only at this form boundary — nothing here ever
 *  stores or transmits a float amount; dollarsStringToCents() below
 *  converts straight back to integer cents before either Server Action
 *  is called. */
function centsToDollarsString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toString();
}

function dollarsStringToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const dollars = Number(trimmed);
  if (Number.isNaN(dollars)) return null;
  return Math.round(dollars * 100);
}

interface BriefFormValues {
  summary: string;
  knownScope: string;
  clientGoals: string;
  mustHaves: string;
  wishlistItems: string;
  knownExclusions: string;
  qualityExpectations: string;
  approxSquareFootage: string;
  stories: string;
  bedrooms: string;
  bathrooms: string;
  targetBudgetLowDollars: string;
  targetBudgetHighDollars: string;
  confidenceNote: string;
  leadSource: string;
  internalNotes: string;
  clientFacingNotes: string;
  clientFacingNotesPublished: boolean;
  phase: ProjectPhase | "";
  startDate: string;
  targetCompletionDate: string;
}

function defaultsToFormValues(
  brief: ProjectBriefRow | null,
  phaseTiming: ProjectPhaseAndTimingRow | null
): BriefFormValues {
  return {
    summary: brief?.summary ?? "",
    knownScope: brief?.knownScope ?? "",
    clientGoals: brief?.clientGoals ?? "",
    mustHaves: brief?.mustHaves ?? "",
    wishlistItems: brief?.wishlistItems ?? "",
    knownExclusions: brief?.knownExclusions ?? "",
    qualityExpectations: brief?.qualityExpectations ?? "",
    approxSquareFootage: brief?.approxSquareFootage != null ? String(brief.approxSquareFootage) : "",
    stories: brief?.stories != null ? String(brief.stories) : "",
    bedrooms: brief?.bedrooms != null ? String(brief.bedrooms) : "",
    bathrooms: brief?.bathrooms != null ? String(brief.bathrooms) : "",
    targetBudgetLowDollars: centsToDollarsString(brief?.targetBudgetLowCents),
    targetBudgetHighDollars: centsToDollarsString(brief?.targetBudgetHighCents),
    confidenceNote: brief?.confidenceNote ?? "",
    leadSource: brief?.leadSource ?? "",
    internalNotes: brief?.internalNotes ?? "",
    clientFacingNotes: brief?.clientFacingNotes ?? "",
    clientFacingNotesPublished: brief?.clientFacingNotesPublished ?? false,
    phase: phaseTiming?.phase ?? "",
    startDate: phaseTiming?.startDate ?? "",
    targetCompletionDate: phaseTiming?.targetCompletionDate ?? "",
  };
}

function formValuesToBriefFields(values: BriefFormValues): ProjectBriefWriteFields {
  return {
    summary: toTextOrNull(values.summary),
    knownScope: toTextOrNull(values.knownScope),
    clientGoals: toTextOrNull(values.clientGoals),
    mustHaves: toTextOrNull(values.mustHaves),
    wishlistItems: toTextOrNull(values.wishlistItems),
    knownExclusions: toTextOrNull(values.knownExclusions),
    qualityExpectations: toTextOrNull(values.qualityExpectations),
    approxSquareFootage: toIntOrNull(values.approxSquareFootage),
    stories: toNumberOrNull(values.stories),
    bedrooms: toIntOrNull(values.bedrooms),
    bathrooms: toNumberOrNull(values.bathrooms),
    targetBudgetLowCents: dollarsStringToCents(values.targetBudgetLowDollars),
    targetBudgetHighCents: dollarsStringToCents(values.targetBudgetHighDollars),
    confidenceNote: toTextOrNull(values.confidenceNote),
    leadSource: toTextOrNull(values.leadSource),
    internalNotes: toTextOrNull(values.internalNotes),
    clientFacingNotes: toTextOrNull(values.clientFacingNotes),
    clientFacingNotesPublished: values.clientFacingNotesPublished,
  };
}

function formValuesToPhaseTimingFields(values: BriefFormValues): ProjectPhaseAndTimingWriteFields {
  return {
    phase: values.phase || null,
    startDate: values.startDate || null,
    targetCompletionDate: values.targetCompletionDate || null,
  };
}

export interface ProjectBriefWorkspaceProps {
  projectId: string;
  projectName: string;
  /** Defense-in-depth UI guard — same reasoning as
   *  ProjectContactsWorkspace's own `isArchived` prop. The real boundary
   *  is assertProjectNotArchived() inside both
   *  upsertProjectBrief()/updateProjectPhaseAndTiming(); the page
   *  rendering this component already blocks the whole route via
   *  NoProjectAccess for an archived project, so this prop is not
   *  expected to ever be true in practice. */
  isArchived?: boolean;
  brief: ProjectBriefRow | null;
  phaseTiming: ProjectPhaseAndTimingRow | null;
  upsertBrief: (projectId: string, fields: ProjectBriefWriteFields) => Promise<{} | { error: string }>;
  updatePhaseTiming: (
    projectId: string,
    fields: ProjectPhaseAndTimingWriteFields
  ) => Promise<{} | { error: string }>;
}

export function ProjectBriefWorkspace({
  projectId,
  projectName,
  isArchived,
  brief,
  phaseTiming,
  upsertBrief,
  updatePhaseTiming,
}: ProjectBriefWorkspaceProps) {
  const [values, setValues] = useState<BriefFormValues>(() => defaultsToFormValues(brief, phaseTiming));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const disabled = !!isArchived || submitting;

  function set<K extends keyof BriefFormValues>(key: K, value: BriefFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side mirror of project_briefs' own
    // target_budget_range_consistent CHECK constraint (schema/018) —
    // catches the obvious case with a friendly message before hitting
    // the raw Postgres error.
    const lowCents = dollarsStringToCents(values.targetBudgetLowDollars);
    const highCents = dollarsStringToCents(values.targetBudgetHighDollars);
    if (lowCents !== null && highCents !== null && lowCents > highCents) {
      setError("Target budget low must not be greater than target budget high.");
      return;
    }

    setSubmitting(true);
    try {
      const [briefResult, phaseResult] = await Promise.all([
        upsertBrief(projectId, formValuesToBriefFields(values)),
        updatePhaseTiming(projectId, formValuesToPhaseTimingFields(values)),
      ]);
      const errors = [briefResult, phaseResult]
        .filter((r): r is { error: string } => "error" in r && !!r.error)
        .map((r) => r.error);
      if (errors.length > 0) {
        setError(errors.join(" "));
        return;
      }
      setSavedAt(new Date());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sc-brief-workspace">
      <PageHeader title={`${projectName} — Concept & Scope`} />

      <form onSubmit={handleSubmit} className="sc-brief-form">
        <Card className="sc-brief-section">
          <h3 className="sc-brief-section-title">Project concept</h3>
          <div className="sc-brief-stack">
            <FormField label="Summary">
              <Textarea rows={3} value={values.summary} disabled={disabled} onChange={(e) => set("summary", e.target.value)} />
            </FormField>
            <FormField label="Known scope">
              <Textarea rows={3} value={values.knownScope} disabled={disabled} onChange={(e) => set("knownScope", e.target.value)} />
            </FormField>
            <FormField label="Client goals">
              <Textarea rows={3} value={values.clientGoals} disabled={disabled} onChange={(e) => set("clientGoals", e.target.value)} />
            </FormField>
            <FormField label="Must-haves">
              <Textarea rows={3} value={values.mustHaves} disabled={disabled} onChange={(e) => set("mustHaves", e.target.value)} />
            </FormField>
            <FormField label="Wishlist items">
              <Textarea rows={3} value={values.wishlistItems} disabled={disabled} onChange={(e) => set("wishlistItems", e.target.value)} />
            </FormField>
            <FormField label="Known exclusions">
              <Textarea
                rows={3}
                value={values.knownExclusions}
                disabled={disabled}
                onChange={(e) => set("knownExclusions", e.target.value)}
              />
            </FormField>
            <FormField label="Quality expectations">
              <Textarea
                rows={3}
                value={values.qualityExpectations}
                disabled={disabled}
                onChange={(e) => set("qualityExpectations", e.target.value)}
              />
            </FormField>
          </div>
        </Card>

        <Card className="sc-brief-section">
          <h3 className="sc-brief-section-title">Structured facts</h3>
          <FormGrid columns={2}>
            <FormField label="Approx. square footage">
              <TextInput
                type="number"
                step="1"
                value={values.approxSquareFootage}
                disabled={disabled}
                onChange={(e) => set("approxSquareFootage", e.target.value)}
              />
            </FormField>
            <FormField label="Stories">
              <TextInput type="number" step="0.5" value={values.stories} disabled={disabled} onChange={(e) => set("stories", e.target.value)} />
            </FormField>
            <FormField label="Bedrooms">
              <TextInput type="number" step="1" value={values.bedrooms} disabled={disabled} onChange={(e) => set("bedrooms", e.target.value)} />
            </FormField>
            <FormField label="Bathrooms">
              <TextInput
                type="number"
                step="0.5"
                value={values.bathrooms}
                disabled={disabled}
                onChange={(e) => set("bathrooms", e.target.value)}
              />
            </FormField>
          </FormGrid>
        </Card>

        <Card className="sc-brief-section">
          <h3 className="sc-brief-section-title">Target budget range</h3>
          <Alert id="sc-brief-preliminary-banner" tone="warning" className="sc-brief-preliminary-banner">
            Preliminary — not a budget or contract
          </Alert>
          <FormGrid columns={2}>
            <FormField label="Target budget low ($)">
              <TextInput
                type="number"
                step="1"
                min="0"
                value={values.targetBudgetLowDollars}
                disabled={disabled}
                onChange={(e) => set("targetBudgetLowDollars", e.target.value)}
              />
            </FormField>
            <FormField label="Target budget high ($)">
              <TextInput
                type="number"
                step="1"
                min="0"
                value={values.targetBudgetHighDollars}
                disabled={disabled}
                onChange={(e) => set("targetBudgetHighDollars", e.target.value)}
              />
            </FormField>
          </FormGrid>
          <p className="sc-brief-hint">
            This range is a staff-entered planning signal only. It is never written to the project ledger and is never
            official until an accepted estimate or contract exists.
          </p>
        </Card>

        <Card className="sc-brief-section">
          <h3 className="sc-brief-section-title">Confidence &amp; source</h3>
          <FormGrid columns={2}>
            <FormField label="Confidence note">
              <TextInput type="text" value={values.confidenceNote} disabled={disabled} onChange={(e) => set("confidenceNote", e.target.value)} />
            </FormField>
            <FormField label="Lead source">
              <TextInput type="text" value={values.leadSource} disabled={disabled} onChange={(e) => set("leadSource", e.target.value)} />
            </FormField>
          </FormGrid>
        </Card>

        <Card className="sc-brief-section">
          <h3 className="sc-brief-section-title">Phase &amp; desired timing</h3>
          <FormGrid columns={3}>
            <FormField label="Phase">
              <Select value={values.phase} disabled={disabled} onChange={(e) => set("phase", e.target.value as ProjectPhase | "")}>
                <option value="">— not set —</option>
                {PHASE_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PHASE_LABELS[p]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Desired start date">
              <TextInput type="date" value={values.startDate} disabled={disabled} onChange={(e) => set("startDate", e.target.value)} />
            </FormField>
            <FormField label="Desired completion date">
              <TextInput
                type="date"
                value={values.targetCompletionDate}
                disabled={disabled}
                onChange={(e) => set("targetCompletionDate", e.target.value)}
              />
            </FormField>
          </FormGrid>
        </Card>

        <div className="sc-brief-notes-row">
          <Card className="sc-brief-section sc-brief-notes-card sc-brief-notes-internal">
            <h3 className="sc-brief-section-title">Internal notes</h3>
            <Badge tone="neutral">Staff only — never visible to the client</Badge>
            <FormField label="Notes">
              <Textarea rows={4} value={values.internalNotes} disabled={disabled} onChange={(e) => set("internalNotes", e.target.value)} />
            </FormField>
          </Card>

          <Card className="sc-brief-section sc-brief-notes-card sc-brief-notes-client">
            <h3 className="sc-brief-section-title">Client-facing notes</h3>
            <Badge tone={values.clientFacingNotesPublished ? "sage" : "neutral"}>
              {values.clientFacingNotesPublished ? "Published — visible to the client" : "Not published — client cannot see this yet"}
            </Badge>
            <FormField label="Notes">
              <Textarea
                rows={4}
                value={values.clientFacingNotes}
                disabled={disabled}
                onChange={(e) => set("clientFacingNotes", e.target.value)}
              />
            </FormField>
            <Checkbox
              label="Publish these notes to the client"
              checked={values.clientFacingNotesPublished}
              disabled={disabled}
              onChange={(e) => set("clientFacingNotesPublished", e.target.checked)}
            />
          </Card>
        </div>

        {error && (
          <Alert tone="error" className="sc-brief-error">
            {error}
          </Alert>
        )}
        {savedAt && !error && (
          <Alert tone="success" className="sc-brief-saved">
            Saved.
          </Alert>
        )}

        <div className="sc-brief-form-actions">
          <Button type="submit" variant="primary" disabled={disabled} loading={submitting} loadingText="Saving…">
            Save
          </Button>
        </div>
        {isArchived && (
          <Alert tone="info" className="sc-brief-archived-note">
            This project is archived. The Concept &amp; Scope form is read-only.
          </Alert>
        )}
      </form>

      <style dangerouslySetInnerHTML={{ __html: briefStyles }} />
    </div>
  );
}

const briefStyles = `
.sc-brief-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-brief-form { display: flex; flex-direction: column; gap: ${spacing.lg}; }
.sc-brief-section-title { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeMd}; }
.sc-brief-section > * + * { margin-top: ${spacing.md}; }
.sc-brief-stack { display: flex; flex-direction: column; gap: ${spacing.md}; }
.sc-brief-preliminary-banner { font-weight: ${typography.weightSemibold}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-brief-hint { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; margin: 0; max-width: 640px; }
.sc-brief-notes-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: ${spacing.md}; }
.sc-brief-notes-internal { background: ${colors.paperDim}; }
.sc-brief-notes-client { background: ${colors.sageTint}; border-color: ${colors.sage}; }
.sc-brief-form-actions { margin-top: 0; }
`;
