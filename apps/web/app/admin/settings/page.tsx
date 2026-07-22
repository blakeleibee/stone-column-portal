import { AdminChrome } from "../../../src/shell/AdminChrome";
import { PlaceholderScreen } from "../../../src/screens/PlaceholderScreen";

export default function AdminSettingsPage() {
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
