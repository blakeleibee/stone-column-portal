import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ConversationsTab } from "../../../src/screens/ProjectWorkspace";

export default function AdminConversationsPage() {
  return (
    <AdminChrome activeKey="conversations">
      <ConversationsTab />
    </AdminChrome>
  );
}
