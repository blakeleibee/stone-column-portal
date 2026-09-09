import { AdminChrome } from "../../../src/shell/AdminChrome";
import { AdminOverviewScreen } from "../../../src/screens/AdminOverviewScreen";
import { NoProjectSelected } from "../../../../../packages/02-app-shell/src/components/NoProjectSelected";
import { loadAdminVM, loadAdminVMFor } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { resolveProjectAndSwitcherData } from "../../../src/server/project/resolveProjectAndSwitcherData";
import { switchProject } from "../projects/switchAction";
import { projectMeta as demoProjectMeta, expenses as demoExpenses } from "../../../../../packages/01-financial-engine/fixtures/hawksRidge";
import {
  getMyActiveAssignmentForProject,
  getProjectBriefForStaff,
  getProjectSetupChecklist,
} from "../../../../../packages/02-app-shell/src/services/projectIntakeService";
import type { MyAssignmentCardData } from "../../../src/screens/AdminOverviewScreen";
import type { StaffFunction } from "../../../../../packages/02-app-shell/src/services/projectService";

export default async function AdminOverviewPage() {
  if (isDemoMode()) {
    const adminVM = await loadAdminVM();
    return (
      <AdminChrome activeKey="overview" isDemoMode={isDemoMode()}>
        <AdminOverviewScreen adminVM={adminVM} project={demoProjectMeta} expenses={demoExpenses} />
      </AdminChrome>
    );
  }

  // Real (non-demo) path — this used to call the zero-arg, fixture-backed
  // `loadAdminVM` loader unconditionally (no project id, no real repo),
  // which meant a real authenticated session still saw the fixture Hawks
  // Ridge project's figures (standing bug flagged in this task's brief).
  // Fixed the same way /admin/financials/page.tsx already did it: resolve
  // the caller's real project and build the view model from the real repo.
  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const repo = getRepository(supabase);

  const { project, switcherData } = await resolveProjectAndSwitcherData(supabase, user.orgId, user.role);

  if (!project) {
    return (
      <AdminChrome activeKey="overview" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <NoProjectSelected
          projects={switcherData.otherProjects}
          hasArchivedProjects={switcherData.hasArchivedProjects}
          onSelectProject={switchProject}
        />
      </AdminChrome>
    );
  }

  // repo.getExpenses(project.id) is called a second time here (it's
  // already an internal input to loadAdminVMFor/buildAdminFinancialsViewModel
  // above) rather than threading the raw rows out through
  // AdminFinancialsViewModel — same direct-repo-call-in-a-page.tsx pattern
  // /admin/estimate/page.tsx already uses for its own repo reads, and it
  // avoids widening AdminFinancialsViewModel's shape (used by other
  // screens/tests) for one screen's "Recently Imported" list.
  const [adminVM, realExpenses, myActiveAssignment] = await Promise.all([
    loadAdminVMFor(project.id, repo),
    repo.getExpenses(project.id),
    // Task 9 (P3.1 design §8) — "Your assignment" card. Checked first,
    // on its own, before fetching anything else the card needs (brief
    // summary/staff_function/checklist): most sessions viewing this page
    // (e.g. an admin who isn't personally staffed on the project) have
    // no active assignment at all, and there's no reason to pay for 3
    // more queries just to discover the card won't render.
    getMyActiveAssignmentForProject(supabase, project.id),
  ]);

  let myAssignment: MyAssignmentCardData | null = null;
  if (myActiveAssignment) {
    const [briefRow, checklist, profileResult] = await Promise.all([
      getProjectBriefForStaff(supabase, project.id),
      getProjectSetupChecklist(supabase, project.id),
      supabase.from("profiles").select("staff_function").eq("id", user.id).maybeSingle(),
    ]);
    myAssignment = {
      staffFunction: (profileResult.data?.staff_function as StaffFunction | null) ?? null,
      briefSummary: briefRow?.summary ?? null,
      assignment: myActiveAssignment,
      checklist,
    };
  }

  // adminVM.projectMeta already carries real name/phase/pricingLabel/address
  // from SupabaseFinancialRepository.getProjectMeta() (that method's own
  // query previously selected `address` but never mapped it onto the
  // returned object — fixed in the final-review fix wave, so the
  // address-patched-in-from-`project` workaround this comment used to
  // describe is no longer needed). `clientNames` has no real data source
  // yet (no project_clients/project_members query wired up) and is
  // intentionally left absent — AdminOverviewScreen renders that
  // gracefully, not as "undefined".
  return (
    <AdminChrome activeKey="overview" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <AdminOverviewScreen adminVM={adminVM} project={adminVM.projectMeta} expenses={realExpenses} myAssignment={myAssignment} />
    </AdminChrome>
  );
}
