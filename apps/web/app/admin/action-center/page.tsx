import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ActionCenterScreen } from "../../../src/screens/ActionCenterScreen";

export default function AdminActionCenterPage() {
  return (
    <AdminChrome activeKey="action-center">
      <ActionCenterScreen />
    </AdminChrome>
  );
}
