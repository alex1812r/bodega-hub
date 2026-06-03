import { PurchaseDetailsPage } from "@/modules/purchases/purchase-details/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function Page(props: PageProps) {
  const { id } = await props.params;

  return (
    <AuthenticatedAppShell currentPath="/purchases" requiredPermission="purchases.view">
      <PurchaseDetailsPage purchaseId={id} />
    </AuthenticatedAppShell>
  );
}
