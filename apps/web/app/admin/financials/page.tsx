import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ProjectWorkspace } from "../../../src/screens/ProjectWorkspace";
import { loadAdminVM } from "../../../src/data/loadViewModels";

export default async function AdminFinancialsPage() {
  const adminVM = await loadAdminVM();
  return (
    <AdminChrome activeKey="financials">
      <ProjectWorkspace adminViewModel={adminVM} initialTab="financials" />
    </AdminChrome>
  );
}
