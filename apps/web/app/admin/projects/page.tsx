import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectListWorkspace } from "../../../../../packages/02-app-shell/src/components/ProjectListWorkspace";
import { NoProjectAccess } from "../../../../../packages/02-app-shell/src/components/NoProjectAccess";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { listAccessibleProjects } from "../../../../../packages/02-app-shell/src/services/projectService";
import { resolveSelectedProject } from "../../../src/server/project/resolveSelectedProject";
import { createProject } from "./createAction";
import { switchProject } from "./switchAction";

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
 *   - `view=archived` — the separate, explicit "Completed / Archived"
 *     view (Decision 9); default is the active-ish list.
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
    // whichever of the active/archived views is being rendered, so this
    // screen never issues more than one listAccessibleProjects() query
    // per request.
    listAccessibleProjects(supabase, user.orgId, { includeArchived: true }),
    resolveSelectedProject(supabase, user.orgId),
    supabase.from("profiles").select("id, full_name, role").eq("org_id", user.orgId).in("role", ["staff", "client"]),
  ]);

  if (searchParams.project && !allAccessible.some((project) => project.id === searchParams.project)) {
    return (
      <AdminChrome activeKey="projects" isDemoMode={isDemoMode()}>
        <NoProjectAccess backHref="/admin/projects" />
      </AdminChrome>
    );
  }

  const view = searchParams.view === "archived" ? "archived" : "active";
  const projects = allAccessible.filter((project) =>
    view === "archived" ? project.status === "archived" : project.status !== "archived"
  );

  const profileRows = profilesResult.data ?? [];
  const staffOptions = profileRows.filter((p) => p.role === "staff").map((p) => ({ id: p.id, name: p.full_name }));
  const clientOptions = profileRows.filter((p) => p.role === "client").map((p) => ({ id: p.id, name: p.full_name }));

  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()}>
      <ProjectListWorkspace
        view={view}
        projects={projects}
        currentProjectId={currentProject?.id ?? null}
        orgId={user.orgId}
        isAdmin={user.role === "admin"}
        staffOptions={staffOptions}
        clientOptions={clientOptions}
        initialCreateOpen={searchParams.new === "1"}
        createProject={createProject}
        switchProject={switchProject}
        activeProjectsHref="/admin/projects"
        archivedProjectsHref="/admin/projects?view=archived"
      />
    </AdminChrome>
  );
}
