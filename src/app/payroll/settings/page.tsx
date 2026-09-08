import { PayrollSettingsPage } from "@/modules/payroll/payroll-settings/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell currentPath="/payroll" requiredPermission="payroll.manage">
      <PayrollSettingsPage />
    </AuthenticatedAppShell>
  );
}
