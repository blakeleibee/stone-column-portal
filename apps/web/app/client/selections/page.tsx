import { ClientChrome } from "../../../src/shell/ClientChrome";
import { SelectionsTab } from "../../../src/screens/ProjectWorkspace";

export default function ClientSelectionsPage() {
  return (
    <ClientChrome activeKey="selections">
      <SelectionsTab isClient />
    </ClientChrome>
  );
}
