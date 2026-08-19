import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectWorkspace } from "../../../src/screens/ProjectWorkspace";
import { loadAdminVM, loadAdminVMFor } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";
import { getRepository } from "../../../src/data/getRepository";
import { createServerSupabaseClient } from "../../../src/server/supabase/serverClient";
import { projectMeta as demoProjectMeta } from "../../../../../packages/01-financial-engine/fixtures/hawksRidge";
import { resolveProjectAndSwitcherData } from "../../../src/server/project/resolveProjectAndSwitcherData";

export default async function AdminFinancialsPage() {
  if (isDemoMode()) {
    const adminVM = await loadAdminVM();
    return (
      <AdminChrome activeKey="financials" isDemoMode={isDemoMode()}>
        <ProjectWorkspace adminViewModel={adminVM} initialTab="financials" project={demoProjectMeta} />
      </AdminChrome>
    );
  }

  const user = await requireRole(["admin", "staff"]);
  const supabase = await createServerSupabaseClient();
  const repo = getRepository(supabase);

  const { project, switcherData } = await resolveProjectAndSwitcherData(supabase, user.orgId, user.role);

  if (!project) {
    return (
      <AdminChrome activeKey="financials" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
        <p style={{ padding: 24 }}>No projects yet for this organization.</p>
      </AdminChrome>
    );
  }

  const adminVM = await loadAdminVMFor(project.id, repo);
  return (
    <AdminChrome activeKey="financials" isDemoMode={isDemoMode()} projectSwitcherData={switcherData}>
      <ProjectWorkspace adminViewModel={adminVM} initialTab="financials" project={project} />
    </AdminChrome>
  );
}
