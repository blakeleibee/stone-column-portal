import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ConversationsTab } from "../../../src/screens/ProjectWorkspace";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function AdminConversationsPage() {
  if (!isDemoMode()) {
    await requireRole(["admin", "staff"]);
  }
  return (
    <AdminChrome activeKey="conversations" isDemoMode={isDemoMode()}>
      <ConversationsTab />
    </AdminChrome>
  );
}
