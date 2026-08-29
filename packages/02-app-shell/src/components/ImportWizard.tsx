"use client";

/**
 * The QuickBooks Desktop job-cost CSV import wizard (P4, Task 11). Three
 * steps in one Client Component:
 *
 *   1. Profile — pick an existing `import_mapping_profiles` row, or
 *      create a new one with Task 7's <MappingProfileForm />.
 *   2. Upload — POST the CSV straight to Task 9's `/api/imports/parse`
 *      Route Handler (a real multipart file upload, so this has to be a
 *      `fetch` call from the browser, not a Server Action), then review
 *      the staged `import_rows`, grouped by match_status, with a per-row
 *      cost-code override and an per-row exclude action.
 *   3. Confirm — blocked while any 'unmatched'/'error' row is still
 *      unresolved, then calls Task 10's `confirm_import_batch` RPC (via
 *      confirmImportBatch) and shows the reconciliation verdict.
 *
 * Every Server Action this component calls (createMappingProfile,
 * overrideImportRow, excludeImportRow, listImportRows, confirmImportBatch,
 * getImportBatchReconciliation) is passed in as a PROP from page.tsx, same
 * pattern as EstimateTable.tsx/MappingProfileForm.tsx — this package-level
 * component stays free of any dependency on apps/web's file layout (or,
 * transitively, on next/headers / @supabase/ssr).
 *
 * State-freshness rule (the lesson from Task 6's /admin/estimate review):
 * `rows` is never patched in place after an override/exclude action or
 * after confirming. Every mutation is followed by a full
 * listImportRows(batchId) re-fetch whose result WHOLESALE-REPLACES the
 * `rows` state array. There is no ref+updater resync pattern anywhere in
 * this file — the EstimateTable.tsx `useServerSyncedField` shape exists
 * to solve a problem (local drafts must survive an unrelated
 * router.refresh() without reverting) that does not apply here: nothing
 * in this component holds a local draft that must outlive a refresh, so
 * the simplest fix (re-fetch, replace) fully avoids that bug class.
 *
 * VISUAL MODERNIZATION (docs/production-build/VISUAL-MODERNIZATION-PLAN.md):
 * markup now composes the shared `ui/` primitives (Card/PageHeader/
 * Button/TextInput/Select/Badge/Alert/EmptyState/Tabs) instead of this
 * file's own one-off `sc-import-*` input/button/tab styling. This pass is
 * visual/structural only — every prop, handler, and the step-progression
 * state machine (`step`/`selectedProfileId`/`batchId`/`confirmed`, and the
 * exact conditions each nav control is enabled/disabled under) is
 * unchanged. No `<style>{...}</style>` JSX child remains anywhere in this
 * file (was previously the raw, hydration-unsafe form — see
 * BidPackageWorkspace.tsx's own comment on why `dangerouslySetInnerHTML`
 * is required instead).
 */
import React, { useState } from "react";
import { colors, spacing, typography } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { CostCode } from "../../../01-financial-engine/src/types";
import { MappingProfileForm } from "./MappingProfileForm";
import type { MappingProfile } from "../services/importMappingService";
import type { ImportRow, ImportRowMatchStatus, ImportBatchReconciliation } from "../services/importService";
import { Card, PageHeader, Button, TextInput, Select, Badge, Alert, EmptyState, Tabs, FormField } from "./ui";
import type { BadgeTone, TabItem } from "./ui";

type ActionResult = { error?: string } | void | undefined;

export interface ImportWizardProps {
  orgId: string;
  projectId: string;
  mappingProfiles: MappingProfile[];
  costCodes: CostCode[];
  createMappingProfile: (
    orgId: string,
    input: {
      name: string;
      columnMapping: Record<string, string>;
      strategy: "prefix" | "exact" | "manual_only";
      prefixLength?: number;
    }
  ) => Promise<{ error?: string; id?: string }>;
  listImportRows: (batchId: string) => Promise<{ rows: ImportRow[]; error?: string }>;
  overrideImportRow: (rowId: string, costCodeId: string) => Promise<ActionResult>;
  excludeImportRow: (rowId: string) => Promise<ActionResult>;
  confirmImportBatch: (batchId: string) => Promise<ActionResult>;
  getImportBatchReconciliation: (batchId: string) => Promise<{ report?: ImportBatchReconciliation; error?: string }>;
}

type WizardStep = "profile" | "upload" | "confirm";

const STATUS_ORDER: ImportRowMatchStatus[] = ["error", "unmatched", "duplicate", "changed", "new", "excluded"];

const STATUS_LABELS: Record<ImportRowMatchStatus, string> = {
  error: "Errors",
  unmatched: "Unmatched (needs a cost code)",
  duplicate: "Duplicates (already imported)",
  changed: "Changed (cost code overridden)",
  new: "New",
  excluded: "Excluded",
};

// Purely presentational — which Badge tone represents each match status,
// reusing the same tone vocabulary (not a new color) as everywhere else
// in the shared ui/ layer.
const STATUS_TONE: Record<ImportRowMatchStatus, BadgeTone> = {
  error: "brick",
  unmatched: "gold",
  duplicate: "neutral",
  changed: "sage",
  new: "sage",
  excluded: "neutral",
};

// row.rawData.Amount is stored as a signed-integer-cents string (see
// parseQuickBooksCsv()'s doc comment) — never a decimal-dollar string.
// A row that reached 'error' status may have an Amount that never
// parsed cleanly in the first place (e.g. "NaN" from an unparseable
// source value), so this must tolerate that rather than rendering it
// or crashing formatCents on it.
function formatRowAmount(rawAmount: string | null | undefined): string {
  if (rawAmount == null || rawAmount.trim() === "") return "—";
  if (!/^-?\d+$/.test(rawAmount.trim())) return "invalid";
  return formatCents(parseInt(rawAmount, 10));
}

function groupRowsByStatus(rows: ImportRow[]): Record<ImportRowMatchStatus, ImportRow[]> {
  const grouped: Record<ImportRowMatchStatus, ImportRow[]> = {
    new: [],
    changed: [],
    duplicate: [],
    unmatched: [],
    error: [],
    excluded: [],
  };
  for (const row of rows) {
    grouped[row.matchStatus].push(row);
  }
  return grouped;
}

export function ImportWizard({
  orgId,
  projectId,
  mappingProfiles,
  costCodes,
  createMappingProfile,
  listImportRows,
  overrideImportRow,
  excludeImportRow,
  confirmImportBatch,
  getImportBatchReconciliation,
}: ImportWizardProps) {
  const [step, setStep] = useState<WizardStep>("profile");
  const [selectedProfileId, setSelectedProfileId] = useState<string>(mappingProfiles[0]?.id ?? "");
  const [showCreateProfile, setShowCreateProfile] = useState(mappingProfiles.length === 0);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  // The single source of truth for every row's current match_status —
  // always replaced WHOLESALE from a fresh listImportRows() read, never
  // patched in place. See the file-level doc comment above.
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reconciliation, setReconciliation] = useState<ImportBatchReconciliation | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);

  const costCodesById = new Map(costCodes.map((cc) => [cc.id, cc]));

  async function refreshRows(id: string) {
    setRowsLoading(true);
    try {
      const result = await listImportRows(id);
      if (result.error) {
        setRowActionError(result.error);
        return;
      }
      setRows(result.rows);
      setRowActionError(null);
    } finally {
      setRowsLoading(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadError(null);

    if (!selectedProfileId) {
      setUploadError("Select or create a mapping profile first.");
      return;
    }
    if (!file) {
      setUploadError("Choose a CSV file to upload.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      formData.append("mappingProfileId", selectedProfileId);

      const response = await fetch("/api/imports/parse", { method: "POST", body: formData });
      const json = await response.json();

      if (!response.ok) {
        setUploadError(json.error ?? "Upload failed.");
        return;
      }

      setBatchId(json.batchId);
      await refreshRows(json.batchId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload the file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleOverride(rowId: string, costCodeId: string) {
    if (!costCodeId || !batchId) return;
    setRowActionError(null);
    const result = await overrideImportRow(rowId, costCodeId);
    if (result && "error" in result && result.error) {
      setRowActionError(result.error);
      return;
    }
    await refreshRows(batchId);
  }

  async function handleExclude(rowId: string) {
    if (!batchId) return;
    setRowActionError(null);
    const result = await excludeImportRow(rowId);
    if (result && "error" in result && result.error) {
      setRowActionError(result.error);
      return;
    }
    await refreshRows(batchId);
  }

  const unresolvedCount = rows.filter((r) => r.matchStatus === "unmatched" || r.matchStatus === "error").length;

  async function handleConfirm() {
    if (!batchId || unresolvedCount > 0) return;
    setConfirmError(null);
    setReconciliationError(null);
    setConfirming(true);
    try {
      const result = await confirmImportBatch(batchId);
      if (result && "error" in result && result.error) {
        setConfirmError(result.error);
        return;
      }
      setConfirmed(true);
      await refreshRows(batchId);

      const reconciliationResult = await getImportBatchReconciliation(batchId);
      if (reconciliationResult.error) {
        setReconciliationError(reconciliationResult.error);
        return;
      }
      setReconciliation(reconciliationResult.report ?? null);
    } finally {
      setConfirming(false);
    }
  }

  const grouped = groupRowsByStatus(rows);

  const stepItems: TabItem[] = [
    {
      key: "profile",
      label: selectedProfileId ? "1. Profile ✓" : "1. Profile",
      onClick: () => setStep("profile"),
    },
    {
      key: "upload",
      label: batchId ? "2. Upload & review ✓" : "2. Upload & review",
      onClick: () => batchId && setStep("upload"),
      disabled: !selectedProfileId,
    },
    {
      key: "confirm",
      label: confirmed ? "3. Confirm ✓" : "3. Confirm",
      onClick: () => batchId && setStep("confirm"),
      disabled: !batchId,
    },
  ];

  return (
    <div className="sc-import-wizard">
      <Tabs items={stepItems} activeKey={step} aria-label="Import wizard steps" />

      {step === "profile" && (
        <Card>
          <PageHeader title="Mapping profile" />
          <div className="sc-import-step-body">
            {mappingProfiles.length > 0 && !showCreateProfile && (
              <FormField label="Use an existing profile" htmlFor="sc-import-profile-select" className="sc-import-field">
                <Select
                  id="sc-import-profile-select"
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                >
                  {mappingProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            {!showCreateProfile && (
              <Button variant="secondary" size="sm" onClick={() => setShowCreateProfile(true)}>
                + Create a new mapping profile
              </Button>
            )}
            {showCreateProfile && (
              <>
                <MappingProfileForm
                  orgId={orgId}
                  createMappingProfile={createMappingProfile}
                  onCreated={(id) => {
                    setSelectedProfileId(id);
                    setShowCreateProfile(false);
                  }}
                />
                {mappingProfiles.length > 0 && (
                  <Button variant="secondary" size="sm" onClick={() => setShowCreateProfile(false)}>
                    Use an existing profile instead
                  </Button>
                )}
              </>
            )}
            <div className="sc-import-nav">
              <Button variant="primary" disabled={!selectedProfileId} onClick={() => setStep("upload")}>
                Continue to upload
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === "upload" && (
        <Card>
          <PageHeader title="Upload the QuickBooks CSV export" />
          <div className="sc-import-step-body">
            {!batchId && (
              <form onSubmit={handleUpload} className="sc-import-upload-form">
                <FormField label="QuickBooks CSV file" htmlFor="sc-import-file" className="sc-import-field">
                  <TextInput
                    id="sc-import-file"
                    type="file"
                    accept=".csv"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </FormField>
                <Button type="submit" variant="primary" disabled={uploading} loading={uploading} loadingText="Uploading…">
                  Upload &amp; parse
                </Button>
                {uploadError && <Alert tone="error">{uploadError}</Alert>}
              </form>
            )}

            {batchId && (
              <>
                {rowsLoading && <p>Loading rows…</p>}
                {rowActionError && <Alert tone="error">{rowActionError}</Alert>}
                {!rowsLoading && rows.length === 0 && (
                  <EmptyState title="No rows to review" description="This batch didn't produce any stageable rows." />
                )}
                {STATUS_ORDER.map((status) => {
                  const statusRows = grouped[status];
                  if (statusRows.length === 0) return null;
                  return (
                    <div key={status} className="sc-import-status-group">
                      <h4 className="sc-import-status-heading">
                        {STATUS_LABELS[status]} <Badge tone={STATUS_TONE[status]}>{statusRows.length}</Badge>
                      </h4>
                      <table className="sc-import-rows-table">
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left" }}>Item</th>
                            <th style={{ textAlign: "left" }}>Vendor</th>
                            <th style={{ textAlign: "left" }}>Date</th>
                            <th style={{ textAlign: "right" }}>Amount</th>
                            <th style={{ textAlign: "left" }}>Cost code</th>
                            <th style={{ textAlign: "left" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statusRows.map((row) => {
                            const currentCostCodeId = row.rawData.__resolved_cost_code_id ?? "";
                            const currentCostCode = currentCostCodeId ? costCodesById.get(currentCostCodeId) : undefined;
                            const canOverride = status !== "excluded" && status !== "duplicate";
                            const canExclude = status !== "excluded";
                            return (
                              <tr key={row.id}>
                                <td style={{ textAlign: "left" }}>{row.rawData.Item ?? ""}</td>
                                <td style={{ textAlign: "left" }}>{row.rawData.Name ?? ""}</td>
                                <td style={{ textAlign: "left" }}>{row.rawData.Date ?? ""}</td>
                                <td style={{ textAlign: "right" }}>{formatRowAmount(row.rawData.Amount)}</td>
                                <td style={{ textAlign: "left" }}>
                                  {canOverride ? (
                                    <Select
                                      value={currentCostCodeId}
                                      onChange={(e) => handleOverride(row.id, e.target.value)}
                                      aria-label={`Cost code for row ${row.rowNumber}`}
                                    >
                                      <option value="">— select —</option>
                                      {costCodes.map((cc) => (
                                        <option key={cc.id} value={cc.id}>
                                          {cc.code}
                                          {cc.activityName ? ` — ${cc.activityName}` : ""}
                                        </option>
                                      ))}
                                    </Select>
                                  ) : (
                                    currentCostCode?.code ?? currentCostCodeId ?? "—"
                                  )}
                                  {row.errorMessage && <div className="sc-import-row-error">{row.errorMessage}</div>}
                                </td>
                                <td style={{ textAlign: "left" }}>
                                  {canExclude && (
                                    <Button variant="secondary" size="sm" onClick={() => handleExclude(row.id)}>
                                      Exclude
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
                <div className="sc-import-nav">
                  <Button variant="primary" onClick={() => setStep("confirm")}>
                    Continue to confirm
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {step === "confirm" && batchId && (
        <Card>
          <PageHeader title="Confirm import" />
          <div className="sc-import-step-body">
            <ul className="sc-import-counts">
              {STATUS_ORDER.map((status) => (
                <li key={status} className="sc-import-count-row">
                  <span>{STATUS_LABELS[status]}</span>
                  <Badge tone={STATUS_TONE[status]}>{grouped[status].length}</Badge>
                </li>
              ))}
            </ul>
            {unresolvedCount > 0 && (
              <Alert tone="warning">
                {unresolvedCount} row(s) are still unmatched or errored. Resolve (assign a cost code) or exclude every
                one before confirming.
              </Alert>
            )}
            {!confirmed && (
              <Button
                variant="primary"
                disabled={confirming || unresolvedCount > 0}
                loading={confirming}
                loadingText="Confirming…"
                onClick={handleConfirm}
              >
                Confirm import
              </Button>
            )}
            {confirmError && <Alert tone="error">{confirmError}</Alert>}

            {confirmed && (
              <div className="sc-import-confirmed">
                <Alert tone="success" title="Batch confirmed">
                  Resulting expenses were posted with status &quot;pending&quot;.
                </Alert>
                {reconciliationError && <Alert tone="error">{reconciliationError}</Alert>}
                {reconciliation && (
                  <Card padding="compact">
                    <p className="sc-import-reconcile-line">
                      Imported total (from source file): {formatCents(reconciliation.importedTotalCents)}
                    </p>
                    <p className="sc-import-reconcile-line">
                      Resulting expenses total (from database): {formatCents(reconciliation.resultingExpensesTotalCents)}
                    </p>
                    {reconciliation.matches ? (
                      <Alert tone="success">Totals match.</Alert>
                    ) : (
                      <Alert tone="error" title="Mismatch">
                        Difference of {formatCents(reconciliation.differenceCents)}. Investigate before relying on this
                        batch&apos;s numbers.
                      </Alert>
                    )}
                  </Card>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
      <style dangerouslySetInnerHTML={{ __html: wizardStyles }} />
    </div>
  );
}

const wizardStyles = `
.sc-import-wizard { display: flex; flex-direction: column; gap: ${spacing.lg}; font-family: ${typography.fontFamily}; }
.sc-import-step-body { display: flex; flex-direction: column; gap: ${spacing.md}; max-width: 900px; }
.sc-import-field { max-width: 420px; }
.sc-import-upload-form { display: flex; flex-direction: column; gap: ${spacing.sm}; align-items: flex-start; max-width: 420px; }
.sc-import-nav { margin-top: ${spacing.sm}; }
.sc-import-row-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; margin-top: 4px; }
.sc-import-status-group { margin-top: ${spacing.md}; }
.sc-import-status-heading { display: flex; align-items: center; gap: ${spacing.sm}; font-size: ${typography.sizeSm}; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 6px; }
.sc-import-rows-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; }
.sc-import-rows-table th { padding: 6px 8px; border-bottom: 1px solid ${colors.line}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-import-rows-table td { padding: 6px 8px; border-bottom: 1px solid ${colors.paperDim}; vertical-align: top; }
.sc-import-counts { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: ${spacing.xs}; font-size: ${typography.sizeSm}; }
.sc-import-count-row { display: flex; align-items: center; gap: ${spacing.sm}; }
.sc-import-confirmed { display: flex; flex-direction: column; gap: ${spacing.sm}; margin-top: ${spacing.md}; }
.sc-import-reconcile-line { margin: 0 0 ${spacing.xs} 0; font-size: ${typography.sizeSm}; color: ${colors.ink}; }
`;
