import { ClientChrome } from "../../../src/shell/ClientChrome";
import { DocumentsTab } from "../../../src/screens/ProjectWorkspace";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function ClientDocumentsPage() {
  if (!isDemoMode()) {
    await requireRole(["client"]);
  }
  return (
    <ClientChrome activeKey="documents" isDemoMode={isDemoMode()}>
      <DocumentsTab isClient />
    </ClientChrome>
  );
}
