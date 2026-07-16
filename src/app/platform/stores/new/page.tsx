import { StoreCreatePage } from "@/modules/platform/store-create/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/platform/stores"
      requiredPermission="platform.stores.manage"
    >
      <StoreCreatePage />
    </AuthenticatedAppShell>
  );
}
