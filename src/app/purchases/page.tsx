import { PurchasesListPage } from "@/modules/purchases/purchases-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/purchases"
      requiredPermission="purchases.view"
    >
      <PurchasesListPage />
    </AuthenticatedAppShell>
  );
}
