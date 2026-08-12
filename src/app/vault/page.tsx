import { VaultHomePage } from "@/modules/vault/vault-home/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";
export default function Page() { return <AuthenticatedAppShell currentPath="/vault" requiredPermission="vault.view"><VaultHomePage /></AuthenticatedAppShell>; }
