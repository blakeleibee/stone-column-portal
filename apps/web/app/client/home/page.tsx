import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ClientHomeScreen } from "../../../src/screens/ClientHomeScreen";
import { loadClientVM } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function ClientHomePage() {
  if (!isDemoMode()) {
    await requireRole(["client"]);
  }
  const clientVM = await loadClientVM();
  return (
    <ClientChrome activeKey="home">
      <ClientHomeScreen clientVM={clientVM} />
    </ClientChrome>
  );
}
