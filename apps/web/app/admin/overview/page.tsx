import { AdminChrome } from "../../../src/shell/AdminChrome";
import { AdminOverviewScreen } from "../../../src/screens/AdminOverviewScreen";
import { loadAdminVM } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function AdminOverviewPage() {
  if (!isDemoMode()) {
    await requireRole(["admin", "staff"]);
  }
  const adminVM = await loadAdminVM();
  return (
    <AdminChrome activeKey="overview">
      <AdminOverviewScreen adminVM={adminVM} />
    </AdminChrome>
  );
}
