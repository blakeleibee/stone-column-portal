import { cookies } from "next/headers";
import { AdminChrome } from "../../../../../src/shell/AdminChrome";
import { ProjectSetupChecklist } from "../../../../../../../packages/02-app-shell/src/components/ProjectSetupChecklist";
import { NoProjectAccess } from "../../../../../../../packages/02-app-shell/src/components/NoProjectAccess";
import { isDemoMode } from "../../../../../src/server/demoMode";
import { requireRole } from "../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { SELECTED_PROJECT_COOKIE_NAME } from "../../../../../src/server/project/resolveSelectedProject";
import type { ProjectSwitcherData } from "../../../../../src/server/project/switcherDataAction";
import { listAccessibleProjects } from "../../../../../../../packages/02-app-shell/src/services/projectService";
import { getProjectSetupChecklist } from "../../../../../../../packages/02-app-shell/src/services/projectIntakeService";
import { switchProject } from "../../switchAction";

/**
 * Owner-preview correction round, item 11: the screen a newly-created
 * project lands on, reached only from ProjectListWorkspace.tsx's own
 * post-create flow (createProject() -> switchProject() -> push here).
 * Mirrors /admin/projects/[id]/team's own auth/data-loading pattern
 * (requireRole, createServerSupabaseClient, look up the project from
 * listAccessibleProjects, and build switcherData manually from that same
 * fetch rather than a second round trip through resolveProjectAndSwitcherData
 * — same reasoning that page's own comment gives) — real-backend-only,
 * same shape as every other /admin/projects/** route, so this always
 * requires a real authenticated admin/staff session regardless of
 * DEMO_MODE.
 *
 * P3.1 Task 7: now also fetches getProjectSetupChecklist(project.id) — the
 * real, derived-status computation the revised ProjectSetupChecklist
 * component renders (design §9) — and passes down the same switchProject
 * Server Action /admin/projects/page.tsx already uses, needed for the
 * "Preliminary estimating" link (see that component's own header comment
 * for why that one link needs it and the others don't).
 */
export default async function ProjectSetupPage({ params }: { params: { id: string } }) {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();

  // includeArchived: true — same reason team/page.tsx's own comment
  // gives: this one fetch backs both this page's own project lookup and
  // switcherData.hasArchivedProjects, so this route never issues more
  // than one listAccessibleProjects() query per request.
  const accessible = await listAccessibleProjects(supabase, user.orgId, { includeArchived: true });
  const project = accessible.find((p) => p.id === params.id);

  // P5.0 (Project-Context Write-Safety): matches team/page.tsx's own
  // fix — this used to fall through to `activeProjects[0]` when there
  // was no cookie or a stale one (the same silent-fallback defect fixed
  // in resolveSelectedProjectForCookieValue()). This page's own content
  // is scoped by `params.id` (already access-checked below), so only the
  // header switcher's "Current Project" label was ever at risk of
  // silently naming an unrelated project.
  const cookieStore = await cookies();
  const cookieProjectId = cookieStore.get(SELECTED_PROJECT_COOKIE_NAME)?.value ?? null;
  const activeProjects = accessible.filter((p) => p.status !== "archived");
  const currentProject = (cookieProjectId && activeProjects.find((p) => p.id === cookieProjectId)) || null;
  const switcherData: ProjectSwitcherData = {
    currentProject,
    otherProjects: activeProjects.filter((p) => p.id !== currentProject?.id),
    hasArchivedProjects: accessible.some((p) => p.status === "archived"),
    isAdmin: user.role === "admin",
  };

  if (!project) {
    return (
      <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <NoProjectAccess backHref="/admin/projects" />
      </AdminChrome>
    );
  }

  // Consistency / belt-and-suspenders with team/page.tsx's own
  // archived-project guard (P3 owner-preview fix round 1): this route
  // renders only links and a project-switch cookie action (the
  // "Preliminary estimating" link's switchProject call, P3.1 Task 7 —
  // that action only re-validates project access and sets the
  // selected-project cookie, it doesn't mutate project data), so there
  // is no live data write reachable from here for an archived project —
  // but blocking the render outright keeps this route's behavior
  // consistent with the now-guarded team page rather than leaving it as
  // the one remaining includeArchived: true detail route with no
  // archived treatment at all.
  if (project.status === "archived") {
    return (
      <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <NoProjectAccess
          backHref="/admin/projects"
          heading="This project is archived"
          message={`${project.name} is archived. Project setup isn't available for archived projects.`}
          backLabel="Back to your projects"
        />
      </AdminChrome>
    );
  }

  const checklist = await getProjectSetupChecklist(supabase, project.id);

  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <ProjectSetupChecklist
        projectId={project.id}
        projectName={project.name}
        overviewHref="/admin/overview"
        checklist={checklist}
        switchProject={switchProject}
      />
    </AdminChrome>
  );
}
