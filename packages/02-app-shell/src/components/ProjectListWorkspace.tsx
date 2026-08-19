"use client";

/**
 * `/admin/projects`'s real list (Task 4) — replaces the previous
 * unconditional fixture-`ProjectWorkspace` stub. Same shape as
 * BidPackageWorkspace.tsx (the most recent, most analogous new-UI
 * precedent): a single Client Component owning list + search/filter/
 * sort + the create form, with every Server Action passed in as a prop
 * from page.tsx (never imported directly — see EstimateTable.tsx's own
 * comment for why this package stays free of any apps/web/next/headers
 * dependency).
 *
 * Two views, one component: `view="active"` (default; excludes
 * `status='archived'`) and `view="archived"` (Decision 9's separate,
 * explicitly read-only "Completed / Archived" view — no create form, no
 * switch action rendered for those rows, matching the brief's "no edit
 * affordances render for them" instruction. The actual write-blocking
 * for an archived project is the database's job (RLS / the
 * enforce_project_status_transition trigger), not this component's —
 * this is purely a UI-affordance choice).
 *
 * After a successful create OR switch, this component calls
 * `router.refresh()` rather than hand-patching state (same discipline
 * EstimateTable.tsx/MappingProfileForm.tsx already established) — the
 * next render's `projects`/`currentProjectId` props always come from a
 * real server re-read via page.tsx, never a client-guessed value.
 */
import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, radius, typography, touchTarget } from "../design/tokens";
import type { ProjectRow, ProjectStatus, PricingModel, FeeBasis, CreateProjectParams } from "../services/projectService";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On Hold",
  closed_out: "Closed Out",
  archived: "Archived",
};

const ACTIVE_STATUS_FILTERS: { value: ProjectStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "closed_out", label: "Closed Out" },
];

const PRICING_MODEL_OPTIONS: { value: PricingModel; label: string }[] = [
  { value: "cost_plus_percentage", label: "Cost-Plus (% Fee)" },
  { value: "cost_plus_fixed_fee", label: "Cost-Plus (Fixed Fee)" },
  { value: "fixed_price", label: "Fixed Price" },
  { value: "time_and_materials", label: "Time & Materials" },
  { value: "hybrid_custom", label: "Hybrid / Custom" },
  { value: "other", label: "Other" },
];

type SortKey = "name" | "projectNumber" | "createdAt";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`sc-projects-badge sc-projects-badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface ProjectListWorkspaceProps {
  view: "active" | "archived";
  projects: ProjectRow[];
  currentProjectId: string | null;
  /** createAction.ts's wrapper forwards CreateProjectParams.orgId straight
   *  to the create_project_with_defaults() RPC unchanged (no server-side
   *  re-derivation from the session) — the RPC's own is_org_admin_for_org()
   *  check is what actually rejects a mismatched org, same as every other
   *  admin-only RPC in this codebase. This component still needs a real
   *  value to submit, so page.tsx passes the acting session's own orgId
   *  down as a plain prop (server-known, not client-guessed). */
  orgId: string;
  isAdmin: boolean;
  staffOptions: ProjectOption[];
  clientOptions: ProjectOption[];
  initialCreateOpen?: boolean;
  createProject: (params: CreateProjectParams) => Promise<{ id: string } | { error: string }>;
  switchProject: (projectId: string) => Promise<{ id: string } | { error: string }>;
  activeProjectsHref: string;
  archivedProjectsHref: string;
}

export function ProjectListWorkspace({
  view,
  projects,
  currentProjectId,
  orgId,
  isAdmin,
  staffOptions,
  clientOptions,
  initialCreateOpen,
  createProject,
  switchProject,
  activeProjectsHref,
  archivedProjectsHref,
}: ProjectListWorkspaceProps) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const [createOpen, setCreateOpen] = useState(Boolean(initialCreateOpen));
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [projectNumber, setProjectNumber] = useState("");
  const [address, setAddress] = useState("");
  const [projectType, setProjectType] = useState("");
  const [pricingModel, setPricingModel] = useState<PricingModel>("cost_plus_percentage");
  const [pricingModelLabel, setPricingModelLabel] = useState("");
  const [feeBasis, setFeeBasis] = useState<FeeBasis>("percentage");
  const [feePercent, setFeePercent] = useState("");
  const [feeFixedDollars, setFeeFixedDollars] = useState("");
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);

  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => (view === "archived" ? true : statusFilter === "all" || p.status === statusFilter))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.projectNumber.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (sortKey === "createdAt") return b.createdAt.localeCompare(a.createdAt);
        return a[sortKey].localeCompare(b[sortKey]);
      });
  }, [projects, search, statusFilter, sortKey, view]);

  function toggleId(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function resetCreateForm() {
    setName("");
    setProjectNumber("");
    setAddress("");
    setProjectType("");
    setPricingModel("cost_plus_percentage");
    setPricingModelLabel("");
    setFeeBasis("percentage");
    setFeePercent("");
    setFeeFixedDollars("");
    setSelectedStaffIds([]);
    setSelectedClientIds([]);
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setCreateError("Project name is required.");
      return;
    }
    if (!projectNumber.trim()) {
      setCreateError("Project number is required.");
      return;
    }
    const params: CreateProjectParams = {
      orgId,
      name: name.trim(),
      projectNumber: projectNumber.trim(),
      address: address.trim() || null,
      projectType: projectType.trim() || null,
      pricingModel,
      pricingModelLabel: pricingModelLabel.trim() || null,
      feeBasis,
      feeBasisPoints: feeBasis === "percentage" && feePercent.trim() ? Math.round(Number(feePercent) * 100) : null,
      feeFixedAmountCents:
        feeBasis === "fixed" && feeFixedDollars.trim() ? Math.round(Number(feeFixedDollars) * 100) : null,
      initialStaffProfileIds: selectedStaffIds,
      initialClientProfileIds: selectedClientIds,
    };

    if (feeBasis === "percentage" && (params.feeBasisPoints == null || Number.isNaN(params.feeBasisPoints))) {
      setCreateError("Enter a valid fee percentage.");
      return;
    }
    if (feeBasis === "fixed" && (params.feeFixedAmountCents == null || Number.isNaN(params.feeFixedAmountCents))) {
      setCreateError("Enter a valid fixed fee amount.");
      return;
    }

    setCreateError(null);
    setCreateSubmitting(true);
    try {
      const result = await createProject(params);
      if ("error" in result) {
        setCreateError(result.error);
        return;
      }
      resetCreateForm();
      setCreateOpen(false);
      router.refresh();
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleSwitch(projectId: string) {
    setSwitchError(null);
    setSwitchingId(projectId);
    try {
      const result = await switchProject(projectId);
      if ("error" in result) {
        setSwitchError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <div className="sc-projects-workspace">
      <div className="sc-projects-header">
        <h2>{view === "archived" ? "Completed / Archived Projects" : "Projects"}</h2>
        <div className="sc-projects-view-tabs">
          <a href={activeProjectsHref} className={`sc-projects-tab${view === "active" ? " sc-projects-tab-active" : ""}`}>
            Active
          </a>
          <a
            href={archivedProjectsHref}
            className={`sc-projects-tab${view === "archived" ? " sc-projects-tab-active" : ""}`}
          >
            Completed / Archived
          </a>
        </div>
      </div>

      {view === "archived" && (
        <p className="sc-projects-archived-note">
          Archived projects are read-only. Actual write-blocking is enforced by the database, not by hiding these
          controls.
        </p>
      )}

      <div className="sc-projects-controls">
        <input
          type="search"
          className="sc-projects-input"
          placeholder="Search by name or project number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search projects"
        />
        {view === "active" && (
          <select
            className="sc-projects-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | "all")}
            aria-label="Filter by status"
          >
            {ACTIVE_STATUS_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
        <select
          className="sc-projects-input"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          aria-label="Sort by"
        >
          <option value="name">Sort: Name</option>
          <option value="projectNumber">Sort: Project #</option>
          <option value="createdAt">Sort: Newest</option>
        </select>

        {view === "active" && isAdmin && (
          <button type="button" className="sc-projects-btn sc-projects-btn-primary" onClick={() => setCreateOpen((v) => !v)}>
            {createOpen ? "Cancel" : "+ Create New Project"}
          </button>
        )}
      </div>

      {switchError && <div className="sc-projects-error">{switchError}</div>}

      {view === "active" && isAdmin && createOpen && (
        <section className="sc-projects-create">
          <h3>Create a new project</h3>
          <form onSubmit={handleCreateSubmit} className="sc-projects-form">
            <div className="sc-projects-form-row">
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-name">Project name</label>
                <input id="sc-proj-name" className="sc-projects-input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-number">Project number</label>
                <input
                  id="sc-proj-number"
                  className="sc-projects-input"
                  value={projectNumber}
                  onChange={(e) => setProjectNumber(e.target.value)}
                />
              </div>
            </div>

            <div className="sc-projects-field">
              <label htmlFor="sc-proj-address">Address (optional)</label>
              <input id="sc-proj-address" className="sc-projects-input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>

            <div className="sc-projects-field">
              <label htmlFor="sc-proj-type">Project type (optional)</label>
              <input
                id="sc-proj-type"
                className="sc-projects-input"
                placeholder="e.g. New Build, Remodel"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
              />
            </div>

            <div className="sc-projects-form-row">
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-pricing">Pricing model</label>
                <select
                  id="sc-proj-pricing"
                  className="sc-projects-input"
                  value={pricingModel}
                  onChange={(e) => setPricingModel(e.target.value as PricingModel)}
                >
                  {PRICING_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-pricing-label">Pricing model label (optional)</label>
                <input
                  id="sc-proj-pricing-label"
                  className="sc-projects-input"
                  value={pricingModelLabel}
                  onChange={(e) => setPricingModelLabel(e.target.value)}
                />
              </div>
            </div>

            <div className="sc-projects-form-row">
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-fee-basis">Fee basis</label>
                <select
                  id="sc-proj-fee-basis"
                  className="sc-projects-input"
                  value={feeBasis}
                  onChange={(e) => setFeeBasis(e.target.value as FeeBasis)}
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </div>
              {feeBasis === "percentage" ? (
                <div className="sc-projects-field">
                  <label htmlFor="sc-proj-fee-pct">Fee percentage</label>
                  <input
                    id="sc-proj-fee-pct"
                    type="number"
                    step="0.01"
                    className="sc-projects-input"
                    placeholder="e.g. 15"
                    value={feePercent}
                    onChange={(e) => setFeePercent(e.target.value)}
                  />
                </div>
              ) : (
                <div className="sc-projects-field">
                  <label htmlFor="sc-proj-fee-fixed">Fixed fee ($)</label>
                  <input
                    id="sc-proj-fee-fixed"
                    type="number"
                    step="0.01"
                    className="sc-projects-input"
                    value={feeFixedDollars}
                    onChange={(e) => setFeeFixedDollars(e.target.value)}
                  />
                </div>
              )}
            </div>

            {staffOptions.length > 0 && (
              <div className="sc-projects-field">
                <label>Initial staff assignments (optional)</label>
                <div className="sc-projects-checkbox-list">
                  {staffOptions.map((opt) => (
                    <label key={opt.id} className="sc-projects-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedStaffIds.includes(opt.id)}
                        onChange={() => setSelectedStaffIds((prev) => toggleId(prev, opt.id))}
                      />
                      {opt.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {clientOptions.length > 0 && (
              <div className="sc-projects-field">
                <label>Initial client contacts (optional)</label>
                <div className="sc-projects-checkbox-list">
                  {clientOptions.map((opt) => (
                    <label key={opt.id} className="sc-projects-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedClientIds.includes(opt.id)}
                        onChange={() => setSelectedClientIds((prev) => toggleId(prev, opt.id))}
                      />
                      {opt.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button type="submit" className="sc-projects-btn sc-projects-btn-primary" disabled={createSubmitting}>
              {createSubmitting ? "Creating…" : "Create Project"}
            </button>
            {createError && <div className="sc-projects-error">{createError}</div>}
          </form>
        </section>
      )}

      {filtered.length === 0 ? (
        <p className="sc-projects-empty">
          {projects.length === 0
            ? view === "archived"
              ? "No archived projects."
              : "No projects yet for this organization."
            : "No projects match your search/filter."}
        </p>
      ) : (
        <ul className="sc-projects-list">
          {filtered.map((project) => (
            <li key={project.id} className="sc-projects-row">
              <div className="sc-projects-row-main">
                <span className="sc-projects-row-name">{project.name}</span>
                <StatusBadge status={project.status} />
                {project.id === currentProjectId && <span className="sc-projects-current-tag">Current</span>}
              </div>
              <div className="sc-projects-row-meta">
                <span>#{project.projectNumber}</span>
                {project.address && <span>{project.address}</span>}
                {project.pricingModelLabel && <span>{project.pricingModelLabel}</span>}
                <span>Created {formatDate(project.createdAt)}</span>
              </div>
              {view === "active" && project.id !== currentProjectId && (
                <button
                  type="button"
                  className="sc-projects-btn"
                  disabled={switchingId === project.id}
                  onClick={() => handleSwitch(project.id)}
                >
                  {switchingId === project.id ? "Switching…" : "Switch to this project"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <style dangerouslySetInnerHTML={{ __html: workspaceStyles }} />
    </div>
  );
}

const workspaceStyles = `
.sc-projects-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }
.sc-projects-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: ${spacing.sm}; margin-bottom: ${spacing.sm}; }
.sc-projects-header h2 { margin: 0; }
.sc-projects-view-tabs { display: flex; gap: ${spacing.xs}; }
.sc-projects-tab { padding: 6px 12px; border-radius: ${radius.pill}; font-size: ${typography.sizeSm}; color: ${colors.ink2}; text-decoration: none; border: 1px solid ${colors.line}; }
.sc-projects-tab-active { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-projects-archived-note { color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; margin: 0 0 ${spacing.md} 0; }

.sc-projects-controls { display: flex; flex-wrap: wrap; gap: ${spacing.sm}; margin-bottom: ${spacing.md}; align-items: center; }
.sc-projects-input { padding: 7px 9px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; font-family: ${typography.fontFamily}; font-size: ${typography.sizeSm}; color: ${colors.ink}; background: ${colors.white}; }

.sc-projects-btn { padding: 8px 14px; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; background: ${colors.white}; color: ${colors.ink2}; font-size: ${typography.sizeSm}; cursor: pointer; min-height: ${touchTarget.minSize}; }
.sc-projects-btn-primary { background: ${colors.sage}; color: ${colors.white}; border-color: ${colors.sage}; }
.sc-projects-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.sc-projects-create { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.md}; margin-bottom: ${spacing.lg}; background: ${colors.paperDim}; }
.sc-projects-create h3 { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeMd}; }
.sc-projects-form { display: flex; flex-direction: column; gap: ${spacing.sm}; align-items: flex-start; }
.sc-projects-form-row { display: flex; flex-wrap: wrap; gap: ${spacing.md}; width: 100%; }
.sc-projects-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; max-width: 420px; }
.sc-projects-field label { font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
.sc-projects-checkbox-list { display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; padding: ${spacing.sm}; background: ${colors.white}; }
.sc-projects-checkbox-item { display: flex; align-items: center; gap: 6px; font-size: ${typography.sizeSm}; }

.sc-projects-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; margin: 4px 0; }
.sc-projects-empty { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }

.sc-projects-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-projects-row { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm} ${spacing.md}; background: ${colors.white}; display: flex; flex-direction: column; gap: 4px; }
.sc-projects-row-main { display: flex; align-items: center; gap: ${spacing.sm}; flex-wrap: wrap; }
.sc-projects-row-name { font-weight: ${typography.weightSemibold}; font-size: ${typography.sizeMd}; }
.sc-projects-current-tag { font-size: ${typography.sizeXs}; color: ${colors.sageDeep}; font-weight: ${typography.weightMedium}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-projects-row-meta { display: flex; flex-wrap: wrap; gap: ${spacing.sm}; color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; }
.sc-projects-row .sc-projects-btn { align-self: flex-start; margin-top: 4px; }

.sc-projects-badge { display: inline-block; padding: 2px 8px; border-radius: ${radius.pill}; font-size: 10px; font-weight: ${typography.weightMedium}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-projects-badge-draft { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-projects-badge-active { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-projects-badge-on_hold { background: ${colors.goldTint}; color: ${colors.gold}; }
.sc-projects-badge-closed_out { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-projects-badge-archived { background: ${colors.brickTint}; color: ${colors.brick}; }
`;
