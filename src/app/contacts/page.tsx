import { ContactsListPage } from "@/modules/contacts/contacts-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/contacts"
      requiredPermission="contacts.view"
    >
      <ContactsListPage />
    </AuthenticatedAppShell>
  );
}
