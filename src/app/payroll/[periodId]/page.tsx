import { PayrollPeriodDetailPage } from "@/modules/payroll/payroll-period-detail/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default async function Page({ params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;

  return (
    <AuthenticatedAppShell currentPath="/payroll" requiredPermission="payroll.manage">
      <PayrollPeriodDetailPage periodId={periodId} />
    </AuthenticatedAppShell>
  );
}
