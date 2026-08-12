import { CashDeskPage } from "@/modules/cash/cash-desk/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";
export default function Page() { return <AuthenticatedAppShell currentPath="/cash" requiredPermission="cash.view"><CashDeskPage /></AuthenticatedAppShell>; }
