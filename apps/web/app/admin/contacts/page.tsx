import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ContactsScreen } from "../../../src/screens/ContactsScreen";
import { isDemoMode } from "../../../src/server/demoMode";
import { requireRole } from "../../../src/server/auth/require";

export default async function AdminContactsPage() {
  if (!isDemoMode()) {
    await requireRole(["admin", "staff"]);
  }
  return (
    <AdminChrome activeKey="contacts" isDemoMode={isDemoMode()}>
      <ContactsScreen />
    </AdminChrome>
  );
}
