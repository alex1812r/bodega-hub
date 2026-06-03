import { PaymentsListPage } from "@/modules/payments/payments-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

type PageProps = {
  searchParams?: Promise<{
    contactId?: string;
    direction?: string;
    purchaseId?: string;
    saleId?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <AuthenticatedAppShell
      currentPath="/payments"
      requiredPermission="payments.view"
    >
      <PaymentsListPage
        initialFilters={{
          contactId: params?.contactId,
          direction: params?.direction,
          purchaseId: params?.purchaseId,
          saleId: params?.saleId,
        }}
      />
    </AuthenticatedAppShell>
  );
}
