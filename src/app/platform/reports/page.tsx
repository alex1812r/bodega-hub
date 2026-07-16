import { PlatformReportsListPage } from "@/modules/platform/reports-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/platform/reports"
      requiredPermission="platform.reports.view"
    >
      <PlatformReportsListPage />
    </AuthenticatedAppShell>
  );
}
