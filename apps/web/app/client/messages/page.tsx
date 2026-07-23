import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ConversationsTab } from "../../../src/screens/ProjectWorkspace";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function ClientMessagesPage() {
  if (!isDemoMode()) {
    await requireRole(["client"]);
  }
  return (
    <ClientChrome activeKey="messages">
      <ConversationsTab />
    </ClientChrome>
  );
}
