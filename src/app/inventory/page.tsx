import { InventoryListPage } from "@/modules/inventory/inventory-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/inventory"
      requiredPermission="inventory.view"
    >
      <InventoryListPage />
    </AuthenticatedAppShell>
  );
}
