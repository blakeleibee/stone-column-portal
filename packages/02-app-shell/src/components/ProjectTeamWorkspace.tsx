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
 */
import React, { useState } from "react";
import { colors, spacing, typography, radius } from "../design/tokens";
import type { ProjectStaffAssignmentRow, ProjectMemberRow, StaffFunction } from "../services/projectService";

export interface StaffCandidate {
  id: string;
  name: string;
  staffFunction: StaffFunction | null;
}

const STAFF_FUNCTION_LABELS: Record<StaffFunction, string> = {
  project_manager: "Project Manager",
  superintendent: "Superintendent",
  accounting: "Accounting",
  general: "General",
};

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

  const assignedProfileIds = new Set(staffAssignments.map((a) => a.profileId));
  const availableCandidates = candidateStaff.filter((c) => !assignedProfileIds.has(c.id));

  return (
    <div className="sc-team-workspace">
      <h2>{projectName} — Team</h2>

      <section className="sc-team-section">
        <h3>Staff assignments</h3>
        {!isAdmin ? (
          <p className="sc-team-restricted">
            Staff assignments are visible to admins only. Ask an admin if you need to see or change who&rsquo;s
            assigned to this project.
          </p>
        ) : (
          <>
            {listError && <div className="sc-team-error">{listError}</div>}
            {staffAssignments.length === 0 ? (
              <p className="sc-team-empty">No staff assigned yet.</p>
            ) : (
              <table className="sc-team-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Name</th>
                    <th style={{ textAlign: "left" }}>Function</th>
                    <th style={{ textAlign: "left" }}>Status</th>
                    <th style={{ textAlign: "left" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staffAssignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.profileName}</td>
                      <td>{a.staffFunction ? STAFF_FUNCTION_LABELS[a.staffFunction] : "—"}</td>
                      <td>
                        {a.revokedAt ? (
                          <span className="sc-team-badge sc-team-badge-revoked">
                            Revoked {formatDateTime(a.revokedAt)}
                            {a.revokedByName ? ` by ${a.revokedByName}` : ""}
                          </span>
                        ) : (
                          <span className="sc-team-badge sc-team-badge-active">
                            Active since {formatDateTime(a.assignedAt)}
                            {a.assignedByName ? ` (by ${a.assignedByName})` : ""}
                          </span>
                        )}
                      </td>
                      <td>
                        {a.revokedAt ? (
                          <button
                            type="button"
                            className="sc-team-btn"
                            disabled={!!reactivateSubmitting[a.id]}
                            onClick={() => handleReactivate(a.id)}
                          >
                            {reactivateSubmitting[a.id] ? "Reactivating…" : "Reactivate"}
                          </button>
                        ) : revokeConfirmId === a.id ? (
                          <div className="sc-team-confirm">
                            <p>Revoke this assignment for {a.profileName}?</p>
                            <button
                              type="button"
                              className="sc-team-btn sc-team-btn-danger"
                              disabled={!!revokeSubmitting[a.id]}
                              onClick={() => handleRevokeConfirm(a.id)}
                            >
                              {revokeSubmitting[a.id] ? "Revoking…" : "Yes, revoke"}
                            </button>
                            <button type="button" className="sc-team-btn" onClick={handleRevokeCancel}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button type="button" className="sc-team-btn" onClick={() => handleRevokeClick(a.id)}>
                            Revoke
                          </button>
                        )}
                        {revokeErrors[a.id] && <div className="sc-team-error">{revokeErrors[a.id]}</div>}
                        {reactivateErrors[a.id] && <div className="sc-team-error">{reactivateErrors[a.id]}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form onSubmit={handleAssign} className="sc-team-inline-form">
              <select
                className="sc-team-input"
                value={assignProfileId}
                onChange={(e) => setAssignProfileId(e.target.value)}
                aria-label="Staff member to assign"
              >
                <option value="">— select a staff member —</option>
                {availableCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.staffFunction ? ` — ${STAFF_FUNCTION_LABELS[c.staffFunction]}` : ""}
                  </option>
                ))}
              </select>
              <button type="submit" className="sc-team-btn sc-team-btn-primary" disabled={assignSubmitting}>
                {assignSubmitting ? "Assigning…" : "Assign"}
              </button>
            </form>
            {availableCandidates.length === 0 && candidateStaff.length > 0 && (
              <p className="sc-team-hint">Every staff member in your organization already has a record for this project.</p>
            )}
            {candidateStaff.length === 0 && <p className="sc-team-hint">No other staff members exist in your organization yet.</p>}
            {assignError && <div className="sc-team-error">{assignError}</div>}
          </>
        )}
      </section>

      <section className="sc-team-section">
        <h3>Client &amp; vendor contacts</h3>
        {members.length === 0 ? (
          <p className="sc-team-empty">No client or vendor contacts on this project yet.</p>
        ) : (
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
                    {m.isPrimary && <span className="sc-team-primary-tag">Primary</span>}
                  </td>
                  <td>{MEMBER_ROLE_LABELS[m.memberRole]}</td>
                  <td>{formatDateTime(m.addedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <style dangerouslySetInnerHTML={{ __html: workspaceStyles }} />
    </div>
  );
}

const workspaceStyles = `
.sc-team-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-team-workspace h2 { margin: 0 0 ${spacing.lg} 0; }
.sc-team-section { margin-bottom: ${spacing.xl}; padding-bottom: ${spacing.lg}; border-bottom: 1px solid ${colors.line}; }
.sc-team-section h3 { margin: 0 0 ${spacing.sm} 0; }
.sc-team-restricted { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; background: ${colors.paperDim}; border-radius: ${radius.md}; padding: ${spacing.sm} ${spacing.md}; max-width: 520px; }
.sc-team-empty { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }
.sc-team-hint { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; margin: ${spacing.xs} 0 0 0; }
.sc-team-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; margin-top: 4px; }
.sc-team-table { width: 100%; border-collapse: collapse; font-size: ${typography.sizeSm}; margin-bottom: ${spacing.md}; }
.sc-team-table th { padding: 6px 8px; border-bottom: 1px solid ${colors.line}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-team-table td { padding: 6px 8px; border-bottom: 1px solid ${colors.paperDim}; vertical-align: top; }
.sc-team-inline-form { display: flex; flex-wrap: wrap; align-items: flex-start; gap: ${spacing.sm}; }
.sc-team-input { padding: 6px 8px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; color: ${colors.ink}; background: ${colors.white}; min-width: 260px; }
.sc-team-btn { padding: 7px 13px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; background: ${colors.white}; color: ${colors.ink2}; font-size: ${typography.sizeSm}; cursor: pointer; }
.sc-team-btn-primary { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-team-btn-danger { background: ${colors.brick}; color: ${colors.white}; border-color: ${colors.brick}; }
.sc-team-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.sc-team-confirm { background: ${colors.brickTint}; border-radius: ${radius.md}; padding: ${spacing.sm}; display: flex; flex-direction: column; gap: ${spacing.xs}; align-items: flex-start; max-width: 360px; }
.sc-team-confirm p { margin: 0; font-size: ${typography.sizeXs}; color: ${colors.ink}; }
.sc-team-badge { display: inline-block; padding: 2px 8px; border-radius: ${radius.pill}; font-size: ${typography.sizeXs}; font-weight: ${typography.weightMedium}; }
.sc-team-badge-active { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-team-badge-revoked { background: ${colors.brickTint}; color: ${colors.brick}; }
.sc-team-primary-tag { margin-left: 6px; font-size: ${typography.sizeXs}; color: ${colors.sageDeep}; font-weight: ${typography.weightMedium}; text-transform: uppercase; letter-spacing: 0.02em; }
`;
