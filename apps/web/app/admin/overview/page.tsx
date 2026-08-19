import { AdminChrome } from "../../../src/shell/AdminChrome";
import { AdminOverviewScreen } from "../../../src/screens/AdminOverviewScreen";
import { loadAdminVM, loadAdminVMFor } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { resolveProjectAndSwitcherData } from "../../../src/server/project/resolveProjectAndSwitcherData";
import { projectMeta as demoProjectMeta, expenses as demoExpenses } from "../../../../../packages/01-financial-engine/fixtures/hawksRidge";

export default async function AdminOverviewPage() {
  if (isDemoMode()) {
    const adminVM = await loadAdminVM();
    return (
      <AdminChrome activeKey="overview" isDemoMode={isDemoMode()}>
        <AdminOverviewScreen adminVM={adminVM} project={demoProjectMeta} expenses={demoExpenses} />
      </AdminChrome>
    );
  }

  // Real (non-demo) path — this used to call loadAdminVM() unconditionally,
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
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
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
  const [adminVM, realExpenses] = await Promise.all([
    loadAdminVMFor(project.id, repo),
    repo.getExpenses(project.id),
  ]);

  // adminVM.projectMeta already carries real name/phase/pricingLabel from
  // SupabaseFinancialRepository.getProjectMeta() — but that method's own
  // query selects `address` and never maps it onto the returned object
  // (a separate, pre-existing bug outside this task's file list), so
  // `address` is patched in here from the already-resolved `project`
  // (ProjectRow), which maps it correctly. `clientNames` has no real data
  // source yet (no project_clients/project_members query wired up) and is
  // intentionally left absent — AdminOverviewScreen renders that
  // gracefully, not as "undefined".
  return (
    <AdminChrome activeKey="overview" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <AdminOverviewScreen
        adminVM={adminVM}
        project={{ ...adminVM.projectMeta, address: project.address ?? undefined }}
        expenses={realExpenses}
      />
    </AdminChrome>
  );
}
