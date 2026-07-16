import { StoresListPage } from "@/modules/platform/stores-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/platform/stores"
      requiredPermission="platform.stores.view"
    >
      <StoresListPage />
    </AuthenticatedAppShell>
  );
}
