import { AdminChrome } from "../../../src/shell/AdminChrome";
import { AdminOverviewScreen } from "../../../src/screens/AdminOverviewScreen";
import { loadAdminVM } from "../../../src/data/loadViewModels";

export default async function AdminOverviewPage() {
  const adminVM = await loadAdminVM();
  return (
    <AdminChrome activeKey="overview">
      <AdminOverviewScreen adminVM={adminVM} />
    </AdminChrome>
  );
}
