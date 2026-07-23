import { ClientChrome } from "../../../src/shell/ClientChrome";
import { SelectionsTab } from "../../../src/screens/ProjectWorkspace";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function ClientSelectionsPage() {
  if (!isDemoMode()) {
    await requireRole(["client"]);
  }
  return (
    <ClientChrome activeKey="selections">
      <SelectionsTab isClient />
    </ClientChrome>
  );
}
