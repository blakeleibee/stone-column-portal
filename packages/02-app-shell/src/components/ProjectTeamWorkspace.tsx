"use client";

/**
 * `/admin/projects/[id]/team` (P3, Task 6) — the project-scoped screen
 * for managing `project_staff_assignments` (assign/revoke/reactivate,
 * Decision 11's lifecycle) and viewing the project's client/vendor
 * `project_members`. Single Client Component owning both lists + the
 * assign form, same shape as BidPackageWorkspace.tsx/ProjectListWorkspace.tsx:
 * every Server Action is passed in as a prop from page.tsx, never
 * imported directly, so this package stays free of any
 * apps/web/next/headers dependency.
 *
 * Judgment call (Task 6 brief flagged this as worth verifying, not
 * assuming): the brief describes a P5 "vendor-membership revoke/
 * reactivate UI" to mirror. `revokeVendorMember`/`reactivateVendorMember`
 * (bidService.ts) exist as service functions and Server Action wrappers
 * (apps/web/app/admin/bids/actions.ts), but actions.ts's own comment
 * says "No screen in P5 calls these two yet" — BidPackageWorkspace.tsx
 * never renders a revoke/reactivate control. There is no shipped UI to
 * mirror. What IS mirrored here is BidPackageWorkspace's actual
 * established pattern for a destructive/state-changing per-row action:
 * click -> inline confirm (not a native `confirm()`) -> submit, with
 * per-row submitting/error state keyed by id (see handleAwardClick/
 * handleAwardConfirm/handleAwardCancel there) — applied to Revoke here,
 * the closest real precedent in this codebase for this exact
 * interaction shape.
 *
 * RLS reality this UI is built around (schema/016's
 * project_staff_assignments_admin_manage policy is `for all`, SELECT
 * included, admin-only): a non-admin viewer does not get an empty
 * staff-assignments list back from RLS — they get zero rows for a
 * reason the UI must not misrepresent as "no staff assigned yet". This
 * component never even receives a real `staffAssignments` array for a
 * non-admin caller (the page passes `[]` deliberately without querying,
 * see the page's own comment) and renders an explicit restricted-access
 * message instead of the empty-list state whenever `isAdmin` is false.
 *
 * Visual modernization pass: rebuilt on the shared `ui/` primitives
 * (`PageHeader`/`Card`/`StatusBadge`/`Badge`/`Alert`/`Button`/
 * `MenuButton`/`FormField`/`FormGrid`/`Select`/`TextInput`/`Textarea`/
 * `EmptyState`) in place of this file's own `sc-team-*`/`sc-handoff-*`
 * hand-rolled markup+CSS. Markup/styling only — every state variable,
 * handler, and Server Action call below is unchanged, and in particular:
 *   - the revoke flow is still click "Revoke" -> inline confirm ("Yes,
 *     revoke" / "Cancel") -> submit; nothing became a single-click
 *     destructive action.
 *   - the assign/revoke/reactivate/edit-handoff controls (and the
 *     admin-only restricted message) are still gated on the exact same
 *     `isAdmin` prop, in the same place.
 *   - "Edit handoff" and the revoke/reactivate lifecycle action are now
 *     grouped as one primary `Button` ("Edit handoff"/"Close", the
 *     highest-frequency action on this row) plus one secondary action
 *     behind a `MenuButton` ("Revoke" or "Reactivate," gated the same
 *     way as before) instead of two separately-placed buttons — see the
 *     inline comment above the actions cell for the reasoning.
 */
import React, { useState } from "react";
import { colors, spacing, typography, radius } from "../design/tokens";
import { Card, PageHeader, Badge, StatusBadge, Alert, Button, MenuButton, FormField, FormGrid, Select, TextInput, Textarea, EmptyState } from "./ui";
import type { BadgeTone } from "./ui";
import type {
  ProjectStaffAssignmentRow,
  ProjectMemberRow,
  StaffFunction,
  StaffRequestType,
  HandoffPriority,
} from "../services/projectService";
import type { StaffAssignmentHandoffFields } from "../services/projectIntakeService";

export interface StaffCandidate {
  id: string;
  name: string;
  staffFunction: StaffFunction | null;
}

// Exported (not just module-local) so AdminOverviewScreen.tsx's "Your
// assignment" card (Task 9, design §8) can render the same humanized
// labels for staff_function/requested_work/priority without a second,
// drifting copy of these three lookup tables.
export const STAFF_FUNCTION_LABELS: Record<StaffFunction, string> = {
  project_manager: "Project Manager",
  superintendent: "Superintendent",
  accounting: "Accounting",
  general: "General",
};

// Task 9 (P3.1 design §8) — the 7 requested_work values / 4 priority
// values, matching schema/018 Step 4's staff_request_type/handoff_priority
// enums exactly.
export const REQUESTED_WORK_LABELS: Record<StaffRequestType, string> = {
  estimating: "Estimating",
  planning: "Planning",
  site_review: "Site review",
  permitting: "Permitting",
  scheduling: "Scheduling",
  vendor_pricing: "Vendor pricing",
  other: "Other",
};
const REQUESTED_WORK_OPTIONS = Object.keys(REQUESTED_WORK_LABELS) as StaffRequestType[];

export const PRIORITY_LABELS: Record<HandoffPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
const PRIORITY_OPTIONS = Object.keys(PRIORITY_LABELS) as HandoffPriority[];

// Same tone-per-priority mapping the old sc-handoff-priority-* classes
// encoded (low -> muted neutral, high -> gold, urgent -> brick) — only
// consulted when priority !== "normal" (see the handoff-summary cell
// below), so "normal" is never actually looked up, but is listed for
// completeness against the full HandoffPriority union.
const PRIORITY_BADGE_TONE: Record<HandoffPriority, BadgeTone> = {
  low: "neutral",
  normal: "neutral",
  high: "gold",
  urgent: "brick",
};

interface HandoffDraft {
  requestedWork: StaffRequestType | "";
  priority: HandoffPriority;
  targetDueDate: string;
  nextAction: string;
  internalInstructions: string;
}

function draftFromAssignment(a: ProjectStaffAssignmentRow): HandoffDraft {
  return {
    requestedWork: a.requestedWork ?? "",
    priority: a.priority,
    targetDueDate: a.targetDueDate ?? "",
    nextAction: a.nextAction ?? "",
    internalInstructions: a.internalInstructions ?? "",
  };
}

const MEMBER_ROLE_LABELS: Record<ProjectMemberRow["memberRole"], string> = {
  client: "Client",
  vendor: "Vendor",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export interface ProjectTeamWorkspaceProps {
  projectId: string;
  projectName: string;
  /** Whether the acting session is an admin. Governs both what's
   *  actually reachable (RLS) and what state this component renders for
   *  the staff-assignments section — never assign/revoke/reactivate
   *  controls for a non-admin, since the RLS layer would reject every
   *  one of those writes anyway (Decision 1a). */
  isAdmin: boolean;
  /** Server-rendered initial value. For a non-admin caller, page.tsx
   *  deliberately passes `[]` without ever querying
   *  project_staff_assignments (RLS would return zero rows regardless,
   *  but skipping the query is the more honest signal — see this file's
   *  header comment) — isAdmin, not this array's length, is what this
   *  component uses to decide whether to render the restricted-access
   *  message. */
  staffAssignments: ProjectStaffAssignmentRow[];
  /** Org staff not yet on this project's roster in any state (active or
   *  revoked) — filtered again client-side against the live
   *  `staffAssignments` state below so a reactivated/newly-assigned name
   *  disappears from the picker without a second server round trip. */
  candidateStaff: StaffCandidate[];
  members: ProjectMemberRow[];
  assignStaff: (projectId: string, profileId: string) => Promise<{ error?: string }>;
  revokeAssignment: (assignmentId: string) => Promise<{ error?: string }>;
  reactivateAssignment: (assignmentId: string) => Promise<{ error?: string }>;
  refreshAssignments: (projectId: string) => Promise<{ assignments?: ProjectStaffAssignmentRow[]; error?: string }>;
  /** Task 9 (P3.1 design §8) — updates only the 5 handoff-note columns
   *  on an existing assignment row. Same admin-only write policy as
   *  assign/revoke/reactivate (project_staff_assignments_admin_manage) —
   *  the form this drives is only ever rendered inside the `isAdmin`
   *  branch below, matching every other write control in this
   *  component. */
  updateHandoff: (assignmentId: string, fields: StaffAssignmentHandoffFields) => Promise<{} | { error: string }>;
}

export function ProjectTeamWorkspace({
  projectId,
  projectName,
  isAdmin,
  staffAssignments: initialStaffAssignments,
  candidateStaff,
  members,
  assignStaff,
  revokeAssignment,
  reactivateAssignment,
  refreshAssignments,
  updateHandoff,
}: ProjectTeamWorkspaceProps) {
  const [staffAssignments, setStaffAssignments] = useState<ProjectStaffAssignmentRow[]>(initialStaffAssignments);
  const [listError, setListError] = useState<string | null>(null);

  const [assignProfileId, setAssignProfileId] = useState("");
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [revokeSubmitting, setRevokeSubmitting] = useState<Record<string, boolean>>({});
  const [revokeErrors, setRevokeErrors] = useState<Record<string, string | null>>({});

  const [reactivateSubmitting, setReactivateSubmitting] = useState<Record<string, boolean>>({});
  const [reactivateErrors, setReactivateErrors] = useState<Record<string, string | null>>({});

  // Task 9 (P3.1 design §8) — handoff-note inline edit. Only one row's
  // form is ever open at a time (same single-active-editor shape as
  // revokeConfirmId above), so a single draft object (not a Record keyed
  // by id) is enough.
  const [handoffEditId, setHandoffEditId] = useState<string | null>(null);
  const [handoffDraft, setHandoffDraft] = useState<HandoffDraft | null>(null);
  const [handoffSubmitting, setHandoffSubmitting] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  // Never patches state in place — every successful mutation is
  // followed by a full re-fetch whose result wholesale-replaces
  // staffAssignments, same discipline as BidPackageWorkspace's
  // loadDetail.
  async function reload() {
    const result = await refreshAssignments(projectId);
    if (result.error) {
      setListError(result.error);
      return;
    }
    setListError(null);
    setStaffAssignments(result.assignments ?? []);
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignProfileId) {
      setAssignError("Select a staff member to assign.");
      return;
    }
    setAssignError(null);
    setAssignSubmitting(true);
    try {
      const result = await assignStaff(projectId, assignProfileId);
      if (result.error) {
        setAssignError(result.error);
        return;
      }
      setAssignProfileId("");
      await reload();
    } finally {
      setAssignSubmitting(false);
    }
  }

  function handleRevokeClick(assignmentId: string) {
    setRevokeConfirmId(assignmentId);
    setRevokeErrors((prev) => ({ ...prev, [assignmentId]: null }));
  }

  function handleRevokeCancel() {
    setRevokeConfirmId(null);
  }

  async function handleRevokeConfirm(assignmentId: string) {
    setRevokeSubmitting((prev) => ({ ...prev, [assignmentId]: true }));
    try {
      const result = await revokeAssignment(assignmentId);
      if (result.error) {
        setRevokeErrors((prev) => ({ ...prev, [assignmentId]: result.error! }));
        return;
      }
      setRevokeConfirmId(null);
      await reload();
    } finally {
      setRevokeSubmitting((prev) => ({ ...prev, [assignmentId]: false }));
    }
  }

  async function handleReactivate(assignmentId: string) {
    setReactivateErrors((prev) => ({ ...prev, [assignmentId]: null }));
    setReactivateSubmitting((prev) => ({ ...prev, [assignmentId]: true }));
    try {
      const result = await reactivateAssignment(assignmentId);
      if (result.error) {
        setReactivateErrors((prev) => ({ ...prev, [assignmentId]: result.error! }));
        return;
      }
      await reload();
    } finally {
      setReactivateSubmitting((prev) => ({ ...prev, [assignmentId]: false }));
    }
  }

  function handleHandoffEditToggle(a: ProjectStaffAssignmentRow) {
    if (handoffEditId === a.id) {
      setHandoffEditId(null);
      setHandoffDraft(null);
      return;
    }
    setHandoffEditId(a.id);
    setHandoffDraft(draftFromAssignment(a));
    setHandoffError(null);
  }

  function handleHandoffCancel() {
    setHandoffEditId(null);
    setHandoffDraft(null);
    setHandoffError(null);
  }

  async function handleHandoffSave(assignmentId: string) {
    if (!handoffDraft) return;
    setHandoffError(null);
    setHandoffSubmitting(true);
    try {
      const result = await updateHandoff(assignmentId, {
        requestedWork: handoffDraft.requestedWork === "" ? null : handoffDraft.requestedWork,
        priority: handoffDraft.priority,
        targetDueDate: handoffDraft.targetDueDate === "" ? null : handoffDraft.targetDueDate,
        nextAction: handoffDraft.nextAction.trim() === "" ? null : handoffDraft.nextAction,
        internalInstructions: handoffDraft.internalInstructions.trim() === "" ? null : handoffDraft.internalInstructions,
      });
      if ("error" in result && result.error) {
        setHandoffError(result.error);
        return;
      }
      setHandoffEditId(null);
      setHandoffDraft(null);
      await reload();
    } finally {
      setHandoffSubmitting(false);
    }
  }

  const assignedProfileIds = new Set(staffAssignments.map((a) => a.profileId));
  const availableCandidates = candidateStaff.filter((c) => !assignedProfileIds.has(c.id));
  const assignHint =
    availableCandidates.length === 0 && candidateStaff.length > 0
      ? "Every staff member in your organization already has a record for this project."
      : candidateStaff.length === 0
        ? "No other staff members exist in your organization yet."
        : undefined;

  return (
    <div className="sc-team-workspace">
      <PageHeader title={`${projectName} — Team`} />

      <Card className="sc-team-section">
        <h3 className="sc-team-section-title">Staff assignments</h3>
        {!isAdmin ? (
          <Alert tone="info">
            Staff assignments are visible to admins only. Ask an admin if you need to see or change who&rsquo;s
            assigned to this project.
          </Alert>
        ) : (
          <>
            {listError && (
              <Alert tone="error" className="sc-team-section-alert">
                {listError}
              </Alert>
            )}
            {staffAssignments.length === 0 ? (
              <EmptyState title="No staff assigned yet." />
            ) : (
              <div className="sc-team-table-wrap">
                <table className="sc-team-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Name</th>
                      <th style={{ textAlign: "left" }}>Function</th>
                      <th style={{ textAlign: "left" }}>Status</th>
                      <th style={{ textAlign: "left" }}>Handoff</th>
                      <th style={{ textAlign: "left" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffAssignments.map((a) => (
                      <React.Fragment key={a.id}>
                        <tr>
                          <td>{a.profileName}</td>
                          <td>{a.staffFunction ? STAFF_FUNCTION_LABELS[a.staffFunction] : "—"}</td>
                          <td>
                            {a.revokedAt ? (
                              <StatusBadge
                                tone="brick"
                                label={`Revoked ${formatDateTime(a.revokedAt)}${a.revokedByName ? ` by ${a.revokedByName}` : ""}`}
                              />
                            ) : (
                              <StatusBadge
                                tone="sage"
                                label={`Active since ${formatDateTime(a.assignedAt)}${a.assignedByName ? ` (by ${a.assignedByName})` : ""}`}
                              />
                            )}
                          </td>
                          <td>
                            <div className="sc-handoff-summary">
                              {a.priority !== "normal" && (
                                <Badge tone={PRIORITY_BADGE_TONE[a.priority]} className="sc-handoff-priority-badge">
                                  {PRIORITY_LABELS[a.priority]}
                                </Badge>
                              )}
                              <div>{a.requestedWork ? REQUESTED_WORK_LABELS[a.requestedWork] : "No request set"}</div>
                              {a.targetDueDate && <div className="sc-handoff-due">Due {a.targetDueDate}</div>}
                              {a.nextAction && <div className="sc-handoff-next">{a.nextAction}</div>}
                            </div>
                          </td>
                          <td>
                            {/* One primary action ("Edit handoff" — the
                                highest-frequency, non-destructive action
                                on this row, available regardless of
                                active/revoked state) plus one secondary
                                lifecycle action behind a MenuButton
                                ("Revoke" while active, "Reactivate" while
                                revoked) — collapses what used to be two
                                separately-placed buttons (one in this
                                cell, one in the Handoff cell) into a
                                single hierarchy. The revoke confirm step
                                is unchanged: choosing "Revoke" from the
                                menu only arms `revokeConfirmId`, it never
                                submits directly — the actual write still
                                requires the explicit "Yes, revoke" click
                                below. */}
                            {revokeConfirmId === a.id ? (
                              <Alert tone="warning" className="sc-team-confirm">
                                <p className="sc-team-confirm-question">Revoke this assignment for {a.profileName}?</p>
                                <div className="sc-team-confirm-actions">
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    loading={!!revokeSubmitting[a.id]}
                                    loadingText="Revoking…"
                                    onClick={() => handleRevokeConfirm(a.id)}
                                  >
                                    Yes, revoke
                                  </Button>
                                  <Button variant="secondary" size="sm" onClick={handleRevokeCancel}>
                                    Cancel
                                  </Button>
                                </div>
                              </Alert>
                            ) : (
                              <div className="sc-team-actions">
                                <Button size="sm" variant="secondary" onClick={() => handleHandoffEditToggle(a)}>
                                  {handoffEditId === a.id ? "Close" : "Edit handoff"}
                                </Button>
                                <MenuButton
                                  label="More"
                                  align="end"
                                  items={
                                    a.revokedAt
                                      ? [
                                          {
                                            key: "reactivate",
                                            label: reactivateSubmitting[a.id] ? "Reactivating…" : "Reactivate",
                                            onClick: () => handleReactivate(a.id),
                                            disabled: !!reactivateSubmitting[a.id],
                                          },
                                        ]
                                      : [
                                          {
                                            key: "revoke",
                                            label: "Revoke",
                                            onClick: () => handleRevokeClick(a.id),
                                          },
                                        ]
                                  }
                                />
                              </div>
                            )}
                            {revokeErrors[a.id] && (
                              <Alert tone="error" className="sc-team-row-alert">
                                {revokeErrors[a.id]}
                              </Alert>
                            )}
                            {reactivateErrors[a.id] && (
                              <Alert tone="error" className="sc-team-row-alert">
                                {reactivateErrors[a.id]}
                              </Alert>
                            )}
                          </td>
                        </tr>
                        {handoffEditId === a.id && handoffDraft && (
                          <tr>
                            <td colSpan={5}>
                              <div className="sc-handoff-form-wrap">
                                <FormGrid columns={2}>
                                  <FormField label="Requested work">
                                    <Select
                                      value={handoffDraft.requestedWork}
                                      onChange={(e) =>
                                        setHandoffDraft((prev) =>
                                          prev ? { ...prev, requestedWork: e.target.value as StaffRequestType | "" } : prev
                                        )
                                      }
                                    >
                                      <option value="">— none —</option>
                                      {REQUESTED_WORK_OPTIONS.map((v) => (
                                        <option key={v} value={v}>
                                          {REQUESTED_WORK_LABELS[v]}
                                        </option>
                                      ))}
                                    </Select>
                                  </FormField>
                                  <FormField label="Priority">
                                    <Select
                                      value={handoffDraft.priority}
                                      onChange={(e) =>
                                        setHandoffDraft((prev) => (prev ? { ...prev, priority: e.target.value as HandoffPriority } : prev))
                                      }
                                    >
                                      {PRIORITY_OPTIONS.map((v) => (
                                        <option key={v} value={v}>
                                          {PRIORITY_LABELS[v]}
                                        </option>
                                      ))}
                                    </Select>
                                  </FormField>
                                  <FormField label="Target due date">
                                    <TextInput
                                      type="date"
                                      value={handoffDraft.targetDueDate}
                                      onChange={(e) => setHandoffDraft((prev) => (prev ? { ...prev, targetDueDate: e.target.value } : prev))}
                                    />
                                  </FormField>
                                  <FormField label="Next action">
                                    <TextInput
                                      type="text"
                                      value={handoffDraft.nextAction}
                                      onChange={(e) => setHandoffDraft((prev) => (prev ? { ...prev, nextAction: e.target.value } : prev))}
                                      placeholder="e.g. Confirm vendor pricing by Friday"
                                    />
                                  </FormField>
                                  <FormField label="Internal instructions" className="sc-handoff-field-full">
                                    <Textarea
                                      rows={3}
                                      value={handoffDraft.internalInstructions}
                                      onChange={(e) =>
                                        setHandoffDraft((prev) => (prev ? { ...prev, internalInstructions: e.target.value } : prev))
                                      }
                                    />
                                  </FormField>
                                </FormGrid>
                                <div className="sc-handoff-form-actions">
                                  <Button loading={handoffSubmitting} loadingText="Saving…" onClick={() => handleHandoffSave(a.id)}>
                                    Save handoff
                                  </Button>
                                  <Button variant="secondary" onClick={handleHandoffCancel}>
                                    Cancel
                                  </Button>
                                </div>
                                {handoffError && <Alert tone="error">{handoffError}</Alert>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form onSubmit={handleAssign} className="sc-team-assign-form">
              <FormGrid columns={2}>
                <FormField label="Assign a staff member" hint={assignHint} error={assignError ?? undefined}>
                  <Select value={assignProfileId} onChange={(e) => setAssignProfileId(e.target.value)}>
                    <option value="">— select a staff member —</option>
                    {availableCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.staffFunction ? ` — ${STAFF_FUNCTION_LABELS[c.staffFunction]}` : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <div className="sc-team-assign-action">
                  {/* Height-matched to FormField's own label row so the
                      button's top edge lines up with the select's top
                      edge in the FormGrid row, even though this action
                      has no label of its own. */}
                  <span className="sc-team-assign-action-spacer" aria-hidden="true" />
                  <Button type="submit" loading={assignSubmitting} loadingText="Assigning…">
                    Assign
                  </Button>
                </div>
              </FormGrid>
            </form>
          </>
        )}
      </Card>

      <Card className="sc-team-section">
        <h3 className="sc-team-section-title">Client &amp; vendor contacts</h3>
        {members.length === 0 ? (
          <EmptyState title="No client or vendor contacts on this project yet." />
        ) : (
          <div className="sc-team-table-wrap">
            <table className="sc-team-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Name</th>
                  <th style={{ textAlign: "left" }}>Role</th>
                  <th style={{ textAlign: "left" }}>Added</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.userName}
                      {m.isPrimary && (
                        <Badge tone="gold" className="sc-team-primary-tag">
                          Primary
                        </Badge>
                      )}
                    </td>
                    <td>{MEMBER_ROLE_LABELS[m.memberRole]}</td>
                    <td>{formatDateTime(m.addedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <style dangerouslySetInnerHTML={{ __html: workspaceStyles }} />
    </div>
  );
}

const workspaceStyles = `
.sc-team-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; display: flex; flex-direction: column; gap: ${spacing.lg}; }
.sc-team-section-title { margin: 0 0 ${spacing.md} 0; font-size: ${typography.sizeMd}; }
.sc-team-section-alert { margin-bottom: ${spacing.md}; }

.sc-team-table-wrap { overflow-x: auto; margin-bottom: ${spacing.md}; }
.sc-team-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; }
.sc-team-table th { padding: ${spacing.xs} ${spacing.sm}; border-bottom: 1px solid ${colors.line}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; }
.sc-team-table td { padding: ${spacing.sm}; border-bottom: 1px solid ${colors.paperDim}; vertical-align: top; }

.sc-team-actions { display: flex; align-items: center; gap: ${spacing.xs}; }
.sc-team-row-alert { margin-top: ${spacing.xs}; max-width: 320px; }
.sc-team-confirm { display: flex; flex-direction: column; gap: ${spacing.xs}; align-items: flex-start; max-width: 320px; }
.sc-team-confirm-question { margin: 0; }
.sc-team-confirm-actions { display: flex; gap: ${spacing.xs}; }

.sc-team-primary-tag { margin-left: ${spacing.xs}; }

.sc-handoff-summary { font-size: ${typography.sizeXs}; color: ${colors.ink2}; display: flex; flex-direction: column; gap: 3px; max-width: 220px; }
.sc-handoff-priority-badge { width: fit-content; }
.sc-handoff-due { color: ${colors.stoneDark}; }
.sc-handoff-next { color: ${colors.ink}; font-style: italic; }

.sc-handoff-form-wrap { background: ${colors.paperDim}; border-radius: ${radius.md}; padding: ${spacing.md}; }
.sc-handoff-field-full { grid-column: 1 / -1; }
.sc-handoff-form-actions { display: flex; gap: ${spacing.sm}; margin-top: ${spacing.md}; }

.sc-team-assign-form { margin-top: ${spacing.sm}; }
.sc-team-assign-action { display: flex; flex-direction: column; gap: ${spacing["2xs"]}; }
.sc-team-assign-action-spacer { height: ${typography.sizeXs}; line-height: 1.4; }
`;
