"use client";

import { AuthenticatedAppShell } from "@/shared/components/AppShell";
import { RouteError } from "@/shared/components/RouteError";

/**
 * Red de seguridad de `/reports` (REP-F8 R-05). Sustituye a la página entera,
 * que es quien monta el `AppShell`: por eso lo vuelve a montar aquí.
 */
export default function ReportsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <AuthenticatedAppShell currentPath="/reports" requiredPermission="reports.view">
      <RouteError
        error={error}
        homeHref={null}
        queryKey={["reports"]}
        retry={unstable_retry}
        title="No pudimos mostrar los reportes"
      />
    </AuthenticatedAppShell>
  );
}
