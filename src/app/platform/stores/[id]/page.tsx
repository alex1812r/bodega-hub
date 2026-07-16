import { StoreDetailPage } from "@/modules/platform/store-detail/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AuthenticatedAppShell
      currentPath="/platform/stores"
      requiredPermission="platform.stores.view"
    >
      <StoreDetailPage id={id} />
    </AuthenticatedAppShell>
  );
}
