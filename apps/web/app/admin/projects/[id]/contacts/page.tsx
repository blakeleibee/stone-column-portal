import { cookies } from "next/headers";
import { AdminChrome } from "../../../../../src/shell/AdminChrome";
import { ProjectContactsWorkspace } from "../../../../../../../packages/02-app-shell/src/components/ProjectContactsWorkspace";
import { NoProjectAccess } from "../../../../../../../packages/02-app-shell/src/components/NoProjectAccess";
import { isDemoMode } from "../../../../../src/server/demoMode";
import { requireRole } from "../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { SELECTED_PROJECT_COOKIE_NAME } from "../../../../../src/server/project/resolveSelectedProject";
import type { ProjectSwitcherData } from "../../../../../src/server/project/switcherDataAction";
import { listAccessibleProjects } from "../../../../../../../packages/02-app-shell/src/services/projectService";
import { listProjectContacts } from "../../../../../../../packages/02-app-shell/src/services/projectIntakeService";
import { upsertProjectContact, refreshContacts } from "../../contactAction";

/**
 * P3.1 Task 6: per-project contacts-management screen for
 * `project_clients` (design §4/§9's "Homeowners & decision-makers"
 * Setup-checklist item). Same auth/data-loading pattern as
 * /admin/projects/[id]/team and /admin/projects/[id]/setup exactly
 * (requireRole, look up the project from listAccessibleProjects, build
 * switcherData manually from that same fetch, archived-project guard
 * via NoProjectAccess before any write-capable UI renders) --
 * real-backend-only, same shape as every other /admin/projects/**
 * route, so this always requires a real authenticated admin/staff
 * session regardless of DEMO_MODE.
 *
 * Unlike /team's staff-assignment read (admin-only at the RLS layer),
 * `project_clients` has a real staff-wide read policy
 * (project_clients_staff_full, is_org_staff(project_id)) -- so contacts
 * are fetched for any staff session that can reach this route at all,
 * not gated behind an `isAdmin` check the way /team's staff-assignment
 * list is.
 */
export default async function ProjectContactsPage({ params }: { params: { id: string } }) {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();

  // includeArchived: true -- same reasoning as /team and /setup's own
  // comments: this one fetch backs both this page's project lookup and
  // switcherData.hasArchivedProjects.
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

  // Archived-project guard (P3-DESIGN.md Decision 9, same as /team and
  // /setup): blocks the write-capable ProjectContactsWorkspace from
  // ever rendering for an archived project, not just from being usable.
  // The actual security boundary is the service-layer guard
  // (assertProjectNotArchived, reused by upsertProjectContact in
  // projectIntakeService.ts) -- this is defense-in-depth / UX.
  if (project.status === "archived") {
    return (
      <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <NoProjectAccess
          backHref="/admin/projects"
          heading="This project is archived"
          message={`${project.name} is archived. Contact management isn't available for archived projects.`}
          backLabel="Back to your projects"
        />
      </AdminChrome>
    );
  }

  const contacts = await listProjectContacts(supabase, project.id);

  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <ProjectContactsWorkspace
        projectId={project.id}
        projectName={project.name}
        contacts={contacts}
        upsertContact={upsertProjectContact}
        refreshContacts={refreshContacts}
      />
    </AdminChrome>
  );
}
