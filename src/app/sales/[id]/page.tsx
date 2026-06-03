import { SaleDetailsPage } from "@/modules/sales/sale-details/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function Page(props: PageProps) {
  const { id } = await props.params;

  return (
    <AuthenticatedAppShell currentPath="/sales" requiredPermission="sales.view">
      <SaleDetailsPage saleId={id} />
    </AuthenticatedAppShell>
  );
}
