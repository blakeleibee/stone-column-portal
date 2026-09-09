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
 *
 * P3.1 Task 4 rewrite: the create form is now the "progressive
 * creation" panel from P3.1-DESIGN.md §3 — project number and every
 * pricing field are gone entirely (project_number is server-generated
 * as of schema/018; pricing now lives on Task 8's own Contract &
 * Pricing Terms screen, reachable post-creation). The form's required
 * minimum is: name, project type, project location (or "not
 * established" yet), and a short project concept. A primary-homeowner
 * contact quick-add and the existing staff picker are both optional.
 * See handleCreateSubmit's own comment for the create -> brief -> contact
 * -> switch -> redirect sequencing this now involves.
 *
 * VISUAL MODERNIZATION (docs/production-build/VISUAL-MODERNIZATION-PLAN.md):
 * this file was rebuilt to use the shared `./ui` primitive layer in place
 * of its own one-off `sc-projects-*` classes. Zero behavior/sequencing/
 * validation/authorization change from the rewrite above — only markup
 * and styling. Specifically:
 *   - The create panel is now four `Card` sections (Project identity,
 *     Homeowner, Location & concept, Staff assignment) instead of one
 *     flat form, using `FormField`/`FormGrid` so label+control+error
 *     never get packed onto one line.
 *   - The homeowner quick-add's submit button is relabeled from "Save
 *     contact info" (which read as a completed network write) to "Add to
 *     project" (honest about the still-local-only capture — see
 *     handleCreateSubmit for the actual write, which only happens after
 *     createProject() succeeds).
 *   - Cancel/Discard moved from the page-level toolbar (`handleToggleCreate`
 *     previously doubled as both "open" and "discard-and-close") into the
 *     form's own bottom action row, next to Create — see
 *     `handleOpenCreate`/`handleDiscardCreate` below. The toolbar's
 *     "+ Create New Project" button is only rendered while the form is
 *     closed, so it's never adjacent to a Cancel-shaped control.
 *   - Each row is now one compact flex line (name/badges + primary
 *     action) plus a meta line, instead of a taller stacked card. Status
 *     transitions (previously one button per valid transition, shown
 *     unconditionally) now collapse into a `MenuButton` — the existing
 *     click -> inline "are you sure?" -> confirm/cancel SAFETY step for a
 *     status change is unchanged, just triggered from a menu item instead
 *     of a bare button.
 *   - Setup-progress and per-row assigned-staff names are NOT rendered:
 *     `ProjectRow` (projectService.ts) carries neither a checklist-derived
 *     status nor any staff-assignment join, and this page's own
 *     `listAccessibleProjects()` call doesn't fetch either — adding either
 *     would mean a new data-fetching call this visual-only task is not
 *     scoped to add. Flagged as a follow-up, not fabricated.
 */
import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { colors, spacing, radius, typography } from "../design/tokens";
import type { ProjectRow, ProjectStatus, CreateProjectParams, StaffFunction } from "../services/projectService";
import type { ProjectContactInput, ProjectBriefWriteFields, ContactRole } from "../services/projectIntakeService";
import { ProjectContactForm } from "./ProjectContactsWorkspace";
import {
  Button,
  TextInput,
  Textarea,
  Select,
  Checkbox,
  FormField,
  FormGrid,
  Card,
  PageHeader,
  Badge,
  StatusBadge,
  Alert,
  EmptyState,
  Tabs,
  MenuButton,
} from "./ui";
import type { BadgeTone, MenuButtonItem } from "./ui";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On Hold",
  closed_out: "Closed Out",
  archived: "Archived",
};

/** Visual tone for each project status's `StatusBadge` — a display-only
 *  mapping onto the shared `ui/` Badge tone vocabulary, kept separate
 *  from STATUS_LABELS (domain wording) same as every other screen's own
 *  status-to-tone mapping (Badge.tsx's own doc comment explains why this
 *  isn't centralized). */
function statusTone(status: ProjectStatus): BadgeTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "active":
      return "sage";
    case "on_hold":
      return "gold";
    case "closed_out":
      return "neutral";
    case "archived":
      return "brick";
  }
}

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
 *
 * MAINTENANCE NOTE (Minor finding, FIX ROUND 1 review): this is a
 * hand-maintained TypeScript copy of the SQL matrix in
 * enforce_project_status_transition() — nothing enforces the two stay
 * in sync. schema/017_project_status_reversible_lifecycle.sql's `if not
 * (...)` condition is the actual source of truth (offering a
 * destination here that the trigger would reject just surfaces the
 * trigger's own error after a wasted round trip; the reverse — the
 * trigger silently allowing more than this list offers — is the
 * meaner failure mode, since it'd be invisible in the UI). If a future
 * migration widens or narrows that condition again, update this object
 * to match in the same change.
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
// Labeling fix only (owner-preview polish pass, item 3) — values/filtering
// logic below are byte-for-byte unchanged from before this pass; only the
// "all" option's LABEL changed, from "All statuses" (which read as a
// second, competing tab-like control, especially since one of ITS OWN
// options is literally "Active" -- the same word as the tab you're
// already on) to wording that makes clear this select is a sub-filter
// scoped to the current (Active) tab, not another lifecycle-stage view.
const ACTIVE_STATUS_FILTERS: { value: ProjectStatus | "all"; label: string }[] = [
  { value: "all", label: "All active statuses" },
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
];

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

// Same labels as ProjectContactsWorkspace.tsx's own ROLE_LABELS (not
// exported there) — deliberate small duplication, same convention as
// STAFF_FUNCTION_LABELS above. Only needed here to render a one-line
// summary of the captured quick-add contact once it's been filled in.
const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  primary_homeowner: "Primary homeowner",
  secondary_homeowner: "Secondary homeowner",
  other_household: "Other household member",
  professional_contact: "Professional contact",
};

type SortKey = "name" | "projectNumber" | "createdAt";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  // Fixed locale + timeZone (not the environment default): SSR runs on the
  // server's timezone while hydration runs in the viewer's browser
  // timezone, so an unpinned toLocaleDateString() can render a different
  // calendar date in each and trip a React hydration mismatch.
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC" });
}

export interface ProjectOption {
  id: string;
  name: string;
}

/** staffOptions carries `staff_function` (owner-preview correction round,
 *  item 4) so the picker can show real names + role, not a bare id-backed
 *  checkbox list. */
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
  hasCompletedProjects: boolean;
  hasArchivedProjects: boolean;
  /** Per-tab counts for the Active/Completed/Archived `Tabs` (owner-preview
   *  polish pass, item 2) — derived cheaply by page.tsx from the SAME
   *  `allAccessible` array it already fetches for this page's own content
   *  (no new query). Always the count across every accessible project in
   *  that lifecycle bucket, independent of `view`/`projects` (which is
   *  already filtered down to just the active view) so every tab always
   *  shows its own true count regardless of which tab is currently open. */
  activeCount: number;
  completedCount: number;
  archivedCount: number;
  initialCreateOpen?: boolean;
  createProject: (params: CreateProjectParams) => Promise<{ id: string } | { error: string }>;
  switchProject: (projectId: string) => Promise<{ id: string } | { error: string }>;
  /** briefAction.ts's wrapper over upsertProjectBrief() (P3.1 Task 3).
   *  Called once, after a successful createProject(), to write the
   *  create-panel's required "short project concept" text as
   *  project_briefs.summary — see handleCreateSubmit's own comment for
   *  the full create -> brief -> contact -> switch -> redirect
   *  sequencing and why this is a best-effort follow-up, not a blocking
   *  step. */
  briefAction: (projectId: string, fields: ProjectBriefWriteFields) => Promise<{} | { error: string }>;
  /** contactAction.ts's wrapper over upsertProjectContact() (P3.1 Task 3).
   *  `project_clients.project_id` is `not null references projects(id)`
   *  (schema/012), so the create panel's inline `ProjectContactForm`
   *  quick-add cannot call this while the project doesn't exist yet — it
   *  captures the contact into local state instead (see
   *  ProjectContactsWorkspace.tsx's own header comment, "CREATE-TIME
   *  CONTACT COLLECTION", which this component follows exactly) and this
   *  action is only called once, as a follow-up, after createProject()
   *  returns the new project's id. */
  contactAction: (projectId: string, contact: ProjectContactInput) => Promise<{ id: string } | { error: string }>;
  /** statusAction.ts's wrapper over change_project_status() (schema/017,
   *  Task D1). The RPC's own admin check is a friendly pre-check, not
   *  the real boundary (FIX ROUND 1, independent review, empirically
   *  proven) — a non-admin can bypass this RPC entirely with a raw
   *  `supabase.from("projects").update(...)` call, since
   *  projects_staff_update's RLS policy (schema/016) admits any
   *  non-superintendent staff. The actual boundary is the admin check
   *  now inside enforce_project_status_transition() (schema/017 FIX
   *  ROUND 1), a database trigger every write path funnels through.
   *  This component only hides the control for non-admins as a UI
   *  convenience, same "UI hiding is cosmetic, the trigger is real"
   *  framing used throughout this package. */
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
  hasCompletedProjects,
  hasArchivedProjects,
  activeCount,
  completedCount,
  archivedCount,
  initialCreateOpen,
  createProject,
  switchProject,
  briefAction,
  contactAction,
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
  /** Set only when createProject() itself succeeded but a best-effort
   *  follow-up (the brief and/or contact write) failed — see
   *  handleCreateSubmit. Rendered outside the createOpen-gated section
   *  (same placement as switchError below) so it's still visible after
   *  a successful create collapses the form and this component
   *  navigates away. */
  const [postCreateWarning, setPostCreateWarning] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [addressNotEstablished, setAddressNotEstablished] = useState(false);
  const [projectTypeChoice, setProjectTypeChoice] = useState("");
  const [projectTypeOther, setProjectTypeOther] = useState("");
  const [projectTypeTouched, setProjectTypeTouched] = useState(false);
  const [conceptSummary, setConceptSummary] = useState("");
  const [conceptTouched, setConceptTouched] = useState(false);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);

  // Primary-homeowner quick-add (design §3/§4) — captured locally, never
  // submitted to contactAction until createProject() has returned a real
  // project id. See ProjectContactsWorkspace.tsx's "CREATE-TIME CONTACT
  // COLLECTION" comment for why ProjectContactForm's onSubmit is wired to
  // a local setter here instead of a Server Action directly.
  const [contactInput, setContactInput] = useState<ProjectContactInput | null>(null);
  // true => render the (blank-or-prefilled) ProjectContactForm; false =>
  // render the captured-contact summary + Edit/Remove instead. Always
  // true whenever contactInput is null (there is nothing to summarize),
  // and only ever false while contactInput holds a just-captured value.
  const [contactFormOpen, setContactFormOpen] = useState(true);

  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Status-change control (Task D1) — single pending confirm across all
  // rows at once, same "one inline confirm at a time" shape as
  // ProjectTeamWorkspace.tsx's revokeConfirmId.
  const [statusConfirm, setStatusConfirm] = useState<{ projectId: string; newStatus: ProjectStatus } | null>(null);
  const [statusSubmittingId, setStatusSubmittingId] = useState<string | null>(null);
  const [statusErrors, setStatusErrors] = useState<Record<string, string | null>>({});

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
    setAddress("");
    setAddressNotEstablished(false);
    setProjectTypeChoice("");
    setProjectTypeOther("");
    setProjectTypeTouched(false);
    setConceptSummary("");
    setConceptTouched(false);
    setSelectedStaffIds([]);
    setContactInput(null);
    setContactFormOpen(true);
  }

  /** Toolbar's "+ Create New Project" button — only rendered while the
   *  form is closed (see the JSX below), so this only ever opens it. */
  function handleOpenCreate() {
    setCreateOpen(true);
  }

  /** The form's own bottom-of-form "Cancel" action (moved out of the
   *  page-level toolbar per the visual-modernization plan's "Create
   *  Project — specific fixes": Cancel/Discard must live in the form's
   *  own action row, not next to the Active/Completed/Archived view tabs
   *  or search/filter controls). Same discard-on-close behavior the old
   *  combined toggle button had: closing the form actually discards
   *  whatever was typed, rather than leaving stale state around for next
   *  time the form opens. */
  function handleDiscardCreate() {
    resetCreateForm();
    setCreateError(null);
    setCreateOpen(false);
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameTouched(true);
    setProjectTypeTouched(true);
    setConceptTouched(true);

    if (!name.trim()) {
      setCreateError("Project name is required.");
      return;
    }

    const resolvedProjectType =
      projectTypeChoice === "" ? null : projectTypeChoice === "Other" ? projectTypeOther.trim() || null : projectTypeChoice;
    if (!resolvedProjectType) {
      setCreateError("Project type is required.");
      return;
    }

    const trimmedConcept = conceptSummary.trim();
    if (!trimmedConcept) {
      setCreateError("A short project concept is required.");
      return;
    }

    const params: CreateProjectParams = {
      orgId,
      name: name.trim(),
      // P3.1 (Task 2): project_number is server-generated
      // (generate_project_number(), schema/018) — CreateProjectParams no
      // longer has a projectNumber field at all. Pricing is left
      // entirely undetermined at create time (Task 8 owns setting it,
      // post-creation, via setProjectFeeTerms()) — no pricingModel/
      // feeBasis/fee* fields are sent here at all.
      address: addressNotEstablished ? null : address.trim() || null,
      projectType: resolvedProjectType,
      initialStaffProfileIds: selectedStaffIds,
    };

    setCreateError(null);
    setPostCreateWarning(null);
    setCreateSubmitting(true);
    try {
      const result = await createProject(params);
      if ("error" in result) {
        setCreateError(result.error);
        return;
      }

      const newProjectId = result.id;
      const capturedContact = contactInput;

      resetCreateForm();
      setCreateOpen(false);

      // Best-effort follow-ups (design §3, Task 4 brief): the project
      // itself already exists at this point, so neither of these should
      // block the redirect or silently lose what the user entered if it
      // fails — collect any failures into postCreateWarning and continue
      // regardless. Both are independent writes, run concurrently.
      const followUpErrors: string[] = [];
      const followUps: Promise<void>[] = [
        briefAction(newProjectId, { summary: trimmedConcept }).then((briefResult) => {
          if ("error" in briefResult) followUpErrors.push(`project concept (${briefResult.error})`);
        }),
      ];
      if (capturedContact) {
        followUps.push(
          contactAction(newProjectId, capturedContact).then((contactResult) => {
            if ("error" in contactResult) followUpErrors.push(`primary contact (${contactResult.error})`);
          })
        );
      }
      await Promise.all(followUps);
      if (followUpErrors.length > 0) {
        setPostCreateWarning(
          `"${params.name}" was created, but the ${followUpErrors.join(" and ")} couldn't be saved. You can add ${
            followUpErrors.length > 1 ? "them" : "it"
          } from the project's Setup screen.`
        );
      }

      const switchResult = await switchProject(newProjectId);
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
      router.push(`/admin/projects/${newProjectId}/setup`);
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
      <PageHeader title={viewTitle}>
        <Tabs
          aria-label="Project view"
          activeKey={view}
          items={[
            { key: "active", label: `Active (${activeCount})`, href: activeProjectsHref },
            { key: "completed", label: `Completed (${completedCount})`, href: completedProjectsHref },
            { key: "archived", label: `Archived (${archivedCount})`, href: archivedProjectsHref },
          ]}
        />
      </PageHeader>

      {view === "archived" && <Alert tone="info">Archived projects are shown read-only in this view.</Alert>}
      {view === "completed" && (
        <Alert tone="info">
          Completed projects are shown read-only in this view. &ldquo;Manage Team&rdquo; still applies — staffing cleanup on
          a just-finished job is often still legitimate.
        </Alert>
      )}

      <div className="sc-projects-controls">
        <div className="sc-projects-controls-search">
          <TextInput
            type="search"
            placeholder="Search by name or project number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search projects"
          />
        </div>
        {view === "active" && (
          // Labeling fix only (owner-preview polish pass, item 3): the
          // "Status:" text + wrapper below make this select visually read
          // as a sub-filter attached to the Active tab's own content, not
          // a second, competing tab-like control -- the Select's own
          // value/onChange/options and the underlying statusFilter state
          // are byte-for-byte unchanged.
          <div className="sc-projects-status-filter">
            <span className="sc-projects-status-filter-label" aria-hidden="true">
              Status:
            </span>
            <div className="sc-projects-controls-select">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | "all")}
                aria-label="Filter by status"
              >
                {ACTIVE_STATUS_FILTERS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
        <div className="sc-projects-controls-select">
          <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort by">
            <option value="name">Sort: Name</option>
            <option value="projectNumber">Sort: Project #</option>
            <option value="createdAt">Sort: Newest</option>
          </Select>
        </div>

        {view === "active" && isAdmin && !createOpen && (
          <Button type="button" onClick={handleOpenCreate}>
            + Create New Project
          </Button>
        )}
      </div>

      {switchError && <Alert tone="error">{switchError}</Alert>}
      {postCreateWarning && <Alert tone="warning">{postCreateWarning}</Alert>}

      {view === "active" && isAdmin && createOpen && (
        <section className="sc-projects-create">
          <h3 className="sc-projects-create-title">Create a new project</h3>
          <form onSubmit={handleCreateSubmit} className="sc-projects-form">
            <Card>
              <h4 className="sc-projects-section-title">Project identity</h4>
              <FormGrid columns={2}>
                <FormField
                  label="Project name"
                  required
                  error={nameTouched && !name.trim() ? "Project name is required." : undefined}
                >
                  <TextInput
                    id="sc-proj-name"
                    required
                    aria-required="true"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setNameTouched(true)}
                  />
                </FormField>
                <FormField
                  label="Project type"
                  required
                  error={projectTypeTouched && !projectTypeChoice ? "Project type is required." : undefined}
                >
                  <Select
                    id="sc-proj-type"
                    required
                    aria-required="true"
                    value={projectTypeChoice}
                    onChange={(e) => setProjectTypeChoice(e.target.value)}
                    onBlur={() => setProjectTypeTouched(true)}
                  >
                    <option value="">— Select —</option>
                    {PROJECT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </FormGrid>
              {projectTypeChoice === "Other" && (
                <FormField
                  label="Describe the project type"
                  required
                  error={projectTypeTouched && !projectTypeOther.trim() ? "Describe the project type." : undefined}
                  className="sc-projects-followup-field"
                >
                  <TextInput
                    id="sc-proj-type-other"
                    required
                    aria-required="true"
                    placeholder="Describe the project type"
                    value={projectTypeOther}
                    onChange={(e) => setProjectTypeOther(e.target.value)}
                    onBlur={() => setProjectTypeTouched(true)}
                  />
                </FormField>
              )}
            </Card>

            <Card>
              <h4 className="sc-projects-section-title">Homeowner</h4>
              <p className="sc-projects-field-help">
                A lead can exist before a homeowner identity is fully confirmed — fill this in now, or skip it and add it
                from the project's Setup screen later. This is optional.
              </p>
              {contactFormOpen ? (
                <ProjectContactForm
                  key={contactInput ? "contact-edit" : "contact-add"}
                  initialContact={contactInput ?? { role: "primary_homeowner", isPrimary: true }}
                  // "Add to project", not "Save contact info" -- this is
                  // still a local-only capture, not a completed write; see
                  // this file's header comment (VISUAL MODERNIZATION).
                  submitLabel="Add to project"
                  cancelLabel="Discard changes"
                  // Nested inside the outer "sc-projects-form" <form> below
                  // -- renderAsForm={false} avoids an invalid nested <form>
                  // (a real hydration bug previously fixed here). See
                  // ProjectContactForm's own renderAsForm doc comment.
                  renderAsForm={false}
                  onCancel={contactInput ? () => setContactFormOpen(false) : undefined}
                  onSubmit={async (input) => {
                    setContactInput(input);
                    setContactFormOpen(false);
                    return {};
                  }}
                />
              ) : (
                contactInput && (
                  <div className="sc-projects-contact-summary">
                    <div className="sc-projects-contact-summary-header">
                      <Badge tone="sage">Added</Badge>
                      <p>
                        <strong>{contactInput.fullName}</strong>
                        {contactInput.role ? ` — ${CONTACT_ROLE_LABELS[contactInput.role]}` : ""} will be added as a
                        contact once the project is created.
                      </p>
                    </div>
                    <div className="sc-projects-contact-summary-actions">
                      <Button type="button" size="sm" variant="secondary" onClick={() => setContactFormOpen(true)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setContactInput(null);
                          setContactFormOpen(true);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )
              )}
            </Card>

            <Card>
              <h4 className="sc-projects-section-title">Location &amp; concept</h4>
              <FormField label="Project location">
                <TextInput
                  id="sc-proj-address"
                  disabled={addressNotEstablished}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </FormField>
              <Checkbox
                id="sc-proj-address-unestablished"
                checked={addressNotEstablished}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setAddressNotEstablished(checked);
                  if (checked) setAddress("");
                }}
                label="Address not established yet (e.g. a lead still shopping lots)"
              />
              <FormField
                label="Short project concept"
                required
                error={conceptTouched && !conceptSummary.trim() ? "A short project concept is required." : undefined}
                className="sc-projects-followup-field"
              >
                <Textarea
                  id="sc-proj-concept"
                  required
                  aria-required="true"
                  rows={3}
                  placeholder="One to two sentences — what is this project?"
                  value={conceptSummary}
                  onChange={(e) => setConceptSummary(e.target.value)}
                  onBlur={() => setConceptTouched(true)}
                />
              </FormField>
            </Card>

            <Card>
              <h4 className="sc-projects-section-title">Staff assignment</h4>
              <div className="sc-ui-field">
                <span className="sc-ui-field-label">Initial staff assignments (optional)</span>
                {staffOptions.length === 0 ? (
                  <p className="sc-ui-field-hint">No other staff members in this organization yet.</p>
                ) : (
                  <div className="sc-projects-checkbox-list">
                    {staffOptions.map((opt) => (
                      <Checkbox
                        key={opt.id}
                        checked={selectedStaffIds.includes(opt.id)}
                        onChange={() => setSelectedStaffIds((prev) => toggleId(prev, opt.id))}
                        label={`${opt.name}${opt.staffFunction ? ` — ${STAFF_FUNCTION_LABELS[opt.staffFunction]}` : ""}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <div className="sc-projects-form-actions">
              <Button type="submit" loading={createSubmitting} loadingText="Creating…">
                Create Project
              </Button>
              <Button type="button" variant="secondary" onClick={handleDiscardCreate} disabled={createSubmitting}>
                Cancel
              </Button>
            </div>
            {createError && <Alert tone="error">{createError}</Alert>}
          </form>
        </section>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={
            projects.length === 0
              ? view === "archived"
                ? "No archived projects."
                : view === "completed"
                  ? "No completed projects."
                  : hasCompletedProjects || hasArchivedProjects
                    ? "No active projects for this organization — see Completed or Archived above."
                    : "No projects yet for this organization."
              : "No projects match your search/filter."
          }
        />
      ) : (
        <ul className="sc-projects-list">
          {filtered.map((project) => {
            const isCurrent = project.id === currentProjectId;
            // "Switch to this project" only ever applies in the active
            // view (unchanged from the pre-modernization behavior) and
            // never for the row that's already current.
            const canSwitch = view === "active" && !isCurrent;
            // "Manage Team" is offered in Active and Completed (owner-
            // preview correction round, item 9) — unchanged.
            const canManageTeam = view === "active" || view === "completed";
            const transitions = isAdmin ? STATUS_TRANSITIONS[project.status] : [];
            const menuItems: MenuButtonItem[] = transitions.map((option) => ({
              key: option.status,
              label: option.label,
              onClick: () => handleStatusOptionClick(project.id, option.status),
            }));

            return (
              <li key={project.id} className="sc-projects-row">
                <div className="sc-projects-row-top">
                  <div className="sc-projects-row-identity">
                    {/* Real link, every row/view (owner-preview polish
                        pass, item 5): /admin/projects/[id]/setup is
                        URL-scoped by project id and needs no "current
                        project" cookie/switch first (unlike
                        Overview/Financials/Estimate, which resolve the
                        current project from the switcher cookie) -- so
                        it's always safely reachable without switching
                        context, for a just-created, an already-current,
                        or any other accessible project alike. "Switch to
                        this project" below is unchanged and remains the
                        correct action for actually changing which
                        project is current for the cookie-scoped screens. */}
                    <a href={`/admin/projects/${project.id}/setup`} className="sc-projects-row-name">
                      {project.name}
                    </a>
                    <StatusBadge label={STATUS_LABELS[project.status]} tone={statusTone(project.status)} />
                    {isCurrent && <Badge tone="sage">Current</Badge>}
                  </div>
                  {/* One clear primary action per row (open/manage) +
                      status-change/archive collapsed into a MenuButton,
                      per the visual-modernization plan's project-list
                      requirement. The confirm-before-applying SAFETY step
                      for a status change (Task D1) is unchanged — a menu
                      click only ever sets statusConfirm below, never
                      applies the change directly. */}
                  <div className="sc-projects-row-actions">
                    {canSwitch && (
                      <Button
                        type="button"
                        size="sm"
                        loading={switchingId === project.id}
                        loadingText="Switching…"
                        onClick={() => handleSwitch(project.id)}
                      >
                        Switch to this project
                      </Button>
                    )}
                    {canManageTeam && (
                      <a
                        href={`/admin/projects/${project.id}/team`}
                        className={`sc-ui-btn sc-ui-btn-sm ${canSwitch ? "sc-ui-btn-secondary" : "sc-ui-btn-primary"}`}
                      >
                        Manage Team
                      </a>
                    )}
                    {menuItems.length > 0 && <MenuButton label="⋯" ariaLabel="More actions" items={menuItems} />}
                  </div>
                </div>
                <div className="sc-projects-row-meta">
                  <span>#{project.projectNumber}</span>
                  {project.address && <span>{project.address}</span>}
                  {project.pricingModelLabel && <span>{project.pricingModelLabel}</span>}
                  <span>Created {formatDate(project.createdAt)}</span>
                </div>

                {/* Task D1 (P3 owner-preview round 2): status-change
                    confirm step, admin-only in the UI. The real boundary
                    is the admin check inside enforce_project_status_
                    transition() (schema/017 FIX ROUND 1) — a database
                    trigger enforced identically for this control's RPC
                    call AND any other write path (a raw PostgREST UPDATE
                    included), not the RPC's own is_org_admin_for_org()
                    check alone. Same "UI hiding is cosmetic, the trigger
                    is real" framing used throughout this package. Shown
                    in every view, including Archived. Click a menu item
                    above -> this inline "are you sure?" state -> confirm/
                    cancel, mirroring ProjectTeamWorkspace.tsx's Revoke
                    confirm exactly, never a native confirm() dialog. */}
                {statusConfirm?.projectId === project.id && (
                  <Alert tone="warning" className="sc-projects-status-confirm">
                    <p>
                      Change status of &ldquo;{project.name}&rdquo; from {STATUS_LABELS[project.status]} to{" "}
                      {STATUS_LABELS[statusConfirm.newStatus]}?
                    </p>
                    <div className="sc-projects-status-confirm-actions">
                      <Button
                        type="button"
                        size="sm"
                        loading={statusSubmittingId === project.id}
                        loadingText="Saving…"
                        onClick={handleStatusConfirm}
                      >
                        Yes, change status
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={handleStatusCancel}>
                        Cancel
                      </Button>
                    </div>
                  </Alert>
                )}
                {statusErrors[project.id] && <Alert tone="error">{statusErrors[project.id]}</Alert>}
              </li>
            );
          })}
        </ul>
      )}

      <style dangerouslySetInnerHTML={{ __html: workspaceStyles }} />
    </div>
  );
}

const workspaceStyles = `
.sc-projects-workspace { font-family: ${typography.fontFamily}; color: ${colors.ink}; }

.sc-projects-controls { display: flex; flex-wrap: wrap; gap: ${spacing.sm}; margin-bottom: ${spacing.md}; align-items: center; }
.sc-projects-controls-search { flex: 1 1 240px; min-width: 200px; }
.sc-projects-controls-select { min-width: 170px; }
/* "Status:" sub-filter label (owner-preview polish pass, item 3) -- a
   purely visual wrapper around the existing Active-tab status Select, no
   logic of its own. aria-hidden on the label text avoids double
   announcement against the Select's own (unchanged) aria-label. */
.sc-projects-status-filter { display: flex; align-items: center; gap: ${spacing.xs}; }
.sc-projects-status-filter-label { font-size: ${typography.sizeXs}; color: ${colors.ink2}; white-space: nowrap; flex-shrink: 0; }

.sc-projects-create { margin-bottom: ${spacing.lg}; }
.sc-projects-create-title { margin: 0 0 ${spacing.md} 0; font-size: ${typography.sizeMd}; }
.sc-projects-form { display: flex; flex-direction: column; gap: ${spacing.lg}; align-items: stretch; width: 100%; }
.sc-projects-section-title { margin: 0 0 ${spacing.md} 0; font-size: ${typography.sizeMd}; color: ${colors.ink}; }
.sc-projects-followup-field { margin-top: ${spacing.sm}; }
/* stoneDark -> ink2 (owner-preview polish pass, item 6): this is real
   body copy a user needs to read (not a decorative/uppercase eyebrow),
   at sizeXs (11px) -- stoneDark's ~3.9:1 contrast against white fails
   WCAG AA for normal text at that size; ink2's ~6.4:1 passes. */
.sc-projects-field-help { margin: 0 0 ${spacing.sm} 0; font-size: ${typography.sizeXs}; color: ${colors.ink2}; }
.sc-projects-checkbox-list { display: flex; flex-direction: column; gap: ${spacing.xs}; max-height: 160px; overflow-y: auto; border: 1px solid ${colors.line}; border-radius: ${radius.sm}; padding: ${spacing.sm}; background: ${colors.white}; }
.sc-projects-contact-summary { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm} ${spacing.md}; background: ${colors.sageTint}; display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-projects-contact-summary-header { display: flex; align-items: flex-start; gap: ${spacing.sm}; }
.sc-projects-contact-summary-header p { margin: 0; font-size: ${typography.sizeSm}; color: ${colors.ink}; }
.sc-projects-contact-summary-actions { display: flex; gap: ${spacing.xs}; }
.sc-projects-form-actions { display: flex; gap: ${spacing.sm}; align-items: center; }

.sc-projects-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${spacing.sm}; }
.sc-projects-row { border: 1px solid ${colors.line}; border-radius: ${radius.md}; padding: ${spacing.sm} ${spacing.md}; background: ${colors.white}; display: flex; flex-direction: column; gap: 4px; }
.sc-projects-row-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: ${spacing.sm}; }
.sc-projects-row-identity { display: flex; align-items: center; gap: ${spacing.sm}; flex-wrap: wrap; min-width: 0; }
/* Project name is now a real link to that row's Setup page (owner-preview
   polish pass, item 5) -- color/text-decoration/hover/focus-visible added
   so it reads as an interactive control, reusing ProjectSwitcher.tsx's own
   link-hover token (sageDeep) and this codebase's one focus-ring
   convention (colors.focusRing), not new colors. */
.sc-projects-row-name { font-weight: ${typography.weightSemibold}; font-size: ${typography.sizeMd}; overflow-wrap: anywhere; color: ${colors.ink}; text-decoration: none; border-radius: ${radius.sm}; }
.sc-projects-row-name:hover { color: ${colors.sageDeep}; text-decoration: underline; }
.sc-projects-row-name:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: 2px; }
.sc-projects-row-actions { display: flex; flex-wrap: wrap; gap: ${spacing.xs}; align-items: center; }
/* stoneDark -> ink2 (owner-preview polish pass, item 6): project number/
   address/pricing label/created date are real secondary data a user
   needs to read, at sizeXs (11px) -- same low-contrast failure as
   .sc-projects-field-help above, same fix. */
.sc-projects-row-meta { display: flex; flex-wrap: wrap; gap: ${spacing.sm}; color: ${colors.ink2}; font-size: ${typography.sizeXs}; overflow-wrap: anywhere; }
.sc-projects-status-confirm { margin-top: 4px; }
.sc-projects-status-confirm p { margin: 0 0 ${spacing.xs} 0; }
.sc-projects-status-confirm-actions { display: flex; gap: ${spacing.xs}; }
`;
