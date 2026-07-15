import { type ReactNode } from "react";

import { AuthenticatedAppShell } from "@/shared/components/AppShell";

/**
 * POS: shell aqui (no en page). Main sin scroll; el hijo reparte alto entre catalogo y carrito.
 */
export default function SalesCreateLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedAppShell
      currentPath="/sales"
      mainClassName="overflow-hidden"
      mainScroll="hidden"
      requiredPermission="sales.create"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </AuthenticatedAppShell>
  );
}
