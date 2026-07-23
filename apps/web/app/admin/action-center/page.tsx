import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ActionCenterScreen } from "../../../src/screens/ActionCenterScreen";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function AdminActionCenterPage() {
  if (!isDemoMode()) {
    await requireRole(["admin", "staff"]);
  }
  return (
    <AdminChrome activeKey="action-center" isDemoMode={isDemoMode()}>
      <ActionCenterScreen />
    </AdminChrome>
  );
}
