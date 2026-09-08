import { PayrollMinePage } from "@/modules/payroll/payroll-mine/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell currentPath="/payroll/mine" requiredPermission="payroll.view_own">
      <PayrollMinePage />
    </AuthenticatedAppShell>
  );
}
