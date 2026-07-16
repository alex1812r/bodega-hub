import { PlatformDashboardPage } from "@/modules/platform/dashboard/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/platform/dashboard"
      requiredPermission="platform.dashboard.view"
    >
      <PlatformDashboardPage />
    </AuthenticatedAppShell>
  );
}
