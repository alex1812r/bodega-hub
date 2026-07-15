import { InventoryMovementsPage } from "@/modules/inventory/inventory-movements/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

type PageProps = {
  searchParams?: Promise<{
    productId?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <AuthenticatedAppShell
      currentPath="/inventory"
      requiredPermission="inventory.view"
    >
      <InventoryMovementsPage
        initialFilters={{
          productId: params?.productId,
        }}
      />
    </AuthenticatedAppShell>
  );
}
