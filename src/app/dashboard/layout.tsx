import { type ReactNode } from "react";

import { AuthenticatedAppShell } from "@/shared/components/AppShell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedAppShell
      currentPath="/dashboard"
      requiredPermission="dashboard.view"
    >
      {children}
    </AuthenticatedAppShell>
  );
}
