import { cookies } from "next/headers";
import { spacing } from "../../../../../../../packages/02-app-shell/src/design/tokens";
import { Tabs } from "../../../../../../../packages/02-app-shell/src/components/ui/Tabs";
import { AdminChrome } from "../../../../../src/shell/AdminChrome";
import { ProjectBriefWorkspace } from "../../../../../../../packages/02-app-shell/src/components/ProjectBriefWorkspace";
import { ProjectSiteInfoWorkspace } from "../../../../../../../packages/02-app-shell/src/components/ProjectSiteInfoWorkspace";
import { NoProjectAccess } from "../../../../../../../packages/02-app-shell/src/components/NoProjectAccess";
import { isDemoMode } from "../../../../../src/server/demoMode";
import { requireRole } from "../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { SELECTED_PROJECT_COOKIE_NAME } from "../../../../../src/server/project/resolveSelectedProject";
import type { ProjectSwitcherData } from "../../../../../src/server/project/switcherDataAction";
import {
  listAccessibleProjects,
  getProjectPhaseAndTiming,
} from "../../../../../../../packages/02-app-shell/src/services/projectService";
import {
  getProjectBriefForStaff,
  getProjectSiteInfo,
} from "../../../../../../../packages/02-app-shell/src/services/projectIntakeService";
import { upsertProjectBrief, updateProjectPhaseAndTiming } from "../../briefAction";
import { upsertProjectSiteInfo } from "../../siteInfoAction";

/**
 * P3.1 Task 5: per-project intake screen for `project_briefs` ("Concept &
 * Scope", design §5) and `project_site_info` ("Property & Site Info",
 * design §6). One route, two tabs, switched via `?tab=` — the two
 * predictable, directly-linkable URLs Task 7 (Setup checklist) should
 * point its "Concept & scope" and "Property & site info" rows at:
 *
 *   - /admin/projects/[id]/brief                 (Concept & Scope — default)
 *   - /admin/projects/[id]/brief?tab=site-info    (Property & Site Info)
 *
 * Tab switching is a plain server-rendered link + searchParams read (same
 * `?view=` convention already used by /admin/projects?view=completed),
 * not client-side state — simpler, and every tab load is itself a full,
 * independently-linkable, independently-testable route.
 *
 * Same auth/data-loading/archived-project-guard pattern as
 * /admin/projects/[id]/team, /setup, /contacts exactly (requireRole,
 * resolve the project from listAccessibleProjects, build switcherData
 * manually from that same fetch, NoProjectAccess guard BEFORE either
 * write-capable form renders) — real-backend-only, always requires a
 * real authenticated admin/staff session regardless of DEMO_MODE.
 *
 * Both `project_briefs`/`project_site_info` reads use the staff-full
 * functions (getProjectBriefForStaff, not getProjectBriefForClient) —
 * this route is staff-only (requireRole(["admin", "staff"])), so
 * internal_notes is fine to load here; it is never passed to a
 * client-role session anywhere in this codebase.
 */
export default async function ProjectBriefPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();

  const activeTab = searchParams?.tab === "site-info" ? "site-info" : "concept";

  const accessible = await listAccessibleProjects(supabase, user.orgId, { includeArchived: true });
  const project = accessible.find((p) => p.id === params.id);

  // P5.0 (Project-Context Write-Safety): no more silent `activeProjects[0]`
  // fallback for the header switcher's "Current Project" label — matches
  // team/setup/page.tsx's own fix and resolveSelectedProjectForCookieValue()
  // itself. This page's own content stays scoped by `params.id` regardless.
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

  // Archived-project guard (P3-DESIGN.md Decision 9, same as /team,
  // /setup, /contacts): blocks BOTH write-capable forms from ever
  // rendering for an archived project, not just from being usable. The
  // actual security boundary is the service-layer guard
  // (assertProjectNotArchived, reused by upsertProjectBrief/
  // updateProjectPhaseAndTiming/upsertProjectSiteInfo) — this is
  // defense-in-depth / UX.
  if (project.status === "archived") {
    return (
      <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <NoProjectAccess
          backHref="/admin/projects"
          heading="This project is archived"
          message={`${project.name} is archived. Project intake isn't available for archived projects.`}
          backLabel="Back to your projects"
        />
      </AdminChrome>
    );
  }

  const [brief, phaseTiming, siteInfo] = await Promise.all([
    getProjectBriefForStaff(supabase, project.id),
    getProjectPhaseAndTiming(supabase, project.id),
    getProjectSiteInfo(supabase, project.id),
  ]);

  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <div className="sc-brief-page-tabs">
        <Tabs
          aria-label="Project intake tabs"
          activeKey={activeTab}
          items={[
            { key: "concept", label: "Concept & Scope", href: `/admin/projects/${project.id}/brief` },
            { key: "site-info", label: "Property & Site Info", href: `/admin/projects/${project.id}/brief?tab=site-info` },
          ]}
        />
      </div>

      {activeTab === "concept" ? (
        <ProjectBriefWorkspace
          projectId={project.id}
          projectName={project.name}
          brief={brief}
          phaseTiming={phaseTiming}
          upsertBrief={upsertProjectBrief}
          updatePhaseTiming={updateProjectPhaseAndTiming}
        />
      ) : (
        <ProjectSiteInfoWorkspace
          projectId={project.id}
          projectName={project.name}
          siteInfo={siteInfo}
          upsertSiteInfo={upsertProjectSiteInfo}
        />
      )}

      <style dangerouslySetInnerHTML={{ __html: tabStyles }} />
    </AdminChrome>
  );
}

const tabStyles = `
.sc-brief-page-tabs { margin-bottom: ${spacing.lg}; }
`;
