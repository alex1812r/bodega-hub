import { PaymentsListPage } from "@/modules/payments/payments-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/payments"
      requiredPermission="payments.view"
    >
      <PaymentsListPage />
    </AuthenticatedAppShell>
  );
}
