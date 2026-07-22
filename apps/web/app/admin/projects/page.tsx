import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectWorkspace } from "../../../src/screens/ProjectWorkspace";
import { loadAdminVM } from "../../../src/data/loadViewModels";

export default async function AdminProjectsPage() {
  const adminVM = await loadAdminVM();
  return (
    <AdminChrome activeKey="projects">
      <ProjectWorkspace adminViewModel={adminVM} />
    </AdminChrome>
  );
}
