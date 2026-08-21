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
 * Three views, one component (owner-preview correction round, item 9):
 * `view="active"` (default; `draft`/`active`/`on_hold` only),
 * `view="completed"` (schema/008's distinct `closed_out` state — a
 * finished job, not yet archived; read-only like Archived but still
 * shows "Manage Team" since staffing cleanup on a just-finished job is
 * plausible), and `view="archived"` (fully read-only — no create form,
 * no switch action, no "Manage Team" link). This is purely a UI-
 * affordance choice: `enforce_project_status_transition()` (schema/008,
 * widened by schema/017 — P3 owner-preview round 2, Task D1) only
 * guards the validity of `projects.status`'s own transitions, not
 * writes to an archived project's child tables (cost codes, budget
 * entries, staff assignments, etc.) — no such DB-level write guard
 * exists yet.
 *
 * Every row (in every view, including Archived) also renders a
 * status-change control (Task D1) showing only the transitions
 * actually valid FROM that row's current status — this is how a
 * project actually reaches `archived` in the first place, and how it
 * comes back out again (`archived -> active` / `archived ->
 * closed_out`), closing the two gaps the owner's second preview round
 * found: no UI path into Archived, and archival being effectively
 * permanent. This one control is deliberately NOT gated by `view` the
 * way "Manage Team"/"Switch to this project" are — status changes are
 * exactly what moves a row between views.
 *
 * After a successful create, this component switches to the new project
 * and navigates straight to its setup checklist (owner-preview
 * correction round, item 11) rather than just closing the form and
 * refreshing the list — see handleCreateSubmit. After a switch action on
 * an existing row, it still calls `router.refresh()` (same discipline
 * EstimateTable.tsx/MappingProfileForm.tsx already established) — the
 * next render's `projects`/`currentProjectId` props always come from a
 * real server re-read via page.tsx, never a client-guessed value.
 */
import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, radius, typography, touchTarget } from "../design/tokens";
import type {
  ProjectRow,
  ProjectStatus,
  PricingModel,
  FeeBasis,
  CreateProjectParams,
  StaffFunction,
} from "../services/projectService";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On Hold",
  closed_out: "Closed Out",
  archived: "Archived",
};

/**
 * The full transition matrix change_project_status() (schema/017) will
 * actually accept, keyed by the row's CURRENT status — mirrors
 * enforce_project_status_transition()'s widened condition exactly
 * (schema/017_project_status_reversible_lifecycle.sql), so this list
 * never offers a destination the RPC would reject. Labels match the
 * owner's own naming ("Mark as Completed" / "Mark as Active" /
 * "Archive" / "Restore from Archive") — "Restore from Archive" is used
 * specifically for archived -> active (the reversibility fix), even
 * though on_hold -> active is also "Mark as Active", since the two read
 * very differently to an admin looking at the row.
 */
const STATUS_TRANSITIONS: Record<ProjectStatus, { status: ProjectStatus; label: string }[]> = {
  draft: [{ status: "active", label: "Mark as Active" }],
  active: [
    { status: "on_hold", label: "Put On Hold" },
    { status: "closed_out", label: "Mark as Completed" },
    { status: "archived", label: "Archive" },
  ],
  on_hold: [
    { status: "active", label: "Mark as Active" },
    { status: "closed_out", label: "Mark as Completed" },
  ],
  closed_out: [
    { status: "active", label: "Mark as Active" },
    { status: "archived", label: "Archive" },
  ],
  archived: [
    { status: "active", label: "Restore from Archive" },
    { status: "closed_out", label: "Mark as Completed" },
  ],
};

// `closed_out` deliberately excluded (owner-preview correction round,
// item 8/9): now that Completed is its own tab, offering it as a filter
// option here too would be the exact "status filter duplicates what the
// view tabs already do" redundancy the brief flagged, and page.tsx no
// longer includes closed_out projects in the active-view `projects` prop
// anyway.
const ACTIVE_STATUS_FILTERS: { value: ProjectStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
];

const PRICING_MODEL_OPTIONS: { value: PricingModel; label: string }[] = [
  { value: "cost_plus_percentage", label: "Cost-Plus (% Fee)" },
  { value: "cost_plus_fixed_fee", label: "Cost-Plus (Fixed Fee)" },
  { value: "fixed_price", label: "Fixed Price" },
  { value: "time_and_materials", label: "Time & Materials" },
  { value: "hybrid_custom", label: "Hybrid / Custom" },
  { value: "other", label: "Other" },
];

// A pricing model whose fee capture the RPC can express directly — no
// separate "fee basis" picker needed, since the model already implies
// one (owner-preview correction round, item 3).
function pricingModelImpliesFeeBasis(model: PricingModel): boolean {
  return model === "cost_plus_percentage" || model === "cost_plus_fixed_fee";
}

const PROJECT_TYPE_OPTIONS = [
  "New Construction",
  "Remodel/Renovation",
  "Addition",
  "Commercial",
  "Service/Warranty",
  "Other",
] as const;

// Same labels/values as ProjectTeamWorkspace.tsx's own STAFF_FUNCTION_LABELS
// (that file is out of scope for this task — see its "What NOT to do" —
// so this is a deliberate small duplication of that exact mapping rather
// than a shared import, not a second, drifted convention).
const STAFF_FUNCTION_LABELS: Record<StaffFunction, string> = {
  project_manager: "Project Manager",
  superintendent: "Superintendent",
  accounting: "Accounting",
  general: "General Staff",
};

type SortKey = "name" | "projectNumber" | "createdAt";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`sc-projects-badge sc-projects-badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

/**
 * Finds a safe "next" project number to suggest (owner-preview
 * correction round, item 5) — deliberately simple, not exhaustive: only
 * recognizes values that are all digits, or a non-digit prefix followed
 * by a run of digits at the very end (e.g. "1024", "PRJ-1024"). Picks
 * whichever prefix appears most often among the org's existing numbers
 * (ties keep whichever was seen first), then returns that prefix plus
 * its highest matched value + 1, zero-padded to match that value's own
 * width. Returns null — never a guess — when nothing matches a
 * recognizable pattern, so the field is left blank rather than forcing
 * an unsafe suggestion.
 */
function suggestNextProjectNumber(numbers: string[]): string | null {
  const groups = new Map<string, { count: number; maxValue: number; width: number }>();
  for (const raw of numbers) {
    const trimmed = (raw ?? "").trim();
    const match = /^(\D*)(\d+)$/.exec(trimmed);
    if (!match) continue;
    const [, prefix, digits] = match;
    const value = Number.parseInt(digits, 10);
    if (!Number.isFinite(value)) continue;
    const existing = groups.get(prefix);
    if (existing) {
      existing.count += 1;
      if (value > existing.maxValue) {
        existing.maxValue = value;
        existing.width = digits.length;
      }
    } else {
      groups.set(prefix, { count: 1, maxValue: value, width: digits.length });
    }
  }
  let bestPrefix: string | null = null;
  let best: { count: number; maxValue: number; width: number } | null = null;
  for (const [prefix, info] of groups) {
    if (!best || info.count > best.count) {
      best = info;
      bestPrefix = prefix;
    }
  }
  if (!best || bestPrefix === null) return null;
  return `${bestPrefix}${String(best.maxValue + 1).padStart(best.width, "0")}`;
}

export interface ProjectOption {
  id: string;
  name: string;
}

/** staffOptions carries `staff_function` (owner-preview correction round,
 *  item 4) so the picker can show real names + role, not a bare id-backed
 *  checkbox list; clientOptions stays the simpler shape since clients
 *  don't have a staff_function. */
export interface StaffProjectOption extends ProjectOption {
  staffFunction: StaffFunction | null;
}

export interface ProjectListWorkspaceProps {
  view: "active" | "completed" | "archived";
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
  staffOptions: StaffProjectOption[];
  clientOptions: ProjectOption[];
  /** Every project number already in use across the whole org (all
   *  statuses, not just this view's filtered `projects`) — used only to
   *  compute the next-number suggestion (item 5); `unique(org_id,
   *  project_number)` applies org-wide regardless of status, so a
   *  suggestion based only on this view's rows could collide with a
   *  number that belongs to an archived/completed project. */
  allProjectNumbers: string[];
  /** Whether the org has any completed/archived projects at all,
   *  independent of this view's own filtered `projects` prop —
   *  final-review fix wave, Minor finding 4: without these, an org whose
   *  only projects are e.g. `closed_out` saw the Active view's "No
   *  projects yet for this organization" message, which is misleading
   *  (the org does have projects, just none active). Same
   *  "genuinely zero" vs. "zero in this view, but others exist
   *  elsewhere" pattern ProjectSwitcher.tsx already applies via its own
   *  `hasArchivedProjects` prop. */
  hasCompletedProjects: boolean;
  hasArchivedProjects: boolean;
  initialCreateOpen?: boolean;
  createProject: (params: CreateProjectParams) => Promise<{ id: string } | { error: string }>;
  switchProject: (projectId: string) => Promise<{ id: string } | { error: string }>;
  /** statusAction.ts's wrapper over change_project_status() (schema/017,
   *  Task D1) — admin-only at the RPC layer (the real boundary); this
   *  component only hides the control for non-admins as a UI
   *  convenience, same "UI hiding is cosmetic" framing used throughout
   *  this package. */
  changeProjectStatus: (projectId: string, newStatus: ProjectStatus) => Promise<{ error: string } | {}>;
  activeProjectsHref: string;
  completedProjectsHref: string;
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
  allProjectNumbers,
  hasCompletedProjects,
  hasArchivedProjects,
  initialCreateOpen,
  createProject,
  switchProject,
  changeProjectStatus,
  activeProjectsHref,
  completedProjectsHref,
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
  const [nameTouched, setNameTouched] = useState(false);
  const [projectNumber, setProjectNumber] = useState("");
  const [projectNumberTouched, setProjectNumberTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [projectTypeChoice, setProjectTypeChoice] = useState("");
  const [projectTypeOther, setProjectTypeOther] = useState("");
  const [pricingModel, setPricingModel] = useState<PricingModel>("cost_plus_percentage");
  const [pricingModelLabel, setPricingModelLabel] = useState("");
  const [feeBasis, setFeeBasis] = useState<FeeBasis>("percentage");
  const [feePercent, setFeePercent] = useState("");
  const [feeFixedDollars, setFeeFixedDollars] = useState("");
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);

  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Status-change control (Task D1) — single pending confirm across all
  // rows at once, same "one inline confirm at a time" shape as
  // ProjectTeamWorkspace.tsx's revokeConfirmId.
  const [statusConfirm, setStatusConfirm] = useState<{ projectId: string; newStatus: ProjectStatus } | null>(null);
  const [statusSubmittingId, setStatusSubmittingId] = useState<string | null>(null);
  const [statusErrors, setStatusErrors] = useState<Record<string, string | null>>({});

  const suggestedProjectNumber = useMemo(() => suggestNextProjectNumber(allProjectNumbers), [allProjectNumbers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => (view === "active" ? statusFilter === "all" || p.status === statusFilter : true))
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
    setNameTouched(false);
    setProjectNumber("");
    setProjectNumberTouched(false);
    setAddress("");
    setProjectTypeChoice("");
    setProjectTypeOther("");
    setPricingModel("cost_plus_percentage");
    setPricingModelLabel("");
    setFeeBasis("percentage");
    setFeePercent("");
    setFeeFixedDollars("");
    setSelectedStaffIds([]);
    setSelectedClientIds([]);
  }

  /** The "+ Create New Project" / "Discard" toggle (item 6). Renamed from
   *  the old ambiguous "Cancel" — and, to make that new label honest,
   *  closing the form now actually discards whatever was typed, matching
   *  what "Discard" promises rather than silently keeping stale state
   *  around for the next time the form opens. */
  function handleToggleCreate() {
    setCreateOpen((wasOpen) => {
      if (wasOpen) {
        resetCreateForm();
        setCreateError(null);
      }
      return !wasOpen;
    });
  }

  function handlePricingModelChange(value: PricingModel) {
    setPricingModel(value);
    if (value === "cost_plus_percentage") setFeeBasis("percentage");
    else if (value === "cost_plus_fixed_fee") setFeeBasis("fixed");
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameTouched(true);
    setProjectNumberTouched(true);
    if (!name.trim()) {
      setCreateError("Project name is required.");
      return;
    }
    if (!projectNumber.trim()) {
      setCreateError("Project number is required.");
      return;
    }

    const resolvedProjectType =
      projectTypeChoice === "" ? null : projectTypeChoice === "Other" ? projectTypeOther.trim() || null : projectTypeChoice;
    // The pricing model already implies a fee basis for the two cost-plus
    // models (item 3) — for every other model, whatever the fallback
    // picker last set stands.
    const resolvedFeeBasis: FeeBasis = pricingModelImpliesFeeBasis(pricingModel)
      ? pricingModel === "cost_plus_percentage"
        ? "percentage"
        : "fixed"
      : feeBasis;

    const params: CreateProjectParams = {
      orgId,
      name: name.trim(),
      projectNumber: projectNumber.trim(),
      address: address.trim() || null,
      projectType: resolvedProjectType,
      pricingModel,
      pricingModelLabel: pricingModelLabel.trim() || null,
      feeBasis: resolvedFeeBasis,
      feeBasisPoints: resolvedFeeBasis === "percentage" && feePercent.trim() ? Math.round(Number(feePercent) * 100) : null,
      feeFixedAmountCents:
        resolvedFeeBasis === "fixed" && feeFixedDollars.trim() ? Math.round(Number(feeFixedDollars) * 100) : null,
      initialStaffProfileIds: selectedStaffIds,
      initialClientProfileIds: selectedClientIds,
    };

    if (resolvedFeeBasis === "percentage" && (params.feeBasisPoints == null || Number.isNaN(params.feeBasisPoints))) {
      setCreateError("Enter a valid fee percentage.");
      return;
    }
    if (resolvedFeeBasis === "fixed" && (params.feeFixedAmountCents == null || Number.isNaN(params.feeFixedAmountCents))) {
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
      const switchResult = await switchProject(result.id);
      if ("error" in switchResult) {
        // The project itself was created successfully — don't lose that
        // fact — but the setup checklist's "Go to Overview" link is
        // cookie-driven, not tied to this project's id directly (item
        // 11's original design), so silently navigating there after a
        // failed switch would land the owner on a stale, previously-
        // selected project with no indication anything went wrong
        // (final-review fix wave, Minor finding 6). Surface the failure
        // via the same switchError banner the per-row "Switch to this
        // project" action uses, and stay on the list instead of
        // proceeding to the setup page as if the switch worked.
        setSwitchError(
          `"${params.name}" was created, but switching to it failed (${switchResult.error}). Find it below and switch to it manually.`
        );
        router.refresh();
        return;
      }
      router.push(`/admin/projects/${result.id}/setup`);
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

  function handleStatusOptionClick(projectId: string, newStatus: ProjectStatus) {
    setStatusErrors((prev) => ({ ...prev, [projectId]: null }));
    setStatusConfirm({ projectId, newStatus });
  }

  function handleStatusCancel() {
    setStatusConfirm(null);
  }

  async function handleStatusConfirm() {
    if (!statusConfirm) return;
    const { projectId, newStatus } = statusConfirm;
    setStatusSubmittingId(projectId);
    try {
      const result = await changeProjectStatus(projectId, newStatus);
      if ("error" in result) {
        setStatusErrors((prev) => ({ ...prev, [projectId]: result.error }));
        return;
      }
      setStatusConfirm(null);
      router.refresh();
    } finally {
      setStatusSubmittingId(null);
    }
  }

  const viewTitle = view === "archived" ? "Archived Projects" : view === "completed" ? "Completed Projects" : "Projects";

  return (
    <div className="sc-projects-workspace">
      <div className="sc-projects-header">
        <h2>{viewTitle}</h2>
        <div className="sc-projects-view-tabs">
          <a href={activeProjectsHref} className={`sc-projects-tab${view === "active" ? " sc-projects-tab-active" : ""}`}>
            Active
          </a>
          <a
            href={completedProjectsHref}
            className={`sc-projects-tab${view === "completed" ? " sc-projects-tab-active" : ""}`}
          >
            Completed
          </a>
          <a
            href={archivedProjectsHref}
            className={`sc-projects-tab${view === "archived" ? " sc-projects-tab-active" : ""}`}
          >
            Archived
          </a>
        </div>
      </div>

      {view === "archived" && (
        <p className="sc-projects-archived-note">Archived projects are shown read-only in this view.</p>
      )}
      {view === "completed" && (
        <p className="sc-projects-archived-note">
          Completed projects are shown read-only in this view. &ldquo;Manage Team&rdquo; still applies — staffing cleanup
          on a just-finished job is often still legitimate.
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
          <button
            type="button"
            className="sc-projects-btn sc-projects-btn-primary"
            onClick={handleToggleCreate}
            disabled={createSubmitting}
          >
            {createOpen ? "Discard" : "+ Create New Project"}
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
                <label htmlFor="sc-proj-name">
                  Project name<span className="sc-projects-field-required" aria-hidden="true">*</span>
                </label>
                <input
                  id="sc-proj-name"
                  className="sc-projects-input sc-projects-field-input"
                  required
                  aria-required="true"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setNameTouched(true)}
                />
                {nameTouched && !name.trim() && <p className="sc-projects-field-error-inline">Project name is required.</p>}
              </div>
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-number">
                  Project number<span className="sc-projects-field-required" aria-hidden="true">*</span>
                </label>
                <div className="sc-projects-field-inline">
                  <input
                    id="sc-proj-number"
                    className="sc-projects-input sc-projects-field-input"
                    required
                    aria-required="true"
                    value={projectNumber}
                    onChange={(e) => setProjectNumber(e.target.value)}
                    onBlur={() => setProjectNumberTouched(true)}
                  />
                  {suggestedProjectNumber && (
                    <button
                      type="button"
                      className="sc-projects-btn sc-projects-btn-sm"
                      onClick={() => setProjectNumber(suggestedProjectNumber)}
                    >
                      Suggest next number
                    </button>
                  )}
                </div>
                <p className="sc-projects-field-help">Must be unique within your organization.</p>
                {projectNumberTouched && !projectNumber.trim() && (
                  <p className="sc-projects-field-error-inline">Project number is required.</p>
                )}
              </div>
            </div>

            <div className="sc-projects-field sc-projects-field-wide">
              <label htmlFor="sc-proj-address">Address (optional)</label>
              <input
                id="sc-proj-address"
                className="sc-projects-input sc-projects-field-input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

            <div className="sc-projects-field">
              <label htmlFor="sc-proj-type">Project type (optional)</label>
              <select
                id="sc-proj-type"
                className="sc-projects-input sc-projects-field-input"
                value={projectTypeChoice}
                onChange={(e) => setProjectTypeChoice(e.target.value)}
              >
                <option value="">— Select —</option>
                {PROJECT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {projectTypeChoice === "Other" && (
                <input
                  id="sc-proj-type-other"
                  className="sc-projects-input sc-projects-field-input"
                  placeholder="Describe the project type"
                  value={projectTypeOther}
                  onChange={(e) => setProjectTypeOther(e.target.value)}
                  style={{ marginTop: 6 }}
                />
              )}
            </div>

            <div className="sc-projects-form-row">
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-pricing">Pricing model</label>
                <select
                  id="sc-proj-pricing"
                  className="sc-projects-input sc-projects-field-input"
                  value={pricingModel}
                  onChange={(e) => handlePricingModelChange(e.target.value as PricingModel)}
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
                  className="sc-projects-input sc-projects-field-input"
                  value={pricingModelLabel}
                  onChange={(e) => setPricingModelLabel(e.target.value)}
                />
              </div>
            </div>

            {pricingModel === "cost_plus_percentage" && (
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-fee-pct">
                  Fee percentage<span className="sc-projects-field-required" aria-hidden="true">*</span>
                </label>
                <input
                  id="sc-proj-fee-pct"
                  type="number"
                  step="0.01"
                  className="sc-projects-input sc-projects-field-input"
                  placeholder="e.g. 15"
                  value={feePercent}
                  onChange={(e) => setFeePercent(e.target.value)}
                />
              </div>
            )}

            {pricingModel === "cost_plus_fixed_fee" && (
              <div className="sc-projects-field">
                <label htmlFor="sc-proj-fee-fixed">
                  Fixed fee amount ($)<span className="sc-projects-field-required" aria-hidden="true">*</span>
                </label>
                <input
                  id="sc-proj-fee-fixed"
                  type="number"
                  step="0.01"
                  className="sc-projects-input sc-projects-field-input"
                  value={feeFixedDollars}
                  onChange={(e) => setFeeFixedDollars(e.target.value)}
                />
              </div>
            )}

            {!pricingModelImpliesFeeBasis(pricingModel) && (
              <div className="sc-projects-fee-fallback">
                <p className="sc-projects-fee-note">
                  Detailed pricing capture for this contract type isn&rsquo;t built yet — enter a fee basis for now; you
                  can configure full contract terms after this is added.
                </p>
                <div className="sc-projects-form-row">
                  <div className="sc-projects-field">
                    <label htmlFor="sc-proj-fee-basis">Fee basis</label>
                    <select
                      id="sc-proj-fee-basis"
                      className="sc-projects-input sc-projects-field-input"
                      value={feeBasis}
                      onChange={(e) => setFeeBasis(e.target.value as FeeBasis)}
                    >
                      <option value="percentage">Percentage</option>
                      <option value="fixed">Fixed amount</option>
                    </select>
                  </div>
                  {feeBasis === "percentage" ? (
                    <div className="sc-projects-field">
                      <label htmlFor="sc-proj-fee-pct-fallback">
                        Fee percentage<span className="sc-projects-field-required" aria-hidden="true">*</span>
                      </label>
                      <input
                        id="sc-proj-fee-pct-fallback"
                        type="number"
                        step="0.01"
                        className="sc-projects-input sc-projects-field-input"
                        placeholder="e.g. 15"
                        value={feePercent}
                        onChange={(e) => setFeePercent(e.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="sc-projects-field">
                      <label htmlFor="sc-proj-fee-fixed-fallback">
                        Fixed fee amount ($)<span className="sc-projects-field-required" aria-hidden="true">*</span>
                      </label>
                      <input
                        id="sc-proj-fee-fixed-fallback"
                        type="number"
                        step="0.01"
                        className="sc-projects-input sc-projects-field-input"
                        value={feeFixedDollars}
                        onChange={(e) => setFeeFixedDollars(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="sc-projects-field">
              <label>Initial staff assignments (optional)</label>
              {staffOptions.length === 0 ? (
                <p className="sc-projects-empty-inline">No other staff members in this organization yet.</p>
              ) : (
                <div className="sc-projects-checkbox-list">
                  {staffOptions.map((opt) => (
                    <label key={opt.id} className="sc-projects-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedStaffIds.includes(opt.id)}
                        onChange={() => setSelectedStaffIds((prev) => toggleId(prev, opt.id))}
                      />
                      {opt.name}
                      {opt.staffFunction ? ` — ${STAFF_FUNCTION_LABELS[opt.staffFunction]}` : ""}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="sc-projects-field">
              <label>Initial client contacts (optional)</label>
              {clientOptions.length === 0 ? (
                <p className="sc-projects-empty-inline">No client contacts in this organization yet.</p>
              ) : (
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
              )}
            </div>

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
              : view === "completed"
                ? "No completed projects."
                : hasCompletedProjects || hasArchivedProjects
                  ? "No active projects for this organization — see Completed or Archived above."
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
              <div className="sc-projects-row-actions">
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
                {/* Task 6 (P3): only entry point into
                    /admin/projects/[id]/team today — a plain inline href,
                    same as BidPackageWorkspace.tsx's own link to
                    /admin/commitments, not a prop-threaded href (this
                    route's shape is fixed, unlike activeProjectsHref/
                    completedProjectsHref/archivedProjectsHref above which
                    vary by view). Shown for Active and Completed rows
                    (owner-preview correction round, item 9) regardless of
                    admin/staff — the team page itself renders the
                    RLS-accurate restricted state for a non-admin viewer
                    rather than this list guessing at that. Hidden in the
                    archived view: an archived project's team isn't
                    editable, so a "Manage Team" link here would be a dead
                    end at best and a misleading write affordance at
                    worst, matching this view's read-only intent. */}
                {(view === "active" || view === "completed") && (
                  <a href={`/admin/projects/${project.id}/team`} className="sc-projects-btn">
                    Manage Team
                  </a>
                )}
              </div>

              {/* Task D1 (P3 owner-preview round 2): status-change
                  control, admin-only in the UI (the RPC's own
                  is_org_admin_for_org() check is the real boundary —
                  same "UI hiding is cosmetic" framing used throughout
                  this package). Shown in every view, including
                  Archived — this is the actual fix for both gaps the
                  owner found: no UI path INTO archived, and archival
                  being effectively permanent. Click -> inline "are you
                  sure?" state -> confirm/cancel, mirroring
                  ProjectTeamWorkspace.tsx's Revoke confirm exactly,
                  never a native confirm() dialog. */}
              {isAdmin &&
                (statusConfirm?.projectId === project.id ? (
                  <div className="sc-projects-status-confirm">
                    <p>
                      Change status of &ldquo;{project.name}&rdquo; from {STATUS_LABELS[project.status]} to{" "}
                      {STATUS_LABELS[statusConfirm.newStatus]}?
                    </p>
                    <div className="sc-projects-status-confirm-actions">
                      <button
                        type="button"
                        className="sc-projects-btn sc-projects-btn-primary"
                        disabled={statusSubmittingId === project.id}
                        onClick={handleStatusConfirm}
                      >
                        {statusSubmittingId === project.id ? "Saving…" : "Yes, change status"}
                      </button>
                      <button type="button" className="sc-projects-btn" onClick={handleStatusCancel}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="sc-projects-status-actions">
                    {STATUS_TRANSITIONS[project.status].map((option) => (
                      <button
                        key={option.status}
                        type="button"
                        className="sc-projects-btn sc-projects-btn-sm"
                        onClick={() => handleStatusOptionClick(project.id, option.status)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ))}
              {statusErrors[project.id] && <div className="sc-projects-error">{statusErrors[project.id]}</div>}
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
.sc-projects-btn-sm { padding: 6px 10px; font-size: ${typography.sizeXs}; min-height: auto; white-space: nowrap; }

.sc-projects-create { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.md}; margin-bottom: ${spacing.lg}; background: ${colors.paperDim}; }
.sc-projects-create h3 { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeMd}; }
.sc-projects-form { display: flex; flex-direction: column; gap: ${spacing.sm}; align-items: flex-start; width: 100%; }
.sc-projects-form-row { display: flex; flex-wrap: wrap; gap: ${spacing.md}; width: 100%; }
.sc-projects-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; max-width: 420px; }
.sc-projects-field-wide { max-width: 100%; width: 100%; }
.sc-projects-field label { font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
.sc-projects-field-required { color: ${colors.brick}; margin-left: 3px; }
.sc-projects-field-help { margin: 0; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; }
.sc-projects-field-error-inline { margin: 0; font-size: ${typography.sizeXs}; color: ${colors.brick}; }
.sc-projects-field-inline { display: flex; gap: ${spacing.xs}; align-items: center; }
.sc-projects-field-inline .sc-projects-field-input { flex: 1; }
.sc-projects-input.sc-projects-field-input { width: 100%; box-sizing: border-box; }
.sc-projects-fee-fallback { width: 100%; }
.sc-projects-fee-note { font-size: ${typography.sizeXs}; color: ${colors.ink2}; background: ${colors.goldTint}; border: 1px solid ${colors.gold}; border-radius: ${radius.sm}; padding: ${spacing.sm}; margin: 0 0 ${spacing.sm} 0; }
.sc-projects-checkbox-list { display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; padding: ${spacing.sm}; background: ${colors.white}; }
.sc-projects-checkbox-item { display: flex; align-items: center; gap: 6px; font-size: ${typography.sizeSm}; }
.sc-projects-empty-inline { margin: 0; padding: ${spacing.sm}; font-size: ${typography.sizeXs}; color: ${colors.stoneDark}; border: 1px dashed ${colors.line}; border-radius: ${radius.sm}; }

.sc-projects-error { color: ${colors.brick}; font-size: ${typography.sizeXs}; margin: 4px 0; }
.sc-projects-empty { color: ${colors.stoneDark}; font-size: ${typography.sizeSm}; }

.sc-projects-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-projects-row { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm} ${spacing.md}; background: ${colors.white}; display: flex; flex-direction: column; gap: 4px; }
.sc-projects-row-main { display: flex; align-items: center; gap: ${spacing.sm}; flex-wrap: wrap; }
.sc-projects-row-name { font-weight: ${typography.weightSemibold}; font-size: ${typography.sizeMd}; overflow-wrap: anywhere; }
.sc-projects-current-tag { font-size: ${typography.sizeXs}; color: ${colors.sageDeep}; font-weight: ${typography.weightMedium}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-projects-row-meta { display: flex; flex-wrap: wrap; gap: ${spacing.sm}; color: ${colors.stoneDark}; font-size: ${typography.sizeXs}; overflow-wrap: anywhere; }
.sc-projects-row-actions { display: flex; flex-wrap: wrap; gap: ${spacing.sm}; margin-top: 4px; }
.sc-projects-status-actions { display: flex; flex-wrap: wrap; gap: ${spacing.xs}; margin-top: 4px; }
.sc-projects-status-confirm { background: ${colors.brickTint}; border-radius: ${radius.md}; padding: ${spacing.sm}; margin-top: 4px; display: flex; flex-direction: column; gap: ${spacing.xs}; align-items: flex-start; max-width: 420px; }
.sc-projects-status-confirm p { margin: 0; font-size: ${typography.sizeXs}; color: ${colors.ink}; }
.sc-projects-status-confirm-actions { display: flex; gap: ${spacing.xs}; }
.sc-projects-row .sc-projects-btn { align-self: flex-start; text-decoration: none; display: inline-block; }

.sc-projects-badge { display: inline-block; padding: 2px 8px; border-radius: ${radius.pill}; font-size: 10px; font-weight: ${typography.weightMedium}; text-transform: uppercase; letter-spacing: 0.02em; }
.sc-projects-badge-draft { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-projects-badge-active { background: ${colors.sageTint}; color: ${colors.sageDeep}; }
.sc-projects-badge-on_hold { background: ${colors.goldTint}; color: ${colors.gold}; }
.sc-projects-badge-closed_out { background: ${colors.paperDim}; color: ${colors.stoneDark}; }
.sc-projects-badge-archived { background: ${colors.brickTint}; color: ${colors.brick}; }
`;
