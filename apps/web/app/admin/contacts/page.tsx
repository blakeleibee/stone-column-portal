import { AdminChrome } from "../../../src/shell/AdminChrome";
import { ContactsScreen } from "../../../src/screens/ContactsScreen";

export default function AdminContactsPage() {
  return (
    <AdminChrome activeKey="contacts">
      <ContactsScreen />
    </AdminChrome>
  );
}
