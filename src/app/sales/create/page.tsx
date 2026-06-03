import { SaleCreatePage } from "@/modules/sales/sale-create/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell currentPath="/sales" requiredPermission="sales.create">
      <SaleCreatePage />
    </AuthenticatedAppShell>
  );
}
