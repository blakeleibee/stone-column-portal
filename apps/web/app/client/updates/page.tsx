import { ClientChrome } from "../../../src/shell/ClientChrome";
import { UpdatesTab } from "../../../src/screens/ProjectWorkspace";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function ClientUpdatesPage() {
  if (!isDemoMode()) {
    await requireRole(["client"]);
  }
  return (
    <ClientChrome activeKey="updates">
      <UpdatesTab isClient />
    </ClientChrome>
  );
}
