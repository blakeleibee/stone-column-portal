import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ClientHomeScreen } from "../../../src/screens/ClientHomeScreen";
import { loadClientVM } from "../../../src/data/loadViewModels";

export default async function ClientHomePage() {
  const clientVM = await loadClientVM();
  return (
    <ClientChrome activeKey="home">
      <ClientHomeScreen clientVM={clientVM} />
    </ClientChrome>
  );
}
