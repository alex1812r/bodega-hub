import { CashRegisterDetailPage } from "@/modules/cash/cash-register-detail/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AuthenticatedAppShell currentPath="/cash/registers" requiredPermission="cash.manage">
      <CashRegisterDetailPage id={id} />
    </AuthenticatedAppShell>
  );
}
