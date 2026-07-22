import { ClientChrome } from "../../../src/shell/ClientChrome";
import { ClientBudgetAndInvoicesScreen } from "../../../../../packages/02-app-shell/src/screens/ClientBudgetAndInvoicesScreen";
import { loadClientVM } from "../../../src/data/loadViewModels";

export default async function ClientBudgetPage() {
  const clientVM = await loadClientVM();
  return (
    <ClientChrome activeKey="budget">
      <ClientBudgetAndInvoicesScreen viewModel={clientVM} />
    </ClientChrome>
  );
}
