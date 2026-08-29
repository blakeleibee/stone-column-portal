import { cookies } from "next/headers";
import { AdminChrome } from "../../../../../src/shell/AdminChrome";
import { ProjectPricingWorkspace } from "../../../../../../../packages/02-app-shell/src/components/ProjectPricingWorkspace";
import { NoProjectAccess } from "../../../../../../../packages/02-app-shell/src/components/NoProjectAccess";
import { isDemoMode } from "../../../../../src/server/demoMode";
import { requireRole } from "../../../../../src/server/auth/require";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { SELECTED_PROJECT_COOKIE_NAME } from "../../../../../src/server/project/resolveSelectedProject";
import type { ProjectSwitcherData } from "../../../../../src/server/project/switcherDataAction";
import {
  listAccessibleProjects,
  getProjectFeeTerms,
} from "../../../../../../../packages/02-app-shell/src/services/projectService";
import { setProjectFeeTerms, refreshFeeTerms } from "../../feeTermsAction";

/**
 * `/admin/projects/[id]/pricing` (P3.1 Task 8) — "Contract & Pricing
 * Terms," the new post-creation home for pricing capture (design §2/§9's
 * Setup-checklist row). Same auth/data-loading pattern as
 * /admin/projects/[id]/team and /admin/projects/[id]/contacts exactly
 * (requireRole, look up the project from listAccessibleProjects, build
 * switcherData manually from that same fetch, archived-project guard via
 * NoProjectAccess before any write-capable form renders) — real-backend-
 * only, so this always requires a real authenticated admin/staff session
 * regardless of DEMO_MODE.
 *
 * Unlike /team's staff-assignment read (admin-only at the RLS layer),
 * `projects.pricing_model` is visible to any is_org_staff() session, and
 * `project_fee_rules` is visible to any is_financial_staff() session (a
 * strict subset — see getProjectFeeTerms's own doc comment in
 * projectService.ts) — so the current-terms read always runs here,
 * regardless of `isAdmin`, the same way /contacts always reads
 * project_clients. `isAdmin` only gates whether the WRITE form renders
 * (design consequential decision 5: set_project_fee_terms() is
 * admin-only, same restriction as project creation's own pricing
 * fields) — a non-admin session sees the read-only current-terms summary
 * and an explanatory note instead of a form it could never successfully
 * submit (the RPC's own is_org_admin_for_org() check is the real
 * boundary; this is defense-in-depth/UX, matching this codebase's
 * established pattern).
 */
export default async function ProjectPricingPage({ params }: { params: { id: string } }) {
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const isAdmin = user.role === "admin";

  // includeArchived: true — same reasoning as /team, /setup, and
  // /contacts's own comments: this one fetch backs both this page's own
  // project lookup and switcherData.hasArchivedProjects.
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

  // Archived-project guard (P3-DESIGN.md Decision 9, same as /team,
  // /setup, and /contacts): stops the write-capable
  // ProjectPricingWorkspace form from ever rendering for an archived
  // project, not just from being usable. The actual security boundary is
  // set_project_fee_terms()'s own admin check inside the RPC — this is
  // defense-in-depth / UX.
  if (project.status === "archived") {
    return (
      <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <NoProjectAccess
          backHref="/admin/projects"
          heading="This project is archived"
          message={`${project.name} is archived. Contract & pricing terms can't be changed for archived projects.`}
          backLabel="Back to your projects"
        />
      </AdminChrome>
    );
  }

  const feeTerms = await getProjectFeeTerms(supabase, project.id);

  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <ProjectPricingWorkspace
        projectId={project.id}
        projectName={project.name}
        isAdmin={isAdmin}
        feeTerms={feeTerms}
        setFeeTerms={setProjectFeeTerms}
        refreshFeeTerms={refreshFeeTerms}
      />
    </AdminChrome>
  );
}
