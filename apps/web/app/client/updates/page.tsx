import { ClientChrome } from "../../../src/shell/ClientChrome";
import { UpdatesTab } from "../../../src/screens/ProjectWorkspace";

export default function ClientUpdatesPage() {
  return (
    <ClientChrome activeKey="updates">
      <UpdatesTab isClient />
    </ClientChrome>
  );
}
