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
 */
import React, { useState } from "react";
import { colors, spacing, typography, radius } from "../design/tokens";
import { formatCents } from "../../../01-financial-engine/src/money";
import type { CostCode } from "../../../01-financial-engine/src/types";
import { MappingProfileForm } from "./MappingProfileForm";
import type { MappingProfile } from "../services/importMappingService";
import type { ImportRow, ImportRowMatchStatus, ImportBatchReconciliation } from "../services/importService";

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

  return (
    <div className="sc-import-wizard">
      <div className="sc-import-steps">
        <StepTab label="1. Profile" active={step === "profile"} done={!!selectedProfileId} onClick={() => setStep("profile")} />
        <StepTab label="2. Upload & review" active={step === "upload"} done={!!batchId} onClick={() => batchId && setStep("upload")} disabled={!selectedProfileId} />
        <StepTab label="3. Confirm" active={step === "confirm"} done={confirmed} onClick={() => batchId && setStep("confirm")} disabled={!batchId} />
      </div>

      {step === "profile" && (
        <section className="sc-import-section">
          <h3>Mapping profile</h3>
          {mappingProfiles.length > 0 && !showCreateProfile && (
            <div className="sc-import-field">
              <label htmlFor="sc-import-profile-select">Use an existing profile</label>
              <select
                id="sc-import-profile-select"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="sc-import-input"
              >
                {mappingProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!showCreateProfile && (
            <button type="button" className="sc-import-btn" onClick={() => setShowCreateProfile(true)}>
              + Create a new mapping profile
            </button>
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
                <button type="button" className="sc-import-btn" onClick={() => setShowCreateProfile(false)}>
                  Use an existing profile instead
                </button>
              )}
            </>
          )}
          <div className="sc-import-nav">
            <button type="button" className="sc-import-btn sc-import-btn-primary" disabled={!selectedProfileId} onClick={() => setStep("upload")}>
              Continue to upload
            </button>
          </div>
        </section>
      )}

      {step === "upload" && (
        <section className="sc-import-section">
          <h3>Upload the QuickBooks CSV export</h3>
          {!batchId && (
            <form onSubmit={handleUpload} className="sc-import-upload-form">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                aria-label="QuickBooks CSV file"
              />
              <button type="submit" className="sc-import-btn sc-import-btn-primary" disabled={uploading}>
                {uploading ? "Uploading…" : "Upload & parse"}
              </button>
              {uploadError && <div className="sc-import-error">{uploadError}</div>}
            </form>
          )}

          {batchId && (
            <>
              {rowsLoading && <p>Loading rows…</p>}
              {rowActionError && <div className="sc-import-error">{rowActionError}</div>}
              {STATUS_ORDER.map((status) => {
                const statusRows = grouped[status];
                if (statusRows.length === 0) return null;
                return (
                  <div key={status} className="sc-import-status-group">
                    <h4>
                      {STATUS_LABELS[status]} ({statusRows.length})
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
                                  <select
                                    value={currentCostCodeId}
                                    onChange={(e) => handleOverride(row.id, e.target.value)}
                                    className="sc-import-input"
                                    aria-label={`Cost code for row ${row.rowNumber}`}
                                  >
                                    <option value="">— select —</option>
                                    {costCodes.map((cc) => (
                                      <option key={cc.id} value={cc.id}>
                                        {cc.code}
                                        {cc.activityName ? ` — ${cc.activityName}` : ""}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  currentCostCode?.code ?? currentCostCodeId ?? "—"
                                )}
                                {row.errorMessage && <div className="sc-import-error">{row.errorMessage}</div>}
                              </td>
                              <td style={{ textAlign: "left" }}>
                                {canExclude && (
                                  <button type="button" className="sc-import-btn" onClick={() => handleExclude(row.id)}>
                                    Exclude
                                  </button>
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
                <button type="button" className="sc-import-btn sc-import-btn-primary" onClick={() => setStep("confirm")}>
                  Continue to confirm
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {step === "confirm" && batchId && (
        <section className="sc-import-section">
          <h3>Confirm import</h3>
          <ul className="sc-import-counts">
            {STATUS_ORDER.map((status) => (
              <li key={status}>
                {STATUS_LABELS[status]}: {grouped[status].length}
              </li>
            ))}
          </ul>
          {unresolvedCount > 0 && (
            <div className="sc-import-error">
              {unresolvedCount} row(s) are still unmatched or errored. Resolve (assign a cost code) or exclude every
              one before confirming.
            </div>
          )}
          {!confirmed && (
            <button
              type="button"
              className="sc-import-btn sc-import-btn-primary"
              disabled={confirming || unresolvedCount > 0}
              onClick={handleConfirm}
            >
              {confirming ? "Confirming…" : "Confirm import"}
            </button>
          )}
          {confirmError && <div className="sc-import-error">{confirmError}</div>}

          {confirmed && (
            <div className="sc-import-confirmed">
              <p>Batch confirmed. Resulting expenses were posted with status &quot;pending&quot;.</p>
              {reconciliationError && <div className="sc-import-error">{reconciliationError}</div>}
              {reconciliation && (
                <div className={reconciliation.matches ? "sc-import-reconcile-ok" : "sc-import-reconcile-mismatch"}>
                  <p>Imported total (from source file): {formatCents(reconciliation.importedTotalCents)}</p>
                  <p>Resulting expenses total (from database): {formatCents(reconciliation.resultingExpensesTotalCents)}</p>
                  {reconciliation.matches ? (
                    <p>Totals match.</p>
                  ) : (
                    <p className="sc-import-mismatch-callout">
                      MISMATCH: difference of {formatCents(reconciliation.differenceCents)}. Investigate before
                      relying on this batch&apos;s numbers.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}
      <style>{wizardStyles}</style>
    </div>
  );
}

function StepTab({
  label,
  active,
  done,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  done: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sc-import-step-tab${active ? " sc-import-step-tab-active" : ""}${done ? " sc-import-step-tab-done" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

const wizardStyles = `
.sc-import-wizard { display: flex; flex-direction: column; gap: ${spacing.lg}; font-family: ${typography.fontFamily}; }
.sc-import-steps { display: flex; gap: ${spacing.sm}; }
.sc-import-step-tab { padding: 7px 14px; border: 1px solid ${colors.line}; border-radius: ${radius.pill}; background: ${colors.white}; color: ${colors.ink2}; font-size: ${typography.sizeSm}; cursor: pointer; }
.sc-import-step-tab-active { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-import-step-tab-done:not(.sc-import-step-tab-active) { border-color: ${colors.sage}; color: ${colors.sageDeep}; }
.sc-import-step-tab:disabled { opacity: 0.5; cursor: not-allowed; }
.sc-import-section { display: flex; flex-direction: column; gap: ${spacing.md}; max-width: 900px; }
.sc-import-field { display: flex; flex-direction: column; gap: 4px; max-width: 420px; }
.sc-import-field label { font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
.sc-import-input { padding: 6px 8px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; color: ${colors.ink}; background: ${colors.white}; }
.sc-import-upload-form { display: flex; flex-direction: column; gap: ${spacing.sm}; align-items: flex-start; }
.sc-import-btn { padding: 7px 13px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; background: ${colors.white}; color: ${colors.ink2}; font-size: ${typography.sizeSm}; cursor: pointer; align-self: flex-start; }
.sc-import-btn-primary { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-import-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-import-nav { margin-top: ${spacing.sm}; }
.sc-import-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; margin-top: 4px; }
.sc-import-status-group { margin-top: ${spacing.md}; }
.sc-import-status-group h4 { font-size: ${typography.sizeSm}; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 6px; }
.sc-import-rows-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; }
.sc-import-rows-table th { padding: 6px 8px; border-bottom: 1px solid ${colors.line}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-import-rows-table td { padding: 6px 8px; border-bottom: 1px solid ${colors.paperDim}; vertical-align: top; }
.sc-import-counts { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; font-size: ${typography.sizeSm}; }
.sc-import-confirmed { margin-top: ${spacing.md}; padding: ${spacing.md}; border-radius: ${radius.md}; background: ${colors.paperDim}; }
.sc-import-reconcile-ok { color: ${colors.sageDeep}; }
.sc-import-reconcile-mismatch { color: ${colors.brick}; border: 1px solid ${colors.brick}; border-radius: ${radius.md}; padding: ${spacing.sm}; }
.sc-import-mismatch-callout { font-weight: ${typography.weightBold}; font-size: ${typography.sizeMd}; }
`;
