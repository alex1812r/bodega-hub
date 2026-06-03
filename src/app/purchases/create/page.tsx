import { PurchaseCreatePage } from "@/modules/purchases/purchase-create/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell currentPath="/purchases" requiredPermission="purchases.view">
      <PurchaseCreatePage />
    </AuthenticatedAppShell>
  );
}
