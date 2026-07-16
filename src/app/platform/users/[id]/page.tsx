import { PlatformUserDetailPage } from "@/modules/platform/user-detail/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

type PageProps = { params: Promise<{ id: string }> };

export default async function Page({ params }: PageProps) {
  const { id } = await params;

  return (
    <AuthenticatedAppShell
      currentPath="/platform/users"
      requiredPermission="platform.users.view"
    >
      <PlatformUserDetailPage id={id} />
    </AuthenticatedAppShell>
  );
}
