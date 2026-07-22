import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ConversationsTab } from "../../../src/screens/ProjectWorkspace";

export default function ClientMessagesPage() {
  return (
    <ClientChrome activeKey="messages">
      <ConversationsTab />
    </ClientChrome>
  );
}
