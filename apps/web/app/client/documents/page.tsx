import { ClientChrome } from "../../../src/shell/ClientChrome";
import { DocumentsTab } from "../../../src/screens/ProjectWorkspace";

export default function ClientDocumentsPage() {
  return (
    <ClientChrome activeKey="documents">
      <DocumentsTab isClient />
    </ClientChrome>
  );
}
