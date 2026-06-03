import { ReportsListPage } from "@/modules/reports/reports-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell currentPath="/reports" requiredPermission="reports.view">
      <ReportsListPage />
    </AuthenticatedAppShell>
  );
}
