import { AdminChrome } from "../../../src/shell/AdminChrome";
import { AdminOverviewScreen } from "../../../src/screens/AdminOverviewScreen";
import { loadAdminVM, loadAdminVMFor } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { resolveProjectAndSwitcherData } from "../../../src/server/project/resolveProjectAndSwitcherData";

export default async function AdminOverviewPage() {
  if (isDemoMode()) {
    const adminVM = await loadAdminVM();
    return (
      <AdminChrome activeKey="overview" isDemoMode={isDemoMode()}>
        <AdminOverviewScreen adminVM={adminVM} />
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

  const adminVM = await loadAdminVMFor(project.id, repo);
  return (
    <AdminChrome activeKey="overview" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <AdminOverviewScreen adminVM={adminVM} />
    </AdminChrome>
  );
}
