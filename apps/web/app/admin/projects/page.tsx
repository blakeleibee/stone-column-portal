import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectListWorkspace } from "../../../../../packages/02-app-shell/src/components/ProjectListWorkspace";
import { NoProjectAccess } from "../../../../../packages/02-app-shell/src/components/NoProjectAccess";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { listAccessibleProjects } from "../../../../../packages/02-app-shell/src/services/projectService";
import { resolveSelectedProject } from "../../../src/server/project/resolveSelectedProject";
import type { ProjectSwitcherData } from "../../../src/server/project/switcherDataAction";
import { createProject } from "./createAction";
import { switchProject } from "./switchAction";
import { changeProjectStatus } from "./statusAction";
import { upsertProjectBrief } from "./briefAction";
import { upsertProjectContact } from "./contactAction";

/**
 * Real project list (Task 4) — replaces the previous stub, which
 * unconditionally rendered loadAdminVM()'s hardcoded Hawks Ridge fixture
 * project via ProjectWorkspace, ignoring DEMO_MODE entirely (the known
 * bug Task 1-3's own research flagged). Same real-backend-only shape as
 * /admin/bids and /admin/import: projects are org-scoped real data with
 * no fixture-repository equivalent, so this screen always requires a
 * real authenticated admin/staff session, regardless of DEMO_MODE.
 *
 * Query params (P3-DESIGN.md's Decision 9/10, plus this task's own
 * judgment calls — see the Task 4 report):
 *   - `view=archived` / `view=completed` — the two separate, explicit
 *     read-only views (Decision 9, extended by the owner-preview
 *     correction round's item 9 to distinguish `closed_out` from
 *     `archived` rather than folding "Closed Out" into the active-ish
 *     list); default is the active-ish list (`draft`/`active`/`on_hold`
 *     only — `closed_out` moved out to its own view, so it no longer
 *     shows up mixed in with in-progress projects there).
 *   - `project=<id>` — a direct link naming a specific project. If it's
 *     not in the caller's accessible list (nonexistent, wrong org, or a
 *     revoked assignment), renders the shared NoProjectAccess page
 *     instead of the list (Decision 10) rather than a raw error or a
 *     silent fallback.
 *   - `new=1` — opens ProjectListWorkspace's inline create form
 *     pre-expanded (used by ProjectSwitcher's "+ Create New Project"
 *     link).
 */
export default async function AdminProjectsPage({
  searchParams,
}: {
  searchParams: { view?: string; project?: string; new?: string };
}) {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();

  const [allAccessible, currentProject, profilesResult] = await Promise.all([
    // includeArchived: true — this single fetch backs both the
    // ?project= accessibility check below (which must also recognize a
    // legitimately archived project the caller can still see) and
    // whichever of the active/completed/archived views is being
    // rendered, so this screen never issues more than one
    // listAccessibleProjects() query per request. `closed_out` rows are
    // already included regardless (only `archived` is excluded by
    // default), so no extra fetch is needed for the Completed view.
    listAccessibleProjects(supabase, user.orgId, { includeArchived: true }),
    resolveSelectedProject(supabase, user.orgId),
    // staff_function is selected here (owner-preview correction round,
    // item 4) so ProjectListWorkspace's initial-staff-assignments picker
    // can show real role context ("Jane Doe — Project Manager"), not a
    // bare name-only checkbox list — it was previously never selected at
    // all, so the picker structurally couldn't show it.
    // is_active filter (final-review fix wave, Important finding 2):
    // matches /admin/projects/[id]/team's own candidate-staff picker
    // query exactly — without this, a deactivated staff member was
    // assignable at project-creation time even though the team screen
    // already refuses to offer them.
    // role="staff" only (P3.1 Task 4): the create panel no longer offers
    // an existing-client-login picker — see ProjectListWorkspace.tsx's
    // own create-form comment for why that's a different concept from
    // the new project_clients contact quick-add, and this screen's Task
    // 4 report for the reasoning behind dropping it from create time.
    supabase
      .from("profiles")
      .select("id, full_name, role, staff_function")
      .eq("org_id", user.orgId)
      .eq("is_active", true)
      .eq("role", "staff"),
  ]);

  // Server-resolved ProjectSwitcher data (final-review fix wave, Minor
  // finding 2): this page already fetched allAccessible/currentProject
  // above for its own content, so build AdminChrome's switcher data from
  // that instead of issuing a second listAccessibleProjects()/
  // resolveSelectedProject() round trip via resolveProjectAndSwitcherData()
  // (the shared helper Task 5 used for the other five admin pages). The
  // switcher's own convention (per listAccessibleProjects()'s doc comment
  // and every other caller of resolveProjectAndSwitcherData) is
  // active-ish projects only, so `otherProjects` filters out archived
  // rows even though this page's own `allAccessible` fetch deliberately
  // includes them for the ?view=archived list below.
  const switcherData: ProjectSwitcherData = {
    currentProject,
    otherProjects: allAccessible.filter((project) => project.status !== "archived" && project.id !== currentProject?.id),
    hasArchivedProjects: allAccessible.some((project) => project.status === "archived"),
    isAdmin: user.role === "admin",
  };

  if (searchParams.project && !allAccessible.some((project) => project.id === searchParams.project)) {
    return (
      <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <NoProjectAccess backHref="/admin/projects" />
      </AdminChrome>
    );
  }

  const view = searchParams.view === "archived" ? "archived" : searchParams.view === "completed" ? "completed" : "active";
  const projects = allAccessible.filter((project) => {
    if (view === "archived") return project.status === "archived";
    if (view === "completed") return project.status === "closed_out";
    return project.status !== "archived" && project.status !== "closed_out";
  });

  const profileRows = profilesResult.data ?? [];
  const staffOptions = profileRows
    .filter((p) => p.role === "staff")
    .map((p) => ({ id: p.id, name: p.full_name, staffFunction: p.staff_function ?? null }));

  // Per-tab counts for the Active/Completed/Archived Tabs (owner-preview
  // polish pass, item 2) -- derived from the SAME allAccessible array
  // already fetched above for this page's own content (no new query).
  // Mirrors the exact bucketing `view`'s own filter uses just above, so
  // a tab's count and its own filtered list can never disagree.
  const activeCount = allAccessible.filter(
    (project) => project.status !== "archived" && project.status !== "closed_out"
  ).length;
  const completedCount = allAccessible.filter((project) => project.status === "closed_out").length;
  const archivedCount = allAccessible.filter((project) => project.status === "archived").length;

  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <ProjectListWorkspace
        view={view}
        projects={projects}
        currentProjectId={currentProject?.id ?? null}
        orgId={user.orgId}
        isAdmin={user.role === "admin"}
        staffOptions={staffOptions}
        hasCompletedProjects={allAccessible.some((project) => project.status === "closed_out")}
        hasArchivedProjects={allAccessible.some((project) => project.status === "archived")}
        activeCount={activeCount}
        completedCount={completedCount}
        archivedCount={archivedCount}
        initialCreateOpen={searchParams.new === "1"}
        createProject={createProject}
        switchProject={switchProject}
        briefAction={upsertProjectBrief}
        contactAction={upsertProjectContact}
        changeProjectStatus={changeProjectStatus}
        activeProjectsHref="/admin/projects"
        completedProjectsHref="/admin/projects?view=completed"
        archivedProjectsHref="/admin/projects?view=archived"
      />
    </AdminChrome>
  );
}
