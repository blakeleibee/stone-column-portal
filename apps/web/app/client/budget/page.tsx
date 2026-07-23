import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ClientBudgetAndInvoicesScreen } from "../../../../../packages/02-app-shell/src/screens/ClientBudgetAndInvoicesScreen";
import { loadClientVM } from "../../../src/data/loadViewModels";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function ClientBudgetPage() {
  if (!isDemoMode()) {
    await requireRole(["client"]);
  }
  const clientVM = await loadClientVM();
  return (
    <ClientChrome activeKey="budget" isDemoMode={isDemoMode()}>
      <ClientBudgetAndInvoicesScreen viewModel={clientVM} />
    </ClientChrome>
  );
}
