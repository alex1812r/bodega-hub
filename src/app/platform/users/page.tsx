import { PlatformUsersListPage } from "@/modules/platform/users-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/platform/users"
      requiredPermission="platform.users.view"
    >
      <PlatformUsersListPage />
    </AuthenticatedAppShell>
  );
}
