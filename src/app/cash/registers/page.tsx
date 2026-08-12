import { CashRegistersListPage } from "@/modules/cash/cash-registers-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";
export default function Page() { return <AuthenticatedAppShell currentPath="/cash/registers" requiredPermission="cash.manage"><CashRegistersListPage /></AuthenticatedAppShell>; }
