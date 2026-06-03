import { SettingsListPage } from "@/modules/settings/settings-list/page";
import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function Page() {
  return (
    <AuthenticatedAppShell
      currentPath="/settings"
      requiredPermission="settings.view"
    >
      <SettingsListPage />
    </AuthenticatedAppShell>
  );
}
