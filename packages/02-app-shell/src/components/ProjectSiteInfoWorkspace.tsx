"use client";

/**
 * `/admin/projects/[id]/brief?tab=site-info` (P3.1, Task 5) — the
 * "Property & Site Info" form for `project_site_info` (design §6).
 * Grouped into five logical sections with headers, per the Task 5 brief:
 * "Address & Ownership," "Permitting & HOA," "Design & Survey,"
 * "Utilities & Site," "Financing." No field is required — design §6 is
 * explicit ("do not make every field mandatory"; every column is
 * nullable or defaults to `'unknown'`) — so this form renders no
 * asterisks and blocks nothing on validation beyond the archived-project
 * guard.
 *
 * Same "this form owns its entire row" reasoning as ProjectBriefWorkspace
 * (there is exactly one project_site_info row per project, and this is
 * the only screen that edits it) — every submit sends the full set of
 * fields this form renders, mapping a blank/unset control to `null`
 * rather than tracking per-field dirty state.
 *
 * Every `intake_item_status`-typed field (hoa_status, survey_status,
 * architectural_plans_status, soil_environmental_status,
 * financing_status, permit_status) renders the same five human-readable
 * labels (Unknown/Requested/Received/Not Applicable/Complete) via one
 * shared `<select>` renderer, matching design §6's own framing that this
 * is "the concrete implementation of ... Unknown, Requested, Received,
 * Not Applicable or Complete where appropriate."
 *
 * occupied_during_work / hoa_review_required are tri-state booleans
 * (`boolean | null` columns — schema/018 Step 7) rendered as a 3-option
 * select (Unknown / Yes / No) rather than a plain checkbox, since
 * "unset" is a real, distinct, intended state here (not merely "false").
 *
 * Visual-modernization pass (application-wide, VISUAL-MODERNIZATION-PLAN.md):
 * every field now renders through the shared `ui/` primitives
 * (`Select` for both the intake-status and tri-state renderers, `TextInput`/
 * `Textarea` for free text, all wrapped in `FormField`), and each of the
 * five logical sections is now its own `Card` with a heading, so the
 * groups read as visually separable sections rather than one long
 * undifferentiated form. No field gained a `required` attribute and no
 * validation/behavior changed — only the markup layer.
 *
 * Styling/structure conventions match ProjectBriefWorkspace.tsx /
 * ProjectTeamWorkspace.tsx exactly (trailing
 * `<style dangerouslySetInnerHTML>` block, never a raw JSX `<style>`
 * child).
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
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import type { ProjectSiteInfoRow, ProjectSiteInfoWriteFields, IntakeItemStatus } from "../services/projectIntakeService";

const INTAKE_ITEM_STATUS_LABELS: Record<IntakeItemStatus, string> = {
  unknown: "Unknown",
  requested: "Requested",
  received: "Received",
  not_applicable: "Not Applicable",
  complete: "Complete",
};

const INTAKE_ITEM_STATUS_ORDER: IntakeItemStatus[] = ["unknown", "requested", "received", "not_applicable", "complete"];

type TriState = "" | "true" | "false";

function triStateToBoolean(value: TriState): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function booleanToTriState(value: boolean | null | undefined): TriState {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

function toTextOrNull(input: string): string | null {
  const trimmed = input.trim();
  return trimmed === "" ? null : trimmed;
}

interface SiteInfoFormValues {
  fullAddress: string;
  parcelId: string;
  ownershipStatus: string;
  occupiedDuringWork: TriState;
  permittingJurisdiction: string;
  hoaReviewRequired: TriState;
  hoaStatus: IntakeItemStatus;
  zoningNotes: string;
  surveyStatus: IntakeItemStatus;
  architecturalPlansStatus: IntakeItemStatus;
  septicOrSewer: string;
  waterSource: string;
  utilitiesAvailable: string;
  soilEnvironmentalStatus: IntakeItemStatus;
  soilEnvironmentalNotes: string;
  siteAccessNotes: string;
  financingStatus: IntakeItemStatus;
  permitStatus: IntakeItemStatus;
  requiredApprovalsNotes: string;
}

function defaultsToFormValues(row: ProjectSiteInfoRow | null): SiteInfoFormValues {
  return {
    fullAddress: row?.fullAddress ?? "",
    parcelId: row?.parcelId ?? "",
    ownershipStatus: row?.ownershipStatus ?? "",
    occupiedDuringWork: booleanToTriState(row?.occupiedDuringWork),
    permittingJurisdiction: row?.permittingJurisdiction ?? "",
    hoaReviewRequired: booleanToTriState(row?.hoaReviewRequired),
    hoaStatus: row?.hoaStatus ?? "unknown",
    zoningNotes: row?.zoningNotes ?? "",
    surveyStatus: row?.surveyStatus ?? "unknown",
    architecturalPlansStatus: row?.architecturalPlansStatus ?? "unknown",
    septicOrSewer: row?.septicOrSewer ?? "",
    waterSource: row?.waterSource ?? "",
    utilitiesAvailable: row?.utilitiesAvailable ?? "",
    soilEnvironmentalStatus: row?.soilEnvironmentalStatus ?? "unknown",
    soilEnvironmentalNotes: row?.soilEnvironmentalNotes ?? "",
    siteAccessNotes: row?.siteAccessNotes ?? "",
    financingStatus: row?.financingStatus ?? "unknown",
    permitStatus: row?.permitStatus ?? "unknown",
    requiredApprovalsNotes: row?.requiredApprovalsNotes ?? "",
  };
}

function formValuesToFields(values: SiteInfoFormValues): ProjectSiteInfoWriteFields {
  return {
    fullAddress: toTextOrNull(values.fullAddress),
    parcelId: toTextOrNull(values.parcelId),
    ownershipStatus: toTextOrNull(values.ownershipStatus),
    occupiedDuringWork: triStateToBoolean(values.occupiedDuringWork),
    permittingJurisdiction: toTextOrNull(values.permittingJurisdiction),
    hoaReviewRequired: triStateToBoolean(values.hoaReviewRequired),
    hoaStatus: values.hoaStatus,
    zoningNotes: toTextOrNull(values.zoningNotes),
    surveyStatus: values.surveyStatus,
    architecturalPlansStatus: values.architecturalPlansStatus,
    septicOrSewer: toTextOrNull(values.septicOrSewer),
    waterSource: toTextOrNull(values.waterSource),
    utilitiesAvailable: toTextOrNull(values.utilitiesAvailable),
    soilEnvironmentalStatus: values.soilEnvironmentalStatus,
    soilEnvironmentalNotes: toTextOrNull(values.soilEnvironmentalNotes),
    siteAccessNotes: toTextOrNull(values.siteAccessNotes),
    financingStatus: values.financingStatus,
    permitStatus: values.permitStatus,
    requiredApprovalsNotes: toTextOrNull(values.requiredApprovalsNotes),
  };
}

export interface ProjectSiteInfoWorkspaceProps {
  projectId: string;
  projectName: string;
  /** Defense-in-depth UI guard — same reasoning as
   *  ProjectBriefWorkspace's own `isArchived` prop. */
  isArchived?: boolean;
  siteInfo: ProjectSiteInfoRow | null;
  upsertSiteInfo: (projectId: string, fields: ProjectSiteInfoWriteFields) => Promise<{} | { error: string }>;
}

function IntakeStatusSelect({
  label,
  value,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  value: IntakeItemStatus;
  disabled?: boolean;
  hint?: React.ReactNode;
  onChange: (value: IntakeItemStatus) => void;
}) {
  return (
    <FormField label={label} hint={hint}>
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as IntakeItemStatus)}>
        {INTAKE_ITEM_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {INTAKE_ITEM_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

function TriStateSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: TriState;
  disabled?: boolean;
  onChange: (value: TriState) => void;
}) {
  return (
    <FormField label={label}>
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as TriState)}>
        <option value="">Unknown</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    </FormField>
  );
}

export function ProjectSiteInfoWorkspace({
  projectId,
  projectName,
  isArchived,
  siteInfo,
  upsertSiteInfo,
}: ProjectSiteInfoWorkspaceProps) {
  const [values, setValues] = useState<SiteInfoFormValues>(() => defaultsToFormValues(siteInfo));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const disabled = !!isArchived || submitting;

  function set<K extends keyof SiteInfoFormValues>(key: K, value: SiteInfoFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await upsertSiteInfo(projectId, formValuesToFields(values));
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setSavedAt(new Date());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sc-siteinfo-workspace">
      <PageHeader title={`${projectName} — Property & Site Info`} />

      <form onSubmit={handleSubmit} className="sc-siteinfo-form">
        <Card className="sc-siteinfo-section">
          <h3 className="sc-siteinfo-section-title">Address &amp; Ownership</h3>
          <FormGrid columns={2}>
            <FormField label="Full address">
              <TextInput type="text" value={values.fullAddress} disabled={disabled} onChange={(e) => set("fullAddress", e.target.value)} />
            </FormField>
            <FormField label="Parcel ID">
              <TextInput type="text" value={values.parcelId} disabled={disabled} onChange={(e) => set("parcelId", e.target.value)} />
            </FormField>
            <FormField label="Ownership status">
              <TextInput
                type="text"
                placeholder="e.g. owned, under contract, shopping lots"
                value={values.ownershipStatus}
                disabled={disabled}
                onChange={(e) => set("ownershipStatus", e.target.value)}
              />
            </FormField>
            <TriStateSelect
              label="Occupied during work?"
              value={values.occupiedDuringWork}
              disabled={disabled}
              onChange={(v) => set("occupiedDuringWork", v)}
            />
          </FormGrid>
        </Card>

        <Card className="sc-siteinfo-section">
          <h3 className="sc-siteinfo-section-title">Permitting &amp; HOA</h3>
          <FormGrid columns={2}>
            <FormField label="Permitting jurisdiction">
              <TextInput
                type="text"
                value={values.permittingJurisdiction}
                disabled={disabled}
                onChange={(e) => set("permittingJurisdiction", e.target.value)}
              />
            </FormField>
            <TriStateSelect
              label="HOA review required?"
              value={values.hoaReviewRequired}
              disabled={disabled}
              onChange={(v) => set("hoaReviewRequired", v)}
            />
            <IntakeStatusSelect label="HOA status" value={values.hoaStatus} disabled={disabled} onChange={(v) => set("hoaStatus", v)} />
            <IntakeStatusSelect
              label="Permit status"
              value={values.permitStatus}
              disabled={disabled}
              onChange={(v) => set("permitStatus", v)}
            />
          </FormGrid>
          <div className="sc-siteinfo-stack">
            <FormField label="Zoning notes">
              <Textarea rows={2} value={values.zoningNotes} disabled={disabled} onChange={(e) => set("zoningNotes", e.target.value)} />
            </FormField>
            <FormField label="Required approvals notes">
              <Textarea
                rows={2}
                value={values.requiredApprovalsNotes}
                disabled={disabled}
                onChange={(e) => set("requiredApprovalsNotes", e.target.value)}
              />
            </FormField>
          </div>
        </Card>

        <Card className="sc-siteinfo-section">
          <h3 className="sc-siteinfo-section-title">Design &amp; Survey</h3>
          <FormGrid columns={2}>
            <IntakeStatusSelect
              label="Survey status"
              value={values.surveyStatus}
              disabled={disabled}
              onChange={(v) => set("surveyStatus", v)}
            />
            <IntakeStatusSelect
              label="Architectural plans status"
              value={values.architecturalPlansStatus}
              disabled={disabled}
              onChange={(v) => set("architecturalPlansStatus", v)}
            />
          </FormGrid>
        </Card>

        <Card className="sc-siteinfo-section">
          <h3 className="sc-siteinfo-section-title">Utilities &amp; Site</h3>
          <FormGrid columns={3}>
            <FormField label="Septic or sewer">
              <TextInput
                type="text"
                placeholder="e.g. septic, public sewer, unknown"
                value={values.septicOrSewer}
                disabled={disabled}
                onChange={(e) => set("septicOrSewer", e.target.value)}
              />
            </FormField>
            <FormField label="Water source">
              <TextInput
                type="text"
                placeholder="e.g. well, public water, unknown"
                value={values.waterSource}
                disabled={disabled}
                onChange={(e) => set("waterSource", e.target.value)}
              />
            </FormField>
            <IntakeStatusSelect
              label="Soil / environmental status"
              value={values.soilEnvironmentalStatus}
              disabled={disabled}
              onChange={(v) => set("soilEnvironmentalStatus", v)}
            />
          </FormGrid>
          <div className="sc-siteinfo-stack">
            <FormField label="Utilities available">
              <TextInput type="text" value={values.utilitiesAvailable} disabled={disabled} onChange={(e) => set("utilitiesAvailable", e.target.value)} />
            </FormField>
            <FormField label="Soil / environmental notes">
              <Textarea
                rows={2}
                placeholder="e.g. flood zone AE"
                value={values.soilEnvironmentalNotes}
                disabled={disabled}
                onChange={(e) => set("soilEnvironmentalNotes", e.target.value)}
              />
            </FormField>
            <FormField label="Site access notes">
              <Textarea rows={2} value={values.siteAccessNotes} disabled={disabled} onChange={(e) => set("siteAccessNotes", e.target.value)} />
            </FormField>
          </div>
        </Card>

        <Card className="sc-siteinfo-section">
          <h3 className="sc-siteinfo-section-title">Financing</h3>
          <IntakeStatusSelect
            label="Financing status"
            value={values.financingStatus}
            disabled={disabled}
            hint="Status and a free-text note only — never an account number, loan amount, or other sensitive financial detail."
            onChange={(v) => set("financingStatus", v)}
          />
        </Card>

        {error && (
          <Alert tone="error" className="sc-siteinfo-error">
            {error}
          </Alert>
        )}
        {savedAt && !error && (
          <Alert tone="success" className="sc-siteinfo-saved">
            Saved.
          </Alert>
        )}

        <div className="sc-siteinfo-form-actions">
          <Button type="submit" variant="primary" disabled={disabled} loading={submitting} loadingText="Saving…">
            Save
          </Button>
        </div>
        {isArchived && (
          <Alert tone="info" className="sc-siteinfo-archived-note">
            This project is archived. The Property &amp; Site Info form is read-only.
          </Alert>
        )}
      </form>

      <style dangerouslySetInnerHTML={{ __html: siteInfoStyles }} />
    </div>
  );
}

const siteInfoStyles = `
.sc-siteinfo-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-siteinfo-form { display: flex; flex-direction: column; gap: ${spacing.lg}; }
.sc-siteinfo-section-title { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeMd}; }
.sc-siteinfo-section > * + * { margin-top: ${spacing.md}; }
.sc-siteinfo-stack { display: flex; flex-direction: column; gap: ${spacing.md}; }
.sc-siteinfo-form-actions { margin-top: 0; }
`;
