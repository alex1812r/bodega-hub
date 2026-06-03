import { InventoryMovementsPage } from "@/modules/inventory/inventory-movements/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/inventory"
      requiredPermission="inventory.view"
    >
      <InventoryMovementsPage />
    </AuthenticatedAppShell>
  );
}
