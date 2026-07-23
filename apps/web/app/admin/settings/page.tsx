import { AdminChrome } from "../../../src/shell/AdminChrome";
import { PlaceholderScreen } from "../../../src/screens/PlaceholderScreen";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function AdminSettingsPage() {
  if (!isDemoMode()) {
    await requireRole(["admin", "staff"]);
  }
  return (
    <AdminChrome activeKey="settings">
      <PlaceholderScreen
        title="Settings"
        description="Company profile, user management, cost-code library, and notification preferences."
        packageLabel="later package"
      />
    </AdminChrome>
  );
}
