import { PayrollHomePage } from "@/modules/payroll/payroll-home/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell currentPath="/payroll" requiredPermission="payroll.manage">
      <PayrollHomePage />
    </AuthenticatedAppShell>
  );
}
