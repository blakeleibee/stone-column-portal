import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectWorkspace } from "../../../src/screens/ProjectWorkspace";
import { loadAdminVM } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function AdminProjectsPage() {
  if (!isDemoMode()) {
    await requireRole(["admin", "staff"]);
  }
  const adminVM = await loadAdminVM();
  return (
    <AdminChrome activeKey="projects" isDemoMode={isDemoMode()}>
      <ProjectWorkspace adminViewModel={adminVM} />
    </AdminChrome>
  );
}
