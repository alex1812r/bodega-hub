import { SalesListPage } from "@/modules/sales/sales-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell currentPath="/sales" requiredPermission="sales.view">
      <SalesListPage />
    </AuthenticatedAppShell>
  );
}
