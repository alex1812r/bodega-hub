import { ContactDetailsPage } from "@/modules/contacts/contact-details/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function Page(props: PageProps) {
  const { id } = await props.params;

  return (
    <AuthenticatedAppShell currentPath="/contacts" requiredPermission="contacts.view">
      <ContactDetailsPage contactId={id} />
    </AuthenticatedAppShell>
  );
}
