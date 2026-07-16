import { Suspense } from "react";

import { CreateStoreAdminPage } from "@/modules/platform/user-create-admin/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";
import { LoadingState } from "@/shared/components/LoadingState";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/platform/users"
      requiredPermission="platform.users.manage"
    >
      <Suspense fallback={<LoadingState title="Cargando formulario..." variant="page" />}>
        <CreateStoreAdminPage />
      </Suspense>
    </AuthenticatedAppShell>
  );
}
