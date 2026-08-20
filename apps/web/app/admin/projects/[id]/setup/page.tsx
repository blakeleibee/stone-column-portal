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

  const cookieStore = await cookies();
  const cookieProjectId = cookieStore.get(SELECTED_PROJECT_COOKIE_NAME)?.value ?? null;
  const activeProjects = accessible.filter((p) => p.status !== "archived");
  const currentProject =
    (cookieProjectId && activeProjects.find((p) => p.id === cookieProjectId)) || activeProjects[0] || null;
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

  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <ProjectSetupChecklist projectId={project.id} projectName={project.name} overviewHref="/admin/overview" />
    </AdminChrome>
  );
}
